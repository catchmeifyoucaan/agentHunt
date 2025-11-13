/**
 * Checkpoint and Rollback Service
 * Transaction-like capability for agent operations
 * Inspired by Claude Code's safety-first approach
 */

import database from './database';
import logger from '../utils/logger';
import { Checkpoint, CheckpointState } from '../../../shared/agent-collaboration.types';

class CheckpointService {
  /**
   * Create a checkpoint before starting an operation
   */
  async createCheckpoint(jobId: string): Promise<string> {
    const checkpointId = `checkpoint_${jobId}_${Date.now()}`;

    try {
      // Capture current state
      const state = await this.captureState(jobId);

      // Store checkpoint
      await database.query(
        `INSERT INTO checkpoints (id, job_id, state, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [checkpointId, jobId, state]
      );

      logger.info({ checkpointId, jobId }, 'Checkpoint created');
      return checkpointId;
    } catch (error: any) {
      logger.error({ error, jobId }, 'Failed to create checkpoint');
      throw error;
    }
  }

  /**
   * Commit a checkpoint (mark as successful, can be cleaned up)
   */
  async commitCheckpoint(checkpointId: string): Promise<void> {
    try {
      // For now, just log. In future, could mark checkpoint as committed
      // and eligible for cleanup
      logger.info({ checkpointId }, 'Checkpoint committed');

      // Optional: Delete old checkpoints for this job to save space
      const checkpoint = await this.getCheckpoint(checkpointId);
      if (checkpoint) {
        await this.cleanupOldCheckpoints(checkpoint.job_id);
      }
    } catch (error: any) {
      logger.error({ error, checkpointId }, 'Failed to commit checkpoint');
      // Don't throw - commit failure shouldn't break the job
    }
  }

  /**
   * Rollback to a checkpoint (undo all changes since checkpoint)
   */
  async rollbackCheckpoint(checkpointId: string, reason: string): Promise<void> {
    try {
      const checkpoint = await this.getCheckpoint(checkpointId);
      if (!checkpoint) {
        throw new Error(`Checkpoint not found: ${checkpointId}`);
      }

      logger.info({ checkpointId, reason }, 'Rolling back checkpoint');

      const state = checkpoint.state as CheckpointState;
      const jobId = checkpoint.job_id;

      // 1. Delete assets created after checkpoint
      const assetsDeleted = await database.query(
        `DELETE FROM assets
         WHERE job_id = $1
           AND created_at > $2
         RETURNING id`,
        [jobId, checkpoint.created_at]
      );

      // 2. Delete findings created after checkpoint
      const findingsDeleted = await database.query(
        `DELETE FROM findings
         WHERE id IN (
           SELECT f.id FROM findings f
           JOIN assets a ON f.asset_id = a.id
           WHERE a.job_id = $1
             AND f.created_at > $2
         )
         RETURNING id`,
        [jobId, checkpoint.created_at]
      );

      // 3. Delete tool outputs created after checkpoint
      await database.query(
        `DELETE FROM tool_outputs
         WHERE job_id = $1
           AND created_at > $2`,
        [jobId, checkpoint.created_at]
      );

      // 4. Delete handoffs created after checkpoint
      await database.query(
        `DELETE FROM handoffs
         WHERE job_id = $1
           AND created_at > $2`,
        [jobId, checkpoint.created_at]
      );

      await database.query(
        `DELETE FROM rich_handoffs
         WHERE from_job_id = $1
           AND created_at > $2`,
        [jobId, checkpoint.created_at]
      );

      // 5. Reset job status to failed
      await database.query(
        `UPDATE jobs
         SET status = 'failed',
             error = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [`Rolled back: ${reason}`, jobId]
      );

      // 6. Mark checkpoint as rolled back
      await database.query(
        `UPDATE checkpoints
         SET rolled_back_at = NOW(),
             rollback_reason = $1
         WHERE id = $2`,
        [reason, checkpointId]
      );

      logger.info(
        {
          checkpointId,
          assetsDeleted: assetsDeleted.rows.length,
          findingsDeleted: findingsDeleted.rows.length,
          reason
        },
        'Checkpoint rollback completed'
      );
    } catch (error: any) {
      logger.error({ error, checkpointId }, 'Failed to rollback checkpoint');
      throw error;
    }
  }

  /**
   * Get checkpoint details
   */
  async getCheckpoint(checkpointId: string): Promise<Checkpoint | null> {
    try {
      const result = await database.query(
        `SELECT * FROM checkpoints WHERE id = $1`,
        [checkpointId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return {
        id: row.id,
        jobId: row.job_id,
        state: row.state,
        createdAt: row.created_at
      };
    } catch (error: any) {
      logger.error({ error, checkpointId }, 'Failed to get checkpoint');
      return null;
    }
  }

  /**
   * Capture current state for a job
   */
  private async captureState(jobId: string): Promise<CheckpointState> {
    // Get job details
    const jobResult = await database.query(
      `SELECT * FROM jobs WHERE id = $1`,
      [jobId]
    );

    if (jobResult.rows.length === 0) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const job = jobResult.rows[0];
    const programId = job.program_id;

    // Count current assets
    const assetResult = await database.query(
      `SELECT COUNT(*) as count FROM assets WHERE program_id = $1`,
      [programId]
    );

    // Count current findings
    const findingResult = await database.query(
      `SELECT COUNT(*) as count FROM findings WHERE program_id = $1`,
      [programId]
    );

    // Count current handoffs
    const handoffResult = await database.query(
      `SELECT COUNT(*) as count FROM handoffs WHERE job_id = $1`,
      [jobId]
    );

    // Get tool outputs for this job
    const toolOutputResult = await database.query(
      `SELECT s3_key FROM tool_outputs WHERE job_id = $1`,
      [jobId]
    );

    return {
      jobStatus: job.status,
      assetCount: parseInt(assetResult.rows[0].count),
      findingCount: parseInt(findingResult.rows[0].count),
      handoffCount: parseInt(handoffResult.rows[0].count),
      artifacts: toolOutputResult.rows.map((r: any) => r.s3_key).filter(Boolean)
    };
  }

  /**
   * Clean up old checkpoints for a job
   */
  private async cleanupOldCheckpoints(jobId: string, keepLast: number = 3): Promise<void> {
    try {
      // Keep only the last N checkpoints for this job
      await database.query(
        `DELETE FROM checkpoints
         WHERE id IN (
           SELECT id FROM checkpoints
           WHERE job_id = $1
           ORDER BY created_at DESC
           OFFSET $2
         )`,
        [jobId, keepLast]
      );
    } catch (error: any) {
      logger.warn({ error, jobId }, 'Failed to cleanup old checkpoints');
    }
  }

  /**
   * Validate a result meets expectations
   */
  validateResult(result: any, expected: any): boolean {
    // Basic validation - can be extended based on needs
    if (expected.minAssets && (!result.assets || result.assets.length < expected.minAssets)) {
      return false;
    }

    if (expected.requiredFields) {
      for (const field of expected.requiredFields) {
        if (!(field in result)) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Execute an operation with automatic rollback on failure
   */
  async executeWithRollback<T>(
    jobId: string,
    operation: () => Promise<T>,
    validation?: (result: T) => boolean
  ): Promise<T> {
    const checkpointId = await this.createCheckpoint(jobId);

    try {
      const result = await operation();

      // Validate result if validator provided
      if (validation && !validation(result)) {
        throw new Error('Result validation failed');
      }

      await this.commitCheckpoint(checkpointId);
      return result;
    } catch (error: any) {
      logger.error({ error, jobId }, 'Operation failed, rolling back');
      await this.rollbackCheckpoint(checkpointId, error.message);
      throw error;
    }
  }

  /**
   * Get rollback history for debugging
   */
  async getRollbackHistory(jobId?: string, limit: number = 50): Promise<any[]> {
    try {
      const query = jobId
        ? `SELECT * FROM checkpoints WHERE job_id = $1 AND rolled_back_at IS NOT NULL ORDER BY rolled_back_at DESC LIMIT $2`
        : `SELECT * FROM checkpoints WHERE rolled_back_at IS NOT NULL ORDER BY rolled_back_at DESC LIMIT $1`;

      const values = jobId ? [jobId, limit] : [limit];
      const result = await database.query(query, values);
      return result.rows;
    } catch (error: any) {
      logger.error({ error }, 'Failed to get rollback history');
      return [];
    }
  }
}

export default new CheckpointService();
