/**
 * Multi-Model LLM Service
 * 
 * Provides intelligent routing between multiple LLM providers:
 * - GPT-4 (OpenAI)
 * - Claude (Anthropic)
 * - Gemini (Google)
 * - Local models (Ollama)
 * 
 * Features:
 * - Task-based model routing
 * - Cost optimization
 * - Fallback handling
 * - Response caching
 * - Few-shot learning from past findings
 */

import logger from '../utils/logger';
import database from './database';
import redis from './redis';
import { metrics } from './metrics';

interface ModelConfig {
  name: string;
  provider: 'openai' | 'anthropic' | 'google' | 'ollama' | 'azure';
  model: string;
  apiKey?: string;
  endpoint?: string;
  maxTokens: number;
  costPer1kInput: number;
  costPer1kOutput: number;
  capabilities: string[];
  priority: number;
}

interface LLMRequest {
  task: 'exploit-chain' | 'triage' | 'report' | 'analysis' | 'code-review' | 'general';
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  preferredModel?: string;
  context?: any;
}

interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  tokensUsed: { input: number; output: number };
  cost: number;
  latency: number;
  cached: boolean;
}

// Default model configurations
const DEFAULT_MODELS: ModelConfig[] = [
  {
    name: 'gpt-4-turbo',
    provider: 'openai',
    model: 'gpt-4-turbo-preview',
    maxTokens: 128000,
    costPer1kInput: 0.01,
    costPer1kOutput: 0.03,
    capabilities: ['exploit-chain', 'triage', 'report', 'analysis', 'code-review', 'general'],
    priority: 1,
  },
  {
    name: 'gpt-4o',
    provider: 'openai',
    model: 'gpt-4o',
    maxTokens: 128000,
    costPer1kInput: 0.005,
    costPer1kOutput: 0.015,
    capabilities: ['exploit-chain', 'triage', 'report', 'analysis', 'code-review', 'general'],
    priority: 2,
  },
  {
    name: 'claude-3-opus',
    provider: 'anthropic',
    model: 'claude-3-opus-20240229',
    maxTokens: 200000,
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    capabilities: ['exploit-chain', 'analysis', 'code-review', 'report'],
    priority: 3,
  },
  {
    name: 'claude-3-sonnet',
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    maxTokens: 200000,
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    capabilities: ['triage', 'report', 'analysis', 'general'],
    priority: 4,
  },
  {
    name: 'gemini-pro',
    provider: 'google',
    model: 'gemini-1.5-pro',
    maxTokens: 1000000,
    costPer1kInput: 0.00125,
    costPer1kOutput: 0.005,
    capabilities: ['analysis', 'report', 'general'],
    priority: 5,
  },
  {
    name: 'gpt-3.5-turbo',
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    maxTokens: 16385,
    costPer1kInput: 0.0005,
    costPer1kOutput: 0.0015,
    capabilities: ['triage', 'general'],
    priority: 10,
  },
];

// Task complexity mapping
const TASK_COMPLEXITY: Record<string, 'high' | 'medium' | 'low'> = {
  'exploit-chain': 'high',
  'code-review': 'high',
  'analysis': 'medium',
  'triage': 'medium',
  'report': 'medium',
  'general': 'low',
};

class MultiModelLLMService {
  private models: ModelConfig[] = [];
  private cacheEnabled = true;
  private cacheTTL = 3600; // 1 hour
  private fewShotExamples: Map<string, any[]> = new Map();

  constructor() {
    this.models = [...DEFAULT_MODELS];
    this.loadFewShotExamples();
  }

  /**
   * Configure models
   */
  configure(models: Partial<ModelConfig>[]): void {
    for (const modelConfig of models) {
      const existing = this.models.find(m => m.name === modelConfig.name);
      if (existing) {
        Object.assign(existing, modelConfig);
      } else if (modelConfig.name && modelConfig.provider && modelConfig.model) {
        this.models.push(modelConfig as ModelConfig);
      }
    }
    logger.info({ modelCount: this.models.length }, 'Multi-model LLM configured');
  }

  /**
   * Generate completion with intelligent routing
   */
  async generate(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    // Check cache first
    if (this.cacheEnabled) {
      const cached = await this.checkCache(request);
      if (cached) {
        return { ...cached, cached: true, latency: Date.now() - startTime };
      }
    }

    // Select best model for task
    const model = this.selectModel(request);
    if (!model) {
      throw new Error(`No suitable model found for task: ${request.task}`);
    }

    // Add few-shot examples if available
    const enhancedPrompt = await this.enhanceWithFewShot(request);

    // Call the appropriate provider
    let response: LLMResponse;
    try {
      response = await this.callProvider(model, enhancedPrompt, request);
    } catch (error) {
      // Try fallback model
      logger.warn({ model: model.name, error }, 'Primary model failed, trying fallback');
      const fallback = this.selectFallbackModel(model, request);
      if (fallback) {
        response = await this.callProvider(fallback, enhancedPrompt, request);
      } else {
        throw error;
      }
    }

    // Cache the response
    if (this.cacheEnabled) {
      await this.cacheResponse(request, response);
    }

    // Record metrics
    metrics.recordLLMUsage(
      response.model,
      response.tokensUsed.input,
      response.tokensUsed.output,
      response.cost
    );

    response.latency = Date.now() - startTime;
    response.cached = false;

    return response;
  }

  /**
   * Select best model for task
   */
  private selectModel(request: LLMRequest): ModelConfig | null {
    // If preferred model specified, try to use it
    if (request.preferredModel) {
      const preferred = this.models.find(m => m.name === request.preferredModel);
      if (preferred && this.hasApiKey(preferred)) {
        return preferred;
      }
    }

    // Filter models by capability
    const capable = this.models
      .filter(m => m.capabilities.includes(request.task))
      .filter(m => this.hasApiKey(m))
      .sort((a, b) => {
        // Sort by complexity match and priority
        const complexity = TASK_COMPLEXITY[request.task];
        
        if (complexity === 'high') {
          // Prefer higher-capability models
          return a.priority - b.priority;
        } else if (complexity === 'low') {
          // Prefer cheaper models
          return (a.costPer1kInput + a.costPer1kOutput) - (b.costPer1kInput + b.costPer1kOutput);
        }
        
        // Medium: balance cost and capability
        return a.priority - b.priority;
      });

    return capable[0] || null;
  }

  /**
   * Select fallback model
   */
  private selectFallbackModel(failed: ModelConfig, request: LLMRequest): ModelConfig | null {
    return this.models
      .filter(m => m.name !== failed.name)
      .filter(m => m.capabilities.includes(request.task))
      .filter(m => this.hasApiKey(m))
      .sort((a, b) => a.priority - b.priority)[0] || null;
  }

  /**
   * Check if model has API key configured
   */
  private hasApiKey(model: ModelConfig): boolean {
    if (model.apiKey) return true;
    
    const envKeys: Record<string, string> = {
      'openai': 'OPENAI_API_KEY',
      'anthropic': 'ANTHROPIC_API_KEY',
      'google': 'GOOGLE_API_KEY',
      'azure': 'AZURE_OPENAI_API_KEY',
    };

    const envKey = envKeys[model.provider];
    return envKey ? !!process.env[envKey] : model.provider === 'ollama';
  }

  /**
   * Call LLM provider
   */
  private async callProvider(model: ModelConfig, prompt: string, request: LLMRequest): Promise<LLMResponse> {
    const messages = [
      ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
      { role: 'user', content: prompt },
    ];

    switch (model.provider) {
      case 'openai':
        return this.callOpenAI(model, messages, request);
      case 'anthropic':
        return this.callAnthropic(model, messages, request);
      case 'google':
        return this.callGoogle(model, messages, request);
      case 'ollama':
        return this.callOllama(model, messages, request);
      default:
        throw new Error(`Unknown provider: ${model.provider}`);
    }
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(model: ModelConfig, messages: any[], request: LLMRequest): Promise<LLMResponse> {
    const apiKey = model.apiKey || process.env.OPENAI_API_KEY;
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        max_tokens: request.maxTokens || 4096,
        temperature: request.temperature || 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0 };

    return {
      content: data.choices[0]?.message?.content || '',
      model: model.name,
      provider: model.provider,
      tokensUsed: {
        input: usage.prompt_tokens,
        output: usage.completion_tokens,
      },
      cost: (usage.prompt_tokens / 1000 * model.costPer1kInput) + 
            (usage.completion_tokens / 1000 * model.costPer1kOutput),
      latency: 0,
      cached: false,
    };
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(model: ModelConfig, messages: any[], request: LLMRequest): Promise<LLMResponse> {
    const apiKey = model.apiKey || process.env.ANTHROPIC_API_KEY;
    
    // Convert messages format for Anthropic
    const systemPrompt = messages.find(m => m.role === 'system')?.content || '';
    const userMessages = messages.filter(m => m.role !== 'system');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model.model,
        max_tokens: request.maxTokens || 4096,
        system: systemPrompt,
        messages: userMessages,
      }),
    });

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const usage = data.usage || { input_tokens: 0, output_tokens: 0 };

    return {
      content: data.content[0]?.text || '',
      model: model.name,
      provider: model.provider,
      tokensUsed: {
        input: usage.input_tokens,
        output: usage.output_tokens,
      },
      cost: (usage.input_tokens / 1000 * model.costPer1kInput) + 
            (usage.output_tokens / 1000 * model.costPer1kOutput),
      latency: 0,
      cached: false,
    };
  }

  /**
   * Call Google Gemini API
   */
  private async callGoogle(model: ModelConfig, messages: any[], request: LLMRequest): Promise<LLMResponse> {
    const apiKey = model.apiKey || process.env.GOOGLE_API_KEY;
    
    // Convert messages for Gemini
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            maxOutputTokens: request.maxTokens || 4096,
            temperature: request.temperature || 0.7,
          },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Google API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = data.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0 };

    return {
      content: text,
      model: model.name,
      provider: model.provider,
      tokensUsed: {
        input: usage.promptTokenCount || 0,
        output: usage.candidatesTokenCount || 0,
      },
      cost: ((usage.promptTokenCount || 0) / 1000 * model.costPer1kInput) + 
            ((usage.candidatesTokenCount || 0) / 1000 * model.costPer1kOutput),
      latency: 0,
      cached: false,
    };
  }

  /**
   * Call Ollama (local) API
   */
  private async callOllama(model: ModelConfig, messages: any[], request: LLMRequest): Promise<LLMResponse> {
    const endpoint = model.endpoint || 'http://localhost:11434';
    
    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.model,
        messages,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json() as any;

    return {
      content: data.message?.content || '',
      model: model.name,
      provider: model.provider,
      tokensUsed: {
        input: data.prompt_eval_count || 0,
        output: data.eval_count || 0,
      },
      cost: 0, // Local model, no cost
      latency: 0,
      cached: false,
    };
  }

  /**
   * Enhance prompt with few-shot examples
   */
  private async enhanceWithFewShot(request: LLMRequest): Promise<string> {
    const examples = this.fewShotExamples.get(request.task);
    if (!examples || examples.length === 0) {
      return request.prompt;
    }

    // Select most relevant examples (up to 3)
    const relevantExamples = examples.slice(0, 3);
    
    let enhancedPrompt = 'Here are some examples of similar tasks:\n\n';
    for (const example of relevantExamples) {
      enhancedPrompt += `Input: ${example.input}\nOutput: ${example.output}\n\n`;
    }
    enhancedPrompt += `Now, please complete this task:\n${request.prompt}`;

    return enhancedPrompt;
  }

  /**
   * Load few-shot examples from database
   */
  private async loadFewShotExamples(): Promise<void> {
    try {
      const result = await database.query(
        `SELECT task, input, output FROM llm_few_shot_examples 
         WHERE quality_score > 0.8 
         ORDER BY quality_score DESC`
      );

      for (const row of result.rows) {
        if (!this.fewShotExamples.has(row.task)) {
          this.fewShotExamples.set(row.task, []);
        }
        this.fewShotExamples.get(row.task)!.push({
          input: row.input,
          output: row.output,
        });
      }

      logger.info({ tasks: this.fewShotExamples.size }, 'Few-shot examples loaded');
    } catch (error) {
      logger.debug({ error }, 'Failed to load few-shot examples');
    }
  }

  /**
   * Add few-shot example
   */
  async addFewShotExample(task: string, input: string, output: string, qualityScore: number = 0.9): Promise<void> {
    try {
      await database.query(
        `INSERT INTO llm_few_shot_examples (task, input, output, quality_score, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [task, input, output, qualityScore]
      );

      // Update in-memory cache
      if (!this.fewShotExamples.has(task)) {
        this.fewShotExamples.set(task, []);
      }
      this.fewShotExamples.get(task)!.push({ input, output });

      logger.info({ task }, 'Few-shot example added');
    } catch (error) {
      logger.error({ error }, 'Failed to add few-shot example');
    }
  }

  /**
   * Check cache for response
   */
  private async checkCache(request: LLMRequest): Promise<LLMResponse | null> {
    try {
      const cacheKey = this.getCacheKey(request);
      const cached = await redis.get(cacheKey);
      if (cached) {
        return JSON.parse(cached);
      }
    } catch (error) {
      logger.debug({ error }, 'Cache check failed');
    }
    return null;
  }

  /**
   * Cache response
   */
  private async cacheResponse(request: LLMRequest, response: LLMResponse): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(request);
      await redis.setex(cacheKey, this.cacheTTL, JSON.stringify(response));
    } catch (error) {
      logger.debug({ error }, 'Cache write failed');
    }
  }

  /**
   * Generate cache key
   */
  private getCacheKey(request: LLMRequest): string {
    const hash = Buffer.from(
      `${request.task}:${request.prompt}:${request.systemPrompt || ''}`
    ).toString('base64').slice(0, 64);
    return `llm:cache:${hash}`;
  }

  /**
   * Get available models
   */
  getAvailableModels(): ModelConfig[] {
    return this.models.filter(m => this.hasApiKey(m));
  }

  /**
   * Get model stats
   */
  async getModelStats(): Promise<Record<string, any>> {
    const stats: Record<string, any> = {};
    
    for (const model of this.models) {
      stats[model.name] = {
        provider: model.provider,
        available: this.hasApiKey(model),
        capabilities: model.capabilities,
        costPer1kTokens: model.costPer1kInput + model.costPer1kOutput,
      };
    }

    return stats;
  }
}

export const multiModelLLM = new MultiModelLLMService();
export default multiModelLLM;
