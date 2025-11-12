/**
 * Turn Manager - Turns and Interactions Model (Phase 2.3)
 *
 * Implements formal execution cycles for better state management based on ReACT pattern.
 *
 * Concept:
 * - Turn: High-level execution cycle (Discovery turn, Scanner turn, etc.)
 * - Interaction: Reasoning + Action cycle within a turn
 * - Action: Individual tool execution
 *
 * Benefits:
 * - Pauseable execution (pause at turn boundaries)
 * - Granular state tracking (failed at Turn 2, Interaction 3)
 * - Replay capability (replay specific turns)
 * - Better debugging (see exact execution flow)
 */

import { v4 as uuidv4 } from 'uuid';
import database from './database';
import logger from '../utils/logger';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

/**
 * Turn: High-level execution cycle
 */
export interface Turn {
  id: string;
  jobId: string;
  sequence: number;
  state: 'active' | 'completed' | 'failed';
  trigger: 'initial' | 'orchestrator' | 'handoff';
  metadata?: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Interaction: Reasoning + Action cycle within a turn
 */
export interface Interaction {
  id: string;
  turnId: string;
  sequence: number;
  reasoning?: {
    prompt: string;
    response: string;
    model: string;
    tokens: number;
  };
  state: 'pending' | 'reasoning' | 'acting' | 'completed' | 'failed';
  metadata?: Record<string, any>;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * Action: Individual tool execution
 */
export interface Action {
  id: string;
  interactionId: string;
  tool: string;
  input: Record<string, any>;
  output?: Record<string, any>;
  durationMs?: number;
  error?: string;
  createdAt: Date;
  completedAt?: Date;
}

/**
 * TurnManager Service
 * Manages turn-based execution for agents
 */
export class TurnManager {
  private static instance: TurnManager;
  private tracer = trace.getTracer('agenthunt-turns');

  private constructor() {}

  static getInstance(): TurnManager {
    if (!TurnManager.instance) {
      TurnManager.instance = new TurnManager();
    }
    return TurnManager.instance;
  }

  /**
   * Start a new turn for a job
   */
  async startTurn(jobId: string, trigger: Turn['trigger'], metadata?: Record<string, any>): Promise<Turn> {
    const span = this.tracer.startSpan('turn.start', {
      attributes: {
        'turn.job_id': jobId,
        'turn.trigger': trigger,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const sequence = await this.getNextTurnSequence(jobId);
        const turnId = uuidv4();

        await database.query(
          `INSERT INTO turns (id, job_id, sequence, state, trigger, metadata, created_at)
           VALUES ($1, $2, $3, 'active', $4, $5, CURRENT_TIMESTAMP)`,
          [turnId, jobId, sequence, trigger, metadata ? JSON.stringify(metadata) : null]
        );

        const turn: Turn = {
          id: turnId,
          jobId,
          sequence,
          state: 'active',
          trigger,
          metadata,
          createdAt: new Date(),
        };

        logger.info({ turnId, jobId, sequence, trigger }, 'Turn started');

        span.setAttributes({
          'turn.id': turnId,
          'turn.sequence': sequence,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return turn;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Start a new interaction within a turn
   */
  async startInteraction(turnId: string, metadata?: Record<string, any>): Promise<Interaction> {
    const span = this.tracer.startSpan('interaction.start', {
      attributes: {
        'interaction.turn_id': turnId,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const sequence = await this.getNextInteractionSequence(turnId);
        const interactionId = uuidv4();

        await database.query(
          `INSERT INTO interactions (id, turn_id, sequence, state, metadata, created_at)
           VALUES ($1, $2, $3, 'pending', $4, CURRENT_TIMESTAMP)`,
          [interactionId, turnId, sequence, metadata ? JSON.stringify(metadata) : null]
        );

        const interaction: Interaction = {
          id: interactionId,
          turnId,
          sequence,
          state: 'pending',
          metadata,
          createdAt: new Date(),
        };

        logger.debug({ interactionId, turnId, sequence }, 'Interaction started');

        span.setAttributes({
          'interaction.id': interactionId,
          'interaction.sequence': sequence,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return interaction;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Record reasoning step for an interaction
   */
  async recordReasoning(
    interactionId: string,
    reasoning: { prompt: string; response: string; model: string; tokens: number }
  ): Promise<void> {
    try {
      await database.query(
        `UPDATE interactions
         SET reasoning = $1, state = 'acting'
         WHERE id = $2`,
        [JSON.stringify(reasoning), interactionId]
      );

      logger.debug({ interactionId, model: reasoning.model, tokens: reasoning.tokens }, 'Reasoning recorded');
    } catch (error) {
      logger.error({ error, interactionId }, 'Failed to record reasoning');
      throw error;
    }
  }

  /**
   * Record an action (tool execution)
   */
  async recordAction(action: Omit<Action, 'id' | 'createdAt' | 'completedAt'>): Promise<string> {
    try {
      const actionId = uuidv4();

      await database.query(
        `INSERT INTO actions (id, interaction_id, tool, input, output, duration_ms, error, created_at, completed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          actionId,
          action.interactionId,
          action.tool,
          JSON.stringify(action.input),
          action.output ? JSON.stringify(action.output) : null,
          action.durationMs,
          action.error,
        ]
      );

      logger.debug({ actionId, tool: action.tool, durationMs: action.durationMs }, 'Action recorded');

      return actionId;
    } catch (error) {
      logger.error({ error, action }, 'Failed to record action');
      throw error;
    }
  }

  /**
   * Complete an interaction
   */
  async completeInteraction(interactionId: string, state: 'completed' | 'failed'): Promise<void> {
    try {
      await database.query(
        `UPDATE interactions
         SET state = $1, completed_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [state, interactionId]
      );

      logger.debug({ interactionId, state }, 'Interaction completed');
    } catch (error) {
      logger.error({ error, interactionId }, 'Failed to complete interaction');
      throw error;
    }
  }

  /**
   * Complete a turn
   */
  async completeTurn(turnId: string, state: 'completed' | 'failed'): Promise<void> {
    try {
      await database.query(
        `UPDATE turns
         SET state = $1, completed_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [state, turnId]
      );

      logger.info({ turnId, state }, 'Turn completed');
    } catch (error) {
      logger.error({ error, turnId }, 'Failed to complete turn');
      throw error;
    }
  }

  /**
   * Get all turns for a job
   */
  async getTurnsForJob(jobId: string): Promise<Turn[]> {
    try {
      const result = await database.query(
        `SELECT * FROM turns WHERE job_id = $1 ORDER BY sequence`,
        [jobId]
      );

      return result.rows.map((row) => ({
        id: row.id,
        jobId: row.job_id,
        sequence: row.sequence,
        state: row.state,
        trigger: row.trigger,
        metadata: row.metadata,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }));
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to get turns');
      return [];
    }
  }

  /**
   * Get all interactions for a turn
   */
  async getInteractionsForTurn(turnId: string): Promise<Interaction[]> {
    try {
      const result = await database.query(
        `SELECT * FROM interactions WHERE turn_id = $1 ORDER BY sequence`,
        [turnId]
      );

      return result.rows.map((row) => ({
        id: row.id,
        turnId: row.turn_id,
        sequence: row.sequence,
        reasoning: row.reasoning,
        state: row.state,
        metadata: row.metadata,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }));
    } catch (error) {
      logger.error({ error, turnId }, 'Failed to get interactions');
      return [];
    }
  }

  /**
   * Get all actions for an interaction
   */
  async getActionsForInteraction(interactionId: string): Promise<Action[]> {
    try {
      const result = await database.query(
        `SELECT * FROM actions WHERE interaction_id = $1 ORDER BY created_at`,
        [interactionId]
      );

      return result.rows.map((row) => ({
        id: row.id,
        interactionId: row.interaction_id,
        tool: row.tool,
        input: row.input,
        output: row.output,
        durationMs: row.duration_ms,
        error: row.error,
        createdAt: row.created_at,
        completedAt: row.completed_at,
      }));
    } catch (error) {
      logger.error({ error, interactionId }, 'Failed to get actions');
      return [];
    }
  }

  /**
   * Get turn summary for a job
   */
  async getTurnSummary(jobId: string): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT * FROM get_turn_summary($1)`,
        [jobId]
      );

      return result.rows;
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to get turn summary');
      return [];
    }
  }

  /**
   * Helper: Get next turn sequence number
   */
  private async getNextTurnSequence(jobId: string): Promise<number> {
    const result = await database.query(
      `SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM turns WHERE job_id = $1`,
      [jobId]
    );
    return result.rows[0].next_seq;
  }

  /**
   * Helper: Get next interaction sequence number
   */
  private async getNextInteractionSequence(turnId: string): Promise<number> {
    const result = await database.query(
      `SELECT COALESCE(MAX(sequence), 0) + 1 as next_seq FROM interactions WHERE turn_id = $1`,
      [turnId]
    );
    return result.rows[0].next_seq;
  }
}

export default TurnManager.getInstance();
