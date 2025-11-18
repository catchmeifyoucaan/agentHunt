import { Job } from 'bullmq';
import logger from '../utils/logger';
import queue from './queue';
import database from './database';
import storage from './storage';
import { BaseJob, AgentType, Asset, AssetMetadata } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

class Orchestrator {
  private static instance: Orchestrator;

  private constructor() {
    logger.info('Orchestrator service initialized');
  }

  public static getInstance(): Orchestrator {
    if (!Orchestrator.instance) {
      Orchestrator.instance = new Orchestrator();
    }
    return Orchestrator.instance;
  }

  /**
   * Persist job to database so it can be queried by the frontend
   */
  private async persistJobToDatabase(job: any): Promise<void> {
    try {
      // Extract parent_job_id from metadata if available
      const parentJobId = job.metadata?.parentJobId || job.metadata?.parent_job_id || null;

      await database.query(
        `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata, parent_job_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET
           parent_job_id = COALESCE(EXCLUDED.parent_job_id, jobs.parent_job_id)`,
        [
          job.id,
          job.type,
          job.programId,
          job.priority,
          job.status,
          job.attempts,
          job.maxAttempts,
          JSON.stringify(job.options || {}),
          JSON.stringify(job.metadata || {}),
          parentJobId,
        ]
      );
    } catch (error) {
      logger.error({ error, jobId: job.id }, 'Failed to persist job to database');
      // Don't throw - this shouldn't block job creation in queue
    }
  }

  /**
   * Create job in both queue and database
   */
  private async createJob(agentType: AgentType, job: any): Promise<void> {
    // Add to database first so it's immediately queryable
    await this.persistJobToDatabase(job);
    // Then add to queue for processing
    await queue.addJob(agentType, job);
  }

  /**
   * Orchestrate a full scan workflow starting from uploaded assets.
   * This kicks off the initial subdomain enumeration and fingerprinting jobs.
   */
  public async orchestrate(params: {
    programId: string;
    domains?: string[];
    subdomains?: string[];
    ips?: string[];
    urls?: string[];
    config: {
      aggressive: boolean;
      concurrency: number;
      maxAssets: number;
      priority: number;
    };
  }): Promise<{ jobsCreated: string[]; message: string }> {
    const { programId, domains = [], subdomains = [], ips = [], urls = [], config } = params;
    const jobsCreated: string[] = [];

    logger.info(
      { programId, domainCount: domains.length, subdomainCount: subdomains.length, ipCount: ips.length, urlCount: urls.length },
      'Starting orchestration workflow'
    );

    // 1. Trigger subdomain enumeration for domains
    if (domains.length > 0) {
      const subdomainJobId = uuidv4();
      await this.createJob('subdomain', {
        id: subdomainJobId,
        type: 'subdomain',
        programId,
        priority: config.priority,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          domains,
          tools: config.aggressive ? ['subfinder', 'amass', 'assetfinder'] : ['subfinder'],
          recursive: config.aggressive,
          maxDepth: config.aggressive ? 3 : 1,
        },
        metadata: {
          requestedBy: 'orchestrator-upload',
          tags: ['orchestrated', `domain-count-${domains.length}`],
        },
        createdAt: new Date(),
      });
      jobsCreated.push(subdomainJobId);
      logger.info({ subdomainJobId, domainCount: domains.length }, 'Subdomain enumeration job created');
    }

    // 2. Trigger fingerprinting for subdomains and IPs in batches
    const fingerprintAssets = [...subdomains, ...ips];
    if (fingerprintAssets.length > 0) {
      // Batch assets into chunks to process ALL uploaded assets
      const batchSize = 10000; // Process 10k assets per job
      const batches = [];
      for (let i = 0; i < fingerprintAssets.length; i += batchSize) {
        batches.push(fingerprintAssets.slice(i, i + batchSize));
      }

      logger.info(
        { totalAssets: fingerprintAssets.length, batches: batches.length, batchSize },
        'Creating batched fingerprint jobs for ALL uploaded assets'
      );

      // Create a fingerprint job for each batch
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const fingerprintJobId = uuidv4();
        await this.createJob('fingerprint', {
          id: fingerprintJobId,
          type: 'fingerprint',
          programId,
          priority: config.priority,
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          options: {
            assets: batch,
            tools: ['dnsx', 'httpx', 'tlsx'],
            concurrency: config.concurrency,
            followRedirects: true,
          },
          metadata: {
            requestedBy: 'orchestrator-upload',
            tags: ['orchestrated', `batch-${i + 1}-of-${batches.length}`, `asset-count-${batch.length}`],
          },
          createdAt: new Date(),
        });
        jobsCreated.push(fingerprintJobId);
        logger.info(
          { fingerprintJobId, batchNumber: i + 1, totalBatches: batches.length, assetCount: batch.length },
          'Fingerprint job created for batch'
        );
      }
    }

    // 3. Trigger scanner for URLs (if any)
    if (urls.length > 0) {
      // Save URLs to S3 for nuclei scanner
      const urlsContent = urls.join('\n');
      const s3Key = storage.generateKey(programId, 'orchestrator', `upload-urls-${Date.now()}.txt`);
      await storage.uploadText(s3Key, urlsContent);

      const scannerJobId = uuidv4();
      await this.createJob('scanner', {
        id: scannerJobId,
        type: 'scanner',
        programId,
        priority: config.priority,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          inputUrlsFile: s3Key,
          templateSet: config.aggressive ? 'comprehensive' : 'fast',
          tier: config.aggressive ? 'tier2' : 'tier1',
          concurrency: config.concurrency,
          interactshEnabled: true,
          fingerprintConditions: {},
          templates: [],
        },
        metadata: {
          requestedBy: 'orchestrator-upload',
          tags: ['orchestrated', `url-count-${urls.length}`],
        },
        createdAt: new Date(),
      });
      jobsCreated.push(scannerJobId);
      logger.info({ scannerJobId, urlCount: urls.length }, 'Scanner job created');
    }

    return {
      jobsCreated,
      message: `Orchestration started: ${jobsCreated.length} jobs created`,
    };
  }

  /**
   * Handles job completion events and triggers subsequent jobs based on predefined workflows.
   * This is the core of the reactive workflow system.
   */
  public async onJobComplete(completedJobId: string, agentType: AgentType, programId: string, results: any): Promise<void> {
    logger.info({ completedJobId, agentType, programId, results }, 'Orchestrator received job completion event');

    switch (agentType) {
      case 'subdomain':
        await this.handleSubdomainComplete(completedJobId, programId, results);
        break;
      case 'fingerprint':
        await this.handleFingerprintComplete(completedJobId, programId, results);
        break;
      case 'scanner':
        await this.handleScannerComplete(completedJobId, programId, results);
        break;
      // Add more cases for other agent types as workflows are defined
      default:
        logger.info({ agentType }, 'No specific orchestration rule for this agent type');
        break;
    }
  }

  private async handleSubdomainComplete(jobId: string, programId: string, results: any): Promise<void> {
    if (results.saved > 0) {
      logger.info({ jobId, programId, newSubdomains: results.saved }, 'New subdomains discovered, triggering fingerprint job');
      // Fetch the newly saved assets to pass to fingerprint
      const newAssets = await database.query(
        `SELECT value FROM assets WHERE program_id = $1 AND source = $2 AND created_at > NOW() - INTERVAL '5 minutes'`,
        [programId, 'subdomain-agent'] // Assuming 'subdomain-agent' is the source for new assets
      );

      if (newAssets.rows.length > 0) {
        const assetValues = newAssets.rows.map(row => row.value);
        await this.triggerFingerprintJob(programId, assetValues, jobId);
      }
    }
  }

  private async handleFingerprintComplete(jobId: string, programId: string, results: any): Promise<void> {
    if (results.alive > 0) {
      logger.info({ jobId, programId, aliveHosts: results.alive }, 'Alive hosts found, triggering scanner and crawl jobs');

      const aliveUrlsWithMetadata: { url: string; metadata: AssetMetadata }[] = results.httpx
        .filter((entry: any) => entry && entry.url && entry.status_code && entry.status_code >= 200 && entry.status_code < 400)
        .map((entry: any) => ({
          url: entry.url,
          metadata: {
            httpStatus: entry.status_code,
            title: entry.title,
            server: Array.isArray(entry.server) ? entry.server[0] : entry.server,
            technologies: entry.tech || entry.technologies || [],
            cdn: entry.cdn,
          } as AssetMetadata,
        }));

      if (aliveUrlsWithMetadata.length > 0) {
        const urls = aliveUrlsWithMetadata.map(item => item.url);
        const fingerprintData = aliveUrlsWithMetadata.map(item => item.metadata);
        await this.triggerScannerJob(programId, urls, jobId, fingerprintData);
        await this.triggerCrawlJob(programId, urls, jobId);
      }
    }
  }

  private async handleScannerComplete(jobId: string, programId: string, results: any): Promise<void> {
    if (results.findings > 0) {
      logger.info({ jobId, programId, findings: results.findings }, 'New findings discovered, consider triggering triage or further analysis');
      // Triage jobs are already triggered by ScannerAgent, so no need to re-trigger here
    }
  }

  private async triggerFingerprintJob(programId: string, assets: string[], parentJobId: string): Promise<void> {
    const fingerprintJobId = uuidv4();
    const job = {
      id: fingerprintJobId,
      type: 'fingerprint',
      programId,
      priority: 8,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        assets,
        tools: ['dnsx', 'httpx', 'tlsx'],
        concurrency: 500,
        followRedirects: true,
      },
      metadata: {
        requestedBy: 'orchestrator',
        parentJobId,
        tags: [`asset-count-${assets.length}`],
      },
      createdAt: new Date(),
    };

    await this.createJob('fingerprint', job);
    logger.info({ fingerprintJobId, parentJobId }, 'Fingerprint job triggered by orchestrator');
  }

  private async triggerScannerJob(programId: string, urls: string[], parentJobId: string, fingerprintData: AssetMetadata[]): Promise<void> {
    // Save URLs to S3 for nuclei scanner
    const urlsContent = urls.join('\n');
    const s3Key = storage.generateKey(programId, 'orchestrator', `${parentJobId}-alive-urls.txt`);
    await storage.uploadText(s3Key, urlsContent);

    const scannerJobId = uuidv4();
    const job = {
      id: scannerJobId,
      type: 'scanner',
      programId,
      priority: 7,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        inputUrlsFile: s3Key,
        templateSet: 'fast',
        tier: 'tier1',
        concurrency: 500,
        interactshEnabled: true,
        fingerprintConditions: {},
        templates: [],
        fingerprintData: fingerprintData.length > 0 ? fingerprintData[0] : undefined, // Pass the first asset's fingerprint data for now
      },
      metadata: {
        requestedBy: 'orchestrator',
        parentJobId,
        tags: [`url-count-${urls.length}`],
      },
      createdAt: new Date(),
    };

    await this.createJob('scanner', job);
    logger.info({ scannerJobId, parentJobId }, 'Scanner job triggered by orchestrator');
  }

  private async triggerCrawlJob(programId: string, urls: string[], parentJobId: string): Promise<void> {
    const crawlerJobId = uuidv4();
    const job = {
      id: crawlerJobId,
      type: 'crawl',
      programId,
      priority: 6,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        targetUrls: urls.slice(0, 100), // Limit crawler to top 100 URLs
        depth: 2,
        maxUrls: 1000,
        respectRobots: false,
      },
      metadata: {
        requestedBy: 'orchestrator',
        parentJobId,
        tags: [`url-count-${Math.min(urls.length, 100)}`],
      },
      createdAt: new Date(),
    };

    await this.createJob('crawl', job);
    logger.info({ crawlerJobId, parentJobId }, 'Crawler job triggered by orchestrator');
  }
}

export default Orchestrator.getInstance();