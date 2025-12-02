/**
 * Anthropic Claude LLM Provider
 * Supports Claude 3 Opus, Sonnet, and Haiku models
 */

import Anthropic from '@anthropic-ai/sdk';
import { BaseLLMProvider } from './base';
import { LLMConfig, LLMMessage, LLMResponse } from '../types';
import logger from '../../../utils/logger';

export class ClaudeProvider extends BaseLLMProvider {
  private client: Anthropic;

  constructor(config: LLMConfig) {
    super(config);
    this.validateConfig();

    this.client = new Anthropic({
      apiKey: config.apiKey || process.env.ANTHROPIC_API_KEY,
    });
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      // Convert messages to Anthropic format
      const systemMessage = messages.find((m) => m.role === 'system');
      const userMessages = messages.filter((m) => m.role !== 'system');

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens || 4096,
        temperature: this.config.temperature || 0.7,
        system: systemMessage?.content,
        messages: userMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      });

      const content = response.content[0]?.type === 'text' ? response.content[0].text : '';

      return {
        content,
        model: response.model,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.input_tokens + response.usage.output_tokens,
        },
        finishReason: response.stop_reason || undefined,
      };
    } catch (error: any) {
      logger.error({ error, model: this.config.model }, 'Claude API error');
      throw new Error(`Claude API error: ${error.message}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Test with minimal request
      await this.client.messages.create({
        model: this.config.model,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'test' }],
      });
      return true;
    } catch (error) {
      logger.warn({ error, model: this.config.model }, 'Claude provider not available');
      return false;
    }
  }

  getName(): string {
    return 'claude';
  }

  protected validateConfig(): void {
    super.validateConfig();

    if (!this.config.apiKey && !process.env.ANTHROPIC_API_KEY) {
      throw new Error('Claude API key not configured');
    }

    // Validate model name
    const validModels = [
      'claude-3-opus-20240229',
      'claude-3-sonnet-20240229',
      'claude-3-haiku-20240307',
      'claude-3-5-sonnet-20241022',
    ];

    if (!validModels.some((m) => this.config.model.includes(m.split('-').slice(0, 3).join('-')))) {
      logger.warn({ model: this.config.model }, 'Unrecognized Claude model');
    }
  }
}
