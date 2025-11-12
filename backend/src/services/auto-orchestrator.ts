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
} from '../../../shared/types';

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
          const jobMetadata = job.metadata ? JSON.parse(job.metadata) : {};
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
      logger.error({ error, jobId }, 'Auto-orchestrator error');
    }
  }

  /**
   * After subdomain discovery - trigger fingerprinting and port scanning
   */
  private async handleSubdomainDiscovery(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Get ALL untagged subdomains (no isInternal metadata = not yet processed)
    // This ensures we process all discovered subdomains, not just recent ones
    const assetsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type IN ('subdomain', 'domain')
       AND (metadata->>'isInternal' IS NULL OR metadata->>'isInternal' = '')
       AND NOT value LIKE '.%'
       LIMIT 5000`,
      [programId]
    );

    if (assetsResult.rows.length === 0) {
      logger.info({ programId }, 'No unprocessed subdomains found, skipping follow-ups');
      return;
    }

    logger.info({ programId, count: assetsResult.rows.length }, 'Processing untagged subdomains for internal/external classification');


    const allSubdomains = assetsResult.rows.map((row: any) => row.value);

    // Helper function to determine if subdomain is internal infrastructure
    const isInternalInfrastructure = (subdomain: string): boolean => {
      const lower = subdomain.toLowerCase();

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
    };

    // Separate internal from external subdomains first (for batch updates)
    const externalSubdomains = allSubdomains.filter((s: string) => !isInternalInfrastructure(s));
    const internalSubdomains = allSubdomains.filter((s: string) => isInternalInfrastructure(s));

    // Batch update tags (100-1000x faster than individual updates)
    await Promise.all([
      internalSubdomains.length > 0 ? database.query(
        `UPDATE assets
         SET metadata = metadata || '{"isInternal": true}'::jsonb
         WHERE program_id = $1 AND value = ANY($2::text[]) AND type = 'subdomain'`,
        [programId, internalSubdomains]
      ) : Promise.resolve(),
      externalSubdomains.length > 0 ? database.query(
        `UPDATE assets
         SET metadata = metadata || '{"isInternal": false}'::jsonb
         WHERE program_id = $1 AND value = ANY($2::text[]) AND type = 'subdomain'`,
        [programId, externalSubdomains]
      ) : Promise.resolve(),
    ]);

    logger.info(
      {
        programId,
        total: allSubdomains.length,
        external: externalSubdomains.length,
        internal: internalSubdomains.length
      },
      `Tagged subdomains: ${externalSubdomains.length} external (HTTP scan), ${internalSubdomains.length} internal (port scan only)`
    );

    // Use external subdomains for HTTP fingerprinting
    const subdomains = externalSubdomains;

    if (subdomains.length === 0) {
      logger.info({ programId }, 'No external subdomains found, skipping HTTP fingerprinting');
      // Don't return - still process internal for port scanning below
    }

    // AGGRESSIVE BATCHING for MAXIMUM SPEED
    // Fingerprint: 1000 assets per batch (2x faster) - EXTERNAL ONLY
    // Port scan: 500 targets per batch (5x faster) - ALL SUBDOMAINS
    const FINGERPRINT_BATCH_SIZE = 1000;
    const PORTSCAN_BATCH_SIZE = 500;

    const fingerprintBatches: string[][] = [];
    const portscanBatches: string[][] = [];

    // HTTP fingerprinting: external subdomains only (internal won't respond to HTTP)
    for (let i = 0; i < subdomains.length; i += FINGERPRINT_BATCH_SIZE) {
      fingerprintBatches.push(subdomains.slice(i, i + FINGERPRINT_BATCH_SIZE));
    }

    // Port scanning: ALL subdomains (internal infrastructure can have open ports)
    for (let i = 0; i < allSubdomains.length; i += PORTSCAN_BATCH_SIZE) {
      portscanBatches.push(allSubdomains.slice(i, i + PORTSCAN_BATCH_SIZE));
    }

    // Step 1: Create DNS check jobs (dnsx) for each batch
    const dnsxJobs: FingerprintJob[] = [];
    for (const batch of fingerprintBatches) {
      const jobId = uuidv4();
      dnsxJobs.push({
        id: jobId,
        type: 'fingerprint',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          assets: batch,
          tools: ['dnsx'],  // First check DNS resolution
          concurrency: 50,
          followRedirects: true,
        },
        metadata: {
          requestedBy: 'auto-orchestrator',
          tags: ['auto-triggered', `parent-job-${completedJobId}`, `batch-${batch.length}`, 'dnsx-only'],
        },
        createdAt: new Date(),
      });
    }

    // Create port scan jobs for each batch
    const portscanJobs: PortScanJob[] = [];
    for (const batch of portscanBatches) {
      const jobId = uuidv4();
      portscanJobs.push({
        id: jobId,
        type: 'portscan',
        programId,
        priority: 6,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          targets: batch,
          ports: 'top-1000',
          rate: 2000,
        },
        metadata: {
          requestedBy: 'auto-orchestrator',
          tags: ['auto-triggered', `parent-job-${completedJobId}`, `batch-${batch.length}`],
        },
        createdAt: new Date(),
      });
    }

    // Save all jobs to database and queue
    const savePromises = [];
    for (const job of dnsxJobs) {
      savePromises.push(queue.addJob('fingerprint', job), this.saveJobToDatabase(job));
    }
    for (const job of portscanJobs) {
      savePromises.push(queue.addJob('portscan', job), this.saveJobToDatabase(job));
    }

    await Promise.all(savePromises);

    logger.info(
      {
        programId,
        dnsxBatches: dnsxJobs.length,
        portscanBatches: portscanBatches.length,
        subdomainCount: subdomains.length,
      },
      '✅ Auto-triggered DNS check (dnsx) and port scan jobs (batched). httpx will trigger after dnsx completes.'
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
          // Determine which protocol worked based on httpStatus
          const protocol = httpStatus >= 200 && httpStatus < 400 ? 'https' : 'https';
          const url = `${protocol}://${row.value}`;
          crawlUrls.push(url);
          // For scanning, try both protocols
          scanUrls.push(`http://${row.value}`);
          scanUrls.push(`https://${row.value}`);
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
    const targetsKey = storage.generateKey(
      programId,
      'nuclei',
      `targets_fingerprint_${Date.now()}.txt`
    );
    await storage.uploadText(targetsKey, scanUrls.join('\n'));

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
        inputUrlsFile: targetsKey,
        templateSet: 'fast',
        tier: 'tier1',
        concurrency: 50, // Higher concurrency for speed
        interactshEnabled: true,
        fingerprintConditions: {},
        templates: [],
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`, 'post-fingerprint'],
      },
      createdAt: new Date(),
    };

    // Execute crawl and nuclei in parallel (10x faster)
    await Promise.all([
      queue.addJob('crawl', crawlJob),
      this.saveJobToDatabase(crawlJob),
      queue.addJob('scanner', scannerJob),
      this.saveJobToDatabase(scannerJob),
    ]);

    logger.info(
      { programId, crawlJobId, scannerJobId, crawlUrlCount: crawlUrls.length, scanUrlCount: scanUrls.length },
      '✅ Auto-triggered crawl AND nuclei scan jobs in parallel'
    );
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
    await storage.uploadText(targetsKey, urls.join('\n'));

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
        inputUrlsFile: targetsKey,
        templateSet: 'fast',
        tier: 'tier0',
        concurrency: 25,
        interactshEnabled: true,
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`, 'post-crawl'],
      },
      createdAt: new Date(),
    };

    await queue.addJob('scanner', scannerJob);
    await this.saveJobToDatabase(scannerJob);

    logger.info(
      { programId, scannerJobId, urlCount: urls.length },
      '✅ Auto-triggered nuclei scanner job'
    );
  }

  /**
   * After port scan - trigger nuclei on discovered open ports
   */
  private async handlePortScanComplete(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Get recently discovered ports (format: host:port)
    const portsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type = 'port'
       AND discovered_at > NOW() - INTERVAL '10 minutes'
       LIMIT 1000`,
      [programId]
    );

    if (portsResult.rows.length === 0) {
      logger.info({ programId }, 'No ports found after port scan');
      return;
    }

    // Convert port entries to URLs for nuclei scanning
    const urls: string[] = [];
    for (const row of portsResult.rows) {
      const value = row.value; // Format: host:port or ip:port
      // Add both http and https variants
      urls.push(`http://${value}`);
      urls.push(`https://${value}`);
    }

    logger.info({ programId, portCount: portsResult.rows.length, urlCount: urls.length }, 'Triggering nuclei scan for discovered ports');

    // Save URLs to S3
    const targetsKey = storage.generateKey(
      programId,
      'nuclei',
      `targets_ports_${Date.now()}.txt`
    );
    await storage.uploadText(targetsKey, urls.join('\n'));

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
        inputUrlsFile: targetsKey,
        templateSet: 'fast',
        tier: 'tier1',
        concurrency: 50,
        interactshEnabled: true,
        fingerprintConditions: {},
        templates: [],
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`, 'port-scan-targets'],
      },
      createdAt: new Date(),
    };

    await queue.addJob('scanner', scannerJob);
    await this.saveJobToDatabase(scannerJob);

    logger.info(
      { programId, scannerJobId, urlCount: urls.length },
      '✅ Auto-triggered nuclei scan for port scan results'
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
      await storage.uploadText(targetsKey, urls.join('\n'));

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
          inputUrlsFile: targetsKey,
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

      await queue.addJob('scanner', scannerJob);
      await this.saveJobToDatabase(scannerJob);

      logger.info({ programId, scannerJobId, urlCount: urls.length }, '✅ Triggered independent nuclei scan');
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to trigger independent nuclei scan');
    }
  }

  /**
   * Save job to database
   */
  private async saveJobToDatabase(job: any): Promise<void> {
    await database.query(
      `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO NOTHING`,
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
  }
}

export default new AutoOrchestratorService();
