/**
 * Report Generation Service
 * Generates professional vulnerability reports using AI and templates
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import type {
  Finding,
  GeneratedReport,
  ReportTemplate,
  Asset,
  AIModel
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

    // Here you would integrate with the actual platform APIs
    // For now, we'll mark as submitted
    const now = new Date();

    await this.db.query(
      `UPDATE generated_reports
       SET status = 'submitted', submitted_at = $1, updated_at = $2
       WHERE id = $3`,
      [now, now, reportId]
    );

    logger.info({ reportId, platform: report.platform }, 'Report submitted');

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
}
