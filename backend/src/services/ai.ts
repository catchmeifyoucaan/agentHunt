import { aiProvider, AIMessage } from './ai-provider';
import config from '../config';
import logger from '../utils/logger';

/**
 * AI Service - High-level AI operations for AgentHunt
 *
 * Now supports multiple AI providers with automatic fallback:
 * - Perplexity (fast, cheap)
 * - Gemini (free tier, good quality)
 * - OpenAI (reliable)
 * - Claude (premium)
 */
class AIService {
  private static instance: AIService;

  private constructor() {
    logger.info('AIService initialized with multi-provider support');
  }

  public static getInstance(): AIService {
    if (!AIService.instance) {
      AIService.instance = new AIService();
    }
    return AIService.instance;
  }

  /**
   * Triage prompt: Parse scanner output and normalize to Finding schema
   */
  public async parseAndTriageFinding(rawOutput: any): Promise<any> {
    const prompt = `You are a security vulnerability triage AI. Parse the following scanner output and extract key information.

Scanner Output:
${JSON.stringify(rawOutput, null, 2)}

Return a JSON object with this exact schema:
{
  "title": "concise title of the finding",
  "severity": "critical|high|medium|low|info",
  "confidence": 0.0-1.0,
  "description": "detailed description",
  "evidence_snippet": "key evidence from the output",
  "cwe": ["CWE-79", "CWE-89"],
  "cvss": 7.5,
  "impact": "what can an attacker do",
  "remediation": "how to fix",
  "steps": ["step 1", "step 2"],
  "required_confirmations": ["template:confirm_xss", "httpx_regex"],
  "false_positive_likelihood": 0.0-1.0,
  "reasoning": "why you assigned this severity and confidence"
}

Only return valid JSON. No explanations outside the JSON.`;

    try {
      const response = await aiProvider.chat(
        [{ role: 'user', content: prompt }],
        {
          temperature: config.anthropic.triageTemperature,
          maxTokens: 4096,
        }
      );

      logger.info(
        `Triage completed using ${response.provider} (${response.model}), tokens: ${response.tokensUsed || 'N/A'}`
      );

      // Extract JSON from response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      throw new Error('Failed to parse AI response');
    } catch (error: any) {
      logger.error({ error, rawOutput }, 'AI triage failed');
      throw error;
    }
  }

  /**
   * Manager AI: Process natural language commands
   */
  public async processManagerCommand(command: string, context: any): Promise<any> {
    const prompt = `You are the AgentHunt Manager AI. You orchestrate security testing agents based on natural language commands.

Current Context:
${JSON.stringify(context, null, 2)}

User Command: "${command}"

Parse this command and return a JSON object with:
{
  "intent": "discovery|scan|crawl|pause|resume|confirm|report",
  "entities": {
    "program": "program name or id if mentioned",
    "tools": ["tool1", "tool2"],
    "options": {"key": "value"},
    "targets": ["asset1", "asset2"]
  },
  "actions": [
    {
      "type": "create_job|update_policy|query_status",
      "params": {}
    }
  ],
  "response": "Natural language response to user explaining what will happen",
  "confidence": 0.0-1.0,
  "requires_human_approval": true|false
}

Only return valid JSON.`;

    try {
      const response = await aiProvider.chat(
        [{ role: 'user', content: prompt }],
        {
          temperature: config.anthropic.managerTemperature,
          maxTokens: 4096,
        }
      );

      logger.info(
        `Manager command processed using ${response.provider} (${response.model})`
      );

      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      throw new Error('Failed to parse AI response');
    } catch (error: any) {
      logger.error({ error, command }, 'Manager AI command processing failed');
      throw error;
    }
  }

  /**
   * Generate PoC draft
   */
  public async generatePoC(finding: any): Promise<string> {
    const prompt = `Generate a concise Proof of Concept (PoC) for this security finding.

Finding:
${JSON.stringify(finding, null, 2)}

Requirements:
- Maximum 10 steps
- No destructive payloads
- Use placeholders for sensitive data
- Format as markdown numbered list
- Include expected results

Return only the markdown PoC, no JSON.`;

    try {
      const response = await aiProvider.chat(
        [{ role: 'user', content: prompt }],
        {
          temperature: 0.0,
          maxTokens: 2048,
        }
      );

      logger.info(`PoC generated using ${response.provider}`);
      return response.content;
    } catch (error: any) {
      logger.error({ error, finding }, 'PoC generation failed');
      throw error;
    }
  }

  /**
   * Conversational response for Manager AI
   */
  public async generateConversationalResponse(
    userMessage: string,
    history: any[],
    currentState: any
  ): Promise<string> {
    const systemPrompt = `You are AgentHunt Manager AI, a friendly and professional security testing orchestrator.

Current System State:
- Active Jobs: ${currentState.activeJobs || 0}
- Queued Jobs: ${currentState.queuedJobs || 0}
- Recent Findings: ${currentState.recentFindings || 0}
- Programs: ${currentState.programs?.length || 0}

Your role is to:
1. Help users run security scans
2. Explain what's happening with their scans
3. Interpret results
4. Suggest next actions
5. Request approvals when needed

Be concise but helpful. Use technical terms but explain them when needed.`;

    try {
      const messages: AIMessage[] = [];

      // Add conversation history
      for (const h of history) {
        messages.push({
          role: h.role,
          content: h.content,
        });
      }

      // Add current message
      messages.push({
        role: 'user',
        content: userMessage,
      });

      const response = await aiProvider.chat(messages, {
        temperature: config.anthropic.managerTemperature,
        maxTokens: 2048,
        systemPrompt,
      });

      logger.info(
        `Conversational response generated using ${response.provider}`
      );
      return response.content;
    } catch (error: any) {
      logger.error({ error }, 'Conversational response generation failed');
      throw error;
    }
  }

  /**
   * Get available AI providers
   */
  public getAvailableProviders(): string[] {
    return aiProvider.getAvailableProviders();
  }

  /**
   * Check system health
   */
  public async healthCheck(): Promise<{ status: string; providers: string[] }> {
    const providers = aiProvider.getAvailableProviders();

    if (providers.length === 0) {
      return {
        status: 'unhealthy',
        providers: [],
      };
    }

    return {
      status: 'healthy',
      providers,
    };
  }
}

export default AIService.getInstance();
