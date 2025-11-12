/**
 * Shared Knowledge Base - Phase 4: Graph of Agents
 *
 * Central knowledge repository for multi-agent coordination:
 * - Discovery sharing (agent A finds WordPress → agent B uses specialized WP scans)
 * - Strategy sharing (agent learns successful attack → shares with others)
 * - Metadata caching (technologies, CDN, WAF detection)
 * - Agent communication and notifications
 *
 * Enables agents to learn from each other and coordinate intelligently.
 */

import logger from '../utils/logger';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import events from '../services/events';
import database from '../config/database';

/**
 * Discovery shared by an agent
 */
export interface Discovery {
  id: string;
  target: string; // Target URL/domain
  type: string; // 'wordpress_vuln', 'api_endpoint', 'technology', etc.
  details: Record<string, any>; // Discovery-specific data
  discoveredBy: string; // Agent ID
  timestamp: Date;
  confidence: number; // 0.0-1.0
  metadata?: Record<string, any>;
}

/**
 * Attack strategy shared by an agent
 */
export interface Strategy {
  id: string;
  type: string; // 'sqli', 'xss', 'rce', etc.
  technique: string; // Specific technique used
  payload: string; // Payload that worked
  successCount: number; // Times this strategy succeeded
  attemptCount: number; // Total attempts
  successRate: number; // successCount / attemptCount
  sharedBy: string; // Agent ID
  timestamp: Date;
  targetPattern?: string; // Target URL pattern (e.g., '*/admin/*')
  metadata?: Record<string, any>;
}

/**
 * Target metadata
 */
export interface TargetMetadata {
  target: string;
  technologies?: string[]; // ['WordPress', 'PHP', 'MySQL']
  waf?: string; // 'Cloudflare', 'Akamai', etc.
  cdn?: string; // CDN provider
  httpStatus?: number;
  responseTime?: number;
  lastChecked?: Date;
  customData?: Record<string, any>;
}

/**
 * SharedKnowledgeBase - Central repository for agent knowledge
 */
export class SharedKnowledgeBase {
  private discoveries: Map<string, Discovery> = new Map();
  private strategies: Map<string, Strategy> = new Map();
  private metadata: Map<string, TargetMetadata> = new Map();
  private tracer = trace.getTracer('agenthunt-knowledge-base');

  constructor() {
    logger.info('Shared knowledge base initialized');
  }

  /**
   * Share a discovery with all agents
   */
  async shareDiscovery(agentId: string, discovery: Omit<Discovery, 'id' | 'discoveredBy' | 'timestamp'>): Promise<string> {
    const span = this.tracer.startSpan('kb.share_discovery', {
      attributes: {
        'kb.agent_id': agentId,
        'kb.discovery_type': discovery.type,
        'kb.target': discovery.target,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const id = `${discovery.target}:${discovery.type}:${Date.now()}`;

        const fullDiscovery: Discovery = {
          id,
          ...discovery,
          discoveredBy: agentId,
          timestamp: new Date(),
        };

        // Store in memory
        this.discoveries.set(id, fullDiscovery);

        // Persist to database
        await this.persistDiscovery(fullDiscovery);

        // Notify other agents
        await this.notifyAgents(agentId, fullDiscovery);

        span.setAttributes({
          'kb.discovery_id': id,
          'kb.confidence': discovery.confidence,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        logger.info(
          {
            agentId,
            discoveryType: discovery.type,
            target: discovery.target,
            confidence: discovery.confidence,
          },
          'Discovery shared with knowledge base'
        );

        return id;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        logger.error({ error, agentId }, 'Failed to share discovery');
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get discoveries for a target
   */
  async getDiscoveries(target: string, type?: string): Promise<Discovery[]> {
    let discoveries = Array.from(this.discoveries.values()).filter((d) => d.target === target);

    if (type) {
      discoveries = discoveries.filter((d) => d.type === type);
    }

    // Sort by timestamp (newest first)
    discoveries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return discoveries;
  }

  /**
   * Share a successful attack strategy
   */
  async shareStrategy(
    agentId: string,
    strategy: Omit<Strategy, 'id' | 'sharedBy' | 'timestamp' | 'successRate'>
  ): Promise<string> {
    const span = this.tracer.startSpan('kb.share_strategy', {
      attributes: {
        'kb.agent_id': agentId,
        'kb.strategy_type': strategy.type,
        'kb.success_count': strategy.successCount,
        'kb.attempt_count': strategy.attemptCount,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const id = `${strategy.type}:${strategy.technique}:${Date.now()}`;

        const fullStrategy: Strategy = {
          id,
          ...strategy,
          successRate: strategy.attemptCount > 0 ? strategy.successCount / strategy.attemptCount : 0,
          sharedBy: agentId,
          timestamp: new Date(),
        };

        // Store in memory
        this.strategies.set(id, fullStrategy);

        // Persist to database
        await this.persistStrategy(fullStrategy);

        span.setAttributes({
          'kb.strategy_id': id,
          'kb.success_rate': fullStrategy.successRate,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        logger.info(
          {
            agentId,
            strategyType: strategy.type,
            technique: strategy.technique,
            successRate: fullStrategy.successRate,
          },
          'Strategy shared with knowledge base'
        );

        return id;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        logger.error({ error, agentId }, 'Failed to share strategy');
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get best strategy for a vulnerability type
   */
  async getBestStrategy(vulnType: string, targetPattern?: string): Promise<Strategy | null> {
    let strategies = Array.from(this.strategies.values()).filter((s) => s.type === vulnType);

    // Filter by target pattern if provided
    if (targetPattern) {
      strategies = strategies.filter((s) => !s.targetPattern || s.targetPattern === targetPattern);
    }

    if (strategies.length === 0) {
      return null;
    }

    // Sort by success rate (highest first)
    strategies.sort((a, b) => b.successRate - a.successRate);

    logger.debug(
      {
        vulnType,
        targetPattern,
        bestStrategy: strategies[0].technique,
        successRate: strategies[0].successRate,
      },
      'Retrieved best strategy'
    );

    return strategies[0];
  }

  /**
   * Get all strategies for a vulnerability type
   */
  async getStrategies(vulnType: string): Promise<Strategy[]> {
    const strategies = Array.from(this.strategies.values())
      .filter((s) => s.type === vulnType)
      .sort((a, b) => b.successRate - a.successRate);

    return strategies;
  }

  /**
   * Store/update metadata for a target
   */
  async setMetadata(target: string, metadata: Partial<TargetMetadata>): Promise<void> {
    const existing = this.metadata.get(target) || { target };

    const updated: TargetMetadata = {
      ...existing,
      ...metadata,
      target,
      lastChecked: new Date(),
    };

    this.metadata.set(target, updated);

    logger.debug({ target, metadata }, 'Target metadata updated');
  }

  /**
   * Get metadata for a target
   */
  async getMetadata(target: string): Promise<TargetMetadata | null> {
    return this.metadata.get(target) || null;
  }

  /**
   * Batch update metadata for multiple targets
   */
  async batchSetMetadata(updates: Array<{ target: string; metadata: Partial<TargetMetadata> }>): Promise<void> {
    for (const update of updates) {
      await this.setMetadata(update.target, update.metadata);
    }

    logger.info({ count: updates.length }, 'Batch metadata update completed');
  }

  /**
   * Notify agents about a discovery
   */
  private async notifyAgents(sourceAgent: string, discovery: Discovery): Promise<void> {
    try {
      // Emit event to all listening agents
      await events.emit('agent:discovery', {
        type: 'agent_discovery',
        sourceAgent,
        discovery,
      });

      logger.debug(
        {
          sourceAgent,
          discoveryType: discovery.type,
          target: discovery.target,
        },
        'Discovery notification sent to agents'
      );
    } catch (error: any) {
      logger.error({ error, sourceAgent }, 'Failed to notify agents about discovery');
    }
  }

  /**
   * Persist discovery to database
   */
  private async persistDiscovery(discovery: Discovery): Promise<void> {
    try {
      // Create table if not exists
      await database.query(`
        CREATE TABLE IF NOT EXISTS agent_discoveries (
          id VARCHAR(255) PRIMARY KEY,
          target TEXT NOT NULL,
          type VARCHAR(100) NOT NULL,
          details JSONB NOT NULL,
          discovered_by VARCHAR(100) NOT NULL,
          timestamp TIMESTAMP NOT NULL,
          confidence DECIMAL(3,2) NOT NULL,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert discovery
      await database.query(
        `INSERT INTO agent_discoveries (id, target, type, details, discovered_by, timestamp, confidence, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO UPDATE SET
         details = EXCLUDED.details,
         confidence = EXCLUDED.confidence,
         metadata = EXCLUDED.metadata`,
        [
          discovery.id,
          discovery.target,
          discovery.type,
          JSON.stringify(discovery.details),
          discovery.discoveredBy,
          discovery.timestamp,
          discovery.confidence,
          discovery.metadata ? JSON.stringify(discovery.metadata) : null,
        ]
      );
    } catch (error: any) {
      logger.error({ error, discoveryId: discovery.id }, 'Failed to persist discovery');
      // Don't throw - persistence failure shouldn't break the system
    }
  }

  /**
   * Persist strategy to database
   */
  private async persistStrategy(strategy: Strategy): Promise<void> {
    try {
      // Create table if not exists
      await database.query(`
        CREATE TABLE IF NOT EXISTS agent_strategies (
          id VARCHAR(255) PRIMARY KEY,
          type VARCHAR(100) NOT NULL,
          technique VARCHAR(255) NOT NULL,
          payload TEXT NOT NULL,
          success_count INTEGER NOT NULL,
          attempt_count INTEGER NOT NULL,
          success_rate DECIMAL(5,4) NOT NULL,
          shared_by VARCHAR(100) NOT NULL,
          timestamp TIMESTAMP NOT NULL,
          target_pattern TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert strategy
      await database.query(
        `INSERT INTO agent_strategies (id, type, technique, payload, success_count, attempt_count, success_rate, shared_by, timestamp, target_pattern, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (id) DO UPDATE SET
         success_count = EXCLUDED.success_count,
         attempt_count = EXCLUDED.attempt_count,
         success_rate = EXCLUDED.success_rate,
         metadata = EXCLUDED.metadata`,
        [
          strategy.id,
          strategy.type,
          strategy.technique,
          strategy.payload,
          strategy.successCount,
          strategy.attemptCount,
          strategy.successRate,
          strategy.sharedBy,
          strategy.timestamp,
          strategy.targetPattern,
          strategy.metadata ? JSON.stringify(strategy.metadata) : null,
        ]
      );
    } catch (error: any) {
      logger.error({ error, strategyId: strategy.id }, 'Failed to persist strategy');
      // Don't throw - persistence failure shouldn't break the system
    }
  }

  /**
   * Get statistics about knowledge base
   */
  getStatistics(): {
    discoveries: { total: number; byType: Record<string, number> };
    strategies: { total: number; byType: Record<string, number>; avgSuccessRate: number };
    metadata: { total: number };
  } {
    const discoveryByType: Record<string, number> = {};
    for (const discovery of this.discoveries.values()) {
      discoveryByType[discovery.type] = (discoveryByType[discovery.type] || 0) + 1;
    }

    const strategyByType: Record<string, number> = {};
    let totalSuccessRate = 0;
    for (const strategy of this.strategies.values()) {
      strategyByType[strategy.type] = (strategyByType[strategy.type] || 0) + 1;
      totalSuccessRate += strategy.successRate;
    }

    return {
      discoveries: {
        total: this.discoveries.size,
        byType: discoveryByType,
      },
      strategies: {
        total: this.strategies.size,
        byType: strategyByType,
        avgSuccessRate: this.strategies.size > 0 ? totalSuccessRate / this.strategies.size : 0,
      },
      metadata: {
        total: this.metadata.size,
      },
    };
  }

  /**
   * Clear all knowledge (for testing)
   */
  clear(): void {
    this.discoveries.clear();
    this.strategies.clear();
    this.metadata.clear();
    logger.info('Knowledge base cleared');
  }
}

export default SharedKnowledgeBase;
