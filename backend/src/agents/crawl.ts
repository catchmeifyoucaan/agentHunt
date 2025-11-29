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
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';

/**
 * Crawl Agent
 * Crawls web applications to discover:
 * - URLs and endpoints
 * - JS files and API endpoints
 * - Forms and parameters
 * - Cookies and headers
 */
export class CrawlAgent extends BaseAgent<CrawlJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('crawl');
  }
  protected getSteps() {
    return [
      {
        name: 'Load URLs to crawl',
        metadata: {},
      },
      {
        name: 'Crawl websites with Katana',
        metadata: {},
      },
      {
        name: 'Extract endpoints and parameters',
        metadata: {},
      },
      {
        name: 'Store discovered endpoints',
        metadata: {},
      },
    ];
  }

  async process(job: Job<CrawlJob>): Promise<any> {
    const { programId, options } = job.data;

    // Normalize input: accept various formats
    let targetUrls: string[] = [];

    if (options.targetUrls && Array.isArray(options.targetUrls)) {
      targetUrls = options.targetUrls;
    } else if ((options as any).url) {
      targetUrls = [(options as any).url];
    } else if ((options as any).urls && Array.isArray((options as any).urls)) {
      targetUrls = (options as any).urls;
    } else {
      // Load HTTP endpoints from database if no URLs provided
      const result = await database.query(
        `SELECT value FROM assets
         WHERE program_id = $1
           AND type IN ('url', 'endpoint')
           AND value LIKE 'http%'
         ORDER BY discovered_at DESC
         LIMIT 100`,
        [programId]
      );
      targetUrls = result.rows.map((r: any) => r.value);
    }

    if (targetUrls.length === 0) {
      throw new Error(
        'No URLs to crawl. Provide "url" (string), "urls" (array), or run fingerprinting first.'
      );
    }

    // Default depth if not specified
    const depth = options.depth !== undefined ? options.depth : 2;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'katana',
      'start',
      'info',
      `Starting crawl for ${targetUrls.length} URLs with depth ${depth}`
    );

    // Create temp directory outside try block so it's accessible in finally
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'crawl-'));

    try {
      // OPTIMIZATION: Parallel Katana instances (5-10x faster crawling)
      // Split URLs into chunks and run multiple Katana instances in parallel
      const PARALLEL_INSTANCES = 10;
      const chunkSize = Math.ceil(targetUrls.length / PARALLEL_INSTANCES);
      const urlChunks: string[][] = [];

      for (let i = 0; i < targetUrls.length; i += chunkSize) {
        urlChunks.push(targetUrls.slice(i, i + chunkSize));
      }

      logger.info(
        { jobId: job.id, totalUrls: targetUrls.length, chunks: urlChunks.length, chunkSize },
        'Running parallel Katana instances'
      );

      // Update progress before crawling
      await this.updateJobProgress(job.id!, {
        current: 0,
        total: targetUrls.length,
        percentage: 0,
        currentTool: 'katana',
        toolStatus: 'running',
        message: `Crawling ${targetUrls.length} URLs with ${urlChunks.length} parallel instances`,
        details: {
          depth: depth || 1,
          parallelInstances: urlChunks.length,
          timeout: '6 minutes per instance',
        },
      });

      // Run Katana instances in parallel
      const crawlResults = await Promise.all(
        urlChunks.map(async (chunk, index) => {
          const chunkUrlsFile = path.join(tmpDir, `urls_${index}.txt`);
          const chunkOutputFile = path.join(tmpDir, `katana_output_${index}.txt`);

          await fs.writeFile(chunkUrlsFile, chunk.join('\n'));

          // Build katana command with optimized flags for maximum coverage
          let command = `${config.tools.katana} -list ${chunkUrlsFile} \
            -d ${Math.max(2, depth || 2)} \
            -jc \
            -td \
            -aff \
            -timeout 20 \
            -c 500 \
            -strategy breadth-first \
            -crawl-duration 5m \
            -silent \
            -o ${chunkOutputFile}`;

          if (options.respectRobots) {
            command += ' -kf robotstxt';
          } else {
            // Enable following redirects if not respecting robots.txt
            command += ' -dr=false';
          }

          try {
            // Timeout: 6 minutes per instance (slightly longer than 5m crawl-duration to avoid race condition)
            const result = await this.executeCommand(command, { timeout: 360000 });

            // Log command execution details
            logger.debug(
              {
                jobId: job.id,
                chunkIndex: index,
                exitCode: result.exitCode,
                stdoutLength: result.stdout?.length,
                stderrLength: result.stderr?.length,
              },
              'Katana command executed'
            );

            // Check if output file exists
            try {
              await fs.access(chunkOutputFile);
            } catch (accessError) {
              logger.warn(
                { jobId: job.id, chunkIndex: index, file: chunkOutputFile },
                'Katana output file not created'
              );
              return [];
            }

            // Read output
            const content = await fs.readFile(chunkOutputFile, 'utf-8');
            const urls = content.split('\n').filter((u) => u.trim());

            logger.info(
              { jobId: job.id, chunkIndex: index, urlCount: urls.length },
              'Katana chunk completed'
            );

            return urls;
          } catch (error: any) {
            logger.error(
              { error: error.message, chunkIndex: index, chunkSize: chunk.length },
              'Katana chunk failed'
            );
            return [];
          }
        })
      );

      // Merge all results
      const urls = crawlResults.flat().filter((u) => u.trim());

      logger.info(
        { jobId: job.id, totalUrls: urls.length, chunks: urlChunks.length },
        'All Katana instances completed'
      );

      // Update progress after crawling
      await this.updateJobProgress(job.id!, {
        current: urls.length,
        total: targetUrls.length,
        percentage: 100,
        currentTool: 'katana',
        toolStatus: 'completed',
        message: `Crawled ${urls.length} URLs from ${targetUrls.length} targets`,
        details: {
          urlsFound: urls.length,
          depth: depth || 1,
        },
      });

      // If no URLs found, return empty result
      if (urls.length === 0) {
        logger.info({ jobId: job.id }, 'Katana completed but found no URLs');
        const emptyResult = {
          totalUrls: 0,
          total_urls: 0,
          urls_found: 0,
          inserted: 0,
          s3Key: null,
          categorized: { js: 0, api: 0, forms: 0, parameterized: 0, images: 0, other: 0 },
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
        logger.debug(
          { error: e?.message || 'Module not found' },
          'Batch insert not available, using individual inserts'
        );
        batchInsertAssets = null;
      }
      // Deduplicate URLs before inserting to avoid "ON CONFLICT DO UPDATE" errors
      const uniqueUrls = [...new Set(urls)];
      const urlsToInsert = uniqueUrls.slice(0, 10000).map((url) => ({
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
               ON CONFLICT (program_id, type, value_hash) DO UPDATE
               SET last_scanned = CURRENT_TIMESTAMP`,
              [
                asset.programId,
                asset.type,
                asset.value,
                asset.source,
                JSON.stringify(asset.metadata),
              ]
            );
            inserted++;
          } catch (err) {
            // Ignore duplicates
          }
        }
      }

      const results = {
        totalUrls: urls.length,
        total_urls: urls.length, // Add snake_case for backward compatibility
        urls_found: urls.length, // Add alternative field name
        inserted,
        s3Key,
        categorized,
      };

      // 🚀 THREE-AGENT INTEGRATION: Write crawled URLs to shared memory
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && urls.length > 0) {
        try {
          const crawlFindings = urls.slice(0, 100).map((url: string) => ({
            id: uuidv4(),
            type: 'url-discovered',
            severity: 'info' as const,
            url,
            evidence: `Crawled via Katana`,
            confidence: 0.95,
            timestamp: new Date(),
            discoveredBy: `crawl-${job.id}`,
            metadata: {
              category: categorized.js > 0 ? 'javascript' : categorized.api > 0 ? 'api' : 'web',
              totalUrls: urls.length,
            },
          }));

          await sharedMemory.storeFindings(swarmId, crawlFindings);
          await sharedMemory.shareSuccess(swarmId, {
            id: uuidv4(),
            name: 'katana-crawl',
            description: `Crawled ${urls.length} URLs`,
            successRate: 0.9,
            metadata: { urlCount: urls.length, jsFiles: categorized.js },
          });

          logger.info({ swarmId, urlsShared: crawlFindings.length }, 'Crawl shared findings');
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share crawl findings');
        }
      }

      await this.updateJobStatus(job.id!, 'completed', results);
      await this.logExecution(
        job.id!,
        programId,
        'katana',
        'complete',
        'info',
        `Crawl complete: discovered ${urls.length} URLs (${categorized.js} JS, ${categorized.api} API endpoints)`
      );

      // 🚀 RICH HANDOFFS: Crawl → Specialized Agents
      const jsFiles = urls.filter((url) => url.toLowerCase().match(/\.js(\?|$|#)/i));
      const apiEndpoints = urls.filter((url) => {
        const urlLower = url.toLowerCase();
        return (
          urlLower.includes('/api/') ||
          urlLower.includes('/graphql') ||
          urlLower.includes('/v1/') ||
          urlLower.includes('/v2/') ||
          urlLower.includes('/v3/') ||
          urlLower.includes('/rest/') ||
          urlLower.match(/\.(json|xml)(\?|$)/i)
        );
      });
      const parameterizedUrls = urls.filter((url) => url.includes('?') && url.includes('='));

      // Rich handoff to Jsanalysis for JS files
      if (jsFiles.length > 0) {
        await this.handoffToJsanalysis(job.id!, programId, jsFiles, s3Key, categorized);
      }

      // Rich handoff to Apifuzz for API endpoints
      if (apiEndpoints.length > 0) {
        await this.handoffToApifuzz(job.id!, programId, apiEndpoints, s3Key, categorized);
      }

      // Rich handoff to Scanner for parameterized URLs
      if (parameterizedUrls.length > 0) {
        await this.handoffToScanner(job.id!, programId, parameterizedUrls, s3Key, categorized);
      }

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
      const urlLower = url.toLowerCase();

      // Check JS files (including with query params)
      if (urlLower.match(/\.js(\?|$)/i) || urlLower.includes('.js#')) {
        categories.js++;
      }
      // Check images (including with query params)
      else if (urlLower.match(/\.(jpg|jpeg|png|gif|svg|webp|ico|bmp|tiff)(\?|$|#)/i)) {
        categories.images++;
      }
      // Check API endpoints (before parameterized check)
      else if (
        urlLower.includes('/api/') ||
        urlLower.includes('/v1/') ||
        urlLower.includes('/v2/') ||
        urlLower.includes('/v3/') ||
        urlLower.includes('/graphql') ||
        urlLower.includes('/rest/') ||
        urlLower.includes('.json') ||
        urlLower.includes('.xml') ||
        urlLower.match(/\/(api|rest|graphql|endpoint|service)/)
      ) {
        categories.api++;
      }
      // Check forms (login, register, submit, contact, etc.)
      else if (
        urlLower.match(
          /\/(login|signin|signup|register|auth|contact|submit|form|checkout|payment)/
        ) ||
        urlLower.includes('action=') ||
        urlLower.includes('submit=')
      ) {
        categories.forms++;
      }
      // Check parameterized URLs (has query params)
      else if (url.includes('?') && url.includes('=')) {
        categories.parameterized++;
      }
      // Everything else
      else {
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
      // Handoff discovered URLs to fingerprint agent for technology detection
      await this.handoff('fingerprint', {
        toAgent: 'fingerprint',
        reason: `Crawl discovered ${urls.length} unique URLs, ready for fingerprinting and technology detection`,
        data: {
          assets: urls,
          tools: ['httpx'], // No DNS needed for URLs
          followRedirects: true,
          concurrency: 500,
        },
        priority: 7,
        metadata: {
          programId,
          parentJobId: crawlJobId,
          requestedBy: 'crawl-agent',
          discoveredUrls: urls.length,
          tags: [`url-count-${urls.length}`],
        },
      });

      logger.info(
        {
          crawlJobId,
          programId,
          urlCount: urls.length,
        },
        'Handed off discovered URLs to fingerprint agent'
      );

      await this.logExecution(
        crawlJobId,
        programId,
        'crawl',
        'handoff-fingerprint',
        'info',
        `Handed off ${urls.length} discovered URLs to fingerprint agent`
      );
    } catch (error: any) {
      logger.error({ error, crawlJobId }, 'Failed to trigger fingerprint job after crawling');
    }
  }

  /**
   * Rich handoff to Jsanalysis agent with JS file context
   */
  private async handoffToJsanalysis(
    crawlJobId: string,
    programId: string,
    jsFiles: string[],
    rawOutputFile: string,
    categorized: any
  ): Promise<void> {
    try {
      const jsJobId = uuidv4();

      await this.createRichHandoff(
        crawlJobId,
        programId,
        'jsanalysis',
        {
          parentResult: {
            totalJSFiles: jsFiles.length,
            jsFilesFile: rawOutputFile,
            crawlStatistics: {
              totalUrls:
                categorized.js +
                categorized.api +
                categorized.forms +
                categorized.parameterized +
                categorized.other,
              jsFiles: categorized.js,
              apiEndpoints: categorized.api,
              formsDiscovered: categorized.forms,
            },
            jsFileUrls: jsFiles.slice(0, 100), // Include sample for context
          },
          reasoning: {
            trigger: 'javascript-files-discovered',
            confidence: 0.92,
            alternatives: ['skip-js-analysis', 'manual-js-review'],
            decisionFactors: [
              `Discovered ${jsFiles.length} JavaScript files during crawling`,
              'JS analysis can find DOM sinks, API endpoints, sensitive data, and authentication flows',
              'Automated analysis critical for identifying client-side vulnerabilities',
            ],
          },
          objectives: {
            primary:
              'Extract DOM sinks, API endpoints, secrets, and authentication logic from JavaScript files',
            secondary: [
              'Identify dangerous DOM sinks (innerHTML, eval, etc.)',
              'Extract API endpoints and authentication flows',
              'Detect hardcoded secrets, API keys, and tokens',
              'Map client-side routing and state management',
            ],
            avoid: [
              'Analyzing minified libraries without deobfuscation',
              'Missing custom application logic in framework code',
              'Rate limit violations when fetching large JS files',
            ],
          },
          successCriteria: {
            minAssets: Math.floor(jsFiles.length * 0.5), // At least 50% analyzed
            maxDuration: jsFiles.length * 3, // 3 seconds per JS file
            requiredFields: ['url', 'domSinks', 'apiEndpoints'],
            qualityThreshold: 0.75,
          },
          inherited: {
            programId,
            rateLimit: 200, // Higher rate for fetching JS files
            timeout: jsFiles.length * 3000,
            safetyChecks: true,
            budget: { timeSeconds: jsFiles.length * 3 },
          },
        },
        {
          format: 'js-analysis-result',
          requiredFields: ['analyzed', 'domSinks', 'apiEndpoints', 'secrets'],
          shouldTriggerNextHandoff: true,
          expectedVolume: jsFiles.length,
        }
      );

      await queue.addJob('jsanalysis', {
        id: jsJobId,
        type: 'jsanalysis',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          crawlJobId,
          rawOutputFile,
          jsFiles: jsFiles.slice(0, 1000), // Limit to 1000 JS files
        },
        metadata: {
          requestedBy: 'crawl-agent',
          handoffOrigin: 'rich-handoff',
          jsFilesCount: jsFiles.length,
        },
        createdAt: new Date(),
      });

      logger.info({ jsFiles: jsFiles.length, jsJobId }, '🤝 Rich handoff: Crawl → Jsanalysis');
    } catch (error: any) {
      logger.error({ error }, 'Failed rich handoff to Jsanalysis agent');
    }
  }

  /**
   * Rich handoff to Apifuzz agent with API endpoint context
   */
  private async handoffToApifuzz(
    crawlJobId: string,
    programId: string,
    apiEndpoints: string[],
    rawOutputFile: string,
    categorized: any
  ): Promise<void> {
    try {
      const apifuzzJobId = uuidv4();

      await this.createRichHandoff(
        crawlJobId,
        programId,
        'apifuzz',
        {
          parentResult: {
            totalAPIEndpoints: apiEndpoints.length,
            apiEndpointsFile: rawOutputFile,
            crawlStatistics: categorized,
            endpointTypes: {
              rest: apiEndpoints.filter((url) => url.includes('/api/') || url.includes('/rest/'))
                .length,
              graphql: apiEndpoints.filter((url) => url.includes('/graphql')).length,
              json: apiEndpoints.filter((url) => url.includes('.json')).length,
              xml: apiEndpoints.filter((url) => url.includes('.xml')).length,
            },
            sampleEndpoints: apiEndpoints.slice(0, 20),
          },
          reasoning: {
            trigger: 'api-endpoints-discovered',
            confidence: 0.88,
            alternatives: ['skip-api-fuzzing', 'manual-api-testing'],
            decisionFactors: [
              `Discovered ${apiEndpoints.length} API endpoints during crawling`,
              'API fuzzing can identify authentication bypass, IDOR, parameter injection',
              'REST and GraphQL endpoints often have high-impact vulnerabilities',
            ],
          },
          objectives: {
            primary: 'Fuzz API endpoints to discover authentication bypass, IDOR, injection flaws',
            secondary: [
              'Test REST API authentication and authorization',
              'Fuzz GraphQL introspection and mutations',
              'Identify parameter injection (XSS, SQLi in API params)',
              'Discover IDOR via ID enumeration',
            ],
            avoid: [
              'Rate limit violations causing IP blocks',
              'Destructive mutations on GraphQL endpoints',
              'Testing authenticated endpoints without valid tokens',
            ],
          },
          successCriteria: {
            minAssets: Math.floor(apiEndpoints.length * 0.3), // 30% coverage
            maxDuration: apiEndpoints.length * 10, // 10 seconds per endpoint
            requiredFields: ['url', 'method', 'statusCode'],
            qualityThreshold: 0.7,
          },
          inherited: {
            programId,
            rateLimit: 100, // Conservative for API fuzzing
            timeout: apiEndpoints.length * 10000,
            safetyChecks: true,
            budget: { timeSeconds: apiEndpoints.length * 10 },
          },
        },
        {
          format: 'api-fuzz-result',
          requiredFields: ['tested', 'vulnerabilities', 'authentication'],
          shouldTriggerNextHandoff: true,
          expectedVolume: apiEndpoints.length,
        }
      );

      await queue.addJob('apifuzz', {
        id: apifuzzJobId,
        type: 'apifuzz',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          crawlJobId,
          rawOutputFile,
          targets: apiEndpoints.slice(0, 500), // Limit to 500 endpoints
        },
        metadata: {
          requestedBy: 'crawl-agent',
          handoffOrigin: 'rich-handoff',
          apiEndpointsCount: apiEndpoints.length,
        },
        createdAt: new Date(),
      });

      logger.info(
        { apiEndpoints: apiEndpoints.length, apifuzzJobId },
        '🤝 Rich handoff: Crawl → Apifuzz'
      );
    } catch (error: any) {
      logger.error({ error }, 'Failed rich handoff to Apifuzz agent');
    }
  }

  /**
   * Rich handoff to Scanner agent with parameterized URL context
   */
  private async handoffToScanner(
    crawlJobId: string,
    programId: string,
    parameterizedUrls: string[],
    rawOutputFile: string,
    categorized: any
  ): Promise<void> {
    try {
      const scannerJobId = uuidv4();

      await this.createRichHandoff(
        crawlJobId,
        programId,
        'scanner',
        {
          parentResult: {
            totalParameterizedUrls: parameterizedUrls.length,
            urlsFile: rawOutputFile,
            crawlStatistics: categorized,
            parameterAnalysis: {
              uniqueParams: [
                ...new Set(
                  parameterizedUrls.flatMap((url) => {
                    const params = new URL(url).searchParams;
                    return Array.from(params.keys());
                  })
                ),
              ].slice(0, 50),
              totalParams: parameterizedUrls.reduce((sum, url) => {
                return sum + new URL(url).searchParams.size;
              }, 0),
            },
            sampleUrls: parameterizedUrls.slice(0, 20),
          },
          reasoning: {
            trigger: 'parameterized-urls-discovered',
            confidence: 0.9,
            alternatives: ['skip-scanning', 'manual-parameter-testing'],
            decisionFactors: [
              `Discovered ${parameterizedUrls.length} URLs with query parameters during crawling`,
              'Parameterized URLs are prime targets for injection vulnerabilities',
              'Automated scanning critical for comprehensive parameter coverage',
            ],
          },
          objectives: {
            primary:
              'Scan parameterized URLs for injection vulnerabilities (XSS, SQLi, SSRF, etc.)',
            secondary: [
              'Test each query parameter for XSS, SQLi, and SSRF',
              'Identify reflected parameters and injection points',
              'Detect IDOR via parameter manipulation',
              'Find open redirects and URL-based attacks',
            ],
            avoid: [
              'Scanning logout or destructive endpoints',
              'Rate limit violations',
              'Missing context-specific injection techniques',
            ],
          },
          successCriteria: {
            minAssets: Math.floor(parameterizedUrls.length * 0.4), // 40% coverage
            maxDuration: parameterizedUrls.length * 5, // 5 seconds per URL
            requiredFields: ['url', 'findings', 'scannedParams'],
            qualityThreshold: 0.8,
          },
          inherited: {
            programId,
            rateLimit: 150,
            timeout: parameterizedUrls.length * 5000,
            safetyChecks: true,
            budget: { timeSeconds: parameterizedUrls.length * 5 },
          },
        },
        {
          format: 'scanner-result',
          requiredFields: ['scanned', 'findings', 'bySeverity'],
          shouldTriggerNextHandoff: true,
          expectedVolume: parameterizedUrls.length,
        }
      );

      // Create scanner job with URLs file
      const urlsContent = parameterizedUrls.join('\n');
      const s3Key = await storage.uploadText(
        storage.generateKey(programId, 'crawl', `${crawlJobId}-parameterized.txt`),
        urlsContent
      );

      await queue.addJob('scanner', {
        id: scannerJobId,
        type: 'scanner',
        programId,
        priority: 8,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          crawlJobId,
          inputUrlsFile: s3Key,
          templateSet: 'fast',
          tier: 'tier1',
        },
        metadata: {
          requestedBy: 'crawl-agent',
          handoffOrigin: 'rich-handoff',
          parameterizedUrlsCount: parameterizedUrls.length,
        },
        createdAt: new Date(),
      });

      logger.info(
        { parameterizedUrls: parameterizedUrls.length, scannerJobId },
        '🤝 Rich handoff: Crawl → Scanner'
      );
    } catch (error: any) {
      logger.error({ error }, 'Failed rich handoff to Scanner agent');
    }
  }
}
