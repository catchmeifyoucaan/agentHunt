import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { PortScanJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import fs from 'fs/promises';

/**
 * Port Scan Agent
 * Fast port scanning with service detection using Naabu
 */
export class PortScanAgent extends BaseAgent<PortScanJob> {
  constructor() {
    super('portscan');
  }

  async process(job: Job<PortScanJob>): Promise<any> {
    const { programId, options } = job.data;
    const { targets, ports = 'top-100', rate = 1000 } = options;

    if (!targets || targets.length === 0) {
      throw new Error('No targets provided for port scanning');
    }

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const tmpFile = `/tmp/naabu_${Date.now()}.json`;
    const targetsFile = `/tmp/targets_${Date.now()}.txt`;

    try {
      await fs.writeFile(targetsFile, targets.join('\n'));

      const command = `${config.tools.naabu} \
        -list ${targetsFile} \
        -p ${ports} \
        -rate ${rate} \
        -json \
        -o ${tmpFile}`;

      const result = await this.executeCommand(command, { timeout: 600000 });

      // Check exit code - naabu returns 0 on success
      if (result.exitCode !== 0) {
        throw new Error(`Naabu failed with exit code ${result.exitCode}: ${result.stderr}`);
      }

      const content = await fs.readFile(tmpFile, 'utf-8');
      const findings = this.parseJsonLines(content);

      for (const finding of findings) {
        await database.query(
          `INSERT INTO assets (program_id, type, value, source, metadata)
           VALUES ($1, 'port', $2, ARRAY['naabu'], $3::jsonb)
           ON CONFLICT DO NOTHING`,
          [
            programId,
            `${finding.host}:${finding.port}`,
            JSON.stringify({ service: finding.service, banner: finding.banner }),
          ]
        );
      }

      await this.updateJobStatus(job.id!, 'completed', {
        portsFound: findings.length,
      });

      return { success: true, portsFound: findings.length };
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    } finally {
      // Cleanup temp files
      try {
        await fs.unlink(tmpFile).catch(() => {});
        await fs.unlink(targetsFile).catch(() => {});
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }
}
