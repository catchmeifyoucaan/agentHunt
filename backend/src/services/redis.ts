/**
 * Redis Client Stub
 * Provides Redis-like interface for pub/sub and caching
 */

import logger from '../utils/logger';

class RedisClient {
  private subscribers: Map<string, Set<(message: string) => void>> = new Map();
  private cache: Map<string, any> = new Map();
  private eventListeners: Map<string, Set<(...args: any[]) => void>> = new Map();

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
    this.eventListeners.clear();
  }

  on(event: string, listener: (...args: any[]) => void): this {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: (...args: any[]) => void): this {
    this.eventListeners.get(event)?.delete(listener);
    return this;
  }

  removeListener(event: string, listener: (...args: any[]) => void): this {
    return this.off(event, listener);
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this.eventListeners.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }

    for (const listener of listeners) {
      try {
        listener(...args);
      } catch (error) {
        logger.error({ error, event }, 'Redis event listener error');
      }
    }

    return true;
  }

  duplicate(): RedisClient {
    const client = new RedisClient();
    // Emit 'ready' event asynchronously for the new client
    setImmediate(() => client.emit('ready'));
    return client;
  }
}

const redis = new RedisClient();
export default redis;
