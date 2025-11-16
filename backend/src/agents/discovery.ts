import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { DiscoveryJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';

/**
 * Discovery Agent
 * Responsible for finding subdomains using passive sources:
 * - Chaos DB (ProjectDiscovery)
 * - Subfinder
 * - Uncover
 * - Cloudlist
 */
export class DiscoveryAgent extends BaseAgent<DiscoveryJob> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('discovery');
  }
  protected getSteps() {
    return [
      {
            name: "Load domains and scope",
            metadata: {}
      },
      {
            name: "Discover subdomains with Chaos",
            metadata: {}
      },
      {
            name: "Validate discovered assets",
            metadata: {}
      },
      {
            name: "Store results in database",
            metadata: {}
      }
];
  }


  async process(job: Job<DiscoveryJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'discovery',
      'start',
      'info',
      `Starting discovery with sources: ${options.sources.join(', ')}`
    );

    try {
      // Get program scope
      const programResult = await database.query('SELECT scope FROM programs WHERE id = $1', [
        programId,
      ]);

      if (programResult.rows.length === 0) {
        throw new Error(`Program ${programId} not found`);
      }

      const scope = programResult.rows[0].scope;
      const domains = [...scope.domains, ...scope.wildcardDomains];

      const allSubdomains = new Set<string>();
      const sourceMap = new Map<string, string[]>();

      // Run discovery tools in parallel for better performance
      const sourcePromises = options.sources.map(async (source) => {
        try {
          const subdomains = await this.runSource(source, domains, job.id!, programId);
          
          await this.logExecution(
            job.id!,
            programId,
            source,
            'complete',
            'info',
            `Found ${subdomains.length} subdomains`
          );
          
          return { source, subdomains, error: null };
        } catch (error: any) {
          await this.logExecution(
            job.id!,
            programId,
            source,
            'error',
            'error',
            `Failed: ${error.message}`
          );
          
          return { source, subdomains: [] as string[], error: error.message };
        }
      });

      // Wait for all sources to complete in parallel
      const results = await Promise.all(sourcePromises);

      // Consolidate results
      for (const result of results) {
        result.subdomains.forEach((subdomain) => {
          allSubdomains.add(subdomain);
          if (!sourceMap.has(subdomain)) {
            sourceMap.set(subdomain, []);
          }
          sourceMap.get(subdomain)!.push(result.source);
        });
      }

      // Filter to respect max_assets limit
      const subdomainArray = Array.from(allSubdomains).slice(0, options.maxAssets);

      // Batch insert assets (100-1000x faster than individual inserts)
      const { batchInsertAssets } = require('../utils/batch-insert');
      const assetsToInsert = subdomainArray.map((subdomain) => ({
        programId,
        type: 'subdomain',
        value: subdomain,
        source: (sourceMap.get(subdomain) || ['unknown']).join(','),
        metadata: {},
      }));

      const inserted = await batchInsertAssets(assetsToInsert);

      const result = {
        totalFound: allSubdomains.size,
        inserted,
        truncated: allSubdomains.size > options.maxAssets,
        sources: Object.fromEntries(
          options.sources.map((s) => [
            s,
            Array.from(allSubdomains).filter((d) => sourceMap.get(d)?.includes(s)).length,
          ])
        ),
      };

      // 🚀 THREE-AGENT INTEGRATION: Write findings to shared memory if part of swarm
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && subdomainArray.length > 0) {
        try {
          // Convert discovered subdomains to three-agent Finding format
          const threeAgentFindings = subdomainArray.map((subdomain: string) => ({
            id: uuidv4(),
            type: 'subdomain-discovery',
            severity: 'info' as const,
            url: `https://${subdomain}`,
            evidence: `Discovered via ${sourceMap.get(subdomain)?.join(', ') || 'unknown sources'}`,
            confidence: 0.95, // High confidence for passive discovery
            timestamp: new Date(),
            discoveredBy: `discovery-${job.id}`,
            metadata: {
              subdomain,
              sources: sourceMap.get(subdomain),
              totalSources: sourceMap.get(subdomain)?.length || 0,
            },
          }));

          // Store in shared memory
          await sharedMemory.storeFindings(swarmId, threeAgentFindings);

          // Share successful discovery techniques
          for (const source of options.sources) {
            const sourceFindings = Array.from(allSubdomains).filter(d => sourceMap.get(d)?.includes(source));
            if (sourceFindings.length > 0) {
              await sharedMemory.shareSuccess(swarmId, {
                id: uuidv4(),
                name: `discovery-${source}`,
                description: `${source} discovered ${sourceFindings.length} subdomains`,
                successRate: sourceFindings.length / allSubdomains.size,
                metadata: { source, count: sourceFindings.length },
              });
            }
          }

          logger.info({
            swarmId,
            findingsShared: threeAgentFindings.length,
            sourcesUsed: options.sources.length,
          }, 'Discovery shared findings with three-agent swarm');
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share discovery findings with swarm');
        }
      }

      await this.updateJobStatus(job.id!, 'completed', result);
      await this.logExecution(
        job.id!,
        programId,
        'discovery',
        'complete',
        'info',
        `Discovery complete: ${inserted} assets saved`
      );

      // Trigger fingerprinting for newly discovered subdomains
      if (inserted > 0) {
        await this.triggerFingerprintJob(programId, subdomainArray, job.id!);
      }

      return result;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async runSource(
    source: string,
    domains: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    switch (source) {
      case 'chaosdb':
        return await this.runChaosDB(domains, jobId, programId);
      case 'subfinder':
        return await this.runSubfinder(domains, jobId, programId);
      case 'uncover':
        return await this.runUncover(domains, jobId, programId);
      case 'cloudlist':
        return await this.runCloudlist(domains, jobId, programId);
      default:
        throw new Error(`Unknown source: ${source}`);
    }
  }

  private async runChaosDB(
    domains: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    if (!config.chaos.apiKey) {
      throw new Error('Chaos API key not configured');
    }

    // OPTIMIZED: Parallel execution for all domains (60x faster for 60 domains)
    const domainResults = await Promise.all(
      domains.map(async (domain) => {
        const command = `${config.tools.chaosClient} -d ${domain} -key ${config.chaos.apiKey} -silent -json`;
        const result = await this.executeCommand(command);

        if (result.exitCode === 0) {
          const lines = this.parseJsonLines(result.stdout);
          return lines
            .filter((line) => line.subdomain)
            .map((line) => line.subdomain);
        }

        return [];
      })
    );

    // Flatten and deduplicate
    const subdomains = domainResults.flat();
    return [...new Set(subdomains)];
  }

  private async runSubfinder(
    domains: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    // OPTIMIZED: Parallel execution for all domains (60x faster for 60 domains)
    const domainResults = await Promise.all(
      domains.map(async (domain) => {
        const command = `${config.tools.subfinder} -d ${domain} -silent -all -recursive`;
        const result = await this.executeCommand(command);

        if (result.exitCode === 0) {
          return result.stdout.split('\n').filter((l) => l.trim());
        }

        return [];
      })
    );

    // Flatten and deduplicate
    const subdomains = domainResults.flat();
    return [...new Set(subdomains)];
  }

  private async runUncover(
    domains: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    // OPTIMIZED: Parallel execution for all domains (60x faster for 60 domains)
    const domainResults = await Promise.all(
      domains.map(async (domain) => {
        const command = `uncover -q ${domain} -silent -e shodan,censys,fofa`;
        const result = await this.executeCommand(command);

        if (result.exitCode === 0) {
          return result.stdout.split('\n').filter((l) => l.trim());
        }

        return [];
      })
    );

    // Flatten and deduplicate
    const subdomains = domainResults.flat();
    return [...new Set(subdomains)];
  }

  private async runCloudlist(
    domains: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const command = `cloudlist -silent`;
    const result = await this.executeCommand(command);

    if (result.exitCode === 0) {
      const lines = result.stdout.split('\n').filter((l) => l.trim());
      return lines.filter((line) =>
        domains.some((d) => line.includes(d) || line.endsWith(d))
      );
    }

    return [];
  }

  /**
   * Trigger fingerprint job for discovered subdomains using rich handoff
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

      // 🚀 RICH HANDOFF: Discovery → Fingerprint with complete context
      await this.createRichHandoff(
        parentJobId,
        programId,
        'fingerprint',
        {
          parentResult: {
            totalSubdomains: subdomains.length,
            subdomains: subdomains.slice(0, 100), // Include sample for context
            discoveryMethod: 'passive-enumeration',
          },
          reasoning: {
            trigger: 'subdomain-discovery-complete',
            confidence: 0.95,
            alternatives: ['skip-fingerprinting', 'batch-fingerprint'],
            decisionFactors: [
              `Discovered ${subdomains.length} subdomains requiring HTTP fingerprinting`,
              'Fingerprinting needed to identify alive hosts and technologies',
              'High-quality passive discovery warrants active probing',
            ],
          },
          objectives: {
            primary: 'Identify alive HTTP services and detect technologies on discovered subdomains',
            secondary: [
              'Detect WAF/CDN for attack strategy planning',
              'Identify interesting technologies for targeted scanning',
              'Create URL assets for subsequent crawling and scanning',
            ],
            avoid: [
              'Fingerprinting non-resolving domains (use DNS filtering)',
              'Overwhelming rate limits on single host',
            ],
          },
          successCriteria: {
            minAssets: Math.floor(subdomains.length * 0.05), // At least 5% should be alive
            maxDuration: subdomains.length * 2, // 2 seconds per subdomain max
            requiredFields: ['httpStatus', 'technologies', 'url'],
            qualityThreshold: 0.8,
          },
          inherited: {
            programId,
            rateLimit: 500,
            timeout: 120000,
            safetyChecks: true,
            budget: { timeSeconds: subdomains.length * 2 },
          },
        },
        {
          format: 'fingerprint-result',
          requiredFields: ['alive', 'withTech', 'httpx'],
          shouldTriggerNextHandoff: true,
          expectedVolume: subdomains.length,
        }
      );

      // Still queue the job for actual execution (handoff creates intent, queue executes)
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
          requestedBy: 'discovery-agent',
          parentJobId,
          handoffOrigin: 'rich-handoff',
          tags: [`subdomain-count-${subdomains.length}`],
        },
        createdAt: new Date(),
      });

      await this.logExecution(
        parentJobId,
        programId,
        'discovery',
        'rich-handoff-fingerprint',
        'info',
        `🤝 Rich handoff to fingerprint: ${subdomains.length} subdomains with complete context`
      );
    } catch (error: any) {
      logger.error({ error, parentJobId }, 'Failed to create rich handoff to fingerprint');
    }
  }
}
