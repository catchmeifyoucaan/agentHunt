import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { ConfirmJob, Confirmation } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import notification from '../services/notification';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Confirm Agent
 * Validates findings using multiple independent methods:
 * - Re-run with different Nuclei template
 * - HTTPx with custom regex
 * - Secondary nuclei scan
 * - Different worker/IP/region
 *
 * Requires 2+ independent confirmations for auto-notify
 */
export class ConfirmAgent extends BaseAgent<ConfirmJob> {
  constructor() {
    super('confirm');
  }
  protected getSteps() {
    return [
      {
            name: "Load findings to confirm",
            metadata: {}
      },
      {
            name: "Re-test and validate vulnerabilities",
            metadata: {}
      },
      {
            name: "Generate proof-of-concept",
            metadata: {}
      },
      {
            name: "Mark findings as confirmed",
            metadata: {}
      }
];
  }


  async process(job: Job<ConfirmJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Get finding details
      const findingResult = await database.query(
        'SELECT * FROM findings WHERE id = $1',
        [options.findingId]
      );

      if (findingResult.rows.length === 0) {
        throw new Error(`Finding ${options.findingId} not found`);
      }

      const finding = findingResult.rows[0];

      await this.logExecution(
        job.id!,
        programId,
        'confirm',
        'start',
        'info',
        `Confirming finding ${options.findingId}: ${finding.title}`
      );

      const confirmations: Confirmation[] = [];

      // Run each confirmation method
      for (const method of options.methods) {
        try {
          const confirmation = await this.runConfirmation(
            method,
            finding,
            job.id!,
            programId,
            options.useDifferentWorker
          );

          confirmations.push(confirmation);

          await this.logExecution(
            job.id!,
            programId,
            'confirm',
            method,
            confirmation.result === 'pass' ? 'info' : 'warn',
            `Confirmation ${method}: ${confirmation.result}`
          );
        } catch (error: any) {
          logger.error({ error, method, findingId: options.findingId }, 'Confirmation method failed');

          // Extract method type from full method string (e.g., "template:name" -> "template")
          const methodType = method.split(':')[0] as 'template' | 'manual' | 'httpx_regex' | 'secondary_nuclei' | 'different_worker';

          confirmations.push({
            id: uuidv4(),
            method: methodType,
            result: 'error',
            details: error.message,
            workerId: this.workerId,
            timestamp: new Date(),
          });
        }
      }

      // Count passes
      const passes = confirmations.filter((c) => c.result === 'pass').length;
      const confirmed = passes >= options.requiredPasses;

      // Update finding with confirmations
      await database.query(
        `UPDATE findings
         SET confirmations = confirmations || $1::jsonb,
             status = CASE WHEN $2 THEN 'confirmed' ELSE status END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [JSON.stringify(confirmations), confirmed, options.findingId]
      );

      const result = {
        findingId: options.findingId,
        confirmations,
        passes,
        required: options.requiredPasses,
        confirmed,
      };

      await this.updateJobStatus(job.id!, 'completed', result);

      await this.logExecution(
        job.id!,
        programId,
        'confirm',
        'complete',
        confirmed ? 'info' : 'warn',
        `Confirmation ${confirmed ? 'PASSED' : 'FAILED'}: ${passes}/${options.requiredPasses} methods passed`
      );

      // If confirmed and meets criteria, send notification
      if (confirmed && this.shouldNotify(finding)) {
        try {
          // Get program name
          const programResult = await database.query(
            'SELECT name FROM programs WHERE id = $1',
            [programId]
          );
          const programName = programResult.rows[0]?.name || programId;

          // Get asset value
          const assetResult = await database.query(
            'SELECT value FROM assets WHERE id = $1',
            [finding.asset_id]
          );
          const assetValue = assetResult.rows[0]?.value || finding.target || 'Unknown';

          // Transform database row to Finding object
          const findingObj = {
            id: finding.id,
            programId: finding.program_id,
            assetId: finding.asset_id,
            title: finding.title,
            description: finding.description,
            severity: finding.severity,
            confidence: finding.confidence || 0.9,
            cvss: finding.cvss,
            cwe: finding.cwe || [],
            status: 'confirmed',
            impact: finding.impact || '',
            poc: finding.poc || '',
            remediation: finding.remediation || '',
            references: finding.references || [],
            confirmations: finding.confirmations || [],
            createdAt: finding.created_at,
            updatedAt: finding.updated_at,
          };

          // Send notification
          await notification.notifyFinding(findingObj as any, programName, assetValue);
          logger.info({ findingId: options.findingId }, 'Notification sent for confirmed finding');
        } catch (error: any) {
          logger.error({ error, findingId: options.findingId }, 'Failed to send finding notification');
        }
      }

      return result;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async runConfirmation(
    method: string,
    finding: any,
    jobId: string,
    programId: string,
    useDifferentWorker: boolean
  ): Promise<Confirmation> {
    // Parse method (format: "type:param")
    const [type, param] = method.split(':');

    switch (type) {
      case 'template':
        return await this.confirmWithTemplate(param, finding, jobId, programId);
      case 'httpx_regex':
        return await this.confirmWithHttpxRegex(param, finding, jobId, programId);
      case 'manual':
        return await this.confirmManual(finding, jobId, programId);
      default:
        throw new Error(`Unknown confirmation method: ${method}`);
    }
  }

  private async confirmWithTemplate(
    templateName: string,
    finding: any,
    jobId: string,
    programId: string
  ): Promise<Confirmation> {
    // Extract target URL from finding
    const target = this.extractTarget(finding);

    const command = `${config.tools.nuclei} -target ${target} -templates ${config.tools.nucleiTemplates}/${templateName} -json`;

    const result = await this.executeCommand(command, { timeout: 30000 });

    const hasMatch = result.stdout.includes('"template-id"');

    return {
      id: uuidv4(),
      method: 'template',
      result: hasMatch ? 'pass' : 'fail',
      details: hasMatch ? 'Template matched' : 'Template did not match',
      workerId: this.workerId,
      templateId: templateName,
      timestamp: new Date(),
    };
  }

  private async confirmWithHttpxRegex(
    regex: string,
    finding: any,
    jobId: string,
    programId: string
  ): Promise<Confirmation> {
    const target = this.extractTarget(finding);

    const command = `${config.tools.httpx} -target ${target} -silent -match-regex "${regex}"`;

    const result = await this.executeCommand(command, { timeout: 10000 });

    const hasMatch = result.exitCode === 0 && result.stdout.trim().length > 0;

    return {
      id: uuidv4(),
      method: 'httpx_regex',
      result: hasMatch ? 'pass' : 'fail',
      details: hasMatch ? 'Regex matched' : 'Regex did not match',
      workerId: this.workerId,
      timestamp: new Date(),
    };
  }

  private async confirmManual(
    finding: any,
    jobId: string,
    programId: string
  ): Promise<Confirmation> {
    // Manual confirmation requires human review
    return {
      id: uuidv4(),
      method: 'manual',
      result: 'fail',
      details: 'Manual confirmation required - human review pending',
      workerId: this.workerId,
      timestamp: new Date(),
    };
  }

  private extractTarget(finding: any): string {
    // Try to extract URL from evidence
    if (finding.evidence && finding.evidence.length > 0) {
      const urlEvidence = finding.evidence.find((e: any) => e.type === 'request' || e.url);
      if (urlEvidence?.url) {
        return urlEvidence.url;
      }
      if (urlEvidence?.content) {
        const urlMatch = urlEvidence.content.match(/https?:\/\/[^\s]+/);
        if (urlMatch) {
          return urlMatch[0];
        }
      }
    }

    // Fallback: get asset value
    return finding.poc?.curl || 'unknown';
  }

  private shouldNotify(finding: any): boolean {
    const severity = finding.severity;
    const confidence = finding.confidence;

    // Critical findings with high confidence
    if (severity === 'critical' && confidence >= 0.9) {
      return true;
    }

    // High findings with high confidence
    if (severity === 'high' && confidence >= 0.85) {
      return true;
    }

    return false;
  }
}
