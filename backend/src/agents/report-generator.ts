/**
 * Auto-Report Generator Agent
 * Purpose: LLM-powered professional vulnerability report generation
 * 
 * Features:
 * - Title generation
 * - Executive summary
 * - Technical details
 * - Impact assessment
 * - Reproduction steps
 * - PoC code/screenshots
 * - Remediation advice
 * - CVSS calculation
 * - HackerOne/Bugcrowd format export
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import ai from '../services/ai';
import { v4 as uuidv4 } from 'uuid';

interface ReportGeneratorJob extends BaseJob {
  type: 'report-generator';
  options: {
    programId: string;
    findingId: string;
    format: 'hackerone' | 'bugcrowd' | 'markdown' | 'pdf';
    includePoC?: boolean;
    includeRemediation?: boolean;
  };
}

interface VulnerabilityReport {
  id: string;
  findingId: string;
  title: string;
  severity: string;
  cvssScore: number;
  cvssVector: string;
  summary: string;
  technicalDetails: string;
  impact: string;
  reproductionSteps: string[];
  poc?: string;
  remediation: string;
  references: string[];
  format: string;
  generatedAt: Date;
}

// CVSS v3.1 base metrics
const CVSS_METRICS = {
  attackVector: { N: 0.85, A: 0.62, L: 0.55, P: 0.2 },
  attackComplexity: { L: 0.77, H: 0.44 },
  privilegesRequired: { N: 0.85, L: 0.62, H: 0.27 },
  userInteraction: { N: 0.85, R: 0.62 },
  scope: { U: 1.0, C: 1.08 },
  confidentiality: { H: 0.56, L: 0.22, N: 0 },
  integrity: { H: 0.56, L: 0.22, N: 0 },
  availability: { H: 0.56, L: 0.22, N: 0 },
};

export class ReportGeneratorAgent extends BaseAgent<ReportGeneratorJob> {
  constructor() {
    super('report-generator');
  }

  protected getSteps() {
    return [
      { name: 'Load finding details' },
      { name: 'Generate title and summary' },
      { name: 'Calculate CVSS score' },
      { name: 'Generate technical details' },
      { name: 'Generate reproduction steps' },
      { name: 'Generate remediation advice' },
      { name: 'Format and export report' },
    ];
  }

  async process(job: Job<ReportGeneratorJob>): Promise<any> {
    const { programId, options } = job.data;
    const { findingId, format, includePoC = true, includeRemediation = true } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Step 1: Load finding details
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 7,
        percentage: 10,
        currentTool: 'finding-loader',
        toolStatus: 'running',
        message: 'Loading finding details',
      });

      const finding = await this.loadFinding(findingId);
      if (!finding) {
        throw new Error(`Finding ${findingId} not found`);
      }

      logger.info({ findingId, type: finding.type }, 'Loaded finding for report generation');

      // Step 2: Generate title and summary
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 7,
        percentage: 20,
        currentTool: 'title-generator',
        toolStatus: 'running',
        message: 'Generating title and summary',
      });

      const { title, summary } = await this.generateTitleAndSummary(finding);

      // Step 3: Calculate CVSS score
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 7,
        percentage: 35,
        currentTool: 'cvss-calculator',
        toolStatus: 'running',
        message: 'Calculating CVSS score',
      });

      const { cvssScore, cvssVector } = await this.calculateCVSS(finding);

      // Step 4: Generate technical details
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 7,
        percentage: 50,
        currentTool: 'technical-generator',
        toolStatus: 'running',
        message: 'Generating technical details',
      });

      const technicalDetails = await this.generateTechnicalDetails(finding);

      // Step 5: Generate reproduction steps
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 7,
        percentage: 65,
        currentTool: 'repro-generator',
        toolStatus: 'running',
        message: 'Generating reproduction steps',
      });

      const reproductionSteps = await this.generateReproductionSteps(finding);
      const poc = includePoC ? await this.generatePoC(finding) : undefined;

      // Step 6: Generate remediation advice
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 7,
        percentage: 80,
        currentTool: 'remediation-generator',
        toolStatus: 'running',
        message: 'Generating remediation advice',
      });

      const remediation = includeRemediation ? await this.generateRemediation(finding) : '';
      const impact = await this.generateImpactAssessment(finding);
      const references = this.getReferences(finding.type);

      // Step 7: Format and export report
      await this.updateJobProgress(job.id!, {
        current: 7,
        total: 7,
        percentage: 95,
        currentTool: 'formatter',
        toolStatus: 'running',
        message: 'Formatting report',
      });

      const report: VulnerabilityReport = {
        id: uuidv4(),
        findingId,
        title,
        severity: finding.severity,
        cvssScore,
        cvssVector,
        summary,
        technicalDetails,
        impact,
        reproductionSteps,
        poc,
        remediation,
        references,
        format,
        generatedAt: new Date(),
      };

      const formattedReport = this.formatReport(report, format);
      await this.storeReport(programId, report, formattedReport, job.id!);

      await this.updateJobProgress(job.id!, {
        current: 7,
        total: 7,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: 'Report generated successfully',
      });

      const result = {
        reportId: report.id,
        findingId,
        title: report.title,
        cvssScore: report.cvssScore,
        format,
        report: formattedReport,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, findingId }, 'Report generation failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Load finding from database
   */
  private async loadFinding(findingId: string): Promise<any> {
    const result = await database.query(
      'SELECT * FROM findings WHERE id = $1',
      [findingId]
    );
    return result.rows[0] || null;
  }

  /**
   * Generate title and summary using AI
   */
  private async generateTitleAndSummary(finding: any): Promise<{ title: string; summary: string }> {
    try {
      const prompt = `Generate a professional bug bounty report title and executive summary for this vulnerability:

Type: ${finding.type}
Severity: ${finding.severity}
URL: ${finding.url}
Description: ${finding.description}
Evidence: ${JSON.stringify(finding.evidence)}

Requirements:
1. Title should be concise but descriptive (max 100 chars)
2. Summary should be 2-3 sentences for executives
3. Use professional security terminology

Respond with JSON: { "title": "...", "summary": "..." }`;

      const response = await this.callAI(prompt);
      try {
        return JSON.parse(response);
      } catch {
        return {
          title: `${finding.severity.toUpperCase()} - ${finding.type} at ${finding.url}`,
          summary: finding.description,
        };
      }
    } catch (error) {
      return {
        title: `${finding.severity.toUpperCase()} - ${finding.type} at ${finding.url}`,
        summary: finding.description,
      };
    }
  }

  /**
   * Calculate CVSS score based on vulnerability type
   */
  private async calculateCVSS(finding: any): Promise<{ cvssScore: number; cvssVector: string }> {
    // Default metrics based on vulnerability type
    const typeMetrics: Record<string, any> = {
      'xss': { AV: 'N', AC: 'L', PR: 'N', UI: 'R', S: 'C', C: 'L', I: 'L', A: 'N' },
      'sqli': { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'H' },
      'ssrf': { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'C', C: 'H', I: 'L', A: 'N' },
      'idor': { AV: 'N', AC: 'L', PR: 'L', UI: 'N', S: 'U', C: 'H', I: 'H', A: 'N' },
      'rce': { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'C', C: 'H', I: 'H', A: 'H' },
      'lfi': { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'N', A: 'N' },
      'xxe': { AV: 'N', AC: 'L', PR: 'N', UI: 'N', S: 'U', C: 'H', I: 'L', A: 'L' },
      'csrf': { AV: 'N', AC: 'L', PR: 'N', UI: 'R', S: 'U', C: 'N', I: 'H', A: 'N' },
      'open-redirect': { AV: 'N', AC: 'L', PR: 'N', UI: 'R', S: 'C', C: 'L', I: 'L', A: 'N' },
    };

    const metrics = typeMetrics[finding.type.toLowerCase()] || typeMetrics['xss'];

    // Calculate CVSS 3.1 score
    const ISS = 1 - ((1 - CVSS_METRICS.confidentiality[metrics.C as keyof typeof CVSS_METRICS.confidentiality]) *
                     (1 - CVSS_METRICS.integrity[metrics.I as keyof typeof CVSS_METRICS.integrity]) *
                     (1 - CVSS_METRICS.availability[metrics.A as keyof typeof CVSS_METRICS.availability]));

    const impact = metrics.S === 'U' 
      ? 6.42 * ISS
      : 7.52 * (ISS - 0.029) - 3.25 * Math.pow(ISS - 0.02, 15);

    const exploitability = 8.22 * 
      CVSS_METRICS.attackVector[metrics.AV as keyof typeof CVSS_METRICS.attackVector] *
      CVSS_METRICS.attackComplexity[metrics.AC as keyof typeof CVSS_METRICS.attackComplexity] *
      CVSS_METRICS.privilegesRequired[metrics.PR as keyof typeof CVSS_METRICS.privilegesRequired] *
      CVSS_METRICS.userInteraction[metrics.UI as keyof typeof CVSS_METRICS.userInteraction];

    let score: number;
    if (impact <= 0) {
      score = 0;
    } else if (metrics.S === 'U') {
      score = Math.min(impact + exploitability, 10);
    } else {
      score = Math.min(1.08 * (impact + exploitability), 10);
    }

    score = Math.round(score * 10) / 10;

    const vector = `CVSS:3.1/AV:${metrics.AV}/AC:${metrics.AC}/PR:${metrics.PR}/UI:${metrics.UI}/S:${metrics.S}/C:${metrics.C}/I:${metrics.I}/A:${metrics.A}`;

    return { cvssScore: score, cvssVector: vector };
  }

  /**
   * Generate technical details
   */
  private async generateTechnicalDetails(finding: any): Promise<string> {
    try {
      const prompt = `Generate detailed technical analysis for this vulnerability:

Type: ${finding.type}
URL: ${finding.url}
Description: ${finding.description}
Evidence: ${JSON.stringify(finding.evidence)}

Include:
1. Root cause analysis
2. Attack vector explanation
3. Technical payload details
4. Request/response analysis

Use markdown formatting.`;

      return await this.callAI(prompt);
    } catch (error) {
      return `## Technical Details\n\n${finding.description}\n\n### Evidence\n\`\`\`\n${JSON.stringify(finding.evidence, null, 2)}\n\`\`\``;
    }
  }

  /**
   * Generate reproduction steps
   */
  private async generateReproductionSteps(finding: any): Promise<string[]> {
    try {
      const prompt = `Generate step-by-step reproduction instructions for this vulnerability:

Type: ${finding.type}
URL: ${finding.url}
Description: ${finding.description}

Provide clear, numbered steps that a security researcher can follow.
Respond with JSON array: ["Step 1...", "Step 2...", ...]`;

      const response = await this.callAI(prompt);
      try {
        return JSON.parse(response);
      } catch {
        return [
          `Navigate to ${finding.url}`,
          'Observe the vulnerability as described',
          'Verify the impact',
        ];
      }
    } catch (error) {
      return [
        `Navigate to ${finding.url}`,
        'Observe the vulnerability as described',
        'Verify the impact',
      ];
    }
  }

  /**
   * Generate PoC
   */
  private async generatePoC(finding: any): Promise<string> {
    try {
      const prompt = `Generate a proof-of-concept for this vulnerability:

Type: ${finding.type}
URL: ${finding.url}
Evidence: ${JSON.stringify(finding.evidence)}

Provide:
1. cURL command or HTTP request
2. Expected response
3. Any necessary setup

Use code blocks with appropriate syntax highlighting.`;

      return await this.callAI(prompt);
    } catch (error) {
      return `\`\`\`bash\ncurl -X GET "${finding.url}"\n\`\`\``;
    }
  }

  /**
   * Generate remediation advice
   */
  private async generateRemediation(finding: any): Promise<string> {
    try {
      const prompt = `Generate remediation advice for this vulnerability:

Type: ${finding.type}
Severity: ${finding.severity}

Provide:
1. Immediate mitigation steps
2. Long-term fix recommendations
3. Code examples if applicable
4. Security best practices

Use markdown formatting.`;

      return await this.callAI(prompt);
    } catch (error) {
      return this.getDefaultRemediation(finding.type);
    }
  }

  /**
   * Generate impact assessment
   */
  private async generateImpactAssessment(finding: any): Promise<string> {
    try {
      const prompt = `Generate a business impact assessment for this vulnerability:

Type: ${finding.type}
Severity: ${finding.severity}
URL: ${finding.url}

Include:
1. Potential business impact
2. Data at risk
3. Compliance implications
4. Reputation risk

Keep it concise (2-3 paragraphs).`;

      return await this.callAI(prompt);
    } catch (error) {
      return `This ${finding.severity} severity ${finding.type} vulnerability could lead to unauthorized access, data exposure, or system compromise.`;
    }
  }

  /**
   * Get references for vulnerability type
   */
  private getReferences(type: string): string[] {
    const references: Record<string, string[]> = {
      'xss': [
        'https://owasp.org/www-community/attacks/xss/',
        'https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html',
      ],
      'sqli': [
        'https://owasp.org/www-community/attacks/SQL_Injection',
        'https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html',
      ],
      'ssrf': [
        'https://owasp.org/www-community/attacks/Server_Side_Request_Forgery',
        'https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html',
      ],
      'idor': [
        'https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/05-Authorization_Testing/04-Testing_for_Insecure_Direct_Object_References',
      ],
    };

    return references[type.toLowerCase()] || ['https://owasp.org/www-project-top-ten/'];
  }

  /**
   * Get default remediation
   */
  private getDefaultRemediation(type: string): string {
    const remediations: Record<string, string> = {
      'xss': '## Remediation\n\n1. Implement proper output encoding\n2. Use Content Security Policy (CSP)\n3. Validate and sanitize all user input',
      'sqli': '## Remediation\n\n1. Use parameterized queries/prepared statements\n2. Implement input validation\n3. Apply principle of least privilege to database accounts',
      'ssrf': '## Remediation\n\n1. Validate and sanitize URLs\n2. Use allowlists for permitted domains\n3. Block requests to internal networks',
      'idor': '## Remediation\n\n1. Implement proper authorization checks\n2. Use indirect object references\n3. Validate user permissions for each request',
    };

    return remediations[type.toLowerCase()] || '## Remediation\n\nImplement proper security controls and follow OWASP guidelines.';
  }

  /**
   * Format report based on platform
   */
  private formatReport(report: VulnerabilityReport, format: string): string {
    switch (format) {
      case 'hackerone':
        return this.formatHackerOne(report);
      case 'bugcrowd':
        return this.formatBugcrowd(report);
      case 'markdown':
      default:
        return this.formatMarkdown(report);
    }
  }

  private formatHackerOne(report: VulnerabilityReport): string {
    return `## Summary
${report.summary}

## Severity
${report.severity.toUpperCase()} (CVSS ${report.cvssScore})
${report.cvssVector}

## Steps To Reproduce
${report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Impact
${report.impact}

${report.poc ? `## Proof of Concept\n${report.poc}` : ''}

## Remediation
${report.remediation}

## References
${report.references.map(r => `- ${r}`).join('\n')}`;
  }

  private formatBugcrowd(report: VulnerabilityReport): string {
    return `# ${report.title}

**Severity:** ${report.severity.toUpperCase()}
**CVSS Score:** ${report.cvssScore}

## Description
${report.summary}

## Technical Details
${report.technicalDetails}

## Reproduction Steps
${report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

## Business Impact
${report.impact}

${report.poc ? `## PoC\n${report.poc}` : ''}

## Suggested Fix
${report.remediation}`;
  }

  private formatMarkdown(report: VulnerabilityReport): string {
    return `# ${report.title}

| Field | Value |
|-------|-------|
| Severity | ${report.severity.toUpperCase()} |
| CVSS Score | ${report.cvssScore} |
| CVSS Vector | ${report.cvssVector} |

## Executive Summary
${report.summary}

## Technical Details
${report.technicalDetails}

## Impact Assessment
${report.impact}

## Steps to Reproduce
${report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${report.poc ? `## Proof of Concept\n${report.poc}` : ''}

## Remediation
${report.remediation}

## References
${report.references.map(r => `- ${r}`).join('\n')}

---
*Report generated on ${report.generatedAt.toISOString()}*`;
  }

  /**
   * Call AI service
   */
  private async callAI(prompt: string): Promise<string> {
    try {
      // Try to use the AI service
      const response = await (ai as any).generateText?.(prompt) || 
                       await (ai as any).chat?.([{ role: 'user', content: prompt }]) ||
                       prompt;
      return response;
    } catch (error) {
      logger.debug({ error }, 'AI call failed, using fallback');
      return '';
    }
  }

  /**
   * Store report in database
   */
  private async storeReport(programId: string, report: VulnerabilityReport, formattedReport: string, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerability_reports (id, program_id, finding_id, title, severity, cvss_score, cvss_vector, content, format, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO UPDATE SET content = $8, updated_at = CURRENT_TIMESTAMP`,
        [
          report.id,
          programId,
          report.findingId,
          report.title,
          report.severity,
          report.cvssScore,
          report.cvssVector,
          formattedReport,
          report.format,
        ]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store report');
    }
  }

  /**
   * Generate PDF report using HTML template
   */
  async generatePDF(report: VulnerabilityReport): Promise<Buffer> {
    const html = this.generatePDFHTML(report);
    
    try {
      // Use puppeteer or similar for PDF generation
      const result = await this.executeCommand(
        `echo '${html.replace(/'/g, "\\'")}' | wkhtmltopdf - /tmp/report-${report.id}.pdf`,
        { timeout: 30000 }
      );

      // Read the PDF file
      const pdfResult = await this.executeCommand(`cat /tmp/report-${report.id}.pdf | base64`, { timeout: 10000 });
      
      // Cleanup
      await this.executeCommand(`rm -f /tmp/report-${report.id}.pdf`, { timeout: 5000 });

      return Buffer.from(pdfResult.stdout, 'base64');
    } catch (error) {
      logger.error({ error }, 'PDF generation failed');
      throw error;
    }
  }

  /**
   * Generate HTML for PDF
   */
  private generatePDFHTML(report: VulnerabilityReport): string {
    const severityColors: Record<string, string> = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#28a745',
      info: '#17a2b8',
    };

    const color = severityColors[report.severity.toLowerCase()] || '#6c757d';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 40px; color: #333; }
    h1 { color: #1a1a2e; border-bottom: 3px solid ${color}; padding-bottom: 10px; }
    h2 { color: #16213e; margin-top: 30px; }
    .severity-badge { 
      display: inline-block; 
      background: ${color}; 
      color: white; 
      padding: 5px 15px; 
      border-radius: 20px; 
      font-weight: bold;
      margin-right: 10px;
    }
    .cvss-score {
      display: inline-block;
      background: #1a1a2e;
      color: white;
      padding: 5px 15px;
      border-radius: 20px;
    }
    .meta-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .meta-table td { padding: 10px; border: 1px solid #ddd; }
    .meta-table td:first-child { background: #f8f9fa; font-weight: bold; width: 200px; }
    .code-block { 
      background: #1a1a2e; 
      color: #00ff00; 
      padding: 15px; 
      border-radius: 5px; 
      font-family: 'Consolas', monospace;
      overflow-x: auto;
      white-space: pre-wrap;
    }
    .steps { counter-reset: step; }
    .steps li { 
      counter-increment: step; 
      margin: 10px 0; 
      padding: 10px;
      background: #f8f9fa;
      border-left: 3px solid ${color};
    }
    .steps li::before { 
      content: counter(step); 
      background: ${color}; 
      color: white;
      padding: 2px 8px;
      border-radius: 50%;
      margin-right: 10px;
    }
    .footer { 
      margin-top: 50px; 
      padding-top: 20px; 
      border-top: 1px solid #ddd; 
      color: #666; 
      font-size: 12px; 
    }
    .impact-box {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 15px;
      border-radius: 5px;
      margin: 15px 0;
    }
    .remediation-box {
      background: #d4edda;
      border: 1px solid #28a745;
      padding: 15px;
      border-radius: 5px;
      margin: 15px 0;
    }
  </style>
</head>
<body>
  <h1>${report.title}</h1>
  
  <p>
    <span class="severity-badge">${report.severity.toUpperCase()}</span>
    <span class="cvss-score">CVSS ${report.cvssScore}</span>
  </p>

  <table class="meta-table">
    <tr><td>Finding ID</td><td>${report.findingId}</td></tr>
    <tr><td>CVSS Vector</td><td><code>${report.cvssVector}</code></td></tr>
    <tr><td>Generated</td><td>${report.generatedAt.toISOString()}</td></tr>
  </table>

  <h2>Executive Summary</h2>
  <p>${report.summary}</p>

  <h2>Technical Details</h2>
  <p>${report.technicalDetails}</p>

  <h2>Impact Assessment</h2>
  <div class="impact-box">
    ${report.impact}
  </div>

  <h2>Steps to Reproduce</h2>
  <ol class="steps">
    ${report.reproductionSteps.map(s => `<li>${s}</li>`).join('\n')}
  </ol>

  ${report.poc ? `
  <h2>Proof of Concept</h2>
  <div class="code-block">${report.poc}</div>
  ` : ''}

  <h2>Remediation</h2>
  <div class="remediation-box">
    ${report.remediation}
  </div>

  <h2>References</h2>
  <ul>
    ${report.references.map(r => `<li><a href="${r}">${r}</a></li>`).join('\n')}
  </ul>

  <div class="footer">
    <p>Report generated by AgentHunt Automated Security Scanner</p>
    <p>Report ID: ${report.id}</p>
  </div>
</body>
</html>`;
  }

  /**
   * Create Jira issue from report
   */
  async createJiraIssue(report: VulnerabilityReport, config: {
    baseUrl: string;
    projectKey: string;
    apiToken: string;
    email: string;
  }): Promise<string> {
    const priorityMap: Record<string, string> = {
      critical: 'Highest',
      high: 'High',
      medium: 'Medium',
      low: 'Low',
      info: 'Lowest',
    };

    const issueData = {
      fields: {
        project: { key: config.projectKey },
        summary: `[Security] ${report.title}`,
        description: {
          type: 'doc',
          version: 1,
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `Severity: ${report.severity.toUpperCase()} | CVSS: ${report.cvssScore}` }]
            },
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Summary' }]
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: report.summary }]
            },
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Technical Details' }]
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: report.technicalDetails }]
            },
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [{ type: 'text', text: 'Remediation' }]
            },
            {
              type: 'paragraph',
              content: [{ type: 'text', text: report.remediation }]
            },
          ]
        },
        issuetype: { name: 'Bug' },
        priority: { name: priorityMap[report.severity.toLowerCase()] || 'Medium' },
        labels: ['security', 'vulnerability', report.severity.toLowerCase()],
      }
    };

    try {
      const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
      
      const result = await this.executeCommand(
        `curl -s -X POST "${config.baseUrl}/rest/api/3/issue" \
          -H "Authorization: Basic ${auth}" \
          -H "Content-Type: application/json" \
          -d '${JSON.stringify(issueData).replace(/'/g, "\\'")}'`,
        { timeout: 30000 }
      );

      const response = JSON.parse(result.stdout);
      logger.info({ issueKey: response.key }, 'Jira issue created');
      return response.key;
    } catch (error) {
      logger.error({ error }, 'Failed to create Jira issue');
      throw error;
    }
  }

  /**
   * Create GitHub issue from report
   */
  async createGitHubIssue(report: VulnerabilityReport, config: {
    owner: string;
    repo: string;
    token: string;
  }): Promise<number> {
    const labelMap: Record<string, string[]> = {
      critical: ['security', 'critical', 'priority: high'],
      high: ['security', 'high', 'priority: high'],
      medium: ['security', 'medium', 'priority: medium'],
      low: ['security', 'low', 'priority: low'],
      info: ['security', 'info'],
    };

    const body = `## ${report.title}

**Severity:** ${report.severity.toUpperCase()}
**CVSS Score:** ${report.cvssScore}
**CVSS Vector:** \`${report.cvssVector}\`

### Summary
${report.summary}

### Technical Details
${report.technicalDetails}

### Impact
${report.impact}

### Steps to Reproduce
${report.reproductionSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

${report.poc ? `### Proof of Concept\n\`\`\`\n${report.poc}\n\`\`\`` : ''}

### Remediation
${report.remediation}

### References
${report.references.map(r => `- ${r}`).join('\n')}

---
*Generated by AgentHunt | Finding ID: ${report.findingId}*`;

    const issueData = {
      title: `[Security] ${report.title}`,
      body,
      labels: labelMap[report.severity.toLowerCase()] || ['security'],
    };

    try {
      const result = await this.executeCommand(
        `curl -s -X POST "https://api.github.com/repos/${config.owner}/${config.repo}/issues" \
          -H "Authorization: token ${config.token}" \
          -H "Accept: application/vnd.github.v3+json" \
          -d '${JSON.stringify(issueData).replace(/'/g, "\\'")}'`,
        { timeout: 30000 }
      );

      const response = JSON.parse(result.stdout);
      logger.info({ issueNumber: response.number }, 'GitHub issue created');
      return response.number;
    } catch (error) {
      logger.error({ error }, 'Failed to create GitHub issue');
      throw error;
    }
  }

  /**
   * Generate executive summary for multiple findings
   */
  async generateExecutiveSummary(programId: string, findings: any[]): Promise<string> {
    const severityCounts = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    };

    const prompt = `Generate a professional executive summary for a security assessment with the following findings:

Total Findings: ${findings.length}
- Critical: ${severityCounts.critical}
- High: ${severityCounts.high}
- Medium: ${severityCounts.medium}
- Low: ${severityCounts.low}
- Informational: ${severityCounts.info}

Top vulnerability types:
${findings.slice(0, 10).map(f => `- ${f.title || f.type}`).join('\n')}

Write a 2-3 paragraph executive summary suitable for C-level executives. Include:
1. Overall security posture assessment
2. Key risks identified
3. Recommended priority actions`;

    return await this.callAI(prompt);
  }

  /**
   * Generate comparison report between two scans
   */
  async generateComparisonReport(programId: string, oldScanId: string, newScanId: string): Promise<string> {
    try {
      const oldFindings = await database.query(
        'SELECT * FROM findings WHERE program_id = $1 AND job_id = $2',
        [programId, oldScanId]
      );

      const newFindings = await database.query(
        'SELECT * FROM findings WHERE program_id = $1 AND job_id = $2',
        [programId, newScanId]
      );

      const oldSet = new Set(oldFindings.rows.map((f: any) => f.hash || f.id));
      const newSet = new Set(newFindings.rows.map((f: any) => f.hash || f.id));

      const newVulns = newFindings.rows.filter((f: any) => !oldSet.has(f.hash || f.id));
      const fixedVulns = oldFindings.rows.filter((f: any) => !newSet.has(f.hash || f.id));
      const persistentVulns = newFindings.rows.filter((f: any) => oldSet.has(f.hash || f.id));

      return `# Security Scan Comparison Report

## Summary
| Metric | Count |
|--------|-------|
| New Vulnerabilities | ${newVulns.length} |
| Fixed Vulnerabilities | ${fixedVulns.length} |
| Persistent Vulnerabilities | ${persistentVulns.length} |

## New Vulnerabilities
${newVulns.map((f: any) => `- **${f.severity?.toUpperCase()}**: ${f.title || f.type}`).join('\n') || 'None'}

## Fixed Vulnerabilities
${fixedVulns.map((f: any) => `- ~~${f.title || f.type}~~`).join('\n') || 'None'}

## Persistent Vulnerabilities
${persistentVulns.map((f: any) => `- ${f.title || f.type}`).join('\n') || 'None'}

---
*Comparison generated on ${new Date().toISOString()}*`;
    } catch (error) {
      logger.error({ error }, 'Failed to generate comparison report');
      return 'Failed to generate comparison report';
    }
  }
}

export default new ReportGeneratorAgent();
