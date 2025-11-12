import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { PortScanJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import queue from '../services/queue';
import logger from '../utils/logger';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

/**
 * Port Scan Agent
 * Fast port scanning with service detection using Naabu
 */
export class PortScanAgent extends BaseAgent<PortScanJob> {
  constructor() {
    super('portscan');
  }

  /**
   * Map any port value to valid naabu options: 100, 1000, or full
   * Naabu only accepts these specific values
   */
  private normalizeNaabuPorts(ports: string | number): string {
    if (typeof ports === 'string') {
      if (ports === 'full') return 'full';
      if (ports.startsWith('top-')) {
        const num = parseInt(ports.replace('top-', ''), 10);
        if (Number.isNaN(num)) return 'top-1000';
        // Map to nearest valid value
        if (num <= 100) return 'top-100';
        if (num <= 1000) return 'top-1000';
        return 'full';
      }
    }
    return 'top-1000'; // default
  }

  async process(job: Job<PortScanJob>): Promise<any> {
    const { programId, options } = job.data;
    const jobMetadata: Record<string, any> = job.data.metadata || {};
    const naabuRetries = typeof jobMetadata.naabuRetries === 'number' ? jobMetadata.naabuRetries : 0;

    // Force top-1000 for speed (override user setting if full range)
    let { targets, ports = 'top-1000', rate = 2000 } = options;

    // If ports is full range (1-10000), force to top-1000 for speed
    if (typeof ports === 'string' && ports.includes('1-10000')) {
      logger.warn({ jobId: job.id, originalPorts: ports }, 'Full port range detected, using top-1000 for speed');
      ports = 'top-1000';
    }

    const chunkSize = targets?.length || 0;

    if (!targets || chunkSize === 0) {
      throw new Error('No targets provided for port scanning');
    }

    const originalRate = rate;
    if (chunkSize >= 20) {
      rate = Math.min(rate, 600);
    } else if (chunkSize >= 10) {
      rate = Math.min(rate, 800);
    } else {
      rate = Math.min(rate, 1200);
    }

    if (naabuRetries > 0) {
      const retryAdjustedRate = Math.max(150, Math.floor(rate / Math.pow(2, naabuRetries)));
      if (retryAdjustedRate < rate) {
        rate = retryAdjustedRate;
      }
    }

    if (rate !== originalRate) {
      logger.warn(
        { jobId: job.id, programId, originalRate, adjustedRate: rate, chunkSize, naabuRetries },
        'Adjusted Naabu rate to mitigate timeouts'
      );
    }

    if (naabuRetries > 0 && typeof ports === 'string' && ports.startsWith('top-')) {
      const numericTop = parseInt(ports.replace('top-', ''), 10);
      if (!Number.isNaN(numericTop)) {
        const reducedTop = Math.max(100, Math.floor(numericTop / (naabuRetries + 1)));
        if (reducedTop < numericTop) {
          // Normalize to valid naabu value
          const normalizedPorts = this.normalizeNaabuPorts(`top-${reducedTop}`);
          logger.warn(
            { jobId: job.id, programId, originalTop: numericTop, reducedTop, normalizedPorts, naabuRetries },
            'Reducing top port scope due to repeated Naabu timeouts'
          );
          ports = normalizedPorts;
        }
      }
    }

    const displayPorts = typeof ports === 'string' ? ports : options.ports || 'top-1000';

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const tmpFile = `/tmp/naabu_${Date.now()}.json`;
    const targetsFile = `/tmp/targets_${Date.now()}.txt`;

    try {
      // Step 1: DNS resolution first (filter unreachable targets)
      await this.logExecution(
        job.id!,
        programId,
        'dns-validation',
        'progress',
        'info',
        `🔍 Step 1: DNS resolution for ${targets.length} targets`
      );

      const validatedTargets = await this.validateDNS(targets, job.id!, programId);

      if (validatedTargets.length === 0) {
        await this.logExecution(
          job.id!,
          programId,
          'portscan',
          'complete',
          'warn',
          `⚠️ All ${targets.length} targets failed DNS validation - internal/unreachable hosts`
        );

        await this.updateJobStatus(job.id!, 'completed', {
          targetsScanned: targets.length,
          validated: 0,
          portsFound: 0,
          skipped: targets.length,
          note: 'All targets failed DNS validation',
        });

        return { success: true, portsFound: 0, validated: 0, skipped: targets.length };
      }

      await this.logExecution(
        job.id!,
        programId,
        'dns-validation',
        'complete',
        'info',
        `✓ Step 1 Complete: ${validatedTargets.length}/${targets.length} resolved via DNS (${targets.length - validatedTargets.length} filtered)`
      );

      // Use validated targets only for port scanning
      await fs.writeFile(targetsFile, validatedTargets.join('\n'));

      // Use top-ports by default for speed (10x faster than full range)
      // Full range (1-10000) is too slow and times out
      let portArg = '';
      if (typeof ports === 'string' && ports.startsWith('top-')) {
        // Normalize to valid naabu values (100, 1000, full)
        const normalizedPorts = this.normalizeNaabuPorts(ports);
        const topN = normalizedPorts.replace('top-', '');
        portArg = `--top-ports ${topN}`;
      } else if (typeof ports === 'string' && ports.includes('-')) {
        // Range like "1-1000"
        portArg = `-p ${ports}`;
      } else if (ports === 'full') {
        portArg = '--top-ports full';
      } else {
        // Default to top-1000 for speed
        portArg = '--top-ports 1000';
      }

        // Naabu command: rate limiting and reasonable timeout
        // -timeout is in milliseconds per host (not per port!)
        // Increase timeout per host to prevent premature timeouts
        // For top-1000 ports, need at least 60s per host
        const hostTimeout = 120000 + Math.min(naabuRetries, 2) * 60000; // increase timeout on retries

        const command = `${config.tools.naabu} \
          -list ${targetsFile} \
          ${portArg} \
          -rate ${rate} \
          -timeout ${hostTimeout} \
          -retries 1 \
          -json \
          -o ${tmpFile}`;

        // Timeout: 5 min per target (scales with target count)
        // For 100 targets: 100 * 300000 = 30,000,000ms = 500 min (cap at 20 min)
        // Reduced timeout to fail faster and prevent stuck jobs
        const timeoutMs = Math.min(900000, Math.max(180000, targets.length * 240000)); // Min 3 min, max 15 min

        // Update progress before scanning
        await this.updateJobProgress(job.id!, {
          current: 0,
          total: validatedTargets.length,
          percentage: 0,
          currentTool: 'naabu',
          toolStatus: 'running',
          message: `Step 2: Port scanning ${validatedTargets.length} DNS-validated targets`,
          details: {
            ports: displayPorts,
            rate: `${rate}/s`,
            timeout: `${Math.round(timeoutMs / 1000 / 60)} minutes`,
          },
        });

        await this.logExecution(
          job.id!,
          programId,
          'naabu',
          'progress',
          'info',
          `🔍 Step 2: Port scanning ${validatedTargets.length} DNS-validated targets (ports: ${displayPorts}, rate: ${rate}/s, timeout: ${Math.round(timeoutMs / 1000 / 60)}min)`
        );

        const result = await this.executeCommand(command, { timeout: timeoutMs });

        let findings: any[] = [];
        let naabuError = (result.stderr || '').trim();

        if (!naabuError && result.exitCode !== 0) {
          naabuError = (result.stdout || '').trim();
        }

        const outputExists = await fs
          .stat(tmpFile)
          .then(() => true)
          .catch(() => false);

        if (outputExists) {
          try {
            const rawOutput = await fs.readFile(tmpFile, 'utf-8');
            findings = this.parseJsonLines(rawOutput);
          } catch (parseError: any) {
            logger.warn({ error: parseError, jobId: job.id }, 'Port scan output parse failed');
          }
        }

        const timeoutIndicators =
          /timeout/i.test(naabuError) ||
          /Could not run enumeration/i.test(naabuError) ||
          /took too long/i.test(naabuError);

        const partialSuccess = result.exitCode !== 0 && (timeoutIndicators || findings.length > 0);

        if (findings.length) {
          const { batchInsertAssets } = require('../utils/batch-insert');
          const assetsToInsert = findings.map((finding) => ({
            programId,
            type: 'port',
            value: `${finding.host}:${finding.port}`,
            source: 'naabu',
            metadata: { service: finding.service, banner: finding.banner },
          }));

          if (assetsToInsert.length) {
            await batchInsertAssets(assetsToInsert);
          }
        }

        if (partialSuccess) {
          logger.warn(
            {
              jobId: job.id,
              programId,
              chunkSize: targets.length,
              naabuError,
              findingsCount: findings.length,
              naabuRetries,
            },
            'Naabu reported timeout but partial results were captured'
          );

          if (targets.length > 1) {
            const mid = Math.ceil(targets.length / 2);
            const firstHalf = targets.slice(0, mid);
            const secondHalf = targets.slice(mid);
            const splitRate = Math.max(200, Math.floor(rate * 0.75));
            const splitPorts = typeof ports === 'string' ? ports : options.ports;

            await this.logExecution(
              job.id!,
              programId,
              'naabu',
              'retry',
              'warn',
              `Chunk timed out; splitting into ${firstHalf.length} and ${secondHalf.length} targets`
            );

            // Generate NEW UUIDs for split jobs (don't append to existing ID!)
            await queue.addJob('portscan', {
              ...(job.data as any),
              id: uuidv4(),
              options: {
                ...options,
                targets: firstHalf,
                rate: splitRate,
                ports: splitPorts,
              },
              metadata: {
                ...(job.data.metadata || {}),
                chunkIndex: 1,
                chunkCount: 2,
                splitFrom: job.id,
                naabuRetries: 0,
              },
            } as any);

            await queue.addJob('portscan', {
              ...(job.data as any),
              id: uuidv4(),
              options: {
                ...options,
                targets: secondHalf,
                rate: splitRate,
                ports: splitPorts,
              },
              metadata: {
                ...(job.data.metadata || {}),
                chunkIndex: 2,
                chunkCount: 2,
                splitFrom: job.id,
                naabuRetries: 0,
              },
            } as any);

            await this.updateJobStatus(job.id!, 'completed', {
              portsFound: findings.length,
              partialTimeout: true,
              chunkSplit: true,
              note: 'Chunk split into smaller jobs due to timeout',
            });

            return { success: true, portsFound: findings.length, partialTimeout: true, chunkSplit: true };
          }

          if (naabuRetries < 2) {
            const retryRate = Math.max(150, Math.floor(rate / 2));
            let retryPorts = ports;
            if (typeof ports === 'string' && ports.startsWith('top-')) {
              const numericTop = parseInt(ports.replace('top-', ''), 10);
              if (!Number.isNaN(numericTop)) {
                const calculatedPorts = Math.max(100, Math.floor(numericTop / 2));
                // Normalize to valid naabu value
                retryPorts = this.normalizeNaabuPorts(`top-${calculatedPorts}`);
              }
            }

            await this.logExecution(
              job.id!,
              programId,
              'naabu',
              'retry',
              'warn',
              `Single target timed out; scheduling retry ${naabuRetries + 1} with rate ${retryRate}/s and ports ${retryPorts}`
            );

            // Generate NEW UUID for retry job (don't append to existing ID!)
            await queue.addJob('portscan', {
              ...(job.data as any),
              id: uuidv4(),
              options: {
                ...options,
                targets: [...targets],
                rate: retryRate,
                ports: retryPorts,
              },
              metadata: {
                ...(job.data.metadata || {}),
                naabuRetries: naabuRetries + 1,
                retryFrom: job.id,
              },
            } as any);

            await this.updateJobStatus(job.id!, 'completed', {
              portsFound: findings.length,
              partialTimeout: true,
              retryScheduled: true,
              retryRate: `${retryRate}/s`,
              note: `Timeout detected; scheduled retry ${naabuRetries + 1} with reduced scope`,
            });

            return {
              success: true,
              portsFound: findings.length,
              partialTimeout: true,
              retryScheduled: true,
            };
          }

          await this.updateJobStatus(job.id!, 'completed', {
            portsFound: findings.length,
            partialTimeout: true,
            timeout: true,
            note: 'Timeout detected for single target; review host-specific scan configuration',
          });
          return { success: true, portsFound: findings.length, partialTimeout: true, timeout: true };
        }

        if (result.exitCode !== 0) {
          throw new Error(`Naabu failed with exit code ${result.exitCode}: ${naabuError}`);
        }

        if (findings.length === 0) {
          logger.warn(
            { jobId: job.id, programId, targetCount: targets.length },
            'Naabu completed with no open ports detected - targets may be unreachable or heavily filtered'
          );

          await this.updateJobProgress(job.id!, {
            current: targets.length,
            total: targets.length,
            percentage: 100,
            currentTool: 'naabu',
            toolStatus: 'completed_empty',
            message: `Scanned ${targets.length} targets - no open ports found (unreachable or filtered)`,
            details: {
              portsFound: 0,
              targetCount: targets.length,
              note: 'Targets may be internal/unreachable hosts or heavily firewalled',
            },
          });
        } else {
          await this.updateJobProgress(job.id!, {
            current: validatedTargets.length,
            total: validatedTargets.length,
            percentage: 100,
            currentTool: 'naabu',
            toolStatus: 'completed',
            message: `Found ${findings.length} open ports on ${validatedTargets.length} targets`,
            details: {
              portsFound: findings.length,
            },
          });
        }

        await this.updateJobStatus(job.id!, 'completed', {
          portsFound: findings.length,
          partialTimeout: false,
          targetsScanned: validatedTargets.length,
          targetsValidated: validatedTargets.length,
          targetsFiltered: targets.length - validatedTargets.length,
        });

        return { success: true, portsFound: findings.length, partialTimeout: false };
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
