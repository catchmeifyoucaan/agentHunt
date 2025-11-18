/**
 * Handoff-to-Job Processor
 * Responsible for converting pending rich handoffs into queue jobs
 */

import logger from '../utils/logger';
import queue from '../services/queue';
import database from '../services/database';
import agentHealth from '../services/agent-health';
import loadBalancer from '../services/load-balancer';
import { v4 as uuidv4 } from 'uuid';
import { JobStatus } from '../../../shared/types';

// Circuit breaker state for each agent type
interface CircuitBreakerState {
  state: 'closed' | 'open' | 'half-open'; // Closed = normal, Open = tripped, Half-open = testing
  failureCount: number;
  lastFailureTime: Date | null;
  openedAt: Date | null;
  nextAttemptAt: Date | null;
}

class HandoffProcessor {
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private readonly PROCESS_INTERVAL = process.env.HANDOFF_PROCESSOR_INTERVAL
    ? parseInt(process.env.HANDOFF_PROCESSOR_INTERVAL)
    : 5000; // Process every 5 seconds by default
  private readonly MAX_BATCH_SIZE = 20; // Max handoffs to process per cycle
  private readonly MAX_RETRIES = 3; // Max retries for job creation
  private readonly FAILURE_THRESHOLD = 5; // Number of failures to trip circuit
  private readonly RESET_TIMEOUT = 300000; // Time to wait before half-open (5 minutes)
  private readonly AGENT_CIRCUIT_STATES = new Map<string, CircuitBreakerState>(); // Circuit breaker states per agent

  constructor() {
    // Initialize circuit breaker states for common agent types
    this.initializeCircuitBreakers();
  }

  /**
   * Initialize circuit breaker states for agent types
   */
  private initializeCircuitBreakers(): void {
    // Initialize with closed state for all agent types
    const knownAgentTypes = [
      'discovery', 'subdomain', 'bruteforce', 'fingerprint', 'crawl',
      'portscan', 'scanner', 'interact', 'confirm', 'triage', 'osint',
      'xss', 'sqli', 'webvulns', 'jsanalysis', 'cloudmisconfig', 'three-agent',
      'apifuzz', 'ssrf', 'browser'  // Added missing agent types
    ];

    for (const agentType of knownAgentTypes) {
      this.AGENT_CIRCUIT_STATES.set(agentType, {
        state: 'closed',
        failureCount: 0,
        lastFailureTime: null,
        openedAt: null,
        nextAttemptAt: null
      });
    }

    logger.info({ agentTypes: knownAgentTypes.length }, 'Circuit breakers initialized to closed state');
  }

  /**
   * Manually reset circuit breaker for an agent (for recovery)
   */
  resetCircuitBreaker(agentType: string): void {
    this.AGENT_CIRCUIT_STATES.set(agentType, {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: null,
      openedAt: null,
      nextAttemptAt: null
    });
    logger.info({ agentType }, 'Circuit breaker manually reset');
  }

  /**
   * Reset all circuit breakers (for recovery after system restart)
   */
  resetAllCircuitBreakers(): void {
    for (const [agentType] of this.AGENT_CIRCUIT_STATES) {
      this.resetCircuitBreaker(agentType);
    }
    logger.info('All circuit breakers reset');
  }

  /**
   * Check if agent is in circuit breaker open state
   * Automatically resets to half-open after timeout
   */
  private isCircuitOpen(agentType: string): boolean {
    const state = this.AGENT_CIRCUIT_STATES.get(agentType);
    if (!state) return false;

    if (state.state === 'open') {
      // Check if reset timeout has passed - AUTOMATIC RESET
      if (state.nextAttemptAt && new Date() >= state.nextAttemptAt) {
        // Transition to half-open to test the agent
        const halfOpenState = {
          ...state,
          state: 'half-open' as const
        };
        this.AGENT_CIRCUIT_STATES.set(agentType, halfOpenState);
        
        // Persist to database for recovery across restarts
        this.persistCircuitBreakerState(agentType, halfOpenState).catch(err => {
          logger.error({ error: err, agentType }, 'Failed to persist circuit breaker half-open state');
        });
        
        logger.info({ agentType, resetTimeout: this.RESET_TIMEOUT }, 'Circuit breaker automatically reset to half-open for testing');
        return false; // Allow one attempt to test
      }
      return true; // Still in open state
    }
    return state.state !== 'closed'; // Return true if not closed (i.e., half-open)
  }

  /**
   * Record a failure for an agent type and trip circuit if needed
   */
  private recordFailure(agentType: string): void {
    const state = this.AGENT_CIRCUIT_STATES.get(agentType) || {
      state: 'closed',
      failureCount: 0,
      lastFailureTime: null,
      openedAt: null,
      nextAttemptAt: null
    };

    const newFailureCount = state.failureCount + 1;
    const newState: CircuitBreakerState = {
      state: newFailureCount >= this.FAILURE_THRESHOLD ? 'open' : 'closed',
      failureCount: newFailureCount,
      lastFailureTime: new Date(),
      openedAt: newFailureCount >= this.FAILURE_THRESHOLD ? new Date() : state.openedAt,
      nextAttemptAt: newFailureCount >= this.FAILURE_THRESHOLD ?
        new Date(Date.now() + this.RESET_TIMEOUT) : state.nextAttemptAt
    };

    this.AGENT_CIRCUIT_STATES.set(agentType, newState);

    if (newState.state === 'open') {
      logger.warn({
        agentType,
        failureCount: newFailureCount,
        resetTime: newState.nextAttemptAt,
        autoResetIn: `${this.RESET_TIMEOUT / 1000}s`
      }, 'Circuit breaker tripped for agent - will auto-reset');

      // Persist to database for recovery across restarts
      this.persistCircuitBreakerState(agentType, newState).catch(err => {
        logger.error({ error: err, agentType }, 'Failed to persist circuit breaker state');
      });

      // 🔗 HEALTH INTEGRATION: Report circuit breaker trip to health monitoring
      this.reportCircuitBreakerToHealth(agentType, newState).catch(err => {
        logger.error({ error: err, agentType }, 'Failed to report circuit breaker state to health service');
      });
    }
  }

  /**
   * Record a successful operation for an agent type and reset circuit if needed
   */
  private recordSuccess(agentType: string): void {
    const state = this.AGENT_CIRCUIT_STATES.get(agentType);
    if (state) {
      // If in half-open state and success, reset to closed
      if (state.state === 'half-open') {
        const resetState: CircuitBreakerState = {
          state: 'closed',
          failureCount: 0,
          lastFailureTime: null,
          openedAt: null,
          nextAttemptAt: null
        };
        this.AGENT_CIRCUIT_STATES.set(agentType, resetState);
        logger.info({ agentType }, 'Circuit breaker automatically recovered after successful test');

        // Persist to database
        this.persistCircuitBreakerState(agentType, resetState).catch(err => {
          logger.error({ error: err, agentType }, 'Failed to persist circuit breaker recovery');
        });

        // 🔗 HEALTH INTEGRATION: Report circuit breaker recovery to health monitoring
        this.reportCircuitBreakerToHealth(agentType, resetState).catch(err => {
          logger.error({ error: err, agentType }, 'Failed to report circuit breaker recovery to health service');
        });
      }
    }
  }

  /**
   * Report circuit breaker state to agent health monitoring
   * Enables health dashboard to show circuit breaker status
   */
  private async reportCircuitBreakerToHealth(
    agentType: string,
    state: CircuitBreakerState
  ): Promise<void> {
    try {
      if (state.state === 'open') {
        // Report health issue for circuit breaker trip
        await agentHealth.reportIssue(
          agentType,
          'circuit-breaker',
          'all', // affects all instances of this agent type
          'high',
          `Circuit breaker tripped after ${state.failureCount} failures`,
          {
            failureCount: state.failureCount,
            openedAt: state.openedAt,
            nextAttemptAt: state.nextAttemptAt,
            resetTimeout: this.RESET_TIMEOUT,
          }
        );

        logger.info({ agentType, state: 'open' }, 'Reported circuit breaker trip to health monitoring');
      } else if (state.state === 'closed' && state.failureCount === 0) {
        // Report resolution for circuit breaker recovery
        await agentHealth.resolveIssue(
          agentType,
          'circuit-breaker',
          'all',
          'Circuit breaker recovered, operations resumed'
        );

        logger.info({ agentType, state: 'closed' }, 'Reported circuit breaker recovery to health monitoring');
      }
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to report circuit breaker state to health monitoring');
    }
  }

  /**
   * Persist circuit breaker state to database for recovery across restarts
   */
  private async persistCircuitBreakerState(
    agentType: string,
    state: CircuitBreakerState
  ): Promise<void> {
    try {
      await database.query(
        `UPDATE agent_health
         SET circuit_breaker_state = $1,
             circuit_breaker_failures = $2,
             circuit_breaker_opened_at = $3,
             circuit_breaker_next_attempt = $4
         WHERE agent_type = $5`,
        [
          state.state,
          state.failureCount,
          state.openedAt,
          state.nextAttemptAt,
          agentType
        ]
      );
      
      logger.debug({ agentType, state: state.state }, 'Circuit breaker state persisted to database');
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to persist circuit breaker state');
    }
  }

  /**
   * Load circuit breaker states from database (recovery after restart)
   */
  private async loadCircuitBreakerStates(): Promise<void> {
    try {
      const result = await database.query(
        `SELECT agent_type, circuit_breaker_state, circuit_breaker_failures,
                circuit_breaker_opened_at, circuit_breaker_next_attempt
         FROM agent_health
         WHERE circuit_breaker_state IS NOT NULL
           AND circuit_breaker_state != 'closed'`
      );

      for (const row of result.rows) {
        this.AGENT_CIRCUIT_STATES.set(row.agent_type, {
          state: row.circuit_breaker_state,
          failureCount: row.circuit_breaker_failures || 0,
          lastFailureTime: row.circuit_breaker_opened_at,
          openedAt: row.circuit_breaker_opened_at,
          nextAttemptAt: row.circuit_breaker_next_attempt
        });
      }

      logger.info({ count: result.rows.length }, 'Loaded circuit breaker states from database');
    } catch (error: any) {
      logger.error({ error }, 'Failed to load circuit breaker states from database');
    }
  }

  /**
   * Background task to auto-reset stuck circuit breakers and handoffs
   */
  private async autoResetStuckCircuitBreakers(): Promise<void> {
    try {
      // Reset handoffs that are stuck in circuit_breaker_open state for too long
      const resetResult = await database.query(
        `UPDATE rich_handoffs
         SET status = 'pending',
             rejection_reason = NULL,
             completed_at = NULL
         WHERE status = 'circuit_breaker_open'
           AND created_at < NOW() - INTERVAL '1 hour'`
      );

      if (resetResult.rowCount && resetResult.rowCount > 0) {
        logger.info({ count: resetResult.rowCount }, 'Auto-reset stuck circuit_breaker_open handoffs');
      }

      // Check and update circuit breaker states that should be reset
      for (const [agentType, state] of this.AGENT_CIRCUIT_STATES) {
        if (state.state === 'open' && state.nextAttemptAt && new Date() >= state.nextAttemptAt) {
          // Will be handled by isCircuitOpen on next check, but log it
          logger.debug({ agentType }, 'Circuit breaker ready for auto-reset to half-open');
        }
      }
    } catch (error: any) {
      logger.error({ error }, 'Error in auto-reset circuit breakers task');
    }
  }

  /**
   * Start the handoff processor
   */
  async start(): Promise<void> {
    logger.info('Starting Handoff-to-Job processor...');

    // Load circuit breaker states from database (recovery after restart)
    await this.loadCircuitBreakerStates();

    // Process handoffs immediately on startup
    await this.processPendingHandoffs();
    await this.monitorHandoffCompletion(); // Also check for completions on startup

    // Set up recurring intervals
    this.processingInterval = setInterval(async () => {
      try {
        await this.processPendingHandoffs();
        await this.monitorHandoffCompletion();
        await this.autoResetStuckCircuitBreakers(); // Auto-reset stuck states
      } catch (error) {
        logger.error({ error }, 'Error in handoff processor interval');
      }
    }, this.PROCESS_INTERVAL);

    logger.info({
      interval: this.PROCESS_INTERVAL,
      maxBatchSize: this.MAX_BATCH_SIZE,
      autoReset: true
    }, 'Handoff processor started with auto-reset enabled');
  }

  /**
   * Stop the handoff processor
   */
  async stop(): Promise<void> {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
      logger.info('Handoff processor stopped');
    }
  }

  /**
   * Process all pending handoffs
   */
  async processPendingHandoffs(): Promise<void> {
    if (this.isProcessing) {
      logger.debug('Handoff processor already running, skipping this cycle');
      return;
    }

    this.isProcessing = true;
    
    try {
      logger.debug('Checking for pending handoffs...');
      
      // Get pending handoffs from the database
      // Using the pending_handoffs view that's already defined in the schema
      const result = await database.query(
        `SELECT * FROM pending_handoffs
         ORDER BY created_at ASC
         LIMIT $1`,
        [this.MAX_BATCH_SIZE]
      );

      const pendingHandoffs = result.rows;

      if (pendingHandoffs.length === 0) {
        logger.debug('No pending handoffs found');
        return;
      }

      logger.info({ count: pendingHandoffs.length }, 'Processing pending handoffs');

      for (const handoff of pendingHandoffs) {
        await this.processSingleHandoff(handoff);
      }
    } catch (error: any) {
      logger.error({ error }, 'Error processing pending handoffs');
      throw error;
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Process a single handoff record
   */
  private async processSingleHandoff(handoff: any): Promise<void> {
    const {
      id: handoffId,
      to_agent_type: agentType,
      program_id: programId,
      parent_result: parentResult,
      reasoning,
      objectives,
      success_criteria: successCriteria,
      inherited_constraints: inheritedConstraints
    } = handoff;

    // Check if the agent is in circuit breaker open state
    if (this.isCircuitOpen(agentType)) {
      logger.warn({
        handoffId,
        agentType,
        programId
      }, 'Circuit breaker is open for agent, skipping handoff processing');

      // Update handoff status to circuit_breaker_open
      await database.query(
        `UPDATE rich_handoffs
         SET status = 'circuit_breaker_open',
             rejection_reason = $1
         WHERE id = $2`,
        [`Circuit breaker open for agent ${agentType}`, handoffId]
      );
      return;
    }

    // 🔄 LOAD BALANCING: Check agent availability before routing
    const loadBalanceDecision = await loadBalancer.shouldRouteHandoff(agentType);
    if (!loadBalanceDecision.shouldRoute) {
      logger.warn({
        handoffId,
        agentType,
        reason: loadBalanceDecision.reason,
        programId
      }, 'Load balancer rejected handoff - agent unavailable');

      // Update handoff status to rejected with reason
      await database.query(
        `UPDATE rich_handoffs
         SET status = 'rejected',
             rejection_reason = $1
         WHERE id = $2`,
        [`Load balancer: ${loadBalanceDecision.reason}`, handoffId]
      );
      return;
    }

    // Use alternative agent if load balancer selected one
    const targetAgentType = loadBalanceDecision.agentType !== agentType
      ? loadBalanceDecision.agentType
      : agentType;

    if (targetAgentType !== agentType) {
      logger.info({
        handoffId,
        originalAgent: agentType,
        routedTo: targetAgentType,
        reason: loadBalanceDecision.reason
      }, 'Load balancer routed handoff to alternative agent');

      // Update handoff to reflect routing decision
      await database.query(
        `UPDATE rich_handoffs
         SET to_agent_type = $1,
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('loadBalanced', true, 'originalAgent', $2)
         WHERE id = $3`,
        [targetAgentType, agentType, handoffId]
      );
    }

    // Check queue full status for backpressure
    const queueStatus = await loadBalancer.checkQueueFull(targetAgentType);
    if (queueStatus.shouldBackpressure) {
      logger.warn({
        handoffId,
        agentType: targetAgentType,
        queueDepth: queueStatus.queueDepth,
        programId
      }, 'Queue full - applying backpressure, delaying handoff');

      // Delay handoff processing (will be retried on next cycle)
      // Don't update status, leave as pending
      return;
    }

    logger.info({
      handoffId,
      toAgentType: targetAgentType,
      originalAgent: agentType,
      programId
    }, 'Processing handoff');

    // Implement retry logic with exponential backoff
    let retryCount = 0;
    const maxRetries = this.MAX_RETRIES;
    let delay = 1000; // Initial delay of 1 second

    while (retryCount <= maxRetries) {
      try {
        // Create job based on handoff context
        const jobId = uuidv4();

        // Get the parent job ID from the handoff record
        const parentJobId = handoff.from_job_id;

        // Extract OpenTelemetry trace context from handoff's inherited constraints metadata
        const otelTraceContext = handoff.inherited_constraints?.metadata?._otelTraceContext;

        // Construct job data from handoff context
        const jobData = {
          id: jobId,
          type: targetAgentType as any,
          programId: programId,
          priority: 7, // High priority for handoffs
          status: 'pending' as JobStatus,
          attempts: 0,
          maxAttempts: 3,
          createdAt: new Date(),
          options: {
            // Include handoff context as options for the receiving agent
            handoffContext: {
              id: handoffId,
              fromAgent: handoff.from_agent_type,
              parentResult: parentResult,
              reasoning: reasoning,
              objectives: objectives,
              successCriteria: successCriteria,
              inherited: inheritedConstraints
            },
            ...inheritedConstraints // Include inherited constraints as options
          },
          metadata: {
            handoffOrigin: 'rich-handoff',
            parentHandoffId: handoffId,
            fromAgent: handoff.from_agent_type,
            createdAt: new Date(handoff.created_at).toISOString(),
            requestedBy: 'handoff-processor',
            tags: ['handoff', `from-${handoff.from_agent_type}`, `to-${agentType}`],
            ...(parentJobId && { parentJobId }), // Include parent job ID if available
            ...(otelTraceContext && { _otelTraceContext: otelTraceContext }), // Inject trace context
          }
        };

        // Add any additional context data
        if (parentResult?.findings) {
          jobData.options.findings = parentResult.findings;
        }

        // Insert the job into the database with parent job ID
        await database.query(
          `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata, parent_job_id, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            jobId,
            agentType,
            programId,
            jobData.priority,
            jobData.status,
            jobData.attempts,
            jobData.maxAttempts,
            JSON.stringify(jobData.options),
            JSON.stringify(jobData.metadata),
            parentJobId || null,  // Set parent_job_id from the handoff's from_job_id
            new Date()
          ]
        );

        // Create the job in the queue
        await queue.addJob(targetAgentType, jobData);

        // Record success in circuit breaker
        this.recordSuccess(targetAgentType);

        // Update handoff status to accepted
        await database.query(
          `UPDATE rich_handoffs
           SET status = 'accepted',
               to_job_id = $1,
               to_agent_instance = $2,
               accepted_at = NOW(),
               retry_count = $3
           WHERE id = $4`,
          [jobId, process.env.WORKER_ID || 'handoff-processor', retryCount, handoffId]
        );

        logger.info({
          handoffId,
          jobId,
          agentType: targetAgentType,
          originalAgent: agentType,
          retryCount
        }, 'Handoff converted to job successfully');

        return; // Success, exit the retry loop

      } catch (jobError: any) {
        retryCount++;

        // Record failure in circuit breaker
        this.recordFailure(targetAgentType);

        if (retryCount > maxRetries) {
          logger.error({
            handoffId,
            agentType: targetAgentType,
            originalAgent: agentType,
            retryCount,
            error: jobError.message
          }, 'Failed to create job from handoff after max retries');

          // Update handoff status to failed after max retries
          await database.query(
            `UPDATE rich_handoffs
             SET status = 'failed',
                 rejection_reason = $1,
                 completed_at = NOW(),
                 retry_count = $2
             WHERE id = $3`,
            [`Failed to create job after ${maxRetries} retries: ${jobError.message}`, retryCount, handoffId]
          );

          break; // Exit the retry loop
        } else {
          logger.warn({
            handoffId,
            agentType: targetAgentType,
            originalAgent: agentType,
            retryCount,
            maxRetries,
            error: jobError.message
          }, `Failed to create job from handoff, retrying...`);

          // Update retry count in database
          await database.query(
            `UPDATE rich_handoffs
             SET retry_count = $1
             WHERE id = $2`,
            [retryCount, handoffId]
          );

          // Exponential backoff: delay = initial_delay * (2 ^ retry_count)
          await new Promise(resolve => setTimeout(resolve, delay));
          delay *= 2; // Double the delay for next retry (exponential backoff)
        }
      }
    }
  }

  /**
   * Monitor handoff completion and update status
   */
  async monitorHandoffCompletion(): Promise<void> {
    try {
      // Find handoffs that have corresponding jobs that are completed
      const result = await database.query(`
        SELECT rh.*, j.status as job_status, j.completed_at as job_completed_at
        FROM rich_handoffs rh
        JOIN jobs j ON rh.to_job_id = j.id
        WHERE rh.status = 'accepted' 
        AND j.status IN ('completed', 'failed', 'cancelled')
        AND rh.completed_at IS NULL
      `);

      for (const handoff of result.rows) {
        await this.updateHandoffCompletion(handoff);
      }
    } catch (error: any) {
      logger.error({ error }, 'Error monitoring handoff completion');
    }
  }

  /**
   * Update handoff completion status based on job status
   */
  private async updateHandoffCompletion(handoff: any): Promise<void> {
    const { id: handoffId, to_job_id: jobId, job_status: jobStatus } = handoff;

    if (jobStatus === 'completed') {
      // Try to get job result to include in handoff completion
      let jobResult = null;
      try {
        const jobResultQuery = await database.query(
          `SELECT result FROM jobs WHERE id = $1`,
          [jobId]
        );
        jobResult = jobResultQuery.rows[0]?.result;
      } catch (error) {
        logger.warn({ jobId, error }, 'Could not retrieve job result for handoff completion');
      }

      await database.query(
        `UPDATE rich_handoffs
         SET status = 'completed',
             completion_result = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [JSON.stringify(jobResult), handoffId]
      );

      logger.info({ handoffId, jobId }, 'Handoff completed successfully');
    } else {
      // Job failed or was cancelled
      await database.query(
        `UPDATE rich_handoffs
         SET status = 'failed',
             rejection_reason = $1,
             completed_at = NOW()
         WHERE id = $2`,
        [`Job ${jobStatus}: corresponding job ${jobId} ${jobStatus}`, handoffId]
      );

      logger.warn({ handoffId, jobId, jobStatus }, 'Handoff failed due to job failure');
    }
  }
}

// Create and export the processor instance
export const handoffProcessor = new HandoffProcessor();

// Start the processor when this module is imported if not in worker mode
if (require.main === module) {
  // This is the main module, run as a standalone processor
  async function startAsStandalone() {
    try {
      await handoffProcessor.start();
      
      // Set up graceful shutdown
      process.on('SIGTERM', async () => {
        logger.info('Received SIGTERM, shutting down handoff processor...');
        await handoffProcessor.stop();
        process.exit(0);
      });

      process.on('SIGINT', async () => {
        logger.info('Received SIGINT, shutting down handoff processor...');
        await handoffProcessor.stop();
        process.exit(0);
      });
    } catch (error) {
      logger.error({ error }, 'Failed to start handoff processor');
      process.exit(1);
    }
  }

  startAsStandalone();
}

export default handoffProcessor;