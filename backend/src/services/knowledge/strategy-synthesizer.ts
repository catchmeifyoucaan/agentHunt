import { AgentFeedback, AgentType } from '../../../../shared/agent-collaboration.types';
import { StrategyKnowledge, KnowledgeEntry } from './types';
import knowledgeStore from './knowledge-store';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { dynamicRouter } from '../dynamic-handoff-router';

interface StrategyPattern {
  trigger: string;
  actionChain: { agent: string; action: string }[];
  successCount: number;
  contexts: any[];
}

class StrategySynthesizer {
  private patternCache: Map<string, StrategyPattern> = new Map();
  private readonly PATTERN_THRESHOLD = 3; // Number of successes to form a strategy

  /**
   * Analyze feedback to detect and synthesize new strategies
   */
  async analyzeFeedback(feedback: AgentFeedback): Promise<void> {
    // Only learn from success
    if (feedback.feedbackType !== 'success') return;

    try {
      const patternKey = this.generatePatternKey(feedback);
      const pattern = this.updatePattern(patternKey, feedback);

      if (pattern.successCount >= this.PATTERN_THRESHOLD) {
        await this.synthesizeStrategy(pattern);
        this.patternCache.delete(patternKey); // Reset after synthesis
      }
    } catch (error) {
      logger.error({ error, feedbackId: feedback.id }, 'Failed to analyze strategy pattern');
    }
  }

  /**
   * Generate a unique key for a potential strategy pattern
   */
  private generatePatternKey(feedback: AgentFeedback): string {
    // Pattern based on Trigger -> Agent -> Action
    const trigger = feedback.payload.details?.trigger || 'unknown';
    const action = feedback.payload.details?.action || 'unknown';
    return `${trigger}:${feedback.from.type}:${action}`;
  }

  /**
   * Update the internal pattern cache with new evidence
   */
  private updatePattern(key: string, feedback: AgentFeedback): StrategyPattern {
    const existing = this.patternCache.get(key) || {
      trigger: feedback.payload.details?.trigger || 'unknown',
      actionChain: [
        { agent: feedback.from.type, action: feedback.payload.details?.action || 'unknown' },
      ],
      successCount: 0,
      contexts: [],
    };

    existing.successCount++;
    existing.contexts.push(feedback.payload.details?.context || {});
    
    // Keep context window small
    if (existing.contexts.length > 5) existing.contexts.shift();

    this.patternCache.set(key, existing);
    return existing;
  }

  /**
   * Convert a validated pattern into a formal Strategy Knowledge entry
   */
  private async synthesizeStrategy(pattern: StrategyPattern): Promise<string> {
    const title = `Auto-Synthesized Strategy: ${pattern.trigger} -> ${pattern.actionChain[0].action}`;
    
    const strategy: Omit<StrategyKnowledge, 'id' | 'createdAt' | 'updatedAt' | 'timesUsed' | 'successRate'> = {
      type: 'strategy',
      title,
      description: `Automatically learned strategy for handling ${pattern.trigger} using ${pattern.actionChain[0].agent}.`,
      content: JSON.stringify(pattern, null, 2),
      source: 'internal',
      tags: ['auto-generated', 'strategy', pattern.actionChain[0].agent, pattern.trigger],
      trigger: pattern.trigger,
      confidence: 0.7, // Initial confidence
      steps: pattern.actionChain.map(step => ({
        agent: step.agent,
        action: step.action,
        expectedOutcome: 'success'
      })),
      prerequisites: [],
      relatedTechniques: [],
      successes: pattern.successCount,
      failures: 0
    };

    // Store in Knowledge Base
    // Note: We cast to any because addEntry expects KnowledgeEntry but we are sending StrategyKnowledge
    // The KnowledgeStore will need to be updated to handle StrategyKnowledge specific fields in a real DB schema
    // For now, we treat it as a generic entry with extended metadata in content/description
    const id = await knowledgeStore.addEntry(strategy as any);

    logger.info({ strategyId: id, title }, '✨ NEW STRATEGY SYNTHESIZED ✨');

    // Proactively notify relevant agents
    await this.propagateStrategy(id, pattern.actionChain[0].agent);

    return id;
  }

  /**
   * Notify agents about a new strategy
   */
  private async propagateStrategy(strategyId: string, targetAgent: string): Promise<void> {
    // We use the dynamic router to "broadcast" this new knowledge
    // This effectively simulates "teaching" the agent
    await dynamicRouter.publishSignal({
      sourceAgent: 'manager', // System message
      programId: 'global', // Global knowledge
      jobId: uuidv4(),
      signalType: 'strategy_update', // New signal type for learning
      data: {
        strategyId,
        targetAgent,
        message: 'New successful strategy learned. Update your tactics.'
      },
      confidence: 1.0
    });
  }
}

export default new StrategySynthesizer();
