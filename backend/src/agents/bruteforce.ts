import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BruteforceJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import tmp from 'tmp';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';

/**
 * Bruteforce Agent
 * Active DNS subdomain bruteforce using:
 * - Shuffledns + Massdns (fast DNS resolution)
 * - Alterx (permutation generation)
 * - Custom wordlists
 */
export class BruteforceAgent extends BaseAgent<BruteforceJob> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('bruteforce');
  }
  protected getSteps() {
    return [
      {
        name: 'Load domains and wordlists',
        metadata: {},
      },
      {
        name: 'DNS bruteforce (massdns/shuffledns)',
        metadata: {},
      },
      {
        name: 'Validate discovered subdomains',
        metadata: {},
      },
      {
        name: 'Store results in database',
        metadata: {},
      },
    ];
  }

  async process(job: Job<BruteforceJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'bruteforce',
      'start',
      'info',
      `Starting DNS bruteforce for ${options.domains.length} domains`
    );

    try {
      const allSubdomains = new Set<string>();

      // Run each tool
      for (const tool of options.tools) {
        try {
          let subdomains: string[] = [];

          switch (tool) {
            case 'shuffledns':
              subdomains = await this.runShuffledns(
                options.domains,
                options.wordlists,
                options.resolvers,
                options.concurrency,
                job.id!,
                programId
              );
              break;
            case 'massdns':
              subdomains = await this.runMassdns(
                options.domains,
                options.wordlists,
                options.resolvers,
                job.id!,
                programId
              );
              break;
            case 'alterx':
              subdomains = await this.runAlterx(options.domains, job.id!, programId);
              break;
          }

          subdomains.forEach((s) => allSubdomains.add(s));

          await this.logExecution(
            job.id!,
            programId,
            tool,
            'complete',
            'info',
            `Found ${subdomains.length} subdomains`
          );
        } catch (error: any) {
          await this.logExecution(
            job.id!,
            programId,
            tool,
            'error',
            'error',
            `Failed: ${error.message}`
          );
        }
      }

      // Batch insert subdomains (100-1000x faster)
      const { batchInsertAssets } = require('../utils/batch-insert');
      const assetsToInsert = Array.from(allSubdomains).map((subdomain) => ({
        programId,
        type: 'subdomain',
        value: subdomain,
        source: 'bruteforce',
        metadata: { method: 'dns_bruteforce' },
      }));

      const inserted = await batchInsertAssets(assetsToInsert);

      const result = {
        totalFound: allSubdomains.size,
        inserted,
        tools: Object.fromEntries(options.tools.map((t) => [t, 'completed'])),
      };

      // 🚀 THREE-AGENT INTEGRATION: Write bruteforced subdomains to shared memory
      const swarmData = job.data as any;
      const { swarmId, enableSharedMemory } = swarmData;
      const subdomainArray = Array.from(allSubdomains);

      if (swarmId && enableSharedMemory && subdomainArray.length > 0) {
        try {
          const bruteforceFindings = subdomainArray.map((subdomain) => ({
            id: uuidv4(),
            type: 'subdomain-bruteforce',
            severity: 'info' as const,
            url: `https://${subdomain}`,
            evidence: `Discovered via DNS bruteforce: ${options.tools.join(', ')}`,
            confidence: 0.9,
            timestamp: new Date(),
            discoveredBy: `bruteforce-${job.id}`,
            metadata: {
              subdomain,
              method: 'active-bruteforce',
              tools: options.tools,
            },
          }));

          await sharedMemory.storeFindings(swarmId, bruteforceFindings);

          // Share successful bruteforce techniques
          for (const tool of options.tools) {
            await sharedMemory.shareSuccess(swarmId, {
              id: uuidv4(),
              name: `bruteforce-${tool}`,
              description: `${tool} discovered ${subdomainArray.length} subdomains`,
              successRate: 0.85,
              metadata: { tool, count: subdomainArray.length, source: 'bruteforce-agent' },
            });
          }

          logger.info(
            {
              swarmId,
              bruteforcedSubdomains: subdomainArray.length,
              tools: options.tools,
            },
            '🔗 Bruteforce agent shared findings with swarm'
          );
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share bruteforce findings');
        }
      }

      await this.updateJobStatus(job.id!, 'completed', result);
      await this.logExecution(
        job.id!,
        programId,
        'bruteforce',
        'complete',
        'info',
        `Bruteforce complete: ${inserted} new subdomains discovered`
      );

      // 🎯 RICH HANDOFF: Send brute-forced subdomains to Discovery agent for validation
      if (inserted > 0 && subdomainArray.length > 0) {
        await this.handoffToDiscovery(job.id!, programId, subdomainArray, result, options.tools);
      }

      return result;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async runShuffledns(
    domains: string[],
    wordlists: string[],
    resolvers: string[],
    concurrency: number,
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shuffledns-'));
    const domainsFile = path.join(tmpDir, 'domains.txt');
    const wordlistFile = path.join(tmpDir, 'wordlist.txt');
    const resolversFile = path.join(tmpDir, 'resolvers.txt');
    const outputFile = path.join(tmpDir, 'output.txt');

    await fs.writeFile(domainsFile, domains.join('\n'));
    await fs.writeFile(wordlistFile, wordlists.join('\n'));
    await fs.writeFile(resolversFile, resolvers.join('\n'));

    const command = `${config.tools.shuffledns} -d ${domainsFile} -w ${wordlistFile} -r ${resolversFile} -t 500 -o ${outputFile}`;

    const result = await this.executeCommand(command, { timeout: 1800000 }); // 30 min

    let subdomains: string[] = [];
    if (result.exitCode === 0) {
      const content = await fs.readFile(outputFile, 'utf-8');
      subdomains = content.split('\n').filter((l) => l.trim());
    }

    await fs.rm(tmpDir, { recursive: true });
    return subdomains;
  }

  private async runMassdns(
    domains: string[],
    wordlists: string[],
    resolvers: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'massdns-'));
    const domainsFile = path.join(tmpDir, 'domains.txt');
    const resolversFile = path.join(tmpDir, 'resolvers.txt');
    const outputFile = path.join(tmpDir, 'output.txt');

    // Generate full subdomain list by combining wordlist with domains
    const fullDomains: string[] = [];
    for (const domain of domains) {
      for (const word of wordlists) {
        fullDomains.push(`${word}.${domain}`);
      }
    }

    await fs.writeFile(domainsFile, fullDomains.join('\n'));
    await fs.writeFile(resolversFile, resolvers.join('\n'));

    // Massdns command: resolve all subdomains using provided resolvers
    // -r = resolver file, -t A = query type, -o S = simple output format, -w = output file
    const command = `${config.tools.massdns} -r ${resolversFile} -t A -o S -w ${outputFile} ${domainsFile}`;

    const result = await this.executeCommand(command, { timeout: 1800000 }); // 30 min

    let subdomains: string[] = [];
    if (result.exitCode === 0) {
      const content = await fs.readFile(outputFile, 'utf-8');
      // Parse massdns output format: "subdomain.domain.com. A ip.address"
      // Extract only the subdomain part (first column, remove trailing dot)
      subdomains = content
        .split('\n')
        .filter((l) => l.trim() && l.includes(' A '))
        .map((line) => {
          const parts = line.split(' ');
          return parts[0].replace(/\.$/, ''); // Remove trailing dot
        })
        .filter((s) => s);
    }

    await fs.rm(tmpDir, { recursive: true });
    return subdomains;
  }

  private async runAlterx(domains: string[], jobId: string, programId: string): Promise<string[]> {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'alterx-'));
    const inputFile = path.join(tmpDir, 'domains.txt');
    const outputFile = path.join(tmpDir, 'permutations.txt');

    await fs.writeFile(inputFile, domains.join('\n'));

    const command = `alterx -l ${inputFile} -o ${outputFile}`;
    const result = await this.executeCommand(command);

    let permutations: string[] = [];
    if (result.exitCode === 0) {
      const content = await fs.readFile(outputFile, 'utf-8');
      permutations = content.split('\n').filter((l) => l.trim());
    }

    await fs.rm(tmpDir, { recursive: true });
    return permutations;
  }

  /**
   * 🎯 RICH HANDOFF: Bruteforce → Discovery
   * Hands off brute-forced subdomains for HTTP probing and alive validation
   */
  private async handoffToDiscovery(
    bruteforceJobId: string,
    programId: string,
    subdomains: string[],
    results: any,
    tools: string[]
  ): Promise<void> {
    const uniqueDomains = new Set(subdomains.map((s) => s.split('.').slice(-2).join('.')));
    const byTool = {
      tools: tools.join(', '),
      total: subdomains.length,
    };

    const outputContract = {
      validationMethods: ['http-probe', 'https-probe', 'dns-validation'],
      requiredEvidence: ['status-code', 'response-time', 'ip-address'],
      minConfidence: 0.9,
      maxDuration: 600, // 10 minutes
    };

    await this.createRichHandoff(
      bruteforceJobId,
      programId,
      'discovery',
      {
        parentResult: {
          agentType: 'bruteforce',
          summary: {
            totalSubdomains: subdomains.length,
            newSubdomains: results.inserted,
            uniqueBaseDomains: uniqueDomains.size,
          },
          subdomains,
          byTool,
          enumerationMethod: 'active-bruteforce',
          tools,
        },
        reasoning: {
          trigger: `Brute-forced ${subdomains.length} subdomains via active DNS enumeration`,
          confidence: 0.9,
          alternatives: [
            'Skip validation (risk: many non-web services)',
            'Manual validation (slower)',
            'Automated HTTP/HTTPS probing (recommended)',
          ],
          decisionFactors: [
            `${subdomains.length} brute-forced subdomains need alive validation`,
            `${results.inserted} new subdomains discovered (not duplicates)`,
            `${uniqueDomains.size} unique base domains detected`,
            'Active bruteforce has ~60-80% alive rate (better than passive)',
            'HTTP probing required to identify web services',
            `Tools used: ${tools.join(', ')}`,
          ],
        },
        objectives: {
          primary: 'Validate which brute-forced subdomains are alive and accessible via HTTP/HTTPS',
          secondary: [
            'Probe HTTP and HTTPS for all brute-forced subdomains',
            'Capture status codes and response times',
            'Identify web services vs non-web services (SSH, FTP, etc.)',
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
            aliveRate: 0.6, // Expect 60%+ alive rate (higher than passive)
            probeSuccess: 0.95, // 95% must be probed (not error)
            dnsResolution: 0.95, // 95%+ must resolve DNS (bruteforce already validated DNS)
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
        bruteforceJobId,
        programId,
        subdomains: subdomains.length,
        newSubdomains: results.inserted,
        tools: tools.join(', '),
        uniqueDomains: uniqueDomains.size,
      },
      '🔗 Bruteforce agent initiated rich handoff to Discovery'
    );
  }
}
