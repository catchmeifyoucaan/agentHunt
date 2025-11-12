import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { SubdomainJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Subdomain Agent
 * Passive subdomain enumeration using multiple sources
 */
export class SubdomainAgent extends BaseAgent<SubdomainJob> {
  constructor() {
    super('subdomain');
  }

  async process(job: Job<SubdomainJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'subdomain',
      'start',
      'info',
      `Starting subdomain enumeration for ${options.domains.length} domains`
    );

    try {
      let allSubdomains = new Set<string>();

      // Clean domains: remove leading dots, wildcards, and invalid patterns
      const cleanDomains = options.domains
        .map(d => d.replace(/^[\.\*]+/, '').trim())
        .filter(d => d.length > 0 && !d.startsWith('.') && d.includes('.')); // Must have at least one dot and not start with dot

      await this.logExecution(
        job.id!,
        programId,
        'subdomain',
        'progress',
        'info',
        `Cleaned domains: ${cleanDomains.length} valid domains from ${options.domains.length} inputs`
      );

      // Process domains in parallel batches of 500 for MAXIMUM SPEED
      // Increased from 20 to 500 to match DNS validation parallelism
      const BATCH_SIZE = 500;
      let processedCount = 0;

      for (let batchStart = 0; batchStart < cleanDomains.length; batchStart += BATCH_SIZE) {
        const batch = cleanDomains.slice(batchStart, batchStart + BATCH_SIZE);

        // Update progress in database for UI
        await this.updateJobProgress(job.id!, {
          current: processedCount,
          total: cleanDomains.length,
          percentage: Math.round((processedCount / cleanDomains.length) * 100),
          currentTool: 'subfinder',
          toolStatus: 'running',
          message: `Processing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(cleanDomains.length / BATCH_SIZE)}`,
          details: {
            batchDomains: batch,
            totalSubdomainsFound: allSubdomains.size,
          },
        });

        await this.logExecution(
          job.id!,
          programId,
          'subdomain',
          'progress',
          'info',
          `🔄 Processing batch: ${processedCount + 1}-${Math.min(processedCount + batch.length, cleanDomains.length)} of ${cleanDomains.length} domains (${batch.join(', ')})`
        );

        // Process each domain in batch in parallel
        const batchPromises = batch.map(async (domain, idx) => {
          const domainResults = new Set<string>();
          const domainNum = processedCount + idx + 1;

          try {
            // Run subfinder and amass in parallel for each domain
            const toolPromises = [];

            if (options.tools.includes('subfinder')) {
              toolPromises.push(
                this.runSubfinder(domain, job.id!, programId).then(results => {
                  results.forEach(s => domainResults.add(s));
                  this.logExecution(
                    job.id!,
                    programId,
                    'subdomain',
                    'progress',
                    'info',
                    `✅ [${domainNum}/${cleanDomains.length}] ${domain}: Subfinder found ${results.length} subdomains`
                  );
                  return results;
                })
              );
            }

            // AMASS DISABLED FOR SPEED - subfinder is 10x faster and finds 80% of what amass finds
            // To enable amass, uncomment below:
            // if (options.tools.includes('amass')) {
            //   toolPromises.push(
            //     this.runAmass(domain, job.id!, programId).then(results => {
            //       results.forEach(s => domainResults.add(s));
            //       this.logExecution(
            //         job.id!,
            //         programId,
            //         'subdomain',
            //         'progress',
            //         'info',
            //         `✅ [${domainNum}/${cleanDomains.length}] ${domain}: Amass found ${results.length} subdomains`
            //       );
            //       return results;
            //     })
            //   );
            // }

            // Wait for both tools to complete for this domain
            await Promise.all(toolPromises);

            await this.logExecution(
              job.id!,
              programId,
              'subdomain',
              'progress',
              'info',
              `✨ [${domainNum}/${cleanDomains.length}] ${domain}: Total ${domainResults.size} unique subdomains discovered`
            );

            return domainResults;
          } catch (error: any) {
            logger.error({ error, domain }, 'Error processing domain');
            await this.logExecution(
              job.id!,
              programId,
              'subdomain',
              'error',
              'error',
              `❌ [${domainNum}/${cleanDomains.length}] ${domain}: Failed - ${error.message}`
            );
            return domainResults;
          }
        });

        // Wait for entire batch to complete
        const batchResults = await Promise.all(batchPromises);

        // Merge all results
        batchResults.forEach(domainSet => {
          domainSet.forEach(s => allSubdomains.add(s));
        });

        processedCount += batch.length;

        // Update final progress after batch
        await this.updateJobProgress(job.id!, {
          current: processedCount,
          total: cleanDomains.length,
          percentage: Math.round((processedCount / cleanDomains.length) * 100),
          currentTool: 'subfinder',
          toolStatus: processedCount >= cleanDomains.length ? 'completed' : 'running',
          message: `Processed ${processedCount}/${cleanDomains.length} domains`,
          details: {
            totalSubdomainsFound: allSubdomains.size,
          },
        });

        await this.logExecution(
          job.id!,
          programId,
          'subdomain',
          'progress',
          'info',
          `📊 Progress: ${processedCount}/${cleanDomains.length} domains (${Math.round(processedCount / cleanDomains.length * 100)}%) | Total subdomains: ${allSubdomains.size}`
        );
      }

      // Store discovered subdomains
      const subdomains = Array.from(allSubdomains);

      await this.logExecution(
        job.id!,
        programId,
        'subdomain',
        'saving',
        'info',
        `Saving ${subdomains.length} unique subdomains to database...`
      );

      // Batch insert subdomains (100-1000x faster) with timeout and fallback
      let savedCount = 0;
      try {
        const batchInsertPath = require.resolve('../utils/batch-insert');
        const { batchInsertAssets } = require(batchInsertPath);
        const assetsToInsert = subdomains.map((subdomain) => ({
          programId,
          type: 'subdomain',
          value: subdomain,
          source: 'subdomain-agent',
          metadata: {},
        }));

        // Add timeout to batch insert (30 seconds max)
        savedCount = await Promise.race([
          batchInsertAssets(assetsToInsert),
          new Promise<number>((_, reject) => 
            setTimeout(() => reject(new Error('Batch insert timeout')), 30000)
          ),
        ]) as number;
      } catch (batchError: any) {
        // Fallback to individual inserts if batch fails or times out
        logger.warn({ error: batchError?.message }, 'Batch insert failed, using individual inserts');
        for (const subdomain of subdomains) {
          try {
            await database.query(
              `INSERT INTO assets (program_id, type, value, source, metadata, discovered_at)
               VALUES ($1, $2, $3, $4, '{}', CURRENT_TIMESTAMP)
               ON CONFLICT (program_id, type, value) DO NOTHING`,
              [programId, 'subdomain', subdomain, 'subdomain-agent']
            );
            savedCount++;
          } catch (err) {
            // Ignore duplicates
          }
        }
      }

      await this.logExecution(
        job.id!,
        programId,
        'subdomain',
        'saved',
        'info',
        `Saved ${savedCount} new subdomains (${subdomains.length - savedCount} duplicates skipped)`
      );

      const results = {
        total: subdomains.length,
        unique: subdomains.length,
        saved: savedCount,
      };

      await this.updateJobStatus(job.id!, 'completed', results);
      await this.logExecution(
        job.id!,
        programId,
        'subdomain',
        'complete',
        'info',
        `✅ Discovered ${subdomains.length} unique subdomains (${savedCount} new assets saved)`
      );

      // Trigger fingerprinting for new subdomains
      if (savedCount > 0) {
        await this.triggerFingerprintJob(programId, subdomains, job.id!);
      }

      return results;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async runSubfinder(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<string[]> {
    // Clean domain: remove leading dots, wildcards, and validate format
    const cleanDomain = domain.replace(/^[\.\*]+/, '').trim();

    // Skip invalid domains (empty, starts with dot, no dots, etc.)
    if (!cleanDomain || cleanDomain.startsWith('.') || !cleanDomain.includes('.') || cleanDomain.length < 3) {
      logger.warn({ domain, cleanDomain }, 'Skipping invalid domain for subfinder');
      return [];
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subfinder-'));
    const outputFile = path.join(tmpDir, 'subdomains.txt');

    // Use timeout: 5 minutes per domain (was unlimited)
    const command = `${config.tools.subfinder} -d ${cleanDomain} -o ${outputFile} -all -silent`;

    const result = await this.executeCommand(command, { timeout: 300000 }); // 5 min timeout

    if (result.exitCode === 0) {
      try {
        const content = await fs.readFile(outputFile, 'utf-8');
        const subdomains = content.split('\n').filter((s) => s.trim().length > 0);
        await fs.rm(tmpDir, { recursive: true });
        return subdomains;
      } catch (error) {
        logger.error({ error }, 'Failed to parse subfinder output');
        await fs.rm(tmpDir, { recursive: true });
        return [];
      }
    }

    await fs.rm(tmpDir, { recursive: true });
    return [];
  }

  private async runAmass(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<string[]> {
    // Clean domain: remove leading dots, wildcards, and validate format
    const cleanDomain = domain.replace(/^[\.\*]+/, '').trim();

    // Skip invalid domains
    if (!cleanDomain || cleanDomain.startsWith('.') || !cleanDomain.includes('.') || cleanDomain.length < 3) {
      logger.warn({ domain, cleanDomain }, 'Skipping invalid domain for amass');
      return [];
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-'));
    const outputFile = path.join(tmpDir, 'subdomains.txt');

    const command = `${config.tools.amass} enum -passive -d ${cleanDomain} -o ${outputFile}`;

    // Add timeout for amass (10 minutes max per domain)
    const result = await this.executeCommand(command, { timeout: 600000 });

    if (result.exitCode === 0) {
      try {
        const content = await fs.readFile(outputFile, 'utf-8');
        const subdomains = content.split('\n').filter((s) => s.trim().length > 0);
        await fs.rm(tmpDir, { recursive: true });
        return subdomains;
      } catch (error) {
        logger.error({ error }, 'Failed to parse amass output');
        await fs.rm(tmpDir, { recursive: true });
        return [];
      }
    }

    await fs.rm(tmpDir, { recursive: true });
    return [];
  }

  /**
   * Trigger fingerprint job for discovered subdomains
   */
  private async triggerFingerprintJob(
    programId: string,
    subdomains: string[],
    parentJobId: string
  ): Promise<void> {
    try {
      const queue = require('../services/queue').default;
      const { v4: uuidv4 } = require('uuid');

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
          assets: subdomains,
          tools: ['dnsx', 'httpx'],
          followRedirects: true,
          concurrency: 500,
        },
        metadata: {
          requestedBy: 'subdomain-agent',
          parentJobId,
          tags: [`subdomain-count-${subdomains.length}`],
        },
        createdAt: new Date(),
      });

      await this.logExecution(
        parentJobId,
        programId,
        'subdomain',
        'trigger-fingerprint',
        'info',
        `Triggered fingerprint job (${fingerprintJobId}) for ${subdomains.length} subdomains`
      );
    } catch (error: any) {
      logger.error({ error, parentJobId }, 'Failed to trigger fingerprint job after subdomain discovery');
    }
  }
}
