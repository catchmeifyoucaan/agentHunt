import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { FingerprintJob, AssetMetadata } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

/**
 * Fingerprint Agent
 * Probes assets to gather metadata:
 * - HTTP status, headers, title
 * - TLS/SSL information
 * - Technology stack detection
 * - CDN detection
 */
export class FingerprintAgent extends BaseAgent<FingerprintJob> {
  constructor() {
    super('fingerprint');
  }

  async process(job: Job<FingerprintJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'fingerprint',
      'start',
      'info',
      `🚀 Starting fingerprint for ${options.assets.length} assets using ${options.tools.join(', ')}`
    );

    let tmpDir: string | null = null;

    try {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fingerprint-'));

      // Step 1: Run dnsx FIRST to filter resolving domains (if requested)
      let dnsxResults: string[] = [];
      let assetsToProbe = options.assets;

      if (options.tools.includes('dnsx')) {
        const dnsxRes = await this.runDnsx(options.assets, job.id!, programId, options);
        dnsxResults = dnsxRes.resolved;
        // Only probe domains that resolved in DNS
        assetsToProbe = dnsxResults.length > 0 ? dnsxResults : options.assets;

        await this.logExecution(
          job.id!,
          programId,
          'fingerprint',
          'dnsx-complete',
          'info',
          `✅ DNS filtering: ${dnsxResults.length}/${options.assets.length} domains resolved. Probing resolved domains only.`
        );
      }

      // Write ONLY resolved assets to file for httpx/tlsx
      const assetsFile = path.join(tmpDir, 'assets.txt');
      await fs.writeFile(assetsFile, assetsToProbe.join('\n'));

      // Step 2: Run httpx and tlsx in parallel on RESOLVED domains only
      const httpxResults: { entries: any[]; diagnostics: Record<string, any> } = { entries: [], diagnostics: {} };
      let tlsxResults: any[] = [];

      const probePromises: Promise<any>[] = [];

      if (options.tools.includes('httpx')) {
        probePromises.push(this.runHttpx(assetsFile, job.id!, programId, options));
      }
      if (options.tools.includes('tlsx')) {
        probePromises.push(this.runTlsx(assetsFile, job.id!, programId));
      }

      if (probePromises.length > 0) {
        const probeResults = await Promise.all(probePromises);
        probeResults.forEach(res => {
          if (res && res.entries) {
            Object.assign(httpxResults, res);
          } else if (res && Array.isArray(res)) {
            tlsxResults = res;
          }
        });
      }

      const httpxDiagnostics = httpxResults.diagnostics || {};
      const results: any = {
        total: options.assets.length,
        probed: assetsToProbe.length,
        alive: httpxDiagnostics.alive || 0,
        withTech: 0,
        cdn: 0,
        dnsx: {
          total: options.assets.length,
          resolved: dnsxResults.length,
          filtered: options.assets.length - dnsxResults.length,
          pipelined: dnsxResults.length > 0,
        },
        httpx: httpxResults.entries || [],
        httpxDiagnostics: httpxDiagnostics,
        tlsx: tlsxResults.length,
      };

        // Build metadata map for all assets (declare outside transaction so it's accessible later)
        const metadataMap = new Map<string, AssetMetadata>();

        // Batch update asset metadata using temporary table (100-1000x faster)
        if (options.assets.length > 0) {
          try {
            await database.transaction(async (client) => {
              // Create temp table
              await client.query(`
                CREATE TEMP TABLE asset_metadata_updates (
                  value TEXT PRIMARY KEY,
                  metadata JSONB
                ) ON COMMIT DROP
              `);
              for (const asset of options.assets) {
                const metadata: AssetMetadata = {};
                const httpxResult =
                  Array.isArray(results.httpx) && results.httpx.length
                    ? results.httpx.find((r: any) => r.host === asset || r.url?.includes(asset))
                    : null;

                if (httpxResult) {
                  if (typeof httpxResult.status_code === 'number') {
                    metadata.httpStatus = httpxResult.status_code;
                  }
                  if (httpxResult.title) {
                    metadata.title = httpxResult.title;
                  }
                  const serverValue = Array.isArray(httpxResult.server)
                    ? httpxResult.server[0]
                    : httpxResult.server;
                  if (serverValue) {
                    metadata.server = serverValue;
                  }
                  const technologies = httpxResult.tech || httpxResult.technologies || [];
                  if (Array.isArray(technologies) && technologies.length) {
                    metadata.technologies = technologies;
                  }
                  if (httpxResult.cdn) {
                    metadata.cdn = httpxResult.cdn;
                    results.cdn++;
                  }
                }
                metadataMap.set(asset, metadata);
              }

              // Bulk insert into temp table
              const values: any[] = [];
              const placeholders: string[] = [];
              let paramIndex = 1;
              
              for (const [asset, metadata] of metadataMap.entries()) {
                placeholders.push(`($${paramIndex}, $${paramIndex + 1}::jsonb)`);
                values.push(asset, JSON.stringify(metadata));
                paramIndex += 2;
              }

              if (values.length > 0) {
                await client.query(
                  `INSERT INTO asset_metadata_updates (value, metadata) VALUES ${placeholders.join(', ')}`,
                  values
                );

                // Update assets from temp table
                await client.query(`
                  UPDATE assets
                  SET metadata = assets.metadata || a.metadata,
                      last_scanned = CURRENT_TIMESTAMP
                  FROM asset_metadata_updates a
                  WHERE assets.program_id = $1
                    AND assets.value = a.value
                `, [programId]);
              }
            });

            // Count results
            for (const asset of options.assets) {
              const metadata = metadataMap.get(asset);
              if ((metadata?.technologies?.length || 0) > 0 || metadata?.server || metadata?.title) {
                results.withTech++;
              }
            }
          } catch (error) {
            logger.error({ error, count: options.assets.length }, 'Failed to batch update asset metadata, using fallback');
            // Fallback to individual updates if batch fails
            const metadataMap = new Map<string, AssetMetadata>();
            for (const asset of options.assets) {
              const metadata: AssetMetadata = {};
              const httpxResult =
                Array.isArray(results.httpx) && results.httpx.length
                  ? results.httpx.find((r: any) => r.host === asset || r.url?.includes(asset))
                  : null;

              if (httpxResult) {
                if (typeof httpxResult.status_code === 'number') {
                  metadata.httpStatus = httpxResult.status_code;
                }
                if (httpxResult.title) {
                  metadata.title = httpxResult.title;
                }
                const serverValue = Array.isArray(httpxResult.server)
                  ? httpxResult.server[0]
                  : httpxResult.server;
                if (serverValue) {
                  metadata.server = serverValue;
                }
                const technologies = httpxResult.tech || httpxResult.technologies || [];
                if (Array.isArray(technologies) && technologies.length) {
                  metadata.technologies = technologies;
                }
                if (httpxResult.cdn) {
                  metadata.cdn = httpxResult.cdn;
                  results.cdn++;
                }
              }
              metadataMap.set(asset, metadata);

              try {
                await database.query(
                  `UPDATE assets
                   SET metadata = metadata || $1::jsonb,
                       last_scanned = CURRENT_TIMESTAMP
                   WHERE program_id = $2 AND value = $3`,
                  [JSON.stringify(metadata), programId, asset]
                );
                if ((metadata.technologies?.length || 0) > 0 || metadata.server || metadata.title) {
                  results.withTech++;
                }
              } catch (err) {
                logger.error({ error: err, asset }, 'Failed to update asset metadata (fallback)');
              }
            }
          }
        }

        results.summary = {
          totalAssets: options.assets.length,
          aliveHosts: results.alive,
          withTechnology: results.withTech,
          cdnHosts: results.cdn,
          httpx: httpxDiagnostics,
        };

        await this.updateJobStatus(job.id!, 'completed', results);
      await this.logExecution(
        job.id!,
        programId,
        'fingerprint',
        'complete',
        'info',
        `✅ Fingerprint Complete: ${results.alive}/${results.probed} alive hosts (${results.total - results.probed} filtered by DNS), ${results.withTech} with tech detected`
      );

      // Note: Auto-orchestrator will handle triggering crawl and nuclei after httpx completes
      // This prevents duplicate triggers and ensures proper workflow sequencing

      return results;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    } finally {
      if (tmpDir) {
        await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  /**
   * Run dnsx to check DNS resolution
   */
  private async runDnsx(
    assets: string[],
    jobId: string,
    programId: string,
    options: FingerprintJob['options']
  ): Promise<{ resolved: string[] }> {
    // Use base agent's validateDNS method
    const resolved = await this.validateDNS(assets, jobId, programId);
    
    // Save resolved subdomains to database (batch insert for performance)
    if (resolved.length > 0) {
      try {
        const { batchInsertAssets } = require('../utils/batch-insert');
        const assetsToInsert = resolved.map((asset) => ({
          programId,
          type: 'subdomain',
          value: asset,
          source: 'dnsx',
          metadata: { dnsResolved: true },
        }));
        await batchInsertAssets(assetsToInsert);
      } catch (error) {
        logger.error({ error, count: resolved.length }, 'Failed to batch save DNS-resolved assets');
        // Fallback to individual inserts if batch fails
        for (const asset of resolved) {
          try {
            await database.query(
              `INSERT INTO assets (program_id, value, type, discovered_at, metadata)
               VALUES ($1, $2, 'subdomain', CURRENT_TIMESTAMP, jsonb_build_object('dnsResolved', true))
               ON CONFLICT (program_id, value, type) 
               DO UPDATE SET metadata = assets.metadata || jsonb_build_object('dnsResolved', true)`,
              [programId, asset]
            );
          } catch (err) {
            logger.error({ error: err, asset }, 'Failed to save DNS-resolved asset (fallback)');
          }
        }
      }
    }

    await this.logExecution(
      jobId,
      programId,
      'dnsx',
      'complete',
      'info',
      `✅ DNS check complete: ${resolved.length}/${assets.length} subdomains resolved`
    );

    return { resolved };
  }

    private async runHttpx(
      assetsFile: string,
      jobId: string,
      programId: string,
      options: FingerprintJob['options']
    ): Promise<{ entries: any[]; diagnostics: Record<string, any> }> {
      // Determine tool settings from job options so UI matches actual execution
      const requestedThreads = config.tools.httpxThreads;
      const rateLimit = config.tools.httpxRateLimit;
      const timeout = config.tools.httpxTimeout;
      const retries = config.tools.httpxRetries;

      const command = `${config.tools.httpx} -l ${assetsFile} ` +
        `-status-code -title -tech-detect -server -cdn ` +
        `-probe -random-agent -asn -websocket -pipeline -http2 -tls-grab ` +
        `-follow-redirects=${options.followRedirects} ` +
        `-threads ${requestedThreads} ` +
        `-timeout ${timeout} ` +
        `-retries ${retries} ` +
        `-rl ${rateLimit} ` +
        `-stream -stats ` +
        `-silent ` +
        `-json`;

      // REALISTIC Timeout: 10 seconds per asset (max), scales with count, capped at 1 hour
      const timeoutMs = Math.min(3600000, options.assets.length * timeout * 1000);

      await this.updateJobProgress(jobId, {
        current: 0,
        total: options.assets.length,
        percentage: 0,
        currentTool: 'httpx',
        toolStatus: 'running',
        message: `Step 2: HTTP fingerprinting ${options.assets.length} assets`,
        details: {
          timeout: `${Math.round(timeoutMs / 1000 / 60)} minutes`,
          threads: requestedThreads,
          rateLimit,
        },
      });

      await this.logExecution(
        jobId,
        programId,
        'httpx',
        'progress',
        'info',
        `🔍 Step 2: HTTP fingerprinting ${options.assets.length} assets (timeout: ${Math.round(
          timeoutMs / 1000 / 60
        )}min, ${requestedThreads} threads, rate-limit ${rateLimit}/s)`
      );

      const result = await this.executeCommand(command, { timeout: timeoutMs });

      const parsedLines: any[] = [];
      const stdout = result.stdout?.trim() || '';
      const stderr = result.stderr?.trim() || '';

      if (stdout) {
        try {
          parsedLines.push(...this.parseJsonLines(stdout));
          await this.saveOutput(programId, 'httpx', stdout, 'json');
        } catch (error) {
          logger.error({ error }, 'Failed to parse httpx stdout');
        }
      }

      const aliveCount = parsedLines.filter(
        (entry: any) => entry && entry.failed !== true && (entry.status_code || entry.tech?.length || entry.url)
      ).length;
      const diagnostics = {
        exitCode: result.exitCode,
        durationMs: result.duration,
        threads: requestedThreads,
        rateLimit,
        timeoutMs,
        assets: options.assets.length,
        alive: aliveCount,
        stdoutLines: parsedLines.length,
        stderr: stderr ? stderr.split('\n').slice(-10) : [],
      };

      if (result.exitCode !== 0) {
        const message = `httpx exited with code ${result.exitCode}.`;

        // Exit code 1 from httpx often means "no alive hosts found" which is a valid result, not an error
        // Only treat as error if there's actual stderr output indicating a problem
        if (stderr && stderr.toLowerCase().includes('error')) {
          await this.updateJobProgress(jobId, {
            current: parsedLines.length,
            total: options.assets.length,
            percentage: Math.min(100, Math.round((parsedLines.length / options.assets.length) * 100)),
            currentTool: 'httpx',
            toolStatus: 'failed',
            message: stderr ? `${message} ${stderr}` : message,
            details: diagnostics,
          });
          await this.logExecution(jobId, programId, 'httpx', 'error', 'error', `${message} ${stderr || ''}`.trim());
          throw new Error(stderr ? `${message} ${stderr}` : message);
        } else {
          // Exit code 1 with no stderr error = no hosts alive (valid result)
          await this.logExecution(
            jobId,
            programId,
            'httpx',
            'complete',
            'info',
            `httpx completed with exit code ${result.exitCode} - no alive hosts found (valid result)`
          );
        }
      }

      await this.updateJobProgress(jobId, {
        current: options.assets.length,
        total: options.assets.length,
        percentage: 100,
        currentTool: 'httpx',
        toolStatus: aliveCount > 0 ? 'completed' : 'completed_empty',
        message:
          aliveCount > 0
            ? `Found ${aliveCount} alive hosts out of ${options.assets.length}`
            : `All ${options.assets.length} targets unreachable (no DNS/HTTP response)`,
        details: {
          alive: aliveCount,
          total: options.assets.length,
          noResponse: options.assets.length - aliveCount,
          threads: requestedThreads,
          rateLimit,
          durationMs: result.duration,
        },
      });

      if (!parsedLines.length && !stdout) {
        logger.warn(
          { jobId, programId, exitCode: result.exitCode, stderr: result.stderr, assetCount: options.assets.length },
          'httpx produced no output - targets may be unreachable or internal domains'
        );
      }

      if (stderr) {
        await this.logExecution(jobId, programId, 'httpx', 'stderr', 'warn', stderr);
      }

      return { entries: parsedLines, diagnostics };
    }

  private async runTlsx(assetsFile: string, jobId: string, programId: string): Promise<any[]> {
    const outputFile = `${assetsFile}.tlsx.json`;

    const command = `${config.tools.tlsx} -l ${assetsFile} -json -o ${outputFile}`;

    const result = await this.executeCommand(command);

    if (result.exitCode === 0) {
      try {
        const content = await fs.readFile(outputFile, 'utf-8');
        const lines = this.parseJsonLines(content);

        // Update asset metadata with TLS info
        for (const tlsInfo of lines) {
          if (tlsInfo.host) {
            await database.query(
              `UPDATE assets
               SET metadata = metadata || jsonb_build_object(
                 'tlsVersion', $1,
                 'certificates', $2
               )
               WHERE program_id = $3 AND value = $4`,
              [
                tlsInfo.version,
                JSON.stringify(tlsInfo.certificate || []),
                programId,
                tlsInfo.host,
              ]
            );
          }
        }

        await this.saveOutput(programId, 'tlsx', content, 'json');
        return lines;
      } catch (error) {
        logger.error({ error }, 'Failed to parse tlsx output');
        return [];
      }
    }

    return [];
  }

  /**
   * Trigger nuclei scanner and crawler jobs for fingerprinted URLs
   */
  private async triggerNucleiAndCrawler(
    programId: string,
    urls: string[],
    parentJobId: string
  ): Promise<void> {
    try {
      const queue = require('../services/queue').default;
      const storage = require('../services/storage').default;
      const { v4: uuidv4 } = require('uuid');

      // Save URLs to S3 for nuclei scanner
      const urlsContent = urls.join('\n');
      const s3Key = storage.generateKey(programId, 'fingerprint', `${parentJobId}-alive-urls.txt`);
      await storage.uploadText(s3Key, urlsContent);

      // Trigger nuclei scanner job
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
        },
        metadata: {
          requestedBy: 'fingerprint-agent',
          parentJobId,
          tags: [`url-count-${urls.length}`],
        },
        createdAt: new Date(),
      });

      await this.logExecution(
        parentJobId,
        programId,
        'fingerprint',
        'trigger-scanner',
        'info',
        `Triggered nuclei scanner (${scannerJobId}) for ${urls.length} alive URLs`
      );

      // Trigger crawler job
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
          requestedBy: 'fingerprint-agent',
          parentJobId,
          tags: [`url-count-${Math.min(urls.length, 100)}`],
        },
        createdAt: new Date(),
      });

      await this.logExecution(
        parentJobId,
        programId,
        'fingerprint',
        'trigger-crawler',
        'info',
        `Triggered crawler (${crawlerJobId}) for ${Math.min(urls.length, 100)} URLs`
      );
    } catch (error: any) {
      logger.error({ error, parentJobId }, 'Failed to trigger nuclei/crawler after fingerprinting');
    }
  }
}
