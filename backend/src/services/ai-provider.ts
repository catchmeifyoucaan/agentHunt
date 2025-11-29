import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

/**
 * Multi-AI Provider Service
 *
 * Supports multiple AI providers with automatic fallback:
 * - Perplexity (via OpenAI-compatible API)
 * - Gemini (Google AI)
 * - ChatGPT (OpenAI)
 * - Claude (Anthropic)
 *
 * Tries providers in priority order until one succeeds
 */

export interface AIMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AIResponse {
  content: string;
  provider: string;
  model: string;
  tokensUsed?: number;
}

export interface AIProviderConfig {
  provider: 'perplexity' | 'gemini' | 'openai' | 'anthropic';
  apiKey: string;
  model?: string;
  enabled: boolean;
}

export class MultiAIProvider {
  private providers: AIProviderConfig[] = [];
  private clients: Map<string, any> = new Map();
  private tracer = trace.getTracer('agenthunt-ai');

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize all available AI providers from environment
   *
   * Priority Order (optimized for cost savings):
   * 1. Gemini - FREE tier (1,500 req/day), excellent quality
   * 2. Claude - Premium fallback, best reasoning
   * 3. OpenAI - Reliable fallback
   * 4. Perplexity - Last resort
   */
  private initializeProviders() {
    // Gemini (HIGHEST PRIORITY - FREE tier, excellent quality)
    if (process.env.GEMINI_API_KEY) {
      this.providers.push({
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
        enabled: process.env.ENABLE_GEMINI !== 'false',
      });

      this.clients.set('gemini', new GoogleGenerativeAI(process.env.GEMINI_API_KEY));

      logger.info('Gemini AI provider initialized (PRIMARY - FREE tier)');
    }

    // Claude (second priority - premium fallback for complex reasoning)
    if (process.env.ANTHROPIC_API_KEY) {
      this.providers.push({
        provider: 'anthropic',
        apiKey: process.env.ANTHROPIC_API_KEY,
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
        enabled: process.env.ENABLE_ANTHROPIC !== 'false',
      });

      this.clients.set(
        'anthropic',
        new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        })
      );

      logger.info('Anthropic Claude provider initialized (fallback)');
    }

    // OpenAI (third priority - reliable fallback)
    if (process.env.OPENAI_API_KEY) {
      this.providers.push({
        provider: 'openai',
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        enabled: process.env.ENABLE_OPENAI !== 'false',
      });

      this.clients.set(
        'openai',
        new OpenAI({
          apiKey: process.env.OPENAI_API_KEY,
        })
      );

      logger.info('OpenAI provider initialized (fallback)');
    }

    // Perplexity (fourth priority - last resort)
    if (process.env.PERPLEXITY_API_KEY) {
      this.providers.push({
        provider: 'perplexity',
        apiKey: process.env.PERPLEXITY_API_KEY,
        model: process.env.PERPLEXITY_MODEL || 'llama-3.1-sonar-huge-128k-online',
        enabled: process.env.ENABLE_PERPLEXITY !== 'false',
      });

      // Perplexity uses OpenAI-compatible API
      this.clients.set(
        'perplexity',
        new OpenAI({
          apiKey: process.env.PERPLEXITY_API_KEY,
          baseURL: 'https://api.perplexity.ai',
        })
      );

      logger.info('Perplexity AI provider initialized (last resort)');
    }

    if (this.providers.length === 0) {
      logger.error('No AI providers configured! Add at least one API key.');
      throw new Error('No AI providers available');
    }

    logger.info(
      `Multi-AI provider initialized with ${this.providers.length} providers: ${this.providers
        .map((p) => p.provider)
        .join(', ')}`
    );
  }

  /**
   * Send a chat completion request with automatic provider fallback
   * Wrapped with OpenTelemetry tracing for LLM decision tracking
   */
  async chat(
    messages: AIMessage[],
    options: {
      temperature?: number;
      maxTokens?: number;
      systemPrompt?: string;
      preferredProvider?: string;
    } = {}
  ): Promise<AIResponse> {
    const span = this.tracer.startSpan('ai.chat', {
      attributes: {
        'ai.temperature': options.temperature || 0.0,
        'ai.max_tokens': options.maxTokens || 4096,
        'ai.message_count': messages.length,
        'ai.preferred_provider': options.preferredProvider || 'none',
        'ai.has_system_prompt': !!options.systemPrompt,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const { temperature = 0.0, maxTokens = 4096, systemPrompt, preferredProvider } = options;

        // Add system prompt if provided
        const fullMessages = systemPrompt
          ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
          : messages;

        // Sort providers by preference
        const sortedProviders = [...this.providers.filter((p) => p.enabled)];
        if (preferredProvider) {
          sortedProviders.sort((a, b) =>
            a.provider === preferredProvider ? -1 : b.provider === preferredProvider ? 1 : 0
          );
        }

        const errors: Array<{ provider: string; error: string }> = [];

        // Try each provider until one succeeds
        for (const providerConfig of sortedProviders) {
          try {
            logger.info(`Trying AI provider: ${providerConfig.provider}`);

            const result = await this.callProvider(
              providerConfig,
              fullMessages,
              temperature,
              maxTokens
            );

            logger.info(`Successfully used ${providerConfig.provider} (${providerConfig.model})`);

            // Add success attributes to span
            span.setAttributes({
              'ai.provider_used': result.provider,
              'ai.model': result.model,
              'ai.tokens_used': result.tokensUsed || 0,
              'ai.cost_usd': this.calculateCost(result),
              'ai.fallback_count': errors.length,
            });
            span.setStatus({ code: SpanStatusCode.OK });

            return result;
          } catch (error: any) {
            const errorMsg = error.message || String(error);
            logger.warn(`Failed to use ${providerConfig.provider}: ${errorMsg}`);
            errors.push({
              provider: providerConfig.provider,
              error: errorMsg,
            });

            // Continue to next provider
            continue;
          }
        }

        // All providers failed
        const errorSummary = errors.map((e) => `${e.provider}: ${e.error}`).join('; ');
        const error = new Error(`All AI providers failed. Errors: ${errorSummary}`);

        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errorSummary,
        });
        span.setAttribute('ai.all_providers_failed', true);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Calculate estimated cost for AI response
   */
  private calculateCost(response: AIResponse): number {
    const costPer1kTokens: Record<string, number> = {
      gemini: 0.0, // Free tier
      anthropic: 0.003, // Claude Sonnet 4.5
      openai: 0.003, // GPT-4o
      perplexity: 0.001, // Llama 3.1 Sonar
    };

    const cost =
      (costPer1kTokens[response.provider] || 0.003) * ((response.tokensUsed || 0) / 1000);
    return cost;
  }

  /**
   * Call a specific AI provider
   */
  private async callProvider(
    config: AIProviderConfig,
    messages: AIMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<AIResponse> {
    switch (config.provider) {
      case 'perplexity':
        return await this.callPerplexity(config, messages, temperature, maxTokens);

      case 'gemini':
        return await this.callGemini(config, messages, temperature, maxTokens);

      case 'openai':
        return await this.callOpenAI(config, messages, temperature, maxTokens);

      case 'anthropic':
        return await this.callAnthropic(config, messages, temperature, maxTokens);

      default:
        throw new Error(`Unknown provider: ${config.provider}`);
    }
  }

  /**
   * Call Perplexity API (OpenAI-compatible)
   */
  private async callPerplexity(
    config: AIProviderConfig,
    messages: AIMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<AIResponse> {
    const client = this.clients.get('perplexity') as OpenAI;

    const response = await client.chat.completions.create({
      model: config.model!,
      messages: messages.map((m) => ({
        role: m.role === 'system' ? 'system' : m.role,
        content: m.content,
      })),
      temperature,
      max_tokens: maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      provider: 'perplexity',
      model: config.model!,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Call Gemini API
   */
  private async callGemini(
    config: AIProviderConfig,
    messages: AIMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<AIResponse> {
    const client = this.clients.get('gemini') as GoogleGenerativeAI;
    const model = client.getGenerativeModel({ model: config.model! });

    // Convert messages to Gemini format
    const systemPrompt = messages.find((m) => m.role === 'system')?.content || '';
    const chatMessages = messages.filter((m) => m.role !== 'system');

    // Build chat history
    const history = chatMessages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({
      history,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      },
      systemInstruction: systemPrompt || undefined,
    });

    const lastMessage = chatMessages[chatMessages.length - 1];
    const result = await chat.sendMessage(lastMessage.content);
    const response = await result.response;

    return {
      content: response.text(),
      provider: 'gemini',
      model: config.model!,
      tokensUsed: response.usageMetadata?.totalTokenCount,
    };
  }

  /**
   * Call OpenAI API
   */
  private async callOpenAI(
    config: AIProviderConfig,
    messages: AIMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<AIResponse> {
    const client = this.clients.get('openai') as OpenAI;

    const response = await client.chat.completions.create({
      model: config.model!,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature,
      max_tokens: maxTokens,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      provider: 'openai',
      model: config.model!,
      tokensUsed: response.usage?.total_tokens,
    };
  }

  /**
   * Call Anthropic Claude API
   */
  private async callAnthropic(
    config: AIProviderConfig,
    messages: AIMessage[],
    temperature: number,
    maxTokens: number
  ): Promise<AIResponse> {
    const client = this.clients.get('anthropic') as Anthropic;

    // Extract system prompt if present
    const systemPrompt = messages.find((m) => m.role === 'system')?.content;
    const chatMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const response = await client.messages.create({
      model: config.model!,
      max_tokens: maxTokens,
      temperature,
      system: systemPrompt,
      messages: chatMessages,
    });

    const content = response.content[0]?.type === 'text' ? response.content[0].text : '';

    return {
      content,
      provider: 'anthropic',
      model: config.model!,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
    };
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): string[] {
    return this.providers.filter((p) => p.enabled).map((p) => p.provider);
  }

  /**
   * Check if a specific provider is available
   */
  isProviderAvailable(provider: string): boolean {
    return this.providers.some((p) => p.provider === provider && p.enabled);
  }
}

// Singleton instance
export const aiProvider = new MultiAIProvider();
