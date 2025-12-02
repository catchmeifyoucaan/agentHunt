import IORedis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';

/**
 * Query Result Cache Service
 * Caches frequently accessed data (programs, policies, templates)
 * Performance: 100-1000x faster for cached queries
 */

class CacheService {
  private static instance: CacheService;
  private redis: IORedis | null = null;
  private memoryCache: Map<string, { data: any; expires: number }> = new Map();
  private defaultTTL = 300000; // 5 minutes default

  private constructor() {
    // Use Redis if available, otherwise fallback to memory cache
    try {
      this.redis = new IORedis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: null,
        tls: config.redis.tls ? { rejectUnauthorized: false } : undefined,
        lazyConnect: true,
      });
    } catch (error) {
      logger.warn({ error }, 'Redis cache unavailable, using memory cache');
    }
  }

  public static getInstance(): CacheService {
    if (!CacheService.instance) {
      CacheService.instance = new CacheService();
    }
    return CacheService.instance;
  }

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const value = await this.redis.get(key);
        return value ? JSON.parse(value) : null;
      } else {
        // Memory cache fallback
        const cached = this.memoryCache.get(key);
        if (cached && cached.expires > Date.now()) {
          return cached.data;
        }
        this.memoryCache.delete(key);
        return null;
      }
    } catch (error) {
      logger.error({ error, key }, 'Cache get failed');
      return null;
    }
  }

  /**
   * Set cached value
   */
  async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.setex(key, Math.floor(ttl / 1000), JSON.stringify(value));
      } else {
        // Memory cache fallback
        this.memoryCache.set(key, {
          data: value,
          expires: Date.now() + ttl,
        });
        // Cleanup expired entries periodically
        if (this.memoryCache.size > 10000) {
          this.cleanupMemoryCache();
        }
      }
    } catch (error) {
      logger.error({ error, key }, 'Cache set failed');
    }
  }

  /**
   * Delete cached value
   */
  async delete(key: string): Promise<void> {
    try {
      if (this.redis) {
        await this.redis.del(key);
      } else {
        this.memoryCache.delete(key);
      }
    } catch (error) {
      logger.error({ error, key }, 'Cache delete failed');
    }
  }

  /**
   * Delete all keys matching pattern
   */
  async deletePattern(pattern: string): Promise<void> {
    try {
      if (this.redis) {
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          await this.redis.del(...keys);
        }
      } else {
        // Memory cache: delete matching keys
        for (const key of this.memoryCache.keys()) {
          if (key.includes(pattern.replace('*', ''))) {
            this.memoryCache.delete(key);
          }
        }
      }
    } catch (error) {
      logger.error({ error, pattern }, 'Cache delete pattern failed');
    }
  }

  /**
   * Cache query result with automatic key generation
   */
  async cacheQuery<T>(
    cacheKey: string,
    queryFn: () => Promise<T>,
    ttl: number = this.defaultTTL
  ): Promise<T> {
    // Try cache first
    const cached = await this.get<T>(cacheKey);
    if (cached !== null) {
      logger.debug({ key: cacheKey }, 'Cache hit');
      return cached;
    }

    // Execute query and cache result
    logger.debug({ key: cacheKey }, 'Cache miss, executing query');
    const result = await queryFn();
    await this.set(cacheKey, result, ttl);
    return result;
  }

  /**
   * Cleanup expired memory cache entries
   */
  private cleanupMemoryCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (entry.expires <= now) {
        this.memoryCache.delete(key);
      }
    }
  }

  /**
   * Generate cache key for program
   */
  programKey(programId: string): string {
    return `program:${programId}`;
  }

  /**
   * Generate cache key for program policy
   */
  policyKey(programId: string): string {
    return `policy:${programId}`;
  }

  /**
   * Generate cache key for nuclei templates
   */
  templatesKey(tier?: string): string {
    return tier ? `templates:${tier}` : 'templates:all';
  }

  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
    this.memoryCache.clear();
  }
}

export default CacheService.getInstance();
