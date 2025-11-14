/**
 * Metacognitive Reasoning - Self-Aware Agent Intelligence
 * Allows agents to reflect on their actions and adapt strategies
 */

import llmEngine from '../llm/llm-engine';
import knowledgeStore from './knowledge-store';
import logger from '../../utils/logger';

interface AgentAction {
  action: string;
  reasoning: string;
  tool?: string;
  parameters?: Record<string, any>;
  timestamp: Date;
}

interface AgentResult {
  success: boolean;
  output?: string;
  error?: string;
  duration: number;
  resourcesUsed?: {
    cpu: number;
    memory: number;
  };
}

interface ReflectionResult {
  insights: string[];
  mistakes: string[];
  improvements: string[];
  confidence: number;
  shouldPivot: boolean;
  newStrategy?: string;
}

interface StrategyAdaptation {
  originalStrategy: string;
  adaptedStrategy: string;
  reasoning: string;
  expectedImprovement: number; // 0.0-1.0
  riskLevel: 'low' | 'medium' | 'high';
}

class MetacognitiveReasoning {
  /**
   * Reflect on a series of actions and their results
   * Allows agents to learn from their experiences
   */
  async reflect(
    agentType: string,
    actions: AgentAction[],
    results: AgentResult[],
    context?: Record<string, any>
  ): Promise<ReflectionResult> {
    logger.info(
      {
        agentType,
        actionsCount: actions.length,
        successRate: results.filter(r => r.success).length / results.length,
      },
      'Agent performing metacognitive reflection'
    );

    // Build reflection prompt
    const prompt = this.buildReflectionPrompt(agentType, actions, results, context);

    // Use LLM to analyze actions
    const analysis = await llmEngine.complete(
      prompt,
      'You are a metacognitive AI that helps security agents learn from their actions and improve their strategies.'
    );

    // Parse reflection
    let parsedAnalysis: any;
    try {
      parsedAnalysis = JSON.parse(analysis);
    } catch (error) {
      // Fallback if JSON parsing fails
      parsedAnalysis = this.extractReflectionFromText(analysis);
    }

    // Calculate confidence based on success rate and pattern recognition
    const successRate = results.filter(r => r.success).length / results.length;
    const confidence = this.calculateConfidence(actions, results, successRate);

    // Determine if strategy should pivot
    const shouldPivot = this.shouldPivotStrategy(actions, results, successRate);

    const reflection: ReflectionResult = {
      insights: parsedAnalysis.insights || [],
      mistakes: parsedAnalysis.mistakes || [],
      improvements: parsedAnalysis.improvements || [],
      confidence,
      shouldPivot,
      newStrategy: shouldPivot ? parsedAnalysis.newStrategy : undefined,
    };

    logger.info(
      {
        agentType,
        insights: reflection.insights.length,
        mistakes: reflection.mistakes.length,
        shouldPivot: reflection.shouldPivot,
        confidence: reflection.confidence,
      },
      'Reflection completed'
    );

    return reflection;
  }

  /**
   * Adapt strategy based on current results
   */
  async adaptStrategy(
    currentStrategy: string,
    recentResults: Array<{ action: string; success: boolean; reason?: string }>,
    goal: string
  ): Promise<StrategyAdaptation> {
    logger.info(
      {
        currentStrategy: currentStrategy.substring(0, 50),
        successRate: recentResults.filter(r => r.success).length / recentResults.length,
      },
      'Adapting strategy'
    );

    const prompt = `
Current Strategy:
${currentStrategy}

Goal:
${goal}

Recent Results:
${recentResults
  .map((r, i) => `${i + 1}. ${r.action}: ${r.success ? 'SUCCESS' : 'FAILED'}${r.reason ? ` (${r.reason})` : ''}`)
  .join('\n')}

Based on the results, adapt the strategy to improve success rate. Consider:
1. What's working and should be kept?
2. What's failing and needs to change?
3. What new approaches could be tried?
4. What's the risk level of the new strategy?

Respond in JSON:
{
  "adaptedStrategy": "detailed new strategy",
  "reasoning": "why this adaptation will work",
  "expectedImprovement": 0.0-1.0,
  "riskLevel": "low|medium|high",
  "keyChanges": ["change 1", "change 2"]
}
`;

    const response = await llmEngine.complete(
      prompt,
      'You are a strategic AI that helps adapt security testing strategies based on results.'
    );

    let adaptation: any;
    try {
      adaptation = JSON.parse(response);
    } catch (error) {
      // Fallback adaptation
      adaptation = {
        adaptedStrategy: currentStrategy,
        reasoning: 'Failed to generate adaptation',
        expectedImprovement: 0.1,
        riskLevel: 'low',
      };
    }

    const result: StrategyAdaptation = {
      originalStrategy: currentStrategy,
      adaptedStrategy: adaptation.adaptedStrategy || currentStrategy,
      reasoning: adaptation.reasoning || 'Strategy adapted based on results',
      expectedImprovement: adaptation.expectedImprovement || 0.3,
      riskLevel: adaptation.riskLevel || 'medium',
    };

    logger.info(
      {
        expectedImprovement: result.expectedImprovement,
        riskLevel: result.riskLevel,
      },
      'Strategy adapted'
    );

    return result;
  }

  /**
   * Suggest next actions based on current state
   */
  async suggestNextActions(
    agentType: string,
    currentState: {
      target: string;
      completedActions: string[];
      findings: string[];
      timeElapsed: number;
      remainingTime?: number;
    }
  ): Promise<Array<{ action: string; reasoning: string; priority: number }>> {
    logger.info({ agentType, target: currentState.target }, 'Suggesting next actions');

    // Search knowledge base for relevant techniques
    const knowledge = await knowledgeStore.search({
      query: `${agentType} actions for ${currentState.target}`,
      type: 'technique',
      limit: 5,
    });

    // Use LLM to suggest actions
    const prompt = `
Agent Type: ${agentType}
Target: ${currentState.target}

Completed Actions:
${currentState.completedActions.join('\n')}

Findings So Far:
${currentState.findings.length > 0 ? currentState.findings.join('\n') : 'None yet'}

Time Elapsed: ${currentState.timeElapsed}ms
${currentState.remainingTime ? `Remaining Time: ${currentState.remainingTime}ms` : ''}

Relevant Knowledge:
${knowledge.map(k => `- ${k.entry.title}: ${k.entry.description}`).join('\n')}

Suggest 3-5 next actions to take. Consider:
1. What hasn't been tried yet?
2. What findings suggest new attack vectors?
3. What's the most efficient use of remaining time?

Respond in JSON:
{
  "actions": [
    {
      "action": "specific action to take",
      "reasoning": "why this action makes sense",
      "priority": 1-10 (higher is more important)
    }
  ]
}
`;

    const response = await llmEngine.complete(
      prompt,
      'You are a strategic AI that suggests optimal security testing actions.'
    );

    let suggestions: any;
    try {
      suggestions = JSON.parse(response);
    } catch (error) {
      // Fallback suggestions
      suggestions = {
        actions: [
          {
            action: 'Continue with standard enumeration',
            reasoning: 'Default fallback action',
            priority: 5,
          },
        ],
      };
    }

    const actions = (suggestions.actions || [])
      .slice(0, 5)
      .sort((a: any, b: any) => b.priority - a.priority);

    logger.info({ actionsCount: actions.length }, 'Next actions suggested');

    return actions;
  }

  /**
   * Analyze why an action failed
   */
  async analyzeFailure(
    action: AgentAction,
    result: AgentResult,
    context?: Record<string, any>
  ): Promise<{
    rootCause: string;
    possibleReasons: string[];
    suggestedFixes: string[];
    shouldRetry: boolean;
  }> {
    logger.info({ action: action.action }, 'Analyzing failure');

    const prompt = `
Action Taken:
${action.action}

Reasoning:
${action.reasoning}

${action.tool ? `Tool Used: ${action.tool}` : ''}
${action.parameters ? `Parameters: ${JSON.stringify(action.parameters)}` : ''}

Result:
Success: ${result.success}
Error: ${result.error || 'Unknown error'}
Duration: ${result.duration}ms

Context:
${context ? JSON.stringify(context, null, 2) : 'None'}

Analyze why this action failed. Respond in JSON:
{
  "rootCause": "primary reason for failure",
  "possibleReasons": ["reason 1", "reason 2"],
  "suggestedFixes": ["fix 1", "fix 2"],
  "shouldRetry": true/false,
  "retryStrategy": "how to retry if applicable"
}
`;

    const response = await llmEngine.complete(
      prompt,
      'You are a debugging AI that analyzes why security testing actions fail.'
    );

    let analysis: any;
    try {
      analysis = JSON.parse(response);
    } catch (error) {
      analysis = {
        rootCause: 'Unknown',
        possibleReasons: ['Parsing error'],
        suggestedFixes: ['Review error logs'],
        shouldRetry: false,
      };
    }

    logger.info(
      {
        rootCause: analysis.rootCause,
        shouldRetry: analysis.shouldRetry,
      },
      'Failure analyzed'
    );

    return {
      rootCause: analysis.rootCause || 'Unknown',
      possibleReasons: analysis.possibleReasons || [],
      suggestedFixes: analysis.suggestedFixes || [],
      shouldRetry: analysis.shouldRetry || false,
    };
  }

  /**
   * Build reflection prompt
   */
  private buildReflectionPrompt(
    agentType: string,
    actions: AgentAction[],
    results: AgentResult[],
    context?: Record<string, any>
  ): string {
    const successRate = results.filter(r => r.success).length / results.length;

    return `
Agent Type: ${agentType}
Success Rate: ${(successRate * 100).toFixed(1)}%

Actions and Results:
${actions
  .map(
    (action, i) => `
${i + 1}. Action: ${action.action}
   Reasoning: ${action.reasoning}
   Result: ${results[i]?.success ? 'SUCCESS' : 'FAILED'}${results[i]?.error ? ` (${results[i].error})` : ''}
   Duration: ${results[i]?.duration}ms
`
  )
  .join('\n')}

${context ? `Context:\n${JSON.stringify(context, null, 2)}` : ''}

Reflect on these actions and provide insights. Respond in JSON:
{
  "insights": ["key learning 1", "key learning 2"],
  "mistakes": ["mistake 1", "mistake 2"],
  "improvements": ["improvement 1", "improvement 2"],
  "newStrategy": "suggested new strategy if current approach isn't working"
}
`;
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    actions: AgentAction[],
    results: AgentResult[],
    successRate: number
  ): number {
    // Base confidence from success rate
    let confidence = successRate;

    // Increase confidence if consistent results
    const hasConsistentPattern = this.hasConsistentPattern(results);
    if (hasConsistentPattern) {
      confidence += 0.1;
    }

    // Decrease confidence if many errors
    const errorRate = results.filter(r => !r.success).length / results.length;
    if (errorRate > 0.5) {
      confidence -= 0.2;
    }

    // Clamp to 0-1
    return Math.max(0, Math.min(1, confidence));
  }

  /**
   * Determine if strategy should pivot
   */
  private shouldPivotStrategy(
    actions: AgentAction[],
    results: AgentResult[],
    successRate: number
  ): boolean {
    // Pivot if success rate is very low
    if (successRate < 0.3 && results.length >= 3) {
      return true;
    }

    // Pivot if last 3 actions all failed
    const lastThree = results.slice(-3);
    if (lastThree.length >= 3 && lastThree.every(r => !r.success)) {
      return true;
    }

    return false;
  }

  /**
   * Check for consistent patterns in results
   */
  private hasConsistentPattern(results: AgentResult[]): boolean {
    if (results.length < 3) return false;

    // Check if last 3 results are all same
    const lastThree = results.slice(-3);
    const allSuccess = lastThree.every(r => r.success);
    const allFailed = lastThree.every(r => !r.success);

    return allSuccess || allFailed;
  }

  /**
   * Extract reflection from text if JSON parsing fails
   */
  private extractReflectionFromText(text: string): any {
    return {
      insights: this.extractListFromText(text, 'insight'),
      mistakes: this.extractListFromText(text, 'mistake'),
      improvements: this.extractListFromText(text, 'improvement'),
      newStrategy: text.includes('strategy') ? text : undefined,
    };
  }

  /**
   * Extract list items from text
   */
  private extractListFromText(text: string, keyword: string): string[] {
    const lines = text.split('\n');
    const items: string[] = [];

    for (const line of lines) {
      if (line.toLowerCase().includes(keyword) && line.trim().startsWith('-')) {
        items.push(line.replace(/^-\s*/, '').trim());
      }
    }

    return items;
  }
}

export default new MetacognitiveReasoning();
