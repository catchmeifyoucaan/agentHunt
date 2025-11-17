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
import { sharedMemory } from '../services/three-agent/shared-memory';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);

/**
 * Manager Agent - GOD MODE
 * Autonomous overseer with admin superpowers:
 * - Accepts natural language commands
 * - Full system control (jobs, database, redis, files)
 * - Code generation and execution
 * - Autonomous monitoring and reporting
 * - Admin role system with approval workflows
 * - REQUIRES APPROVAL for critical operations
 */

// Danger levels for operations
enum DangerLevel {
  SAFE = 'safe',           // No approval needed
  ELEVATED = 'elevated',   // Log but execute
  CRITICAL = 'critical',   // REQUIRES approval
  DESTRUCTIVE = 'destructive' // REQUIRES explicit confirmation
}

interface DangerousOperation {
  action: string;
  dangerLevel: DangerLevel;
  requiresApproval: boolean;
  confirmationMessage: string;
}

export class ManagerAgent extends BaseAgent<BaseJob> {
  private conversationHistory: Map<string, any[]> = new Map();
  private monitoringEnabled: Map<string, boolean> = new Map();
  private adminUsers: Set<string> = new Set(['admin']); // Default admin user

  // Classification of dangerous operations
  private readonly dangerousOperations: Record<string, DangerousOperation> = {
    'kill_all_jobs': {
      action: 'kill_all_jobs',
      dangerLevel: DangerLevel.DESTRUCTIVE,
      requiresApproval: true,
      confirmationMessage: '⚠️ This will KILL ALL running jobs across all programs. Confirm?'
    },
    'flush_redis': {
      action: 'flush_redis',
      dangerLevel: DangerLevel.DESTRUCTIVE,
      requiresApproval: true,
      confirmationMessage: '⚠️ This will FLUSH ALL Redis data (shared memory, caches). Confirm?'
    },
    'flush_database': {
      action: 'flush_database',
      dangerLevel: DangerLevel.DESTRUCTIVE,
      requiresApproval: true,
      confirmationMessage: '🔥 This will DELETE ALL findings and jobs from database. Confirm?'
    },
    'delete_file': {
      action: 'delete_file',
      dangerLevel: DangerLevel.CRITICAL,
      requiresApproval: true,
      confirmationMessage: '⚠️ Confirm file deletion:'
    },
    'execute_script': {
      action: 'execute_script',
      dangerLevel: DangerLevel.CRITICAL,
      requiresApproval: true,
      confirmationMessage: '⚠️ Confirm script execution:'
    },
    'shell_command': {
      action: 'shell_command',
      dangerLevel: DangerLevel.CRITICAL,
      requiresApproval: true,
      confirmationMessage: '⚠️ Confirm shell command:'
    },
    'fix_agent_code': {
      action: 'fix_agent_code',
      dangerLevel: DangerLevel.CRITICAL,
      requiresApproval: true,
      confirmationMessage: '⚠️ Confirm agent code modification:'
    },
    'modify_config': {
      action: 'modify_config',
      dangerLevel: DangerLevel.CRITICAL,
      requiresApproval: true,
      confirmationMessage: '⚠️ Confirm configuration change:'
    }
  };

  constructor() {
    super('manager');
  }

  getSteps(): { name: string; metadata?: any }[] {
    return [
      { name: 'Parse natural language command' },
      { name: 'Extract intent and parameters' },
      { name: 'Validate safety constraints' },
      { name: 'Plan action sequence' },
      { name: 'Orchestrate agent execution' },
      { name: 'Monitor progress and provide updates' },
      { name: 'Request human approval if needed' },
      { name: 'Return execution results' }
    ];
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
          // 🔒 SAFETY CHECK: Check if operation requires approval
          const dangerousOp = this.dangerousOperations[action.type];

          if (dangerousOp && dangerousOp.requiresApproval) {
            // Emit approval request with danger level and confirmation message
            await events.emitHumanActionRequest({
              action: action.type,
              reason: dangerousOp.confirmationMessage,
              options: ['approve', 'reject'],
              requiredApproval: true,
              programId,
              context: {
                command,
                action,
                parsedIntent: parsed.intent,
                dangerLevel: dangerousOp.dangerLevel,
                params: action.params,
              },
            });

            executedActions.push({
              type: action.type,
              params: action.params,
              result: 'pending_approval',
              // dangerLevel: dangerousOp.dangerLevel, // Not in Action type
            } as any);

            logger.warn({
              userId,
              action: action.type,
              dangerLevel: dangerousOp.dangerLevel,
              command,
            }, '🚨 Critical operation awaiting approval');

            continue;
          }

          // Check if requires general human approval
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

          logger.error({
            userId,
            action: action.type,
            error: error.message,
            command,
          }, 'Manager action execution failed');
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

      // 🚀 THREE-AGENT INTEGRATION: Share manager orchestration events with swarm
      const swarmData = { swarmId: programId, enableSharedMemory: true }; // Manager can use programId as swarmId
      if (programId && executedActions.length > 0) {
        try {
          // Share orchestration events (not findings, but coordination events)
          await sharedMemory.shareSuccess(programId, {
            id: commandId,
            name: `manager-${parsed.intent}`,
            description: `Manager executed: ${command}`,
            successRate: executedActions.filter(a => a.result && !a.error).length / executedActions.length,
            metadata: {
              intent: parsed.intent,
              actionsExecuted: executedActions.length,
              userId,
              entities: parsed.entities,
              source: 'manager-agent',
            },
          });

          logger.info({
            programId,
            commandId,
            actionsExecuted: executedActions.length,
          }, '🔗 Manager shared orchestration event with swarm');
        } catch (error) {
          logger.error({ error, programId }, 'Failed to share manager orchestration');
        }
      }

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
      // Original actions
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

      // 🔥 SYSTEM OPERATIONS (Destructive - requires approval)
      case 'kill_all_jobs':
        return await this.killAllJobs();
      case 'flush_redis':
        return await this.flushRedis();
      case 'flush_database':
        return await this.flushDatabase();
      case 'system_stats':
        return await this.getSystemStats();
      case 'db_size':
        return await this.getDatabaseSize();
      case 'redis_stats':
        return await this.getRedisStats();

      // 📁 FILE OPERATIONS (Critical - requires approval for delete)
      case 'read_file':
        return await this.readFile(action.params);
      case 'list_directory':
        return await this.listDirectory(action.params);
      case 'delete_file':
        return await this.deleteFile(action.params);
      case 'file_stats':
        return await this.getFileStats(action.params);

      // 💻 CODE GENERATION & EXECUTION (Critical - requires approval)
      case 'generate_script':
        return await this.generateScript(action.params);
      case 'execute_script':
        return await this.executeScript(action.params);
      case 'shell_command':
        return await this.executeShellCommand(action.params);

      // 📊 MONITORING & REPORTING
      case 'enable_monitoring':
        return await this.enableMonitoring(userId!);
      case 'disable_monitoring':
        return await this.disableMonitoring(userId!);
      case 'health_report':
        return await this.generateHealthReport(programId);
      case 'agent_status':
        return await this.getAgentStatus();

      // 🔍 DEBUGGING & LOG ANALYSIS
      case 'read_job_logs':
        return await this.readJobLogs(action.params);
      case 'analyze_failures':
        return await this.analyzeFailures(action.params, programId);
      case 'read_tool_help':
        return await this.readToolHelp(action.params);
      case 'detect_errors':
        return await this.detectErrors(programId);
      case 'analyze_performance':
        return await this.analyzePerformance(action.params, programId);
      case 'fix_agent_code':
        return await this.fixAgentCode(action.params);
      case 'read_agent_code':
        return await this.readAgentCode(action.params);
      case 'monitor_handoffs':
        return await this.monitorHandoffs(programId);
      case 'restart_worker':
        return await this.restartWorker(action.params);
      case 'monitor_queues':
        return await this.monitorQueues();
      case 'scale_workers':
        return await this.scaleWorkers(action.params.processName, action.params.instances);

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

  // ============================================================================
  // 🔥 SYSTEM OPERATIONS (GOD MODE)
  // ============================================================================

  private async killAllJobs(): Promise<any> {
    logger.warn('🔥 KILLING ALL JOBS - Destructive operation initiated');

    // Get all active and pending jobs
    const result = await database.query(
      `SELECT id, type, status FROM jobs WHERE status IN ('active', 'pending')`
    );

    const jobsToKill = result.rows;
    const killedJobs: string[] = [];

    // Mark all as cancelled in database
    await database.query(
      `UPDATE jobs SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
       WHERE status IN ('active', 'pending')`
    );

    // Obliterate all BullMQ queues
    const queueNames = ['scanner', 'discovery', 'xss', 'sqli', 'fingerprint', 'crawl',
                        'portscan', 'osint', 'webvulns', 'jsanalysis', 'cloudmisconfig',
                        'subdomain', 'triage', 'confirm', 'ssrf', 'browser', 'bruteforce',
                        'interact', 'apifuzz', 'manager'];

    for (const queueName of queueNames) {
      try {
        await (queue as any).obliterateQueue(queueName);
      } catch (error) {
        logger.warn({ queueName, error }, 'Failed to obliterate queue');
      }
    }

    logger.warn({ killedCount: jobsToKill.length }, '💀 All jobs killed');

    return {
      success: true,
      killedJobs: jobsToKill.length,
      queuesObliterated: queueNames.length,
      timestamp: new Date()
    };
  }

  private async flushRedis(): Promise<any> {
    logger.warn('🔥 FLUSHING REDIS - All cache and shared memory will be deleted');

    const redis = require('../services/redis').default;

    // Get stats before flush
    const keysBefore = await redis.dbsize();

    // FLUSH ALL
    await redis.flushall();

    const keysAfter = await redis.dbsize();

    logger.warn({ keysBefore, keysAfter }, '💀 Redis flushed');

    return {
      success: true,
      keysDeleted: keysBefore,
      timestamp: new Date()
    };
  }

  private async flushDatabase(): Promise<any> {
    logger.warn('🔥🔥🔥 FLUSHING DATABASE - ALL findings and jobs will be DELETED');

    // Truncate tables (cascade deletes related data)
    await database.query(`
      TRUNCATE TABLE findings, jobs, manager_commands CASCADE
    `);

    logger.warn('💀 Database flushed - all findings and jobs deleted');

    return {
      success: true,
      tablesCleared: ['findings', 'jobs', 'manager_commands'],
      timestamp: new Date()
    };
  }

  private async getSystemStats(): Promise<any> {
    const stats: any = {
      timestamp: new Date(),
      system: {},
      process: {}
    };

    try {
      // CPU info
      const cpus = os.cpus();
      stats.system.cpu = {
        count: cpus.length,
        model: cpus[0].model,
        speed: cpus[0].speed
      };

      // Memory
      stats.system.memory = {
        total: `${(os.totalmem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        free: `${(os.freemem() / 1024 / 1024 / 1024).toFixed(2)} GB`,
        used: `${((os.totalmem() - os.freemem()) / 1024 / 1024 / 1024).toFixed(2)} GB`,
        usagePercent: `${(((os.totalmem() - os.freemem()) / os.totalmem()) * 100).toFixed(1)}%`
      };

      // Process stats
      const processMemory = process.memoryUsage();
      stats.process = {
        uptime: `${(process.uptime() / 3600).toFixed(2)} hours`,
        memory: {
          heapUsed: `${(processMemory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
          heapTotal: `${(processMemory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
          rss: `${(processMemory.rss / 1024 / 1024).toFixed(2)} MB`
        },
        pid: process.pid
      };

      // Disk usage (Linux/Mac)
      try {
        const { stdout } = await execAsync('df -h / | tail -1');
        const parts = stdout.trim().split(/\s+/);
        stats.system.disk = {
          total: parts[1],
          used: parts[2],
          available: parts[3],
          usagePercent: parts[4]
        };
      } catch (error) {
        stats.system.disk = { error: 'Unable to get disk stats' };
      }

      // Load average (Linux/Mac)
      stats.system.loadAverage = os.loadavg();

    } catch (error: any) {
      logger.error({ error }, 'Failed to get system stats');
      stats.error = error.message;
    }

    return stats;
  }

  private async getDatabaseSize(): Promise<any> {
    const sizeResult = await database.query(`
      SELECT
        pg_database_size(current_database()) as size_bytes,
        pg_size_pretty(pg_database_size(current_database())) as size_pretty
    `);

    const tableStats = await database.query(`
      SELECT
        tablename,
        pg_size_pretty(pg_total_relation_size(tablename::text)) as size
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(tablename::text) DESC
      LIMIT 10
    `);

    return {
      totalSize: sizeResult.rows[0].size_pretty,
      sizeBytes: parseInt(sizeResult.rows[0].size_bytes),
      topTables: tableStats.rows
    };
  }

  private async getRedisStats(): Promise<any> {
    const redis = require('../services/redis').default;

    const info = await redis.info();
    const dbsize = await redis.dbsize();
    const memory = await redis.info('memory');

    return {
      keys: dbsize,
      memoryUsed: memory.match(/used_memory_human:(.*)/)?.[1] || 'unknown',
      version: info.match(/redis_version:(.*)/)?.[1] || 'unknown',
      uptime: info.match(/uptime_in_days:(.*)/)?.[1] || 'unknown'
    };
  }

  // ============================================================================
  // 📁 FILE OPERATIONS
  // ============================================================================

  private async readFile(params: any): Promise<any> {
    const filePath = params.path || params.file_path;

    if (!filePath) {
      throw new Error('File path required');
    }

    // Security: Only allow reading from specific directories
    const allowedDirs = ['/tmp', '/var/log/agenthunt', (config as any).storage?.localPath || '/app/storage'];
    const resolvedPath = path.resolve(filePath);

    const isAllowed = allowedDirs.some(dir => resolvedPath.startsWith(dir));
    if (!isAllowed) {
      throw new Error(`Access denied: Can only read from ${allowedDirs.join(', ')}`);
    }

    const content = await fs.readFile(resolvedPath, 'utf-8');
    const stats = await fs.stat(resolvedPath);

    return {
      path: resolvedPath,
      content: content.length > 10000 ? content.substring(0, 10000) + '\n... (truncated)' : content,
      size: stats.size,
      modified: stats.mtime
    };
  }

  private async listDirectory(params: any): Promise<any> {
    const dirPath = params.path || params.directory;

    if (!dirPath) {
      throw new Error('Directory path required');
    }

    const allowedDirs = ['/tmp', '/var/log', (config as any).storage?.localPath || '/app/storage'];
    const resolvedPath = path.resolve(dirPath);

    const isAllowed = allowedDirs.some(dir => resolvedPath.startsWith(dir));
    if (!isAllowed) {
      throw new Error(`Access denied: Can only list ${allowedDirs.join(', ')}`);
    }

    const files = await fs.readdir(resolvedPath, { withFileTypes: true });

    const items = await Promise.all(files.map(async (file) => {
      const fullPath = path.join(resolvedPath, file.name);
      try {
        const stats = await fs.stat(fullPath);
        return {
          name: file.name,
          type: file.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          modified: stats.mtime
        };
      } catch (error) {
        return {
          name: file.name,
          type: 'unknown',
          error: 'Cannot stat'
        };
      }
    }));

    return {
      path: resolvedPath,
      items,
      count: items.length
    };
  }

  private async deleteFile(params: any): Promise<any> {
    const filePath = params.path || params.file_path;

    if (!filePath) {
      throw new Error('File path required');
    }

    const allowedDirs = ['/tmp', (config as any).storage?.localPath || '/app/storage'];
    const resolvedPath = path.resolve(filePath);

    const isAllowed = allowedDirs.some(dir => resolvedPath.startsWith(dir));
    if (!isAllowed) {
      throw new Error(`Access denied: Can only delete from ${allowedDirs.join(', ')}`);
    }

    await fs.unlink(resolvedPath);
    logger.warn({ path: resolvedPath }, '🗑️  File deleted');

    return {
      success: true,
      deleted: resolvedPath,
      timestamp: new Date()
    };
  }

  private async getFileStats(params: any): Promise<any> {
    const dirPath = params.path || '/tmp';
    const { stdout } = await execAsync(`du -sh ${dirPath}/* 2>/dev/null || echo "No files"`);

    return {
      path: dirPath,
      usage: stdout.trim().split('\n').slice(0, 20) // Top 20 largest
    };
  }

  // ============================================================================
  // 💻 CODE GENERATION & EXECUTION
  // ============================================================================

  private async generateScript(params: any): Promise<any> {
    const description = params.description || params.task;

    if (!description) {
      throw new Error('Script description required');
    }

    logger.info({ description }, 'Generating script with AI');

    // Use AI to generate code
    const code = await (ai as any).generateCode({
      task: description,
      language: params.language || 'bash',
      context: params.context || {}
    });

    return {
      code,
      language: params.language || 'bash',
      description,
      warning: '⚠️ Review code before execution'
    };
  }

  private async executeScript(params: any): Promise<any> {
    const code = params.code || params.script;
    const language = params.language || 'bash';

    if (!code) {
      throw new Error('Script code required');
    }

    logger.warn({ language, codeLength: code.length }, '⚠️ Executing generated script');

    let result;

    if (language === 'bash' || language === 'sh') {
      // Execute bash script
      const tempFile = path.join('/tmp', `manager-script-${uuidv4()}.sh`);
      await fs.writeFile(tempFile, code);
      await fs.chmod(tempFile, '755');

      try {
        const { stdout, stderr } = await execAsync(tempFile, { timeout: 60000 });
        result = { stdout, stderr, exitCode: 0 };
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
    } else if (language === 'python') {
      // Execute Python script
      const tempFile = path.join('/tmp', `manager-script-${uuidv4()}.py`);
      await fs.writeFile(tempFile, code);

      try {
        const { stdout, stderr } = await execAsync(`python3 ${tempFile}`, { timeout: 60000 });
        result = { stdout, stderr, exitCode: 0 };
      } finally {
        await fs.unlink(tempFile).catch(() => {});
      }
    } else {
      throw new Error(`Unsupported language: ${language}`);
    }

    return {
      success: true,
      ...result,
      executedAt: new Date()
    };
  }

  private async executeShellCommand(params: any): Promise<any> {
    const command = params.command || params.cmd;

    if (!command) {
      throw new Error('Command required');
    }

    logger.warn({ command }, '⚠️ Executing shell command');

    const { stdout, stderr } = await execAsync(command, {
      timeout: params.timeout || 30000,
      maxBuffer: 10 * 1024 * 1024 // 10MB
    });

    return {
      command,
      stdout,
      stderr,
      executedAt: new Date()
    };
  }

  // ============================================================================
  // 📊 AUTONOMOUS MONITORING & REPORTING
  // ============================================================================

  private async enableMonitoring(userId: string): Promise<any> {
    this.monitoringEnabled.set(userId, true);

    // Start background monitoring
    this.startMonitoringLoop(userId);

    logger.info({ userId }, '📊 Autonomous monitoring enabled');

    return {
      success: true,
      message: '📊 Monitoring enabled - I will proactively report system status',
      userId
    };
  }

  private async disableMonitoring(userId: string): Promise<any> {
    this.monitoringEnabled.set(userId, false);

    logger.info({ userId }, '📊 Autonomous monitoring disabled');

    return {
      success: true,
      message: 'Monitoring disabled',
      userId
    };
  }

  private async startMonitoringLoop(userId: string): Promise<void> {
    // This would ideally run in a separate worker process
    // For now, it's a placeholder for the monitoring architecture

    setTimeout(async () => {
      if (!this.monitoringEnabled.get(userId)) return;

      try {
        const health = await this.generateHealthReport();

        // Check for issues
        if (health.issues.length > 0) {
          await events.emit('manager_alert', {
            userId,
            type: 'health_issue',
            message: `🚨 Detected ${health.issues.length} issues`,
            issues: health.issues,
            timestamp: new Date()
          });
        }

        // Continue monitoring
        this.startMonitoringLoop(userId);
      } catch (error) {
        logger.error({ error, userId }, 'Monitoring loop error');
      }
    }, 60000); // Check every minute
  }

  private async generateHealthReport(programId?: string): Promise<any> {
    const report: any = {
      timestamp: new Date(),
      overall: 'healthy',
      issues: [],
      stats: {}
    };

    try {
      // Check job queues
      const jobStats = await database.query(`
        SELECT status, COUNT(*) as count
        FROM jobs
        ${programId ? 'WHERE program_id = $1' : ''}
        GROUP BY status
      `, programId ? [programId] : []);

      const jobs: any = {};
      jobStats.rows.forEach(row => {
        jobs[row.status] = parseInt(row.count);
      });

      report.stats.jobs = jobs;

      // Check for stalled jobs
      const stalledJobs = await database.query(`
        SELECT COUNT(*) as count FROM jobs
        WHERE status = 'active'
        AND started_at < NOW() - INTERVAL '2 hours'
        ${programId ? 'AND program_id = $1' : ''}
      `, programId ? [programId] : []);

      const stalledCount = parseInt(stalledJobs.rows[0].count);
      if (stalledCount > 0) {
        report.issues.push({
          type: 'stalled_jobs',
          severity: 'warning',
          message: `${stalledCount} jobs stalled for >2 hours`,
          action: 'Consider running recovery'
        });
        report.overall = 'degraded';
      }

      // Check queue health
      if (jobs.failed > 50) {
        report.issues.push({
          type: 'high_failure_rate',
          severity: 'warning',
          message: `${jobs.failed} failed jobs`,
          action: 'Review error logs'
        });
        report.overall = 'degraded';
      }

      // Check system resources
      const systemStats = await this.getSystemStats();
      const memoryUsage = parseFloat(systemStats.system.memory.usagePercent);

      if (memoryUsage > 85) {
        report.issues.push({
          type: 'high_memory',
          severity: 'critical',
          message: `Memory usage at ${systemStats.system.memory.usagePercent}`,
          action: 'Consider scaling or cleanup'
        });
        report.overall = 'critical';
      }

      report.stats.system = systemStats;

    } catch (error: any) {
      logger.error({ error }, 'Failed to generate health report');
      report.error = error.message;
    }

    return report;
  }

  private async getAgentStatus(): Promise<any> {
    // Get status of all agent queues
    const agentTypes = ['scanner', 'discovery', 'xss', 'sqli', 'fingerprint', 'crawl',
                        'portscan', 'osint', 'webvulns', 'jsanalysis', 'cloudmisconfig',
                        'subdomain', 'triage', 'confirm', 'ssrf', 'browser', 'bruteforce',
                        'interact', 'apifuzz', 'manager'];

    const status: any = {};

    for (const agentType of agentTypes) {
      try {
        const counts = await (queue as any).getJobCounts(agentType);
        status[agentType] = counts;
      } catch (error) {
        status[agentType] = { error: 'Unable to fetch' };
      }
    }

    return {
      agents: status,
      timestamp: new Date()
    };
  }

  // ============================================================================
  // 🔍 DEBUGGING & LOG ANALYSIS (DevOps Engineer Mode)
  // ============================================================================

  private async readJobLogs(params: any): Promise<any> {
    const jobId = params.job_id || params.jobId;

    if (!jobId) {
      throw new Error('Job ID required');
    }

    logger.info({ jobId }, '📖 Reading job logs');

    // Get job execution logs
    const logsResult = await database.query(
      `SELECT * FROM job_execution_logs
       WHERE job_id = $1
       ORDER BY created_at DESC
       LIMIT ${params.limit || 100}`,
      [jobId]
    );

    // Get job details
    const jobResult = await database.query(
      'SELECT * FROM jobs WHERE id = $1',
      [jobId]
    );

    const logs = logsResult.rows.map(log => ({
      timestamp: log.created_at,
      agent: log.agent_type,
      action: log.action,
      level: log.level,
      message: log.message,
      metadata: log.metadata
    }));

    return {
      jobId,
      job: jobResult.rows[0] || null,
      logs,
      totalLogs: logs.length,
      analysis: await this.analyzeLogs(logs)
    };
  }

  private async analyzeLogs(logs: any[]): Promise<any> {
    const errors = logs.filter(log => log.level === 'error');
    const warnings = logs.filter(log => log.level === 'warn');

    const patterns = {
      commandErrors: errors.filter(log =>
        log.message?.includes('Command failed') ||
        log.message?.includes('spawn') ||
        log.message?.includes('ENOENT')
      ),
      networkErrors: errors.filter(log =>
        log.message?.includes('ECONNREFUSED') ||
        log.message?.includes('timeout') ||
        log.message?.includes('ETIMEDOUT')
      ),
      permissionErrors: errors.filter(log =>
        log.message?.includes('EACCES') ||
        log.message?.includes('permission denied')
      ),
      configErrors: errors.filter(log =>
        log.message?.includes('Invalid') ||
        log.message?.includes('not found') ||
        log.message?.includes('undefined')
      )
    };

    const insights = [];

    if (patterns.commandErrors.length > 0) {
      insights.push({
        type: 'command_error',
        count: patterns.commandErrors.length,
        suggestion: 'Check tool installation and command flags',
        samples: patterns.commandErrors.slice(0, 3).map(e => e.message)
      });
    }

    if (patterns.networkErrors.length > 0) {
      insights.push({
        type: 'network_error',
        count: patterns.networkErrors.length,
        suggestion: 'Check network connectivity and timeouts',
        samples: patterns.networkErrors.slice(0, 3).map(e => e.message)
      });
    }

    if (patterns.configErrors.length > 0) {
      insights.push({
        type: 'config_error',
        count: patterns.configErrors.length,
        suggestion: 'Review configuration and tool flags',
        samples: patterns.configErrors.slice(0, 3).map(e => e.message)
      });
    }

    return {
      summary: {
        total: logs.length,
        errors: errors.length,
        warnings: warnings.length
      },
      patterns,
      insights
    };
  }

  private async analyzeFailures(params: any, programId?: string): Promise<any> {
    logger.info({ programId }, '🔍 Analyzing failed jobs');

    // Get recent failed jobs
    const failedJobs = await database.query(
      `SELECT * FROM jobs
       WHERE status = 'failed'
       ${programId ? 'AND program_id = $1' : ''}
       ORDER BY updated_at DESC
       LIMIT ${params?.limit || 20}`,
      programId ? [programId] : []
    );

    const failures = failedJobs.rows;
    const analysis: any = {
      totalFailures: failures.length,
      byAgent: {},
      commonErrors: {},
      silentFailures: [],
      recommendations: []
    };

    // Group by agent type
    failures.forEach((job: any) => {
      const agentType = job.type;
      if (!analysis.byAgent[agentType]) {
        analysis.byAgent[agentType] = [];
      }
      analysis.byAgent[agentType].push({
        jobId: job.id,
        error: job.error,
        attempts: job.attempts,
        updatedAt: job.updated_at
      });
    });

    // Analyze error patterns
    for (const job of failures) {
      if (job.error) {
        const errorKey = job.error.substring(0, 100); // First 100 chars
        analysis.commonErrors[errorKey] = (analysis.commonErrors[errorKey] || 0) + 1;
      } else {
        // Silent failure - no error message
        analysis.silentFailures.push({
          jobId: job.id,
          type: job.type,
          updatedAt: job.updated_at
        });
      }
    }

    // Generate recommendations
    const topAgents = Object.entries(analysis.byAgent)
      .sort(([, a]: any, [, b]: any) => b.length - a.length)
      .slice(0, 5);

    for (const [agentType, jobs] of topAgents) {
      analysis.recommendations.push({
        agent: agentType,
        failureCount: (jobs as any[]).length,
        action: `Review ${agentType} agent configuration and tool flags`,
        priority: (jobs as any[]).length > 5 ? 'high' : 'medium'
      });
    }

    if (analysis.silentFailures.length > 0) {
      analysis.recommendations.push({
        type: 'silent_failures',
        count: analysis.silentFailures.length,
        action: 'Enable debug logging to capture error details',
        priority: 'high'
      });
    }

    return analysis;
  }

  private async readToolHelp(params: any): Promise<any> {
    const toolName = params.tool || params.command;

    if (!toolName) {
      throw new Error('Tool name required');
    }

    logger.info({ toolName }, '📚 Reading tool help documentation');

    try {
      // Try --help first
      let helpText;
      try {
        const { stdout } = await execAsync(`${toolName} --help 2>&1`, { timeout: 10000 });
        helpText = stdout;
      } catch (error: any) {
        // Try -h if --help fails
        const { stdout } = await execAsync(`${toolName} -h 2>&1`, { timeout: 10000 });
        helpText = stdout;
      }

      // Parse flags and options
      const flags: string[] = [];
      const lines = helpText.split('\n');

      for (const line of lines) {
        // Match common flag patterns: -flag, --flag
        const matches = line.match(/(-{1,2}[a-zA-Z0-9-]+)/g);
        if (matches) {
          flags.push(...matches);
        }
      }

      return {
        tool: toolName,
        helpText: helpText.length > 5000 ? helpText.substring(0, 5000) + '\n...(truncated)' : helpText,
        availableFlags: [...new Set(flags)].slice(0, 50),
        totalFlags: [...new Set(flags)].length
      };
    } catch (error: any) {
      return {
        tool: toolName,
        error: error.message,
        suggestion: 'Tool may not be installed or help flag not supported'
      };
    }
  }

  private async detectErrors(programId?: string): Promise<any> {
    logger.info({ programId }, '🕵️ Detecting errors and silent failures');

    const errors: any = {
      silentFailures: [],
      configIssues: [],
      toolErrors: [],
      handoffFailures: [],
      recommendations: []
    };

    // 1. Detect silent failures (failed jobs with no error message)
    const silentResult = await database.query(
      `SELECT * FROM jobs
       WHERE status = 'failed'
       AND (error IS NULL OR error = '')
       ${programId ? 'AND program_id = $1' : ''}
       ORDER BY updated_at DESC
       LIMIT 10`,
      programId ? [programId] : []
    );

    errors.silentFailures = silentResult.rows.map((job: any) => ({
      jobId: job.id,
      type: job.type,
      updatedAt: job.updated_at,
      suggestion: 'Enable debug logging for this agent'
    }));

    // 2. Detect configuration issues from logs
    const configLogsResult = await database.query(
      `SELECT DISTINCT message, agent_type, COUNT(*) as count
       FROM job_execution_logs
       WHERE level = 'error'
       AND (message LIKE '%Invalid%' OR message LIKE '%not found%' OR message LIKE '%undefined%')
       ${programId ? 'AND program_id = $1' : ''}
       GROUP BY message, agent_type
       ORDER BY count DESC
       LIMIT 10`,
      programId ? [programId] : []
    );

    errors.configIssues = configLogsResult.rows;

    // 3. Detect tool command errors
    const toolErrorsResult = await database.query(
      `SELECT DISTINCT message, agent_type, COUNT(*) as count
       FROM job_execution_logs
       WHERE level = 'error'
       AND (message LIKE '%Command failed%' OR message LIKE '%spawn%' OR message LIKE '%json%')
       GROUP BY message, agent_type
       ORDER BY count DESC
       LIMIT 10`
    );

    errors.toolErrors = toolErrorsResult.rows;

    // 4. Check for handoff failures (jobs created by handoffs that failed)
    const handoffResult = await database.query(
      `SELECT * FROM jobs
       WHERE status = 'failed'
       AND metadata->>'handoffOrigin' = 'rich-handoff'
       ${programId ? 'AND program_id = $1' : ''}
       ORDER BY updated_at DESC
       LIMIT 10`,
      programId ? [programId] : []
    );

    errors.handoffFailures = handoffResult.rows.map((job: any) => ({
      jobId: job.id,
      type: job.type,
      parentJobId: job.metadata?.parentJobId,
      error: job.error
    }));

    // Generate actionable recommendations
    if (errors.silentFailures.length > 0) {
      errors.recommendations.push({
        priority: 'high',
        issue: `${errors.silentFailures.length} silent failures detected`,
        action: 'Add error logging to catch and report failures',
        command: 'enable_monitoring'
      });
    }

    // Check for specific tool flag errors (like json vs jsonl)
    const jsonFlagErrors = errors.toolErrors.filter((e: any) =>
      e.message?.includes('json') || e.message?.includes('Invalid flag')
    );

    if (jsonFlagErrors.length > 0) {
      errors.recommendations.push({
        priority: 'critical',
        issue: 'Tool flag errors detected (possibly json vs jsonl)',
        action: 'Read tool help and fix incorrect flags',
        suggestedSteps: [
          'Read tool documentation with read_tool_help',
          'Identify correct flag usage',
          'Fix agent code with fix_agent_code'
        ]
      });
    }

    return errors;
  }

  private async analyzePerformance(params: any, programId?: string): Promise<any> {
    logger.info({ programId }, '⚡ Analyzing performance and suggesting optimizations');

    const analysis: any = {
      jobStats: {},
      bottlenecks: [],
      scalingSuggestions: [],
      optimizations: []
    };

    // Get job completion stats
    const statsResult = await database.query(
      `SELECT
         type as agent_type,
         COUNT(*) as total_jobs,
         AVG(EXTRACT(EPOCH FROM (updated_at - created_at))) as avg_duration_seconds,
         COUNT(*) FILTER (WHERE status = 'completed') as completed,
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         COUNT(*) FILTER (WHERE status = 'active') as active,
         COUNT(*) FILTER (WHERE status = 'pending') as pending
       FROM jobs
       ${programId ? 'WHERE program_id = $1' : ''}
       GROUP BY type
       ORDER BY total_jobs DESC`,
      programId ? [programId] : []
    );

    analysis.jobStats = statsResult.rows;

    // Identify bottlenecks (high pending count)
    for (const stat of statsResult.rows) {
      if (stat.pending > 20) {
        analysis.bottlenecks.push({
          agent: stat.agent_type,
          pendingJobs: parseInt(stat.pending),
          activeJobs: parseInt(stat.active),
          suggestion: `Scale ${stat.agent_type} agent - ${stat.pending} jobs waiting`,
          priority: parseInt(stat.pending) > 100 ? 'critical' : 'high'
        });

        analysis.scalingSuggestions.push({
          agent: stat.agent_type,
          currentConcurrency: parseInt(stat.active),
          recommendedConcurrency: Math.min(parseInt(stat.pending) * 2, 500),
          estimatedImprovement: `${Math.floor((parseInt(stat.pending) / (parseInt(stat.active) || 1)) * 100)}% faster`
        });
      }

      // Identify slow agents (avg duration > 60s)
      if (parseFloat(stat.avg_duration_seconds) > 60) {
        analysis.optimizations.push({
          agent: stat.agent_type,
          avgDuration: `${Math.floor(parseFloat(stat.avg_duration_seconds))}s`,
          issue: 'Slow execution time',
          suggestions: [
            'Increase timeout limits if jobs are timing out',
            'Optimize tool flags for performance',
            'Consider batch processing for this agent'
          ]
        });
      }
    }

    // Check for failed jobs patterns
    const failureRate = statsResult.rows
      .filter((s: any) => parseFloat(s.failed) / parseFloat(s.total_jobs) > 0.1);

    for (const stat of failureRate) {
      analysis.optimizations.push({
        agent: stat.agent_type,
        failureRate: `${Math.floor((parseFloat(stat.failed) / parseFloat(stat.total_jobs)) * 100)}%`,
        issue: 'High failure rate',
        suggestions: [
          'Review agent error logs with read_job_logs',
          'Check tool configuration and flags',
          'Analyze failures with analyze_failures'
        ]
      });
    }

    return analysis;
  }

  private async fixAgentCode(params: any): Promise<any> {
    const agentName = params.agent || params.agent_name;
    const searchText = params.search || params.old;
    const replaceText = params.replace || params.new;

    if (!agentName || !searchText || !replaceText) {
      throw new Error('Required: agent, search, replace');
    }

    logger.warn({ agentName, searchText, replaceText }, '🔧 Fixing agent code');

    const agentFile = path.join('/home/user/agentHunt/backend/src/agents', `${agentName}.ts`);

    // Read current code
    const currentCode = await fs.readFile(agentFile, 'utf-8');

    // Check if search text exists
    if (!currentCode.includes(searchText)) {
      throw new Error(`Search text not found in ${agentName}.ts: "${searchText}"`);
    }

    // Replace
    const newCode = currentCode.replace(new RegExp(searchText, 'g'), replaceText);

    // Write back
    await fs.writeFile(agentFile, newCode, 'utf-8');

    logger.warn({ agentName, file: agentFile }, '✅ Agent code fixed');

    return {
      success: true,
      agent: agentName,
      file: agentFile,
      searchText,
      replaceText,
      occurrences: (currentCode.match(new RegExp(searchText, 'g')) || []).length,
      message: '✅ Code updated - restart required for changes to take effect'
    };
  }

  private async readAgentCode(params: any): Promise<any> {
    const agentName = params.agent || params.agent_name;

    if (!agentName) {
      throw new Error('Agent name required');
    }

    const agentFile = path.join('/home/user/agentHunt/backend/src/agents', `${agentName}.ts`);

    try {
      const code = await fs.readFile(agentFile, 'utf-8');
      const lines = code.split('\n');

      // Find command executions and tool calls
      const toolCalls: string[] = [];
      const configVars: string[] = [];

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Find exec calls
        if (line.includes('exec') || line.includes('spawn')) {
          toolCalls.push(`Line ${i + 1}: ${line.trim()}`);
        }

        // Find config usage
        if (line.includes('config.') || line.includes('-json') || line.includes('--json')) {
          configVars.push(`Line ${i + 1}: ${line.trim()}`);
        }
      }

      return {
        agent: agentName,
        file: agentFile,
        totalLines: lines.length,
        toolCalls,
        configVars,
        codePreview: lines.slice(0, 50).join('\n') // First 50 lines
      };
    } catch (error: any) {
      throw new Error(`Failed to read ${agentName}.ts: ${error.message}`);
    }
  }

  private async monitorHandoffs(programId?: string): Promise<any> {
    logger.info({ programId }, '🤝 Monitoring agent handoffs');

    // Get recent jobs created by handoffs
    const handoffsResult = await database.query(
      `SELECT
         id, type, status, error,
         metadata->>'parentJobId' as parent_job_id,
         metadata->>'requestedBy' as requested_by,
         metadata->>'handoffOrigin' as handoff_origin,
         created_at, updated_at
       FROM jobs
       WHERE metadata->>'handoffOrigin' = 'rich-handoff'
       ${programId ? 'AND program_id = $1' : ''}
       ORDER BY created_at DESC
       LIMIT 50`,
      programId ? [programId] : []
    );

    const handoffs = handoffsResult.rows;
    const analysis: any = {
      total: handoffs.length,
      byStatus: {},
      handoffChains: [],
      failures: []
    };

    // Group by status
    handoffs.forEach((h: any) => {
      analysis.byStatus[h.status] = (analysis.byStatus[h.status] || 0) + 1;

      if (h.status === 'failed') {
        analysis.failures.push({
          jobId: h.id,
          type: h.type,
          parentJobId: h.parent_job_id,
          requestedBy: h.requested_by,
          error: h.error
        });
      }
    });

    // Build handoff chains
    const chains = new Map();
    handoffs.forEach((h: any) => {
      const parent = h.parent_job_id;
      if (parent) {
        if (!chains.has(parent)) {
          chains.set(parent, []);
        }
        chains.get(parent).push({
          jobId: h.id,
          type: h.type,
          status: h.status
        });
      }
    });

    analysis.handoffChains = Array.from(chains.entries()).map(([parent, children]) => ({
      parentJobId: parent,
      children
    }));

    return analysis;
  }

  private async restartWorker(params: any): Promise<any> {
    const agentType = params.agent_type || params.agent;
    logger.warn({ agentType }, 'Restarting worker process. NOTE: This will restart all workers, not just the specific agent type.');

    try {
      const { stdout, stderr } = await execAsync('pm2 restart agenthunt-workers');
      logger.info({ stdout, stderr }, 'Restarted agenthunt-workers process.');
      return { success: true, message: 'agenthunt-workers process restarted.' };
    } catch (error) {
      logger.error({ error }, 'Failed to restart worker process.');
      throw error;
    }
  }

  private async monitorQueues(): Promise<any> {
    logger.info('Monitoring BullMQ queues...');
    const allQueues = queue.getAllQueues();
    const queueMetrics: { [key: string]: any } = {};

    for (const [agentType, queueInstance] of allQueues.entries()) {
      try {
        const metrics = await queue.getQueueMetrics(agentType);
        queueMetrics[agentType] = metrics;
        logger.info({ agentType, metrics }, `Queue metrics for ${agentType}`);
      } catch (error) {
        logger.error({ error, agentType }, `Failed to get metrics for queue ${agentType}`);
        queueMetrics[agentType] = { error: error.message };
      }
    }
    return { success: true, queueMetrics };
  }

  private async scaleWorkers(processName: string, newInstances: number): Promise<any> {
    logger.info({ processName, newInstances }, 'Scaling workers...');

    const ecosystemConfigPath = path.join(process.cwd(), 'ecosystem.config.js');
    let configContent = await fs.readFile(ecosystemConfigPath, 'utf-8');

    const regex = new RegExp(
      `({[^}]*name:\\s*['"]${processName}['"][^}]*instances:\\s*)(\\d+)([^}]*})`,
      's'
    );

    if (!regex.test(configContent)) {
      throw new Error(`Process '${processName}' not found in ecosystem.config.js`);
    }

    configContent = configContent.replace(regex, `$1${newInstances}$3`);

    await fs.writeFile(ecosystemConfigPath, configContent, 'utf-8');

    logger.info({ processName, newInstances }, 'ecosystem.config.js updated. Triggering PM2 reload...');

    try {
      const { stdout, stderr } = await execAsync(`pm2 reload ${processName}`);
      logger.info({ stdout, stderr }, `PM2 reloaded ${processName}.`);
      return { success: true, message: `Workers for ${processName} scaled to ${newInstances} instances.` };
    } catch (error) {
      logger.error({ error }, `Failed to reload PM2 process ${processName}.`);
      throw error;
    }
  }
}

export const managerAgent = new ManagerAgent();
