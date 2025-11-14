/**
 * LLM Engine - Main interface for all LLM operations
 * Provides high-level methods for reasoning, code generation, etc.
 */

import { BaseLLMProvider } from './providers/base';
import { ClaudeProvider } from './providers/claude';
import { OpenAIProvider } from './providers/openai';
import { LocalProvider } from './providers/local';
import {
  LLMConfig,
  ReasoningResult,
  ExploitGenerationRequest,
  NucleiTemplateRequest,
  CodeGenerationRequest,
  EnsembleReasoningResult,
} from './types';
import logger from '../../utils/logger';
import Redis from 'ioredis';

class LLMEngine {
  private providers: Map<string, BaseLLMProvider> = new Map();
  private defaultProvider: string = 'claude';
  private redis: Redis;
  private cacheEnabled: boolean = true;
  private cacheTTL: number = 3600; // 1 hour

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    this.initializeProviders();
  }

  private initializeProviders(): void {
    // Claude provider
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const claude = new ClaudeProvider({
          provider: 'claude',
          model: process.env.CLAUDE_MODEL || 'claude-3-5-sonnet-20241022',
          apiKey: process.env.ANTHROPIC_API_KEY,
        });
        this.providers.set('claude', claude);
        logger.info('Claude provider initialized');
      } catch (error: any) {
        logger.error({ error }, 'Failed to initialize Claude provider');
      }
    }

    // OpenAI provider
    if (process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAIProvider({
          provider: 'openai',
          model: process.env.OPENAI_MODEL || 'gpt-4-turbo-preview',
          apiKey: process.env.OPENAI_API_KEY,
        });
        this.providers.set('openai', openai);
        logger.info('OpenAI provider initialized');
      } catch (error: any) {
        logger.error({ error }, 'Failed to initialize OpenAI provider');
      }
    }

    // Local (Ollama) provider
    if (process.env.OLLAMA_ENABLED === 'true') {
      try {
        const local = new LocalProvider({
          provider: 'local',
          model: process.env.OLLAMA_MODEL || 'llama2',
          baseURL: process.env.OLLAMA_BASE_URL,
        });
        this.providers.set('local', local);
        logger.info('Local (Ollama) provider initialized');
      } catch (error: any) {
        logger.error({ error }, 'Failed to initialize local provider');
      }
    }

    // Set default provider
    if (this.providers.has('claude')) {
      this.defaultProvider = 'claude';
    } else if (this.providers.has('openai')) {
      this.defaultProvider = 'openai';
    } else if (this.providers.has('local')) {
      this.defaultProvider = 'local';
    } else {
      logger.warn('No LLM providers configured!');
    }
  }

  /**
   * Get provider (with fallback)
   */
  private async getProvider(preferredProvider?: string): Promise<BaseLLMProvider> {
    const providerName = preferredProvider || this.defaultProvider;

    if (!this.providers.has(providerName)) {
      logger.warn({ preferredProvider: providerName }, 'Provider not available, using default');
      return this.providers.get(this.defaultProvider)!;
    }

    const provider = this.providers.get(providerName)!;

    // Check if available
    const available = await provider.isAvailable();
    if (!available) {
      logger.warn({ provider: providerName }, 'Provider not available, trying fallback');

      // Try other providers
      for (const [name, p] of this.providers.entries()) {
        if (name !== providerName && await p.isAvailable()) {
          logger.info({ fallbackProvider: name }, 'Using fallback provider');
          return p;
        }
      }
    }

    return provider;
  }

  /**
   * High-level reasoning method
   */
  async reason(prompt: string, context?: Record<string, any>, provider?: string): Promise<ReasoningResult> {
    const cacheKey = `llm:reason:${this.hashPrompt(prompt)}`;

    // Check cache
    if (this.cacheEnabled) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.debug('Using cached reasoning result');
        return JSON.parse(cached);
      }
    }

    const llm = await this.getProvider(provider);

    const systemPrompt = `You are an expert security researcher and penetration tester.
You provide detailed, actionable reasoning and suggest specific actions to take.
When analyzing security scenarios, consider:
- Attack vectors and exploitation techniques
- Defense mechanisms (WAF, IPS, rate limiting)
- Bypass strategies
- Risk assessment
- Practical next steps

Respond in JSON format:
{
  "reasoning": "detailed explanation of your thought process",
  "actions": [
    {
      "type": "tool" | "test" | "research" | "exploit",
      "tool": "tool name if type is tool",
      "parameters": {},
      "reasoning": "why this action"
    }
  ],
  "code": "optional code snippet if applicable",
  "confidence": 0.0-1.0,
  "alternatives": [optional alternative approaches]
}`;

    const fullPrompt = context
      ? `${prompt}\n\nContext:\n${JSON.stringify(context, null, 2)}`
      : prompt;

    try {
      const response = await llm.complete(fullPrompt, systemPrompt);

      // Parse JSON response
      const result = this.parseReasoningResponse(response);

      // Cache result
      if (this.cacheEnabled) {
        await this.redis.setex(cacheKey, this.cacheTTL, JSON.stringify(result));
      }

      return result;
    } catch (error: any) {
      logger.error({ error, prompt: prompt.substring(0, 100) }, 'Reasoning failed');
      throw new Error(`LLM reasoning failed: ${error.message}`);
    }
  }

  /**
   * Ensemble reasoning (query multiple models and build consensus)
   */
  async reasonWithEnsemble(prompt: string, context?: Record<string, any>): Promise<EnsembleReasoningResult> {
    const providers = ['claude', 'openai', 'local'].filter(p => this.providers.has(p));

    if (providers.length < 2) {
      logger.warn('Not enough providers for ensemble reasoning, using single provider');
      const result = await this.reason(prompt, context);
      return {
        ...result,
        consensus: 1.0,
        models: [{
          provider: this.defaultProvider,
          model: this.providers.get(this.defaultProvider)!.getModel(),
          result,
          confidence: result.confidence,
        }],
      };
    }

    // Query all providers in parallel
    const results = await Promise.all(
      providers.map(async (providerName) => {
        try {
          const result = await this.reason(prompt, context, providerName);
          return {
            provider: providerName,
            model: this.providers.get(providerName)!.getModel(),
            result,
            confidence: result.confidence,
          };
        } catch (error: any) {
          logger.error({ error, provider: providerName }, 'Provider failed in ensemble');
          return null;
        }
      })
    );

    const validResults = results.filter(r => r !== null) as any[];

    // Build consensus
    const consensus = this.calculateConsensus(validResults);
    const bestResult = this.selectBestResult(validResults);

    return {
      ...bestResult,
      consensus,
      models: validResults,
    };
  }

  /**
   * Generate exploit code
   */
  async generateExploit(request: ExploitGenerationRequest, provider?: string): Promise<string> {
    const llm = await this.getProvider(provider);

    const prompt = `Generate a security exploit script for the following vulnerability:

Vulnerability Type: ${request.vulnerability.type}
Target: ${request.vulnerability.target}
${request.vulnerability.parameter ? `Parameter: ${request.vulnerability.parameter}` : ''}
Context: ${request.vulnerability.context}

${request.environment ? `Environment:
- WAF: ${request.environment.waf || 'Unknown'}
- IPS: ${request.environment.ips || 'Unknown'}
- Framework: ${request.environment.framework || 'Unknown'}` : ''}

Requirements:
${request.requirements?.stealthy ? '- Must be stealthy (avoid detection)' : ''}
${request.requirements?.reliable ? '- Must be reliable (high success rate)' : ''}
${request.requirements?.customized ? '- Must be customized for this exact environment' : ''}

Generate a complete, working exploit script in Python.
Include error handling, output formatting, and usage instructions.
`;

    const systemPrompt = 'You are an expert exploit developer. Generate production-ready exploit code with proper error handling and documentation.';

    const code = await llm.complete(prompt, systemPrompt);

    return this.extractCodeBlock(code);
  }

  /**
   * Generate Nuclei template
   */
  async generateNucleiTemplate(request: NucleiTemplateRequest, provider?: string): Promise<string> {
    const llm = await this.getProvider(provider);

    const prompt = `Generate a Nuclei template for the following service/vulnerability:

Service: ${request.serviceName}
${request.port ? `Port: ${request.port}` : ''}

Vulnerability:
- Type: ${request.vulnerability.type}
- Description: ${request.vulnerability.description}
- Severity: ${request.vulnerability.severity}
- Indicators: ${request.vulnerability.indicators.join(', ')}

${request.testEndpoint ? `Test Endpoint: ${request.testEndpoint}` : ''}

Generate a complete, valid Nuclei template in YAML format.
Follow Nuclei template best practices.
Include proper matchers and extractors.
`;

    const systemPrompt = 'You are an expert at creating Nuclei templates. Generate valid YAML templates following Nuclei v3 specification.';

    const template = await llm.complete(prompt, systemPrompt);

    return this.extractCodeBlock(template, 'yaml');
  }

  /**
   * General code generation
   */
  async generateCode(request: CodeGenerationRequest, provider?: string): Promise<string> {
    const llm = await this.getProvider(provider);

    const prompt = `Generate ${request.language} code for: ${request.purpose}

Requirements:
${request.requirements.map(r => `- ${r}`).join('\n')}

${request.context ? `Context:\n${JSON.stringify(request.context, null, 2)}` : ''}

Generate clean, well-documented code with error handling.
`;

    const systemPrompt = `You are an expert ${request.language} developer. Generate production-ready code with proper error handling and documentation.`;

    const code = await llm.complete(prompt, systemPrompt);

    return this.extractCodeBlock(code, request.language);
  }

  /**
   * Parse reasoning response from LLM
   */
  private parseReasoningResponse(response: string): ReasoningResult {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // Fallback: treat as plain text
      return {
        reasoning: response,
        actions: [],
        confidence: 0.5,
      };
    } catch (error) {
      logger.warn({ response: response.substring(0, 200) }, 'Failed to parse reasoning response');
      return {
        reasoning: response,
        actions: [],
        confidence: 0.5,
      };
    }
  }

  /**
   * Extract code block from markdown
   */
  private extractCodeBlock(text: string, language?: string): string {
    const pattern = language
      ? new RegExp(`\`\`\`${language}\\n([\\s\\S]*?)\`\`\``)
      : /```[\w]*\n([\s\S]*?)```/;

    const match = text.match(pattern);

    if (match) {
      return match[1].trim();
    }

    // No code block found, return as is
    return text.trim();
  }

  /**
   * Hash prompt for caching
   */
  private hashPrompt(prompt: string): string {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(prompt).digest('hex');
  }

  /**
   * Calculate consensus between multiple model results
   */
  private calculateConsensus(results: any[]): number {
    if (results.length < 2) return 1.0;

    // Simple consensus: average confidence
    const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;

    // Check action agreement
    const actions = results.map(r => r.result.actions || []);
    const actionAgreement = this.calculateActionAgreement(actions);

    return (avgConfidence + actionAgreement) / 2;
  }

  /**
   * Calculate how much actions agree
   */
  private calculateActionAgreement(actionsArray: any[][]): number {
    if (actionsArray.length < 2) return 1.0;

    // Simple: check if first action types match
    const firstActionTypes = actionsArray.map(actions =>
      actions.length > 0 ? actions[0].type : null
    );

    const matches = firstActionTypes.filter(t => t === firstActionTypes[0]).length;

    return matches / firstActionTypes.length;
  }

  /**
   * Select best result from ensemble
   */
  private selectBestResult(results: any[]): any {
    // Select result with highest confidence
    return results.reduce((best, current) =>
      current.confidence > best.confidence ? current : best
    ).result;
  }

  /**
   * Clear cache
   */
  async clearCache(): Promise<void> {
    const keys = await this.redis.keys('llm:*');
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    logger.info({ count: keys.length }, 'LLM cache cleared');
  }
}

// Singleton instance
const llmEngine = new LLMEngine();

export default llmEngine;
