import Redis from 'ioredis';
import logger from '../utils/logger';
import config from '../config';

/**
 * Distributed Rate Limiter Service
 *
 * Prevents overwhelming target hosts by coordinating rate limits across all workers
 * Uses Redis sliding window algorithm for accurate distributed rate limiting
 */
class RateLimiterService {
  private redis: Redis;
  private readonly WINDOW_SIZE_MS = 1000; // 1 second window
  private readonly MAX_REQUESTS_PER_SECOND = 150; // Default limit per target

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          logger.error('Rate limiter Redis connection failed after 3 retries');
          return null;
        }
        return Math.min(times * 200, 2000);
      },
    });

    this.redis.connect().catch((err) => {
      logger.error({ error: err }, 'Failed to connect rate limiter to Redis');
    });
  }

  /**
   * Extract clean hostname from URL or domain
   */
  private extractHost(target: string): string {
    try {
      // Remove protocol if present
      let cleaned = target.replace(/^https?:\/\//, '');
      // Remove path, port, query
      cleaned = cleaned.split('/')[0].split(':')[0].split('?')[0];
      return cleaned.toLowerCase();
    } catch {
      return target.toLowerCase();
    }
  }

  /**
   * Acquire tokens for rate limiting using sliding window algorithm
   *
   * @param target - Target hostname or URL
   * @param tokensNeeded - Number of requests to make
   * @param maxRatePerSecond - Optional custom rate limit (defaults to 150/s)
   * @returns true if tokens acquired, false if rate limit exceeded
   */
  async acquireTokens(
    target: string,
    tokensNeeded: number = 1,
    maxRatePerSecond?: number
  ): Promise<boolean> {
    const host = this.extractHost(target);
    const limit = maxRatePerSecond || this.MAX_REQUESTS_PER_SECOND;
    const key = `ratelimit:${host}`;
    const now = Date.now();
    const windowStart = now - this.WINDOW_SIZE_MS;

    try {
      // Lua script for atomic sliding window rate limit
      // 1. Remove old entries outside window
      // 2. Count current requests in window
      // 3. Add new request if under limit
      const script = `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local window_start = tonumber(ARGV[2])
        local limit = tonumber(ARGV[3])
        local tokens_needed = tonumber(ARGV[4])

        redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
        local current = redis.call('ZCARD', key)

        if current + tokens_needed <= limit then
          for i = 1, tokens_needed do
            redis.call('ZADD', key, now, now .. ':' .. i)
          end
          redis.call('EXPIRE', key, 2)
          return 1
        else
          return 0
        end
      `;

      const result = await this.redis.eval(
        script,
        1,
        key,
        now.toString(),
        windowStart.toString(),
        limit.toString(),
        tokensNeeded.toString()
      );

      const acquired = result === 1;

      if (!acquired) {
        logger.debug({ host, tokensNeeded, limit }, 'Rate limit reached, waiting for tokens');
      }

      return acquired;
    } catch (error) {
      logger.error({ error, host, tokensNeeded }, 'Rate limiter error, allowing request');
      // Fail open - if Redis is down, don't block requests
      return true;
    }
  }

  /**
   * Wait until tokens are available (with exponential backoff)
   *
   * @param target - Target hostname or URL
   * @param tokensNeeded - Number of requests to make
   * @param maxRatePerSecond - Optional custom rate limit
   * @param maxWaitMs - Maximum time to wait (default 30s)
   */
  async waitForTokens(
    target: string,
    tokensNeeded: number = 1,
    maxRatePerSecond?: number,
    maxWaitMs: number = 30000
  ): Promise<void> {
    const startTime = Date.now();
    let attempt = 0;

    while (Date.now() - startTime < maxWaitMs) {
      const acquired = await this.acquireTokens(target, tokensNeeded, maxRatePerSecond);

      if (acquired) {
        if (attempt > 0) {
          logger.info(
            { target, tokensNeeded, attemptsNeeded: attempt + 1 },
            'Rate limit tokens acquired after waiting'
          );
        }
        return;
      }

      // Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms, 1000ms
      const backoffMs = Math.min(1000, 50 * Math.pow(2, attempt));
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      attempt++;
    }

    logger.warn(
      { target, tokensNeeded, waitedMs: Date.now() - startTime },
      'Rate limiter timeout, proceeding anyway'
    );
  }

  /**
   * Get current request count for a target
   */
  async getCurrentCount(target: string): Promise<number> {
    const host = this.extractHost(target);
    const key = `ratelimit:${host}`;
    const now = Date.now();
    const windowStart = now - this.WINDOW_SIZE_MS;

    try {
      await this.redis.zremrangebyscore(key, 0, windowStart);
      return await this.redis.zcard(key);
    } catch (error) {
      logger.error({ error, host }, 'Failed to get rate limit count');
      return 0;
    }
  }

  /**
   * Reset rate limit for a target (use with caution)
   */
  async reset(target: string): Promise<void> {
    const host = this.extractHost(target);
    const key = `ratelimit:${host}`;

    try {
      await this.redis.del(key);
      logger.info({ host }, 'Rate limit reset for target');
    } catch (error) {
      logger.error({ error, host }, 'Failed to reset rate limit');
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// Export singleton instance
const rateLimiter = new RateLimiterService();
export default rateLimiter;
