import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { CrawlJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import storage from '../services/storage';
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

    try {
      // Create temp file with URLs
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crawl-'));
      const urlsFile = path.join(tmpDir, 'urls.txt');
      await fs.writeFile(urlsFile, options.targetUrls.join('\n'));

      const outputFile = path.join(tmpDir, 'katana_output.txt');

      // Build katana command
      let command = `${config.tools.katana} -list ${urlsFile} \
        -depth ${options.depth} \
        -timeout 30 \
        -concurrency 10 \
        -silent \
        -output ${outputFile}`;

      if (options.respectRobots) {
        command += ' -respect-robots';
      }

      if (options.maxUrls) {
        command += ` -max-urls ${options.maxUrls}`;
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

      // Cleanup
      await fs.rm(tmpDir, { recursive: true });

      await this.updateJobStatus(job.id!, 'completed', results);
      await this.logExecution(
        job.id!,
        programId,
        'katana',
        'complete',
        'info',
        `Crawl complete: discovered ${urls.length} URLs (${categorized.js} JS, ${categorized.api} API endpoints)`
      );

      return results;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
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
}
