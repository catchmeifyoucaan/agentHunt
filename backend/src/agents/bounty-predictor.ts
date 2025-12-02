/**
 * Bounty Value Prediction Agent
 * Purpose: ML-powered bounty payout prediction
 * 
 * Features:
 * - Historical bounty data analysis
 * - Severity correlation
 * - Program generosity scoring
 * - Vulnerability type value mapping
 * - Priority queue by predicted value
 * - Prediction accuracy tracking
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface BountyPredictorJob extends BaseJob {
  type: 'bounty-predictor';
  options: {
    programId: string;
    findingId?: string;
    action: 'predict' | 'train' | 'evaluate' | 'prioritize';
  };
}

interface BountyPrediction {
  findingId: string;
  predictedAmount: number;
  confidence: number;
  factors: PredictionFactor[];
  range: { min: number; max: number };
}

interface PredictionFactor {
  name: string;
  weight: number;
  value: any;
  contribution: number;
}

// Historical bounty data by severity and type
const BOUNTY_BASELINES: Record<string, Record<string, number>> = {
  critical: {
    rce: 15000,
    sqli: 10000,
    ssrf: 8000,
    auth_bypass: 7500,
    default: 5000,
  },
  high: {
    xss: 3000,
    idor: 2500,
    csrf: 2000,
    xxe: 3500,
    default: 2000,
  },
  medium: {
    xss: 1000,
    idor: 800,
    info_disclosure: 500,
    default: 500,
  },
  low: {
    default: 150,
  },
};

// Program generosity multipliers (based on historical data)
const PROGRAM_GENEROSITY: Record<string, number> = {
  'google': 2.5,
  'facebook': 2.0,
  'microsoft': 1.8,
  'apple': 2.2,
  'uber': 1.5,
  'shopify': 1.6,
  'github': 1.4,
  'gitlab': 1.3,
  'default': 1.0,
};

export class BountyPredictorAgent extends BaseAgent<BountyPredictorJob> {
  private model: Map<string, number> = new Map();

  constructor() {
    super('bounty-predictor');
    this.initializeModel();
  }

  protected getSteps() {
    return [
      { name: 'Load historical data' },
      { name: 'Analyze finding' },
      { name: 'Calculate prediction' },
      { name: 'Estimate confidence' },
      { name: 'Store prediction' },
    ];
  }

  async process(job: Job<BountyPredictorJob>): Promise<any> {
    const { programId, options } = job.data;
    const { findingId, action } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      switch (action) {
        case 'predict':
          return await this.predictBounty(programId, findingId!, job.id!);
        case 'train':
          return await this.trainModel(programId, job.id!);
        case 'evaluate':
          return await this.evaluateModel(programId, job.id!);
        case 'prioritize':
          return await this.prioritizeFindings(programId, job.id!);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error: any) {
      logger.error({ error, action }, 'Bounty prediction failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Initialize prediction model with baseline data
   */
  private initializeModel(): void {
    // Severity weights
    this.model.set('severity_critical', 5.0);
    this.model.set('severity_high', 3.0);
    this.model.set('severity_medium', 1.5);
    this.model.set('severity_low', 0.5);

    // Vulnerability type weights
    this.model.set('type_rce', 3.0);
    this.model.set('type_sqli', 2.5);
    this.model.set('type_ssrf', 2.0);
    this.model.set('type_xss', 1.5);
    this.model.set('type_idor', 1.3);
    this.model.set('type_csrf', 1.0);

    // Impact weights
    this.model.set('impact_data_breach', 2.0);
    this.model.set('impact_account_takeover', 1.8);
    this.model.set('impact_privilege_escalation', 1.5);
    this.model.set('impact_info_disclosure', 1.0);
  }

  /**
   * Predict bounty for a finding
   */
  private async predictBounty(programId: string, findingId: string, jobId: string): Promise<BountyPrediction> {
    // Step 1: Load historical data
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 5,
      percentage: 10,
      currentTool: 'data-loader',
      toolStatus: 'running',
      message: 'Loading historical data',
    });

    const historicalData = await this.loadHistoricalData(programId);
    const programMultiplier = await this.getProgramGenerosity(programId);

    // Step 2: Analyze finding
    await this.updateJobProgress(jobId, {
      current: 2,
      total: 5,
      percentage: 30,
      currentTool: 'analyzer',
      toolStatus: 'running',
      message: 'Analyzing finding',
    });

    const finding = await this.loadFinding(findingId);
    if (!finding) {
      throw new Error(`Finding ${findingId} not found`);
    }

    const factors = this.extractFactors(finding);

    // Step 3: Calculate prediction
    await this.updateJobProgress(jobId, {
      current: 3,
      total: 5,
      percentage: 55,
      currentTool: 'predictor',
      toolStatus: 'running',
      message: 'Calculating prediction',
    });

    const baseAmount = this.calculateBaseAmount(finding);
    const adjustedAmount = this.applyFactors(baseAmount, factors, programMultiplier);

    // Step 4: Estimate confidence
    await this.updateJobProgress(jobId, {
      current: 4,
      total: 5,
      percentage: 75,
      currentTool: 'confidence',
      toolStatus: 'running',
      message: 'Estimating confidence',
    });

    const confidence = this.calculateConfidence(finding, historicalData);
    const range = this.calculateRange(adjustedAmount, confidence);

    // Step 5: Store prediction
    await this.updateJobProgress(jobId, {
      current: 5,
      total: 5,
      percentage: 95,
      currentTool: 'storage',
      toolStatus: 'running',
      message: 'Storing prediction',
    });

    const prediction: BountyPrediction = {
      findingId,
      predictedAmount: Math.round(adjustedAmount),
      confidence,
      factors,
      range,
    };

    await this.storePrediction(programId, prediction);

    await this.updateJobProgress(jobId, {
      current: 5,
      total: 5,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: `Predicted: $${prediction.predictedAmount}`,
    });

    await this.updateJobStatus(jobId, 'completed', prediction);
    return prediction;
  }

  /**
   * Train model on historical data
   */
  private async trainModel(programId: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 3,
      percentage: 20,
      currentTool: 'data-loader',
      toolStatus: 'running',
      message: 'Loading training data',
    });

    // Load historical bounties with outcomes
    const trainingData = await this.loadTrainingData(programId);

    await this.updateJobProgress(jobId, {
      current: 2,
      total: 3,
      percentage: 60,
      currentTool: 'trainer',
      toolStatus: 'running',
      message: 'Training model',
    });

    // Simple linear regression on features
    const weights = this.trainLinearModel(trainingData);

    // Update model weights
    for (const [key, value] of Object.entries(weights)) {
      this.model.set(key, value);
    }

    await this.updateJobProgress(jobId, {
      current: 3,
      total: 3,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: `Trained on ${trainingData.length} samples`,
    });

    const result = {
      samplesUsed: trainingData.length,
      weightsUpdated: Object.keys(weights).length,
    };

    await this.updateJobStatus(jobId, 'completed', result);
    return result;
  }

  /**
   * Evaluate model accuracy
   */
  private async evaluateModel(programId: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 2,
      percentage: 50,
      currentTool: 'evaluator',
      toolStatus: 'running',
      message: 'Evaluating predictions',
    });

    // Load predictions with actual outcomes
    const evaluationData = await this.loadEvaluationData(programId);

    let totalError = 0;
    let correctWithinRange = 0;

    for (const item of evaluationData) {
      const error = Math.abs(item.predicted - item.actual) / item.actual;
      totalError += error;

      if (item.actual >= item.rangeMin && item.actual <= item.rangeMax) {
        correctWithinRange++;
      }
    }

    const meanError = evaluationData.length > 0 ? totalError / evaluationData.length : 0;
    const rangeAccuracy = evaluationData.length > 0 ? correctWithinRange / evaluationData.length : 0;

    await this.updateJobProgress(jobId, {
      current: 2,
      total: 2,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: `Accuracy: ${(rangeAccuracy * 100).toFixed(1)}%`,
    });

    const result = {
      samplesEvaluated: evaluationData.length,
      meanAbsolutePercentageError: meanError,
      rangeAccuracy,
    };

    await this.updateJobStatus(jobId, 'completed', result);
    return result;
  }

  /**
   * Prioritize findings by predicted value
   */
  private async prioritizeFindings(programId: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 3,
      percentage: 20,
      currentTool: 'loader',
      toolStatus: 'running',
      message: 'Loading findings',
    });

    // Load all unsubmitted findings
    const findings = await this.loadUnsubmittedFindings(programId);

    await this.updateJobProgress(jobId, {
      current: 2,
      total: 3,
      percentage: 60,
      currentTool: 'predictor',
      toolStatus: 'running',
      message: 'Predicting values',
    });

    // Predict value for each
    const predictions: Array<{ findingId: string; predictedAmount: number; priority: number }> = [];

    for (const finding of findings) {
      const baseAmount = this.calculateBaseAmount(finding);
      const factors = this.extractFactors(finding);
      const programMultiplier = await this.getProgramGenerosity(programId);
      const predictedAmount = this.applyFactors(baseAmount, factors, programMultiplier);

      predictions.push({
        findingId: finding.id,
        predictedAmount: Math.round(predictedAmount),
        priority: 0,
      });
    }

    // Sort by predicted amount and assign priorities
    predictions.sort((a, b) => b.predictedAmount - a.predictedAmount);
    predictions.forEach((p, i) => p.priority = i + 1);

    await this.updateJobProgress(jobId, {
      current: 3,
      total: 3,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: `Prioritized ${predictions.length} findings`,
    });

    // Update priorities in database
    for (const pred of predictions) {
      await this.updateFindingPriority(pred.findingId, pred.priority, pred.predictedAmount);
    }

    const result = {
      findingsPrioritized: predictions.length,
      topFindings: predictions.slice(0, 10),
      totalPredictedValue: predictions.reduce((sum, p) => sum + p.predictedAmount, 0),
    };

    await this.updateJobStatus(jobId, 'completed', result);
    return result;
  }

  // Helper methods

  private async loadFinding(findingId: string): Promise<any> {
    const result = await database.query('SELECT * FROM findings WHERE id = $1', [findingId]);
    return result.rows[0] || null;
  }

  private async loadHistoricalData(programId: string): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT f.*, s.bounty as actual_bounty 
         FROM findings f 
         JOIN submissions s ON f.id = s.finding_id 
         WHERE f.program_id = $1 AND s.bounty IS NOT NULL`,
        [programId]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  private async loadTrainingData(programId: string): Promise<any[]> {
    return this.loadHistoricalData(programId);
  }

  private async loadEvaluationData(programId: string): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT p.finding_id, p.predicted_amount as predicted, s.bounty as actual,
                p.range_min as "rangeMin", p.range_max as "rangeMax"
         FROM bounty_predictions p
         JOIN submissions s ON p.finding_id = s.finding_id
         WHERE s.bounty IS NOT NULL`,
        []
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  private async loadUnsubmittedFindings(programId: string): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT f.* FROM findings f 
         LEFT JOIN submissions s ON f.id = s.finding_id 
         WHERE f.program_id = $1 AND s.id IS NULL`,
        [programId]
      );
      return result.rows;
    } catch {
      return [];
    }
  }

  private async getProgramGenerosity(programId: string): Promise<number> {
    try {
      const result = await database.query(
        'SELECT name FROM programs WHERE id = $1',
        [programId]
      );
      
      if (result.rows[0]) {
        const name = result.rows[0].name.toLowerCase();
        for (const [key, value] of Object.entries(PROGRAM_GENEROSITY)) {
          if (name.includes(key)) {
            return value;
          }
        }
      }
      return PROGRAM_GENEROSITY.default;
    } catch {
      return 1.0;
    }
  }

  private extractFactors(finding: any): PredictionFactor[] {
    const factors: PredictionFactor[] = [];

    // Severity factor
    const severityWeight = this.model.get(`severity_${finding.severity}`) || 1.0;
    factors.push({
      name: 'Severity',
      weight: severityWeight,
      value: finding.severity,
      contribution: severityWeight * 1000,
    });

    // Vulnerability type factor
    const typeKey = `type_${finding.type.toLowerCase().replace(/[^a-z]/g, '_')}`;
    const typeWeight = this.model.get(typeKey) || 1.0;
    factors.push({
      name: 'Vulnerability Type',
      weight: typeWeight,
      value: finding.type,
      contribution: typeWeight * 500,
    });

    // Impact factor (from evidence)
    if (finding.evidence) {
      const evidence = typeof finding.evidence === 'string' ? JSON.parse(finding.evidence) : finding.evidence;
      if (evidence.impact) {
        const impactKey = `impact_${evidence.impact.toLowerCase().replace(/[^a-z]/g, '_')}`;
        const impactWeight = this.model.get(impactKey) || 1.0;
        factors.push({
          name: 'Impact',
          weight: impactWeight,
          value: evidence.impact,
          contribution: impactWeight * 300,
        });
      }
    }

    return factors;
  }

  private calculateBaseAmount(finding: any): number {
    const severity = finding.severity?.toLowerCase() || 'medium';
    const type = finding.type?.toLowerCase().replace(/[^a-z]/g, '_') || 'default';

    const severityBaselines = BOUNTY_BASELINES[severity] || BOUNTY_BASELINES.medium;
    return severityBaselines[type] || severityBaselines.default;
  }

  private applyFactors(baseAmount: number, factors: PredictionFactor[], programMultiplier: number): number {
    let amount = baseAmount;

    // Apply factor contributions
    for (const factor of factors) {
      amount += factor.contribution * (factor.weight - 1);
    }

    // Apply program multiplier
    amount *= programMultiplier;

    return Math.max(50, amount); // Minimum $50
  }

  private calculateConfidence(finding: any, historicalData: any[]): number {
    // Base confidence
    let confidence = 0.5;

    // More historical data = higher confidence
    if (historicalData.length > 100) confidence += 0.2;
    else if (historicalData.length > 50) confidence += 0.15;
    else if (historicalData.length > 20) confidence += 0.1;

    // Similar findings in history = higher confidence
    const similarFindings = historicalData.filter(h => 
      h.type === finding.type && h.severity === finding.severity
    );
    if (similarFindings.length > 10) confidence += 0.15;
    else if (similarFindings.length > 5) confidence += 0.1;

    return Math.min(0.95, confidence);
  }

  private calculateRange(amount: number, confidence: number): { min: number; max: number } {
    const uncertainty = 1 - confidence;
    const margin = amount * uncertainty;

    return {
      min: Math.round(Math.max(50, amount - margin)),
      max: Math.round(amount + margin),
    };
  }

  private trainLinearModel(data: any[]): Record<string, number> {
    // Simple feature extraction and averaging
    const weights: Record<string, { sum: number; count: number }> = {};

    for (const item of data) {
      const severity = item.severity?.toLowerCase();
      const type = item.type?.toLowerCase().replace(/[^a-z]/g, '_');
      const bounty = item.actual_bounty || 0;

      // Update severity weights
      const sevKey = `severity_${severity}`;
      if (!weights[sevKey]) weights[sevKey] = { sum: 0, count: 0 };
      weights[sevKey].sum += bounty;
      weights[sevKey].count++;

      // Update type weights
      const typeKey = `type_${type}`;
      if (!weights[typeKey]) weights[typeKey] = { sum: 0, count: 0 };
      weights[typeKey].sum += bounty;
      weights[typeKey].count++;
    }

    // Calculate averages and normalize
    const result: Record<string, number> = {};
    const baseline = 1000; // Normalize around $1000

    for (const [key, value] of Object.entries(weights)) {
      if (value.count > 0) {
        result[key] = (value.sum / value.count) / baseline;
      }
    }

    return result;
  }

  private async storePrediction(programId: string, prediction: BountyPrediction): Promise<void> {
    try {
      await database.query(
        `INSERT INTO bounty_predictions (id, program_id, finding_id, predicted_amount, confidence, range_min, range_max, factors, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
         ON CONFLICT (finding_id) DO UPDATE SET predicted_amount = $4, confidence = $5, range_min = $6, range_max = $7`,
        [
          uuidv4(),
          programId,
          prediction.findingId,
          prediction.predictedAmount,
          prediction.confidence,
          prediction.range.min,
          prediction.range.max,
          JSON.stringify(prediction.factors),
        ]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store prediction');
    }
  }

  private async updateFindingPriority(findingId: string, priority: number, predictedValue: number): Promise<void> {
    try {
      await database.query(
        `UPDATE findings SET priority = $1, predicted_bounty = $2 WHERE id = $3`,
        [priority, predictedValue, findingId]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to update finding priority');
    }
  }
}

export default new BountyPredictorAgent();
