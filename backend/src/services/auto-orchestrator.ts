import { v4 as uuidv4 } from 'uuid';
import database from './database';
import queue from './queue';
import logger from '../utils/logger';
import storage from './storage';
import {
  FingerprintJob,
  CrawlJob,
  PortScanJob,
  ScannerJob,
  ThreeAgentJob,
} from '../../../shared/types';
import { orchestrator as threeAgentOrchestrator } from './three-agent/orchestrator';
import workflowEngine from './workflow-engine';

/**
 * Auto-Orchestrator Service
 * Automatically triggers follow-up jobs based on completed jobs and discovered assets
 */

class AutoOrchestratorService {
  /**
   * Handle job completion - auto-trigger follow-up jobs
   */
  async onJobComplete(jobId: string): Promise<void> {
    try {
      // Get job details including metadata
      const jobResult = await database.query(
        `SELECT id, type, program_id, status, result, metadata FROM jobs WHERE id = $1`,
        [jobId]
      );

      if (jobResult.rows.length === 0) {
        return;
      }

      const job = jobResult.rows[0];

      if (job.status !== 'completed') {
        return;
      }

      logger.info(
        { jobId, jobType: job.type, programId: job.program_id },
        'Auto-orchestrator: Job completed, checking for follow-ups'
      );

      // Trigger follow-ups based on job type
      switch (job.type) {
        case 'discovery':
        case 'subdomain':
        case 'bruteforce':
          await this.handleSubdomainDiscovery(job.program_id, jobId);
          break;

        case 'fingerprint':
          // Check job metadata tags to determine if this was dnsx-only or httpx
          const jobMetadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : (job.metadata || {});
          const tags = jobMetadata.tags || [];
          const isDnsxOnly = tags.includes('dnsx-only');
          const isHttpxOnly = tags.includes('httpx-only');
          
          if (isDnsxOnly) {
            // DNS check completed, now trigger httpx
            await this.handleDnsxComplete(job.program_id, jobId);
          } else if (isHttpxOnly) {
            // HTTP fingerprinting completed, trigger port scan, crawl, and nuclei
            await this.handleFingerprintComplete(job.program_id, jobId);
          }
          break;

        case 'crawl':
          await this.handleCrawlComplete(job.program_id, jobId, job.result);
          break;

        case 'portscan':
          await this.handlePortScanComplete(job.program_id, jobId);
          // Also trigger nuclei on any discovered URLs (parallel, not dependent)
          await this.triggerNucleiOnUrls(job.program_id);
          break;
      }
    } catch (error: any) {
      logger.error({ error, errorMessage: error?.message, errorStack: error?.stack, jobId }, 'Auto-orchestrator error');
    }
  }

  /**
   * After subdomain discovery - trigger Naabu port scanning on ALL subdomains
   * Classification (internal/external) happens AFTER port scan completes
   */
  private async handleSubdomainDiscovery(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Get ALL discovered subdomains (no filtering, no classification yet)
    const assetsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type IN ('subdomain', 'domain')
       AND NOT value LIKE '.%'
       AND discovered_at > NOW() - INTERVAL '15 minutes'
       LIMIT 5000`,
      [programId]
    );

    if (assetsResult.rows.length === 0) {
      logger.info({ programId }, 'No subdomains found, skipping port scan');
      return;
    }

    logger.info({ programId, count: assetsResult.rows.length }, '🎯 Triggering Naabu port scan on ALL subdomains');


    const allSubdomains = assetsResult.rows.map((row: any) => row.value);

    // Batch subdomains for port scanning (500 per batch)
    const PORTSCAN_BATCH_SIZE = 500;
    const portscanBatches: string[][] = [];

    for (let i = 0; i < allSubdomains.length; i += PORTSCAN_BATCH_SIZE) {
      portscanBatches.push(allSubdomains.slice(i, i + PORTSCAN_BATCH_SIZE));
    }

    // Create Naabu port scan jobs for ALL subdomains (no filtering)
    const portscanJobs: PortScanJob[] = [];
    for (const batch of portscanBatches) {
      const jobId = uuidv4();
      portscanJobs.push({
        id: jobId,
        type: 'portscan',
        programId,
        priority: 8, // High priority
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          targets: batch,
          ports: 'top-1000', // Naabu scans top 1000 ports
          rate: 2000,
          timeout: 300000,
        },
        metadata: {
          requestedBy: 'auto-orchestrator',
          tags: ['auto-triggered', `parent-job-${completedJobId}`, `batch-${batch.length}`, 'subdomain-portscan'],
        },
        createdAt: new Date(),
      });
    }

    // Save all jobs to database and queue
    const savePromises = [];
    for (const job of portscanJobs) {
      savePromises.push(queue.addJob('portscan', job), this.saveJobToDatabase(job));
    }

    await Promise.all(savePromises);

    logger.info(
      {
        programId,
        portscanBatches: portscanBatches.length,
        subdomainCount: allSubdomains.length,
      },
      '✅ Auto-triggered Naabu port scan on ALL subdomains. Split & classification will happen after Naabu completes.'
    );
  }

  /**
   * After DNS check (dnsx) - trigger httpx for DNS-resolved subdomains
   */
  private async handleDnsxComplete(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Get DNS-resolved subdomains (those with dnsResolved metadata)
    const assetsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type IN ('subdomain', 'domain')
       AND (metadata->>'dnsResolved')::boolean = true
       AND (metadata->>'httpStatus' IS NULL)
       LIMIT 5000`,
      [programId]
    );

    if (assetsResult.rows.length === 0) {
      logger.info({ programId }, 'No DNS-resolved subdomains found, skipping httpx');
      return;
    }

    const resolvedSubdomains = assetsResult.rows.map((row: any) => row.value);

    logger.info(
      { programId, count: resolvedSubdomains.length },
      'DNS check complete, triggering httpx for resolved subdomains'
    );

    // Create httpx fingerprint jobs
    const FINGERPRINT_BATCH_SIZE = 1000;
    const httpxBatches: string[][] = [];

    for (let i = 0; i < resolvedSubdomains.length; i += FINGERPRINT_BATCH_SIZE) {
      httpxBatches.push(resolvedSubdomains.slice(i, i + FINGERPRINT_BATCH_SIZE));
    }

    const httpxJobs: FingerprintJob[] = [];
    for (const batch of httpxBatches) {
      const jobId = uuidv4();
      httpxJobs.push({
        id: jobId,
        type: 'fingerprint',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          assets: batch,
          tools: ['httpx'],  // HTTP fingerprinting on DNS-resolved subdomains
          concurrency: 50,
          followRedirects: true,
        },
        metadata: {
          requestedBy: 'auto-orchestrator',
          tags: ['auto-triggered', `parent-job-${completedJobId}`, `batch-${batch.length}`, 'httpx-only'],
        },
        createdAt: new Date(),
      });
    }

    // Save httpx jobs
    const savePromises = [];
    for (const job of httpxJobs) {
      savePromises.push(queue.addJob('fingerprint', job), this.saveJobToDatabase(job));
    }

    await Promise.all(savePromises);

    logger.info(
      {
        programId,
        httpxBatches: httpxJobs.length,
        subdomainCount: resolvedSubdomains.length,
      },
      '✅ Auto-triggered httpx jobs for DNS-resolved subdomains'
    );
  }

  /**
   * After fingerprinting (httpx) - trigger crawling AND nuclei scanning in parallel
   */
  private async handleFingerprintComplete(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Get alive subdomains and URLs from fingerprinted assets
    // Only get assets with successful HTTP responses (200-399)
    const assetsResult = await database.query(
      `SELECT DISTINCT value, type, metadata FROM assets
       WHERE program_id = $1
       AND type IN ('subdomain', 'domain', 'url')
       AND discovered_at > NOW() - INTERVAL '10 minutes'
       AND (
         (metadata->>'httpStatus' IS NOT NULL AND (metadata->>'httpStatus')::int BETWEEN 200 AND 399)
         OR type = 'url'
       )
       LIMIT 100`,
      [programId]
    );

    if (assetsResult.rows.length === 0) {
      logger.info({ programId }, 'No alive assets found after fingerprinting');
      return;
    }

    // Build URLs for crawling (only alive hosts)
    const crawlUrls: string[] = [];
    const scanUrls: string[] = []; // For nuclei - include more variants

    for (const row of assetsResult.rows) {
      if (row.type === 'url') {
        crawlUrls.push(row.value);
        scanUrls.push(row.value);
      } else {
        // For alive subdomains, use the protocol that worked
        const httpStatus = row.metadata?.httpStatus;
        if (httpStatus) {
          // Strip existing protocol from value to avoid double protocol prefix
          const cleanValue = row.value.replace(/^https?:\/\//, '');
          // Determine which protocol worked based on httpStatus
          const protocol = httpStatus >= 200 && httpStatus < 400 ? 'https' : 'https';
          const url = `${protocol}://${cleanValue}`;
          crawlUrls.push(url);
          // For scanning, try both protocols
          scanUrls.push(`http://${cleanValue}`);
          scanUrls.push(`https://${cleanValue}`);
        }
      }
    }

    if (crawlUrls.length === 0) {
      logger.info({ programId }, 'No crawlable URLs after filtering');
      return;
    }

    logger.info(
      { programId, crawlUrlCount: crawlUrls.length, scanUrlCount: scanUrls.length },
      'Triggering crawl AND nuclei scan in parallel'
    );

    // Create crawl job
    const crawlJobId = uuidv4();
    const crawlJob: CrawlJob = {
      id: crawlJobId,
      type: 'crawl',
      programId,
      priority: 8,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        targetUrls: crawlUrls,
        depth: 1,  // AGGRESSIVE: depth 1 only (5x faster than depth 3)
        respectRobots: true,
        maxUrls: 1000,
        timeout: 300000, // 5 minutes
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`],
      },
      createdAt: new Date(),
    };

    // Create nuclei scan job immediately (don't wait for crawl)
    // 🎯 REGULAR TEMPLATES (CVEs, vulns, misconfigs, exposures - NO FUZZING)
    const targetsKey = storage.generateKey(
      programId,
      'nuclei',
      `targets_fingerprint_${Date.now()}.txt`
    );
    const targetsS3Uri = await storage.uploadText(targetsKey, scanUrls.join('\n'));

    const scannerJobId = uuidv4();
    const scannerJob: ScannerJob = {
      id: scannerJobId,
      type: 'scanner',
      programId,
      priority: 9, // Highest priority
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        inputUrlsFile: targetsS3Uri,
        templateSet: 'fast', // REGULAR TEMPLATES ONLY (excludes fuzzing/)
        tier: 'tier1',
        concurrency: 50, // Higher concurrency for speed
        interactshEnabled: true,
        fingerprintConditions: {},
        templates: [],
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`, 'post-fingerprint', 'regular-scan'],
      },
      createdAt: new Date(),
    };

    // Save jobs to database FIRST, then add to queue (prevent race condition)
    await Promise.all([
      this.saveJobToDatabase(crawlJob),
      this.saveJobToDatabase(scannerJob),
    ]);

    // Now add to queue after database save completes
    await Promise.all([
      queue.addJob('crawl', crawlJob),
      queue.addJob('scanner', scannerJob),
    ]);

    logger.info(
      { programId, crawlJobId, scannerJobId, crawlUrlCount: crawlUrls.length, scanUrlCount: scanUrls.length },
      '✅ Auto-triggered crawl AND nuclei scan jobs in parallel'
    );

    // 🎯 NEW: Trigger advanced systems for high-value targets
    await this.triggerAdvancedSystems(programId, assetsResult.rows, completedJobId);
  }

  /**
   * After crawling - trigger nuclei scanning on discovered endpoints
   */
  private async handleCrawlComplete(
    programId: string,
    completedJobId: string,
    result: any
  ): Promise<void> {
    // Get all crawled URLs from recent crawl jobs (using discovered_at)
    const urlsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type = 'url'
       AND discovered_at > NOW() - INTERVAL '15 minutes'
       LIMIT 1000`,
      [programId]
    );

    if (urlsResult.rows.length === 0) {
      logger.info({ programId }, 'No URLs found after crawl');
      return;
    }

    const urls = urlsResult.rows.map((row: any) => row.value);

    logger.info({ programId, urlCount: urls.length }, 'Triggering nuclei scan for crawled endpoints');

    // Save URLs to S3
    const targetsKey = storage.generateKey(
      programId,
      'nuclei',
      `targets_${Date.now()}.txt`
    );
    const targetsS3Uri = await storage.uploadText(targetsKey, urls.join('\n'));

    const scannerJobId = uuidv4();
    const scannerJob: ScannerJob = {
      id: scannerJobId,
      type: 'scanner',
      programId,
      priority: 9, // Highest priority
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        inputUrlsFile: targetsS3Uri,
        templateSet: 'fast', // Use fast templates: CVEs, vulnerabilities, misconfigurations, exposures
        tier: 'tier1',
        concurrency: 500,
        interactshEnabled: true,
        fingerprintConditions: {},
        templates: [],
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`, 'post-crawl', 'fuzzing-scan'],
      },
      createdAt: new Date(),
    };

    // Save to database FIRST, then add to queue (prevent race condition)
    await this.saveJobToDatabase(scannerJob);
    await queue.addJob('scanner', scannerJob);

    logger.info(
      { programId, scannerJobId, urlCount: urls.length },
      '✅ Auto-triggered nuclei scanner job'
    );
  }

  /**
   * Helper: Determine if hostname is internal infrastructure
   */
  private isInternalInfrastructure(hostname: string): boolean {
    const lower = hostname.toLowerCase();

    // Internal .net domains (infrastructure)
    if (lower.endsWith('.spotify.net') || lower.endsWith('.soundtrap.net')) {
      return true;
    }

    // Datacenter patterns (ash1, sjc1, lon3, sto3, guc, etc.)
    if (/\b(ash|sjc|lon|sto|guc|iad|dfw|atl|ord|sea)\d+[-.]/.test(lower)) {
      return true;
    }

    // Database/infrastructure services
    if (/(cassandra|redis|mongo|postgres|mysql|kafka|zookeeper|elasticsearch|memcache|rabbitmq)/.test(lower)) {
      return true;
    }

    // Internal test/dev environments
    if (/(\.dev\.soundtrap\.|alumni\.dev\.|www-test\.|antivirus-|antivirus\.|_dmarc\.|_domainkey\.)/.test(lower)) {
      return true;
    }

    // Infrastructure/internal patterns
    if (/(linkap|vmdtranscoding|silocassandra|pushntfy|prexcass|-origin\.|staging\.|stage\.)/.test(lower)) {
      return true;
    }

    return false;
  }

  /**
   * Trigger DNSx fingerprinting for external hostnames (extracted from Naabu results)
   */
  private async triggerDnsxForHostnames(
    programId: string,
    hostnamePortPairs: string[],
    parentJobId: string
  ): Promise<void> {
    // Extract unique hostnames (without ports)
    const hostnames = [...new Set(hostnamePortPairs.map(hp => hp.split(':')[0]))];

    // Batch DNSx jobs (1000 hostnames per batch)
    const BATCH_SIZE = 1000;
    const batches: string[][] = [];

    for (let i = 0; i < hostnames.length; i += BATCH_SIZE) {
      batches.push(hostnames.slice(i, i + BATCH_SIZE));
    }

    const dnsxJobs: FingerprintJob[] = [];
    for (const batch of batches) {
      const jobId = uuidv4();
      dnsxJobs.push({
        id: jobId,
        type: 'fingerprint',
        programId,
        priority: 8,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          assets: batch,
          tools: ['dnsx'], // DNS validation only
          concurrency: 50,
          followRedirects: true,
        },
        metadata: {
          requestedBy: 'auto-orchestrator',
          tags: ['auto-triggered', `parent-job-${parentJobId}`, 'dnsx-only', 'external-hostnames'],
        },
        createdAt: new Date(),
      });
    }

    // Save and queue all DNSx jobs
    const savePromises = [];
    for (const job of dnsxJobs) {
      savePromises.push(queue.addJob('fingerprint', job), this.saveJobToDatabase(job));
    }
    await Promise.all(savePromises);

    logger.info(
      { programId, hostnameCount: hostnames.length, batches: batches.length },
      '🌐 Triggered DNSx for external hostnames from Naabu'
    );
  }

  /**
   * Trigger Infrastructure Nuclei for internal hostnames
   */
  private async triggerInfrastructureNucleiForHostnames(
    programId: string,
    hostnamePortPairs: string[],
    parentJobId: string
  ): Promise<void> {
    // Map hostname:port to protocol URLs for infrastructure scanning
    const targets: string[] = [];

    for (const hostPort of hostnamePortPairs) {
      const port = parseInt(hostPort.split(':')[1]);

      // Skip HTTP ports (won't be scanned by infrastructure templates anyway)
      if ([80, 443, 8080, 8443].includes(port)) {
        continue;
      }

      // Map to protocol-specific targets
      if ([22].includes(port)) {
        targets.push(`ssh://${hostPort}`);
      } else if ([21, 2121].includes(port)) {
        targets.push(`ftp://${hostPort}`);
      } else if ([3389].includes(port)) {
        targets.push(`rdp://${hostPort}`);
      } else if ([445, 139].includes(port)) {
        targets.push(`smb://${hostPort}`);
      } else if ([3306].includes(port)) {
        targets.push(`mysql://${hostPort}`);
      } else if ([5432].includes(port)) {
        targets.push(`postgresql://${hostPort}`);
      } else if ([27017].includes(port)) {
        targets.push(`mongodb://${hostPort}`);
      } else if ([6379].includes(port)) {
        targets.push(`redis://${hostPort}`);
      } else if ([9042].includes(port)) {
        targets.push(`cassandra://${hostPort}`);
      } else if ([11211].includes(port)) {
        targets.push(`memcached://${hostPort}`);
      } else if ([23].includes(port)) {
        targets.push(`telnet://${hostPort}`);
      } else if ([5900].includes(port)) {
        targets.push(`vnc://${hostPort}`);
      } else {
        // Generic TCP target for unknown ports
        targets.push(`tcp://${hostPort}`);
      }
    }

    if (targets.length === 0) {
      logger.info({ programId }, 'No infrastructure ports found in internal hostnames');
      return;
    }

    // Save targets to S3
    const targetsKey = storage.generateKey(
      programId,
      'nuclei',
      `targets_internal_infra_${Date.now()}.txt`
    );
    const targetsS3Uri = await storage.uploadText(targetsKey, targets.join('\n'));

    const scannerJobId = uuidv4();
    const scannerJob: ScannerJob = {
      id: scannerJobId,
      type: 'scanner',
      programId,
      priority: 9, // High priority - internal infra = high finding rate
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        inputUrlsFile: targetsS3Uri,
        templateSet: 'infrastructure', // Network protocol templates for infrastructure
        tier: 'tier1',
        concurrency: 50,
        interactshEnabled: false,
        fingerprintConditions: {},
        templates: [],
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${parentJobId}`, 'internal-infrastructure-scan'],
      },
      createdAt: new Date(),
    };

    // Save to database FIRST, then add to queue (prevent race condition)
    await this.saveJobToDatabase(scannerJob);
    await queue.addJob('scanner', scannerJob);

    logger.info(
      { programId, scannerJobId, targetCount: targets.length },
      '🔧 Triggered Infrastructure Nuclei for INTERNAL hostnames (high critical finding rate expected)'
    );
  }

  /**
   * After Naabu port scan - split hostnames vs IPs, classify internal/external, route accordingly
   */
  private async handlePortScanComplete(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Check if this was a Masscan job (to prevent recursive Masscan triggering)
    const jobResult = await database.query(
      `SELECT metadata FROM jobs WHERE id = $1`,
      [completedJobId]
    );

    const jobMetadata = jobResult.rows.length > 0
      ? (typeof jobResult.rows[0].metadata === 'string'
          ? JSON.parse(jobResult.rows[0].metadata)
          : jobResult.rows[0].metadata || {})
      : {};

    const tags = jobMetadata.tags || [];
    const isMasscanJob = tags.includes('masscan-deep-scan');

    // Get recently discovered ports (format: host:port or ip:port)
    const portsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type = 'port'
       AND discovered_at > NOW() - INTERVAL '10 minutes'
       LIMIT 5000`,
      [programId]
    );

    if (portsResult.rows.length === 0) {
      logger.info({ programId }, 'No ports found after port scan');
      return;
    }

    // 🔥 If this was a Masscan job, just trigger infrastructure Nuclei and return
    // (Don't recursively trigger another Masscan)
    if (isMasscanJob) {
      const ipPortPairs = portsResult.rows.map((row: any) => row.value);
      await this.triggerInfrastructureNuclei(programId, ipPortPairs, completedJobId);
      logger.info(
        { programId, portCount: ipPortPairs.length },
        '🔥 Masscan completed → triggered infrastructure Nuclei for IP ports'
      );
      return;
    }

    // 🎯 STEP 1: Split hostname:port vs ip:port
    const hostnamePortPairs: string[] = []; // e.g., "api.example.com:443"
    const ipPortPairs: string[] = [];       // e.g., "192.168.1.1:8080"
    const uniqueIPs: Set<string> = new Set(); // Unique IPs for Masscan

    for (const row of portsResult.rows) {
      const value = row.value; // Format: "host:port" or "ip:port"

      // Check if target is raw IP (e.g., "192.168.1.1:8080")
      const isIP = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(value);

      if (isIP) {
        ipPortPairs.push(value);
        const ip = value.split(':')[0];
        uniqueIPs.add(ip);
      } else {
        hostnamePortPairs.push(value);
      }
    }

    logger.info(
      { programId, totalPorts: portsResult.rows.length, hostnameCount: hostnamePortPairs.length, ipCount: ipPortPairs.length },
      '🎯 Split Naabu results: hostnames vs IPs'
    );

    // 🎯 STEP 2: Classify hostname:port pairs as internal vs external
    const externalHostnamePorts: string[] = [];
    const internalHostnamePorts: string[] = [];

    for (const hostPort of hostnamePortPairs) {
      const hostname = hostPort.split(':')[0];
      if (this.isInternalInfrastructure(hostname)) {
        internalHostnamePorts.push(hostPort);
      } else {
        externalHostnamePorts.push(hostPort);
      }
    }

    logger.info(
      {
        programId,
        externalCount: externalHostnamePorts.length,
        internalCount: internalHostnamePorts.length,
        ipPairCount: ipPortPairs.length,
      },
      '📊 Classification: external hostnames, internal hostnames, IP pairs'
    );

    // 🌐 PATH 1: EXTERNAL HOSTNAMES → DNSx → HTTPx → Crawl + Nuclei
    if (externalHostnamePorts.length > 0) {
      await this.triggerDnsxForHostnames(programId, externalHostnamePorts, completedJobId);
    }

    // 🔧 PATH 2: INTERNAL HOSTNAMES → Infrastructure Nuclei
    if (internalHostnamePorts.length > 0) {
      await this.triggerInfrastructureNucleiForHostnames(programId, internalHostnamePorts, completedJobId);
    }

    // 🔥 PATH 3: IPs → Masscan (deep scan) → Infrastructure Nuclei
    if (uniqueIPs.size > 0) {
      await this.triggerMasscanDeepScan(programId, Array.from(uniqueIPs), completedJobId);
    }

    logger.info(
      { programId, externalPaths: externalHostnamePorts.length, internalPaths: internalHostnamePorts.length, ipPaths: uniqueIPs.size },
      '✅ Routed Naabu results: external→DNSx, internal→InfraNuclei, IPs→Masscan'
    );
  }

  /**
   * Trigger Masscan deep scan on IP targets (all 65K ports)
   */
  private async triggerMasscanDeepScan(
    programId: string,
    ipTargets: string[],
    parentJobId: string
  ): Promise<void> {
    const portScanJobId = uuidv4();
    const portScanJob: PortScanJob = {
      id: portScanJobId,
      type: 'portscan',
      programId,
      priority: 7,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        targets: [...new Set(ipTargets)], // Unique IPs only
        ports: '1-65535', // 🔥 ALL PORTS (deep scan)
        rate: 10000, // 10K packets/sec for Masscan
        timeout: 600000, // 10 minutes for deep scan
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${parentJobId}`, 'masscan-deep-scan', 'ip-targets-only', 'force-masscan'],
      },
      createdAt: new Date(),
    };

    await queue.addJob('portscan', portScanJob);
    await this.saveJobToDatabase(portScanJob);

    logger.info(
      { programId, portScanJobId, ipCount: ipTargets.length },
      '🔥 Triggered Masscan deep scan (all 65K ports) for IP targets'
    );
  }

  /**
   * Trigger infrastructure Nuclei templates on ALL port targets (hostnames + IPs)
   */
  private async triggerInfrastructureNuclei(
    programId: string,
    portTargets: string[],
    parentJobId: string
  ): Promise<void> {
    // Convert port targets to protocol URLs
    // For non-HTTP ports, use appropriate protocol prefixes
    const targets: string[] = [];
    for (const target of portTargets) {
      const port = parseInt(target.split(':')[1]);

      // Determine protocol based on common port mappings
      if ([80, 443, 8080, 8443].includes(port)) {
        // HTTP(S) ports - handled by regular web scanning
        continue; // Skip, already handled by HTTPx path
      } else if ([22].includes(port)) {
        targets.push(`ssh://${target}`);
      } else if ([21, 2121].includes(port)) {
        targets.push(`ftp://${target}`);
      } else if ([3389].includes(port)) {
        targets.push(`rdp://${target}`);
      } else if ([445, 139].includes(port)) {
        targets.push(`smb://${target}`);
      } else if ([3306].includes(port)) {
        targets.push(`mysql://${target}`);
      } else if ([5432].includes(port)) {
        targets.push(`postgresql://${target}`);
      } else if ([27017].includes(port)) {
        targets.push(`mongodb://${target}`);
      } else if ([6379].includes(port)) {
        targets.push(`redis://${target}`);
      } else if ([11211].includes(port)) {
        targets.push(`memcached://${target}`);
      } else if ([23].includes(port)) {
        targets.push(`telnet://${target}`);
      } else if ([5900].includes(port)) {
        targets.push(`vnc://${target}`);
      } else {
        // Generic TCP target
        targets.push(`tcp://${target}`);
      }
    }

    if (targets.length === 0) {
      logger.info({ programId }, 'No infrastructure ports found for Nuclei scanning');
      return;
    }

    // Save targets to S3
    const targetsKey = storage.generateKey(
      programId,
      'nuclei',
      `targets_infrastructure_${Date.now()}.txt`
    );
    const targetsS3Uri = await storage.uploadText(targetsKey, targets.join('\n'));

    const scannerJobId = uuidv4();
    const scannerJob: ScannerJob = {
      id: scannerJobId,
      type: 'scanner',
      programId,
      priority: 8,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        inputUrlsFile: targetsS3Uri,
        templateSet: 'custom', // 🔧 INFRASTRUCTURE TEMPLATES (SSH, SMB, FTP, RDP, DBs)
        tier: 'tier1',
        concurrency: 50,
        interactshEnabled: false, // Infrastructure scanning doesn't use interactsh
        fingerprintConditions: {},
        templates: [],
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${parentJobId}`, 'infrastructure-scan'],
      },
      createdAt: new Date(),
    };

    // Save to database FIRST, then add to queue (prevent race condition)
    await this.saveJobToDatabase(scannerJob);
    await queue.addJob('scanner', scannerJob);

    logger.info(
      { programId, scannerJobId, targetCount: targets.length },
      '🔧 Triggered infrastructure Nuclei scan (SSH, SMB, FTP, RDP, DBs)'
    );
  }

  /**
   * Trigger nuclei scan on any available URLs (runs independently)
   */
  private async triggerNucleiOnUrls(programId: string): Promise<void> {
    try {
      // Get any URLs that haven't been scanned recently
      const urlsResult = await database.query(
        `SELECT DISTINCT value FROM assets
         WHERE program_id = $1
         AND type = 'url'
         AND discovered_at > NOW() - INTERVAL '1 hour'
         AND (metadata->>'last_scanned' IS NULL OR 
              (metadata->>'last_scanned')::timestamp < NOW() - INTERVAL '24 hours'))
         LIMIT 1000`,
        [programId]
      );

      if (urlsResult.rows.length === 0) {
        return;
      }

      const urls = urlsResult.rows.map((row: any) => row.value);

      // Save URLs to S3
      const targetsKey = storage.generateKey(
        programId,
        'nuclei',
        `targets_auto_${Date.now()}.txt`
      );
      const targetsS3Uri = await storage.uploadText(targetsKey, urls.join('\n'));

      const scannerJobId = uuidv4();
      const scannerJob: ScannerJob = {
        id: scannerJobId,
        type: 'scanner',
        programId,
        priority: 8,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          inputUrlsFile: targetsS3Uri,
          templateSet: 'fast',
          tier: 'tier1',
          concurrency: 50,
          interactshEnabled: true,
        },
        metadata: {
          requestedBy: 'auto-orchestrator',
          tags: ['auto-triggered', 'independent-scan'],
        },
        createdAt: new Date(),
      };

      // Save to database FIRST, then add to queue (prevent race condition)
      await this.saveJobToDatabase(scannerJob);
      await queue.addJob('scanner', scannerJob);

      logger.info({ programId, scannerJobId, urlCount: urls.length }, '✅ Triggered independent nuclei scan');
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to trigger independent nuclei scan');
    }
  }

  /**
   * 🎯 Trigger advanced systems (three-agent orchestrator + workflows)
   * Called after fingerprinting to deploy sophisticated testing
   */
  private async triggerAdvancedSystems(
    programId: string,
    assets: any[],
    parentJobId: string
  ): Promise<void> {
    try {
      // Analyze assets to identify high-value targets
      const highValueTargets: string[] = [];
      const technologies = new Set<string>();
      let hasWordPress = false;
      let hasJoomla = false;
      let hasAPIs = false;

      for (const asset of assets) {
        const metadata = asset.metadata || {};
        const value = asset.value;

        // Collect technologies
        if (metadata.technologies) {
          const techs = Array.isArray(metadata.technologies)
            ? metadata.technologies
            : [metadata.technologies];
          techs.forEach((t: string) => technologies.add(t));
        }

        // Detect interesting patterns
        if (metadata.technologies) {
          const techList = JSON.stringify(metadata.technologies).toLowerCase();
          if (techList.includes('wordpress')) hasWordPress = true;
          if (techList.includes('joomla')) hasJoomla = true;
          if (techList.includes('api') || techList.includes('rest') || techList.includes('graphql')) {
            hasAPIs = true;
          }
        }

        // High-value target criteria
        const isHighValue =
          metadata.httpStatus >= 200 && metadata.httpStatus < 400 &&
          (metadata.technologies?.length > 3 || // Rich tech stack
           metadata.title?.toLowerCase().includes('admin') || // Admin panels
           metadata.title?.toLowerCase().includes('login') || // Login pages
           value.includes('api.') || // API subdomains
           value.includes('admin.') || // Admin subdomains
           hasWordPress || hasJoomla || hasAPIs);

        if (isHighValue) {
          // Strip existing protocol from value to avoid double protocol prefix
          const cleanValue = value.replace(/^https?:\/\//, '');
          const protocol = metadata.httpStatus >= 200 && metadata.httpStatus < 400 ? 'https' : 'http';
          highValueTargets.push(`${protocol}://${cleanValue}`);
        }
      }

      logger.info({
        programId,
        totalAssets: assets.length,
        highValueTargets: highValueTargets.length,
        technologies: Array.from(technologies),
        hasWordPress,
        hasJoomla,
        hasAPIs,
      }, 'Analyzed assets for advanced systems triggering');

      // 1️⃣ Trigger Three-Agent Orchestrator for comprehensive testing
      if (highValueTargets.length >= 5 && highValueTargets.length <= 50) {
        logger.info(
          { programId, targetCount: highValueTargets.length },
          '🚀 Triggering three-agent orchestrator for high-value targets'
        );

        try {
          // Create three-agent job
          const threeAgentJobId = uuidv4();
          const threeAgentJob: ThreeAgentJob = {
            id: threeAgentJobId,
            type: 'three-agent',
            programId,
            priority: 8,
            status: 'pending',
            attempts: 0,
            maxAttempts: 2,
            options: {
              scope: {
                targets: highValueTargets,
                constraints: {
                  noDoS: true,
                  rateLimit: 50,
                },
              },
              objectives: [
                'Comprehensive vulnerability assessment',
                'Attack chain discovery',
                'Multi-reviewer validation',
              ],
              maxDuration: 3600000, // 1 hour
              swarmSize: Math.min(highValueTargets.length * 2, 100),
              autonomyLevel: 'high',
            },
            metadata: {
              requestedBy: 'auto-orchestrator',
              tags: ['auto-triggered', `parent-job-${parentJobId}`, 'advanced-testing', 'triggered-by:fingerprint-complete'],
            },
            createdAt: new Date(),
          };

          // Queue the three-agent job
          await Promise.all([
            queue.addJob('three-agent', threeAgentJob),
            this.saveJobToDatabase(threeAgentJob),
          ]);

          logger.info(
            { programId, threeAgentJobId, targetCount: highValueTargets.length },
            '✅ Three-agent orchestrator job queued'
          );
        } catch (error: any) {
          logger.error({ error, programId }, 'Failed to trigger three-agent orchestrator');
        }
      }

      // 2️⃣ Trigger Workflow Engine for declarative workflows
      try {
        // Get program details for workflow context
        const programResult = await database.query(
          'SELECT * FROM programs WHERE id = $1',
          [programId]
        );

        if (programResult.rows.length > 0) {
          const program = programResult.rows[0];

          // Trigger vulnerability-scanning workflow
          const workflowContext = {
            programId,
            programName: program.name,
            targets: highValueTargets.length > 0 ? highValueTargets : assets.map((a: any) => a.value).slice(0, 20),
            technologies: Array.from(technologies),
            assetCount: assets.length,
            triggeredBy: 'auto-orchestrator-fingerprint-complete',
          };

          logger.info(
            { programId, workflow: 'vulnerability-scanning', targetCount: workflowContext.targets.length },
            '🔄 Triggering workflow engine'
          );

          // Execute vulnerability scanning workflow
          await workflowEngine.executeWorkflow('vulnerability-scanning', workflowContext);

          logger.info({ programId }, '✅ Vulnerability-scanning workflow triggered');
        }
      } catch (error: any) {
        logger.error({ error, programId }, 'Failed to trigger workflow engine');
      }
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to trigger advanced systems');
    }
  }

  /**
   * Save job to database
   */
  private async saveJobToDatabase(job: any): Promise<void> {
    try {
      logger.info({ jobId: job.id, type: job.type }, 'Saving job to database...');
      const result = await database.query(
        `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          job.id,
          job.type,
          job.programId,
          job.priority,
          job.status,
          job.attempts,
          job.maxAttempts,
          JSON.stringify(job.options || {}),
          JSON.stringify(job.metadata),
          job.createdAt,
        ]
      );
      logger.info({ jobId: job.id, type: job.type, inserted: result.rowCount }, 'Job saved to database');
    } catch (error: any) {
      logger.error({ jobId: job.id, type: job.type, error: error.message }, 'Failed to save job to database');
      throw error;
    }
  }
}

export default new AutoOrchestratorService();
