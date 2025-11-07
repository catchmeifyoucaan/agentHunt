import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { TriageJob, Finding, TriageResult, ConfirmJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import storage from '../services/storage';
import ai from '../services/ai';
import queue from '../services/queue';
import events from '../services/events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

/**
 * Triage Agent
 * Uses Claude AI to:
 * - Parse scanner outputs
 * - Normalize to Finding schema
 * - Assign severity and confidence
 * - Generate PoC draft
 * - Suggest confirmation steps
 * - Assess false positive likelihood
 */
export class TriageAgent extends BaseAgent<TriageJob> {
  private promptVersion = 'v1.0.0';

  constructor() {
    super('triage');
  }

  async process(job: Job<TriageJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      await this.logExecution(
        job.id!,
        programId,
        'triage',
        'start',
        'info',
        `Starting AI triage for scanner job ${options.scannerJobId}`
      );

      // Download raw output from S3
      const rawContent = await storage.downloadText(storage.parseS3Uri(options.rawOutputFile));
      const rawFindings = this.parseJsonLines(rawContent);

      await this.logExecution(
        job.id!,
        programId,
        'triage',
        'parse',
        'info',
        `Parsed ${rawFindings.length} raw findings`
      );

      const triaged: Finding[] = [];

      // Triage each finding
      for (const rawFinding of rawFindings) {
        try {
          const finding = await this.triageFinding(rawFinding, programId, job.id!);
          triaged.push(finding);

          // Emit finding event
          await events.emitFinding(finding);

          // Queue confirmation if needed
          if (this.shouldAutoConfirm(finding)) {
            await this.queueConfirmation(finding, programId);
          }
        } catch (error: any) {
          logger.error(
            { error, rawFinding: rawFinding.info?.name },
            'Failed to triage individual finding'
          );
        }
      }

      const result = {
        totalRaw: rawFindings.length,
        triaged: triaged.length,
        bySeverity: this.countBySeverity(triaged),
        byConfidence: this.countByConfidence(triaged),
        queued_for_confirmation: triaged.filter((f) => this.shouldAutoConfirm(f)).length,
      };

      await this.updateJobStatus(job.id!, 'completed', result);

      await this.logExecution(
        job.id!,
        programId,
        'triage',
        'complete',
        'info',
        `Triage complete: ${triaged.length} findings processed`
      );

      return result;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async triageFinding(rawFinding: any, programId: string, jobId: string): Promise<Finding> {
    let triageResult: any;

    // Use AI if enabled
    if (config.features.enableAiTriage) {
      try {
        triageResult = await ai.parseAndTriageFinding(rawFinding);
      } catch (error) {
        logger.error({ error, rawFinding: rawFinding.info?.name }, 'AI triage failed, using fallback');
        triageResult = this.fallbackTriage(rawFinding);
      }
    } else {
      triageResult = this.fallbackTriage(rawFinding);
    }

    // Get or create asset
    const assetId = await this.getOrCreateAsset(programId, rawFinding);

    // Generate PoC if needed
    let pocSteps = triageResult.steps || [];
    if (pocSteps.length === 0 && triageResult.confidence > 0.7) {
      try {
        const pocMarkdown = await ai.generatePoC({
          title: triageResult.title,
          description: triageResult.description,
          evidence: rawFinding,
        });
        pocSteps = pocMarkdown.split('\n').filter((l: string) => l.match(/^\d+\./));
      } catch (error) {
        logger.error({ error }, 'PoC generation failed');
      }
    }

    // Create finding record
    const findingId = uuidv4();

    const finding: Finding = {
      id: findingId,
      programId,
      assetId,
      severity: triageResult.severity,
      confidence: triageResult.confidence,
      title: triageResult.title,
      description: triageResult.description,
      cvss: triageResult.cvss,
      cwe: triageResult.cwe || [],
      evidence: [
        {
          type: 'log',
          content: JSON.stringify(rawFinding, null, 2),
          timestamp: new Date(),
        },
      ],
      poc: {
        steps: pocSteps,
        curl: rawFinding.curl_command || '',
        payload: rawFinding.matched_at || '',
        reproductionRate: triageResult.confidence,
      },
      impact: triageResult.impact || '',
      remediation: triageResult.remediation || '',
      status: 'new',
      confirmations: [],
      triageResult: {
        agentVersion: this.workerId,
        promptVersion: this.promptVersion,
        rawOutput: JSON.stringify(triageResult),
        normalizedFinding: triageResult,
        severityReasoning: triageResult.reasoning || '',
        confidenceReasoning: triageResult.reasoning || '',
        suggestedConfirmations: triageResult.required_confirmations || [],
        falsePositiveLikelihood: triageResult.false_positive_likelihood || 0,
        requiresHumanReview: triageResult.confidence < 0.6 || triageResult.false_positive_likelihood > 0.5,
        aiModel: config.anthropic.model,
        timestamp: new Date(),
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to database
    await database.query(
      `INSERT INTO findings (
        id, program_id, asset_id, severity, confidence, title, description,
        cvss, cwe, evidence, poc, impact, remediation, status, triage_result
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        finding.id,
        finding.programId,
        finding.assetId,
        finding.severity,
        finding.confidence,
        finding.title,
        finding.description,
        finding.cvss,
        finding.cwe,
        JSON.stringify(finding.evidence),
        JSON.stringify(finding.poc),
        finding.impact,
        finding.remediation,
        finding.status,
        JSON.stringify(finding.triageResult),
      ]
    );

    return finding;
  }

  private fallbackTriage(rawFinding: any): any {
    // Deterministic triage without AI
    return {
      title: rawFinding.info?.name || 'Unknown vulnerability',
      severity: rawFinding.info?.severity || 'info',
      confidence: 0.5,
      description: rawFinding.info?.description || '',
      cvss: rawFinding.info?.classification?.['cvss-score'],
      cwe: rawFinding.info?.classification?.['cwe-id'] ? [rawFinding.info.classification['cwe-id']] : [],
      impact: '',
      remediation: '',
      steps: [],
      required_confirmations: ['template:verify', 'httpx_regex'],
      false_positive_likelihood: 0.3,
      reasoning: 'Fallback triage (AI disabled)',
    };
  }

  private async getOrCreateAsset(programId: string, rawFinding: any): Promise<string> {
    // Extract URL or host from finding
    const host = rawFinding.host || rawFinding.matched_at || 'unknown';

    const result = await database.query(
      `INSERT INTO assets (program_id, type, value, source, status)
       VALUES ($1, 'url', $2, ARRAY['nuclei'], 'active')
       ON CONFLICT (program_id, value, type) DO UPDATE
       SET last_seen = CURRENT_TIMESTAMP
       RETURNING id`,
      [programId, host]
    );

    return result.rows[0].id;
  }

  private shouldAutoConfirm(finding: Finding): boolean {
    // Auto-confirm high/critical findings with decent confidence
    if (!config.features.enableAutoConfirm) {
      return false;
    }

    if (finding.severity === 'critical' && finding.confidence >= 0.8) {
      return true;
    }

    if (finding.severity === 'high' && finding.confidence >= 0.75) {
      return true;
    }

    return false;
  }

  private async queueConfirmation(finding: Finding, programId: string): Promise<void> {
    const confirmJob: ConfirmJob = {
      id: uuidv4(),
      type: 'confirm',
      programId,
      priority: finding.severity === 'critical' ? 10 : 8,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        findingId: finding.id,
        methods: finding.triageResult?.suggestedConfirmations || ['template:verify'],
        requiredPasses: finding.severity === 'critical' ? 2 : 1,
        useDifferentWorker: true,
      },
      metadata: {
        requestedBy: 'triage-agent',
      },
    } as any;

    await queue.addJob('confirm', confirmJob);

    logger.info({ findingId: finding.id }, 'Queued confirmation job');
  }

  private countBySeverity(findings: Finding[]): Record<string, number> {
    const counts: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    findings.forEach((f) => {
      if (counts[f.severity] !== undefined) {
        counts[f.severity]++;
      }
    });

    return counts;
  }

  private countByConfidence(findings: Finding[]): any {
    return {
      high: findings.filter((f) => f.confidence >= 0.8).length,
      medium: findings.filter((f) => f.confidence >= 0.5 && f.confidence < 0.8).length,
      low: findings.filter((f) => f.confidence < 0.5).length,
    };
  }
}
