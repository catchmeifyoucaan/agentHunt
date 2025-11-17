/**
 * AWS Bedrock Claude Provider
 * Supports Claude models via AWS Bedrock
 * Used for high-level planning and strategic decision making
 */

import { BaseLLMProvider } from './base';
import { LLMConfig, LLMMessage, LLMResponse } from '../types';
import logger from '../../../utils/logger';
import axios, { AxiosInstance } from 'axios';

export class BedrockProvider extends BaseLLMProvider {
  private client: AxiosInstance;
  private apiKey: string;
  private region: string;

  constructor(config: LLMConfig) {
    super(config);

    this.apiKey = config.apiKey || process.env.BEDROCK_API_KEY || '';
    this.region = process.env.BEDROCK_REGION || 'us-east-1';

    if (!this.apiKey) {
      throw new Error('BEDROCK_API_KEY environment variable is required for Bedrock provider');
    }

    // Decode base64 API key if needed
    let decodedKey = this.apiKey;
    try {
      // Check if it's base64 encoded (starts with common base64 patterns)
      if (this.apiKey.match(/^[A-Za-z0-9+/]+=*$/)) {
        decodedKey = Buffer.from(this.apiKey, 'base64').toString('utf-8');
      }
    } catch (e) {
      // If decoding fails, use original key
      logger.warn('Failed to decode Bedrock API key, using as-is');
    }

    // Create axios client
    this.client = axios.create({
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${decodedKey}`,
      },
      timeout: config.timeout || 90000, // 90s default timeout (Claude Opus can be slower)
    });

    this.validateConfig();
    logger.info({ model: this.config.model, region: this.region }, 'AWS Bedrock Claude provider initialized');
  }

  /**
   * Send chat messages to Bedrock Claude API
   */
  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      const startTime = Date.now();

      // Convert messages to Anthropic format
      const systemMessage = messages.find(m => m.role === 'system');
      const userMessages = messages.filter(m => m.role !== 'system');

      // Bedrock uses Anthropic's message format
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 0.7,
        system: systemMessage?.content,
        messages: userMessages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      };

      logger.debug(
        {
          model: this.config.model,
          messageCount: messages.length,
          temperature: payload.temperature,
          maxTokens: payload.max_tokens,
        },
        'Sending request to AWS Bedrock Claude'
      );

      // Construct Bedrock endpoint
      const modelId = this.config.model || 'anthropic.claude-opus-4-20250514';
      const endpoint = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${modelId}/invoke`;

      // Make API call
      const response = await this.client.post(endpoint, payload);

      const duration = Date.now() - startTime;

      // Extract response (Bedrock returns Anthropic format)
      const data = response.data;
      const content = data.content?.[0]?.type === 'text'
        ? data.content[0].text
        : '';

      const llmResponse: LLMResponse = {
        content,
        model: data.model || this.config.model,
        usage: data.usage ? {
          promptTokens: data.usage.input_tokens || 0,
          completionTokens: data.usage.output_tokens || 0,
          totalTokens: (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0),
        } : undefined,
        finishReason: data.stop_reason || 'stop',
        cached: false,
      };

      logger.debug(
        {
          model: llmResponse.model,
          contentLength: llmResponse.content.length,
          tokens: llmResponse.usage?.totalTokens,
          duration,
        },
        'AWS Bedrock Claude response received'
      );

      return llmResponse;
    } catch (error: any) {
      logger.error(
        {
          error: error.message,
          response: error.response?.data,
          status: error.response?.status,
        },
        'AWS Bedrock Claude API request failed'
      );

      // Provide detailed error message
      if (error.response) {
        throw new Error(
          `Bedrock API error (${error.response.status}): ${
            error.response.data?.error?.message || error.message
          }`
        );
      } else if (error.request) {
        throw new Error('Bedrock API request failed: No response received');
      } else {
        throw new Error(`Bedrock inference failed: ${error.message}`);
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
        logger.warn('Bedrock provider: BEDROCK_API_KEY not configured');
        return false;
      }

      return true;
    } catch (error) {
      logger.error({ error }, 'Bedrock provider availability check failed');
      return false;
    }
  }

  /**
   * Get provider name
   */
  getName(): string {
    return 'bedrock';
  }

  /**
   * Validate Bedrock-specific configuration
   */
  protected validateConfig(): void {
    super.validateConfig();

    if (!this.apiKey) {
      throw new Error('API key (BEDROCK_API_KEY) is required for Bedrock provider');
    }

    // Validate model name for Bedrock Claude
    const validModels = [
      'anthropic.claude-opus-4',
      'anthropic.claude-3-opus',
      'anthropic.claude-3-sonnet',
      'anthropic.claude-3-haiku',
    ];

    if (!validModels.some(m => this.config.model.includes(m))) {
      logger.warn({ model: this.config.model }, 'Unrecognized Bedrock Claude model');
    }
  }
}
