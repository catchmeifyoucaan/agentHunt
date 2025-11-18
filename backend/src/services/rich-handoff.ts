/**
 * Rich Handoff Service
 * Enables context-aware agent-to-agent handoffs with complete execution context
 *
 * Unlike simple job creation, rich handoffs pass:
 * - Full parent result and context
 * - Reasoning and decision factors
 * - Objectives and constraints
 * - Success criteria
 */

import { v4 as uuidv4 } from 'uuid';
import database from './database';
import queue from './queue';
import logger from '../utils/logger';
import agentCoordination from './agent-coordination';

export interface AgentInfo {
  type: string;
  instanceId?: string;
  jobId?: string;
  capabilities?: string[];
}

export interface HandoffContext {
  parentResult: any;
  reasoning: {
    trigger: string;
    confidence: number;
    decisionFactors: Record<string, any>;
  };
  objectives: {
    primary: string;
    secondary?: string[];
    avoid?: string[];
  };
  outputContract?: {
    required: string[];
    optional?: string[];
    format?: string;
  };
  constraints?: {
    timeLimit?: number;
    costLimit?: number;
    rateLimit?: number;
    scope?: string[];
  };
  inheritedContext?: Record<string, any>;
}

export interface CreateHandoffParams {
  from: AgentInfo;
  to: AgentInfo | { type: string; capabilities: string[] }; // Can specify capabilities instead of specific instance
  context: HandoffContext;
  priority?: number;
}

class RichHandoffService {
  /**
   * Create a rich handoff from one agent to another
   * Returns handoff ID for tracking
   */
  async createHandoff(params: CreateHandoffParams): Promise<string> {
    const handoffId = uuidv4();

    try {
      logger.info(
        {
          handoffId,
          from: params.from.type,
          to: 'to' in params.to && 'type' in params.to ? params.to.type : 'dynamic',
          primary: params.context.objectives.primary,
        },
        '🤝 Creating rich handoff'
      );

      // Store handoff in database
      await database.query(
        `INSERT INTO rich_handoffs (
          id, from_agent_type, from_instance_id, from_job_id,
          to_agent_type, to_instance_id, required_capabilities,
          context, status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
        [
          handoffId,
          params.from.type,
          params.from.instanceId || null,
          params.from.jobId || null,
          'type' in params.to ? params.to.type : null,
          'instanceId' in params.to ? params.to.instanceId : null,
          'capabilities' in params.to ? JSON.stringify(params.to.capabilities) : null,
          JSON.stringify(params.context),
          'pending',
        ]
      );

      // Find suitable agent and create job
      const targetAgent = await this.findSuitableAgent(params.to);

      if (targetAgent) {
        // Create job for target agent with full context
        const jobId = await this.createHandoffJob(
          handoffId,
          targetAgent,
          params.context,
          params.priority || 5
        );

        // Update handoff with job ID
        await database.query(
          `UPDATE rich_handoffs SET accepted_at = CURRENT_TIMESTAMP, to_instance_id = $1, job_id = $2, status = 'accepted'
           WHERE id = $3`,
          [targetAgent.instanceId, jobId, handoffId]
        );

        // Notify target agent via coordination service
        await agentCoordination.notifyAgent(
          {
            type: params.from.type as any,
            instanceId: params.from.instanceId || 'unknown',
            capabilities: params.from.capabilities || [],
            currentLoad: 0,
            version: '1.0.0',
          },
          targetAgent.type,
          {
            title: 'Handoff Created',
            message: `New handoff created: ${params.context.objectives.primary}`,
            data: {
              handoffId,
              jobId,
              primaryObjective: params.context.objectives.primary,
            },
          }
        );

        logger.info(
          { handoffId, targetAgent: targetAgent.type, jobId },
          '✅ Rich handoff accepted and job created'
        );
      } else {
        logger.warn(
          { handoffId, requiredCapabilities: 'capabilities' in params.to ? params.to.capabilities : [] },
          '⚠️ No suitable agent found for handoff'
        );
      }

      return handoffId;
    } catch (error: any) {
      logger.error({ error, handoffId }, 'Failed to create rich handoff');
      throw error;
    }
  }

  /**
   * Accept a handoff (called by target agent)
   */
  async acceptHandoff(handoffId: string, agentInfo: AgentInfo): Promise<HandoffContext> {
    try {
      const result = await database.query(
        `UPDATE rich_handoffs
         SET status = 'accepted', to_instance_id = $1, accepted_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND status = 'pending'
         RETURNING context`,
        [agentInfo.instanceId, handoffId]
      );

      if (result.rows.length === 0) {
        throw new Error('Handoff not found or already accepted');
      }

      const context = result.rows[0].context;

      logger.info({ handoffId, agent: agentInfo.type }, '✅ Handoff accepted');

      return context;
    } catch (error: any) {
      logger.error({ error, handoffId }, 'Failed to accept handoff');
      throw error;
    }
  }

  /**
   * Complete a handoff with result
   */
  async completeHandoff(
    handoffId: string,
    result: any,
    success: boolean,
    notes?: string
  ): Promise<void> {
    try {
      await database.query(
        `UPDATE rich_handoffs
         SET status = $1, result = $2, notes = $3, completed_at = CURRENT_TIMESTAMP
         WHERE id = $4`,
        [success ? 'completed' : 'failed', JSON.stringify(result), notes || null, handoffId]
      );

      logger.info({ handoffId, success }, '✅ Handoff completed');

      // Notify source agent of completion
      const handoff = await this.getHandoff(handoffId);
      if (handoff) {
        await agentCoordination.notifyAgent(
          {
            type: handoff.to_agent_type,
            instanceId: handoff.to_instance_id || 'unknown',
            capabilities: [],
            currentLoad: 0,
            version: '1.0.0',
          },
          handoff.from_agent_type,
          {
            title: 'Handoff Completed',
            message: `Handoff ${handoffId} ${success ? 'completed successfully' : 'failed'}`,
            data: {
              handoffId,
              success,
              result: success ? result : undefined,
              error: success ? undefined : result,
            },
          }
        );
      }
    } catch (error: any) {
      logger.error({ error, handoffId }, 'Failed to complete handoff');
      throw error;
    }
  }

  /**
   * Get handoff details
   */
  async getHandoff(handoffId: string): Promise<any> {
    const result = await database.query(
      'SELECT * FROM rich_handoffs WHERE id = $1',
      [handoffId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Get pending handoffs for an agent type
   */
  async getPendingHandoffs(agentType: string): Promise<any[]> {
    const result = await database.query(
      `SELECT * FROM rich_handoffs
       WHERE to_agent_type = $1 AND status = 'pending'
       ORDER BY created_at DESC
       LIMIT 50`,
      [agentType]
    );

    return result.rows;
  }

  /**
   * Find suitable agent for handoff
   * Matches based on agent type or required capabilities
   */
  private async findSuitableAgent(
    target: AgentInfo | { type: string; capabilities: string[] }
  ): Promise<AgentInfo | null> {
    // If specific instance requested, use it
    if ('instanceId' in target && target.instanceId) {
      return target as AgentInfo;
    }

    // If specific type requested, return that type
    if ('type' in target && !('capabilities' in target)) {
      return {
        type: target.type,
        capabilities: [],
      };
    }

    // If capabilities-based matching requested
    if ('capabilities' in target && target.capabilities && target.capabilities.length > 0) {
      const suitableAgentType = await agentCoordination.findBestAgent(target.capabilities);
      if (suitableAgentType) {
        const suitableAgent: AgentInfo = {
          type: suitableAgentType,
          instanceId: 'any', // Or logic to find a specific instance
          capabilities: target.capabilities,
        };
        logger.info(
          { handoffId: 'dynamic', targetCapabilities: target.capabilities, foundAgent: suitableAgent.type },
          'Found suitable agent via coordination service'
        );
        return suitableAgent;
      } else {
        logger.warn(
          { handoffId: 'dynamic', targetCapabilities: target.capabilities },
          'No suitable agent found via coordination service for required capabilities'
        );
        return null;
      }
    }

    logger.warn('No specific agent type or capabilities provided for handoff target');
    return null;
  }

  /**
   * Create job for handoff with full context
   */
  private async createHandoffJob(
    handoffId: string,
    targetAgent: AgentInfo,
    context: HandoffContext,
    priority: number
  ): Promise<string> {
    const jobId = uuidv4();

    // Create job based on target agent type
    const job: any = {
      id: jobId,
      type: targetAgent.type,
      programId: context.inheritedContext?.programId || 'unknown',
      priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        // Pass handoff context as options
        handoffContext: context,
        handoffId,
        // Extract specific options from context
        ...this.extractJobOptions(targetAgent.type, context),
      },
      metadata: {
        requestedBy: 'rich-handoff-service',
        handoffId,
        primaryObjective: context.objectives.primary,
        tags: ['handoff', `from-${context.inheritedContext?.sourceAgent || 'unknown'}`],
      },
      createdAt: new Date(),
    };

    // Extract parent_job_id from metadata if available
    const parentJobId = job.metadata?.parentJobId || job.metadata?.parent_job_id || null;
    
    // Save job to database
    await database.query(
      `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata, parent_job_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, COALESCE($11, CURRENT_TIMESTAMP))
       ON CONFLICT (id) DO UPDATE SET
         parent_job_id = COALESCE(EXCLUDED.parent_job_id, jobs.parent_job_id)`,
      [
        job.id,
        job.type,
        job.programId,
        job.priority,
        job.status,
        job.attempts,
        job.maxAttempts,
        JSON.stringify(job.options),
        JSON.stringify(job.metadata),
        parentJobId,
        job.createdAt || new Date(),
      ]
    );

    // Queue the job
    await queue.addJob(targetAgent.type as any, job);

    return jobId;
  }

  /**
   * Extract job-specific options from handoff context
   */
  private extractJobOptions(agentType: string, context: HandoffContext): any {
    const options: any = {};

    // Extract relevant data based on agent type
    switch (agentType) {
      case 'scanner':
        if (context.parentResult?.urls) {
          options.targetUrls = context.parentResult.urls;
        }
        if (context.parentResult?.technologies) {
          options.fingerprintData = { technologies: context.parentResult.technologies };
        }
        break;

      case 'triage':
        if (context.parentResult?.findings) {
          options.findings = context.parentResult.findings;
        }
        break;

      case 'confirm':
        if (context.parentResult?.vulnerabilities) {
          options.vulnerabilities = context.parentResult.vulnerabilities;
        }
        break;

      // Add more agent types as needed
    }

    return options;
  }
}

export const richHandoffService = new RichHandoffService();
export default richHandoffService;
