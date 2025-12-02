/**
 * Base LLM Provider Interface
 * All providers must implement this interface
 */

import { LLMConfig, LLMMessage, LLMResponse } from '../types';

export abstract class BaseLLMProvider {
  protected config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  /**
   * Send a prompt to the LLM and get a response
   */
  abstract chat(messages: LLMMessage[]): Promise<LLMResponse>;

  /**
   * Send a single prompt (convenience method)
   */
  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    const messages: LLMMessage[] = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const response = await this.chat(messages);
    return response.content;
  }

  /**
   * Check if the provider is available/configured
   */
  abstract isAvailable(): Promise<boolean>;

  /**
   * Get provider name
   */
  abstract getName(): string;

  /**
   * Get model name
   */
  getModel(): string {
    return this.config.model;
  }

  /**
   * Validate configuration
   */
  protected validateConfig(): void {
    if (!this.config.model) {
      throw new Error(`Model not specified for ${this.getName()}`);
    }
  }
}
