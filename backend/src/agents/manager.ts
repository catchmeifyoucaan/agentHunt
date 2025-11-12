import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob, ManagerCommand, Intent, Action } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import queue from '../services/queue';
import ai from '../services/ai';
import events from '../services/events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

/**
 * Manager Agent
 * Conversational AI coordinator that:
 * - Accepts natural language commands
 * - Orchestrates other agents
 * - Provides live progress updates
 * - Requests human approvals
 * - Enforces safety policies
 */
export class ManagerAgent extends BaseAgent<BaseJob> {
  private conversationHistory: Map<string, any[]> = new Map();

  constructor() {
    super('manager');
  }

  async process(job: Job<BaseJob>): Promise<any> {
    // Manager agent is typically invoked via API, not queue
    // This method handles batch operations
    return { status: 'ok' };
  }

  /**
   * Process a conversational command from user
   */
  async processCommand(
    command: string,
    userId: string,
    programId?: string
  ): Promise<ManagerCommand> {
    const commandId = uuidv4();

    try {
      // Get context
      const context = await this.getContext(programId);

      // Get conversation history
      const history = this.conversationHistory.get(userId) || [];

      // Parse command with AI
      const parsed = await ai.processManagerCommand(command, context);

      // Validate and execute actions
      const executedActions: Action[] = [];

      for (const action of parsed.actions || []) {
        try {
          // Check if requires human approval
          if (parsed.requires_human_approval && action.type !== 'query_status') {
            await events.emitHumanActionRequest({
              action: action.type,
              reason: `Command "${command}" requires human approval`,
              options: ['approve', 'reject'],
              requiredApproval: true,
              programId,
              context: {
                command,
                action,
                parsedIntent: parsed.intent,
              },
            });

            executedActions.push({
              type: action.type,
              params: action.params,
              result: 'pending_approval',
            });

            continue;
          }

          // Execute action
          const result = await this.executeAction(action, programId, userId);
          executedActions.push({
            type: action.type,
            params: action.params,
            result,
          });
        } catch (error: any) {
          executedActions.push({
            type: action.type,
            params: action.params,
            error: error.message,
          });
        }
      }

      // Generate conversational response
      const response =
        parsed.response ||
        (await ai.generateConversationalResponse(command, history, context));

      // Save command to database
      await database.query(
        `INSERT INTO manager_commands (id, command, program_id, user_id, parsed_intent, response, executed_actions)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          commandId,
          command,
          programId || null,
          userId,
          JSON.stringify({ intent: parsed.intent, entities: parsed.entities, confidence: parsed.confidence }),
          response,
          JSON.stringify(executedActions),
        ]
      );

      // Update conversation history
      history.push(
        { role: 'user', content: command },
        { role: 'assistant', content: response }
      );
      this.conversationHistory.set(userId, history.slice(-20)); // Keep last 10 exchanges

      const result: ManagerCommand = {
        id: commandId,
        command,
        programId,
        userId,
        parsedIntent: {
          action: parsed.intent,
          entities: parsed.entities,
          confidence: parsed.confidence,
        },
        response,
        executedActions,
        timestamp: new Date(),
      };

      logger.info({ commandId, userId, intent: parsed.intent }, 'Manager command processed');

      return result;
    } catch (error: any) {
      logger.error({ error, command, userId }, 'Manager command processing failed');
      throw error;
    }
  }

  private async getContext(programId?: string): Promise<any> {
    // Get active jobs count
    const jobsResult = await database.query(
      'SELECT status, COUNT(*) as count FROM jobs GROUP BY status'
    );

    const jobCounts: Record<string, number> = {};
    jobsResult.rows.forEach((row) => {
      jobCounts[row.status] = parseInt(row.count, 10);
    });

    // Get recent findings
    const findingsResult = await database.query(
      `SELECT COUNT(*) as count FROM findings
       WHERE created_at > NOW() - INTERVAL '24 hours'
       ${programId ? 'AND program_id = $1' : ''}`,
      programId ? [programId] : []
    );

    // Get programs
    const programsResult = await database.query('SELECT id, name, slug FROM programs');

    return {
      activeJobs: jobCounts.active || 0,
      queuedJobs: jobCounts.pending || 0,
      recentFindings: parseInt(findingsResult.rows[0].count, 10),
      programs: programsResult.rows,
      timestamp: new Date(),
    };
  }

  private async executeAction(action: Action, programId?: string, userId?: string): Promise<any> {
    switch (action.type) {
      case 'create_job':
        return await this.createJob(action.params, programId);

      case 'update_policy':
        return await this.updatePolicy(action.params, programId);

      case 'query_status':
        return await this.queryStatus(action.params, programId);

      case 'pause_queue':
        return await this.pauseQueue(action.params);

      case 'resume_queue':
        return await this.resumeQueue(action.params);

      case 'cancel_job':
        return await this.cancelJob(action.params);

      case 'start_recovery':
      case 'recovery':
        return await this.startRecovery(action.params, programId);

      case 'query_findings':
        return await this.queryStatus({ query_type: 'findings', ...action.params }, programId);

      case 'summarize_findings':
        return await this.summarizeFindings(action.params, programId);

      case 'suggest_triage':
        return await this.suggestTriage(action.params, programId);

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async createJob(params: any, programId?: string): Promise<any> {
    const jobType = params.job_type || params.type;
    const priority = params.priority || 5;

    const jobId = uuidv4();

    const job: BaseJob = {
      id: jobId,
      type: jobType,
      programId: programId || params.program_id,
      priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: params.options || {},
      metadata: {
        requestedBy: 'manager-ai',
        tags: params.tags || [],
      },
    } as any;

    await queue.addJob(jobType, job);

    logger.info({ jobId, jobType, programId }, 'Job created by Manager AI');

    return { jobId, status: 'queued' };
  }

  private async updatePolicy(params: any, programId?: string): Promise<any> {
    if (!programId) {
      throw new Error('Program ID required for policy update');
    }

    const result = await database.query('SELECT policy FROM programs WHERE id = $1', [programId]);

    if (result.rows.length === 0) {
      throw new Error(`Program ${programId} not found`);
    }

    const currentPolicy = result.rows[0].policy;
    const updatedPolicy = { ...currentPolicy };

    // Handle specific policy updates
    if (params.updates) {
      if (params.updates.allowedTemplates) {
        updatedPolicy.allowedTemplates = { ...updatedPolicy.allowedTemplates, ...params.updates.allowedTemplates };
      }
      if (params.updates.rateLimit) {
        updatedPolicy.rateLimit = { ...updatedPolicy.rateLimit, ...params.updates.rateLimit };
      }
      // Merge other top-level policy fields directly
      for (const key in params.updates) {
        if (key !== 'allowedTemplates' && key !== 'rateLimit') {
          updatedPolicy[key] = params.updates[key];
        }
      }
    }

    await database.query('UPDATE programs SET policy = $1 WHERE id = $2', [
      JSON.stringify(updatedPolicy),
      programId,
    ]);

    logger.info({ programId, updates: params.updates }, 'Policy updated by Manager AI');

    return { updated: true, policy: updatedPolicy };
  }

  private async queryStatus(params: any, programId?: string): Promise<any> {
    if (params.job_id) {
      const result = await database.query('SELECT * FROM jobs WHERE id = $1', [params.job_id]);
      return result.rows[0] || null;
    }

    if (params.finding_id) {
      const result = await database.query('SELECT * FROM findings WHERE id = $1', [
        params.finding_id,
      ]);
      return result.rows[0] || null;
    }

    // New: Query findings with filters
    if (params.query_type === 'findings') {
      let query = `SELECT * FROM findings WHERE program_id = $1`;
      const queryParams = [programId];
      let paramIndex = 2;

      if (params.severity) {
        query += ` AND severity = $${paramIndex++}`;
        queryParams.push(params.severity);
      }
      if (params.status) {
        query += ` AND status = $${paramIndex++}`;
        queryParams.push(params.status);
      }
      if (params.timeRange) {
        // Example: '24 hours', '7 days', '30 days'
        query += ` AND created_at > NOW() - INTERVAL '${params.timeRange}'`;
      }
      query += ` ORDER BY created_at DESC LIMIT ${params.limit || 10}`;

      const result = await database.query(query, queryParams);
      return result.rows;
    }

    if (programId) {
      const jobs = await database.query(
        'SELECT status, COUNT(*) as count FROM jobs WHERE program_id = $1 GROUP BY status',
        [programId]
      );

      const findings = await database.query(
        'SELECT severity, COUNT(*) as count FROM findings WHERE program_id = $1 GROUP BY severity',
        [programId]
      );

      return {
        jobs: Object.fromEntries(jobs.rows.map((r) => [r.status, parseInt(r.count, 10)])),
        findings: Object.fromEntries(
          findings.rows.map((r) => [r.severity, parseInt(r.count, 10)])
        ),
      };
    }

    return await this.getContext();
  }

  private async pauseQueue(params: any): Promise<any> {
    const queueName = params.queue || params.agent_type;
    await queue.pauseQueue(queueName);
    return { paused: true, queue: queueName };
  }

  private async resumeQueue(params: any): Promise<any> {
    const queueName = params.queue || params.agent_type;
    await queue.resumeQueue(queueName);
    return { resumed: true, queue: queueName };
  }

  private async cancelJob(params: any): Promise<any> {
    const jobId = params.job_id;

    await database.query(
      'UPDATE jobs SET status = $1 WHERE id = $2',
      ['cancelled', jobId]
    );

    return { cancelled: true, jobId };
  }

  private async startRecovery(params: any, programId?: string): Promise<any> {
    if (!programId) {
      throw new Error('Program ID required for recovery');
    }

    // Get failed jobs for the program
    const failedJobs = await database.query(
      'SELECT * FROM jobs WHERE program_id = $1 AND status = $2 ORDER BY created_at DESC',
      [programId, 'failed']
    );

    const recoveryJobs = [];

    for (const job of failedJobs.rows) {
      // Only retry if attempts haven't exceeded max
      if (job.attempts < (job.max_attempts || 3)) {
        // Create recovery job
        const recoveryJobId = uuidv4();
        const recoveryJob: BaseJob = {
          id: recoveryJobId,
          type: job.type,
          programId,
          priority: 8, // Higher priority for recovery
          status: 'pending',
          attempts: 0,
          maxAttempts: 3,
          options: job.options || {},
          metadata: {
            ...job.metadata,
            isRecovery: true,
            originalJobId: job.id,
            recoveredAt: new Date().toISOString(),
          },
        } as any;

        await queue.addJob(job.type, recoveryJob);
        recoveryJobs.push({ jobId: recoveryJobId, originalJobId: job.id, type: job.type });
      }
    }

    // Also check for stalled jobs (active for > 1 hour)
    const stalledJobs = await database.query(
      `SELECT * FROM jobs
       WHERE program_id = $1
       AND status = $2
       AND started_at IS NOT NULL
       AND started_at < NOW() - INTERVAL '1 hour'`,
      [programId, 'active']
    );

    for (const job of stalledJobs.rows) {
      // Mark as failed first
      await database.query(
        'UPDATE jobs SET status = $1 WHERE id = $2',
        ['failed', job.id]
      );

      // Create recovery job
      const recoveryJobId = uuidv4();
      const recoveryJob: BaseJob = {
        id: recoveryJobId,
        type: job.type,
        programId,
        priority: 8,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: job.options || {},
        metadata: {
          ...job.metadata,
          isRecovery: true,
          originalJobId: job.id,
          stalledRecovery: true,
          recoveredAt: new Date().toISOString(),
        },
      } as any;

      await queue.addJob(job.type, recoveryJob);
      recoveryJobs.push({ jobId: recoveryJobId, originalJobId: job.id, type: job.type, wasStalled: true });
    }

    logger.info({ programId, recoveryCount: recoveryJobs.length }, 'Recovery jobs created');

    return {
      success: true,
      recoveredJobsCount: recoveryJobs.length,
      failedJobsCount: failedJobs.rows.length,
      stalledJobsCount: stalledJobs.rows.length,
      recoveryJobs,
    };
  }

  private async summarizeFindings(params: any, programId?: string): Promise<any> {
    if (!programId) {
      throw new Error('Program ID required for summarizing findings');
    }

    let query = `SELECT * FROM findings WHERE program_id = $1`;
    const queryParams = [programId];
    let paramIndex = 2;

    if (params.severity) {
      query += ` AND severity = $${paramIndex++}`;
      queryParams.push(params.severity);
    }
    if (params.status) {
      query += ` AND status = $${paramIndex++}`;
      queryParams.push(params.status);
    }
    if (params.timeRange) {
      query += ` AND created_at > NOW() - INTERVAL '${params.timeRange}'`;
    }
    query += ` ORDER BY created_at DESC LIMIT ${params.limit || 20}`;

    const findingsResult = await database.query(query, queryParams);
    const findings = findingsResult.rows;

    if (findings.length === 0) {
      return { summary: 'No findings found matching the criteria.' };
    }

    const summary = await ai.summarizeFindings(findings);
    logger.info({ programId, count: findings.length }, 'Findings summarized by Manager AI');

    return { summary, count: findings.length, findings: findings.map((f: any) => ({ id: f.id, title: f.title, severity: f.severity })) };
  }

  private async suggestTriage(params: any, programId?: string): Promise<any> {
    if (!params.finding_id) {
      throw new Error('Finding ID required for triage suggestion');
    }

    const findingResult = await database.query('SELECT * FROM findings WHERE id = $1', [params.finding_id]);

    if (findingResult.rows.length === 0) {
      throw new Error(`Finding ${params.finding_id} not found`);
    }

    const finding = findingResult.rows[0];
    const triageSuggestion = await ai.suggestTriageActions(finding);
    logger.info({ findingId: params.finding_id }, 'Triage suggestion generated by Manager AI');

    return { findingId: params.finding_id, triageSuggestion };
  }
}

export const managerAgent = new ManagerAgent();
