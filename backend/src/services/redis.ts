/**
 * Redis Client Stub
 * Provides Redis-like interface for pub/sub and caching
 */

import logger from '../utils/logger';

class RedisClient {
  private subscribers: Map<string, Set<(message: string) => void>> = new Map();
  private cache: Map<string, any> = new Map();

  async publish(channel: string, message: string): Promise<number> {
    logger.debug({ channel }, 'Redis publish');
    const subscribers = this.subscribers.get(channel) || new Set();
    
    // Notify all subscribers
    for (const callback of subscribers) {
      try {
        callback(message);
      } catch (error) {
        logger.error({ error, channel }, 'Redis subscriber error');
      }
    }
    
    return subscribers.size;
  }

  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    logger.debug({ channel }, 'Redis subscribe');
    
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    
    this.subscribers.get(channel)!.add(callback);
  }

  async unsubscribe(channel: string, callback?: (message: string) => void): Promise<void> {
    logger.debug({ channel }, 'Redis unsubscribe');
    
    if (callback) {
      this.subscribers.get(channel)?.delete(callback);
    } else {
      this.subscribers.delete(channel);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.cache.get(key) || null;
  }

  async set(key: string, value: any, expiryMode?: string, time?: number): Promise<void> {
    this.cache.set(key, value);
    
    if (expiryMode === 'EX' && time) {
      setTimeout(() => this.cache.delete(key), time * 1000);
    }
  }

  async del(key: string): Promise<number> {
    const existed = this.cache.has(key);
    this.cache.delete(key);
    return existed ? 1 : 0;
  }

  async quit(): Promise<void> {
    this.subscribers.clear();
    this.cache.clear();
  }
}

const redis = new RedisClient();
export default redis;
