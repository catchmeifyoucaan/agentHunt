/**
 * Embedding Service - Vector Embeddings for Semantic Search
 * Creates embeddings using OpenAI or local models
 */

import { EmbeddingRequest, EmbeddingResponse } from './types';
import logger from '../../utils/logger';
import Redis from 'ioredis';

class EmbeddingService {
  private redis: Redis;
  private cacheEnabled: boolean = true;
  private cacheTTL: number = 86400; // 24 hours
  private openaiApiKey?: string;

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    this.openaiApiKey = process.env.OPENAI_API_KEY;

    if (!this.openaiApiKey) {
      logger.warn('No OpenAI API key configured, embeddings will use fallback method');
    }
  }

  /**
   * Create embedding for text
   */
  async createEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const { text, model = 'text-embedding-3-small' } = request;

    // Check cache
    const cacheKey = `embedding:${model}:${this.hashText(text)}`;
    if (this.cacheEnabled) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.debug('Using cached embedding');
        return JSON.parse(cached);
      }
    }

    // Create embedding
    let result: EmbeddingResponse;

    if (this.openaiApiKey) {
      result = await this.createOpenAIEmbedding(text, model);
    } else {
      // Fallback to simple TF-IDF style embedding
      result = this.createFallbackEmbedding(text, model);
    }

    // Cache result
    if (this.cacheEnabled) {
      await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));
    }

    return result;
  }

  /**
   * Create embeddings using OpenAI API
   */
  private async createOpenAIEmbedding(text: string, model: string): Promise<EmbeddingResponse> {
    try {
      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: JSON.stringify({
          input: text,
          model,
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }

      const data = await response.json();

      logger.debug(
        {
          model,
          tokensUsed: data.usage.total_tokens,
          dimensions: data.data[0].embedding.length,
        },
        'Created embedding with OpenAI'
      );

      return {
        embedding: data.data[0].embedding,
        model: data.model,
        tokensUsed: data.usage.total_tokens,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to create OpenAI embedding');
      throw error;
    }
  }

  /**
   * Fallback embedding using simple TF-IDF style vectors
   * Not as good as OpenAI but works without API key
   */
  private createFallbackEmbedding(text: string, model: string): EmbeddingResponse {
    logger.debug('Using fallback embedding method (TF-IDF style)');

    // Simple tokenization
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);

    // Create fixed-size embedding (384 dimensions like some smaller models)
    const dimensions = 384;
    const embedding = new Array(dimensions).fill(0);

    // Simple hash-based embedding
    tokens.forEach(token => {
      const hash = this.simpleHash(token);
      for (let i = 0; i < dimensions; i++) {
        // Spread token influence across multiple dimensions
        const idx = (hash + i * 37) % dimensions;
        embedding[idx] += 1.0 / Math.sqrt(tokens.length);
      }
    });

    // Normalize
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    const normalized = embedding.map(val => val / (magnitude || 1));

    return {
      embedding: normalized,
      model: `fallback-tfidf-${dimensions}`,
      tokensUsed: tokens.length,
    };
  }

  /**
   * Calculate cosine similarity between two embeddings
   */
  cosineSimilarity(embedding1: number[], embedding2: number[]): number {
    if (embedding1.length !== embedding2.length) {
      throw new Error('Embeddings must have same dimensions');
    }

    let dotProduct = 0;
    let magnitude1 = 0;
    let magnitude2 = 0;

    for (let i = 0; i < embedding1.length; i++) {
      dotProduct += embedding1[i] * embedding2[i];
      magnitude1 += embedding1[i] * embedding1[i];
      magnitude2 += embedding2[i] * embedding2[i];
    }

    magnitude1 = Math.sqrt(magnitude1);
    magnitude2 = Math.sqrt(magnitude2);

    if (magnitude1 === 0 || magnitude2 === 0) {
      return 0;
    }

    return dotProduct / (magnitude1 * magnitude2);
  }

  /**
   * Batch create embeddings
   */
  async createBatchEmbeddings(
    texts: string[],
    model?: string
  ): Promise<EmbeddingResponse[]> {
    logger.info({ count: texts.length }, 'Creating batch embeddings');

    // Process in parallel but limit concurrency
    const batchSize = 10;
    const results: EmbeddingResponse[] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(text => this.createEmbedding({ text, model: model as any }))
      );
      results.push(...batchResults);
    }

    return results;
  }

  /**
   * Hash text for caching
   */
  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Simple hash function for tokens
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  /**
   * Get embedding stats
   */
  async getStats(): Promise<{
    cacheSize: number;
    cacheHitRate: number;
    averageDimensions: number;
  }> {
    // Get cache keys
    const keys = await this.redis.keys('embedding:*');

    return {
      cacheSize: keys.length,
      cacheHitRate: 0, // Would need to track hits/misses
      averageDimensions: 384, // Default for our fallback
    };
  }

  /**
   * Clear embedding cache
   */
  async clearCache(): Promise<void> {
    const keys = await this.redis.keys('embedding:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    logger.info({ keysDeleted: keys.length }, 'Cleared embedding cache');
  }
}

export default new EmbeddingService();
