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

      // Clean domains: remove leading dots and wildcards
      const cleanDomains = options.domains.map(d => d.replace(/^[\.\*]+/, '').trim()).filter(d => d.length > 0);

      await this.logExecution(
        job.id!,
        programId,
        'subdomain',
        'progress',
        'info',
        `Cleaned domains: ${cleanDomains.length} valid domains from ${options.domains.length} inputs`
      );

      // Run subdomain enumeration tools
      for (let i = 0; i < cleanDomains.length; i++) {
        const domain = cleanDomains[i];

        await this.logExecution(
          job.id!,
          programId,
          'subdomain',
          'progress',
          'info',
          `[${i+1}/${cleanDomains.length}] Scanning domain: ${domain}`
        );

        if (options.tools.includes('subfinder')) {
          const subfinderResults = await this.runSubfinder(domain, job.id!, programId);
          subfinderResults.forEach((s) => allSubdomains.add(s));

          await this.logExecution(
            job.id!,
            programId,
            'subdomain',
            'progress',
            'info',
            `Subfinder found ${subfinderResults.length} subdomains for ${domain}`
          );
        }

        if (options.tools.includes('amass')) {
          const amassResults = await this.runAmass(domain, job.id!, programId);
          amassResults.forEach((s) => allSubdomains.add(s));

          await this.logExecution(
            job.id!,
            programId,
            'subdomain',
            'progress',
            'info',
            `Amass found ${amassResults.length} subdomains for ${domain}`
          );
        }
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

      let savedCount = 0;
      for (const subdomain of subdomains) {
        const result = await database.query(
          `INSERT INTO assets (program_id, type, value, source, discovered_at)
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
           ON CONFLICT (program_id, type, value) DO NOTHING
           RETURNING id`,
          [programId, 'subdomain', subdomain, 'subdomain-agent']
        );
        if (result.rows.length > 0) {
          savedCount++;
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
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'subfinder-'));
    const outputFile = path.join(tmpDir, 'subdomains.txt');

    const command = `${config.tools.subfinder} -d ${domain} -o ${outputFile} -all -silent`;

    const result = await this.executeCommand(command);

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
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'amass-'));
    const outputFile = path.join(tmpDir, 'subdomains.txt');

    const command = `${config.tools.amass} enum -passive -d ${domain} -o ${outputFile}`;

    const result = await this.executeCommand(command);

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
}
