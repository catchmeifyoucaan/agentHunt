import { BaseLLMProvider } from './base';
import { LLMConfig, LLMResponse } from '../types';
import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../../../utils/logger';

export class GeminiProvider extends BaseLLMProvider {
  private client: GoogleGenerativeAI;
  private model: string;

  constructor(config: LLMConfig) {
    super(config);
    if (!config.apiKey) {
      throw new Error('Gemini API key is required');
    }
    this.client = new GoogleGenerativeAI(config.apiKey);
    this.model = config.model || 'gemini-1.5-pro';
  }

  getName(): string {
    return 'gemini';
  }

  async isAvailable(): Promise<boolean> {
    return true; // Gemini is available if API key is set
  }

  async complete(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const model = this.client.getGenerativeModel({ model: this.model });

      const fullPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt;

      const result = await model.generateContent(fullPrompt);
      const response = result.response;
      return response.text();
    } catch (error: any) {
      logger.error({ error, model: this.model }, 'Gemini completion failed');
      throw new Error(`Gemini API error: ${error.message}`);
    }
  }

  async chat(messages: Array<{ role: string; content: string }>): Promise<LLMResponse> {
    // Convert messages to a single prompt
    const prompt = messages.map((m) => `${m.role}: ${m.content}`).join('\n\n');
    const result = await this.complete(prompt);
    return {
      content: result,
      model: this.model,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    };
  }

  async reason(
    prompt: string,
    systemPrompt?: string
  ): Promise<{
    reasoning: string;
    conclusion: string;
    confidence: number;
  }> {
    const response = await this.complete(prompt, systemPrompt);

    // Parse response for reasoning structure
    return {
      reasoning: response,
      conclusion: response,
      confidence: 0.8,
    };
  }
}
