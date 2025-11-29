/**
 * Smart Batch Strategy Utility
 *
 * Dynamically calculates optimal batch sizes and timeouts based on:
 * - Tool type and performance characteristics
 * - Asset count
 * - Asset type (domains, URLs, IPs)
 * - System resources
 */

export type ToolType = 'dnsx' | 'httpx' | 'tlsx' | 'nuclei' | 'katana' | 'naabu' | 'masscan' | 'subfinder';
export type AssetType = 'subdomain' | 'url' | 'ip' | 'domain';

interface BatchConfig {
  batchSize: number;
  timeoutMs: number;
  concurrency: number;
  rateLimit: number;
}

/**
 * Tool performance characteristics (based on benchmarking)
 */
const TOOL_PERFORMANCE: Record<ToolType, {
  msPerAsset: number;  // Average processing time per asset
  maxConcurrency: number;
  rateLimit: number;
  optimalBatchSize: number;
}> = {
  dnsx: {
    msPerAsset: 50,          // Very fast DNS lookups
    maxConcurrency: 200,
    rateLimit: 1000,
    optimalBatchSize: 5000,  // Can handle large batches
  },
  httpx: {
    msPerAsset: 8000,        // 5-10 seconds per HTTP probe
    maxConcurrency: 500,
    rateLimit: 150,
    optimalBatchSize: 1000,  // Medium batches
  },
  tlsx: {
    msPerAsset: 3000,        // 3-5 seconds per TLS probe
    maxConcurrency: 300,
    rateLimit: 200,
    optimalBatchSize: 1500,  // Medium batches
  },
  nuclei: {
    msPerAsset: 45000,       // 30-60 seconds per URL (depends on templates)
    maxConcurrency: 500,
    rateLimit: 150,
    optimalBatchSize: 200,   // Small batches (slow tool)
  },
  katana: {
    msPerAsset: 15000,       // 10-20 seconds per URL to crawl
    maxConcurrency: 500,
    rateLimit: 300,
    optimalBatchSize: 300,   // Small-medium batches
  },
  naabu: {
    msPerAsset: 20000,       // 10-30 seconds per host (depends on port count)
    maxConcurrency: 100,
    rateLimit: 2000,
    optimalBatchSize: 500,   // Medium batches
  },
  masscan: {
    msPerAsset: 5000,        // Very fast port scanner
    maxConcurrency: 1,       // Single instance (handles parallelism internally)
    rateLimit: 5000,
    optimalBatchSize: 2000,  // Large batches
  },
  subfinder: {
    msPerAsset: 2000,        // 2-3 seconds per domain
    maxConcurrency: 60,
    rateLimit: 100,
    optimalBatchSize: 100,   // Process all at once usually
  },
};

/**
 * Calculate optimal batch size for a tool and asset count
 */
export function calculateBatchSize(
  toolType: ToolType,
  totalAssets: number,
  assetType: AssetType = 'subdomain'
): number {
  const toolPerf = TOOL_PERFORMANCE[toolType];

  // For very small asset counts, use single batch
  if (totalAssets <= toolPerf.optimalBatchSize * 0.5) {
    return totalAssets;
  }

  // For large asset counts, use optimal batch size
  // This ensures reasonable job granularity for retry and monitoring
  return Math.min(toolPerf.optimalBatchSize, totalAssets);
}

/**
 * Calculate realistic timeout for a batch
 * Accounts for:
 * - Tool performance characteristics
 * - Asset count
 * - Safety buffer (2x)
 * - Absolute caps (min/max)
 */
export function calculateTimeout(
  toolType: ToolType,
  assetCount: number,
  options?: {
    templateCount?: number;  // For nuclei: affects scan time
    portCount?: number;      // For port scanners: affects scan time
    depth?: number;          // For crawlers: affects crawl time
    safetyMultiplier?: number;  // Default 2x
  }
): number {
  const toolPerf = TOOL_PERFORMANCE[toolType];
  const safetyMultiplier = options?.safetyMultiplier || 2.0;

  let baseTimeMs = toolPerf.msPerAsset * assetCount;

  // Adjust for tool-specific factors
  switch (toolType) {
    case 'nuclei':
      // Nuclei time scales with template count
      const templates = options?.templateCount || 100;
      baseTimeMs = baseTimeMs * (templates / 100);
      break;

    case 'naabu':
    case 'masscan':
      // Port scanners scale with port count
      const ports = options?.portCount || 1000;
      baseTimeMs = baseTimeMs * (ports / 1000);
      break;

    case 'katana':
      // Crawlers scale with depth
      const depth = options?.depth || 2;
      baseTimeMs = baseTimeMs * depth;
      break;
  }

  // Apply safety multiplier
  const timeoutMs = baseTimeMs * safetyMultiplier;

  // Cap timeouts (min 30s, max 2 hours)
  return Math.max(30000, Math.min(7200000, timeoutMs));
}

/**
 * Calculate full batch configuration
 */
export function calculateBatchConfig(
  toolType: ToolType,
  totalAssets: number,
  assetType: AssetType = 'subdomain',
  options?: {
    templateCount?: number;
    portCount?: number;
    depth?: number;
    customConcurrency?: number;
    customRateLimit?: number;
  }
): BatchConfig {
  const toolPerf = TOOL_PERFORMANCE[toolType];

  return {
    batchSize: calculateBatchSize(toolType, totalAssets, assetType),
    timeoutMs: calculateTimeout(toolType, totalAssets, options),
    concurrency: options?.customConcurrency || toolPerf.maxConcurrency,
    rateLimit: options?.customRateLimit || toolPerf.rateLimit,
  };
}

/**
 * Split assets into optimal batches
 */
export function createBatches<T>(
  assets: T[],
  toolType: ToolType,
  assetType: AssetType = 'subdomain'
): T[][] {
  const batchSize = calculateBatchSize(toolType, assets.length, assetType);
  const batches: T[][] = [];

  for (let i = 0; i < assets.length; i += batchSize) {
    batches.push(assets.slice(i, i + batchSize));
  }

  return batches;
}

/**
 * Get human-readable timing estimate
 */
export function getTimingEstimate(
  toolType: ToolType,
  assetCount: number,
  options?: {
    templateCount?: number;
    portCount?: number;
    depth?: number;
  }
): {
  estimatedSeconds: number;
  estimatedMinutes: number;
  humanReadable: string;
} {
  const timeoutMs = calculateTimeout(toolType, assetCount, {
    ...options,
    safetyMultiplier: 1.0, // Use actual estimate, not buffered
  });

  const seconds = Math.round(timeoutMs / 1000);
  const minutes = Math.round(seconds / 60);

  let humanReadable: string;
  if (seconds < 60) {
    humanReadable = `~${seconds}s`;
  } else if (minutes < 60) {
    humanReadable = `~${minutes}min`;
  } else {
    const hours = Math.round(minutes / 60);
    humanReadable = `~${hours}h`;
  }

  return {
    estimatedSeconds: seconds,
    estimatedMinutes: minutes,
    humanReadable,
  };
}

/**
 * Intelligent retry configuration based on attempt number
 * Each retry uses more conservative settings with exponential backoff
 */
export function getRetryConfig(
  toolType: ToolType,
  attemptNumber: number,
  originalConfig: BatchConfig
): BatchConfig & { backoffDelayMs: number } {
  if (attemptNumber === 1) {
    // First retry: same settings with short delay
    return {
      ...originalConfig,
      backoffDelayMs: 2000, // 2 seconds
    };
  } else if (attemptNumber === 2) {
    // Second retry: reduce concurrency, increase timeout
    return {
      ...originalConfig,
      concurrency: Math.floor(originalConfig.concurrency * 0.5),
      rateLimit: Math.floor(originalConfig.rateLimit * 0.7),
      timeoutMs: originalConfig.timeoutMs * 1.5,
      backoffDelayMs: 4000, // 4 seconds (exponential backoff)
    };
  } else if (attemptNumber === 3) {
    // Third retry: conservative settings
    return {
      ...originalConfig,
      concurrency: Math.floor(originalConfig.concurrency * 0.25),
      rateLimit: Math.floor(originalConfig.rateLimit * 0.5),
      timeoutMs: originalConfig.timeoutMs * 2,
      backoffDelayMs: 8000, // 8 seconds
    };
  } else {
    // Fourth+ retry: very conservative with long backoff
    return {
      ...originalConfig,
      concurrency: Math.max(1, Math.floor(originalConfig.concurrency * 0.1)),
      rateLimit: Math.max(10, Math.floor(originalConfig.rateLimit * 0.3)),
      timeoutMs: originalConfig.timeoutMs * 3,
      backoffDelayMs: Math.min(60000, 16000 * Math.pow(2, attemptNumber - 4)), // Cap at 60 seconds
    };
  }
}

/**
 * Calculate exponential backoff delay with jitter
 * Prevents thundering herd problem when multiple jobs retry simultaneously
 *
 * @param attemptNumber - The retry attempt number (1-indexed)
 * @param baseDelayMs - Base delay in milliseconds (default: 1000ms)
 * @param maxDelayMs - Maximum delay in milliseconds (default: 60000ms)
 * @param jitterFactor - Amount of randomness to add (0.0-1.0, default: 0.3)
 * @returns Delay in milliseconds before next retry
 */
export function calculateExponentialBackoff(
  attemptNumber: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60000,
  jitterFactor: number = 0.3
): number {
  // Exponential backoff: delay = baseDelay * 2^attempt
  const exponentialDelay = baseDelayMs * Math.pow(2, attemptNumber - 1);

  // Cap at maximum delay
  const cappedDelay = Math.min(exponentialDelay, maxDelayMs);

  // Add jitter: randomize delay by ±jitterFactor%
  const jitter = cappedDelay * jitterFactor * (Math.random() * 2 - 1);
  const finalDelay = Math.floor(cappedDelay + jitter);

  return Math.max(0, finalDelay);
}

/**
 * Determine if an error is retryable
 * Some errors should not be retried (e.g., invalid configuration, authentication failures)
 *
 * @param error - The error object or message
 * @returns true if the error is retryable, false otherwise
 */
export function isRetryableError(error: Error | string): boolean {
  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorLower = errorMessage.toLowerCase();

  // Non-retryable errors (permanent failures)
  const nonRetryablePatterns = [
    'invalid configuration',
    'authentication failed',
    'unauthorized',
    'forbidden',
    'not found',
    'invalid api key',
    'quota exceeded',
    'bad request',
    'invalid input',
    'permission denied',
  ];

  // Check if error matches any non-retryable pattern
  const isNonRetryable = nonRetryablePatterns.some(pattern => errorLower.includes(pattern));
  if (isNonRetryable) {
    return false;
  }

  // Retryable errors (transient failures)
  const retryablePatterns = [
    'timeout',
    'network error',
    'connection',
    'econnrefused',
    'econnreset',
    'etimedout',
    'socket',
    'temporary',
    'rate limit',
    'too many requests',
    'service unavailable',
    'internal server error',
    'gateway timeout',
  ];

  // If explicitly retryable, return true
  const isRetryable = retryablePatterns.some(pattern => errorLower.includes(pattern));
  if (isRetryable) {
    return true;
  }

  // Default: retry unknown errors (conservative approach)
  return true;
}

/**
 * Get recommended max retry attempts based on error type
 *
 * @param error - The error object or message
 * @returns Recommended maximum retry attempts
 */
export function getMaxRetryAttempts(error?: Error | string): number {
  if (!error) {
    return 3; // Default: 3 retries
  }

  const errorMessage = typeof error === 'string' ? error : error.message;
  const errorLower = errorMessage.toLowerCase();

  // Rate limit errors: more retries with longer backoff
  if (errorLower.includes('rate limit') || errorLower.includes('too many requests')) {
    return 5;
  }

  // Timeout errors: fewer retries (might be a slow target)
  if (errorLower.includes('timeout')) {
    return 2;
  }

  // Network errors: moderate retries
  if (errorLower.includes('network') || errorLower.includes('connection')) {
    return 4;
  }

  // Default: 3 retries
  return 3;
}
