/**
 * Declarative Workflow Engine
 * Execute multi-agent workflows defined as reusable templates
 * Inspired by Claude Code's structured task orchestration
 */

import database from './database';
import logger from '../utils/logger';
import queue from './queue';
import {
  AgentWorkflow,
  WorkflowStep,
  TriggerCondition,
} from '../../../shared/agent-collaboration.types';
import { v4 as uuidv4 } from 'uuid';

class WorkflowEngineService {
  private registeredWorkflows: Map<string, AgentWorkflow> = new Map();

  /**
   * Register a workflow template
   */
  async registerWorkflow(workflow: AgentWorkflow): Promise<void> {
    try {
      // Store in database
      await database.query(
        `INSERT INTO workflows (id, name, version, description, trigger_config, error_handling, metadata, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
         ON CONFLICT (name)
         DO UPDATE SET
           version = $3,
           description = $4,
           trigger_config = $5,
           error_handling = $6,
           metadata = $7,
           updated_at = NOW()`,
        [
          uuidv4(),
          workflow.name,
          workflow.version,
          workflow.description,
          JSON.stringify({ on: workflow.trigger.on, filters: workflow.trigger.filters }),
          workflow.errorHandling,
          workflow.metadata || {},
        ]
      );

      // Get workflow ID
      const workflowResult = await database.query(`SELECT id FROM workflows WHERE name = $1`, [
        workflow.name,
      ]);

      const workflowId = workflowResult.rows[0].id;

      // Delete existing steps
      await database.query(`DELETE FROM workflow_steps WHERE workflow_id = $1`, [workflowId]);

      // Store steps
      for (let i = 0; i < workflow.steps.length; i++) {
        const step = workflow.steps[i];
        console.log(
          {
            dependencies: step.dependencies,
            stringifiedDependencies: JSON.stringify(step.dependencies || []),
          },
          'Workflow step dependencies'
        );
        await database.query(
          `INSERT INTO workflow_steps (
            id, workflow_id, sequence, step_id, name, agent_type,
            input_template, output_variable, parallel, retry_strategy, timeout, dependencies
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
          [
            uuidv4(),
            workflowId,
            i,
            step.id,
            step.name,
            step.agent,
            step.input.toString(), // Store as string
            step.output,
            step.parallel || false,
            step.retryStrategy || null,
            step.timeout || null,
            JSON.stringify(step.dependencies || []),
          ]
        );
      }

      // Cache in memory
      this.registeredWorkflows.set(workflow.name, workflow);

      logger.info({ workflow: workflow.name, version: workflow.version }, 'Workflow registered');
    } catch (error: any) {
      logger.error({ error, workflow: workflow.name }, 'Failed to register workflow');
      throw error;
    }
  }

  /**
   * Execute a workflow
   */
  async executeWorkflow(workflowName: string, triggerContext: any): Promise<string> {
    try {
      const workflow = await this.getWorkflow(workflowName);
      if (!workflow) {
        throw new Error(`Workflow not found: ${workflowName}`);
      }

      if (!workflow.enabled) {
        throw new Error(`Workflow disabled: ${workflowName}`);
      }

      // Create execution record
      const executionResult = await database.query(
        `INSERT INTO workflow_executions (
          id, workflow_id, program_id, trigger_event, trigger_context, status, execution_context, started_at
        ) VALUES ($1, $2, $3, $4, $5, 'running', '{}', NOW())
        RETURNING id`,
        [
          uuidv4(),
          workflow.id,
          triggerContext.programId || null,
          workflow.trigger.on,
          triggerContext,
        ]
      );

      const executionId = executionResult.rows[0].id;

      // Execute workflow asynchronously
      this.runWorkflow(workflow, executionId, triggerContext).catch((error) => {
        logger.error({ error, executionId, workflow: workflowName }, 'Workflow execution failed');
      });

      logger.info({ executionId, workflow: workflowName }, 'Workflow execution started');
      return executionId;
    } catch (error: any) {
      logger.error({ error, workflow: workflowName }, 'Failed to start workflow execution');
      throw error;
    }
  }

  /**
   * Run workflow steps
   */
  private async runWorkflow(
    workflow: AgentWorkflow,
    executionId: string,
    initialContext: any
  ): Promise<void> {
    const context: any = { ...initialContext };
    const completedSteps: string[] = [];

    try {
      for (const step of workflow.steps) {
        // Check dependencies
        if (step.dependencies && step.dependencies.length > 0) {
          const unmetDeps = step.dependencies.filter((dep) => !completedSteps.includes(dep));
          if (unmetDeps.length > 0) {
            throw new Error(`Unmet dependencies for step ${step.id}: ${unmetDeps.join(', ')}`);
          }
        }

        logger.info({ executionId, step: step.name }, 'Executing workflow step');

        // Record step execution start
        const stepExecutionId = await this.recordStepStart(executionId, step);

        try {
          if (step.parallel) {
            // Execute parallel jobs
            const input = this.evaluateInput(step.input, context);
            const results = await this.executeParallelJobs(input.jobs);
            context[step.output] = results;
          } else {
            // Execute single job
            const input = this.evaluateInput(step.input, context);
            const result = await this.executeAgentJob(step.agent, input);
            context[step.output] = result;
          }

          // Record step completion
          await this.recordStepComplete(stepExecutionId, context[step.output]);
          completedSteps.push(step.id);

          // Update execution context
          await this.updateExecutionContext(executionId, context);
        } catch (error: any) {
          await this.recordStepFailed(stepExecutionId, error.message);

          // Handle step failure based on strategy
          if (workflow.errorHandling.onStepFailure === 'stop') {
            throw error;
          } else if (workflow.errorHandling.onStepFailure === 'rollback') {
            await this.rollbackWorkflow(executionId, completedSteps);
            throw error;
          }
          // 'continue' - just log and continue
          logger.warn({ error, step: step.name }, 'Step failed, continuing workflow');
        }
      }

      // Workflow completed successfully
      await database.query(
        `UPDATE workflow_executions
         SET status = 'completed', completed_at = NOW()
         WHERE id = $1`,
        [executionId]
      );

      logger.info({ executionId, workflow: workflow.name }, 'Workflow completed successfully');
    } catch (error: any) {
      // Workflow failed
      await database.query(
        `UPDATE workflow_executions
         SET status = 'failed', error = $1, completed_at = NOW()
         WHERE id = $2`,
        [error.message, executionId]
      );

      logger.error({ error, executionId, workflow: workflow.name }, 'Workflow execution failed');
    }
  }

  /**
   * Evaluate input template with context
   */
  private evaluateInput(inputFn: (context: any) => any, context: any): any {
    try {
      return inputFn(context);
    } catch (error: any) {
      logger.error({ error }, 'Failed to evaluate input template');
      throw error;
    }
  }

  /**
   * Execute an agent job
   */
  private async executeAgentJob(agentType: string, input: any): Promise<any> {
    // Queue the job and wait for completion
    const job = await queue.addJob(agentType as any, input);

    // For now, return job ID - in production, would wait for completion
    return {
      jobId: job.id,
      status: 'queued',
      ...input,
    };
  }

  /**
   * Execute parallel jobs
   */
  private async executeParallelJobs(jobs: any[]): Promise<any[]> {
    const jobPromises = jobs.map((job) => this.executeAgentJob(job.type, job.input));
    return Promise.all(jobPromises);
  }

  /**
   * Record step execution start
   */
  private async recordStepStart(executionId: string, step: WorkflowStep): Promise<string> {
    // Get step ID from database
    const stepResult = await database.query(`SELECT id FROM workflow_steps WHERE step_id = $1`, [
      step.id,
    ]);

    if (stepResult.rows.length === 0) {
      throw new Error(`Step not found: ${step.id}`);
    }

    const stepId = stepResult.rows[0].id;

    const result = await database.query(
      `INSERT INTO workflow_step_executions (
        id, execution_id, step_id, status, started_at
      ) VALUES ($1, $2, $3, 'running', NOW())
      RETURNING id`,
      [uuidv4(), executionId, stepId]
    );

    return result.rows[0].id;
  }

  /**
   * Record step completion
   */
  private async recordStepComplete(stepExecutionId: string, output: any): Promise<void> {
    await database.query(
      `UPDATE workflow_step_executions
       SET status = 'completed', output = $1, completed_at = NOW()
       WHERE id = $2`,
      [output, stepExecutionId]
    );
  }

  /**
   * Record step failure
   */
  private async recordStepFailed(stepExecutionId: string, error: string): Promise<void> {
    await database.query(
      `UPDATE workflow_step_executions
       SET status = 'failed', error = $1, completed_at = NOW()
       WHERE id = $2`,
      [error, stepExecutionId]
    );
  }

  /**
   * Update execution context
   */
  private async updateExecutionContext(executionId: string, context: any): Promise<void> {
    await database.query(
      `UPDATE workflow_executions
       SET execution_context = $1
       WHERE id = $2`,
      [context, executionId]
    );
  }

  /**
   * Rollback workflow (cancel queued jobs, mark as failed)
   */
  private async rollbackWorkflow(executionId: string, completedSteps: string[]): Promise<void> {
    logger.info({ executionId, completedSteps }, 'Rolling back workflow');

    // Mark all pending step executions as failed
    await database.query(
      `UPDATE workflow_step_executions
       SET status = 'failed', error = 'Workflow rolled back'
       WHERE execution_id = $1 AND status = 'pending'`,
      [executionId]
    );
  }

  /**
   * Get workflow details
   */
  async getWorkflow(name: string): Promise<any | null> {
    // Check memory cache first
    if (this.registeredWorkflows.has(name)) {
      return this.registeredWorkflows.get(name);
    }

    // Fall back to database
    try {
      const result = await database.query(`SELECT * FROM workflows WHERE name = $1`, [name]);

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Get steps
      const stepsResult = await database.query(
        `SELECT * FROM workflow_steps WHERE workflow_id = $1 ORDER BY sequence`,
        [row.id]
      );

      return {
        id: row.id,
        name: row.name,
        version: row.version,
        description: row.description,
        trigger: row.trigger_config,
        errorHandling: row.error_handling,
        metadata: row.metadata,
        enabled: row.enabled,
        steps: stepsResult.rows,
      };
    } catch (error: any) {
      logger.error({ error, name }, 'Failed to get workflow');
      return null;
    }
  }

  /**
   * Get workflow execution status
   */
  async getExecutionStatus(executionId: string): Promise<any> {
    try {
      const result = await database.query(
        `SELECT we.*, w.name as workflow_name
         FROM workflow_executions we
         JOIN workflows w ON we.workflow_id = w.id
         WHERE we.id = $1`,
        [executionId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const execution = result.rows[0];

      // Get step executions
      const stepsResult = await database.query(
        `SELECT wse.*, ws.name as step_name
         FROM workflow_step_executions wse
         JOIN workflow_steps ws ON wse.step_id = ws.id
         WHERE wse.execution_id = $1
         ORDER BY wse.started_at`,
        [executionId]
      );

      return {
        ...execution,
        steps: stepsResult.rows,
      };
    } catch (error: any) {
      logger.error({ error, executionId }, 'Failed to get execution status');
      return null;
    }
  }

  /**
   * List all registered workflows
   */
  async listWorkflows(): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT id, name, version, description, enabled, created_at, updated_at
         FROM workflows
         ORDER BY created_at DESC`
      );

      return result.rows;
    } catch (error: any) {
      logger.error({ error }, 'Failed to list workflows');
      return [];
    }
  }

  /**
   * List workflow executions
   */
  async listExecutions(limit: number = 50): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT id, workflow_name, status, created_at, completed_at, error
         FROM workflow_executions
         ORDER BY created_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows;
    } catch (error: any) {
      logger.error({ error }, 'Failed to list workflow executions');
      return [];
    }
  }

  /**
   * Enable/disable a workflow
   */
  async setWorkflowEnabled(name: string, enabled: boolean): Promise<void> {
    try {
      await database.query(`UPDATE workflows SET enabled = $1 WHERE name = $2`, [enabled, name]);

      logger.info({ workflow: name, enabled }, 'Workflow enabled status updated');
    } catch (error: any) {
      logger.error({ error, name, enabled }, 'Failed to update workflow enabled status');
      throw error;
    }
  }
}

export default new WorkflowEngineService();
