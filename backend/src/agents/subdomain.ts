import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { SubdomainJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';

/**
 * Subdomain Agent
 * Passive subdomain enumeration using multiple sources
 */
export class SubdomainAgent extends BaseAgent<SubdomainJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('subdomain');
  }
  protected getSteps() {
    return [
      {
        name: 'Load domains from scope',
        metadata: {},
      },
      {
        name: 'Passive subdomain enumeration',
        metadata: {},
      },
      {
        name: 'DNS resolution and validation',
        metadata: {},
      },
      {
        name: 'Store discovered subdomains',
        metadata: {},
      },
    ];
  }

  async process(job: Job<SubdomainJob>): Promise<any> {
    const { programId, options } = job.data;

    // Normalize input: accept both 'domain' (string) and 'domains' (array)
    const domains = Array.isArray(options.domains)
      ? options.domains
      : (options as any).domain
        ? [(options as any).domain]
        : [];

    if (domains.length === 0) {
      throw new Error(
        'No domains provided. Use "domain" (string) or "domains" (array) in options.'
      );
    }

    // Default tools if not specified
    if (!options.tools || !Array.isArray(options.tools) || options.tools.length === 0) {
      options.tools = ['subfinder']; // Default to subfinder (fastest and most reliable)
    }

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'subdomain',
      'start',
      'info',
      `Starting subdomain enumeration for ${domains.length} domains`
    );

    try {
      const allSubdomains = new Set<string>();

      // Clean domains: remove leading dots, wildcards, and invalid patterns
      const cleanDomains = domains
        .map((d) => d.replace(/^[\.\*]+/, '').trim())
        .filter((d) => d.length > 0 && !d.startsWith('.') && d.includes('.')); // Must have at least one dot and not start with dot

      await this.logExecution(
        job.id!,
        programId,
        'subdomain',
        'progress',
        'info',
        `Cleaned domains: ${cleanDomains.length} valid domains from ${domains.length} inputs`
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
                this.runSubfinder(domain, job.id!, programId).then((results) => {
                  results.forEach((s) => domainResults.add(s));
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
        batchResults.forEach((domainSet) => {
          domainSet.forEach((s) => allSubdomains.add(s));
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
          `📊 Progress: ${processedCount}/${cleanDomains.length} domains (${Math.round((processedCount / cleanDomains.length) * 100)}%) | Total subdomains: ${allSubdomains.size}`
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
        savedCount = (await Promise.race([
          batchInsertAssets(assetsToInsert),
          new Promise<number>((_, reject) =>
            setTimeout(() => reject(new Error('Batch insert timeout')), 30000)
          ),
        ])) as number;
      } catch (batchError: any) {
        // Fallback to individual inserts if batch fails or times out
        logger.warn(
          { error: batchError?.message },
          'Batch insert failed, using individual inserts'
        );
        for (const subdomain of subdomains) {
          try {
            await database.query(
              `INSERT INTO assets (program_id, type, value, source, metadata, discovered_at)
               VALUES ($1, $2, $3, $4, '{}', CURRENT_TIMESTAMP)
               ON CONFLICT (program_id, type, value_hash) DO NOTHING`,
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

      // 🚀 THREE-AGENT INTEGRATION: Write subdomains to shared memory
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && subdomains.length > 0) {
        try {
          const subdomainFindings = subdomains.map((subdomain: string) => ({
            id: uuidv4(),
            type: 'subdomain-enumeration',
            severity: 'info' as const,
            url: `https://${subdomain}`,
            evidence: `Enumerated via Subfinder/Amass`,
            confidence: 0.95,
            timestamp: new Date(),
            discoveredBy: `subdomain-${job.id}`,
            metadata: { subdomain, source: 'passive-enumeration' },
          }));

          await sharedMemory.storeFindings(swarmId, subdomainFindings);
          await sharedMemory.shareSuccess(swarmId, {
            id: uuidv4(),
            name: 'subdomain-enum',
            description: `Enumerated ${subdomains.length} subdomains`,
            successRate: 0.95,
            metadata: { count: subdomains.length },
          });

          logger.info(
            { swarmId, subdomainsShared: subdomainFindings.length },
            'Subdomain shared findings'
          );
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share subdomain findings');
        }
      }

      await this.updateJobStatus(job.id!, 'completed', results);
      await this.logExecution(
        job.id!,
        programId,
        'subdomain',
        'complete',
        'info',
        `✅ Discovered ${subdomains.length} unique subdomains (${savedCount} new assets saved)`
      );

      // 🎯 RICH HANDOFF: Send discovered subdomains to Discovery agent for validation
      if (savedCount > 0 && subdomains.length > 0) {
        await this.handoffToDiscovery(job.id!, programId, subdomains, results);
      }

      return results;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async runSubfinder(domain: string, jobId: string, programId: string): Promise<string[]> {
    // Clean domain: remove leading dots, wildcards, and validate format
    const cleanDomain = domain.replace(/^[\.\*]+/, '').trim();

    // Skip invalid domains (empty, starts with dot, no dots, etc.)
    if (
      !cleanDomain ||
      cleanDomain.startsWith('.') ||
      !cleanDomain.includes('.') ||
      cleanDomain.length < 3
    ) {
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

  private async runAmass(domain: string, jobId: string, programId: string): Promise<string[]> {
    // Clean domain: remove leading dots, wildcards, and validate format
    const cleanDomain = domain.replace(/^[\.\*]+/, '').trim();

    // Skip invalid domains
    if (
      !cleanDomain ||
      cleanDomain.startsWith('.') ||
      !cleanDomain.includes('.') ||
      cleanDomain.length < 3
    ) {
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
   * 🎯 RICH HANDOFF: Subdomain → Discovery
   * Hands off discovered subdomains for HTTP probing and alive validation
   */
  private async handoffToDiscovery(
    subdomainJobId: string,
    programId: string,
    subdomains: string[],
    results: any
  ): Promise<void> {
    const uniqueDomains = new Set(subdomains.map((s) => s.split('.').slice(-2).join('.')));
    const bySource = {
      subfinder: subdomains.length, // Most from subfinder since amass is disabled
      total: subdomains.length,
    };

    const outputContract = {
      validationMethods: ['http-probe', 'https-probe', 'dns-validation'],
      requiredEvidence: ['status-code', 'response-time', 'ip-address'],
      minConfidence: 0.9,
      maxDuration: 600, // 10 minutes
      requiredFields: ['subdomain', 'alive', 'status_code', 'ip_address'], // Required fields for validation
    };

    await this.createRichHandoff(
      subdomainJobId,
      programId,
      'discovery',
      {
        parentResult: {
          agentType: 'subdomain',
          summary: {
            totalSubdomains: subdomains.length,
            newSubdomains: results.saved,
            uniqueBaseDomains: uniqueDomains.size,
          },
          subdomains,
          bySource,
          enumerationMethod: 'passive',
          tools: ['subfinder'], // amass disabled for speed
        },
        reasoning: {
          trigger: `Discovered ${subdomains.length} subdomains via passive enumeration`,
          confidence: 0.95,
          alternatives: [
            'Skip validation (risk: many dead domains)',
            'Manual validation (slower)',
            'Automated HTTP/HTTPS probing (recommended)',
          ],
          decisionFactors: [
            `${subdomains.length} subdomains need alive validation`,
            `${results.saved} new subdomains discovered (not duplicates)`,
            `${uniqueDomains.size} unique base domains detected`,
            'Passive enumeration has ~30-50% dead subdomain rate',
            'HTTP probing required to identify alive assets',
          ],
        },
        objectives: {
          primary: 'Validate which discovered subdomains are alive and accessible via HTTP/HTTPS',
          secondary: [
            'Probe HTTP and HTTPS for all subdomains',
            'Capture status codes and response times',
            'Identify web services vs non-web services',
            'Map IP addresses and resolve DNS',
            'Capture screenshots of alive web pages',
            'Filter out dead/unreachable subdomains',
          ],
          avoid: [
            'Do not skip DNS validation',
            'Avoid excessive retries on dead domains',
            'Do not capture screenshots of non-200 status codes',
          ],
        },
        successCriteria: {
          minAssets: subdomains.length,
          maxDuration: 600, // 10 min for HTTP probing
          requiredFields: ['subdomain', 'alive', 'status_code', 'ip_address'],
          qualityThreshold: 0.9,
          customCriteria: {
            aliveRate: 0.4, // Expect 40%+ alive rate
            probeSuccess: 0.95, // 95% must be probed (not error)
            dnsResolution: 0.8, // 80%+ must resolve DNS
          },
        },
        inherited: {
          programId,
          rateLimit: 100, // 100 concurrent HTTP probes
          timeout: 10, // 10 sec per probe
          safetyChecks: true,
          budget: {
            maxRequests: subdomains.length * 2, // HTTP + HTTPS
            maxTime: 600,
          },
          retryPolicy: {
            maxRetries: 1,
            backoff: 'linear',
          },
        },
      },
      outputContract
    );

    logger.info(
      {
        subdomainJobId,
        programId,
        subdomains: subdomains.length,
        newSubdomains: results.saved,
        uniqueDomains: uniqueDomains.size,
      },
      '🔗 Subdomain agent initiated rich handoff to Discovery'
    );
  }
}
