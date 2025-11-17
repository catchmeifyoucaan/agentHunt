/**
 * Agent Evolution Integration Service
 *
 * Integrates Phase 4 Evolution capabilities with agent execution:
 * - Auto-debugging for failed agents
 * - Causal learning from agent actions
 * - Self-analysis and performance optimization
 * - Tool auto-generation when needed
 */

import logger from '../utils/logger';
import { autoDebugger } from './evolution/auto-debugger';
import { causalLearner } from './evolution/causal-learner';
import { selfAnalyzer } from './evolution/self-analyzer';
import { toolGenerator } from './evolution/tool-generator';
import { AgentType, AgentFeedback } from '../../../shared/agent-collaboration.types';

export class AgentEvolutionIntegration {
  private static instance: AgentEvolutionIntegration;

  private constructor() {
    logger.info('Agent Evolution Integration initialized');
  }

  public static getInstance(): AgentEvolutionIntegration {
    if (!AgentEvolutionIntegration.instance) {
      AgentEvolutionIntegration.instance = new AgentEvolutionIntegration();
    }
    return AgentEvolutionIntegration.instance;
  }

  /**
   * Process agent feedback for causal learning and adaptation
   */
  async processAgentFeedback(feedback: AgentFeedback): Promise<void> {
    try {
      await causalLearner.learnFromObservation({
        action: `agent:${feedback.from.type}:feedback`,
        context: {
          feedbackType: feedback.feedbackType,
          fromAgentType: feedback.from.type,
          toAgentType: feedback.to.type,
          programId: feedback.payload.programId,
          originalJobId: feedback.payload.originalJobId,
          findingId: feedback.payload.findingId,
          templateId: feedback.payload.templateId,
          reason: feedback.payload.reason,
          severity: feedback.severity,
        },
        outcome: {
          success: true, // Feedback itself is a successful event
          result: feedback.payload.details,
        },
        timestamp: feedback.createdAt,
      });
      logger.debug({ feedbackId: feedback.id, feedbackType: feedback.feedbackType }, 'Processed agent feedback for evolution');
    } catch (error: any) {
      logger.warn({ error, feedback }, 'Failed to process agent feedback for evolution');
    }
  }

  /**
   * Record agent execution for causal learning
   * Learns patterns: "When agent X does Y in context Z, result is W"
   */
  async recordAgentExecution(
    agentType: AgentType,
    jobId: string,
    context: Record<string, any>,
    result: {
      success: boolean;
      data?: any;
      error?: string;
      metrics?: Record<string, number>;
    }
  ): Promise<void> {
    try {
      await causalLearner.learnFromObservation({
        action: `agent:${agentType}:execute`,
        context: {
          agentType,
          jobId,
          ...context,
        },
        outcome: {
          success: result.success,
          result: result.data,
          metrics: result.metrics,
        },
        timestamp: new Date(),
      });

      logger.debug(
        { agentType, jobId, success: result.success },
        'Recorded agent execution for causal learning'
      );
    } catch (error: any) {
      logger.warn({ error, agentType }, 'Failed to record agent execution for causal learning');
    }
  }

  /**
   * Analyze agent failure and attempt auto-debugging
   * Returns fixed code/config if successful
   */
  async debugAgentFailure(
    agentType: AgentType,
    jobId: string,
    error: Error,
    context: {
      code?: string;
      language?: 'python' | 'node' | 'bash' | 'go';
      stackTrace?: string;
      config?: any;
    }
  ): Promise<{
    debugged: boolean;
    fixedCode?: string;
    analysis?: string;
    attempts?: number;
  }> {
    try {
      logger.info({ agentType, jobId, error: error.message }, 'Attempting auto-debug of agent failure');

      // If we have code to debug, use auto-debugger
      if (context.code && context.language) {
        const debugResult = await autoDebugger.debugCode({
          code: context.code,
          language: context.language,
          error: error.message,
          errorType: error.name,
          stackTrace: context.stackTrace,
          context: {},
        });

        if (debugResult.success) {
          logger.info(
            { agentType, jobId, attempts: debugResult.attempts.length },
            'Auto-debug successful'
          );

          return {
            debugged: true,
            fixedCode: debugResult.fixedCode,
            analysis: debugResult.attempts[0]?.analysis,
            attempts: debugResult.attempts.length,
          };
        }
      }

      return { debugged: false };
    } catch (error: any) {
      logger.error({ error, agentType, jobId }, 'Auto-debug attempt failed');
      return { debugged: false };
    }
  }

  /**
   * Analyze agent performance and recommend optimizations
   */
  async analyzeAgentPerformance(
    agentType: AgentType,
    sessionId: string,
    metrics: {
      duration: number;
      successRate: number;
      throughput: number;
      errorRate: number;
      memoryUsage?: number;
      cpuUsage?: number;
      customMetrics?: Record<string, number>;
    }
  ): Promise<{
    shouldPivot: boolean;
    recommendations?: string[];
    pivotStrategy?: any;
  }> {
    try {
      // Transform metrics to match PerformanceMetrics interface
      const tasksCompleted = Math.floor(metrics.throughput * (metrics.duration / 60000)); // throughput per minute
      const tasksFailed = Math.floor(tasksCompleted * (metrics.errorRate / 100));

      const analysis = await selfAnalyzer.analyzePerformance({
        agentId: agentType,
        sessionId,
        timestamp: new Date(),
        timeElapsed: metrics.duration,
        tasksCompleted,
        tasksFailed,
        findingsGenerated: tasksCompleted - tasksFailed,
        successRate: metrics.successRate,
        efficiency: metrics.throughput,
        resourceUsage: {
          llmCalls: 0,
          sandboxExecutions: 0,
          databaseQueries: 0,
        },
        errors: tasksFailed > 0 ? [{ type: 'task_failure', count: tasksFailed }] : [],
      });

      if (analysis.pivotRecommended) {
        logger.info(
          {
            agentType,
            sessionId,
            strategy: analysis.pivotStrategy,
            bottlenecks: analysis.bottlenecks,
          },
          'Performance analysis recommends pivot'
        );

        return {
          shouldPivot: true,
          recommendations: analysis.pivotStrategy?.changes?.map((change: any) =>
            typeof change === 'string' ? change : change.parameter || JSON.stringify(change)
          ) || [],
          pivotStrategy: analysis.pivotStrategy,
        };
      }

      return { shouldPivot: false };
    } catch (error: any) {
      logger.error({ error, agentType }, 'Performance analysis failed');
      return { shouldPivot: false };
    }
  }

  /**
   * Generate custom tool when needed
   * Called when agent needs capability it doesn't have
   */
  async generateToolIfNeeded(
    purpose: string,
    language: 'python' | 'node' | 'bash' | 'go',
    requirements: {
      inputs: Array<{ name: string; type: string; description: string }>;
      outputs: Array<{ name: string; type: string; description: string }>;
      constraints?: string[];
      testCases?: Array<{ input: any; expectedOutput: any }>;
    }
  ): Promise<{
    generated: boolean;
    tool?: {
      id: string;
      name: string;
      code: string;
      tested: boolean;
      successRate: number;
    };
  }> {
    try {
      logger.info({ purpose, language }, 'Attempting tool generation');

      // Check if similar tool already exists
      const existingTools = await toolGenerator.searchTools(purpose);
      if (existingTools.length > 0 && existingTools[0].successRate > 0.8) {
        logger.info(
          { purpose, existingTool: existingTools[0].name },
          'Found existing high-quality tool'
        );

        return {
          generated: false,
          tool: existingTools[0],
        };
      }

      // Generate new tool
      const tool = await toolGenerator.generateTool({
        purpose,
        language,
        inputs: requirements.inputs,
        outputs: requirements.outputs,
        requirements: requirements.constraints || [],
        testCases: requirements.testCases?.map((tc, i) => ({
          ...tc,
          description: (tc as any).description || `Test case ${i + 1}`,
        })),
      });

      logger.info(
        {
          toolId: tool.id,
          toolName: tool.name,
          tested: tool.tested,
          successRate: tool.successRate,
        },
        'Tool generated successfully'
      );

      return {
        generated: true,
        tool: {
          id: tool.id,
          name: tool.name,
          code: tool.code,
          tested: tool.tested,
          successRate: tool.successRate,
        },
      };
    } catch (error: any) {
      logger.error({ error, purpose }, 'Tool generation failed');
      return { generated: false };
    }
  }

  /**
   * Get recommended actions for achieving a goal
   * Uses causal learning to suggest best approaches
   */
  async getRecommendedActions(
    desiredOutcome: string,
    context: Record<string, any>
  ): Promise<
    Array<{
      action: string;
      confidence: number;
      description?: string;
    }>
  > {
    try {
      const recommendations = await causalLearner.recommendActions(desiredOutcome, context);

      return recommendations.map((rec) => ({
        action: rec.action,
        confidence: rec.confidence,
        description: `Based on ${rec.rules.length} learned patterns`,
      }));
    } catch (error: any) {
      logger.error({ error, desiredOutcome }, 'Failed to get action recommendations');
      return [];
    }
  }

  /**
   * Predict outcome of an action before executing
   * Uses causal learning for prediction
   */
  async predictOutcome(
    action: string,
    context: Record<string, any>
  ): Promise<{
    outcome: string;
    confidence: number;
    alternatives: Array<{ outcome: string; probability: number }>;
  }> {
    try {
      const prediction = await causalLearner.predictOutcome(action, context);

      return {
        outcome: prediction.predictedOutcome,
        confidence: prediction.confidence,
        alternatives: prediction.alternativeOutcomes.map((alt) => ({
          outcome: alt.outcome,
          probability: alt.probability,
        })),
      };
    } catch (error: any) {
      logger.error({ error, action }, 'Outcome prediction failed');
      return {
        outcome: 'unknown',
        confidence: 0,
        alternatives: [],
      };
    }
  }

  /**
   * Get evolution system statistics
   */
  async getStats(): Promise<{
    causalLearning: {
      totalRules: number;
      avgConfidence: number;
    };
    autoDebugging: {
      totalPatterns: number;
      avgConfidence: number;
    };
    toolGeneration: {
      totalTools: number;
      avgSuccessRate: number;
    };
    selfAnalysis: {
      totalPivots: number;
      successfulPivots: number;
    };
  }> {
    const [causalStats, debugStats, toolStats, pivotStats] = await Promise.all([
      causalLearner.getStats(),
      autoDebugger.getStats(),
      toolGenerator.getStats(),
      selfAnalyzer.getPivotStats(),
    ]);

    return {
      causalLearning: {
        totalRules: causalStats.totalRules,
        avgConfidence: causalStats.avgConfidence,
      },
      autoDebugging: {
        totalPatterns: debugStats.totalPatterns,
        avgConfidence: debugStats.avgConfidence,
      },
      toolGeneration: {
        totalTools: toolStats.totalTools,
        avgSuccessRate: toolStats.avgSuccessRate,
      },
      selfAnalysis: {
        totalPivots: pivotStats.totalPivots,
        successfulPivots: pivotStats.successfulPivots,
      },
    };
  }
}

// Singleton instance
export const agentEvolution = AgentEvolutionIntegration.getInstance();
export default agentEvolution;
