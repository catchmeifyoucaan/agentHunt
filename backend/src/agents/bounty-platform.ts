/**
 * Bounty Platform Integration Agent
 * Purpose: Auto-submit reports to HackerOne/Bugcrowd/Intigriti
 * 
 * Features:
 * - HackerOne API integration
 * - Bugcrowd API integration
 * - Intigriti API integration
 * - Duplicate detection
 * - Auto-submission
 * - Status tracking
 * - Payment tracking
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface BountyPlatformJob extends BaseJob {
  type: 'bounty-platform';
  options: {
    programId: string;
    findingId: string;
    platform: 'hackerone' | 'bugcrowd' | 'intigriti' | 'yeswehack';
    action: 'check-duplicate' | 'submit' | 'check-status' | 'sync-payments';
    report?: string;
    dryRun?: boolean;
  };
}

interface SubmissionResult {
  success: boolean;
  submissionId?: string;
  isDuplicate?: boolean;
  duplicateOf?: string;
  status?: string;
  error?: string;
}

// Platform API configurations
const PLATFORM_CONFIGS = {
  hackerone: {
    baseUrl: 'https://api.hackerone.com/v1',
    authHeader: 'Authorization',
    authPrefix: 'Basic',
  },
  bugcrowd: {
    baseUrl: 'https://api.bugcrowd.com',
    authHeader: 'Authorization',
    authPrefix: 'Token',
  },
  intigriti: {
    baseUrl: 'https://api.intigriti.com/core',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
  yeswehack: {
    baseUrl: 'https://api.yeswehack.com',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
  },
};

export class BountyPlatformAgent extends BaseAgent<BountyPlatformJob> {
  constructor() {
    super('bounty-platform');
  }

  protected getSteps() {
    return [
      { name: 'Load finding and report' },
      { name: 'Check for duplicates' },
      { name: 'Prepare submission' },
      { name: 'Submit to platform' },
      { name: 'Track submission' },
    ];
  }

  async process(job: Job<BountyPlatformJob>): Promise<any> {
    const { programId, options } = job.data;
    const { findingId, platform, action, report, dryRun = false } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      switch (action) {
        case 'check-duplicate':
          return await this.checkDuplicate(programId, findingId, platform, job.id!);
        case 'submit':
          return await this.submitReport(programId, findingId, platform, report, dryRun, job.id!);
        case 'check-status':
          return await this.checkStatus(programId, findingId, platform, job.id!);
        case 'sync-payments':
          return await this.syncPayments(programId, platform, job.id!);
        default:
          throw new Error(`Unknown action: ${action}`);
      }
    } catch (error: any) {
      logger.error({ error, action, platform }, 'Bounty platform action failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Check if finding is a duplicate
   */
  private async checkDuplicate(
    programId: string,
    findingId: string,
    platform: string,
    jobId: string
  ): Promise<SubmissionResult> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 2,
      percentage: 50,
      currentTool: 'duplicate-check',
      toolStatus: 'running',
      message: 'Checking for duplicates',
    });

    const finding = await this.loadFinding(findingId);
    if (!finding) {
      return { success: false, error: 'Finding not found' };
    }

    // Check local database for similar submissions
    const localDuplicate = await this.checkLocalDuplicate(finding);
    if (localDuplicate) {
      return {
        success: true,
        isDuplicate: true,
        duplicateOf: localDuplicate.id,
      };
    }

    // Check platform for similar reports (if API supports it)
    const platformDuplicate = await this.checkPlatformDuplicate(finding, platform);

    await this.updateJobProgress(jobId, {
      current: 2,
      total: 2,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: platformDuplicate.isDuplicate ? 'Duplicate found' : 'No duplicate found',
    });

    await this.updateJobStatus(jobId, 'completed', platformDuplicate);
    return platformDuplicate;
  }

  /**
   * Submit report to platform
   */
  private async submitReport(
    programId: string,
    findingId: string,
    platform: string,
    report: string | undefined,
    dryRun: boolean,
    jobId: string
  ): Promise<SubmissionResult> {
    // Step 1: Load finding
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 5,
      percentage: 10,
      currentTool: 'finding-loader',
      toolStatus: 'running',
      message: 'Loading finding',
    });

    const finding = await this.loadFinding(findingId);
    if (!finding) {
      return { success: false, error: 'Finding not found' };
    }

    // Step 2: Check for duplicates first
    await this.updateJobProgress(jobId, {
      current: 2,
      total: 5,
      percentage: 30,
      currentTool: 'duplicate-check',
      toolStatus: 'running',
      message: 'Checking for duplicates',
    });

    const duplicateCheck = await this.checkPlatformDuplicate(finding, platform);
    if (duplicateCheck.isDuplicate) {
      await this.updateJobStatus(jobId, 'completed', duplicateCheck);
      return duplicateCheck;
    }

    // Step 3: Prepare submission
    await this.updateJobProgress(jobId, {
      current: 3,
      total: 5,
      percentage: 50,
      currentTool: 'prepare-submission',
      toolStatus: 'running',
      message: 'Preparing submission',
    });

    const submission = await this.prepareSubmission(finding, report, platform);

    // Step 4: Submit (or dry run)
    await this.updateJobProgress(jobId, {
      current: 4,
      total: 5,
      percentage: 75,
      currentTool: 'submit',
      toolStatus: 'running',
      message: dryRun ? 'Dry run - not submitting' : 'Submitting to platform',
    });

    let result: SubmissionResult;
    if (dryRun) {
      result = {
        success: true,
        status: 'dry-run',
        submissionId: `dry-run-${uuidv4()}`,
      };
    } else {
      result = await this.submitToPlatform(submission, platform);
    }

    // Step 5: Track submission
    await this.updateJobProgress(jobId, {
      current: 5,
      total: 5,
      percentage: 95,
      currentTool: 'track',
      toolStatus: 'running',
      message: 'Recording submission',
    });

    if (result.success && result.submissionId) {
      await this.recordSubmission(findingId, platform, result.submissionId);
    }

    await this.updateJobStatus(jobId, 'completed', result);
    return result;
  }

  /**
   * Check submission status
   */
  private async checkStatus(
    programId: string,
    findingId: string,
    platform: string,
    jobId: string
  ): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 2,
      percentage: 50,
      currentTool: 'status-check',
      toolStatus: 'running',
      message: 'Checking submission status',
    });

    // Get submission record
    const submission = await this.getSubmission(findingId, platform);
    if (!submission) {
      return { success: false, error: 'No submission found' };
    }

    // Check platform for status
    const status = await this.getPlatformStatus(submission.submissionId, platform);

    await this.updateJobProgress(jobId, {
      current: 2,
      total: 2,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: `Status: ${status.status}`,
    });

    // Update local record
    await this.updateSubmissionStatus(submission.id, status);

    await this.updateJobStatus(jobId, 'completed', status);
    return status;
  }

  /**
   * Sync payments from platform
   */
  private async syncPayments(
    programId: string,
    platform: string,
    jobId: string
  ): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 2,
      percentage: 50,
      currentTool: 'payment-sync',
      toolStatus: 'running',
      message: 'Syncing payments',
    });

    const payments = await this.fetchPlatformPayments(platform);

    // Update local records
    for (const payment of payments) {
      await this.recordPayment(payment);
    }

    await this.updateJobProgress(jobId, {
      current: 2,
      total: 2,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: `Synced ${payments.length} payments`,
    });

    const result = { success: true, paymentsCount: payments.length, payments };
    await this.updateJobStatus(jobId, 'completed', result);
    return result;
  }

  // Helper methods

  private async loadFinding(findingId: string): Promise<any> {
    const result = await database.query('SELECT * FROM findings WHERE id = $1', [findingId]);
    return result.rows[0] || null;
  }

  private async checkLocalDuplicate(finding: any): Promise<any> {
    // Check for similar findings already submitted
    const result = await database.query(
      `SELECT f.*, s.submission_id 
       FROM findings f 
       JOIN submissions s ON f.id = s.finding_id 
       WHERE f.type = $1 AND f.url = $2 AND f.id != $3`,
      [finding.type, finding.url, finding.id]
    );
    return result.rows[0] || null;
  }

  private async checkPlatformDuplicate(finding: any, platform: string): Promise<SubmissionResult> {
    // In a real implementation, this would call the platform API
    // For now, we'll do a local check
    const localDup = await this.checkLocalDuplicate(finding);
    if (localDup) {
      return { success: true, isDuplicate: true, duplicateOf: localDup.submission_id };
    }
    return { success: true, isDuplicate: false };
  }

  private async prepareSubmission(finding: any, report: string | undefined, platform: string): Promise<any> {
    // Format the submission based on platform requirements
    const baseSubmission = {
      title: finding.title || `${finding.severity.toUpperCase()} - ${finding.type}`,
      severity: this.mapSeverity(finding.severity, platform),
      vulnerability_type: this.mapVulnerabilityType(finding.type, platform),
      description: report || finding.description,
      impact: finding.evidence?.impact || 'See description for impact details',
      proof_of_concept: finding.evidence?.poc || 'See description for PoC',
    };

    switch (platform) {
      case 'hackerone':
        return {
          data: {
            type: 'report',
            attributes: {
              title: baseSubmission.title,
              vulnerability_information: baseSubmission.description,
              impact: baseSubmission.impact,
              severity_rating: baseSubmission.severity,
            },
          },
        };
      case 'bugcrowd':
        return {
          title: baseSubmission.title,
          description: baseSubmission.description,
          severity: baseSubmission.severity,
          vrt: baseSubmission.vulnerability_type,
        };
      default:
        return baseSubmission;
    }
  }

  private async submitToPlatform(submission: any, platform: string): Promise<SubmissionResult> {
    const config = PLATFORM_CONFIGS[platform as keyof typeof PLATFORM_CONFIGS];
    const apiKey = process.env[`${platform.toUpperCase()}_API_KEY`];

    if (!apiKey) {
      return { success: false, error: `${platform} API key not configured` };
    }

    try {
      const response = await fetch(`${config.baseUrl}/reports`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [config.authHeader]: `${config.authPrefix} ${apiKey}`,
        },
        body: JSON.stringify(submission),
      });

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          submissionId: data.id || data.data?.id,
          status: 'submitted',
        };
      } else {
        const error = await response.text();
        return { success: false, error };
      }
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }

  private async recordSubmission(findingId: string, platform: string, submissionId: string): Promise<void> {
    await database.query(
      `INSERT INTO submissions (id, finding_id, platform, submission_id, status, created_at)
       VALUES ($1, $2, $3, $4, 'submitted', CURRENT_TIMESTAMP)
       ON CONFLICT (finding_id, platform) DO UPDATE SET submission_id = $4, status = 'submitted'`,
      [uuidv4(), findingId, platform, submissionId]
    );
  }

  private async getSubmission(findingId: string, platform: string): Promise<any> {
    const result = await database.query(
      'SELECT * FROM submissions WHERE finding_id = $1 AND platform = $2',
      [findingId, platform]
    );
    return result.rows[0] || null;
  }

  private async getPlatformStatus(submissionId: string, platform: string): Promise<any> {
    const config = PLATFORM_CONFIGS[platform as keyof typeof PLATFORM_CONFIGS];
    const apiKey = process.env[`${platform.toUpperCase()}_API_KEY`];

    if (!apiKey) {
      return { status: 'unknown', error: 'API key not configured' };
    }

    try {
      const response = await fetch(`${config.baseUrl}/reports/${submissionId}`, {
        headers: {
          [config.authHeader]: `${config.authPrefix} ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return {
          status: data.state || data.status || 'unknown',
          bounty: data.bounty_amount || data.reward,
          triaged: data.triaged_at,
          resolved: data.closed_at,
        };
      }
      return { status: 'error', error: await response.text() };
    } catch (error: any) {
      return { status: 'error', error: error.message };
    }
  }

  private async updateSubmissionStatus(submissionId: string, status: any): Promise<void> {
    await database.query(
      `UPDATE submissions SET status = $1, bounty = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`,
      [status.status, status.bounty, submissionId]
    );
  }

  private async fetchPlatformPayments(platform: string): Promise<any[]> {
    const config = PLATFORM_CONFIGS[platform as keyof typeof PLATFORM_CONFIGS];
    const apiKey = process.env[`${platform.toUpperCase()}_API_KEY`];

    if (!apiKey) return [];

    try {
      const response = await fetch(`${config.baseUrl}/payments`, {
        headers: {
          [config.authHeader]: `${config.authPrefix} ${apiKey}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.payments || data.data || [];
      }
      return [];
    } catch {
      return [];
    }
  }

  private async recordPayment(payment: any): Promise<void> {
    await database.query(
      `INSERT INTO payments (id, submission_id, amount, currency, paid_at, created_at)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
       ON CONFLICT (id) DO NOTHING`,
      [payment.id, payment.report_id, payment.amount, payment.currency, payment.paid_at]
    );
  }

  private mapSeverity(severity: string, platform: string): string {
    const mapping: Record<string, Record<string, string>> = {
      hackerone: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'none' },
      bugcrowd: { critical: 'P1', high: 'P2', medium: 'P3', low: 'P4', info: 'P5' },
      intigriti: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info' },
      yeswehack: { critical: 'critical', high: 'high', medium: 'medium', low: 'low', info: 'info' },
    };
    return mapping[platform]?.[severity] || severity;
  }

  private mapVulnerabilityType(type: string, platform: string): string {
    // Map internal types to platform-specific VRT/taxonomy
    const mapping: Record<string, string> = {
      'xss': 'cross_site_scripting_xss',
      'sqli': 'sql_injection',
      'ssrf': 'server_side_request_forgery',
      'idor': 'insecure_direct_object_reference',
      'rce': 'remote_code_execution',
    };
    return mapping[type.toLowerCase()] || type;
  }
}

export default new BountyPlatformAgent();
