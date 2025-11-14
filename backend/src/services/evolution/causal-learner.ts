/**
 * Causal Learning System (AIRIS-style)
 *
 * Learns cause-effect relationships from actions and outcomes
 * Builds symbolic representation of causality
 * Features:
 * - Rule discovery from observations
 * - Confidence-based rule weighting
 * - Transfer learning across contexts
 * - Predictive modeling
 * - Continuous rule refinement
 */

import logger from '../../utils/logger';
import database from '../database';
import { v4 as uuidv4 } from 'uuid';

export interface CausalObservation {
  action: string;
  context: Record<string, any>;
  outcome: {
    success: boolean;
    result: any;
    metrics?: Record<string, number>;
  };
  timestamp: Date;
}

export interface CausalRule {
  id: string;
  condition: string; // Symbolic representation
  action: string;
  effect: string;
  confidence: number; // 0.0-1.0
  supportCount: number; // How many times observed
  contradictionCount: number; // How many times contradicted
  context: string[]; // Context tags
  priority: number; // For conflict resolution
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt: Date;
}

export interface CausalPrediction {
  action: string;
  predictedOutcome: string;
  confidence: number;
  supportingRules: CausalRule[];
  alternativeOutcomes: Array<{
    outcome: string;
    probability: number;
    rules: CausalRule[];
  }>;
}

export class CausalLearner {
  private rules: Map<string, CausalRule> = new Map();
  private observations: CausalObservation[] = [];
  private learningRate = 0.1;
  private minConfidence = 0.6;

  constructor() {
    this.loadRules();
  }

  /**
   * Learn from a new observation
   * Updates existing rules or creates new ones
   */
  async learnFromObservation(observation: CausalObservation): Promise<void> {
    logger.debug({ action: observation.action }, 'Learning from observation');

    // Store observation
    this.observations.push(observation);
    if (this.observations.length > 1000) {
      this.observations.shift(); // Keep last 1000
    }

    // Extract features from context and outcome
    const condition = this.extractCondition(observation.context);
    const effect = this.extractEffect(observation.outcome);

    // Find matching or similar rules
    const matchingRules = this.findMatchingRules(
      condition,
      observation.action,
      effect
    );

    if (matchingRules.length > 0) {
      // Update existing rules
      for (const rule of matchingRules) {
        await this.updateRule(rule, observation);
      }
    } else {
      // Create new rule
      await this.createRule(condition, observation.action, effect, observation);
    }

    // Prune low-confidence rules periodically
    if (this.rules.size > 500) {
      await this.pruneRules();
    }
  }

  /**
   * Predict outcome of an action in given context
   */
  async predictOutcome(
    action: string,
    context: Record<string, any>
  ): Promise<CausalPrediction> {
    const condition = this.extractCondition(context);

    // Find applicable rules
    const applicableRules = this.findApplicableRules(condition, action);

    if (applicableRules.length === 0) {
      return {
        action,
        predictedOutcome: 'unknown',
        confidence: 0,
        supportingRules: [],
        alternativeOutcomes: [],
      };
    }

    // Group rules by effect
    const effectGroups = new Map<string, CausalRule[]>();
    applicableRules.forEach(rule => {
      const existing = effectGroups.get(rule.effect) || [];
      existing.push(rule);
      effectGroups.set(rule.effect, existing);
    });

    // Calculate confidence for each outcome
    const outcomes: Array<{
      outcome: string;
      probability: number;
      rules: CausalRule[];
    }> = [];

    for (const [effect, rules] of effectGroups.entries()) {
      const avgConfidence =
        rules.reduce((sum, r) => sum + r.confidence, 0) / rules.length;
      const totalSupport = rules.reduce((sum, r) => sum + r.supportCount, 0);

      outcomes.push({
        outcome: effect,
        probability: avgConfidence * (totalSupport / (totalSupport + 1)), // Weighted by evidence
        rules,
      });
    }

    // Sort by probability
    outcomes.sort((a, b) => b.probability - a.probability);

    const mostLikely = outcomes[0];
    const alternatives = outcomes.slice(1);

    return {
      action,
      predictedOutcome: mostLikely.outcome,
      confidence: mostLikely.probability,
      supportingRules: mostLikely.rules,
      alternativeOutcomes: alternatives,
    };
  }

  /**
   * Get recommended actions for achieving a goal
   */
  async recommendActions(
    desiredOutcome: string,
    context: Record<string, any>
  ): Promise<Array<{
    action: string;
    confidence: number;
    rules: CausalRule[];
  }>> {
    const condition = this.extractCondition(context);

    // Find rules that lead to desired outcome
    const relevantRules = Array.from(this.rules.values()).filter(
      rule =>
        rule.effect.includes(desiredOutcome) &&
        rule.confidence >= this.minConfidence &&
        this.conditionMatches(condition, rule.condition)
    );

    // Group by action
    const actionGroups = new Map<string, CausalRule[]>();
    relevantRules.forEach(rule => {
      const existing = actionGroups.get(rule.action) || [];
      existing.push(rule);
      actionGroups.set(rule.action, existing);
    });

    // Calculate confidence per action
    const recommendations: Array<{
      action: string;
      confidence: number;
      rules: CausalRule[];
    }> = [];

    for (const [action, rules] of actionGroups.entries()) {
      const avgConfidence =
        rules.reduce((sum, r) => sum + r.confidence, 0) / rules.length;

      recommendations.push({
        action,
        confidence: avgConfidence,
        rules,
      });
    }

    // Sort by confidence
    recommendations.sort((a, b) => b.confidence - a.confidence);

    return recommendations;
  }

  /**
   * Extract symbolic condition from context
   */
  private extractCondition(context: Record<string, any>): string {
    // Convert context to symbolic representation
    const features: string[] = [];

    for (const [key, value] of Object.entries(context)) {
      if (typeof value === 'boolean') {
        features.push(value ? key : `!${key}`);
      } else if (typeof value === 'number') {
        if (value > 0) features.push(`${key}>0`);
        if (value < 0) features.push(`${key}<0`);
        if (value === 0) features.push(`${key}=0`);
      } else if (typeof value === 'string') {
        features.push(`${key}=${value}`);
      } else if (Array.isArray(value)) {
        if (value.length > 0) features.push(`has_${key}`);
      }
    }

    return features.sort().join(' AND ');
  }

  /**
   * Extract symbolic effect from outcome
   */
  private extractEffect(outcome: {
    success: boolean;
    result: any;
    metrics?: Record<string, number>;
  }): string {
    const effects: string[] = [];

    effects.push(outcome.success ? 'SUCCESS' : 'FAILURE');

    if (outcome.metrics) {
      for (const [metric, value] of Object.entries(outcome.metrics)) {
        if (value > 0) effects.push(`${metric}_INCREASE`);
        if (value < 0) effects.push(`${metric}_DECREASE`);
      }
    }

    // Try to extract result type
    if (outcome.result) {
      if (Array.isArray(outcome.result)) {
        effects.push(`RESULT_COUNT:${outcome.result.length}`);
      } else if (typeof outcome.result === 'object') {
        effects.push('RESULT_OBJECT');
      }
    }

    return effects.join(' AND ');
  }

  /**
   * Find rules matching condition, action, and effect
   */
  private findMatchingRules(
    condition: string,
    action: string,
    effect: string
  ): CausalRule[] {
    return Array.from(this.rules.values()).filter(
      rule =>
        rule.action === action &&
        this.conditionSimilarity(rule.condition, condition) > 0.7 &&
        this.effectSimilarity(rule.effect, effect) > 0.7
    );
  }

  /**
   * Find rules applicable to current context
   */
  private findApplicableRules(condition: string, action: string): CausalRule[] {
    return Array.from(this.rules.values()).filter(
      rule =>
        rule.action === action &&
        rule.confidence >= this.minConfidence &&
        this.conditionMatches(condition, rule.condition)
    );
  }

  /**
   * Check if condition matches rule condition
   */
  private conditionMatches(condition: string, ruleCondition: string): boolean {
    return this.conditionSimilarity(condition, ruleCondition) > 0.6;
  }

  /**
   * Calculate similarity between conditions
   */
  private conditionSimilarity(cond1: string, cond2: string): number {
    const features1 = new Set(cond1.split(' AND '));
    const features2 = new Set(cond2.split(' AND '));

    const intersection = new Set(
      [...features1].filter(f => features2.has(f))
    );
    const union = new Set([...features1, ...features2]);

    return intersection.size / union.size; // Jaccard similarity
  }

  /**
   * Calculate similarity between effects
   */
  private effectSimilarity(effect1: string, effect2: string): number {
    const parts1 = new Set(effect1.split(' AND '));
    const parts2 = new Set(effect2.split(' AND '));

    const intersection = new Set(
      [...parts1].filter(p => parts2.has(p))
    );

    return intersection.size / Math.max(parts1.size, parts2.size);
  }

  /**
   * Update existing rule with new observation
   */
  private async updateRule(
    rule: CausalRule,
    observation: CausalObservation
  ): Promise<void> {
    const effect = this.extractEffect(observation.outcome);

    if (this.effectSimilarity(rule.effect, effect) > 0.7) {
      // Observation supports the rule
      rule.supportCount++;

      // Update confidence (incremental learning)
      const successRate = rule.supportCount / (rule.supportCount + rule.contradictionCount);
      rule.confidence = rule.confidence + this.learningRate * (successRate - rule.confidence);
    } else {
      // Observation contradicts the rule
      rule.contradictionCount++;

      // Decrease confidence
      const successRate = rule.supportCount / (rule.supportCount + rule.contradictionCount);
      rule.confidence = rule.confidence + this.learningRate * (successRate - rule.confidence);
    }

    rule.lastSeenAt = new Date();
    rule.updatedAt = new Date();

    await this.saveRule(rule);
  }

  /**
   * Create new causal rule
   */
  private async createRule(
    condition: string,
    action: string,
    effect: string,
    observation: CausalObservation
  ): Promise<CausalRule> {
    const rule: CausalRule = {
      id: uuidv4(),
      condition,
      action,
      effect,
      confidence: 0.7, // Initial confidence
      supportCount: 1,
      contradictionCount: 0,
      context: Object.keys(observation.context),
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSeenAt: new Date(),
    };

    this.rules.set(rule.id, rule);
    await this.saveRule(rule);

    logger.info({ ruleId: rule.id, action, effect }, 'Created new causal rule');

    return rule;
  }

  /**
   * Prune low-confidence rules
   */
  private async pruneRules(): Promise<void> {
    const rulesToRemove: string[] = [];

    for (const [id, rule] of this.rules.entries()) {
      // Remove rules with very low confidence
      if (rule.confidence < 0.3) {
        rulesToRemove.push(id);
      }

      // Remove rules not seen in a long time with low support
      const daysSinceLastSeen =
        (Date.now() - rule.lastSeenAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLastSeen > 30 && rule.supportCount < 5) {
        rulesToRemove.push(id);
      }
    }

    for (const id of rulesToRemove) {
      this.rules.delete(id);
    }

    if (rulesToRemove.length > 0) {
      logger.info({ pruned: rulesToRemove.length }, 'Pruned low-confidence rules');
    }
  }

  /**
   * Save rule to database
   */
  private async saveRule(rule: CausalRule): Promise<void> {
    try {
      await database.query(`
        CREATE TABLE IF NOT EXISTS causal_rules (
          id UUID PRIMARY KEY,
          condition TEXT,
          action TEXT,
          effect TEXT,
          confidence FLOAT,
          support_count INTEGER,
          contradiction_count INTEGER,
          context JSONB,
          priority INTEGER,
          created_at TIMESTAMP,
          updated_at TIMESTAMP,
          last_seen_at TIMESTAMP
        )
      `);

      await database.query(
        `INSERT INTO causal_rules
         (id, condition, action, effect, confidence, support_count, contradiction_count, context, priority, created_at, updated_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (id)
         DO UPDATE SET
           confidence = $5,
           support_count = $6,
           contradiction_count = $7,
           updated_at = $11,
           last_seen_at = $12`,
        [
          rule.id,
          rule.condition,
          rule.action,
          rule.effect,
          rule.confidence,
          rule.supportCount,
          rule.contradictionCount,
          JSON.stringify(rule.context),
          rule.priority,
          rule.createdAt,
          rule.updatedAt,
          rule.lastSeenAt,
        ]
      );
    } catch (error: any) {
      logger.error({ error, ruleId: rule.id }, 'Failed to save causal rule');
    }
  }

  /**
   * Load rules from database
   */
  private async loadRules(): Promise<void> {
    try {
      const result = await database.query(`
        SELECT * FROM causal_rules
        WHERE confidence >= $1
        ORDER BY confidence DESC, last_seen_at DESC
        LIMIT 500
      `, [this.minConfidence]);

      result.rows.forEach(row => {
        const rule: CausalRule = {
          id: row.id,
          condition: row.condition,
          action: row.action,
          effect: row.effect,
          confidence: row.confidence,
          supportCount: row.support_count,
          contradictionCount: row.contradiction_count,
          context: row.context || [],
          priority: row.priority,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          lastSeenAt: row.last_seen_at,
        };

        this.rules.set(rule.id, rule);
      });

      logger.info({ rulesLoaded: this.rules.size }, 'Causal rules loaded');
    } catch (error: any) {
      logger.debug({ error }, 'No causal rules loaded (table may not exist yet)');
    }
  }

  /**
   * Export rules for analysis
   */
  exportRules(): CausalRule[] {
    return Array.from(this.rules.values())
      .filter(r => r.confidence >= this.minConfidence)
      .sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Get learning statistics
   */
  async getStats(): Promise<{
    totalRules: number;
    avgConfidence: number;
    byAction: Record<string, number>;
    topRules: Array<{
      action: string;
      effect: string;
      confidence: number;
      support: number;
    }>;
  }> {
    const rules = Array.from(this.rules.values());

    const byAction: Record<string, number> = {};
    rules.forEach(r => {
      byAction[r.action] = (byAction[r.action] || 0) + 1;
    });

    const topRules = rules
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
      .map(r => ({
        action: r.action,
        effect: r.effect,
        confidence: r.confidence,
        support: r.supportCount,
      }));

    return {
      totalRules: rules.length,
      avgConfidence:
        rules.reduce((sum, r) => sum + r.confidence, 0) / rules.length || 0,
      byAction,
      topRules,
    };
  }

  /**
   * Clear all rules (for testing)
   */
  async clearRules(): Promise<void> {
    this.rules.clear();
    this.observations = [];
    logger.warn('All causal rules cleared');
  }
}

// Singleton instance
export const causalLearner = new CausalLearner();
export default causalLearner;
