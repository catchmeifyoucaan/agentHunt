/**
 * OpenAI LLM Provider
 * Supports GPT-4, GPT-4 Turbo, and GPT-3.5 models
 */

import OpenAI from 'openai';
import { BaseLLMProvider } from './base';
import { LLMConfig, LLMMessage, LLMResponse } from '../types';
import logger from '../../../utils/logger';

export class OpenAIProvider extends BaseLLMProvider {
  private client: OpenAI;

  constructor(config: LLMConfig) {
    super(config);
    this.validateConfig();

    this.client = new OpenAI({
      apiKey: config.apiKey || process.env.OPENAI_API_KEY,
      baseURL: config.baseURL,
    });
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        temperature: this.config.temperature || 0.7,
        max_tokens: this.config.maxTokens || 4096,
      });

      const choice = response.choices[0];

      return {
        content: choice.message.content || '',
        model: response.model,
        usage: response.usage ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        } : undefined,
        finishReason: choice.finish_reason || undefined,
      };
    } catch (error: any) {
      logger.error({ error, model: this.config.model }, 'OpenAI API error');
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test with minimal request
      await this.client.chat.completions.create({
        model: this.config.model,
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      });
      return true;
    } catch (error) {
      logger.warn({ error, model: this.config.model }, 'OpenAI provider not available');
      return false;
    }
  }

  getName(): string {
    return 'openai';
  }

  protected validateConfig(): void {
    super.validateConfig();

    if (!this.config.apiKey && !process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured');
    }

    // Validate model name
    const validModels = [
      'gpt-4',
      'gpt-4-turbo',
      'gpt-4-turbo-preview',
      'gpt-4-0125-preview',
      'gpt-4-1106-preview',
      'gpt-3.5-turbo',
      'gpt-3.5-turbo-16k',
    ];

    if (!validModels.some(m => this.config.model.startsWith(m))) {
      logger.warn({ model: this.config.model }, 'Unrecognized OpenAI model');
    }
  }
}
