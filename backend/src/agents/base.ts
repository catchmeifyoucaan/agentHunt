import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { BaseJob, AgentType } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';
import config from '../config';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

const execAsync = promisify(exec);

export abstract class BaseAgent<T extends BaseJob> {
  protected agentType: AgentType;
  protected workerId: string;

  constructor(agentType: AgentType) {
    this.agentType = agentType;
    this.workerId = `${agentType}-${uuidv4().slice(0, 8)}`;
    logger.info({ agentType, workerId: this.workerId }, 'Agent initialized');
  }

  /**
   * Main processing method - must be implemented by subclasses
   */
  abstract process(job: Job<T>): Promise<any>;

  /**
   * Execute shell command with timeout and logging
   */
  protected async executeCommand(
    command: string,
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }> {
    const startTime = Date.now();
    let stdoutBuffer = '';
    let stderrBuffer = '';
    let exitCode: number = 1;

    try {
      logger.debug({ command }, 'Executing command');

      const child = spawn(command, [], {
        shell: true,
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        timeout: options?.timeout || 300000, // 5 min default
      });

      child.stdout.on('data', (data) => {
        stdoutBuffer += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
      });

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          exitCode = code === null ? 1 : code; // Handle case where process is killed by signal
          resolve();
        });

        child.on('error', (err) => {
          stderrBuffer += `\nError: ${err.message}`;
          reject(err);
        });

        if (options?.timeout) {
          setTimeout(() => {
            if (child.pid && !child.killed) {
              child.kill(); // Terminate the process if timeout occurs
              stderrBuffer += '\nError: Command timed out';
              reject(new Error('Command timed out'));
            }
          }, options.timeout);
        }
      });

      const duration = Date.now() - startTime;

      logger.info(
        {
          command: command.split(' ')[0], // Log only the tool name
          duration,
          stdoutLength: stdoutBuffer.length,
          stderrLength: stderrBuffer.length,
          exitCode,
        },
        'Command executed successfully'
      );

      return { stdout: stdoutBuffer, stderr: stderrBuffer, exitCode, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          command,
          duration,
          error: error.message,
          exitCode,
        },
        'Command execution failed'
      );

      return {
        stdout: stdoutBuffer,
        stderr: stderrBuffer || error.message,
        exitCode,
        duration,
      };
    }
  }

  /**
   * Update job status in database
   */
  protected async updateJobStatus(
    jobId: string,
    status: BaseJob['status'],
    result?: any,
    error?: string
  ): Promise<void> {
    try {
      // Build SET clause dynamically to avoid SQL syntax errors
      const updates = ['status = $1', 'result = $2', 'error = $3'];
      if (status === 'active') {
        updates.push('started_at = CURRENT_TIMESTAMP');
      }
      if (status === 'completed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }

      await database.query(
        `UPDATE jobs SET ${updates.join(', ')} WHERE id = $4`,
        [status, result ? JSON.stringify(result) : null, error, jobId]
      );

      await events.emitJobStatus({
        id: jobId,
        status,
      } as any);
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to update job status');
    }
  }

  /**
   * Update job progress with detailed tool information
   */
  protected async updateJobProgress(
    jobId: string,
    progress: {
      current: number;
      total: number;
      percentage: number;
      currentTool?: string;
      toolStatus?: string;
      message?: string;
      details?: any;
    }
  ): Promise<void> {
    try {
      await database.query(
        `UPDATE jobs SET progress = $1 WHERE id = $2`,
        [JSON.stringify(progress), jobId]
      );

      await events.emitJobStatus({
        id: jobId,
        progress,
      } as any);
    } catch (err) {
      logger.error({ err, jobId }, 'Failed to update job progress');
    }
  }

  /**
   * Log tool execution with structured format
   */
  protected async logExecution(
    jobId: string,
    programId: string,
    tool: string,
    context: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string
  ): Promise<void> {
    await events.emitLog({
      jobId,
      programId,
      workerId: this.workerId,
      tool,
      context,
      level,
      message,
    });
  }

  /**
   * Save tool output to S3
   */
  protected async saveOutput(
    programId: string,
    tool: string,
    output: string,
    format: 'json' | 'txt' = 'txt'
  ): Promise<string> {
    const key = storage.generateKey(programId, tool, `${Date.now()}.${format}`);

    if (format === 'json') {
      try {
        const parsed = JSON.parse(output);
        return await storage.uploadJson(key, parsed);
      } catch {
        // If not valid JSON, save as text
        return await storage.uploadText(key, output);
      }
    } else {
      return await storage.uploadText(key, output);
    }
  }

  /**
   * Parse JSON Lines output from tools
   */
  protected parseJsonLines(output: string): any[] {
    return output
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((item) => item !== null);
  }

  /**
   * Check if job should be cancelled
   */
  protected async shouldCancel(jobId: string): Promise<boolean> {
    const result = await database.query('SELECT status FROM jobs WHERE id = $1', [jobId]);
    return result.rows[0]?.status === 'cancelled';
  }

  /**
   * Register worker heartbeat
   */
  protected async heartbeat(): Promise<void> {
    try {
      await database.query(
        `INSERT INTO workers (id, type, status, last_heartbeat)
         VALUES ($1, $2, 'busy', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE
         SET last_heartbeat = CURRENT_TIMESTAMP, status = 'busy'`,
        [this.workerId, this.agentType]
      );
    } catch (error) {
      logger.error({ error, workerId: this.workerId }, 'Heartbeat failed');
    }
  }

  /**
   * Emit progress event for real-time tracking
   */
  protected async emitProgress(
    jobId: string,
    programId: string,
    operation: string,
    current: number,
    total: number,
    eta?: number
  ): Promise<void> {
    const percentage = total > 0 ? Math.round((current / total) * 100) : 0;

    await events.emitProgress({
      jobId,
      programId,
      workerId: this.workerId,
      operation,
      current,
      total,
      percentage,
      eta,
    });

    logger.info({
      jobId,
      agentType: this.agentType,
      progress: `${current}/${total} (${percentage}%)`,
      operation
    }, 'Progress updated');
  }

  /**
   * Ultra-fast DNS validation to filter unreachable targets
   * Uses dnsx with high concurrency for parallel resolution
   */
  protected async validateDNS(assets: string[], jobId: string, programId: string): Promise<string[]> {
    const tmpFile = `/tmp/dns_validate_${Date.now()}.txt`;
    const outputFile = `/tmp/dns_validated_${Date.now()}.txt`;

    try {
      // Only validate hostnames, skip raw IPs
      const hostnames = assets.filter((asset) => {
        const cleanAsset = asset.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
        return !/^\d+\.\d+\.\d+\.\d+$/.test(cleanAsset);
      });

      const ips = assets.filter((asset) => {
        const cleanAsset = asset.replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
        return /^\d+\.\d+\.\d+\.\d+$/.test(cleanAsset);
      });

      if (hostnames.length === 0) {
        logger.info({ jobId, programId, ipCount: ips.length }, 'All assets are IPs, skipping DNS validation');
        return assets;
      }

      await fs.writeFile(tmpFile, hostnames.join('\n'));

      // Scale concurrency based on input size
      // Capped at 50 to prevent DNS resolver overload and crashes
      // Small batches: higher concurrency, Large batches: lower concurrency to avoid timeouts
      const concurrency = Math.min(50, hostnames.length <= 10 ? 50 : hostnames.length <= 100 ? 40 : 30);

      // Scale rate limit based on concurrency: 10x concurrency = safe rate
      const rateLimit = concurrency * 10; // e.g., 50 threads = 500 req/s max

      // Scale timeout based on input size: ~500ms per domain with minimum of 30s
      const timeoutMs = Math.max(30000, Math.min(300000, hostnames.length * 500));

      await this.updateJobProgress(jobId, {
        current: 0,
        total: hostnames.length,
        percentage: 0,
        currentTool: 'dns-validation',
        toolStatus: 'running',
        message: `⚡ Fast DNS validation: ${hostnames.length} domains (${concurrency} threads, ${rateLimit} req/s, ${Math.round(timeoutMs/1000)}s timeout)`,
      });

      // Fixed dnsx command with proper flags and rate limiting
      // -a: A records only (faster than all records)
      // -resp: Show domain names in output
      // -silent: Display only results (reduces noise)
      // -retry 1: Only retry once (faster)
      // -t: Threads (capped at 50 to prevent crashes)
      // -rl: Rate limit in requests/second (prevents DNS resolver overload)
      // -o: Output file
      const command = `${config.tools.dnsx} -l ${tmpFile} \
        -a \
        -resp \
        -silent \
        -retry 1 \
        -t ${concurrency} \
        -rl ${rateLimit} \
        -o ${outputFile}`;

      const startTime = Date.now();
      const result = await this.executeCommand(command, { timeout: timeoutMs });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      let validated: string[] = [];

      // Parse dnsx output: "domain.com [A] [IP]" -> extract unique domains
      const outputExists = await fs.stat(outputFile).then(() => true).catch(() => false);
      if (outputExists) {
        const content = await fs.readFile(outputFile, 'utf-8');
        const lines = content.split('\n').filter((line) => line.trim());

        // Extract unique domain names from dnsx output
        const domainSet = new Set<string>();
        for (const line of lines) {
          const match = line.match(/^([^\s\[]+)/);
          if (match) {
            domainSet.add(match[1]);
          }
        }
        validated = Array.from(domainSet);
      }

      // If DNS validation failed/not available, return all assets
      if (validated.length === 0 && result.exitCode !== 0) {
        logger.warn({ jobId, programId, exitCode: result.exitCode }, 'DNS validation failed, proceeding with all assets');
        return assets;
      }

      // Add IPs back (they don't need DNS validation)
      const allValid = [...validated, ...ips];
      const filtered = hostnames.length - validated.length;

      logger.info(
        {
          jobId,
          programId,
          total: assets.length,
          validated: allValid.length,
          filtered,
          elapsed: `${elapsed}s`,
          rate: `${Math.round(hostnames.length / parseFloat(elapsed))}/s`
        },
        `DNS validation complete: ${validated.length}/${hostnames.length} resolved, ${filtered} filtered in ${elapsed}s`
      );

      await this.updateJobProgress(jobId, {
        current: hostnames.length,
        total: hostnames.length,
        percentage: 100,
        currentTool: 'dns-validation',
        toolStatus: 'completed',
        message: `✓ DNS validated ${allValid.length}/${assets.length} assets (${filtered} filtered) in ${elapsed}s`,
        details: {
          validated: allValid.length,
          filtered,
          elapsed: `${elapsed}s`,
          rate: `${Math.round(hostnames.length / parseFloat(elapsed))}/s`,
        },
      });

      // Cleanup
      await fs.unlink(tmpFile).catch(() => {});
      await fs.unlink(outputFile).catch(() => {});

      return allValid;
    } catch (error) {
      logger.error({ error, jobId, programId }, 'DNS validation error, proceeding with all assets');
      return assets; // On error, don't filter - proceed with all assets
    }
  }
}
