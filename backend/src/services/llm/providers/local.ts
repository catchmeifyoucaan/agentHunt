/**
 * Local LLM Provider (Ollama)
 * Supports locally hosted models via Ollama
 */

import axios from 'axios';
import { BaseLLMProvider } from './base';
import { LLMConfig, LLMMessage, LLMResponse } from '../types';
import logger from '../../../utils/logger';

export class LocalProvider extends BaseLLMProvider {
  private baseURL: string;

  constructor(config: LLMConfig) {
    super(config);
    this.validateConfig();
    this.baseURL = config.baseURL || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  }

  async chat(messages: LLMMessage[]): Promise<LLMResponse> {
    try {
      // Ollama chat API
      const response = await axios.post(
        `${this.baseURL}/api/chat`,
        {
          model: this.config.model,
          messages: messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          stream: false,
          options: {
            temperature: this.config.temperature || 0.7,
            num_predict: this.config.maxTokens || 4096,
          },
        },
        {
          timeout: this.config.timeout || 120000, // 2 minutes default
        }
      );

      const data = response.data;

      return {
        content: data.message?.content || '',
        model: this.config.model,
        usage:
          data.prompt_eval_count && data.eval_count
            ? {
                promptTokens: data.prompt_eval_count,
                completionTokens: data.eval_count,
                totalTokens: data.prompt_eval_count + data.eval_count,
              }
            : undefined,
      };
    } catch (error: any) {
      logger.error({ error, model: this.config.model, baseURL: this.baseURL }, 'Local LLM error');

      if (error.code === 'ECONNREFUSED') {
        throw new Error('Ollama server not running. Start with: ollama serve');
      }

      throw new Error(`Local LLM error: ${error.message}`);
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Check if Ollama is running
      const response = await axios.get(`${this.baseURL}/api/tags`, {
        timeout: 5000,
      });

      // Check if our model is available
      const models = response.data.models || [];
      const modelAvailable = models.some((m: any) => m.name === this.config.model);

      if (!modelAvailable) {
        logger.warn(
          { model: this.config.model, availableModels: models.map((m: any) => m.name) },
          'Model not available in Ollama'
        );
        return false;
      }

      return true;
    } catch (error) {
      logger.warn({ error, baseURL: this.baseURL }, 'Ollama not available');
      return false;
    }
  }

  getName(): string {
    return 'local';
  }

  protected validateConfig(): void {
    super.validateConfig();

    // Common Ollama models
    const commonModels = [
      'llama2',
      'llama2:13b',
      'llama2:70b',
      'mistral',
      'mixtral',
      'codellama',
      'deepseek-coder',
      'wizardcoder',
    ];

    if (!commonModels.some((m) => this.config.model.includes(m))) {
      logger.info({ model: this.config.model }, 'Using custom Ollama model');
    }
  }

  /**
   * Pull a model from Ollama registry
   */
  async pullModel(): Promise<void> {
    try {
      logger.info({ model: this.config.model }, 'Pulling model from Ollama...');

      await axios.post(
        `${this.baseURL}/api/pull`,
        { name: this.config.model },
        { timeout: 600000 } // 10 minutes for model download
      );

      logger.info({ model: this.config.model }, 'Model pulled successfully');
    } catch (error: any) {
      logger.error({ error, model: this.config.model }, 'Failed to pull model');
      throw new Error(`Failed to pull model: ${error.message}`);
    }
  }
}
