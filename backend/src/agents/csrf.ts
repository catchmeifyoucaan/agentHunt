import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import * as crypto from 'crypto';

export interface CSRFJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testTokenPrediction?: boolean;
    testTokenReuse?: boolean;
    testRefererBypass?: boolean;
    testSameSiteBypass?: boolean;
    testJSONCSRF?: boolean;
    testGETCSRF?: boolean;
    timeout?: number;
  };
}

export interface CSRFResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type:
      | 'csrf-no-token'
      | 'csrf-weak-token'
      | 'csrf-token-reuse'
      | 'csrf-referer-bypass'
      | 'csrf-samesite-bypass'
      | 'csrf-json'
      | 'csrf-get-method';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    evidence: string;
    method: string;
    impact: string;
    remediation: string;
    poc?: string;
  }>;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * CSRF (Cross-Site Request Forgery) Agent
 *
 * Detects and exploits CSRF vulnerabilities:
 * - Missing CSRF tokens
 * - Weak/predictable CSRF tokens
 * - Token reuse across sessions
 * - Referer header bypass
 * - SameSite cookie bypass
 * - JSON CSRF
 * - GET-based state changes
 *
 * Attack scenarios:
 * - Account takeover (password/email change)
 * - Unauthorized transactions
 * - Privilege escalation
 * - Data manipulation
 *
 * Tools: Custom CSRF scanner, Burp patterns
 */
export class CSRFAgent extends BaseAgent<CSRFJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('csrf' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify state-changing endpoints', metadata: { phase: 'discovery' } },
      { name: 'Test for missing CSRF tokens', metadata: { phase: 'no-token-testing' } },
      { name: 'Test token prediction', metadata: { phase: 'prediction-testing' } },
      { name: 'Test token reuse', metadata: { phase: 'reuse-testing' } },
      { name: 'Test Referer bypass', metadata: { phase: 'referer-testing' } },
      { name: 'Test SameSite bypass', metadata: { phase: 'samesite-testing' } },
      { name: 'Test JSON CSRF', metadata: { phase: 'json-testing' } },
      { name: 'Test GET-based CSRF', metadata: { phase: 'get-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<CSRFJob>): Promise<CSRFResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'csrf',
      'start',
      'info',
      `Starting CSRF testing on ${urls.length} URLs`
    );

    const result: CSRFResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify state-changing endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const endpoints = await this.identifyStateChangingEndpoints(urls, programId, job.id);
      result.testedEndpoints = endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', { endpointsFound: endpoints.length });

      // Step 2: Test missing CSRF tokens
      await this.updateStepStatus(job.id, 1, 'running');
      const noTokenVulns = await this.testMissingCSRFToken(endpoints, programId, job.id, options);
      result.vulnerabilities.push(...noTokenVulns);
      await this.updateStepStatus(job.id, 1, 'completed', {
        vulnerabilitiesFound: noTokenVulns.length,
      });

      // Step 3: Token prediction
      if (options.testTokenPrediction !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const predictionVulns = await this.testTokenPrediction(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...predictionVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: predictionVulns.length,
        });
      }

      // Step 4: Token reuse
      if (options.testTokenReuse !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const reuseVulns = await this.testTokenReuse(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...reuseVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: reuseVulns.length,
        });
      }

      // Step 5: Referer bypass
      if (options.testRefererBypass !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const refererVulns = await this.testRefererBypass(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...refererVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: refererVulns.length,
        });
      }

      // Step 6: SameSite bypass
      if (options.testSameSiteBypass !== false) {
        await this.updateStepStatus(job.id, 5, 'running');
        const sameSiteVulns = await this.testSameSiteBypass(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...sameSiteVulns);
        await this.updateStepStatus(job.id, 5, 'completed', {
          vulnerabilitiesFound: sameSiteVulns.length,
        });
      }

      // Step 7: JSON CSRF
      if (options.testJSONCSRF !== false) {
        await this.updateStepStatus(job.id, 6, 'running');
        const jsonVulns = await this.testJSONCSRF(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...jsonVulns);
        await this.updateStepStatus(job.id, 6, 'completed', {
          vulnerabilitiesFound: jsonVulns.length,
        });
      }

      // Step 8: GET-based CSRF
      if (options.testGETCSRF !== false) {
        await this.updateStepStatus(job.id, 7, 'running');
        const getVulns = await this.testGETCSRF(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...getVulns);
        await this.updateStepStatus(job.id, 7, 'completed', {
          vulnerabilitiesFound: getVulns.length,
        });
      }

      // Step 9: Store findings
      await this.updateStepStatus(job.id, 8, 'running');
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }
      await this.updateStepStatus(job.id, 8, 'completed', {
        totalVulnerabilities: result.vulnerabilities.length,
      });

      // Three-agent integration
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && result.vulnerabilities.length > 0) {
        await this.shareWithSwarm(swarmId, result.vulnerabilities, job.id);
      }

      result.executionTime = Date.now() - startTime;

      await this.updateJobStatus(job.id, 'completed', result);
      await this.logExecution(
        job.id,
        programId,
        'csrf',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} CSRF vulnerabilities in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'csrf', 'error', 'error', `Error: ${error.message}`);
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify state-changing endpoints (POST, PUT, DELETE, PATCH)
   */
  private async identifyStateChangingEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    // Target endpoints that likely change state
    const stateChangePatterns = [
      '/update',
      '/delete',
      '/change',
      '/password',
      '/email',
      '/profile',
      '/settings',
      '/transfer',
      '/payment',
      '/withdraw',
      '/admin',
      '/api/',
    ];

    const endpoints = urls.filter((url) =>
      stateChangePatterns.some((pattern) => url.toLowerCase().includes(pattern))
    );

    return endpoints.length > 0 ? endpoints : urls.slice(0, 20);
  }

  /**
   * Test for missing CSRF tokens
   */
  private async testMissingCSRFToken(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CSRFJob['options']
  ): Promise<CSRFResult['vulnerabilities']> {
    const vulnerabilities: CSRFResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Try POST request without CSRF token
        const response = await axios.post(
          endpoint,
          { test: 'csrf', action: 'update' },
          {
            timeout: 10000,
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            validateStatus: () => true,
          }
        );

        // If request succeeds without token, vulnerable
        if (response.status === 200 || response.status === 302) {
          const responseBody = typeof response.data === 'string' ? response.data : '';

          // Check if response doesn't mention CSRF error
          const hasCSRFError =
            responseBody.toLowerCase().includes('csrf') ||
            responseBody.toLowerCase().includes('token') ||
            responseBody.toLowerCase().includes('forbidden');

          if (!hasCSRFError) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'csrf-no-token',
              severity: 'high',
              confidence: 0.85,
              evidence: `POST request succeeded without CSRF token (HTTP ${response.status})`,
              method: 'POST',
              impact:
                'Missing CSRF protection allows attackers to perform unauthorized actions on behalf of authenticated users (account takeover, data modification, transactions).',
              remediation:
                'Implement CSRF tokens (synchronizer token pattern or double-submit cookie). Use SameSite cookie attribute. Verify Origin/Referer headers.',
              poc: `<form action="${endpoint}" method="POST"><input name="test" value="csrf"/><input type="submit"/></form>`,
            });
          }
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing missing CSRF token');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test CSRF token prediction
   */
  private async testTokenPrediction(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CSRFJob['options']
  ): Promise<CSRFResult['vulnerabilities']> {
    const vulnerabilities: CSRFResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Get page with form to extract CSRF token
        const formResponse = await axios.get(endpoint, {
          timeout: 10000,
          validateStatus: () => true,
        });

        const html = typeof formResponse.data === 'string' ? formResponse.data : '';

        // Extract CSRF token patterns
        const tokenPatterns = [
          /csrf[_-]?token['"]?\s*[:=]\s*['"]([^'"]+)['"]/i,
          /<input[^>]*name=['"]csrf[_-]?token['"][^>]*value=['"]([^'"]+)['"]/i,
          /X-CSRF-TOKEN['"]?\s*:\s*['"]([^'"]+)['"]/i,
        ];

        let csrfToken = null;
        for (const pattern of tokenPatterns) {
          const match = html.match(pattern);
          if (match) {
            csrfToken = match[1];
            break;
          }
        }

        if (csrfToken) {
          // Analyze token entropy and predictability
          const tokenLength = csrfToken.length;
          const isNumeric = /^\d+$/.test(csrfToken);
          const isBase64 = /^[A-Za-z0-9+/=]+$/.test(csrfToken);
          const entropy = this.calculateEntropy(csrfToken);

          // Weak if: short, numeric-only, low entropy
          const isWeak = tokenLength < 16 || isNumeric || entropy < 3.0;

          if (isWeak) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'csrf-weak-token',
              severity: 'medium',
              confidence: 0.75,
              evidence: `Weak CSRF token detected: length=${tokenLength}, numeric=${isNumeric}, entropy=${entropy.toFixed(2)}`,
              method: 'POST',
              impact:
                'Weak CSRF tokens can be predicted or brute-forced, allowing attackers to forge valid requests.',
              remediation:
                'Generate cryptographically secure random CSRF tokens (at least 128 bits). Use crypto.randomBytes() or equivalent.',
            });
          }
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing token prediction');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test CSRF token reuse across sessions
   */
  private async testTokenReuse(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CSRFJob['options']
  ): Promise<CSRFResult['vulnerabilities']> {
    const vulnerabilities: CSRFResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Get token from first session
        const session1 = await axios.get(endpoint, { timeout: 10000, validateStatus: () => true });
        const html1 = typeof session1.data === 'string' ? session1.data : '';
        const token1 = this.extractCSRFToken(html1);

        if (!token1) continue;

        // Get token from second session (different cookies)
        const session2 = await axios.get(endpoint, {
          timeout: 10000,
          headers: { Cookie: `session=different_session_${Date.now()}` },
          validateStatus: () => true,
        });
        const html2 = typeof session2.data === 'string' ? session2.data : '';

        // Try using token1 in session2
        const reuseResponse = await axios.post(
          endpoint,
          { csrf_token: token1, test: 'reuse' },
          {
            timeout: 10000,
            headers: { Cookie: `session=different_session_${Date.now()}` },
            validateStatus: () => true,
          }
        );

        // If token from session1 works in session2, vulnerable
        if (reuseResponse.status === 200 || reuseResponse.status === 302) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'csrf-token-reuse',
            severity: 'high',
            confidence: 0.8,
            evidence: `CSRF token from one session accepted in different session`,
            method: 'POST',
            impact:
              'Token reuse allows attackers to use a token obtained from their own session to attack other users.',
            remediation:
              'Bind CSRF tokens to user sessions. Regenerate tokens on login/logout. Validate token ownership.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing token reuse');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test Referer header bypass
   */
  private async testRefererBypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CSRFJob['options']
  ): Promise<CSRFResult['vulnerabilities']> {
    const vulnerabilities: CSRFResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test with missing Referer
        const noRefererResponse = await axios.post(
          endpoint,
          { test: 'csrf' },
          {
            timeout: 10000,
            headers: {
              Referer: '',
            },
            validateStatus: () => true,
          }
        );

        // Test with attacker Referer
        const evilRefererResponse = await axios.post(
          endpoint,
          { test: 'csrf' },
          {
            timeout: 10000,
            headers: {
              Referer: 'https://evil.com/attack.html',
            },
            validateStatus: () => true,
          }
        );

        const noRefererSuccess = noRefererResponse.status === 200 || noRefererResponse.status === 302;
        const evilRefererSuccess =
          evilRefererResponse.status === 200 || evilRefererResponse.status === 302;

        if (noRefererSuccess || evilRefererSuccess) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'csrf-referer-bypass',
            severity: 'medium',
            confidence: 0.75,
            evidence: noRefererSuccess
              ? 'Request succeeded with no Referer header'
              : 'Request succeeded with attacker Referer',
            method: 'POST',
            impact:
              'Referer validation bypass allows CSRF attacks even when Referer checking is implemented.',
            remediation:
              'Do not rely solely on Referer validation (can be suppressed). Use CSRF tokens as primary defense. Check Origin header as well.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing Referer bypass');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test SameSite cookie bypass
   */
  private async testSameSiteBypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CSRFJob['options']
  ): Promise<CSRFResult['vulnerabilities']> {
    const vulnerabilities: CSRFResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(endpoint, {
          timeout: 10000,
          validateStatus: () => true,
        });

        // Check Set-Cookie headers for SameSite attribute
        const cookies = response.headers['set-cookie'] || [];
        const cookieStrings = Array.isArray(cookies) ? cookies : [cookies];

        const hasMissingSameSite = cookieStrings.some((cookie) => {
          const hasSession =
            cookie.toLowerCase().includes('session') ||
            cookie.toLowerCase().includes('auth') ||
            cookie.toLowerCase().includes('token');
          const hasSameSite = /samesite=(strict|lax|none)/i.test(cookie);
          return hasSession && !hasSameSite;
        });

        const hasNoneSameSite = cookieStrings.some((cookie) => /samesite=none/i.test(cookie));

        if (hasMissingSameSite) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'csrf-samesite-bypass',
            severity: 'medium',
            confidence: 0.85,
            evidence: 'Session cookie missing SameSite attribute (defaults to Lax in modern browsers)',
            method: 'POST',
            impact:
              'Missing SameSite attribute allows CSRF attacks in older browsers. Modern browsers default to Lax.',
            remediation:
              'Set SameSite=Strict for session cookies (or Lax if needed). Combine with CSRF tokens for defense in depth.',
          });
        }

        if (hasNoneSameSite) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'csrf-samesite-bypass',
            severity: 'high',
            confidence: 0.9,
            evidence: 'Session cookie has SameSite=None, allowing cross-site requests',
            method: 'POST',
            impact:
              'SameSite=None allows cookies to be sent cross-origin, enabling CSRF attacks if no other protections exist.',
            remediation:
              'Use SameSite=Strict or Lax for session cookies. If SameSite=None required, implement CSRF tokens.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing SameSite bypass');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test JSON CSRF
   */
  private async testJSONCSRF(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CSRFJob['options']
  ): Promise<CSRFResult['vulnerabilities']> {
    const vulnerabilities: CSRFResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test JSON request without CSRF protection
        const jsonResponse = await axios.post(
          endpoint,
          { action: 'update', test: 'csrf' },
          {
            timeout: 10000,
            headers: {
              'Content-Type': 'application/json',
            },
            validateStatus: () => true,
          }
        );

        // Also test with text/plain (Flash CSRF bypass)
        const textPlainResponse = await axios.post(
          endpoint,
          JSON.stringify({ action: 'update', test: 'csrf' }),
          {
            timeout: 10000,
            headers: {
              'Content-Type': 'text/plain',
            },
            validateStatus: () => true,
          }
        );

        const jsonSuccess = jsonResponse.status === 200 || jsonResponse.status === 302;
        const textPlainSuccess = textPlainResponse.status === 200 || textPlainResponse.status === 302;

        if (jsonSuccess || textPlainSuccess) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'csrf-json',
            severity: 'high',
            confidence: 0.8,
            evidence: jsonSuccess
              ? 'JSON request succeeded without CSRF token'
              : 'JSON via text/plain succeeded (Flash CSRF bypass)',
            method: 'POST',
            impact:
              'JSON CSRF allows attackers to make state-changing requests via JSON endpoints. Flash CSRF bypass (text/plain) bypasses preflight.',
            remediation:
              'Validate Content-Type strictly. Implement CSRF tokens for JSON endpoints. Use custom headers (X-Requested-With) and verify them.',
            poc: textPlainSuccess
              ? `Flash CSRF: Send JSON with Content-Type: text/plain to bypass CORS preflight`
              : undefined,
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing JSON CSRF');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test GET-based state changes
   */
  private async testGETCSRF(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CSRFJob['options']
  ): Promise<CSRFResult['vulnerabilities']> {
    const vulnerabilities: CSRFResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test GET request for state-changing operations
        const getResponse = await axios.get(
          `${endpoint}?action=delete&id=123`,
          {
            timeout: 10000,
            validateStatus: () => true,
          }
        );

        // If GET request modifies state (200/302 without error), vulnerable
        if (getResponse.status === 200 || getResponse.status === 302) {
          const responseBody = typeof getResponse.data === 'string' ? getResponse.data : '';
          const hasError =
            responseBody.toLowerCase().includes('error') ||
            responseBody.toLowerCase().includes('invalid method');

          if (!hasError) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'csrf-get-method',
              severity: 'high',
              confidence: 0.7,
              evidence: `State-changing operation possible via GET request`,
              method: 'GET',
              impact:
                'GET-based CSRF is trivial to exploit via image tags, links, or redirects. No user interaction required beyond visiting attacker page.',
              remediation:
                'Never use GET for state-changing operations. Use POST/PUT/DELETE with CSRF tokens. Follow REST principles.',
              poc: `<img src="${endpoint}?action=delete&id=123" />`,
            });
          }
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing GET CSRF');
      }
    }

    return vulnerabilities;
  }

  /**
   * Extract CSRF token from HTML
   */
  private extractCSRFToken(html: string): string | null {
    const patterns = [
      /csrf[_-]?token['"]?\s*[:=]\s*['"]([^'"]+)['"]/i,
      /<input[^>]*name=['"]csrf[_-]?token['"][^>]*value=['"]([^'"]+)['"]/i,
      /X-CSRF-TOKEN['"]?\s*:\s*['"]([^'"]+)['"]/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match) return match[1];
    }

    return null;
  }

  /**
   * Calculate Shannon entropy
   */
  private calculateEntropy(str: string): number {
    const len = str.length;
    const frequencies: Record<string, number> = {};

    for (let i = 0; i < len; i++) {
      const char = str[i];
      frequencies[char] = (frequencies[char] || 0) + 1;
    }

    let entropy = 0;
    for (const char in frequencies) {
      const p = frequencies[char] / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: CSRFResult['vulnerabilities'],
    programId: string,
    jobId: string
  ) {
    for (const vuln of vulnerabilities) {
      await database.query(
        `INSERT INTO findings (
          program_id, job_id, type, severity, url, evidence,
          poc, remediation, confidence, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (program_id, url, type) DO UPDATE SET
          evidence = EXCLUDED.evidence,
          updated_at = NOW()`,
        [
          programId,
          jobId,
          vuln.type,
          vuln.severity,
          vuln.url,
          vuln.evidence,
          vuln.poc || '',
          vuln.remediation,
          vuln.confidence,
          JSON.stringify({
            endpoint: vuln.endpoint,
            method: vuln.method,
            impact: vuln.impact,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: vulnerabilities.length,
      severity: vulnerabilities[0]?.severity || 'medium',
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: CSRFResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `csrf-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `csrf-${jobId}`,
        metadata: {
          method: vuln.method,
          impact: vuln.impact,
          poc: vuln.poc,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ CSRF agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share CSRF findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<CSRFJob>, result: CSRFResult) {
    const { programId } = job.data;

    // High severity CSRF -> escalate
    const highSeverityVulns = result.vulnerabilities.filter(
      (v) => v.severity === 'high' || v.severity === 'critical'
    );

    if (highSeverityVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'csrf',
        'triage',
        {
          reason: 'High severity CSRF vulnerabilities detected',
          vulnerabilities: highSeverityVulns,
          priority: 'high',
        },
        programId
      );
    }

    // Confirm all findings
    if (result.vulnerabilities.length > 0) {
      await this.createHandoff(
        job.id,
        'csrf',
        'confirm',
        {
          reason: 'CSRF vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'csrf',
        },
        programId
      );
    }
  }
}
