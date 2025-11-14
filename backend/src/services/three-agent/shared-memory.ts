/**
 * Shared Memory System
 * Enables swarm agents to collaborate through Redis pub/sub
 * Real-time coordination without blocking
 */

import Redis from 'ioredis';
import logger from '../../utils/logger';
import config from '../../config';
import {
  Finding,
  Target,
  Technique,
  SwarmMemory,
  SwarmUpdate,
  CoordinationMessage,
} from './types';

class SharedMemory {
  private redis: Redis;
  private pubsub: Redis;
  private subscribers: Map<string, Set<(update: SwarmUpdate) => void>> = new Map();

  constructor() {
    const redisConfig = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      tls: config.redis.tls ? { rejectUnauthorized: false } : undefined,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
    };

    this.redis = new Redis(redisConfig);
    this.pubsub = new Redis(redisConfig); // Separate connection for pub/sub

    this.pubsub.on('message', this.handleMessage.bind(this));

    logger.info({ host: config.redis.host, port: config.redis.port }, 'Shared Memory System initialized with Redis');
  }

  // ==============================================
  // Findings Management
  // ==============================================

  /**
   * Store findings for a swarm
   */
  async storeFindings(swarmId: string, findings: Finding[]): Promise<void> {
    if (findings.length === 0) return;

    try {
      // Store in Redis set (prevents duplicates)
      const findingStrings = findings.map(f => JSON.stringify(f));
      await this.redis.sadd(`swarm:${swarmId}:findings`, ...findingStrings);

      // Publish update
      await this.publishUpdate(swarmId, {
        type: 'new_finding',
        agentId: findings[0].discoveredBy || 'unknown',
        timestamp: new Date(),
        data: {
          count: findings.length,
          critical: findings.filter(f => f.severity === 'critical').length,
          high: findings.filter(f => f.severity === 'high').length,
        },
        priority: findings.some(f => f.severity === 'critical') ? 'critical' : 'medium',
      });

      logger.debug({ swarmId, findingsCount: findings.length }, 'Findings stored');
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to store findings');
      throw error;
    }
  }

  /**
   * Get all findings for a swarm
   */
  async getFindings(swarmId: string): Promise<Finding[]> {
    try {
      const findingStrings = await this.redis.smembers(`swarm:${swarmId}:findings`);
      return findingStrings.map(s => JSON.parse(s));
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to get findings');
      return [];
    }
  }

  /**
   * Get findings count for a swarm
   */
  async getFindingsCount(swarmId: string): Promise<number> {
    try {
      return await this.redis.scard(`swarm:${swarmId}:findings`);
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to get findings count');
      return 0;
    }
  }

  // ==============================================
  // Techniques Sharing
  // ==============================================

  /**
   * Share successful technique with swarm
   * One agent finds working technique → all adopt it
   */
  async shareSuccess(swarmId: string, technique: Technique): Promise<void> {
    try {
      // Store technique in hash
      await this.redis.hset(
        `swarm:${swarmId}:techniques`,
        technique.id,
        JSON.stringify(technique)
      );

      // Publish to all agents
      await this.publishUpdate(swarmId, {
        type: 'successful_technique',
        agentId: 'unknown',
        timestamp: new Date(),
        data: technique,
        priority: 'high',
      });

      logger.info({ swarmId, technique: technique.name }, 'Successful technique shared');
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share technique');
      throw error;
    }
  }

  /**
   * Get all successful techniques for a swarm
   */
  async getTechniques(swarmId: string): Promise<Technique[]> {
    try {
      const techniques = await this.redis.hgetall(`swarm:${swarmId}:techniques`);
      return Object.values(techniques).map(t => JSON.parse(t));
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to get techniques');
      return [];
    }
  }

  /**
   * Record failed attempt (so others don't waste time)
   */
  async recordFailure(
    swarmId: string,
    target: Target,
    technique: string,
    reason: string
  ): Promise<void> {
    try {
      const failure = {
        target,
        technique,
        reason,
        timestamp: new Date(),
      };

      await this.redis.lpush(
        `swarm:${swarmId}:failures`,
        JSON.stringify(failure)
      );

      // Trim to last 1000 failures
      await this.redis.ltrim(`swarm:${swarmId}:failures`, 0, 999);

      logger.debug({ swarmId, target: target.value, technique }, 'Failure recorded');
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to record failure');
    }
  }

  // ==============================================
  // Target Coordination
  // ==============================================

  /**
   * Claim targets atomically (prevent duplicate work)
   * Each agent claims targets they'll work on
   */
  async claimTargets(swarmId: string, agentId: string, targets: Target[]): Promise<Target[]> {
    const claimed: Target[] = [];

    try {
      for (const target of targets) {
        // Try to set key if it doesn't exist (atomic operation)
        const success = await this.redis.setnx(
          `swarm:${swarmId}:claimed:${target.id}`,
          agentId
        );

        if (success) {
          claimed.push(target);
          // Set expiry (10 minutes) in case agent dies
          await this.redis.expire(`swarm:${swarmId}:claimed:${target.id}`, 600);
        }
      }

      logger.debug(
        { swarmId, agentId, requested: targets.length, claimed: claimed.length },
        'Targets claimed'
      );

      return claimed;
    } catch (error: any) {
      logger.error({ error, swarmId, agentId }, 'Failed to claim targets');
      return [];
    }
  }

  /**
   * Release targets (when agent is done or dies)
   */
  async releaseTargets(swarmId: string, targetIds: string[]): Promise<void> {
    try {
      const keys = targetIds.map(id => `swarm:${swarmId}:claimed:${id}`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      logger.debug({ swarmId, count: targetIds.length }, 'Targets released');
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to release targets');
    }
  }

  /**
   * Get claimed targets for a swarm
   */
  async getClaimedTargets(swarmId: string): Promise<Map<string, string>> {
    try {
      const pattern = `swarm:${swarmId}:claimed:*`;
      const keys = await this.redis.keys(pattern);

      const claimed = new Map<string, string>();
      for (const key of keys) {
        const targetId = key.split(':').pop()!;
        const agentId = await this.redis.get(key);
        if (agentId) {
          claimed.set(targetId, agentId);
        }
      }

      return claimed;
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to get claimed targets');
      return new Map();
    }
  }

  // ==============================================
  // Pub/Sub Coordination
  // ==============================================

  /**
   * Subscribe to swarm updates
   */
  async subscribeToUpdates(
    swarmId: string,
    callback: (update: SwarmUpdate) => void
  ): Promise<void> {
    try {
      const channel = `swarm:${swarmId}:updates`;

      // Add callback to subscribers
      if (!this.subscribers.has(channel)) {
        this.subscribers.set(channel, new Set());
        await this.pubsub.subscribe(channel);
      }
      this.subscribers.get(channel)!.add(callback);

      logger.debug({ swarmId }, 'Subscribed to swarm updates');
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to subscribe to updates');
      throw error;
    }
  }

  /**
   * Unsubscribe from swarm updates
   */
  async unsubscribeFromUpdates(
    swarmId: string,
    callback: (update: SwarmUpdate) => void
  ): Promise<void> {
    try {
      const channel = `swarm:${swarmId}:updates`;

      if (this.subscribers.has(channel)) {
        this.subscribers.get(channel)!.delete(callback);

        // If no more subscribers, unsubscribe from channel
        if (this.subscribers.get(channel)!.size === 0) {
          this.subscribers.delete(channel);
          await this.pubsub.unsubscribe(channel);
        }
      }

      logger.debug({ swarmId }, 'Unsubscribed from swarm updates');
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to unsubscribe from updates');
    }
  }

  /**
   * Publish update to swarm
   */
  private async publishUpdate(swarmId: string, update: SwarmUpdate): Promise<void> {
    try {
      const channel = `swarm:${swarmId}:updates`;
      await this.pubsub.publish(channel, JSON.stringify(update));
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to publish update');
    }
  }

  /**
   * Handle incoming pub/sub messages
   */
  private handleMessage(channel: string, message: string): void {
    try {
      const update: SwarmUpdate = JSON.parse(message);

      // Call all subscribers for this channel
      const callbacks = this.subscribers.get(channel);
      if (callbacks) {
        callbacks.forEach(callback => {
          try {
            callback(update);
          } catch (error: any) {
            logger.error({ error, channel }, 'Callback error in handleMessage');
          }
        });
      }
    } catch (error: any) {
      logger.error({ error, channel }, 'Failed to handle message');
    }
  }

  // ==============================================
  // Shared Context
  // ==============================================

  /**
   * Store shared context for swarm
   * E.g., WAF detected, working bypasses, rate limits
   */
  async setContext(swarmId: string, key: string, value: any): Promise<void> {
    try {
      await this.redis.hset(
        `swarm:${swarmId}:context`,
        key,
        JSON.stringify(value)
      );

      // Notify swarm
      await this.publishUpdate(swarmId, {
        type: 'strategy_change',
        agentId: 'system',
        timestamp: new Date(),
        data: { key, value },
        priority: 'medium',
      });
    } catch (error: any) {
      logger.error({ error, swarmId, key }, 'Failed to set context');
    }
  }

  /**
   * Get shared context value
   */
  async getContext(swarmId: string, key: string): Promise<any> {
    try {
      const value = await this.redis.hget(`swarm:${swarmId}:context`, key);
      return value ? JSON.parse(value) : null;
    } catch (error: any) {
      logger.error({ error, swarmId, key }, 'Failed to get context');
      return null;
    }
  }

  /**
   * Get all shared context
   */
  async getAllContext(swarmId: string): Promise<Record<string, any>> {
    try {
      const context = await this.redis.hgetall(`swarm:${swarmId}:context`);
      const result: Record<string, any> = {};

      for (const [key, value] of Object.entries(context)) {
        result[key] = JSON.parse(value);
      }

      return result;
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to get all context');
      return {};
    }
  }

  // ==============================================
  // Cleanup
  // ==============================================

  /**
   * Clear all data for a swarm
   */
  async clearSwarm(swarmId: string): Promise<void> {
    try {
      const pattern = `swarm:${swarmId}:*`;
      const keys = await this.redis.keys(pattern);

      if (keys.length > 0) {
        await this.redis.del(...keys);
      }

      logger.info({ swarmId, keysDeleted: keys.length }, 'Swarm memory cleared');
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to clear swarm');
    }
  }

  /**
   * Get swarm memory statistics
   */
  async getStats(swarmId: string): Promise<{
    findings: number;
    techniques: number;
    claimedTargets: number;
    contextKeys: number;
  }> {
    try {
      const [findings, techniques, claimed, context] = await Promise.all([
        this.redis.scard(`swarm:${swarmId}:findings`),
        this.redis.hlen(`swarm:${swarmId}:techniques`),
        this.redis.keys(`swarm:${swarmId}:claimed:*`).then(k => k.length),
        this.redis.hlen(`swarm:${swarmId}:context`),
      ]);

      return {
        findings,
        techniques,
        claimedTargets: claimed,
        contextKeys: context,
      };
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to get stats');
      return {
        findings: 0,
        techniques: 0,
        claimedTargets: 0,
        contextKeys: 0,
      };
    }
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    await this.redis.quit();
    await this.pubsub.quit();
    logger.info('Shared Memory System closed');
  }
}

// Singleton instance
export const sharedMemory = new SharedMemory();
export default sharedMemory;
