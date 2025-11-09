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
      // Get job details
      const jobResult = await database.query(
        `SELECT id, type, program_id, status, result FROM jobs WHERE id = $1`,
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
          await this.handleFingerprintComplete(job.program_id, jobId);
          break;

        case 'crawl':
          await this.handleCrawlComplete(job.program_id, jobId, job.result);
          break;

        case 'portscan':
          await this.handlePortScanComplete(job.program_id, jobId);
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
    // Get newly discovered subdomains
    const assetsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type IN ('subdomain', 'domain')
       AND discovered_at > NOW() - INTERVAL '10 minutes'
       ORDER BY discovered_at DESC
       LIMIT 100`,
      [programId]
    );

    if (assetsResult.rows.length === 0) {
      logger.info({ programId }, 'No new subdomains found, skipping follow-ups');
      return;
    }

    const subdomains = assetsResult.rows.map((row: any) => row.value);

    logger.info(
      { programId, count: subdomains.length },
      'Triggering fingerprint and port scan for new subdomains'
    );

    // Trigger fingerprinting
    const fingerprintJobId = uuidv4();
    const fingerprintJob: FingerprintJob = {
      id: fingerprintJobId,
      type: 'fingerprint',
      programId,
      priority: 7, // Higher priority for auto-triggered
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        assets: subdomains,
        tools: ['httpx', 'tlsx'],
        concurrency: 20,
        followRedirects: true,
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`],
      },
      createdAt: new Date(),
    };

    await queue.addJob('fingerprint', fingerprintJob);
    await this.saveJobToDatabase(fingerprintJob);

    // Trigger port scanning
    const portScanJobId = uuidv4();
    const portScanJob: PortScanJob = {
      id: portScanJobId,
      type: 'portscan',
      programId,
      priority: 6,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        targets: subdomains,
        ports: '1-10000',
        rate: 1000,
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`],
      },
      createdAt: new Date(),
    };

    await queue.addJob('portscan', portScanJob);
    await this.saveJobToDatabase(portScanJob);

    logger.info(
      {
        programId,
        fingerprintJobId,
        portScanJobId,
        subdomainCount: subdomains.length,
      },
      '✅ Auto-triggered fingerprint and port scan jobs'
    );
  }

  /**
   * After fingerprinting - trigger crawling on live hosts
   */
  private async handleFingerprintComplete(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Get URLs from fingerprinted assets (last 10 minutes)
    const urlsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type = 'url'
       AND discovered_at > NOW() - INTERVAL '10 minutes'
       ORDER BY discovered_at DESC
       LIMIT 200`,
      [programId]
    );

    if (urlsResult.rows.length === 0) {
      logger.info({ programId }, 'No URLs found after fingerprinting');
      return;
    }

    const urls = urlsResult.rows.map((row: any) => row.value);

    logger.info({ programId, urlCount: urls.length }, 'Triggering crawl for fingerprinted URLs');

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
        targetUrls: urls,
        depth: 3,
        respectRobots: true,
        maxUrls: 1000,
        timeout: 600000,
      },
      metadata: {
        requestedBy: 'auto-orchestrator',
        tags: ['auto-triggered', `parent-job-${completedJobId}`],
      },
      createdAt: new Date(),
    };

    await queue.addJob('crawl', crawlJob);
    await this.saveJobToDatabase(crawlJob);

    logger.info({ programId, crawlJobId }, '✅ Auto-triggered crawl job');
  }

  /**
   * After crawling - trigger nuclei scanning on discovered endpoints
   */
  private async handleCrawlComplete(
    programId: string,
    completedJobId: string,
    result: any
  ): Promise<void> {
    // Get all crawled URLs from recent crawl jobs
    const urlsResult = await database.query(
      `SELECT DISTINCT value FROM assets
       WHERE program_id = $1
       AND type = 'url'
       AND discovered_at > NOW() - INTERVAL '15 minutes'
       ORDER BY discovered_at DESC
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
   * After port scan - potentially trigger service-specific scans
   */
  private async handlePortScanComplete(
    programId: string,
    completedJobId: string
  ): Promise<void> {
    // Could trigger service-specific scans based on discovered ports
    logger.info({ programId, completedJobId }, 'Port scan completed');
    // Future: Add service-specific scanning based on open ports
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
