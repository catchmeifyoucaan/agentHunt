import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { DiscoveryJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';

/**
 * Discovery Agent
 * Responsible for finding subdomains using passive sources:
 * - Chaos DB (ProjectDiscovery)
 * - Subfinder
 * - Uncover
 * - Cloudlist
 */
export class DiscoveryAgent extends BaseAgent<DiscoveryJob> {
  constructor() {
    super('discovery');
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

      // Run discovery tools
      for (const source of options.sources) {
        try {
          const subdomains = await this.runSource(source, domains, job.id!, programId);
          subdomains.forEach((subdomain) => {
            allSubdomains.add(subdomain);
            if (!sourceMap.has(subdomain)) {
              sourceMap.set(subdomain, []);
            }
            sourceMap.get(subdomain)!.push(source);
          });

          await this.logExecution(
            job.id!,
            programId,
            source,
            'complete',
            'info',
            `Found ${subdomains.length} subdomains`
          );
        } catch (error: any) {
          await this.logExecution(
            job.id!,
            programId,
            source,
            'error',
            'error',
            `Failed: ${error.message}`
          );
        }
      }

      // Filter to respect max_assets limit
      const subdomainArray = Array.from(allSubdomains).slice(0, options.maxAssets);

      // Save to database
      let inserted = 0;
      for (const subdomain of subdomainArray) {
        try {
          await database.query(
            `INSERT INTO assets (program_id, type, value, source, status, metadata)
             VALUES ($1, $2, $3, $4, 'active', '{}')
             ON CONFLICT (program_id, value, type) DO UPDATE
             SET source = array_cat(assets.source, $4::text[]),
                 last_seen = CURRENT_TIMESTAMP`,
            [programId, 'subdomain', subdomain, sourceMap.get(subdomain)]
          );
          inserted++;
        } catch (error) {
          logger.error({ error, subdomain }, 'Failed to insert asset');
        }
      }

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

      await this.updateJobStatus(job.id!, 'completed', result);
      await this.logExecution(
        job.id!,
        programId,
        'discovery',
        'complete',
        'info',
        `Discovery complete: ${inserted} assets saved`
      );

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

    const subdomains: string[] = [];

    for (const domain of domains) {
      const command = `${config.tools.chaosClient} -d ${domain} -key ${config.chaos.apiKey} -silent -json`;
      const result = await this.executeCommand(command);

      if (result.exitCode === 0) {
        const lines = this.parseJsonLines(result.stdout);
        lines.forEach((line) => {
          if (line.subdomain) {
            subdomains.push(line.subdomain);
          }
        });
      }
    }

    return [...new Set(subdomains)];
  }

  private async runSubfinder(
    domains: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const subdomains: string[] = [];

    for (const domain of domains) {
      const command = `${config.tools.subfinder} -d ${domain} -silent -all -recursive`;
      const result = await this.executeCommand(command);

      if (result.exitCode === 0) {
        const lines = result.stdout.split('\n').filter((l) => l.trim());
        subdomains.push(...lines);
      }
    }

    return [...new Set(subdomains)];
  }

  private async runUncover(
    domains: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const subdomains: string[] = [];

    for (const domain of domains) {
      const command = `uncover -q ${domain} -silent -e shodan,censys,fofa`;
      const result = await this.executeCommand(command);

      if (result.exitCode === 0) {
        const lines = result.stdout.split('\n').filter((l) => l.trim());
        subdomains.push(...lines);
      }
    }

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
}
