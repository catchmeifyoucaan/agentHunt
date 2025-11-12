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

      // Build katana command - optimized for speed
      // katana flags: -c (concurrency), -rd (delay in seconds), -o (output)
      // -silent to reduce output, -headless for JS rendering
      let command = `${config.tools.katana} -list ${urlsFile} \
        -depth ${options.depth || 1} \
        -timeout 15 \
        -c 500 \
        -rd 0 \
        -silent \
        -o ${outputFile}`;

      // Note: -respect-robots flag doesn't exist in katana v1.2.2
      // Use -kf robotstxt instead if needed
      if (options.respectRobots) {
        command += ' -kf robotstxt';
      }

      if (options.maxUrls) {
        // Note: katana doesn't have -max-urls flag, use -crawl-duration instead
        command += ` -crawl-duration 5m`;
      }

      // Update progress before crawling
      await this.updateJobProgress(job.id!, {
        current: 0,
        total: options.targetUrls.length,
        percentage: 0,
        currentTool: 'katana',
        toolStatus: 'running',
        message: `Crawling ${options.targetUrls.length} URLs`,
        details: {
          depth: options.depth || 1,
          concurrency: 500,
          timeout: '5 minutes',
        },
      });

      // Timeout: 5 minutes (was 15, but causing timeouts)
      const result = await this.executeCommand(command, { timeout: 300000 }); // 5 min

      // Katana returns 1 on some errors but still produces output
      // Also handle null exitCode (process killed by SIGINT)
      let urls: string[] = [];
      try {
        const content = await fs.readFile(outputFile, 'utf-8');
        urls = content.split('\n').filter((u) => u.trim());

        logger.info({ jobId: job.id, urlCount: urls.length, exitCode: result.exitCode }, 'Katana output parsed');

        // Update progress after crawling
        await this.updateJobProgress(job.id!, {
          current: urls.length,
          total: options.targetUrls.length,
          percentage: 100,
          currentTool: 'katana',
          toolStatus: 'completed',
          message: `Crawled ${urls.length} URLs from ${options.targetUrls.length} targets`,
          details: {
            urlsFound: urls.length,
            depth: options.depth || 1,
          },
        });
      } catch (readError: any) {
        // If file doesn't exist or is empty, check if katana actually failed
        // exitCode null means process was killed (SIGINT), treat as failure
        if (result.exitCode !== 0 && result.exitCode !== 1 && result.exitCode !== null) {
          throw new Error(`Katana failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
        }
        // If exitCode is null (killed), throw error
        if (result.exitCode === null) {
          throw new Error(`Katana was interrupted (SIGINT): ${result.stderr || result.stdout}`);
        }
        // If exit code is 0 or 1, katana might have run but found nothing
        logger.warn({ jobId: job.id, exitCode: result.exitCode }, 'Katana completed but no output file found');
      }

      // If no URLs found but command succeeded, that's OK
      if (urls.length === 0 && result.exitCode === 0) {
        logger.info({ jobId: job.id }, 'Katana completed but found no URLs');
        const emptyResult = {
          totalUrls: 0,
          total_urls: 0,
          urls_found: 0,
          inserted: 0,
          s3Key: null,
          categorized: { js: 0, api: 0, forms: 0, other: 0 },
        };
        await this.updateJobStatus(job.id!, 'completed', emptyResult);
        return emptyResult;
      }

      // Save to S3
      const s3Key = await storage.uploadText(
        storage.generateKey(programId, 'katana', `${job.id}.txt`),
        urls.join('\n')
      );

      // Categorize URLs
      const categorized = this.categorizeUrls(urls);

      // Batch insert URLs as assets (100-1000x faster)
      // Try to load batch-insert, fallback to individual inserts
      let batchInsertAssets;
      try {
        // Use require.resolve to find the module
        const batchInsertModule = require.resolve('../utils/batch-insert');
        batchInsertAssets = require(batchInsertModule).batchInsertAssets;
      } catch (e: any) {
        // If module not found, use individual inserts (slower but works)
        logger.debug({ error: e?.message || 'Module not found' }, 'Batch insert not available, using individual inserts');
        batchInsertAssets = null;
      }
      const urlsToInsert = urls.slice(0, 10000).map((url) => ({
        programId,
        type: 'url',
        value: url,
        source: 'katana',
        metadata: { crawlJobId: job.id },
      }));

      let inserted = 0;
      if (batchInsertAssets) {
        inserted = await batchInsertAssets(urlsToInsert);
      } else {
        // Fallback to individual inserts
        for (const asset of urlsToInsert) {
          try {
            await database.query(
              `INSERT INTO assets (program_id, type, value, source, metadata)
               VALUES ($1, $2, $3, $4, $5::jsonb)
               ON CONFLICT (program_id, type, value) DO UPDATE
               SET last_scanned = CURRENT_TIMESTAMP`,
              [asset.programId, asset.type, asset.value, asset.source, JSON.stringify(asset.metadata)]
            );
            inserted++;
          } catch (err) {
            // Ignore duplicates
          }
        }
      }

      const results = {
        totalUrls: urls.length,
        total_urls: urls.length,  // Add snake_case for backward compatibility
        urls_found: urls.length,  // Add alternative field name
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

      // Trigger fingerprinting for newly discovered URLs (fingerprint will then trigger nuclei)
      if (urls.length > 0) {
        await this.triggerFingerprintJob(programId, urls, job.id!);
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
   * Trigger fingerprint job for discovered URLs
   * (fingerprint will then trigger nuclei and further crawling)
   */
  private async triggerFingerprintJob(
    programId: string,
    urls: string[],
    crawlJobId: string
  ): Promise<void> {
    try {
      const fingerprintJobId = uuidv4();

      await queue.addJob('fingerprint', {
        id: fingerprintJobId,
        type: 'fingerprint',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          assets: urls,
          tools: ['httpx'], // No DNS needed for URLs
          followRedirects: true,
          concurrency: 500,
        },
        metadata: {
          requestedBy: 'crawl-agent',
          parentJobId: crawlJobId,
          tags: [`url-count-${urls.length}`],
        },
        createdAt: new Date(),
      });

      logger.info(
        {
          fingerprintJobId,
          crawlJobId,
          programId,
          urlCount: urls.length,
        },
        'Fingerprint job created for crawled URLs'
      );

      await this.logExecution(
        crawlJobId,
        programId,
        'crawl',
        'trigger-fingerprint',
        'info',
        `Triggered fingerprint job (${fingerprintJobId}) for ${urls.length} discovered URLs`
      );
    } catch (error: any) {
      logger.error({ error, crawlJobId }, 'Failed to trigger fingerprint job after crawling');
    }
  }
}
