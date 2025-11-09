import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { CrawlJob, ScannerJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import storage from '../services/storage';
import queue from '../services/queue';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Crawl Agent
 * Crawls web applications to discover:
 * - URLs and endpoints
 * - JS files and API endpoints
 * - Forms and parameters
 * - Cookies and headers
 */
export class CrawlAgent extends BaseAgent<CrawlJob> {
  constructor() {
    super('crawl');
  }

  async process(job: Job<CrawlJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'katana',
      'start',
      'info',
      `Starting crawl for ${options.targetUrls.length} URLs with depth ${options.depth}`
    );

    // Create temp directory outside try block so it's accessible in finally
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crawl-'));

    try {
      const urlsFile = path.join(tmpDir, 'urls.txt');
      await fs.writeFile(urlsFile, options.targetUrls.join('\n'));

      const outputFile = path.join(tmpDir, 'katana_output.txt');

      // Build katana command
      let command = `${config.tools.katana} -list ${urlsFile} \
        -depth ${options.depth} \
        -timeout 30 \
        -silent \
        -output ${outputFile}`;

      // Note: -respect-robots flag doesn't exist in katana v1.2.2
      // Use -kf robotstxt instead if needed
      if (options.respectRobots) {
        command += ' -kf robotstxt';
      }

      if (options.maxUrls) {
        // Note: katana doesn't have -max-urls flag, use -crawl-duration instead
        command += ` -crawl-duration 5m`;
      }

      const result = await this.executeCommand(command, { timeout: 600000 }); // 10 min

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(`Katana failed: ${result.stderr}`);
      }

      // Read and process output
      const content = await fs.readFile(outputFile, 'utf-8');
      const urls = content.split('\n').filter((u) => u.trim());

      // Save to S3
      const s3Key = await storage.uploadText(
        storage.generateKey(programId, 'katana', `${job.id}.txt`),
        urls.join('\n')
      );

      // Categorize URLs
      const categorized = this.categorizeUrls(urls);

      // Save interesting URLs as assets
      let inserted = 0;
      for (const url of urls.slice(0, 10000)) {
        // Limit to 10k
        try {
          await database.query(
            `INSERT INTO assets (program_id, type, value, source, status, metadata)
             VALUES ($1, 'url', $2, ARRAY['katana'], 'active', $3::jsonb)
             ON CONFLICT (program_id, value, type) DO UPDATE
             SET last_seen = CURRENT_TIMESTAMP`,
            [programId, url, JSON.stringify({ crawlJobId: job.id })]
          );
          inserted++;
        } catch (error) {
          // Ignore duplicates
        }
      }

      const results = {
        totalUrls: urls.length,
        inserted,
        s3Key,
        categorized,
      };

      await this.updateJobStatus(job.id!, 'completed', results);
      await this.logExecution(
        job.id!,
        programId,
        'katana',
        'complete',
        'info',
        `Crawl complete: discovered ${urls.length} URLs (${categorized.js} JS, ${categorized.api} API endpoints)`
      );

      // Automatically trigger nuclei scan on discovered URLs
      if (urls.length > 0) {
        await this.triggerNucleiScan(programId, s3Key, urls.length, job.id!);
      }

      return results;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    } finally {
      // Always cleanup temp directory
      try {
        await fs.rm(tmpDir, { recursive: true, force: true });
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }

  private categorizeUrls(urls: string[]): any {
    const categories = {
      js: 0,
      api: 0,
      forms: 0,
      parameterized: 0,
      images: 0,
      other: 0,
    };

    for (const url of urls) {
      if (url.endsWith('.js')) {
        categories.js++;
      } else if (url.includes('/api/') || url.includes('/v1/') || url.includes('/graphql')) {
        categories.api++;
      } else if (url.includes('?') || url.includes('=')) {
        categories.parameterized++;
      } else if (url.match(/\.(jpg|jpeg|png|gif|svg|webp|ico)$/i)) {
        categories.images++;
      } else {
        categories.other++;
      }
    }

    return categories;
  }

  /**
   * Trigger nuclei scan on crawled URLs
   */
  private async triggerNucleiScan(
    programId: string,
    urlsS3Key: string,
    urlCount: number,
    crawlJobId: string
  ): Promise<void> {
    try {
      const scanJobId = uuidv4();

      const scannerJob: ScannerJob = {
        id: scanJobId,
        type: 'scanner',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          inputUrlsFile: urlsS3Key,
          templateSet: 'fast',
          tier: 'tier1',
          concurrency: 50,
          interactshEnabled: true,
          fingerprintConditions: {},
          templates: [],
        },
        metadata: {
          requestedBy: 'crawl-agent',
          parentJobId: crawlJobId,
          tags: [`url-count-${urlCount}`],
        },
        createdAt: new Date(),
      };

      await queue.addJob('scanner', scannerJob);

      logger.info(
        {
          scanJobId,
          crawlJobId,
          programId,
          urlCount,
        },
        'Nuclei scan job created automatically after crawling'
      );

      await this.logExecution(
        crawlJobId,
        programId,
        'crawl',
        'trigger-scan',
        'info',
        `Triggered nuclei scan (${scanJobId}) for ${urlCount} discovered URLs`
      );
    } catch (error: any) {
      logger.error({ error, crawlJobId }, 'Failed to trigger nuclei scan after crawling');
    }
  }
}
