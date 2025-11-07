import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger';

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

  constructor() {
    this.initializeProviders();
  }

  /**
   * Initialize all available AI providers from environment
   */
  private initializeProviders() {
    // Perplexity (highest priority - cheap and fast)
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

      logger.info('Perplexity AI provider initialized');
    }

    // Gemini (second priority - good quality, free tier)
    if (process.env.GEMINI_API_KEY) {
      this.providers.push({
        provider: 'gemini',
        apiKey: process.env.GEMINI_API_KEY,
        model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
        enabled: process.env.ENABLE_GEMINI !== 'false',
      });

      this.clients.set(
        'gemini',
        new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      );

      logger.info('Gemini AI provider initialized');
    }

    // OpenAI (third priority - reliable but more expensive)
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

      logger.info('OpenAI provider initialized');
    }

    // Claude (fourth priority - fallback)
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

      logger.info('Anthropic Claude provider initialized');
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
    const {
      temperature = 0.0,
      maxTokens = 4096,
      systemPrompt,
      preferredProvider,
    } = options;

    // Add system prompt if provided
    const fullMessages = systemPrompt
      ? [{ role: 'system' as const, content: systemPrompt }, ...messages]
      : messages;

    // Sort providers by preference
    let sortedProviders = [...this.providers.filter((p) => p.enabled)];
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

        logger.info(
          `Successfully used ${providerConfig.provider} (${providerConfig.model})`
        );

        return result;
      } catch (error: any) {
        const errorMsg = error.message || String(error);
        logger.warn(
          `Failed to use ${providerConfig.provider}: ${errorMsg}`
        );
        errors.push({
          provider: providerConfig.provider,
          error: errorMsg,
        });

        // Continue to next provider
        continue;
      }
    }

    // All providers failed
    const errorSummary = errors
      .map((e) => `${e.provider}: ${e.error}`)
      .join('; ');
    throw new Error(
      `All AI providers failed. Errors: ${errorSummary}`
    );
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

    const content =
      response.content[0]?.type === 'text' ? response.content[0].text : '';

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
    return this.providers.some(
      (p) => p.provider === provider && p.enabled
    );
  }
}

// Singleton instance
export const aiProvider = new MultiAIProvider();
