import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { BaseJob, AgentType } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';
import { exec } from 'child_process';
import { promisify } from 'util';

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
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const startTime = Date.now();

    try {
      logger.debug({ command }, 'Executing command');

      const { stdout, stderr } = await execAsync(command, {
        timeout: options?.timeout || 300000, // 5 min default
        cwd: options?.cwd,
        env: { ...process.env, ...options?.env },
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer
      });

      const duration = Date.now() - startTime;

      logger.info(
        {
          command: command.split(' ')[0], // Log only the tool name
          duration,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
        },
        'Command executed successfully'
      );

      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error(
        {
          command,
          duration,
          error: error.message,
          exitCode: error.code,
        },
        'Command execution failed'
      );

      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
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
}
