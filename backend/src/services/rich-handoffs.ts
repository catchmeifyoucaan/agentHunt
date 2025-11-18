/**
 * Rich Handoff Service
 * Enhanced agent handoffs with complete context preservation
 * Inspired by Claude Code's context-preserving task delegation
 */

import database from './database';
import redis from './redis';
import logger from '../utils/logger';
import { RichHandoff, HandoffContext, AgentInfo, OutputContract } from '../../../shared/agent-collaboration.types';
import { v4 as uuidv4 } from 'uuid';
import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';

class RichHandoffService {
  private tracer = trace.getTracer('agenthunt-rich-handoffs');

  /**
   * Create a rich handoff with complete context
   */
  async createHandoff(
    fromAgent: AgentInfo,
    toAgentType: string,
    context: HandoffContext,
    outputContract: OutputContract
  ): Promise<string> {
    const handoffId = uuidv4();

    // 📊 DISTRIBUTED TRACING: Create span for handoff creation
    const span = this.tracer.startSpan('handoff.create', {
      attributes: {
        'handoff.id': handoffId,
        'handoff.from_agent': fromAgent.type,
        'handoff.from_instance': fromAgent.instanceId,
        'handoff.to_agent': toAgentType,
        'handoff.program_id': fromAgent.programId,
        'handoff.confidence': context.reasoning.confidence,
        'handoff.trigger': context.reasoning.trigger,
      },
    });

    try {
      // Validate handoff can be created
      const validation = await this.validateHandoff(context, outputContract);
      if (!validation.valid) {
        throw new Error(`Invalid handoff: ${validation.errors.join(', ')}`);
      }

      await database.query(
        `INSERT INTO rich_handoffs (
          id, from_agent_type, from_agent_instance, from_job_id,
          to_agent_type, program_id,
          parent_result, reasoning, objectives, success_criteria,
          inherited_constraints, output_contract,
          status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
        [
          handoffId,
          fromAgent.type,
          fromAgent.instanceId,
          fromAgent.jobId,
          toAgentType,
          fromAgent.programId,
          context.parentResult,
          context.reasoning,
          context.objectives,
          context.successCriteria,
          context.inherited,
          outputContract,
          'pending'
        ]
      );

      logger.info(
        {
          handoffId,
          from: fromAgent.type,
          to: toAgentType,
          trigger: context.reasoning.trigger,
          confidence: context.reasoning.confidence
        },
        'Rich handoff created'
      );

      // 🚀 REAL-TIME WEBSOCKET: Publish handoff creation to Redis pub/sub
      try {
        const handoffEvent = {
          handoffId,
          fromAgentType: fromAgent.type,
          fromJobId: fromAgent.jobId,
          toAgentType,
          programId: fromAgent.programId,
          status: 'pending',
          trigger: context.reasoning.trigger,
          confidence: context.reasoning.confidence,
          timestamp: new Date().toISOString(),
        };

        await redis.publish(`handoff:${handoffId}:status`, JSON.stringify(handoffEvent));
        await redis.publish(`program:${fromAgent.programId}:handoffs`, JSON.stringify(handoffEvent));

        logger.debug({ handoffId }, 'Published handoff creation to Redis pub/sub');
      } catch (redisError: any) {
        logger.error({ error: redisError, handoffId }, 'Failed to publish handoff creation to Redis');
      }

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();

      return handoffId;
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      span.end();

      logger.error({ error, fromAgent, toAgentType }, 'Failed to create rich handoff');
      throw error;
    }
  }

  /**
   * Accept a handoff and create next job
   */
  async acceptHandoff(
    handoffId: string,
    toAgentInstance: string,
    toJobId: string
  ): Promise<void> {
    // 📊 DISTRIBUTED TRACING: Create span for handoff acceptance
    const span = this.tracer.startSpan('handoff.accept', {
      attributes: {
        'handoff.id': handoffId,
        'handoff.to_instance': toAgentInstance,
        'handoff.to_job_id': toJobId,
      },
    });

    try {
      await database.query(
        `UPDATE rich_handoffs
         SET status = 'accepted',
             to_agent_instance = $1,
             to_job_id = $2,
             accepted_at = NOW()
         WHERE id = $3`,
        [toAgentInstance, toJobId, handoffId]
      );

      logger.info({ handoffId, toJobId }, 'Handoff accepted');

      // 🚀 REAL-TIME WEBSOCKET: Publish handoff acceptance
      try {
        const handoff = await this.getHandoff(handoffId);
        if (handoff) {
          const programId = handoff.fromAgent.programId;
          const acceptEvent = {
            handoffId,
            toAgentInstance,
            toJobId,
            programId,
            status: 'accepted',
            timestamp: new Date().toISOString(),
          };

          await redis.publish(`handoff:${handoffId}:status`, JSON.stringify(acceptEvent));
          await redis.publish(`program:${programId}:handoffs`, JSON.stringify(acceptEvent));
        }
      } catch (redisError: any) {
        logger.error({ error: redisError, handoffId }, 'Failed to publish handoff acceptance');
      }

      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      span.end();

      logger.error({ error, handoffId }, 'Failed to accept handoff');
      throw error;
    }
  }

  /**
   * Reject a handoff with reason
   */
  async rejectHandoff(handoffId: string, reason: string): Promise<void> {
    try {
      await database.query(
        `UPDATE rich_handoffs
         SET status = 'rejected',
             rejection_reason = $1
         WHERE id = $2`,
        [reason, handoffId]
      );

      logger.warn({ handoffId, reason }, 'Handoff rejected');

      // 🚀 REAL-TIME WEBSOCKET: Publish handoff rejection
      try {
        const handoff = await this.getHandoff(handoffId);
        if (handoff) {
          const programId = handoff.fromAgent.programId;
          const rejectEvent = {
            handoffId,
            programId,
            status: 'rejected',
            reason,
            timestamp: new Date().toISOString(),
          };

          await redis.publish(`handoff:${handoffId}:status`, JSON.stringify(rejectEvent));
          await redis.publish(`program:${programId}:handoffs`, JSON.stringify(rejectEvent));
        }
      } catch (redisError: any) {
        logger.error({ error: redisError, handoffId }, 'Failed to publish handoff rejection');
      }
    } catch (error: any) {
      logger.error({ error, handoffId }, 'Failed to reject handoff');
      throw error;
    }
  }

  /**
   * Complete a handoff with result
   */
  async completeHandoff(
    handoffId: string,
    completionResult: any
  ): Promise<void> {
    // 📊 DISTRIBUTED TRACING: Create span for handoff completion
    const span = this.tracer.startSpan('handoff.complete', {
      attributes: {
        'handoff.id': handoffId,
      },
    });

    try {
      const handoff = await this.getHandoff(handoffId);
      if (!handoff) {
        throw new Error(`Handoff not found: ${handoffId}`);
      }

      // Validate result meets output contract
      const meetsContract = this.validateOutputContract(
        completionResult,
        handoff.outputContract
      );

      if (!meetsContract.valid) {
        logger.warn(
          { handoffId, errors: meetsContract.errors },
          'Handoff result does not meet contract'
        );
      }

      await database.query(
        `UPDATE rich_handoffs
         SET status = 'completed',
             completion_result = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [completionResult, handoffId]
      );

      logger.info({ handoffId }, 'Handoff completed');

      // 🚀 REAL-TIME WEBSOCKET: Publish handoff completion
      try {
        const programId = handoff.fromAgent.programId;
        const completeEvent = {
          handoffId,
          programId,
          status: 'completed',
          contractMet: meetsContract.valid,
          timestamp: new Date().toISOString(),
        };

        await redis.publish(`handoff:${handoffId}:status`, JSON.stringify(completeEvent));
        await redis.publish(`program:${programId}:handoffs`, JSON.stringify(completeEvent));
      } catch (redisError: any) {
        logger.error({ error: redisError, handoffId }, 'Failed to publish handoff completion');
      }

      span.setAttribute('handoff.contract_met', meetsContract.valid);
      span.setStatus({ code: SpanStatusCode.OK });
      span.end();
    } catch (error: any) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      span.end();

      logger.error({ error, handoffId }, 'Failed to complete handoff');
      throw error;
    }
  }

  /**
   * Get handoff details
   */
  async getHandoff(handoffId: string): Promise<RichHandoff | null> {
    try {
      const result = await database.query(
        `SELECT * FROM rich_handoffs WHERE id = $1`,
        [handoffId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      return this.mapRowToHandoff(row);
    } catch (error: any) {
      logger.error({ error, handoffId }, 'Failed to get handoff');
      return null;
    }
  }

  /**
   * Get pending handoffs for an agent type
   */
  async getPendingHandoffs(agentType: string, limit: number = 10): Promise<RichHandoff[]> {
    try {
      const result = await database.query(
        `SELECT * FROM pending_handoffs
         WHERE to_agent_type = $1
         LIMIT $2`,
        [agentType, limit]
      );

      return result.rows.map((row: any) => this.mapRowToHandoff(row));
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to get pending handoffs');
      return [];
    }
  }

  /**
   * Validate a handoff before creation
   */
  private async validateHandoff(
    context: HandoffContext,
    outputContract: OutputContract
  ): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];

    // Validate reasoning confidence
    if (context.reasoning.confidence < 0.5) {
      errors.push(`Low confidence handoff: ${context.reasoning.confidence}`);
    }

    // Validate objectives
    if (!context.objectives.primary) {
      errors.push('Missing primary objective');
    }

    // Validate success criteria
    if (!context.successCriteria.requiredFields || context.successCriteria.requiredFields.length === 0) {
      errors.push('Missing required fields in success criteria');
    }

    // Validate inherited constraints
    if (!context.inherited.programId) {
      errors.push('Missing program ID in inherited constraints');
    }

    // Validate output contract
    if (!outputContract.requiredFields || outputContract.requiredFields.length === 0) {
      errors.push('Missing required fields in output contract');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate result meets output contract
   */
  private validateOutputContract(
    result: any,
    contract: OutputContract
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields present
    for (const field of contract.requiredFields) {
      if (!(field in result)) {
        errors.push(`Missing required field: ${field}`);
      }
    }

    // Check expected volume if specified
    if (contract.expectedVolume) {
      const actualCount = Array.isArray(result) ? result.length : Object.keys(result).length;

      // Handle both number and object format
      const minExpected = typeof contract.expectedVolume === 'number' ? contract.expectedVolume : contract.expectedVolume.min;
      const maxExpected = typeof contract.expectedVolume === 'number' ? contract.expectedVolume : contract.expectedVolume.max;

      if (minExpected && actualCount < minExpected) {
        errors.push(
          `Result volume ${actualCount} below minimum ${minExpected}`
        );
      }

      if (maxExpected && actualCount > maxExpected) {
        errors.push(
          `Result volume ${actualCount} exceeds maximum ${maxExpected}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Map database row to RichHandoff object
   */
  private mapRowToHandoff(row: any): RichHandoff {
    return {
      id: row.id,
      fromAgent: {
        type: row.from_agent_type,
        instanceId: row.from_agent_instance,
        jobId: row.from_job_id,
        programId: row.program_id
      },
      toAgent: {
        type: row.to_agent_type,
        instanceId: row.to_agent_instance || 'pending',
        jobId: row.to_job_id || 'pending',
        programId: row.program_id
      },
      context: {
        parentResult: row.parent_result,
        reasoning: row.reasoning,
        objectives: row.objectives,
        successCriteria: row.success_criteria,
        inherited: row.inherited_constraints
      },
      outputContract: row.output_contract,
      createdAt: row.created_at,
      status: row.status
    };
  }

  /**
   * Get handoff statistics
   */
  async getHandoffStats(programId?: string): Promise<{
    total: number;
    pending: number;
    completed: number;
    rejected: number;
    avgConfidence: number;
    byAgentType: Record<string, number>;
  }> {
    try {
      const whereClause = programId ? `WHERE program_id = '${programId}'` : '';

      const totalResult = await database.query(
        `SELECT COUNT(*) as count FROM rich_handoffs ${whereClause}`
      );

      const pendingResult = await database.query(
        `SELECT COUNT(*) as count FROM rich_handoffs ${whereClause} ${whereClause ? 'AND' : 'WHERE'} status = 'pending'`
      );

      const completedResult = await database.query(
        `SELECT COUNT(*) as count FROM rich_handoffs ${whereClause} ${whereClause ? 'AND' : 'WHERE'} status = 'completed'`
      );

      const rejectedResult = await database.query(
        `SELECT COUNT(*) as count FROM rich_handoffs ${whereClause} ${whereClause ? 'AND' : 'WHERE'} status = 'rejected'`
      );

      const avgConfidenceResult = await database.query(
        `SELECT AVG((reasoning->>'confidence')::numeric) as avg_confidence FROM rich_handoffs ${whereClause}`
      );

      const byTypeResult = await database.query(
        `SELECT to_agent_type, COUNT(*) as count FROM rich_handoffs ${whereClause} GROUP BY to_agent_type`
      );

      return {
        total: parseInt(totalResult.rows[0].count),
        pending: parseInt(pendingResult.rows[0].count),
        completed: parseInt(completedResult.rows[0].count),
        rejected: parseInt(rejectedResult.rows[0].count),
        avgConfidence: parseFloat(avgConfidenceResult.rows[0].avg_confidence || '0'),
        byAgentType: Object.fromEntries(
          byTypeResult.rows.map((r: any) => [r.to_agent_type, parseInt(r.count)])
        )
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to get handoff stats');
      return {
        total: 0,
        pending: 0,
        completed: 0,
        rejected: 0,
        avgConfidence: 0,
        byAgentType: {}
      };
    }
  }
}

export default new RichHandoffService();
