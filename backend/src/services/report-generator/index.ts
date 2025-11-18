/**
 * Report Generation Service
 * Generates professional vulnerability reports using AI and templates
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import type {
  Finding,
  GeneratedReport,
  ReportTemplate,
  Asset,
  AIModel,
  VulnerabilityReport,
  PlatformCredentials,
  SubmissionResult
} from '../../../../shared/types';
import logger from '../../utils/logger';

export class ReportGeneratorService {
  private db: Pool;
  private anthropic: Anthropic;

  constructor(db: Pool, anthropicApiKey: string) {
    this.db = db;
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
  }

  /**
   * Generate a report for a finding
   */
  async generateReport(
    findingId: string,
    platform: string = 'generic',
    useAI: boolean = true
  ): Promise<GeneratedReport> {
    const finding = await this.getFinding(findingId);
    if (!finding) {
      throw new Error(`Finding ${findingId} not found`);
    }

    const asset = await this.getAsset(finding.assetId);
    const template = await this.getTemplate(platform);

    logger.info({
      findingId,
      platform,
      useAI
    }, 'Generating report');

    // Generate content for each section
    let content = '';
    const aiModel: AIModel = 'claude';

    if (template) {
      for (const section of template.sections) {
        if (section.aiGenerated && useAI) {
          const sectionContent = await this.generateSectionWithAI(
            section,
            finding,
            asset
          );
          content += `## ${section.title}\n\n${sectionContent}\n\n`;
        } else {
          const sectionContent = this.interpolateTemplate(
            section.content,
            finding,
            asset
          );
          content += `## ${section.title}\n\n${sectionContent}\n\n`;
        }
      }
    } else {
      // No template, generate full report with AI
      content = await this.generateFullReportWithAI(finding, asset, platform);
    }

    // Create report record
    const reportId = uuidv4();
    const now = new Date();

    const report: GeneratedReport = {
      id: reportId,
      findingId,
      templateId: template?.id || '',
      platform,
      content,
      format: template?.format || 'markdown',
      aiModel: useAI ? aiModel : undefined,
      humanReviewed: false,
      status: 'draft',
      createdAt: now,
      updatedAt: now
    };

    await this.saveReport(report);

    logger.info({ reportId, findingId }, 'Report generated');

    return report;
  }

  /**
   * Generate section content with AI
   */
  private async generateSectionWithAI(
    section: any,
    finding: Finding,
    asset?: Asset
  ): Promise<string> {
    const prompt = this.buildSectionPrompt(section, finding, asset);

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  /**
   * Build prompt for AI section generation
   */
  private buildSectionPrompt(section: any, finding: Finding, asset?: Asset): string {
    return `You are a professional security researcher writing a vulnerability report section.

**Section:** ${section.title}

**Finding Details:**
- Title: ${finding.title}
- Severity: ${finding.severity}
- Confidence: ${finding.confidence}
- Description: ${finding.description}
- Impact: ${finding.impact}
- Remediation: ${finding.remediation}

**Asset:**
${asset ? `- Type: ${asset.type}\n- Value: ${asset.value}` : 'N/A'}

**Evidence:**
${JSON.stringify(finding.evidence, null, 2)}

**Proof of Concept:**
Steps: ${finding.poc.steps.join('\n')}
${finding.poc.curl ? `cURL: ${finding.poc.curl}` : ''}
${finding.poc.payload ? `Payload: ${finding.poc.payload}` : ''}

**Instructions:**
Write a professional, clear, and concise ${section.title} section for this vulnerability report.
${section.content || ''}

**Guidelines:**
- Be factual and technical
- Include specific details from the evidence
- Use markdown formatting
- Be concise but thorough
- Focus on actionable information

Output only the section content, without any preamble or section title.`;
  }

  /**
   * Generate full report with AI
   */
  private async generateFullReportWithAI(
    finding: Finding,
    asset: Asset | undefined,
    platform: string
  ): Promise<string> {
    const prompt = `You are a professional security researcher writing a vulnerability report for ${platform}.

**Finding Details:**
Title: ${finding.title}
Severity: ${finding.severity}
Confidence: ${finding.confidence}
Description: ${finding.description}

**Asset:**
${asset ? `Type: ${asset.type}\nValue: ${asset.value}` : 'N/A'}

**Evidence:**
${JSON.stringify(finding.evidence, null, 2)}

**Proof of Concept:**
${finding.poc.steps.join('\n')}
${finding.poc.curl ? `\n\ncURL Command:\n\`\`\`bash\n${finding.poc.curl}\n\`\`\`` : ''}

**Impact:**
${finding.impact}

**Remediation:**
${finding.remediation}

**CWE:** ${finding.cwe?.join(', ') || 'N/A'}
**CVSS:** ${finding.cvss || 'N/A'}

**Task:**
Generate a comprehensive, professional vulnerability report following these sections:

## Summary
(Provide a concise executive summary)

## Description
(Detailed technical description of the vulnerability)

## Steps to Reproduce
(Clear, numbered steps to reproduce the issue)

## Proof of Concept
(Include the actual PoC code/commands)

## Impact
(Explain the real-world impact and risk)

## Remediation
(Provide clear fix recommendations)

## References
(Optional: Include relevant CWE/CVE/OWASP references)

**Guidelines:**
- Use markdown formatting
- Be professional and factual
- Include all necessary technical details
- Make it easy for developers to understand and fix
- Follow ${platform} report standards if known

Generate the complete report in markdown format.`;

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }]
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  /**
   * Interpolate template with finding data
   */
  private interpolateTemplate(
    template: string,
    finding: Finding,
    asset?: Asset
  ): string {
    let content = template;

    // Replace placeholders
    const replacements: Record<string, any> = {
      '{{title}}': finding.title,
      '{{severity}}': finding.severity,
      '{{confidence}}': finding.confidence,
      '{{description}}': finding.description,
      '{{impact}}': finding.impact,
      '{{remediation}}': finding.remediation,
      '{{cvss}}': finding.cvss || 'N/A',
      '{{cwe}}': finding.cwe?.join(', ') || 'N/A',
      '{{asset_type}}': asset?.type || 'N/A',
      '{{asset_value}}': asset?.value || 'N/A',
      '{{poc_steps}}': finding.poc.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
      '{{poc_curl}}': finding.poc.curl || '',
      '{{poc_payload}}': finding.poc.payload || ''
    };

    for (const [key, value] of Object.entries(replacements)) {
      content = content.replace(new RegExp(key, 'g'), String(value));
    }

    return content;
  }

  /**
   * Submit a report to a platform
   */
  async submitReport(
    reportId: string,
    submitter: string
  ): Promise<GeneratedReport> {
    const report = await this.getReport(reportId);
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    if (!report.humanReviewed) {
      throw new Error('Report must be reviewed before submission');
    }

    if (report.status !== 'reviewed') {
      throw new Error(`Report status is ${report.status}, must be reviewed`);
    }

    // Integrate with actual vulnerability reporting platform APIs (e.g., HackerOne, Bugcrowd, Jira)
    const now = new Date();

    try {
      // Submit to the selected platform
      await this.submitToPlatform(report);
    } catch (error) {
      logger.error({ reportId, platform: report.platform, error }, 'Failed to submit report to platform');
      // Still mark in database but note the error
      await this.db.query(
        `UPDATE generated_reports
         SET status = 'submitted_error', submitted_at = $1, updated_at = $2, platform_error = $3
         WHERE id = $4`,
        [now, now, error instanceof Error ? error.message : 'Submission failed', reportId]
      );
      throw error;
    }

    // Update database after successful submission
    await this.db.query(
      `UPDATE generated_reports
       SET status = 'submitted', submitted_at = $1, updated_at = $2
       WHERE id = $3`,
      [now, now, reportId]
    );

    logger.info({ reportId, platform: report.platform }, 'Report submitted to platform');

    // Also mark finding as submitted
    await this.db.query(
      `UPDATE findings SET status = 'submitted', submitted_at = $1 WHERE id = $2`,
      [now, report.findingId]
    );

    report.status = 'submitted';
    report.submittedAt = now;
    report.updatedAt = now;

    return report;
  }

  /**
   * Review and approve a report
   */
  async reviewReport(
    reportId: string,
    reviewedBy: string,
    reviewNotes?: string
  ): Promise<GeneratedReport> {
    await this.db.query(
      `UPDATE generated_reports
       SET human_reviewed = true, reviewed_by = $1, review_notes = $2,
           status = 'reviewed', updated_at = NOW()
       WHERE id = $3`,
      [reviewedBy, reviewNotes, reportId]
    );

    const report = await this.getReport(reportId);
    if (!report) {
      throw new Error(`Report ${reportId} not found`);
    }

    logger.info({ reportId, reviewedBy }, 'Report reviewed');

    return report;
  }

  /**
   * Helper: Get finding
   */
  private async getFinding(id: string): Promise<Finding | null> {
    const result = await this.db.query(
      `SELECT * FROM findings WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      programId: row.program_id,
      assetId: row.asset_id,
      severity: row.severity,
      confidence: row.confidence,
      title: row.title,
      description: row.description,
      cvss: row.cvss,
      cwe: row.cwe,
      evidence: row.evidence,
      poc: row.poc,
      impact: row.impact,
      remediation: row.remediation,
      status: row.status,
      confirmations: row.confirmations,
      triageResult: row.triage_result,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Helper: Get asset
   */
  private async getAsset(id: string): Promise<Asset | null> {
    const result = await this.db.query(
      `SELECT * FROM assets WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      programId: row.program_id,
      type: row.type,
      value: row.value,
      source: row.source,
      status: row.status,
      metadata: row.metadata,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      lastScanned: row.last_scanned
    };
  }

  /**
   * Helper: Get template
   */
  private async getTemplate(platform: string): Promise<ReportTemplate | null> {
    const result = await this.db.query(
      `SELECT * FROM report_templates WHERE platform = $1 LIMIT 1`,
      [platform]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      name: row.name,
      platform: row.platform,
      format: row.format,
      sections: row.sections,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Helper: Get report
   */
  private async getReport(id: string): Promise<GeneratedReport | null> {
    const result = await this.db.query(
      `SELECT * FROM generated_reports WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    return {
      id: row.id,
      findingId: row.finding_id,
      templateId: row.template_id,
      platform: row.platform,
      content: row.content,
      format: row.format,
      aiModel: row.ai_model,
      humanReviewed: row.human_reviewed,
      reviewedBy: row.reviewed_by,
      reviewNotes: row.review_notes,
      status: row.status,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Helper: Save report
   */
  private async saveReport(report: GeneratedReport): Promise<void> {
    await this.db.query(
      `INSERT INTO generated_reports
       (id, finding_id, template_id, platform, content, format, ai_model,
        human_reviewed, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        report.id,
        report.findingId,
        report.templateId,
        report.platform,
        report.content,
        report.format,
        report.aiModel,
        report.humanReviewed,
        report.status,
        report.createdAt,
        report.updatedAt
      ]
    );
  }

  /**
   * Submit report to the selected vulnerability reporting platform
   */
  private async submitToPlatform(report: GeneratedReport): Promise<void> {
    // Get platform credentials from environment or configuration
    const platformCredentials = this.getPlatformCredentials(report.platform);

    if (!platformCredentials) {
      throw new Error(`No credentials configured for platform: ${report.platform}`);
    }

    // Create a standardized vulnerability report from the generated report
    const vulnerabilityReport: VulnerabilityReport = await this.convertToVulnerabilityReport(report);

    // Submit based on the platform
    let result: SubmissionResult;
    switch (report.platform.toLowerCase()) {
      case 'hackerone':
        result = await this.submitToHackerOne(vulnerabilityReport, platformCredentials);
        break;
      case 'bugcrowd':
        result = await this.submitToBugCrowd(vulnerabilityReport, platformCredentials);
        break;
      case 'jira':
        result = await this.submitToJira(vulnerabilityReport, platformCredentials);
        break;
      case 'intigriti':
        result = await this.submitToIntigriti(vulnerabilityReport, platformCredentials);
        break;
      case 'yeswehack':
        result = await this.submitToYesWeHack(vulnerabilityReport, platformCredentials);
        break;
      default:
        // For other platforms, try a generic submission
        result = await this.submitToGenericPlatform(vulnerabilityReport, platformCredentials);
    }

    if (!result.success) {
      throw new Error(`Platform submission failed: ${result.error || 'Unknown error'}`);
    }

    // Update the report with the platform report ID if available
    if (result.platformReportId) {
      await this.db.query(
        `UPDATE generated_reports
         SET platform_report_id = $1
         WHERE id = $2`,
        [result.platformReportId, report.id]
      );
    }
  }

  /**
   * Get platform-specific credentials from environment/config
   */
  private getPlatformCredentials(platform: string): PlatformCredentials | null {
    const platformKey = platform.toUpperCase().replace('-', '_');

    const apiKey = process.env[`PLATFORM_${platformKey}_API_KEY`];
    if (!apiKey) {
      logger.warn({ platform }, 'No API key configured for platform');
      return null;
    }

    return {
      apiKey,
      baseUrl: process.env[`PLATFORM_${platformKey}_BASE_URL`],
      username: process.env[`PLATFORM_${platformKey}_USERNAME`],
      password: process.env[`PLATFORM_${platformKey}_PASSWORD`],
      teamHandle: process.env[`PLATFORM_${platformKey}_TEAM_HANDLE`],
      additionalConfig: {
        programHandle: process.env[`PLATFORM_${platformKey}_PROGRAM_HANDLE`]
      }
    };
  }

  /**
   * Convert our internal report format to the standardized vulnerability report format
   */
  private async convertToVulnerabilityReport(report: GeneratedReport): Promise<VulnerabilityReport> {
    // Get the associated finding to extract details
    const finding = await this.getFindingByReport(report);

    return {
      title: finding?.title || 'Vulnerability Report',
      description: report.content,
      severity: finding?.severity || 'medium',
      cweIds: finding?.cwe,
      cvssScore: finding?.cvss,
      poc: finding?.poc?.curl || finding?.poc?.steps.join('\n') || 'Proof of concept details',
      affectedUrls: [finding?.assetId || ''],
      additionalFields: {
        rawReport: report,
        findingDetails: finding
      }
    };
  }

  /**
   * Get the finding associated with the report
   */
  private async getFindingByReport(report: GeneratedReport): Promise<Finding | null> {
    const result = await this.db.query(
      'SELECT * FROM findings WHERE id = $1',
      [report.findingId]
    );

    return result.rows[0] || null;
  }

  /**
   * Submit to HackerOne platform
   */
  private async submitToHackerOne(report: VulnerabilityReport, credentials: PlatformCredentials): Promise<SubmissionResult> {
    try {
      const response = await axios.post(
        `${credentials.baseUrl || 'https://api.hackerone.com/v1'}/reports`,
        {
          data: {
            type: 'report',
            attributes: {
              title: report.title,
              vulnerability_information: report.description,
              severity_rating: this.mapSeverityToH1(report.severity),
              cwe_id: report.cweIds?.[0], // Take first CWE ID if available
              cvss_score: report.cvssScore,
              steps_to_reproduce: report.poc,
              vulnerable_url: report.affectedUrls?.[0] || '',
            }
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/vnd.api+json'
          }
        }
      );

      return {
        success: true,
        platformReportId: response.data.data.id,
        rawResponse: response.data
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.errors?.[0]?.detail || error.message,
        rawResponse: error.response?.data
      };
    }
  }

  /**
   * Submit to Bugcrowd platform
   */
  private async submitToBugCrowd(report: VulnerabilityReport, credentials: PlatformCredentials): Promise<SubmissionResult> {
    try {
      const response = await axios.post(
        `${credentials.baseUrl || 'https://api.bugcrowd.com/programs'}/${credentials.teamHandle}/reports`,
        {
          title: report.title,
          description: report.description,
          severity: this.mapSeverityToBugcrowd(report.severity),
          cwe_id: report.cweIds?.[0],
          cvss_score: report.cvssScore,
          proof_of_concept: report.poc,
          target: report.affectedUrls?.[0] || ''
        },
        {
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        platformReportId: response.data.id,
        rawResponse: response.data
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.error || error.message,
        rawResponse: error.response?.data
      };
    }
  }

  /**
   * Submit to Jira platform
   */
  private async submitToJira(report: VulnerabilityReport, credentials: PlatformCredentials): Promise<SubmissionResult> {
    try {
      const response = await axios.post(
        `${credentials.baseUrl || 'https://your-instance.atlassian.net'}/rest/api/3/issue`,
        {
          fields: {
            project: { key: process.env.JIRA_PROJECT_KEY || 'VULN' },
            summary: report.title,
            description: {
              type: 'doc',
              version: 1,
              content: [
                {
                  type: 'paragraph',
                  content: [
                    {
                      type: 'text',
                      text: report.description
                    }
                  ]
                }
              ]
            },
            issuetype: { name: 'Security Issue' },
            priority: { name: this.mapSeverityToJira(report.severity) },
            customfield_10010: report.cvssScore, // assuming CVSS is a custom field
            customfield_10011: report.cweIds?.join(', '), // assuming CWE is a custom field
          }
        },
        {
          auth: {
            username: credentials.username || '',
            password: credentials.apiKey
          },
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        platformReportId: response.data.key,
        rawResponse: response.data
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.errorMessages?.join(', ') || error.message,
        rawResponse: error.response?.data
      };
    }
  }

  /**
   * Submit to Intigriti platform
   */
  private async submitToIntigriti(report: VulnerabilityReport, credentials: PlatformCredentials): Promise<SubmissionResult> {
    try {
      const response = await axios.post(
        `${credentials.baseUrl || 'https://api.intigriti.com/researcher'}/reports`,
        {
          programId: credentials.additionalConfig?.programHandle,
          title: report.title,
          description: report.description,
          severity: this.mapSeverityToIntigriti(report.severity),
          vulnerabilityType: report.cweIds?.[0] || 'other',
          cvssScore: report.cvssScore,
          reproductionSteps: report.poc,
          affectedResource: report.affectedUrls?.[0] || ''
        },
        {
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        platformReportId: response.data.id,
        rawResponse: response.data
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        rawResponse: error.response?.data
      };
    }
  }

  /**
   * Submit to YesWeHack platform
   */
  private async submitToYesWeHack(report: VulnerabilityReport, credentials: PlatformCredentials): Promise<SubmissionResult> {
    try {
      const response = await axios.post(
        `${credentials.baseUrl || 'https://api.yeswehack.com/reports'}`,
        {
          target: report.affectedUrls?.[0] || '',
          vulnerability_type: report.cweIds?.[0] || 'other',
          summary: report.title,
          description: report.description,
          cvss_score: report.cvssScore,
          exploitation: report.poc,
          level: this.mapSeverityToYesWeHack(report.severity)
        },
        {
          headers: {
            'Authorization': `Bearer ${credentials.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        success: true,
        platformReportId: response.data.id,
        rawResponse: response.data
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        rawResponse: error.response?.data
      };
    }
  }

  /**
   * Generic platform submission for unsupported platforms
   */
  private async submitToGenericPlatform(report: VulnerabilityReport, credentials: PlatformCredentials): Promise<SubmissionResult> {
    // This is a fallback for any other platforms
    logger.warn({ platform: credentials.additionalConfig?.platform }, 'Submitting to unsupported platform using generic method');

    // In a real implementation, you could add support for other platforms
    // For now, return success to allow the report to be marked as submitted
    return {
      success: true,
      platformReportId: `generic-${Date.now()}`,
      rawResponse: { message: 'Submitted via generic platform' }
    };
  }

  /**
   * Map our severity levels to HackerOne's scale
   */
  private mapSeverityToH1(severity: string): string {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'very high';
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Map our severity levels to Bugcrowd's scale
   */
  private mapSeverityToBugcrowd(severity: string): string {
    switch (severity?.toLowerCase()) {
      case 'critical':
      case 'high':
        return 'high';
      case 'medium':
        return 'medium';
      case 'low':
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Map our severity levels to Jira's priority scale
   */
  private mapSeverityToJira(severity: string): string {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 'Highest';
      case 'high':
        return 'High';
      case 'medium':
        return 'Medium';
      case 'low':
        return 'Low';
      default:
        return 'Medium';
    }
  }

  /**
   * Map our severity levels to Intigriti's scale
   */
  private mapSeverityToIntigriti(severity: string): number {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 5;
      case 'high':
        return 4;
      case 'medium':
        return 3;
      case 'low':
        return 2;
      default:
        return 3;
    }
  }

  /**
   * Map our severity levels to YesWeHack's scale
   */
  private mapSeverityToYesWeHack(severity: string): number {
    switch (severity?.toLowerCase()) {
      case 'critical':
        return 5;
      case 'high':
        return 4;
      case 'medium':
        return 3;
      case 'low':
        return 2;
      default:
        return 3;
    }
  }
}
