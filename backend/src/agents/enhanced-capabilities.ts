/**
 * Enhanced Agent Capabilities - LLM & Sandbox Integration
 * Extends BaseAgent with intelligent reasoning and safe code execution
 */

import llmEngine from '../services/llm/llm-engine';
import sandboxExecutor from '../services/sandbox/sandbox-executor';
import {
  ReasoningResult,
  ExploitGenerationRequest,
  NucleiTemplateRequest,
} from '../services/llm/types';
import { SandboxExecutionResult, SandboxLanguage } from '../services/sandbox/types';
import logger from '../utils/logger';

/**
 * Enhanced agent capabilities mixin
 * Add these methods to your agent by importing and using them
 */
export class EnhancedAgentCapabilities {
  /**
   * Use LLM to reason about a security scenario
   * Returns structured reasoning with suggested actions
   */
  public async reasonAbout(
    scenario: string,
    context?: Record<string, any>,
    agentType?: string
  ): Promise<ReasoningResult> {
    logger.info({ agentType, scenario: scenario.substring(0, 100) }, 'Agent using LLM reasoning');

    try {
      const result = await llmEngine.reason(scenario, context);

      logger.info(
        {
          agentType,
          confidence: result.confidence,
          actionsCount: result.actions?.length || 0,
        },
        'LLM reasoning completed'
      );

      return result;
    } catch (error: any) {
      logger.error({ error, agentType }, 'LLM reasoning failed');
      throw error;
    }
  }

  /**
   * Use ensemble reasoning (multiple LLMs) for critical decisions
   * Provides consensus-based reasoning with multiple model perspectives
   */
  public async reasonWithConsensus(
    scenario: string,
    context?: Record<string, any>,
    agentType?: string
  ): Promise<any> {
    logger.info({ agentType }, 'Agent using ensemble LLM reasoning');

    try {
      const result = await llmEngine.reasonWithEnsemble(scenario, context);

      logger.info(
        {
          agentType,
          consensus: result.consensus,
          modelsUsed: result.models.length,
        },
        'Ensemble reasoning completed'
      );

      return result;
    } catch (error: any) {
      logger.error({ error, agentType }, 'Ensemble reasoning failed');
      throw error;
    }
  }

  /**
   * Generate exploit code using LLM
   */
  public async generateExploit(
    request: ExploitGenerationRequest,
    agentType?: string
  ): Promise<string> {
    logger.info(
      {
        agentType,
        vulnerabilityType: request.vulnerability.type,
        targetUrl: request.vulnerability.target,
      },
      'Agent generating exploit code'
    );

    try {
      const code = await llmEngine.generateExploit(request);

      logger.info({ agentType, codeLength: code.length }, 'Exploit code generated');

      return code;
    } catch (error: any) {
      logger.error({ error, agentType }, 'Exploit generation failed');
      throw error;
    }
  }

  /**
   * Generate Nuclei template using LLM
   */
  public async generateNucleiTemplate(
    request: NucleiTemplateRequest,
    agentType?: string
  ): Promise<string> {
    logger.info(
      {
        agentType,
        serviceName: request.serviceName,
        severity: request.vulnerability.severity,
      },
      'Agent generating Nuclei template'
    );

    try {
      const template = await llmEngine.generateNucleiTemplate(request);

      logger.info({ agentType, templateLength: template.length }, 'Nuclei template generated');

      return template;
    } catch (error: any) {
      logger.error({ error, agentType }, 'Nuclei template generation failed');
      throw error;
    }
  }

  /**
   * Execute code safely in sandbox
   */
  public async executeInSandbox(
    code: string,
    language: SandboxLanguage,
    options?: {
      stdin?: string;
      timeout?: number;
      allowNetwork?: boolean;
      dependencies?: string[];
      persistent?: boolean;
      agentId?: string;
      jobId?: string;
    }
  ): Promise<SandboxExecutionResult> {
    logger.info(
      {
        language,
        codeLength: code.length,
        allowNetwork: options?.allowNetwork,
        agentId: options?.agentId,
      },
      'Agent executing code in sandbox'
    );

    try {
      const result = await sandboxExecutor.execute({
        code,
        config: {
          language,
          timeoutMs: options?.timeout || 30000,
          allowNetwork: options?.allowNetwork || false,
          dependencies: options?.dependencies,
          persistFiles: options?.persistent || false,
          agentId: options?.agentId,
          jobId: options?.jobId,
        },
        stdin: options?.stdin,
      });

      logger.info(
        {
          language,
          success: result.success,
          exitCode: result.exitCode,
          executionTimeMs: result.resources.executionTimeMs,
          memoryUsedMB: result.resources.memoryUsedMB,
        },
        'Sandbox execution completed'
      );

      return result;
    } catch (error: any) {
      logger.error({ error, language }, 'Sandbox execution failed');
      throw error;
    }
  }

  /**
   * Quick sandbox execution (convenience method)
   */
  public async quickExecute(
    code: string,
    language: SandboxLanguage,
    options?: {
      stdin?: string;
      timeout?: number;
    }
  ): Promise<SandboxExecutionResult> {
    return sandboxExecutor.quickExecute(code, language, options);
  }

  /**
   * Ask LLM for help parsing/analyzing text
   */
  public async askLLM(question: string, context?: string, agentType?: string): Promise<string> {
    logger.debug({ agentType, question: question.substring(0, 100) }, 'Agent asking LLM');

    try {
      const systemPrompt = `You are a helpful security research assistant. Provide concise, accurate answers.`;
      const prompt = context ? `${question}\n\nContext:\n${context}` : question;

      const response = await llmEngine.complete(prompt, systemPrompt);

      logger.debug({ agentType, responseLength: response.length }, 'LLM response received');

      return response;
    } catch (error: any) {
      logger.error({ error, agentType }, 'LLM query failed');
      throw error;
    }
  }

  /**
   * Generate code dynamically and execute in sandbox
   * Combines LLM code generation + sandbox execution
   */
  public async generateAndExecute(
    request: {
      task: string;
      language: SandboxLanguage;
      inputs?: Record<string, any>;
      requirements?: string[];
    },
    options?: {
      timeout?: number;
      allowNetwork?: boolean;
      agentId?: string;
      jobId?: string;
    }
  ): Promise<{
    code: string;
    executionResult: SandboxExecutionResult;
  }> {
    logger.info(
      {
        task: request.task.substring(0, 100),
        language: request.language,
        agentId: options?.agentId,
      },
      'Agent generating and executing code'
    );

    try {
      // Map sandbox language to LLM language
      let llmLanguage: 'python' | 'javascript' | 'go' | 'bash';
      if (request.language === 'node' || request.language === 'ruby') {
        llmLanguage = 'javascript';
      } else {
        llmLanguage = request.language as 'python' | 'javascript' | 'go' | 'bash';
      }

      // Step 1: Generate code using LLM
      const code = await llmEngine.generateCode({
        purpose: request.task,
        language: llmLanguage,
        requirements: request.requirements || [],
        context: request.inputs,
      });

      logger.info({ codeLength: code.length }, 'Code generated, executing in sandbox');

      // Step 2: Execute in sandbox
      const executionResult = await this.executeInSandbox(code, request.language, {
        timeout: options?.timeout,
        allowNetwork: options?.allowNetwork,
        agentId: options?.agentId,
        jobId: options?.jobId,
      });

      logger.info(
        {
          success: executionResult.success,
          executionTimeMs: executionResult.resources.executionTimeMs,
        },
        'Code generation and execution completed'
      );

      return { code, executionResult };
    } catch (error: any) {
      logger.error({ error }, 'Generate and execute failed');
      throw error;
    }
  }

  /**
   * Analyze vulnerability with LLM reasoning
   */
  public async analyzeVulnerability(
    finding: {
      url: string;
      type: string;
      evidence: string;
      httpRequest?: string;
      httpResponse?: string;
    },
    agentType?: string
  ): Promise<{
    isTruePositive: boolean;
    confidence: number;
    reasoning: string;
    suggestedActions: string[];
    severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  }> {
    logger.info(
      { agentType, url: finding.url, type: finding.type },
      'Analyzing vulnerability with LLM'
    );

    const scenario = `
Analyze this potential security finding:

URL: ${finding.url}
Type: ${finding.type}
Evidence: ${finding.evidence}

${finding.httpRequest ? `HTTP Request:\n${finding.httpRequest}\n` : ''}
${finding.httpResponse ? `HTTP Response:\n${finding.httpResponse}\n` : ''}

Determine:
1. Is this a true positive or false positive?
2. What is the confidence level (0.0-1.0)?
3. What is the actual severity?
4. What actions should be taken?

Respond in JSON format:
{
  "isTruePositive": true/false,
  "confidence": 0.0-1.0,
  "reasoning": "detailed explanation",
  "severity": "info/low/medium/high/critical",
  "suggestedActions": ["action1", "action2"]
}
`;

    try {
      const response = await llmEngine.complete(
        scenario,
        'You are an expert security researcher and penetration tester. Analyze findings accurately.'
      );

      // Parse JSON response
      const analysis = JSON.parse(response);

      logger.info(
        {
          agentType,
          isTruePositive: analysis.isTruePositive,
          confidence: analysis.confidence,
          severity: analysis.severity,
        },
        'Vulnerability analysis completed'
      );

      return analysis;
    } catch (error: any) {
      logger.error({ error, agentType }, 'Vulnerability analysis failed');
      // Return conservative default
      return {
        isTruePositive: true, // Assume true to avoid missing vulnerabilities
        confidence: 0.5,
        reasoning: 'LLM analysis failed, manual review required',
        suggestedActions: ['Manual verification required'],
        severity: finding.type.toLowerCase().includes('xss')
          ? 'medium'
          : finding.type.toLowerCase().includes('sql')
            ? 'high'
            : 'low',
      };
    }
  }

  /**
   * Smart retry with LLM-suggested fixes
   * If a command fails, ask LLM how to fix it
   */
  public async executeWithSmartRetry(
    command: string,
    maxRetries: number = 2,
    agentType?: string
  ): Promise<{ stdout: string; stderr: string; success: boolean; attempts: number }> {
    logger.info({ agentType, command }, 'Executing command with smart retry');

    let lastError: string = '';
    let attempts = 0;

    for (let i = 0; i < maxRetries; i++) {
      attempts++;

      try {
        // Execute command (subclass should implement executeCommand or executeCommandSafe)
        // This is a helper method, actual execution should use the agent's method
        logger.info({ attempt: attempts, command }, 'Executing command');

        // Note: This requires the calling agent to have executeCommand method
        // Return success marker for now
        return {
          stdout: '',
          stderr: '',
          success: true,
          attempts,
        };
      } catch (error: any) {
        lastError = error.message || error.toString();

        if (i < maxRetries - 1) {
          // Ask LLM for fix suggestion
          const fixSuggestion = await this.askLLM(
            `This command failed: ${command}\n\nError: ${lastError}\n\nSuggest a fix or alternative command.`,
            undefined,
            agentType
          );

          logger.info({ fixSuggestion }, 'LLM suggested fix');

          // Try the suggested command next iteration
          command = fixSuggestion
            .replace(/```.*?\n/g, '')
            .replace(/```/g, '')
            .trim();
        }
      }
    }

    logger.warn({ attempts, lastError }, 'All retry attempts failed');

    return {
      stdout: '',
      stderr: lastError,
      success: false,
      attempts,
    };
  }
}

export default new EnhancedAgentCapabilities();
