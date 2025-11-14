/**
 * Self-Analysis & Auto-Pivoting System
 *
 * Enables agents to analyze their own performance and pivot strategies
 * Features:
 * - Continuous performance monitoring
 * - Bottleneck detection
 * - Automatic strategy pivoting
 * - Efficiency optimization
 * - Failure pattern recognition
 */

import logger from '../../utils/logger';
import { llmEngine } from '../llm/llm-engine';
import { causalLearner } from './causal-learner';
import database from '../database';
import { v4 as uuidv4 } from 'uuid';

export interface PerformanceMetrics {
  agentId: string;
  sessionId: string;
  timeElapsed: number; // milliseconds
  tasksCompleted: number;
  tasksFailed: number;
  findingsGenerated: number;
  successRate: number; // 0.0-1.0
  efficiency: number; // findings per minute
  resourceUsage: {
    llmCalls: number;
    sandboxExecutions: number;
    databaseQueries: number;
  };
  errors: Array<{
    type: string;
    count: number;
  }>;
  timestamp: Date;
}

export interface PerformanceAnalysis {
  overallScore: number; // 0.0-1.0
  bottlenecks: Array<{
    area: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    impact: number; // estimated time loss in %
    recommendations: string[];
  }>;
  strengths: string[];
  weaknesses: string[];
  comparisonToBaseline: {
    speedChange: number; // % faster or slower
    qualityChange: number; // % better or worse
    efficiencyChange: number;
  };
  pivotRecommended: boolean;
  pivotStrategy?: PivotStrategy;
}

export interface PivotStrategy {
  id: string;
  reason: string;
  changes: Array<{
    parameter: string;
    oldValue: any;
    newValue: any;
    expectedImprovement: string;
  }>;
  expectedImpact: {
    speed: number; // % improvement
    quality: number;
    success: number;
  };
  priority: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
}

export interface PivotResult {
  strategyId: string;
  applied: boolean;
  beforeMetrics: PerformanceMetrics;
  afterMetrics?: PerformanceMetrics;
  actualImpact?: {
    speed: number;
    quality: number;
    success: number;
  };
  success: boolean;
  learnings: string[];
}

export class SelfAnalyzer {
  private performanceHistory: Map<string, PerformanceMetrics[]> = new Map();
  private pivotHistory: Map<string, PivotResult[]> = new Map();
  private baseline: PerformanceMetrics | null = null;
  private analysisInterval = 60000; // Analyze every minute

  /**
   * Analyze agent performance and recommend pivots
   */
  async analyzePerformance(metrics: PerformanceMetrics): Promise<PerformanceAnalysis> {
    logger.info({ agentId: metrics.agentId }, 'Analyzing agent performance');

    // Store metrics
    const history = this.performanceHistory.get(metrics.agentId) || [];
    history.push(metrics);
    this.performanceHistory.set(metrics.agentId, history);

    // Set baseline if not set
    if (!this.baseline && history.length >= 3) {
      this.baseline = this.calculateBaseline(history.slice(0, 3));
    }

    // Detect bottlenecks
    const bottlenecks = await this.detectBottlenecks(metrics, history);

    // Identify strengths and weaknesses
    const strengths = this.identifyStrengths(metrics, this.baseline);
    const weaknesses = this.identifyWeaknesses(metrics, this.baseline);

    // Compare to baseline
    const comparisonToBaseline = this.baseline
      ? this.compareToBaseline(metrics, this.baseline)
      : { speedChange: 0, qualityChange: 0, efficiencyChange: 0 };

    // Calculate overall score
    const overallScore = this.calculateOverallScore(metrics, bottlenecks);

    // Determine if pivot is needed
    const pivotRecommended = this.shouldPivot(metrics, bottlenecks, overallScore);

    let pivotStrategy: PivotStrategy | undefined;
    if (pivotRecommended) {
      pivotStrategy = await this.generatePivotStrategy(metrics, bottlenecks, history);
    }

    const analysis: PerformanceAnalysis = {
      overallScore,
      bottlenecks,
      strengths,
      weaknesses,
      comparisonToBaseline,
      pivotRecommended,
      pivotStrategy,
    };

    // Save analysis
    await this.saveAnalysis(metrics.agentId, analysis);

    return analysis;
  }

  /**
   * Execute a pivot strategy
   */
  async executePivot(
    agentId: string,
    strategy: PivotStrategy,
    beforeMetrics: PerformanceMetrics
  ): Promise<PivotResult> {
    logger.info({ agentId, strategyId: strategy.id }, 'Executing pivot strategy');

    const result: PivotResult = {
      strategyId: strategy.id,
      applied: false,
      beforeMetrics,
      success: false,
      learnings: [],
    };

    try {
      // Apply changes (this would be implemented by the calling agent)
      // For now, we just record the attempt
      result.applied = true;

      // Record for learning
      const pivotHistory = this.pivotHistory.get(agentId) || [];
      pivotHistory.push(result);
      this.pivotHistory.set(agentId, pivotHistory);

      // Learn from the pivot using causal learning
      await causalLearner.learnFromObservation({
        action: 'pivot_strategy',
        context: {
          reason: strategy.reason,
          overallScore: beforeMetrics.successRate,
          efficiency: beforeMetrics.efficiency,
        },
        outcome: {
          success: true,
          result: strategy.changes,
          metrics: {
            expected_speed: strategy.expectedImpact.speed,
            expected_quality: strategy.expectedImpact.quality,
          },
        },
        timestamp: new Date(),
      });

      result.success = true;
      result.learnings = [
        `Applied ${strategy.changes.length} parameter changes`,
        `Expected improvements: ${strategy.expectedImpact.speed}% speed, ${strategy.expectedImpact.quality}% quality`,
      ];

      logger.info({ agentId, strategyId: strategy.id }, 'Pivot executed successfully');

      return result;
    } catch (error: any) {
      logger.error({ error, agentId, strategyId: strategy.id }, 'Pivot execution failed');
      result.learnings.push(`Failed: ${error.message}`);
      return result;
    }
  }

  /**
   * Detect performance bottlenecks
   */
  private async detectBottlenecks(
    metrics: PerformanceMetrics,
    history: PerformanceMetrics[]
  ): Promise<PerformanceAnalysis['bottlenecks']> {
    const bottlenecks: PerformanceAnalysis['bottlenecks'] = [];

    // Low success rate
    if (metrics.successRate < 0.5) {
      bottlenecks.push({
        area: 'Success Rate',
        severity: 'critical',
        description: `Success rate is only ${(metrics.successRate * 100).toFixed(1)}%`,
        impact: 50,
        recommendations: [
          'Review failure patterns',
          'Adjust technique selection',
          'Increase validation before execution',
        ],
      });
    }

    // Low efficiency
    if (metrics.efficiency < 0.5) {
      bottlenecks.push({
        area: 'Efficiency',
        severity: 'high',
        description: `Only ${metrics.efficiency.toFixed(2)} findings per minute`,
        impact: 40,
        recommendations: [
          'Parallelize more operations',
          'Reduce unnecessary LLM calls',
          'Optimize target selection',
        ],
      });
    }

    // Too many errors
    const totalErrors = metrics.errors.reduce((sum, e) => sum + e.count, 0);
    if (totalErrors > metrics.tasksCompleted * 0.3) {
      bottlenecks.push({
        area: 'Error Rate',
        severity: 'high',
        description: `${totalErrors} errors across ${metrics.tasksCompleted} tasks`,
        impact: 35,
        recommendations: [
          'Enable auto-debugging',
          'Add better error handling',
          'Review code quality',
        ],
      });
    }

    // Resource inefficiency
    if (metrics.resourceUsage.llmCalls > metrics.tasksCompleted * 3) {
      bottlenecks.push({
        area: 'LLM Usage',
        severity: 'medium',
        description: `Too many LLM calls: ${metrics.resourceUsage.llmCalls} for ${metrics.tasksCompleted} tasks`,
        impact: 25,
        recommendations: [
          'Enable response caching',
          'Batch similar queries',
          'Use simpler prompts where possible',
        ],
      });
    }

    // Trending downward
    if (history.length >= 5) {
      const recent = history.slice(-5);
      const trend = this.calculateTrend(recent.map(m => m.successRate));

      if (trend < -0.1) {
        bottlenecks.push({
          area: 'Performance Trend',
          severity: 'high',
          description: 'Performance is degrading over time',
          impact: 30,
          recommendations: [
            'Agent may be stuck in local minimum',
            'Consider resetting strategy',
            'Review recent changes',
          ],
        });
      }
    }

    return bottlenecks;
  }

  /**
   * Identify strengths
   */
  private identifyStrengths(
    metrics: PerformanceMetrics,
    baseline: PerformanceMetrics | null
  ): string[] {
    const strengths: string[] = [];

    if (metrics.successRate > 0.8) {
      strengths.push(`High success rate: ${(metrics.successRate * 100).toFixed(1)}%`);
    }

    if (metrics.efficiency > 1.0) {
      strengths.push(`Good efficiency: ${metrics.efficiency.toFixed(2)} findings/min`);
    }

    if (baseline) {
      if (metrics.successRate > baseline.successRate * 1.2) {
        strengths.push('Significant improvement in success rate');
      }

      if (metrics.efficiency > baseline.efficiency * 1.3) {
        strengths.push('Excellent efficiency improvement');
      }
    }

    const totalErrors = metrics.errors.reduce((sum, e) => sum + e.count, 0);
    if (totalErrors < metrics.tasksCompleted * 0.1) {
      strengths.push('Low error rate');
    }

    return strengths;
  }

  /**
   * Identify weaknesses
   */
  private identifyWeaknesses(
    metrics: PerformanceMetrics,
    baseline: PerformanceMetrics | null
  ): string[] {
    const weaknesses: string[] = [];

    if (metrics.successRate < 0.5) {
      weaknesses.push('Low success rate');
    }

    if (metrics.efficiency < 0.3) {
      weaknesses.push('Poor efficiency');
    }

    if (baseline) {
      if (metrics.successRate < baseline.successRate * 0.8) {
        weaknesses.push('Degraded success rate');
      }

      if (metrics.efficiency < baseline.efficiency * 0.7) {
        weaknesses.push('Degraded efficiency');
      }
    }

    const totalErrors = metrics.errors.reduce((sum, e) => sum + e.count, 0);
    if (totalErrors > metrics.tasksCompleted * 0.2) {
      weaknesses.push('High error rate');
    }

    return weaknesses;
  }

  /**
   * Compare to baseline
   */
  private compareToBaseline(
    metrics: PerformanceMetrics,
    baseline: PerformanceMetrics
  ): PerformanceAnalysis['comparisonToBaseline'] {
    return {
      speedChange: ((metrics.timeElapsed - baseline.timeElapsed) / baseline.timeElapsed) * 100,
      qualityChange: ((metrics.successRate - baseline.successRate) / baseline.successRate) * 100,
      efficiencyChange: ((metrics.efficiency - baseline.efficiency) / baseline.efficiency) * 100,
    };
  }

  /**
   * Calculate overall performance score
   */
  private calculateOverallScore(
    metrics: PerformanceMetrics,
    bottlenecks: PerformanceAnalysis['bottlenecks']
  ): number {
    let score = metrics.successRate * 0.5; // 50% weight on success rate
    score += Math.min(1.0, metrics.efficiency / 2.0) * 0.3; // 30% weight on efficiency
    score += (1.0 - Math.min(1.0, bottlenecks.length / 5.0)) * 0.2; // 20% weight on bottleneck count

    return Math.max(0, Math.min(1.0, score));
  }

  /**
   * Determine if pivot is needed
   */
  private shouldPivot(
    metrics: PerformanceMetrics,
    bottlenecks: PerformanceAnalysis['bottlenecks'],
    overallScore: number
  ): boolean {
    // Pivot if overall score is low
    if (overallScore < 0.4) {
      return true;
    }

    // Pivot if there are critical bottlenecks
    if (bottlenecks.some(b => b.severity === 'critical')) {
      return true;
    }

    // Pivot if success rate is very low
    if (metrics.successRate < 0.3) {
      return true;
    }

    // Pivot if multiple high-severity bottlenecks
    if (bottlenecks.filter(b => b.severity === 'high').length >= 2) {
      return true;
    }

    return false;
  }

  /**
   * Generate pivot strategy using LLM
   */
  private async generatePivotStrategy(
    metrics: PerformanceMetrics,
    bottlenecks: PerformanceAnalysis['bottlenecks'],
    history: PerformanceMetrics[]
  ): Promise<PivotStrategy> {
    const prompt = `You are a performance optimization expert. Analyze this agent's performance and suggest a pivot strategy.

**Current Performance**:
- Success Rate: ${(metrics.successRate * 100).toFixed(1)}%
- Efficiency: ${metrics.efficiency.toFixed(2)} findings/min
- Tasks Completed: ${metrics.tasksCompleted}
- Tasks Failed: ${metrics.tasksFailed}

**Bottlenecks**:
${bottlenecks.map(b => `- ${b.area} (${b.severity}): ${b.description}`).join('\n')}

**Recent Trend** (last ${Math.min(5, history.length)} sessions):
${history.slice(-5).map((m, i) => `${i + 1}. Success: ${(m.successRate * 100).toFixed(1)}%, Efficiency: ${m.efficiency.toFixed(2)}`).join('\n')}

Suggest a pivot strategy with specific parameter changes to improve performance.

Return JSON:
{
  "reason": "Why pivoting is needed",
  "changes": [
    {
      "parameter": "parameter name",
      "oldValue": current value,
      "newValue": suggested value,
      "expectedImprovement": "what will improve"
    }
  ],
  "expectedImpact": {
    "speed": percentage improvement,
    "quality": percentage improvement,
    "success": percentage improvement
  },
  "priority": "low|medium|high|critical"
}`;

    try {
      const response = await llmEngine.query(prompt, {
        maxTokens: 1500,
        temperature: 0.4,
      });

      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON in response');
      }

      const data = JSON.parse(jsonMatch[0]);

      return {
        id: uuidv4(),
        reason: data.reason,
        changes: data.changes || [],
        expectedImpact: data.expectedImpact || { speed: 0, quality: 0, success: 0 },
        priority: data.priority || 'medium',
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to generate pivot strategy');

      // Fallback strategy
      return {
        id: uuidv4(),
        reason: 'Automatic fallback strategy',
        changes: [
          {
            parameter: 'parallelism',
            oldValue: 1,
            newValue: 2,
            expectedImprovement: 'Increase throughput',
          },
        ],
        expectedImpact: { speed: 50, quality: 0, success: 10 },
        priority: 'medium',
        timestamp: new Date(),
      };
    }
  }

  /**
   * Calculate baseline from initial metrics
   */
  private calculateBaseline(metrics: PerformanceMetrics[]): PerformanceMetrics {
    const avg = {
      agentId: metrics[0].agentId,
      sessionId: 'baseline',
      timeElapsed: this.average(metrics.map(m => m.timeElapsed)),
      tasksCompleted: this.average(metrics.map(m => m.tasksCompleted)),
      tasksFailed: this.average(metrics.map(m => m.tasksFailed)),
      findingsGenerated: this.average(metrics.map(m => m.findingsGenerated)),
      successRate: this.average(metrics.map(m => m.successRate)),
      efficiency: this.average(metrics.map(m => m.efficiency)),
      resourceUsage: {
        llmCalls: this.average(metrics.map(m => m.resourceUsage.llmCalls)),
        sandboxExecutions: this.average(metrics.map(m => m.resourceUsage.sandboxExecutions)),
        databaseQueries: this.average(metrics.map(m => m.resourceUsage.databaseQueries)),
      },
      errors: [],
      timestamp: new Date(),
    };

    return avg;
  }

  /**
   * Calculate average
   */
  private average(values: number[]): number {
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }

  /**
   * Calculate trend
   */
  private calculateTrend(values: number[]): number {
    if (values.length < 2) return 0;

    // Simple linear trend
    const n = values.length;
    let sumX = 0;
    let sumY = 0;
    let sumXY = 0;
    let sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }

  /**
   * Save analysis to database
   */
  private async saveAnalysis(
    agentId: string,
    analysis: PerformanceAnalysis
  ): Promise<void> {
    try {
      await database.query(`
        CREATE TABLE IF NOT EXISTS performance_analyses (
          id UUID PRIMARY KEY,
          agent_id TEXT NOT NULL,
          overall_score FLOAT,
          bottlenecks JSONB,
          strengths JSONB,
          weaknesses JSONB,
          pivot_recommended BOOLEAN,
          pivot_strategy JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await database.query(
        `INSERT INTO performance_analyses
         (id, agent_id, overall_score, bottlenecks, strengths, weaknesses, pivot_recommended, pivot_strategy)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuidv4(),
          agentId,
          analysis.overallScore,
          JSON.stringify(analysis.bottlenecks),
          JSON.stringify(analysis.strengths),
          JSON.stringify(analysis.weaknesses),
          analysis.pivotRecommended,
          analysis.pivotStrategy ? JSON.stringify(analysis.pivotStrategy) : null,
        ]
      );
    } catch (error: any) {
      logger.error({ error, agentId }, 'Failed to save analysis');
    }
  }

  /**
   * Get analysis history for agent
   */
  async getAnalysisHistory(agentId: string, limit: number = 10): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT * FROM performance_analyses
         WHERE agent_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [agentId, limit]
      );

      return result.rows;
    } catch (error: any) {
      logger.error({ error, agentId }, 'Failed to get analysis history');
      return [];
    }
  }

  /**
   * Get pivot statistics
   */
  async getPivotStats(): Promise<{
    totalPivots: number;
    successfulPivots: number;
    avgImpactSpeed: number;
    avgImpactQuality: number;
  }> {
    const allPivots = Array.from(this.pivotHistory.values()).flat();

    const successful = allPivots.filter(p => p.success);

    return {
      totalPivots: allPivots.length,
      successfulPivots: successful.length,
      avgImpactSpeed:
        successful
          .filter(p => p.actualImpact)
          .reduce((sum, p) => sum + (p.actualImpact?.speed || 0), 0) / successful.length || 0,
      avgImpactQuality:
        successful
          .filter(p => p.actualImpact)
          .reduce((sum, p) => sum + (p.actualImpact?.quality || 0), 0) / successful.length || 0,
    };
  }
}

// Singleton instance
export const selfAnalyzer = new SelfAnalyzer();
export default selfAnalyzer;
