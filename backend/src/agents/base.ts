import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import { BaseJob, AgentType } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';
import config from '../config';
import rateLimiter from '../services/rate-limiter';
import { getRetryConfig, calculateBatchConfig, ToolType } from '../utils/batch-strategy';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { trace, SpanStatusCode, context, Span } from '@opentelemetry/api';
import { executeHandoff, HandoffContext, HandoffResult } from '../services/handoffs';

// Import Claude Code-inspired services
import progressTracker from '../services/progress-tracker';
import commandValidator from '../services/command-validator';
import checkpoint from '../services/checkpoint';
import agentCoordination from '../services/agent-coordination';
import richHandoffs from '../services/rich-handoffs';
import agentHealth from '../services/agent-health';
import agentEvolution from '../services/agent-evolution-integration';
import agentSettingsService from '../services/agent-settings';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { AgentIdentity, HandoffContext as RichHandoffContext, OutputContract, ProgressStep } from '../../../shared/agent-collaboration.types';

const execAsync = promisify(exec);

export abstract class BaseAgent<T extends BaseJob> {
  protected agentType: AgentType;
  protected workerId: string;
  protected tracer = trace.getTracer('agenthunt-agent');
  protected agentSettings: Record<string, any> = {}; // Dynamic agent settings

  // Claude Code-inspired service references
  protected progressTracker = progressTracker;
  protected commandValidator = commandValidator;
  protected checkpoint = checkpoint;
  protected coordination = agentCoordination;
  protected richHandoffs = richHandoffs;
  protected health = agentHealth;
  protected evolution = agentEvolution;
  protected sharedMemory = sharedMemory;

  constructor(agentType: AgentType) {
    this.agentType = agentType;
    this.workerId = `${agentType}-${uuidv4().slice(0, 8)}`;
    logger.info({ agentType, workerId: this.workerId }, 'Agent initialized');
    this.loadAgentSettings(); // Load settings on initialization
  }

  /**
   * Load agent-specific settings dynamically.
   * This method fetches settings from the AgentSettingsService and stores them locally.
   */
  protected async loadAgentSettings(): Promise<void> {
    try {
      const settings = await agentSettingsService.getSettings(this.agentType);
      if (settings) {
        this.agentSettings = settings.settings;
        logger.info({ agentType: this.agentType, settings: this.agentSettings }, 'Agent settings loaded');
      } else {
        logger.info({ agentType: this.agentType }, 'No specific settings found for agent, using defaults');
      }
    } catch (error) {
      logger.error({ error, agentType: this.agentType }, 'Failed to load agent settings');
    }
  }

  /**
   * Main processing method - must be implemented by subclasses
   * Wrapped with distributed tracing for observability
   */
  abstract process(job: Job<T>): Promise<any>;

  /**
   * Define steps for progress tracking - must be implemented by subclasses
   * Return array of step names for this agent type
   */
  protected abstract getSteps(): Array<{ name: string; metadata?: any }>;

  /**
   * Get agent identity for coordination
   */
  protected getIdentity(): AgentIdentity {
    return {
      type: this.agentType,
      instanceId: this.workerId,
      capabilities: this.getCapabilities(),
      currentLoad: 0, // Could be enhanced to track actual load
      version: '1.0.0'
    };
  }

  /**
   * Get agent capabilities - can be overridden by subclasses
   */
  protected getCapabilities(): string[] {
    // Default capabilities based on agent type
    const capabilities: Record<string, string[]> = {
      discovery: ['domain-enumeration', 'chaos-integration', 'scope-validation'],
      subdomain: ['passive-recon', 'dns-resolution', 'subdomain-discovery'],
      bruteforce: ['dns-bruteforce', 'massdns', 'shuffledns'],
      fingerprint: ['http-fingerprinting', 'technology-detection', 'waf-detection'],
      portscan: ['tcp-scan', 'udp-scan', 'service-detection'],
      scanner: ['vulnerability-scanning', 'template-matching', 'nuclei'],
      crawl: ['web-crawling', 'endpoint-discovery', 'js-analysis'],
      triage: ['ai-analysis', 'false-positive-detection', 'severity-assessment'],
      confirm: ['vulnerability-verification', 'exploit-validation', 'poc-generation']
    };
    return capabilities[this.agentType] || [];
  }

  /**
   * Process wrapper with OpenTelemetry tracing, progress tracking, and checkpointing
   * Use this in worker.ts instead of calling process() directly
   */
  async processWithTracing(job: Job<T>): Promise<any> {
    const jobId = job.id || 'unknown';
    const jobMetadata = job.data.metadata || {};

    // Extract OpenTelemetry trace context from job metadata
    const incomingTraceContext = jobMetadata._otelTraceContext;
    let parentContext = context.active();

    if (incomingTraceContext && incomingTraceContext.traceId && incomingTraceContext.spanId) {
      // Reconstruct SpanContext from the incoming trace context
      const spanContext = {
        traceId: incomingTraceContext.traceId,
        spanId: incomingTraceContext.spanId,
        traceFlags: incomingTraceContext.traceFlags || 0,
        traceState: incomingTraceContext.traceState ? trace.createTraceState(incomingTraceContext.traceState) : undefined,
        isRemote: true,
      };
      parentContext = trace.setSpanContext(context.active(), spanContext);
    }

    const span = this.tracer.startSpan(`${this.agentType}.process`, {
      attributes: {
        'agent.type': this.agentType,
        'agent.worker_id': this.workerId,
        'job.id': jobId,
        'job.type': job.data.type,
        'program.id': job.data.programId,
        'job.priority': job.opts?.priority || 0,
        'job.attempts': job.attemptsMade,
      },
    }, parentContext); // Use the extracted or active parent context

    return context.with(trace.setSpan(context.active(), span), async () => {
      let checkpointId: string | undefined;

      try {
        // Initialize progress tracking (Claude Code TodoWrite pattern)
        const steps = this.getSteps();
        if (steps.length > 0 && jobId !== 'unknown') {
          await this.progressTracker.initializeProgress(jobId, job.data.programId, this.agentType, steps);
        }

        // Create checkpoint for rollback capability
        if (jobId !== 'unknown') {
          checkpointId = await this.checkpoint.createCheckpoint(jobId);
        }

        // Record heartbeat with metrics
        await this.health.recordHeartbeat(this.agentType, this.workerId, job.data.programId, {
          jobsProcessed: 0,
          memoryUsage: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024)
        });

        // Execute the job
        const startTime = Date.now();
        const result = await this.process(job);
        const duration = Date.now() - startTime;

        // Validate result if needed (can be overridden by subclasses)
        const validationResult = await this.validateResult(result, job);
        if (!validationResult.valid) {
          throw new Error(`Result validation failed: ${validationResult.errors.join(', ')}`);
        }

        // Record successful execution for causal learning
        this.evolution.recordAgentExecution(
          this.agentType,
          jobId,
          {
            priority: job.opts?.priority || 5,
            attempts: job.attemptsMade,
            duration,
          },
          {
            success: true,
            data: result,
            metrics: {
              duration,
              attemptsMade: job.attemptsMade,
            },
          }
        ).catch((error) => {
          logger.debug({ error }, 'Failed to record agent execution for learning');
        });

        // Commit checkpoint
        if (checkpointId) {
          await this.checkpoint.commitCheckpoint(checkpointId);
        }

        // Trigger workflows on successful completion
        await this.triggerWorkflows(job, result);

        // Update health metrics
        await this.health.recordHeartbeat(this.agentType, this.workerId, job.data.programId, {
          jobsProcessed: 1,
          jobsFailed: 0
        });

        span.setStatus({ code: SpanStatusCode.OK });
        span.setAttribute('job.status', 'completed');
        span.setAttribute('job.duration_ms', duration);
        return result;
      } catch (error: any) {
        // Record failed execution for causal learning
        this.evolution.recordAgentExecution(
          this.agentType,
          jobId,
          {
            priority: job.opts?.priority || 5,
            attempts: job.attemptsMade,
          },
          {
            success: false,
            error: error.message,
          }
        ).catch((learningError) => {
          logger.debug({ learningError }, 'Failed to record failed execution for learning');
        });

        // Attempt auto-debugging (non-blocking)
        this.evolution.debugAgentFailure(
          this.agentType,
          jobId,
          error,
          {
            stackTrace: error.stack,
          }
        ).then((debugResult) => {
          if (debugResult.debugged) {
            logger.info(
              {
                agentType: this.agentType,
                jobId,
                attempts: debugResult.attempts,
              },
              'Auto-debug produced fix - manual review recommended'
            );
          }
        }).catch((debugError) => {
          logger.debug({ debugError }, 'Auto-debug attempt failed');
        });

        // Rollback on error
        if (checkpointId) {
          await this.checkpoint.rollbackCheckpoint(checkpointId, error.message).catch((rollbackError) => {
            logger.error({ rollbackError, checkpointId }, 'Checkpoint rollback failed');
          });
        }

        // Update health metrics
        await this.health.recordHeartbeat(this.agentType, this.workerId, job.data.programId, {
          jobsProcessed: 0,
          jobsFailed: 1
        });

        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message || String(error),
        });
        span.setAttribute('job.status', 'failed');
        span.setAttribute('error.message', error.message || String(error));
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Validate result - can be overridden by subclasses for custom validation
   */
  protected async validateResult(result: any, job: Job<T>): Promise<{ valid: boolean; errors: string[] }> {
    // Default validation - just check result exists
    if (!result) {
      return { valid: false, errors: ['Result is null or undefined'] };
    }
    return { valid: true, errors: [] };
  }

  /**
   * Trigger workflows based on job completion
   */
  private async triggerWorkflows(job: Job<T>, result: any): Promise<void> {
    try {
      const workflowEngine = require('../services/workflow-engine').default;
      const workflows = await workflowEngine.listWorkflows();

      for (const workflow of workflows) {
        if (!workflow.enabled) continue;

        // Check if workflow should be triggered
        const triggerContext = {
          agentType: this.agentType,
          result,
          programId: job.data.programId,
          jobId: job.id
        };

        // Check trigger condition
        if (workflow.trigger.on === 'job:complete') {
          try {
            // Get full workflow definition
            const fullWorkflow = await workflowEngine.getWorkflow(workflow.name);
            if (fullWorkflow && fullWorkflow.trigger.when(triggerContext)) {
              logger.info(
                { workflow: workflow.name, jobId: job.id, agentType: this.agentType },
                'Triggering workflow'
              );
              await workflowEngine.executeWorkflow(workflow.name, triggerContext);
            }
          } catch (error: any) {
            logger.error(
              { error, workflow: workflow.name, jobId: job.id },
              'Failed to trigger workflow'
            );
          }
        }
      }
    } catch (error: any) {
      logger.error({ error, jobId: job.id }, 'Failed to check workflow triggers');
    }
  }

  /**
   * Execute shell command with timeout and logging
   * Wrapped with OpenTelemetry tracing for tool execution tracking
   */
  protected async executeCommand(
    command: string,
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }> {
    const toolName = command.split(' ')[0].split('/').pop() || 'unknown';

    const span = this.tracer.startSpan(`tool.${toolName}`, {
      attributes: {
        'tool.command': toolName,
        'tool.full_command': command.substring(0, 200), // Truncate for readability
        'tool.timeout_ms': options?.timeout || 300000,
        'agent.type': this.agentType,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
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

        // Add tracing attributes
        span.setAttributes({
          'tool.duration_ms': duration,
          'tool.exit_code': exitCode,
          'tool.stdout_length': stdoutBuffer.length,
          'tool.stderr_length': stderrBuffer.length,
        });

        if (exitCode === 0) {
          span.setStatus({ code: SpanStatusCode.OK });
        } else {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: `Tool exited with code ${exitCode}`,
          });
        }

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

        // Record exception in trace
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message || String(error),
        });
        span.setAttribute('tool.duration_ms', duration);
        span.setAttribute('tool.exit_code', exitCode);

        return {
          stdout: stdoutBuffer,
          stderr: stderrBuffer || error.message,
          exitCode,
          duration,
        };
      } finally {
        span.end();
      }
    });
  }

  /**
   * Execute command with pre-validation (Claude Code safety pattern)
   * Validates command before execution to catch errors early
   */
  protected async executeCommandSafe(
    command: string,
    jobId: string,
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }> {
    // Pre-validate command
    const validation = await this.commandValidator.validateCommand(
      jobId,
      this.agentType,
      command
    );

    if (!validation.safe) {
      const errorMsg = `Command validation failed: ${validation.reasons.join(', ')}`;
      logger.error({ command, reasons: validation.reasons }, errorMsg);
      throw new Error(errorMsg);
    }

    // Log warnings if any
    if (validation.warnings && validation.warnings.length > 0) {
      logger.warn({ command, warnings: validation.warnings }, 'Command validation warnings');
    }

    // Execute command
    const startTime = Date.now();
    const result = await this.executeCommand(command, options);
    const duration = Date.now() - startTime;

    // Record actual resource usage
    await this.commandValidator.recordActualResources(
      jobId,
      command,
      {
        memory: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
        cpu: 0, // Would need OS-level tracking
        duration,
        networkIO: 0, // Would need to track
        diskIO: 0
      }
    );

    return result;
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
   * Hand off work to another specialized agent
   *
   * Use cases:
   * - Scanner finds SQLi → hand to SQLi Specialist
   * - Discovery finds WordPress → hand to WordPress Specialist
   * - Triage needs confirmation → hand to Confirm Agent
   *
   * Example:
   * ```typescript
   * await this.handoff('sqli-specialist', {
   *   toAgent: 'sqli-specialist',
   *   reason: 'Found potential SQL injection, need deep analysis',
   *   data: { finding, url, payload },
   *   priority: 8,
   *   metadata: {
   *     programId: job.data.programId,
   *     parentJobId: job.id,
   *     findingId: finding.id,
   *   },
   * });
   * ```
   */
  protected async handoff(
    toAgent: string,
    context: Omit<HandoffContext, 'fromAgent'>
  ): Promise<HandoffResult> {
    const fullContext: HandoffContext = {
      ...context,
      fromAgent: this.agentType,
      toAgent,
    };

    logger.info(
      {
        from: this.agentType,
        to: toAgent,
        reason: context.reason,
      },
      'Executing handoff'
    );

    return executeHandoff(fullContext);
  }

  /**
   * Create rich handoff with complete context (Claude Code pattern)
   * Provides full context preservation for better agent coordination
   */
  protected async createRichHandoff(
    jobId: string,
    programId: string,
    toAgentType: string,
    context: RichHandoffContext,
    outputContract: OutputContract
  ): Promise<string> {
    const fromAgent = {
      type: this.agentType,
      instanceId: this.workerId,
      jobId,
      programId
    };

    // Get current OpenTelemetry trace context
    const currentContext = context.active();
    const spanContext = trace.getSpan(currentContext)?.spanContext();

    const traceContext = spanContext
      ? {
          traceId: spanContext.traceId,
          spanId: spanContext.spanId,
          traceFlags: spanContext.traceFlags,
          traceState: spanContext.traceState?.serialize(),
        }
      : undefined;

    // Inject trace context into inherited metadata
    const inheritedMetadata = {
      ...context.inherited.metadata,
      _otelTraceContext: traceContext,
    };

    // Update the inherited context with the new metadata
    const updatedContext = {
      ...context,
      inherited: {
        ...context.inherited,
        metadata: inheritedMetadata,
      },
    };

    logger.info(
      {
        from: this.agentType,
        to: toAgentType,
        trigger: updatedContext.reasoning.trigger,
        confidence: updatedContext.reasoning.confidence,
        objective: updatedContext.objectives.primary,
        traceId: traceContext?.traceId,
      },
      'Creating rich handoff with complete context and trace context'
    );

    return this.richHandoffs.createHandoff(
      fromAgent,
      toAgentType,
      updatedContext,
      outputContract
    );
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
   * Apply distributed rate limiting before making requests
   * Coordinates across all workers to prevent overwhelming targets
   */
  protected async applyRateLimit(
    target: string,
    requestCount: number = 1,
    maxRatePerSecond?: number
  ): Promise<void> {
    try {
      await rateLimiter.waitForTokens(target, requestCount, maxRatePerSecond);
    } catch (error) {
      logger.warn({ error, target }, 'Rate limiter failed, proceeding without rate limit');
    }
  }

  /**
   * Save checkpoint for job resumption on failure
   * Checkpoints enable partial progress recovery without starting from scratch
   */
  protected async saveCheckpoint(
    jobId: string,
    programId: string,
    checkpoint: {
      progress: number;
      totalItems: number;
      processedItems: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<void> {
    try {
      const s3Key = storage.generateKey(programId, this.agentType, `${jobId}-checkpoint.json`);
      const checkpointData = {
        ...checkpoint,
        savedAt: new Date().toISOString(),
        agentType: this.agentType,
        jobId,
      };

      await storage.uploadText(s3Key, JSON.stringify(checkpointData, null, 2));

      logger.info(
        { jobId, progress: checkpoint.progress, totalItems: checkpoint.totalItems },
        'Checkpoint saved successfully'
      );
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to save checkpoint');
    }
  }

  /**
   * Load checkpoint for job resumption
   * Returns null if no checkpoint exists
   */
  protected async loadCheckpoint(
    jobId: string,
    programId: string
  ): Promise<{
    progress: number;
    totalItems: number;
    processedItems: string[];
    metadata?: Record<string, any>;
    savedAt?: string;
  } | null> {
    try {
      const s3Key = storage.generateKey(programId, this.agentType, `${jobId}-checkpoint.json`);
      const checkpointData = await storage.downloadText(storage.parseS3Uri(s3Key));

      const checkpoint = JSON.parse(checkpointData);

      logger.info(
        {
          jobId,
          progress: checkpoint.progress,
          totalItems: checkpoint.totalItems,
          processedItems: checkpoint.processedItems?.length || 0,
          savedAt: checkpoint.savedAt,
        },
        'Checkpoint loaded successfully'
      );

      return checkpoint;
    } catch (error: any) {
      if (error.code === 'NoSuchKey' || error.message?.includes('does not exist')) {
        logger.debug({ jobId }, 'No checkpoint found for job');
        return null;
      }

      logger.error({ error, jobId }, 'Failed to load checkpoint');
      return null;
    }
  }

  /**
   * Clear checkpoint after successful job completion
   */
  protected async clearCheckpoint(jobId: string, programId: string): Promise<void> {
    try {
      const s3Key = storage.generateKey(programId, this.agentType, `${jobId}-checkpoint.json`);
      await storage.delete(s3Key);
      logger.debug({ jobId }, 'Checkpoint cleared');
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to clear checkpoint');
    }
  }

  /**
   * Get adaptive configuration for retries
   * Each retry uses more conservative settings (lower concurrency, higher timeout)
   */
  protected getAdaptiveRetrySettings(
    job: Job<T>,
    toolType: ToolType,
    assetCount: number,
    originalConfig?: any
  ): {
    concurrency: number;
    timeout: number;
    rateLimit: number;
  } {
    const attemptNumber = job.attemptsMade || 0;

    if (!originalConfig) {
      // Calculate initial config
      const config = calculateBatchConfig(toolType, assetCount);
      return {
        concurrency: config.concurrency,
        timeout: config.timeoutMs,
        rateLimit: config.rateLimit,
      };
    }

    // Apply retry-specific adjustments
    const retryConfig = getRetryConfig(toolType, attemptNumber, {
      batchSize: assetCount,
      timeoutMs: originalConfig.timeout || 300000,
      concurrency: originalConfig.concurrency || 100,
      rateLimit: originalConfig.rateLimit || 150,
    });

    logger.info(
      {
        jobId: job.id,
        attemptNumber,
        toolType,
        originalConcurrency: originalConfig.concurrency,
        newConcurrency: retryConfig.concurrency,
        originalTimeout: originalConfig.timeout,
        newTimeout: retryConfig.timeoutMs,
      },
      `Applying adaptive retry settings for attempt ${attemptNumber + 1}`
    );

    return {
      concurrency: retryConfig.concurrency,
      timeout: retryConfig.timeoutMs,
      rateLimit: retryConfig.rateLimit,
    };
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
   * Uses Massdns (32x faster) or DNSx (fallback) for parallel resolution
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

      const startTime = Date.now();
      let validated: string[] = [];
      let command: string;
      let timeoutMs: number;

      // OPTIMIZATION: Use Massdns if enabled (32x faster than DNSx)
      if (config.tools.useMassdns) {
        // Massdns: 10,000+ parallel queries (vs DNSx: 50 threads max)
        // Can resolve 13K domains in ~1 second vs DNSx ~32 seconds
        const parallelQueries = Math.min(10000, Math.max(1000, hostnames.length * 2));

        // Scale timeout: ~50ms per domain with minimum of 10s
        timeoutMs = Math.max(10000, Math.min(120000, hostnames.length * 50));

        await this.updateJobProgress(jobId, {
          current: 0,
          total: hostnames.length,
          percentage: 0,
          currentTool: 'massdns',
          toolStatus: 'running',
          message: `🚀 Ultra-fast DNS validation (Massdns): ${hostnames.length} domains (${parallelQueries} parallel queries, ~${Math.round(timeoutMs/1000)}s timeout)`,
        });

        // Massdns command: -r resolvers, -t A (A records), -o S (simple output), -s parallel queries, -w output
        command = `${config.tools.massdns} -r ${config.tools.massdnsResolvers} \
          -t A \
          -o S \
          -s ${parallelQueries} \
          -q \
          ${tmpFile} > ${outputFile}`;

        const result = await this.executeCommand(command, { timeout: timeoutMs });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Parse Massdns output: "domain.com. A IP" -> extract unique domains
        const outputExists = await fs.stat(outputFile).then(() => true).catch(() => false);
        if (outputExists) {
          const content = await fs.readFile(outputFile, 'utf-8');
          const lines = content.split('\n').filter((line) => line.trim());

          const domainSet = new Set<string>();
          for (const line of lines) {
            // Massdns format: "example.com. A 1.2.3.4" or "example.com. CNAME target.com."
            const match = line.match(/^([^\s]+)\.\s+(A|CNAME)\s+/);
            if (match) {
              domainSet.add(match[1]); // Remove trailing dot
            }
          }
          validated = Array.from(domainSet);
        }

        logger.info(
          {
            jobId,
            programId,
            tool: 'massdns',
            validated: validated.length,
            filtered: hostnames.length - validated.length,
            elapsed: `${elapsed}s`,
            rate: `${Math.round(hostnames.length / parseFloat(elapsed))}/s`,
            speedup: `${Math.round(hostnames.length / parseFloat(elapsed) / 25)}x vs DNSx`
          },
          `Massdns validation complete: ${validated.length}/${hostnames.length} resolved in ${elapsed}s (${Math.round(hostnames.length / parseFloat(elapsed))}/s)`
        );
      } else {
        // DNSx fallback (original implementation)
        // Scale concurrency based on input size
        // Capped at 50 to prevent DNS resolver overload and crashes
        const concurrency = Math.min(50, hostnames.length <= 10 ? 50 : hostnames.length <= 100 ? 40 : 30);
        const rateLimit = concurrency * 10; // e.g., 50 threads = 500 req/s max

        // Scale timeout based on input size: ~500ms per domain with minimum of 30s
        timeoutMs = Math.max(30000, Math.min(300000, hostnames.length * 500));

        await this.updateJobProgress(jobId, {
          current: 0,
          total: hostnames.length,
          percentage: 0,
          currentTool: 'dns-validation',
          toolStatus: 'running',
          message: `⚡ Fast DNS validation (DNSx): ${hostnames.length} domains (${concurrency} threads, ${rateLimit} req/s, ${Math.round(timeoutMs/1000)}s timeout)`,
        });

        command = `${config.tools.dnsx} -l ${tmpFile} \
          -a -aaaa -cname \
          -cdn -asn \
          -resp \
          -silent \
          -retry 2 \
          -t ${concurrency} \
          -rl ${rateLimit} \
          -o ${outputFile}`;

        const result = await this.executeCommand(command, { timeout: timeoutMs });
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

        // Parse dnsx output: "domain.com [A] [IP]" -> extract unique domains
        const outputExists = await fs.stat(outputFile).then(() => true).catch(() => false);
        if (outputExists) {
          const content = await fs.readFile(outputFile, 'utf-8');
          const lines = content.split('\n').filter((line) => line.trim());

          const domainSet = new Set<string>();
          for (const line of lines) {
            const match = line.match(/^([^\s\[]+)/);
            if (match) {
              domainSet.add(match[1]);
            }
          }
          validated = Array.from(domainSet);
        }

        logger.info(
          {
            jobId,
            programId,
            tool: 'dnsx',
            total: assets.length,
            validated: validated.length + ips.length,
            filtered: hostnames.length - validated.length,
            elapsed: `${elapsed}s`,
            rate: `${Math.round(hostnames.length / parseFloat(elapsed))}/s`
          },
          `DNSx validation complete: ${validated.length}/${hostnames.length} resolved, ${hostnames.length - validated.length} filtered in ${elapsed}s`
        );
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // If DNS validation failed/not available, return all assets
      if (validated.length === 0) {
        logger.warn({ jobId, programId }, 'DNS validation returned no results, proceeding with all assets');
        return assets;
      }

      // Add IPs back (they don't need DNS validation)
      const allValid = [...validated, ...ips];
      const filtered = hostnames.length - validated.length;

      await this.updateJobProgress(jobId, {
        current: hostnames.length,
        total: hostnames.length,
        percentage: 100,
        currentTool: config.tools.useMassdns ? 'massdns' : 'dns-validation',
        toolStatus: 'completed',
        message: `✓ DNS validated ${allValid.length}/${assets.length} assets (${filtered} filtered) in ${elapsed}s @ ${Math.round(hostnames.length / parseFloat(elapsed))}/s`,
        details: {
          tool: config.tools.useMassdns ? 'massdns' : 'dnsx',
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
