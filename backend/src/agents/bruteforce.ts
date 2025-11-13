import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BruteforceJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import tmp from 'tmp';

/**
 * Bruteforce Agent
 * Active DNS subdomain bruteforce using:
 * - Shuffledns + Massdns (fast DNS resolution)
 * - Alterx (permutation generation)
 * - Custom wordlists
 */
export class BruteforceAgent extends BaseAgent<BruteforceJob> {
  constructor() {
    super('bruteforce');
  }
  protected getSteps() {
    return [
      {
            name: "Load domains and wordlists",
            metadata: {}
      },
      {
            name: "DNS bruteforce (massdns/shuffledns)",
            metadata: {}
      },
      {
            name: "Validate discovered subdomains",
            metadata: {}
      },
      {
            name: "Store results in database",
            metadata: {}
      }
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

      await this.updateJobStatus(job.id!, 'completed', result);
      await this.logExecution(
        job.id!,
        programId,
        'bruteforce',
        'complete',
        'info',
        `Bruteforce complete: ${inserted} new subdomains discovered`
      );

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
}
