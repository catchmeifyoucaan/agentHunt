/**
 * LLM Engine - Main interface for all LLM operations
 * Provides high-level methods for reasoning, code generation, etc.
 */

import { BaseLLMProvider } from './providers/base';
import { ClaudeProvider } from './providers/claude';
import { OpenAIProvider } from './providers/openai';
import { GeminiProvider } from './providers/gemini';
import { LocalProvider } from './providers/local';
import { ServerlessProvider } from './providers/serverless';
import { GrokProvider } from './providers/grok';
import { BedrockProvider } from './providers/bedrock';
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
    // Serverless inference provider (PRIORITY - most cost-effective)
    if (process.env.MODEL_ACCESS_KEY) {
      try {
        const serverless = new ServerlessProvider({
          provider: 'serverless',
          model: process.env.SERVERLESS_MODEL || 'deepseek-r1-distill-llama-70b',
          apiKey: process.env.MODEL_ACCESS_KEY,
          baseURL: process.env.SERVERLESS_API_URL || 'https://inference.do-ai.run/v1/chat/completions',
          temperature: parseFloat(process.env.SERVERLESS_TEMPERATURE || '0.2'),
          maxTokens: parseInt(process.env.SERVERLESS_MAX_TOKENS || '350'),
        });
        this.providers.set('serverless', serverless);
        logger.info('Serverless inference provider initialized (DeepSeek R1 Distill)');
      } catch (error: any) {
        logger.error({ error }, 'Failed to initialize serverless provider');
      }
    }

    // Gemini provider (Google)
    if (process.env.GEMINI_API_KEY) {
      try {
        const gemini = new GeminiProvider({
          provider: 'gemini',
          model: process.env.GEMINI_MODEL || 'gemini-1.5-pro',
          apiKey: process.env.GEMINI_API_KEY,
        });
        this.providers.set('gemini', gemini);
        logger.info('Gemini provider initialized');
      } catch (error: any) {
        logger.error({ error }, 'Failed to initialize Gemini provider');
      }
    }

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

    // Grok 4 provider (Azure)
    if (process.env.GROK_API_KEY && process.env.GROK_API_URL) {
      try {
        const grok = new GrokProvider({
          provider: 'grok',
          model: process.env.GROK_MODEL || 'grok-4-fast-reasoning',
          apiKey: process.env.GROK_API_KEY,
          baseURL: process.env.GROK_API_URL,
          temperature: parseFloat(process.env.GROK_TEMPERATURE || '0.2'),
          maxTokens: parseInt(process.env.GROK_MAX_TOKENS || '500'),
        });
        this.providers.set('grok', grok);
        logger.info('Grok 4 (Azure) provider initialized');
      } catch (error: any) {
        logger.error({ error }, 'Failed to initialize Grok provider');
      }
    }

    // AWS Bedrock Claude provider (for manager/planner agent)
    if (process.env.BEDROCK_API_KEY) {
      try {
        const bedrock = new BedrockProvider({
          provider: 'bedrock',
          model: process.env.BEDROCK_MODEL || 'anthropic.claude-opus-4-20250514',
          apiKey: process.env.BEDROCK_API_KEY,
          temperature: parseFloat(process.env.BEDROCK_TEMPERATURE || '0.7'),
          maxTokens: parseInt(process.env.BEDROCK_MAX_TOKENS || '4096'),
        });
        this.providers.set('bedrock', bedrock);
        logger.info('AWS Bedrock Claude provider initialized');
      } catch (error: any) {
        logger.error({ error }, 'Failed to initialize Bedrock provider');
      }
    }

    // Set default provider - prioritize in this order to avoid API quota issues:
    // 1. Serverless (Gradient/DeepSeek) - most cost-effective
    // 2. Gemini (free tier but has quota)
    // 3. Grok, Claude, Bedrock
    // 4. OpenAI (LAST - has quota issues)
    if (this.providers.has('serverless')) {
      this.defaultProvider = 'serverless';
      logger.info('Using serverless (Gradient) as default provider');
    } else if (process.env.GEMINI_API_KEY && this.providers.has('gemini')) {
      this.defaultProvider = 'gemini';
      logger.info('Using Gemini as default provider');
    } else if (this.providers.has('grok')) {
      this.defaultProvider = 'grok';
    } else if (this.providers.has('claude')) {
      this.defaultProvider = 'claude';
    } else if (this.providers.has('bedrock')) {
      this.defaultProvider = 'bedrock';
    } else if (this.providers.has('openai')) {
      this.defaultProvider = 'openai';
      logger.warn('Using OpenAI as default (may have quota issues)');
    } else if (this.providers.has('local')) {
      this.defaultProvider = 'local';
    } else {
      logger.warn('No LLM providers configured!');
    }
  }

  /**
   * Get provider (with fallback)
   * Supports comma-separated list of preferred providers (e.g., "grok,serverless")
   */
  private async getProvider(preferredProvider?: string): Promise<BaseLLMProvider> {
    // Parse preferred providers (support comma-separated list)
    const preferredProviders = preferredProvider
      ? preferredProvider.split(',').map(p => p.trim())
      : [this.defaultProvider];

    // Try each preferred provider in order
    for (const providerName of preferredProviders) {
      if (this.providers.has(providerName)) {
        const provider = this.providers.get(providerName)!;
        const available = await provider.isAvailable();

        if (available) {
          logger.debug({ provider: providerName }, 'Using provider');
          return provider;
        } else {
          logger.warn({ provider: providerName }, 'Provider configured but not available, trying next');
        }
      } else {
        logger.warn({ provider: providerName }, 'Provider not configured, trying next');
      }
    }

    // If none of the preferred providers are available, try any available provider
    logger.warn(
      { preferredProviders },
      'None of the preferred providers available, trying any available provider'
    );

    for (const [name, p] of this.providers.entries()) {
      const available = await p.isAvailable();
      if (available) {
        logger.info({ fallbackProvider: name }, 'Using fallback provider');
        return p;
      }
    }

    // Last resort: return default provider (even if not available)
    logger.error('No providers available! Using default provider anyway');
    return this.providers.get(this.defaultProvider)!;
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
   * Simple text completion (for structured data extraction, parsing, etc.)
   */
  async complete(prompt: string, systemPrompt?: string, provider?: string): Promise<string> {
    const cacheKey = `llm:complete:${this.hashPrompt(prompt)}`;

    // Check cache
    if (this.cacheEnabled) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        logger.debug('Using cached completion result');
        return cached;
      }
    }

    const llm = await this.getProvider(provider);

    try {
      const response = await llm.complete(prompt, systemPrompt);

      // Cache result
      if (this.cacheEnabled) {
        await this.redis.setex(cacheKey, this.cacheTTL, response);
      }

      return response;
    } catch (error: any) {
      logger.error({ error, prompt: prompt.substring(0, 100) }, 'Completion failed');
      throw new Error(`LLM completion failed: ${error.message}`);
    }
  }

  /**
   * Ensemble reasoning (query multiple models and build consensus)
   */
  async reasonWithEnsemble(prompt: string, context?: Record<string, any>): Promise<EnsembleReasoningResult> {
    const providers = ['grok', 'serverless', 'bedrock', 'claude', 'openai', 'local'].filter(p => this.providers.has(p));

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
   * Analyze vulnerability to determine if true positive and severity
   */
  async analyzeVulnerability(
    finding: {
      url: string;
      type: string;
      evidence: string;
      httpRequest?: string;
      httpResponse?: string;
      additionalContext?: Record<string, any>;
    },
    provider?: string
  ): Promise<{
    isTruePositive: boolean;
    confidence: number;
    reasoning: string;
    severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
    suggestedActions: string[];
    exploitability?: number;
    impactAnalysis?: string;
  }> {
    const llm = await this.getProvider(provider);

    const prompt = `Analyze this potential security vulnerability finding:

URL: ${finding.url}
Vulnerability Type: ${finding.type}
Evidence: ${finding.evidence}

${finding.httpRequest ? `HTTP Request:\n\`\`\`http\n${finding.httpRequest}\n\`\`\`` : ''}

${finding.httpResponse ? `HTTP Response:\n\`\`\`http\n${finding.httpResponse}\n\`\`\`` : ''}

${finding.additionalContext ? `Additional Context:\n${JSON.stringify(finding.additionalContext, null, 2)}` : ''}

Perform a thorough security analysis:

1. **True/False Positive Assessment**:
   - Is this a genuine security vulnerability or a false positive?
   - What evidence supports this conclusion?
   - Are there any indicators that suggest this is benign?

2. **Severity Analysis**:
   - What is the actual security impact?
   - Consider: Confidentiality, Integrity, Availability (CIA triad)
   - Assess using: info, low, medium, high, critical

3. **Exploitability**:
   - How difficult is this to exploit? (0.0 = impossible, 1.0 = trivial)
   - What skills/tools are required?
   - Are there any mitigating factors?

4. **Impact Analysis**:
   - What could an attacker achieve?
   - What data/systems are at risk?
   - Business impact considerations

5. **Recommended Actions**:
   - What should be done to verify this finding?
   - What remediation steps are recommended?
   - Any additional testing needed?

Respond in JSON format:
{
  "isTruePositive": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation of your analysis",
  "severity": "info|low|medium|high|critical",
  "exploitability": 0.0-1.0,
  "impactAnalysis": "description of potential impact",
  "suggestedActions": ["action 1", "action 2", "action 3"]
}`;

    const systemPrompt = `You are an expert security researcher and penetration tester with deep knowledge of:
- OWASP Top 10 vulnerabilities
- CVE analysis and exploitation
- False positive identification
- Security impact assessment
- CVSS scoring methodology

Provide accurate, thorough analysis. Be conservative but realistic.
If uncertain, provide your reasoning and suggest verification steps.`;

    try {
      const response = await llm.complete(prompt, systemPrompt);

      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const analysis = JSON.parse(jsonMatch[0]);

      // Validate response structure
      if (analysis.isTruePositive === undefined || !analysis.confidence) {
        throw new Error('Invalid response structure');
      }

      // Set defaults for optional fields
      return {
        isTruePositive: analysis.isTruePositive ?? true,
        confidence: analysis.confidence ?? 0.5,
        reasoning: analysis.reasoning ?? 'Analysis completed',
        severity: analysis.severity ?? 'medium',
        suggestedActions: analysis.suggestedActions ?? ['Manual review required'],
        exploitability: analysis.exploitability,
        impactAnalysis: analysis.impactAnalysis,
      };
    } catch (error: any) {
      logger.error(
        { error, findingType: finding.type },
        'Vulnerability analysis failed, using fallback'
      );

      // Conservative fallback: assume true positive
      return {
        isTruePositive: true,
        confidence: 0.5,
        reasoning: `LLM analysis failed: ${error.message}. Manual review recommended.`,
        severity: this.inferSeverityFromType(finding.type),
        suggestedActions: ['Manual verification required', 'Review HTTP request/response'],
        exploitability: 0.5,
        impactAnalysis: 'Unable to assess - requires manual review',
      };
    }
  }

  /**
   * Infer severity from vulnerability type (fallback)
   */
  private inferSeverityFromType(type: string): 'info' | 'low' | 'medium' | 'high' | 'critical' {
    const typeLower = type.toLowerCase();

    // Critical vulnerabilities
    if (
      typeLower.includes('rce') ||
      typeLower.includes('remote code execution') ||
      typeLower.includes('command injection')
    ) {
      return 'critical';
    }

    // High severity
    if (
      typeLower.includes('sql injection') ||
      typeLower.includes('sqli') ||
      typeLower.includes('auth bypass') ||
      typeLower.includes('authentication') ||
      typeLower.includes('xxe') ||
      typeLower.includes('deserialization')
    ) {
      return 'high';
    }

    // Medium severity
    if (
      typeLower.includes('xss') ||
      typeLower.includes('cross-site scripting') ||
      typeLower.includes('csrf') ||
      typeLower.includes('idor') ||
      typeLower.includes('ssrf') ||
      typeLower.includes('lfi')
    ) {
      return 'medium';
    }

    // Low severity
    if (
      typeLower.includes('information disclosure') ||
      typeLower.includes('misconfiguration') ||
      typeLower.includes('header')
    ) {
      return 'low';
    }

    // Default to medium
    return 'medium';
  }

  /**
   * Get provider stats
   */
  getStats(): { providers: string[]; defaultProvider: string; cacheEnabled: boolean } {
    return {
      providers: Array.from(this.providers.keys()),
      defaultProvider: this.defaultProvider,
      cacheEnabled: this.cacheEnabled,
    };
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
