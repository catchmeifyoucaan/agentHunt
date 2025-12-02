/**
 * Job Progress Tracking Service
 * Inspired by Claude Code's TodoWrite pattern for observable execution
 */

import database from './database';
import logger from '../utils/logger';
import {
  JobProgress,
  ProgressStep,
  JobProgressStatus,
} from '../../../shared/agent-collaboration.types';

class ProgressTrackerService {
  /**
   * Initialize progress tracking for a job
   */
  async initializeProgress(
    jobId: string,
    programId: string,
    phase: string,
    steps: Omit<ProgressStep, 'status' | 'startTime' | 'endTime'>[]
  ): Promise<JobProgress> {
    try {
      // Check if job exists in database first
      const jobCheck = await database.query(`SELECT id, program_id FROM jobs WHERE id = $1`, [
        jobId,
      ]);

      if (jobCheck.rows.length === 0) {
        // If job doesn't exist, create a minimal job record to satisfy the foreign key constraint
        await database.query(
          `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO NOTHING`,
          [
            jobId,
            phase, // Use phase as temporary type
            programId,
            5, // default priority
            'pending',
            0, // attempts
            3, // max_attempts
            '{}', // options
            JSON.stringify({ source: 'progress-tracker-init' }),
          ]
        );
      }

      // Create progress record
      // Note: program_id is not stored in job_progress table, it comes from jobs table via JOIN
      const progressResult = await database.query(
        `INSERT INTO job_progress (job_id, phase, current_step, overall_progress, estimated_completion)
         VALUES ($1, $2, 0, 0, $3)
         RETURNING id, job_id, phase, current_step, overall_progress, estimated_completion`,
        [jobId, phase, this.estimateCompletion(steps)]
      );

      const progress = progressResult.rows[0];

      // Create step records
      for (let i = 0; i < steps.length; i++) {
        await database.query(
          `INSERT INTO progress_steps (progress_id, sequence, name, status, metadata)
           VALUES ($1, $2, $3, $4, $5)`,
          [progress.id, i, steps[i].name, 'pending', steps[i].metadata || {}]
        );
      }

      // Publish initial progress
      await this.publishProgress(jobId);

      logger.info(
        { jobId, programId, phase, stepCount: steps.length },
        'Progress tracking initialized'
      );

      // Build response directly from inserted data instead of querying view
      // (view may not be immediately available due to aggregation)
      // Get program_id from jobs table since it's not in job_progress
      const jobResult = await database.query(`SELECT program_id FROM jobs WHERE id = $1`, [jobId]);
      const jobProgramId = jobResult.rows[0]?.program_id || programId;

      const stepsResult = await database.query(
        `SELECT sequence, name, status, progress, start_time, end_time, error, metadata
         FROM progress_steps
         WHERE progress_id = $1
         ORDER BY sequence ASC`,
        [progress.id]
      );

      return {
        jobId: progress.job_id,
        programId: jobProgramId,
        phase: progress.phase,
        steps: stepsResult.rows.map((row: any) => ({
          sequence: row.sequence,
          name: row.name,
          status: row.status,
          progress: row.progress || 0,
          startTime: row.start_time,
          endTime: row.end_time,
          error: row.error,
          metadata: row.metadata || {},
        })),
        currentStep: progress.current_step,
        estimatedCompletion: progress.estimated_completion,
        overallProgress: progress.overall_progress,
      };
    } catch (error: any) {
      logger.error({ error, jobId, programId }, 'Failed to initialize progress');
      throw error;
    }
  }

  /**
   * Update a specific step's status
   */
  async updateStep(
    jobId: string,
    stepIndex: number,
    status: JobProgressStatus,
    options?: {
      progress?: number;
      error?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      const progressRecord = await this.getProgressRecord(jobId);
      if (!progressRecord) {
        throw new Error(`No progress record found for job ${jobId}`);
      }

      const updates: string[] = ['status = $3'];
      const values: any[] = [progressRecord.id, stepIndex, status];
      let paramIndex = 4;

      if (options?.progress !== undefined) {
        updates.push(`progress = $${paramIndex++}`);
        values.push(options.progress);
      }

      if (options?.error !== undefined) {
        updates.push(`error = $${paramIndex++}`);
        values.push(options.error);
      }

      if (options?.metadata !== undefined) {
        updates.push(`metadata = $${paramIndex++}`);
        values.push(options.metadata);
      }

      // Set timestamps based on status
      if (status === 'running') {
        updates.push(`start_time = CURRENT_TIMESTAMP`);
      } else if (status === 'completed' || status === 'failed') {
        updates.push(`end_time = CURRENT_TIMESTAMP`);
      }

      await database.query(
        `UPDATE progress_steps
         SET ${updates.join(', ')}
         WHERE progress_id = $1 AND sequence = $2`,
        values
      );

      // Update overall progress
      await this.updateOverallProgress(jobId);

      // Update current step if moving to running status
      if (status === 'running') {
        await database.query(
          `UPDATE job_progress
           SET current_step = $1
           WHERE job_id = $2`,
          [stepIndex, jobId]
        );
      }

      // Publish update
      await this.publishProgress(jobId);

      logger.debug({ jobId, stepIndex, status }, 'Step updated');
    } catch (error: any) {
      logger.error({ error, jobId, stepIndex }, 'Failed to update step');
      throw error;
    }
  }

  /**
   * Mark a step as running
   */
  async startStep(jobId: string, stepIndex: number): Promise<void> {
    return this.updateStep(jobId, stepIndex, 'running');
  }

  /**
   * Mark a step as completed
   */
  async completeStep(
    jobId: string,
    stepIndex: number,
    metadata?: Record<string, any>
  ): Promise<void> {
    return this.updateStep(jobId, stepIndex, 'completed', {
      progress: 100,
      metadata,
    });
  }

  /**
   * Mark a step as failed
   */
  async failStep(jobId: string, stepIndex: number, error: string): Promise<void> {
    return this.updateStep(jobId, stepIndex, 'failed', { error });
  }

  /**
   * Update step progress (0-100)
   */
  async updateStepProgress(jobId: string, stepIndex: number, progress: number): Promise<void> {
    return this.updateStep(jobId, stepIndex, 'running', { progress });
  }

  /**
   * Get current progress for a job
   */
  async getProgress(jobId: string): Promise<JobProgress> {
    try {
      const result = await database.query(`SELECT * FROM active_job_progress WHERE job_id = $1`, [
        jobId,
      ]);

      if (result.rows.length === 0) {
        throw new Error(`No progress found for job ${jobId}`);
      }

      const row = result.rows[0];

      return {
        jobId: row.job_id,
        programId: row.program_id,
        phase: row.phase,
        steps: row.steps || [],
        currentStep: row.current_step,
        estimatedCompletion: row.estimated_completion,
        overallProgress: row.overall_progress,
      };
    } catch (error: any) {
      logger.error({ error, jobId }, 'Failed to get progress');
      throw error;
    }
  }

  /**
   * Calculate and update overall progress based on step completion
   */
  private async updateOverallProgress(jobId: string): Promise<void> {
    const progressRecord = await this.getProgressRecord(jobId);
    if (!progressRecord) return;

    const stepsResult = await database.query(
      `SELECT status, progress FROM progress_steps WHERE progress_id = $1`,
      [progressRecord.id]
    );

    const steps = stepsResult.rows;
    const totalSteps = steps.length;

    if (totalSteps === 0) {
      return;
    }

    // Calculate weighted progress
    let completedWeight = 0;
    for (const step of steps) {
      if (step.status === 'completed') {
        completedWeight += 100;
      } else if (step.status === 'running') {
        completedWeight += step.progress || 0;
      }
      // pending and failed contribute 0
    }

    const overallProgress = Math.floor(completedWeight / totalSteps);

    await database.query(
      `UPDATE job_progress
       SET overall_progress = $1,
           estimated_completion = $2
       WHERE id = $3`,
      [overallProgress, this.estimateCompletion(steps), progressRecord.id]
    );
  }

  /**
   * Get progress record (internal helper)
   */
  private async getProgressRecord(jobId: string): Promise<any | null> {
    const result = await database.query(`SELECT * FROM job_progress WHERE job_id = $1`, [jobId]);
    return result.rows[0] || null;
  }

  /**
   * Estimate completion time based on steps
   */
  private estimateCompletion(steps: any[]): Date {
    // Simple estimation: 5 minutes per step
    const minutesPerStep = 5;
    const totalMinutes = steps.length * minutesPerStep;
    const estimatedCompletion = new Date();
    estimatedCompletion.setMinutes(estimatedCompletion.getMinutes() + totalMinutes);
    return estimatedCompletion;
  }

  /**
   * Publish progress update to Redis for real-time updates
   */
  private async publishProgress(jobId: string): Promise<void> {
    try {
      const progress = await this.getProgress(jobId);

      // Publish to Redis pub/sub for WebSocket clients
      const redis = (await import('./redis')).default;
      await redis.publish(`job:${jobId}:progress`, JSON.stringify(progress));
    } catch (error: any) {
      // Don't throw - progress update failed but job can continue
      logger.warn({ error, jobId }, 'Failed to publish progress update');
    }
  }

  /**
   * Get all active job progress records
   */
  async getAllActiveProgress(programId?: string): Promise<JobProgress[]> {
    try {
      const query = programId
        ? `SELECT * FROM active_job_progress WHERE program_id = $1`
        : `SELECT * FROM active_job_progress`;

      const values = programId ? [programId] : [];
      const result = await database.query(query, values);

      return result.rows.map((row: any) => ({
        jobId: row.job_id,
        phase: row.phase,
        steps: row.steps || [],
        currentStep: row.current_step,
        estimatedCompletion: row.estimated_completion,
        overallProgress: row.overall_progress,
      }));
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to get all active progress');
      return [];
    }
  }

  /**
   * Clean up completed progress records (optional cleanup)
   */
  async cleanup(olderThanDays: number = 7): Promise<number> {
    try {
      const result = await database.query(
        `DELETE FROM job_progress
         WHERE id IN (
           SELECT jp.id
           FROM job_progress jp
           JOIN jobs j ON jp.job_id = j.id
           WHERE j.status IN ('completed', 'failed')
             AND j.completed_at < NOW() - INTERVAL '${olderThanDays} days'
         )
         RETURNING id`
      );

      const count = result.rows.length;
      logger.info({ count, olderThanDays }, 'Cleaned up old progress records');
      return count;
    } catch (error: any) {
      logger.error({ error }, 'Failed to cleanup progress records');
      return 0;
    }
  }
}

export default new ProgressTrackerService();
