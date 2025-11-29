/**
 * Redis Test Utilities
 * Provides helpers for Redis testing and mocking
 */

import Redis from 'ioredis';

let testRedis: Redis | null = null;

export class RedisTestHelper {
  private client: Redis;

  constructor() {
    this.client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: parseInt(process.env.REDIS_DB || '1'), // Use DB 1 for tests
      lazyConnect: true,
    });
    testRedis = this.client;
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      console.error('Failed to connect to test Redis:', error);
      throw error;
    }
  }

  /**
   * Disconnect from Redis
   */
  async disconnect(): Promise<void> {
    await this.client.quit();
    testRedis = null;
  }

  /**
   * Get the Redis client
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Clear all keys in the test database
   */
  async clearAll(): Promise<void> {
    await this.client.flushdb();
  }

  /**
   * Set a key with optional TTL
   */
  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (ttl) {
      await this.client.setex(key, ttl, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /**
   * Get a key
   */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /**
   * Delete keys by pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    const keys = await this.client.keys(pattern);
    if (keys.length === 0) return 0;
    return this.client.del(...keys);
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }
}

/**
 * Get or create the test Redis helper
 */
export function getTestRedis(): RedisTestHelper {
  return new RedisTestHelper();
}

/**
 * Mock Redis for unit tests (no actual Redis connection)
 */
export function mockRedis() {
  const store = new Map<string, string>();

  return {
    get: jest.fn((key: string) => Promise.resolve(store.get(key) || null)),
    set: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    setex: jest.fn((key: string, ttl: number, value: string) => {
      store.set(key, value);
      return Promise.resolve('OK');
    }),
    del: jest.fn((...keys: string[]) => {
      let count = 0;
      keys.forEach(key => {
        if (store.delete(key)) count++;
      });
      return Promise.resolve(count);
    }),
    exists: jest.fn((key: string) => Promise.resolve(store.has(key) ? 1 : 0)),
    keys: jest.fn((pattern: string) => {
      // Simple pattern matching (just * wildcard)
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return Promise.resolve(
        Array.from(store.keys()).filter(key => regex.test(key))
      );
    }),
    flushdb: jest.fn(() => {
      store.clear();
      return Promise.resolve('OK');
    }),
    connect: jest.fn(() => Promise.resolve()),
    quit: jest.fn(() => Promise.resolve('OK')),
  } as any;
}

/**
 * Mock BullMQ Queue for testing
 */
export function mockBullMQQueue(queueName: string) {
  const jobs = new Map<string, any>();

  return {
    name: queueName,
    add: jest.fn(async (jobName: string, data: any, opts?: any) => {
      const job = {
        id: Math.random().toString(36).substring(7),
        name: jobName,
        data,
        opts,
        progress: jest.fn(),
        log: jest.fn(),
        updateProgress: jest.fn(),
      };
      jobs.set(job.id, job);
      return job;
    }),
    getJob: jest.fn(async (jobId: string) => jobs.get(jobId) || null),
    getJobs: jest.fn(async () => Array.from(jobs.values())),
    clean: jest.fn(async () => []),
    close: jest.fn(async () => undefined),
    pause: jest.fn(async () => undefined),
    resume: jest.fn(async () => undefined),
    obliterate: jest.fn(async () => undefined),
  };
}
