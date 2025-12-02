/**
 * Grok 4 Fast Reasoning Provider (Azure)
 * Uses Grok 4 model via Azure OpenAI-compatible endpoint
 * Optimized for fast reasoning tasks
 */

import { BaseLLMProvider } from './base';
import { LLMConfig, LLMMessage, LLMResponse } from '../types';
import logger from '../../../utils/logger';
import axios, { AxiosInstance } from 'axios';

export class GrokProvider extends BaseLLMProvider {
  private client: AxiosInstance;
  private apiUrl: string;
  private apiKey: string;

  constructor(config: LLMConfig) {
    super(config);

    this.apiKey = config.apiKey || process.env.GROK_API_KEY || '';
    this.apiUrl = config.baseURL || process.env.GROK_API_URL || '';

    if (!this.apiKey) {
      throw new Error('GROK_API_KEY environment variable is required for Grok provider');
    }

    if (!this.apiUrl) {
      throw new Error('GROK_API_URL environment variable is required for Grok provider');
    }

    // Create axios client with headers (Azure OpenAI compatible)
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: config.timeout || 60000, // 60s default timeout
    });

    this.validateConfig();
    logger.info({ model: this.config.model }, 'Grok 4 (Azure) provider initialized');
  }

  /**
   * Send chat messages to Grok API
   */
  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      const startTime = Date.now();

      // Convert messages to OpenAI-compatible format
      const payload = {
        model: this.config.model,
        messages: messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        temperature: this.config.temperature || 0.2,
        max_tokens: this.config.maxTokens || 500,
      };

      logger.debug(
        {
          model: this.config.model,
          messageCount: messages.length,
          temperature: payload.temperature,
          maxTokens: payload.max_tokens,
        },
        'Sending request to Grok 4'
      );

      // Make API call
      const response = await this.client.post('', payload);

      const duration = Date.now() - startTime;

      // Extract response
      const data = response.data;
      const choice = data.choices?.[0];

      if (!choice) {
        throw new Error('No choices in Grok API response');
      }

      const llmResponse: LLMResponse = {
        content: choice.message?.content || '',
        model: data.model || this.config.model,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens || 0,
              completionTokens: data.usage.completion_tokens || 0,
              totalTokens: data.usage.total_tokens || 0,
            }
          : undefined,
        finishReason: choice.finish_reason || 'stop',
        cached: false,
      };

      logger.debug(
        {
          model: llmResponse.model,
          contentLength: llmResponse.content.length,
          tokens: llmResponse.usage?.totalTokens,
          duration,
        },
        'Grok 4 response received'
      );

      return llmResponse;
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          response: error.response?.data,
          status: error.response?.status,
        },
        'Grok 4 API request failed'
      );

      // Provide detailed error message
      if (error.response) {
        throw new Error(
          `Grok API error (${error.response.status}): ${
            error.response.data?.error?.message || error.message
          }`
        );
      } else if (error.request) {
        throw new Error('Grok API request failed: No response received');
      } else {
        throw new Error(`Grok inference failed: ${error.message}`);
      }
    }
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check if API key is configured
      if (!this.apiKey || !this.apiUrl) {
        logger.warn('Grok provider: API key or URL not configured');
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error }, 'Grok provider availability check failed');
      return false;
    }
  }

  /**
   * Get provider name
   */
  getName(): string {
    return 'grok';
  }

  /**
   * Validate Grok-specific configuration
   */
  protected validateConfig(): void {
    super.validateConfig();

    if (!this.apiKey) {
      throw new Error('API key (GROK_API_KEY) is required for Grok provider');
    }

    if (!this.apiUrl) {
      throw new Error('API URL (GROK_API_URL) is required for Grok provider');
    }
  }

  /**
   * Get API endpoint (for debugging)
   */
  getEndpoint(): string {
    return this.apiUrl;
  }
}
