/**
 * Base Pattern System - Phase 3.5: Formal Patterns
 *
 * Provides reusable workflow templates for different scan types:
 * - Full Recon: Complete discovery → fingerprint → crawl → scan → triage
 * - Quick Scan: Fast targeted scanning on known assets
 * - Deep Scan: Exhaustive scanning with bruteforce and port scanning
 * - WordPress Scan: Specialized WordPress vulnerability detection
 * - API Scan: API endpoint discovery and testing
 *
 * Patterns enable:
 * - Standardized workflows
 * - User-selectable scan strategies
 * - Conditional execution based on previous results
 * - Automated agent orchestration
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

/**
 * Individual step in a pattern workflow
 */
export interface PatternStep {
  agent: string; // Agent type (discovery, fingerprint, scanner, etc.)
  options: Record<string, any>; // Agent-specific options
  condition?: (previousResults: PatternStepResult[]) => boolean; // Optional condition to execute
  handoffs?: string[]; // Agents that can be handed off to
  priority?: number; // Job priority (1-10)
  timeout?: number; // Step timeout in ms
}

/**
 * Result from executing a pattern step
 */
export interface PatternStepResult {
  step: string; // Agent type
  jobId: string; // Job ID
  status: 'queued' | 'running' | 'completed' | 'failed';
  output?: any; // Step output
  error?: string; // Error if failed
  duration?: number; // Execution time in ms
}

/**
 * Pattern definition
 */
export interface Pattern {
  name: string;
  description: string;
  tags: string[]; // e.g., ['reconnaissance', 'fast', 'wordpress']
  steps: PatternStep[];
  estimatedDuration: string; // e.g., "10-15 minutes"
  estimatedCost: string; // e.g., "$0.00 (Gemini free tier)"
  metadata?: {
    useCase?: string;
    targetAudience?: string;
    requirements?: string[];
  };
}

/**
 * Result from executing a pattern
 */
export interface PatternExecutionResult {
  patternName: string;
  programId: string;
  executionId: string;
  steps: PatternStepResult[];
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  totalDuration?: number;
}

/**
 * Base class for all patterns
 */
export abstract class BasePattern {
  protected tracer = trace.getTracer('agenthunt-patterns');

  /**
   * Get pattern definition (implemented by subclasses)
   */
  abstract getDefinition(): Pattern;

  /**
   * Execute pattern workflow
   */
  async execute(programId: string, initialOptions: any = {}): Promise<PatternExecutionResult> {
    const executionId = uuidv4();
    const pattern = this.getDefinition();

    const span = this.tracer.startSpan('pattern.execute', {
      attributes: {
        'pattern.name': pattern.name,
        'pattern.program_id': programId,
        'pattern.execution_id': executionId,
        'pattern.steps_count': pattern.steps.length,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      const startTime = Date.now();
      const results: PatternStepResult[] = [];

      logger.info(
        {
          pattern: pattern.name,
          programId,
          executionId,
          steps: pattern.steps.length,
        },
        'Starting pattern execution'
      );

      try {
        for (const step of pattern.steps) {
          // Check if step should run
          if (step.condition && !step.condition(results)) {
            logger.debug(
              { step: step.agent, pattern: pattern.name },
              'Skipping step due to condition'
            );
            continue;
          }

          // Execute step
          const stepResult = await this.executeStep(programId, step, results, executionId);
          results.push(stepResult);

          // Stop if step failed
          if (stepResult.status === 'failed') {
            logger.error(
              { step: step.agent, error: stepResult.error, pattern: pattern.name },
              'Pattern step failed'
            );
            break;
          }
        }

        const totalDuration = Date.now() - startTime;
        const executionResult: PatternExecutionResult = {
          patternName: pattern.name,
          programId,
          executionId,
          steps: results,
          status: results.some((r) => r.status === 'failed') ? 'failed' : 'completed',
          startedAt: new Date(startTime),
          completedAt: new Date(),
          totalDuration,
        };

        span.setAttributes({
          'pattern.status': executionResult.status,
          'pattern.duration_ms': totalDuration,
          'pattern.steps_executed': results.length,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        logger.info(
          {
            pattern: pattern.name,
            programId,
            executionId,
            status: executionResult.status,
            duration: totalDuration,
          },
          'Pattern execution completed'
        );

        return executionResult;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

        logger.error({ error, pattern: pattern.name, programId }, 'Pattern execution failed');

        return {
          patternName: pattern.name,
          programId,
          executionId,
          steps: results,
          status: 'failed' as const,
          startedAt: new Date(startTime),
          completedAt: new Date(),
          totalDuration: Date.now() - startTime,
        } as PatternExecutionResult;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Execute a single pattern step
   */
  private async executeStep(
    programId: string,
    step: PatternStep,
    previousResults: PatternStepResult[],
    executionId: string
  ): Promise<PatternStepResult> {
    const jobId = uuidv4();
    const startTime = Date.now();

    const span = this.tracer.startSpan('pattern.step', {
      attributes: {
        'pattern.step': step.agent,
        'pattern.execution_id': executionId,
        'job.id': jobId,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        // Merge options with previous results
        const mergedOptions = this.mergeOptions(step.options, previousResults, programId);

        // Queue job
        const { queue } = require('../services/queue');
        await queue.addJob(step.agent, {
          id: jobId,
          type: step.agent,
          programId,
          options: mergedOptions,
          priority: step.priority || 5,
          metadata: {
            pattern: this.getDefinition().name,
            executionId,
            step: step.agent,
          },
        });

        logger.info(
          {
            step: step.agent,
            jobId,
            programId,
            executionId,
          },
          'Pattern step queued'
        );

        span.setAttributes({
          'pattern.step.status': 'queued',
          'job.id': jobId,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return {
          step: step.agent,
          jobId,
          status: 'queued' as const,
          duration: Date.now() - startTime,
        } as PatternStepResult;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

        logger.error({ error, step: step.agent, programId }, 'Failed to queue pattern step');

        return {
          step: step.agent,
          jobId,
          status: 'failed' as const,
          error: error.message,
          duration: Date.now() - startTime,
        } as PatternStepResult;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Merge step options with results from previous steps
   */
  private mergeOptions(
    stepOptions: any,
    previousResults: PatternStepResult[],
    programId: string
  ): any {
    // Default merge: pass previous results as context
    const merged = {
      ...stepOptions,
      patternContext: {
        programId,
        previousSteps: previousResults.map((r) => ({
          agent: r.step,
          jobId: r.jobId,
          status: r.status,
        })),
      },
    };

    // Custom merge logic for specific cases
    // Example: Fingerprint step should get assets from Discovery step
    const lastDiscoveryResult = previousResults
      .filter((r) => r.step === 'discovery')
      .pop();

    if (lastDiscoveryResult && lastDiscoveryResult.output?.assets) {
      merged.assets = lastDiscoveryResult.output.assets;
    }

    return merged;
  }

  /**
   * Validate pattern definition
   */
  validate(): { valid: boolean; errors: string[] } {
    const pattern = this.getDefinition();
    const errors: string[] = [];

    if (!pattern.name) {
      errors.push('Pattern name is required');
    }

    if (!pattern.description) {
      errors.push('Pattern description is required');
    }

    if (!pattern.steps || pattern.steps.length === 0) {
      errors.push('Pattern must have at least one step');
    }

    pattern.steps.forEach((step, index) => {
      if (!step.agent) {
        errors.push(`Step ${index + 1}: agent type is required`);
      }
      if (!step.options) {
        errors.push(`Step ${index + 1}: options are required`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export default BasePattern;
