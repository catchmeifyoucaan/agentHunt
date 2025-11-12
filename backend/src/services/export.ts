import database from './database';
import storage from './storage';
import logger from '../utils/logger';
import { Parser } from 'json2csv';

/**
 * Export Service
 * Exports all data types to CSV and TXT formats
 * Saves everything discovered: subdomains, URLs, findings, PoCs
 */
class ExportService {
  private static instance: ExportService;

  private constructor() {}

  public static getInstance(): ExportService {
    if (!ExportService.instance) {
      ExportService.instance = new ExportService();
    }
    return ExportService.instance;
  }

  /**
   * Export subdomains to TXT and CSV
   */
  public async exportSubdomains(programId: string): Promise<{ txt: string; csv: string }> {
    const result = await database.query(
      `SELECT value, source, status, discovered_at, last_scanned, metadata
       FROM assets
       WHERE program_id = $1 AND type = 'subdomain'
       ORDER BY last_scanned DESC`,
      [programId]
    );

    const assets = result.rows;

    // TXT format (simple list)
    const txtContent = assets.map((a) => a.value).join('\n');
    const txtKey = storage.generateKey(programId, 'exports', `subdomains_${Date.now()}.txt`);
    const txtUrl = await storage.uploadText(txtKey, txtContent);

    // CSV format (detailed)
    const csvParser = new Parser({
      fields: ['subdomain', 'sources', 'status', 'discovered_at', 'last_scanned', 'resolved', 'ip_addresses', 'technologies'],
    });

    const csvData = assets.map((a) => ({
      subdomain: a.value,
      sources: a.source.join(', '),
      status: a.status,
      discovered_at: a.discovered_at,
      last_scanned: a.last_scanned,
      resolved: a.metadata?.resolved || false,
      ip_addresses: a.metadata?.ipAddresses?.join(', ') || '',
      technologies: a.metadata?.technologies?.join(', ') || '',
    }));

    const csvContent = csvParser.parse(csvData);
    const csvKey = storage.generateKey(programId, 'exports', `subdomains_${Date.now()}.csv`);
    const csvUrl = await storage.uploadText(csvKey, csvContent);

    logger.info({ programId, count: assets.length }, 'Exported subdomains');

    return { txt: txtUrl, csv: csvUrl };
  }

  /**
   * Export URLs to TXT and CSV
   */
  public async exportUrls(programId: string): Promise<{ txt: string; csv: string }> {
    const result = await database.query(
      `SELECT value, source, metadata
       FROM assets
       WHERE program_id = $1 AND type = 'url'
       ORDER BY last_scanned DESC`,
      [programId]
    );

    const urls = result.rows;

    // TXT format
    const txtContent = urls.map((u) => u.value).join('\n');
    const txtKey = storage.generateKey(programId, 'exports', `urls_${Date.now()}.txt`);
    const txtUrl = await storage.uploadText(txtKey, txtContent);

    // CSV format
    const csvParser = new Parser({
      fields: ['url', 'source', 'http_status', 'title', 'technologies'],
    });

    const csvData = urls.map((u) => ({
      url: u.value,
      source: u.source.join(', '),
      http_status: u.metadata?.httpStatus || '',
      title: u.metadata?.title || '',
      technologies: u.metadata?.technologies?.join(', ') || '',
    }));

    const csvContent = csvParser.parse(csvData);
    const csvKey = storage.generateKey(programId, 'exports', `urls_${Date.now()}.csv`);
    const csvUrl = await storage.uploadText(csvKey, csvContent);

    logger.info({ programId, count: urls.length }, 'Exported URLs');

    return { txt: txtUrl, csv: csvUrl };
  }

  /**
   * Export findings to CSV
   */
  public async exportFindings(programId: string): Promise<string> {
    const result = await database.query(
      `SELECT
        f.id, f.severity, f.confidence, f.title, f.description,
        f.cvss, f.cwe, f.status, f.created_at,
        a.value as asset,
        (SELECT COUNT(*) FROM jsonb_array_elements(f.confirmations) WHERE value->>'result' = 'pass') as confirmations_passed
       FROM findings f
       JOIN assets a ON f.asset_id = a.id
       WHERE f.program_id = $1
       ORDER BY f.created_at DESC`,
      [programId]
    );

    const findings = result.rows;

    const csvParser = new Parser({
      fields: [
        'id',
        'severity',
        'confidence',
        'title',
        'description',
        'asset',
        'cvss',
        'cwe',
        'status',
        'confirmations_passed',
        'created_at',
      ],
    });

    const csvData = findings.map((f) => ({
      id: f.id,
      severity: f.severity,
      confidence: Math.round(f.confidence * 100) + '%',
      title: f.title,
      description: f.description.replace(/\n/g, ' ').substring(0, 500),
      asset: f.asset,
      cvss: f.cvss || '',
      cwe: f.cwe?.join(', ') || '',
      status: f.status,
      confirmations_passed: f.confirmations_passed || 0,
      created_at: f.created_at,
    }));

    const csvContent = csvParser.parse(csvData);
    const csvKey = storage.generateKey(programId, 'exports', `findings_${Date.now()}.csv`);
    const csvUrl = await storage.uploadText(csvKey, csvContent);

    logger.info({ programId, count: findings.length }, 'Exported findings');

    return csvUrl;
  }

  /**
   * Export fuzzing results to CSV
   */
  public async exportFuzzingResults(jobId: string): Promise<string> {
    // Get job details
    const jobResult = await database.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
    const job = jobResult.rows[0];

    if (!job) {
      throw new Error('Job not found');
    }

    // Parse fuzzing results from job result
    const fuzzingData = job.result?.findings || [];

    const csvParser = new Parser({
      fields: ['target', 'parameter', 'payload', 'response_code', 'response_time', 'matched'],
    });

    const csvContent = csvParser.parse(fuzzingData);
    const csvKey = storage.generateKey(job.program_id, 'exports', `fuzzing_${Date.now()}.csv`);
    const csvUrl = await storage.uploadText(csvKey, csvContent);

    logger.info({ jobId, count: fuzzingData.length }, 'Exported fuzzing results');

    return csvUrl;
  }

  /**
   * Export complete PoC for a finding
   */
  public async exportPoC(findingId: string): Promise<{ markdown: string; txt: string }> {
    const result = await database.query(
      `SELECT f.*, a.value as asset_value, p.name as program_name
       FROM findings f
       JOIN assets a ON f.asset_id = a.id
       JOIN programs p ON f.program_id = p.id
       WHERE f.id = $1`,
      [findingId]
    );

    if (result.rows.length === 0) {
      throw new Error('Finding not found');
    }

    const finding = result.rows[0];

    // Generate markdown PoC
    const markdown = this.generatePoCMarkdown(finding);
    const mdKey = storage.generateKey(finding.program_id, 'pocs', `${findingId}.md`);
    const mdUrl = await storage.uploadText(mdKey, markdown);

    // Generate plain text PoC
    const txt = this.generatePoCText(finding);
    const txtKey = storage.generateKey(finding.program_id, 'pocs', `${findingId}.txt`);
    const txtUrl = await storage.uploadText(txtKey, txt);

    logger.info({ findingId }, 'Exported PoC');

    return { markdown: mdUrl, txt: txtUrl };
  }

  /**
   * Generate markdown PoC document
   */
  private generatePoCMarkdown(finding: any): string {
    return `# ${finding.title}

## Summary
**Program:** ${finding.program_name}
**Asset:** ${finding.asset_value}
**Severity:** ${finding.severity.toUpperCase()}
**Confidence:** ${Math.round(finding.confidence * 100)}%
**CVSS:** ${finding.cvss || 'N/A'}
**CWE:** ${finding.cwe?.join(', ') || 'N/A'}

## Description
${finding.description}

## Impact
${finding.impact || 'See description above'}

## Proof of Concept

### Steps to Reproduce
${finding.poc.steps.map((step: string, i: number) => `${i + 1}. ${step}`).join('\n')}

### Request
\`\`\`http
${finding.poc.curl || 'No curl command available'}
\`\`\`

### Expected Result
Vulnerability can be reproduced with ${Math.round(finding.poc.reproductionRate * 100)}% success rate.

## Evidence
${finding.evidence.map((e: any, i: number) => `### Evidence ${i + 1}\n**Type:** ${e.type}\n\n\`\`\`\n${e.content || 'See attached file: ' + e.url}\n\`\`\``).join('\n\n')}

## Remediation
${finding.remediation || 'Follow security best practices for this vulnerability class'}

## Additional Information
- **Finding ID:** ${finding.id}
- **Discovered:** ${new Date(finding.created_at).toLocaleString()}
- **Status:** ${finding.status}
- **Confirmations:** ${finding.confirmations?.filter((c: any) => c.result === 'pass').length || 0} passed

---
*Generated by AgentHunt Security Platform*
`;
  }

  /**
   * Generate plain text PoC
   */
  private generatePoCText(finding: any): string {
    return `
${finding.title}
${'='.repeat(finding.title.length)}

Program: ${finding.program_name}
Asset: ${finding.asset_value}
Severity: ${finding.severity.toUpperCase()}
Confidence: ${Math.round(finding.confidence * 100)}%
CVSS: ${finding.cvss || 'N/A'}
CWE: ${finding.cwe?.join(', ') || 'N/A'}

DESCRIPTION
-----------
${finding.description}

IMPACT
------
${finding.impact || 'See description above'}

PROOF OF CONCEPT
----------------
Steps to Reproduce:
${finding.poc.steps.map((step: string, i: number) => `  ${i + 1}. ${step}`).join('\n')}

Request:
${finding.poc.curl || 'No curl command available'}

REMEDIATION
-----------
${finding.remediation || 'Follow security best practices'}

Finding ID: ${finding.id}
Discovered: ${new Date(finding.created_at).toLocaleString()}
Status: ${finding.status}

Generated by AgentHunt Security Platform
`.trim();
  }

  /**
   * Export all data for a program (comprehensive export)
   */
  public async exportAll(programId: string): Promise<any> {
    const [subdomains, urls, findings] = await Promise.all([
      this.exportSubdomains(programId),
      this.exportUrls(programId),
      this.exportFindings(programId),
    ]);

    return {
      subdomains,
      urls,
      findings,
      exportedAt: new Date().toISOString(),
    };
  }
}

export default ExportService.getInstance();
