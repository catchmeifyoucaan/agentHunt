/**
 * Serverless Inference Provider
 * Uses DeepSeek R1 Distill model via serverless endpoint
 * Optimized for cost-effective high-volume API calls
 */

import { BaseLLMProvider } from './base';
import { LLMConfig, LLMMessage, LLMResponse } from '../types';
import logger from '../../../utils/logger';
import axios, { AxiosInstance } from 'axios';

export class ServerlessProvider extends BaseLLMProvider {
  private client: AxiosInstance;
  private apiUrl: string;
  private apiKey: string;

  constructor(config: LLMConfig) {
    super(config);

    this.apiKey = config.apiKey || process.env.MODEL_ACCESS_KEY || '';
    this.apiUrl = config.baseURL || 'https://inference.do-ai.run/v1/chat/completions';

    if (!this.apiKey) {
      throw new Error('MODEL_ACCESS_KEY environment variable is required for serverless provider');
    }

    // Create axios client with headers
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: config.timeout || 60000, // 60s default timeout
    });

    this.validateConfig();
    logger.info({ model: this.config.model }, 'Serverless inference provider initialized');
  }

  /**
   * Send chat messages to serverless inference API
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
        max_tokens: this.config.maxTokens || 350,
      };

      logger.debug(
        {
          model: this.config.model,
          messageCount: messages.length,
          temperature: payload.temperature,
          maxTokens: payload.max_tokens,
        },
        'Sending request to serverless inference'
      );

      // Make API call
      const response = await this.client.post('', payload);

      const duration = Date.now() - startTime;

      // Extract response
      const data = response.data;
      const choice = data.choices?.[0];

      if (!choice) {
        throw new Error('No choices in serverless API response');
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
        'Serverless inference response received'
      );

      return llmResponse;
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          response: error.response?.data,
          status: error.response?.status,
        },
        'Serverless inference request failed'
      );

      // Provide detailed error message
      if (error.response) {
        throw new Error(
          `Serverless API error (${error.response.status}): ${
            error.response.data?.error?.message || error.message
          }`
        );
      } else if (error.request) {
        throw new Error('Serverless API request failed: No response received');
      } else {
        throw new Error(`Serverless inference failed: ${error.message}`);
      }
    }
  }

  /**
   * Check if provider is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Check if API key is configured
      if (!this.apiKey) {
        logger.warn('Serverless provider: MODEL_ACCESS_KEY not configured');
        return false;
      }

      // Optional: Ping the API with a minimal request
      // For now, just check configuration
      return true;
    } catch (error) {
      logger.error({ error }, 'Serverless provider availability check failed');
      return false;
    }
  }

  /**
   * Get provider name
   */
  getName(): string {
    return 'serverless';
  }

  /**
   * Validate serverless-specific configuration
   */
  protected validateConfig(): void {
    super.validateConfig();

    if (!this.apiKey) {
      throw new Error('API key (MODEL_ACCESS_KEY) is required for serverless provider');
    }

    if (!this.apiUrl) {
      throw new Error('API URL is required for serverless provider');
    }
  }

  /**
   * Get API endpoint (for debugging)
   */
  getEndpoint(): string {
    return this.apiUrl;
  }
}
