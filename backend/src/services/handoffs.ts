/**
 * Handoffs System
 *
 * Enables formal agent-to-agent delegation with validation chains.
 * Use cases:
 * - Scanner finds SQLi → hand to SQLi Specialist → hand to Validator
 * - Discovery finds WordPress → hand to WordPress Specialist
 * - Triage needs confirmation → hand to Confirm Agent
 */

import { v4 as uuidv4 } from 'uuid';
import database from './database';
import queue from './queue';
import events from './events';
import logger from '../utils/logger';
import { trace, SpanStatusCode, context as otelContext } from '@opentelemetry/api';

/**
 * Handoff context containing all information for agent delegation
 */
export interface HandoffContext {
  id?: string;
  fromAgent: string;
  toAgent: string;
  reason: string;
  data: Record<string, any>;
  priority?: number;
  metadata?: {
    programId: string;
    parentJobId?: string;
    findingId?: string;
    chain?: string[]; // Track handoff chain: ['scanner', 'sqli-specialist', 'validator']
    [key: string]: any;
  };
  createdAt?: Date;
}

/**
 * Handoff result after delegation
 */
export interface HandoffResult {
  handoffId: string;
  nextJobId: string;
  status: 'queued' | 'failed';
  error?: string;
}

/**
 * HandoffTracker Service
 * Logs and tracks all agent-to-agent delegations
 */
export class HandoffTracker {
  private static instance: HandoffTracker;
  private tracer = trace.getTracer('agenthunt-handoffs');

  private constructor() {}

  static getInstance(): HandoffTracker {
    if (!HandoffTracker.instance) {
      HandoffTracker.instance = new HandoffTracker();
    }
    return HandoffTracker.instance;
  }

  /**
   * Log a handoff to database and emit event
   */
  async logHandoff(context: HandoffContext, nextJobId?: string): Promise<string> {
    const span = this.tracer.startSpan('handoff.log', {
      attributes: {
        'handoff.from': context.fromAgent,
        'handoff.to': context.toAgent,
        'handoff.reason': context.reason,
        'handoff.priority': context.priority || 5,
        'handoff.has_next_job': !!nextJobId,
      },
    });

    return otelContext.with(trace.setSpan(otelContext.active(), span), async () => {
      try {
        const handoffId = uuidv4();

        // Build handoff chain
        const chain = context.metadata?.chain || [];
        chain.push(context.fromAgent);

        await database.query(
          `INSERT INTO handoffs (
            id, from_agent, to_agent, reason, job_id, next_job_id,
            context, priority, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
          [
            handoffId,
            context.fromAgent,
            context.toAgent,
            context.reason,
            context.metadata?.parentJobId,
            nextJobId,
            JSON.stringify({
              data: context.data,
              metadata: { ...context.metadata, chain },
            }),
            context.priority || 5,
          ]
        );

        // Emit WebSocket event for UI
        await events.emitLog({
          level: 'info',
          tool: 'handoff',
          context: JSON.stringify({
            handoffId,
            fromAgent: context.fromAgent,
            toAgent: context.toAgent,
            reason: context.reason,
            chain,
          }),
          message: `${context.fromAgent} → ${context.toAgent}: ${context.reason}`,
        });

        logger.info(
          {
            handoffId,
            from: context.fromAgent,
            to: context.toAgent,
            reason: context.reason,
            chain,
          },
          'Handoff logged'
        );

        span.setAttributes({
          'handoff.id': handoffId,
          'handoff.chain_length': chain.length,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return handoffId;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get handoff chain for a job (recursive query)
   */
  async getHandoffChain(jobId: string): Promise<HandoffContext[]> {
    try {
      const result = await database.query(
        `WITH RECURSIVE handoff_chain AS (
          SELECT * FROM handoffs WHERE job_id = $1
          UNION ALL
          SELECT h.* FROM handoffs h
          INNER JOIN handoff_chain hc ON h.job_id = hc.next_job_id
        )
        SELECT * FROM handoff_chain ORDER BY created_at`,
        [jobId]
      );

      return result.rows.map((row) => ({
        id: row.id,
        fromAgent: row.from_agent,
        toAgent: row.to_agent,
        reason: row.reason,
        data: row.context?.data || {},
        priority: row.priority,
        metadata: {
          ...row.context?.metadata,
          parentJobId: row.job_id,
        },
        createdAt: row.created_at,
      }));
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to get handoff chain');
      return [];
    }
  }

  /**
   * Get statistics about handoffs
   */
  async getHandoffStats(programId?: string): Promise<any> {
    try {
      const whereClause = programId
        ? `WHERE context->>'programId' = $1`
        : '';
      const params = programId ? [programId] : [];

      const result = await database.query(
        `SELECT
          from_agent,
          to_agent,
          COUNT(*) as count,
          AVG(priority) as avg_priority
        FROM handoffs
        ${whereClause}
        GROUP BY from_agent, to_agent
        ORDER BY count DESC
        LIMIT 20`,
        params
      );

      return result.rows;
    } catch (error) {
      logger.error({ error }, 'Failed to get handoff stats');
      return [];
    }
  }
}

/**
 * Execute a handoff from one agent to another
 */
export async function executeHandoff(context: HandoffContext): Promise<HandoffResult> {
  const tracker = HandoffTracker.getInstance();

  try {
    // Validate handoff context
    if (!context.fromAgent || !context.toAgent) {
      throw new Error('fromAgent and toAgent are required');
    }

    if (!context.metadata?.programId) {
      throw new Error('programId is required in metadata');
    }

    // Build handoff chain
    const chain = context.metadata.chain || [];
    chain.push(context.fromAgent);

    // Create new job for target agent
    const nextJobId = uuidv4();
    await queue.addJob(context.toAgent as any, {
      id: nextJobId,
      type: context.toAgent as any,
      programId: context.metadata.programId,
      priority: context.priority || 5,
      status: 'pending' as any,
      attempts: 0,
      maxAttempts: 3,
      options: context.data,
      metadata: {
        ...context.metadata,
        handoffChain: chain.join(' → '),
        handoffFrom: context.fromAgent,
        handoffReason: context.reason,
      } as any,
      createdAt: new Date(),
    });

    // Log handoff
    const handoffId = await tracker.logHandoff(context, nextJobId);

    logger.info(
      {
        handoffId,
        nextJobId,
        from: context.fromAgent,
        to: context.toAgent,
      },
      'Handoff executed successfully'
    );

    return {
      handoffId,
      nextJobId,
      status: 'queued',
    };
  } catch (error: any) {
    logger.error({ error, context }, 'Failed to execute handoff');

    // Still log the failed handoff
    const handoffId = await tracker.logHandoff(context);

    return {
      handoffId,
      nextJobId: '',
      status: 'failed',
      error: error.message,
    };
  }
}

export default HandoffTracker.getInstance();
