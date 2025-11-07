import { v4 as uuidv4 } from 'uuid';
import database from './database';
import queue from './queue';
import events from './events';
import logger from '../utils/logger';
import {
  BaseJob,
  DiscoveryJob,
  SubdomainJob,
  FingerprintJob,
  CrawlJob,
  ScannerJob,
  TriageJob,
} from '../../../shared/types';

/**
 * Orchestrator Service
 * Coordinates full reconnaissance pipeline from domains to findings
 */

export interface OrchestrationPlan {
  programId: string;
  domains: string[];
  subdomains: string[];
  ips: string[];
  urls: string[];
  config: OrchestrationConfig;
}

export interface OrchestrationConfig {
  runDiscovery: boolean;
  runSubdomainEnum: boolean;
  runFingerprinting: boolean;
  runPortScan: boolean;
  runCrawling: boolean;
  runScanning: boolean;
  runTriage: boolean;
  concurrency: number;
  maxAssets: number;
  priority: number;
}

export interface OrchestrationResult {
  orchestrationId: string;
  programId: string;
  jobs: Array<{
    id: string;
    type: string;
    status: string;
  }>;
  estimatedDuration: number;
}

class OrchestratorService {
  /**
   * Start full reconnaissance pipeline
   */
  async orchestrate(plan: OrchestrationPlan): Promise<OrchestrationResult> {
    const orchestrationId = uuidv4();

    logger.info(
      {
        orchestrationId,
        programId: plan.programId,
        domainsCount: plan.domains.length,
        subdomainsCount: plan.subdomains.length,
      },
      'Starting orchestration'
    );

    const jobs: Array<{ id: string; type: string; status: string }> = [];

    try {
      // Phase 1: Discovery (find more subdomains from domains)
      if (plan.config.runDiscovery && plan.domains.length > 0) {
        const discoveryJobs = await this.createDiscoveryJobs(
          plan.programId,
          plan.domains,
          plan.config,
          orchestrationId
        );
        jobs.push(...discoveryJobs);
      }

      // Phase 2: Subdomain Enumeration (if we have subdomains already or from user upload)
      if (plan.config.runSubdomainEnum && plan.domains.length > 0) {
        const subdomainJobs = await this.createSubdomainJobs(
          plan.programId,
          plan.domains,
          plan.config,
          orchestrationId
        );
        jobs.push(...subdomainJobs);
      }

      // Phase 3: Fingerprinting (probe all subdomains)
      if (plan.config.runFingerprinting) {
        const allTargets = [...plan.subdomains, ...plan.domains];
        if (allTargets.length > 0) {
          const fingerprintJobs = await this.createFingerprintJobs(
            plan.programId,
            allTargets,
            plan.config,
            orchestrationId
          );
          jobs.push(...fingerprintJobs);
        }
      }

      // Phase 4: Port Scanning (naabu)
      if (plan.config.runPortScan) {
        const scanTargets = [...plan.subdomains, ...plan.domains, ...plan.ips];
        if (scanTargets.length > 0) {
          const portScanJobs = await this.createPortScanJobs(
            plan.programId,
            scanTargets,
            plan.config,
            orchestrationId
          );
          jobs.push(...portScanJobs);
        }
      }

      // Phase 5: Crawling (discover endpoints)
      if (plan.config.runCrawling) {
        const crawlTargets = plan.urls.length > 0 ? plan.urls : this.generateInitialUrls(plan.subdomains, plan.domains);
        if (crawlTargets.length > 0) {
          const crawlJobs = await this.createCrawlJobs(
            plan.programId,
            crawlTargets,
            plan.config,
            orchestrationId
          );
          jobs.push(...crawlJobs);
        }
      }

      // Phase 6: Scanning (nuclei)
      if (plan.config.runScanning) {
        // Scanning will be triggered automatically after crawling completes
        // But we can create a placeholder job
        const scanJobs = await this.createScanJobPlaceholder(
          plan.programId,
          plan.config,
          orchestrationId
        );
        jobs.push(...scanJobs);
      }

      // Emit orchestration started event
      await events.emitLog({
        jobId: orchestrationId,
        programId: plan.programId,
        workerId: 'orchestrator',
        tool: 'orchestrator',
        context: 'start',
        level: 'info',
        message: `Orchestration started: ${jobs.length} jobs created`,
      });

      const estimatedDuration = this.calculateEstimatedDuration(jobs);

      return {
        orchestrationId,
        programId: plan.programId,
        jobs,
        estimatedDuration,
      };
    } catch (error: any) {
      logger.error({ error, orchestrationId }, 'Orchestration failed');
      throw error;
    }
  }

  /**
   * Create discovery jobs
   */
  private async createDiscoveryJobs(
    programId: string,
    domains: string[],
    config: OrchestrationConfig,
    orchestrationId: string
  ): Promise<Array<{ id: string; type: string; status: string }>> {
    const jobs: Array<{ id: string; type: string; status: string }> = [];

    // Create one discovery job for all domains
    const jobId = uuidv4();

    const discoveryJob: DiscoveryJob = {
      id: jobId,
      type: 'discovery',
      programId,
      priority: config.priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        sources: ['chaosdb', 'subfinder', 'uncover'],
        maxAssets: config.maxAssets,
        timeout: 600000, // 10 minutes
      },
      metadata: {
        requestedBy: 'orchestrator',
        tags: ['orchestration', orchestrationId],
      },
      createdAt: new Date(),
    };

    await queue.addJob('discovery', discoveryJob);
    await this.saveJobToDatabase(discoveryJob);

    jobs.push({ id: jobId, type: 'discovery', status: 'pending' });

    logger.info({ jobId, programId, orchestrationId }, 'Discovery job created');

    return jobs;
  }

  /**
   * Create subdomain enumeration jobs
   */
  private async createSubdomainJobs(
    programId: string,
    domains: string[],
    config: OrchestrationConfig,
    orchestrationId: string
  ): Promise<Array<{ id: string; type: string; status: string }>> {
    const jobs: Array<{ id: string; type: string; status: string }> = [];

    const jobId = uuidv4();

    const subdomainJob: SubdomainJob = {
      id: jobId,
      type: 'subdomain',
      programId,
      priority: config.priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        domains,
        tools: ['subfinder', 'amass'],
        maxResults: config.maxAssets,
      },
      metadata: {
        requestedBy: 'orchestrator',
        tags: ['orchestration', orchestrationId],
      },
      createdAt: new Date(),
    };

    await queue.addJob('subdomain', subdomainJob);
    await this.saveJobToDatabase(subdomainJob);

    jobs.push({ id: jobId, type: 'subdomain', status: 'pending' });

    logger.info({ jobId, programId, orchestrationId }, 'Subdomain job created');

    return jobs;
  }

  /**
   * Create fingerprinting jobs
   */
  private async createFingerprintJobs(
    programId: string,
    targets: string[],
    config: OrchestrationConfig,
    orchestrationId: string
  ): Promise<Array<{ id: string; type: string; status: string }>> {
    const jobs: Array<{ id: string; type: string; status: string }> = [];

    const jobId = uuidv4();

    const fingerprintJob: FingerprintJob = {
      id: jobId,
      type: 'fingerprint',
      programId,
      priority: config.priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        assets: targets,
        tools: ['httpx', 'tlsx'],
        concurrency: config.concurrency,
        followRedirects: true,
      },
      metadata: {
        requestedBy: 'orchestrator',
        tags: ['orchestration', orchestrationId],
      },
      createdAt: new Date(),
    };

    await queue.addJob('fingerprint', fingerprintJob);
    await this.saveJobToDatabase(fingerprintJob);

    jobs.push({ id: jobId, type: 'fingerprint', status: 'pending' });

    logger.info({ jobId, programId, orchestrationId, targetsCount: targets.length }, 'Fingerprint job created');

    return jobs;
  }

  /**
   * Create port scanning jobs
   */
  private async createPortScanJobs(
    programId: string,
    targets: string[],
    config: OrchestrationConfig,
    orchestrationId: string
  ): Promise<Array<{ id: string; type: string; status: string }>> {
    const jobs: Array<{ id: string; type: string; status: string }> = [];

    // Import portscan job type if needed
    const jobId = uuidv4();

    const portScanJob: BaseJob = {
      id: jobId,
      type: 'portscan' as any,
      programId,
      priority: config.priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      metadata: {
        requestedBy: 'orchestrator',
        tags: ['orchestration', orchestrationId],
      },
      createdAt: new Date(),
    };

    // Add to database only (queue might not have portscan worker yet)
    await this.saveJobToDatabase(portScanJob);

    jobs.push({ id: jobId, type: 'portscan', status: 'pending' });

    logger.info({ jobId, programId, orchestrationId, targetsCount: targets.length }, 'Port scan job created');

    return jobs;
  }

  /**
   * Create crawling jobs
   */
  private async createCrawlJobs(
    programId: string,
    urls: string[],
    config: OrchestrationConfig,
    orchestrationId: string
  ): Promise<Array<{ id: string; type: string; status: string }>> {
    const jobs: Array<{ id: string; type: string; status: string }> = [];

    const jobId = uuidv4();

    const crawlJob: CrawlJob = {
      id: jobId,
      type: 'crawl',
      programId,
      priority: config.priority,
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
        requestedBy: 'orchestrator',
        tags: ['orchestration', orchestrationId],
      },
      createdAt: new Date(),
    };

    await queue.addJob('crawl', crawlJob);
    await this.saveJobToDatabase(crawlJob);

    jobs.push({ id: jobId, type: 'crawl', status: 'pending' });

    logger.info({ jobId, programId, orchestrationId, urlsCount: urls.length }, 'Crawl job created');

    return jobs;
  }

  /**
   * Create scan job placeholder
   */
  private async createScanJobPlaceholder(
    programId: string,
    config: OrchestrationConfig,
    orchestrationId: string
  ): Promise<Array<{ id: string; type: string; status: string }>> {
    // Scanning will be triggered after crawl completes
    // This is just for reporting
    logger.info({ programId, orchestrationId }, 'Scanning will be triggered after crawl completes');
    return [];
  }

  /**
   * Generate initial URLs from domains/subdomains
   */
  private generateInitialUrls(subdomains: string[], domains: string[]): string[] {
    const allHosts = [...subdomains, ...domains];
    return allHosts.map(host => `https://${host}`);
  }

  /**
   * Save job to database
   */
  private async saveJobToDatabase(job: BaseJob): Promise<void> {
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
        JSON.stringify((job as any).options || {}),
        JSON.stringify(job.metadata),
        job.createdAt,
      ]
    );
  }

  /**
   * Calculate estimated duration
   */
  private calculateEstimatedDuration(jobs: Array<{ type: string }>): number {
    let totalMinutes = 0;

    for (const job of jobs) {
      switch (job.type) {
        case 'discovery':
          totalMinutes += 10;
          break;
        case 'subdomain':
          totalMinutes += 5;
          break;
        case 'fingerprint':
          totalMinutes += 15;
          break;
        case 'portscan':
          totalMinutes += 20;
          break;
        case 'crawl':
          totalMinutes += 10;
          break;
        case 'scanner':
          totalMinutes += 30;
          break;
      }
    }

    return totalMinutes * 60; // Convert to seconds
  }
}

export default new OrchestratorService();
