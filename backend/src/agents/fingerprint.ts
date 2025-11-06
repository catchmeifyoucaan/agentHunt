import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { FingerprintJob, AssetMetadata } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
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
      `Starting fingerprint for ${options.assets.length} assets`
    );

    try {
      // Create temp file with assets
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fingerprint-'));
      const assetsFile = path.join(tmpDir, 'assets.txt');
      await fs.writeFile(assetsFile, options.assets.join('\n'));

      const results: any = {
        total: options.assets.length,
        alive: 0,
        withTech: 0,
        cdn: 0,
      };

      // Run httpx
      if (options.tools.includes('httpx')) {
        const httpxResults = await this.runHttpx(assetsFile, jobId, programId, options);
        results.httpx = httpxResults;
        results.alive = httpxResults.length;
      }

      // Run tlsx for TLS info
      if (options.tools.includes('tlsx')) {
        const tlsxResults = await this.runTlsx(assetsFile, jobId, programId);
        results.tlsx = tlsxResults.length;
      }

      // Save metadata to assets
      let updated = 0;
      for (const asset of options.assets) {
        const metadata: AssetMetadata = {};

        // Find httpx result
        if (results.httpx) {
          const httpxResult = results.httpx.find(
            (r: any) => r.host === asset || r.url?.includes(asset)
          );
          if (httpxResult) {
            metadata.httpStatus = httpxResult.status_code;
            metadata.title = httpxResult.title;
            metadata.server = httpxResult.server?.[0];
            metadata.technologies = httpxResult.tech || [];
            if (httpxResult.cdn) {
              metadata.cdn = httpxResult.cdn;
              results.cdn++;
            }
          }
        }

        // Update asset
        try {
          await database.query(
            `UPDATE assets
             SET metadata = metadata || $1::jsonb,
                 last_scanned = CURRENT_TIMESTAMP
             WHERE program_id = $2 AND value = $3`,
            [JSON.stringify(metadata), programId, asset]
          );
          updated++;

          if (Object.keys(metadata).length > 1) {
            results.withTech++;
          }
        } catch (error) {
          logger.error({ error, asset }, 'Failed to update asset metadata');
        }
      }

      // Cleanup
      await fs.rm(tmpDir, { recursive: true });

      await this.updateJobStatus(job.id!, 'completed', results);
      await this.logExecution(
        job.id!,
        programId,
        'fingerprint',
        'complete',
        'info',
        `Fingerprinted ${results.alive} alive hosts, ${results.withTech} with tech stack`
      );

      return results;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async runHttpx(
    assetsFile: string,
    jobId: string,
    programId: string,
    options: FingerprintJob['options']
  ): Promise<any[]> {
    const outputFile = `${assetsFile}.httpx.json`;

    const command = `${config.tools.httpx} -l ${assetsFile} \
      -status-code -title -tech-detect -server -cdn \
      -follow-redirects=${options.followRedirects} \
      -threads ${options.concurrency} \
      -timeout 10 \
      -json -o ${outputFile}`;

    const result = await this.executeCommand(command);

    if (result.exitCode === 0 || result.exitCode === 1) {
      // httpx returns 1 if some hosts fail
      try {
        const content = await fs.readFile(outputFile, 'utf-8');
        const lines = this.parseJsonLines(content);
        await this.saveOutput(programId, 'httpx', content, 'json');
        return lines;
      } catch (error) {
        logger.error({ error }, 'Failed to parse httpx output');
        return [];
      }
    }

    return [];
  }

  private async runTlsx(assetsFile: string, jobId: string, programId: string): Promise<any[]> {
    const outputFile = `${assetsFile}.tlsx.json`;

    const command = `${config.tools.tlsx} -l ${assetsFile} \
      -json -o ${outputFile}`;

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
}
