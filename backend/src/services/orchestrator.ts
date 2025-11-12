import { Job } from 'bullmq';
import logger from '../utils/logger';
import queue from './queue';
import database from './database';
import { BaseJob, AgentType, Asset } from '../../../shared/types';
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
    await queue.addJob('fingerprint', {
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
    });
    logger.info({ fingerprintJobId, parentJobId }, 'Fingerprint job triggered by orchestrator');
  }

  private async triggerScannerJob(programId: string, urls: string[], parentJobId: string, fingerprintData: AssetMetadata[]): Promise<void> {
    // Save URLs to S3 for nuclei scanner
    const urlsContent = urls.join('\n');
    const s3Key = storage.generateKey(programId, 'orchestrator', `${parentJobId}-alive-urls.txt`);
    await storage.uploadText(s3Key, urlsContent);

    const scannerJobId = uuidv4();
    await queue.addJob('scanner', {
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
    });
    logger.info({ scannerJobId, parentJobId }, 'Scanner job triggered by orchestrator');
  }

  private async triggerCrawlJob(programId: string, urls: string[], parentJobId: string): Promise<void> {
    const crawlerJobId = uuidv4();
    await queue.addJob('crawl', {
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
    });
    logger.info({ crawlerJobId, parentJobId }, 'Crawler job triggered by orchestrator');
  }
}

export default Orchestrator.getInstance();