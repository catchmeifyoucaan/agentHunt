/**
 * Multi-Model AI Ensemble Service
 * Orchestrates multiple AI models for finding triage with consensus-based decision making
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import type {
  Finding,
  EnsembleTriageResult,
  ModelTriageResult,
  AIModel,
  ModelProvider,
  Severity
} from '../../../../shared/types';
import logger from '../../utils/logger';

export class AIEnsembleService {
  private db: Pool;
  private providers: Map<AIModel, ModelProvider> = new Map();
  private anthropic?: Anthropic;
  private gemini?: GoogleGenerativeAI;
  private openai?: OpenAI;

  constructor(db: Pool) {
    this.db = db;
    this.initializeProviders();
  }

  /**
   * Initialize AI providers from database config
   */
  private async initializeProviders(): Promise<void> {
    const result = await this.db.query(
      `SELECT * FROM model_providers WHERE enabled = true ORDER BY priority ASC`
    );

    for (const row of result.rows) {
      const provider: ModelProvider = {
        model: row.model,
        apiKey: row.api_key,
        baseUrl: row.base_url,
        maxTokens: row.max_tokens,
        temperature: row.temperature,
        timeout: row.timeout,
        enabled: row.enabled,
        priority: row.priority
      };

      this.providers.set(provider.model, provider);

      // Initialize SDK clients
      switch (provider.model) {
        case 'claude':
          this.anthropic = new Anthropic({ apiKey: provider.apiKey });
          break;
        case 'gemini':
          this.gemini = new GoogleGenerativeAI(provider.apiKey);
          break;
        case 'gpt4':
        case 'gpt5':
          this.openai = new OpenAI({ apiKey: provider.apiKey });
          break;
      }
    }

    logger.info({ providersCount: this.providers.size }, 'AI providers initialized');
  }

  /**
   * Triage a finding using ensemble of models
   */
  async triageFinding(finding: Finding): Promise<EnsembleTriageResult> {
    const startTime = Date.now();

    logger.info({ findingId: finding.id }, 'Starting ensemble triage');

    // Run triage with all available models in parallel
    const modelPromises: Promise<ModelTriageResult>[] = [];

    for (const [model, provider] of this.providers) {
      modelPromises.push(this.triageWithModel(finding, model, provider));
    }

    // Wait for all models to complete
    const modelResults = await Promise.all(modelPromises);

    // Filter out failed results
    const successfulResults = modelResults.filter(r => !r.error);

    if (successfulResults.length === 0) {
      throw new Error('All models failed to triage finding');
    }

    // Aggregate results using ensemble logic
    const ensembleResult = this.aggregateResults(finding.id, successfulResults);

    // Store in database
    await this.saveEnsembleResult(ensembleResult);

    const duration = Date.now() - startTime;

    logger.info({
      findingId: finding.id,
      modelsUsed: successfulResults.length,
      ensembleSeverity: ensembleResult.ensembleSeverity,
      consensusLevel: ensembleResult.consensusLevel,
      duration
    }, 'Ensemble triage completed');

    return ensembleResult;
  }

  /**
   * Triage with a specific model
   */
  private async triageWithModel(
    finding: Finding,
    model: AIModel,
    provider: ModelProvider
  ): Promise<ModelTriageResult> {
    const startTime = Date.now();

    try {
      const prompt = this.buildTriagePrompt(finding);

      let response: any;

      switch (model) {
        case 'claude':
          response = await this.triageWithClaude(prompt, provider);
          break;
        case 'gemini':
          response = await this.triageWithGemini(prompt, provider);
          break;
        case 'gpt4':
        case 'gpt5':
          response = await this.triageWithOpenAI(prompt, provider, model);
          break;
        default:
          throw new Error(`Unsupported model: ${model}`);
      }

      // Parse response
      const parsed = this.parseTriageResponse(response);

      return {
        model,
        score: parsed.score,
        severity: parsed.severity,
        confidence: parsed.confidence,
        rationale: parsed.rationale,
        suggestedActions: parsed.suggestedActions,
        processingTime: Date.now() - startTime
      };
    } catch (error: any) {
      logger.error({ model, error: error.message }, 'Model triage failed');

      return {
        model,
        score: 0,
        severity: 'info',
        confidence: 0,
        rationale: '',
        suggestedActions: [],
        processingTime: Date.now() - startTime,
        error: error.message
      };
    }
  }

  /**
   * Triage with Claude
   */
  private async triageWithClaude(prompt: string, provider: ModelProvider): Promise<string> {
    if (!this.anthropic) {
      throw new Error('Claude client not initialized');
    }

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  /**
   * Triage with Gemini
   */
  private async triageWithGemini(prompt: string, provider: ModelProvider): Promise<string> {
    if (!this.gemini) {
      throw new Error('Gemini client not initialized');
    }

    const model = this.gemini.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  /**
   * Triage with OpenAI (GPT-4/5)
   */
  private async triageWithOpenAI(prompt: string, provider: ModelProvider, model: AIModel): Promise<string> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized');
    }

    const modelName = model === 'gpt5' ? 'gpt-4o' : 'gpt-4-turbo';

    const response = await this.openai.chat.completions.create({
      model: modelName,
      max_tokens: provider.maxTokens,
      temperature: provider.temperature,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.choices[0]?.message?.content || '';
  }

  /**
   * Build triage prompt
   */
  private buildTriagePrompt(finding: Finding): string {
    return `You are a security expert triaging vulnerability findings for a bug bounty program.

**Finding Details:**
Title: ${finding.title}
Description: ${finding.description}
Current Severity: ${finding.severity}
Current Confidence: ${finding.confidence}

**Evidence:**
${JSON.stringify(finding.evidence, null, 2)}

**Proof of Concept:**
${JSON.stringify(finding.poc, null, 2)}

**Your Task:**
Analyze this finding and provide:
1. A risk score (0-10)
2. Severity assessment (critical, high, medium, low, info)
3. Confidence level (0.0 to 1.0)
4. Detailed rationale for your assessment
5. List of suggested actions (auto_submit, human_review, dismiss, retest)

**Output Format (JSON):**
{
  "score": <number 0-10>,
  "severity": "<critical|high|medium|low|info>",
  "confidence": <number 0.0-1.0>,
  "rationale": "<detailed explanation>",
  "suggestedActions": ["<action1>", "<action2>"]
}

**Important Constraints:**
- Only suggest "auto_submit" if confidence >= 0.9 and finding is clearly valid
- Suggest "human_review" for findings requiring manual verification
- Suggest "retest" if evidence is insufficient
- Suggest "dismiss" only for clear false positives
- Consider the proof-of-concept reproduction rate and evidence quality
- Be conservative with critical/high severity ratings

Provide your analysis in the JSON format specified above.`;
  }

  /**
   * Parse triage response from model
   */
  private parseTriageResponse(response: string): {
    score: number;
    severity: Severity;
    confidence: number;
    rationale: string;
    suggestedActions: string[];
  } {
    try {
      // Extract JSON from response (handle markdown code blocks)
      let jsonStr = response.trim();

      if (jsonStr.includes('```json')) {
        const match = jsonStr.match(/```json\n([\s\S]*?)\n```/);
        if (match) {
          jsonStr = match[1];
        }
      } else if (jsonStr.includes('```')) {
        const match = jsonStr.match(/```\n([\s\S]*?)\n```/);
        if (match) {
          jsonStr = match[1];
        }
      }

      const parsed = JSON.parse(jsonStr);

      return {
        score: Math.max(0, Math.min(10, parsed.score || 0)),
        severity: parsed.severity || 'info',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0)),
        rationale: parsed.rationale || '',
        suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : []
      };
    } catch (error) {
      logger.error({ error, response }, 'Failed to parse triage response');

      // Return default values
      return {
        score: 0,
        severity: 'info',
        confidence: 0,
        rationale: 'Failed to parse response',
        suggestedActions: ['human_review']
      };
    }
  }

  /**
   * Aggregate results from multiple models
   */
  private aggregateResults(findingId: string, results: ModelTriageResult[]): EnsembleTriageResult {
    // Calculate ensemble score (weighted average based on model reliability)
    const totalScore = results.reduce((sum, r) => sum + r.score, 0);
    const ensembleScore = totalScore / results.length;

    // Calculate ensemble confidence (average)
    const totalConfidence = results.reduce((sum, r) => sum + r.confidence, 0);
    const ensembleConfidence = totalConfidence / results.length;

    // Determine ensemble severity (weighted voting)
    const severityVotes = new Map<Severity, number>();
    for (const result of results) {
      const current = severityVotes.get(result.severity) || 0;
      severityVotes.set(result.severity, current + 1);
    }

    const ensembleSeverity = this.getMostVotedSeverity(severityVotes);

    // Calculate consensus level (how much models agree)
    const consensusLevel = this.calculateConsensus(results);

    // Collect top rationales
    const topRationales = results
      .filter(r => r.rationale && r.rationale.length > 0)
      .slice(0, 3)
      .map(r => r.rationale);

    // Determine recommended action based on ensemble
    const recommendedAction = this.determineRecommendedAction(
      ensembleScore,
      ensembleConfidence,
      consensusLevel
    );

    return {
      findingId,
      modelResults: results,
      ensembleScore: Math.round(ensembleScore * 10) / 10,
      ensembleSeverity,
      ensembleConfidence: Math.round(ensembleConfidence * 100) / 100,
      consensusLevel: Math.round(consensusLevel * 100) / 100,
      topRationales,
      recommendedAction,
      createdAt: new Date()
    };
  }

  /**
   * Get most voted severity with tie-breaking
   */
  private getMostVotedSeverity(votes: Map<Severity, number>): Severity {
    const severityOrder: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

    let maxVotes = 0;
    let winner: Severity = 'info';

    for (const severity of severityOrder) {
      const voteCount = votes.get(severity) || 0;
      if (voteCount > maxVotes) {
        maxVotes = voteCount;
        winner = severity;
      }
    }

    return winner;
  }

  /**
   * Calculate consensus level (0-1)
   */
  private calculateConsensus(results: ModelTriageResult[]): number {
    if (results.length <= 1) return 1.0;

    // Calculate standard deviation of scores
    const scores = results.map(r => r.score);
    const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
    const stdDev = Math.sqrt(variance);

    // Normalize to 0-1 (lower stdDev = higher consensus)
    // Max stdDev for scores 0-10 is 5 (worst case)
    const consensus = 1 - Math.min(stdDev / 5, 1);

    return consensus;
  }

  /**
   * Determine recommended action
   */
  private determineRecommendedAction(
    score: number,
    confidence: number,
    consensus: number
  ): EnsembleTriageResult['recommendedAction'] {
    // High confidence, high score, high consensus -> auto submit
    if (score >= 7 && confidence >= 0.85 && consensus >= 0.8) {
      return 'auto_submit';
    }

    // Low score, high confidence -> dismiss
    if (score < 3 && confidence >= 0.8) {
      return 'dismiss';
    }

    // Medium confidence or low consensus -> human review
    if (confidence < 0.7 || consensus < 0.6) {
      return 'human_review';
    }

    // Medium score, decent confidence -> retest
    if (score >= 4 && score < 7 && confidence >= 0.6) {
      return 'retest';
    }

    // Default to human review
    return 'human_review';
  }

  /**
   * Save ensemble result to database
   */
  private async saveEnsembleResult(result: EnsembleTriageResult): Promise<void> {
    await this.db.query(
      `INSERT INTO ensemble_triage_results
       (id, finding_id, model_results, ensemble_score, ensemble_severity, ensemble_confidence,
        consensus_level, top_rationales, recommended_action, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        uuidv4(),
        result.findingId,
        JSON.stringify(result.modelResults),
        result.ensembleScore,
        result.ensembleSeverity,
        result.ensembleConfidence,
        result.consensusLevel,
        result.topRationales,
        result.recommendedAction,
        result.createdAt
      ]
    );
  }
}
