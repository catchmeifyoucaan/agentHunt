/**
 * OAuth Security Testing Agent
 * Purpose: Detect OAuth/OIDC vulnerabilities
 * 
 * Attack Vectors:
 * - redirect_uri manipulation (open redirect, token theft)
 * - State parameter bypass (CSRF)
 * - Implicit flow attacks
 * - Token theft via XSS
 * - Account linking attacks
 * - Pre-account takeover
 * - Scope upgrade attacks
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface OAuthJob extends BaseJob {
  type: 'oauth';
  options: {
    targetUrl: string;
    programId: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    clientId?: string;
    redirectUri?: string;
    testAllVectors?: boolean;
  };
}

interface OAuthFinding {
  vulnerability: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  endpoint: string;
  payload?: string;
  description: string;
  impact: string;
  evidence?: string;
}

export class OAuthAgent extends BaseAgent<OAuthJob> {
  // Common OAuth endpoints to discover
  private readonly OAUTH_ENDPOINTS = [
    '/oauth/authorize',
    '/oauth2/authorize',
    '/oauth/auth',
    '/authorize',
    '/auth',
    '/login/oauth',
    '/connect/authorize',
    '/.well-known/openid-configuration',
    '/.well-known/oauth-authorization-server',
  ];

  // redirect_uri bypass payloads
  private readonly REDIRECT_BYPASSES = [
    // Subdomain bypass
    (uri: string) => uri.replace('://', '://evil.'),
    // Path traversal
    (uri: string) => `${uri}/../../../evil.com`,
    // Parameter pollution
    (uri: string) => `${uri}?@evil.com`,
    (uri: string) => `${uri}#@evil.com`,
    // URL encoding
    (uri: string) => `${uri}%2f%2fevil.com`,
    // Backslash
    (uri: string) => `${uri}\\evil.com`,
    // Null byte
    (uri: string) => `${uri}%00.evil.com`,
    // Unicode
    (uri: string) => `${uri}%E3%80%82evil.com`,
    // Open redirect chain
    (uri: string) => `${uri}/redirect?url=https://evil.com`,
    // Localhost bypass
    (uri: string) => uri.replace(/https?:\/\/[^/]+/, 'http://localhost'),
    // IP address
    (uri: string) => uri.replace(/https?:\/\/[^/]+/, 'http://127.0.0.1'),
  ];

  constructor() {
    super('oauth');
  }

  protected getSteps() {
    return [
      { name: 'Discover OAuth endpoints' },
      { name: 'Test redirect_uri manipulation' },
      { name: 'Test state parameter bypass' },
      { name: 'Test scope upgrade attacks' },
      { name: 'Test token leakage vectors' },
      { name: 'Store findings' },
    ];
  }

  async process(job: Job<OAuthJob>): Promise<any> {
    const { programId, options } = job.data;
    const { targetUrl, testAllVectors = true } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const findings: OAuthFinding[] = [];

    try {
      // Step 1: Discover OAuth endpoints
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'endpoint-discovery',
        toolStatus: 'running',
        message: 'Discovering OAuth endpoints',
      });

      const endpoints = await this.discoverOAuthEndpoints(targetUrl);
      logger.info({ endpointCount: endpoints.length }, 'Discovered OAuth endpoints');

      if (endpoints.length === 0) {
        // Try to use provided endpoints
        if (options.authorizationEndpoint) {
          endpoints.push({
            type: 'authorization',
            url: options.authorizationEndpoint,
          });
        }
      }

      // Step 2: Test redirect_uri manipulation
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'redirect-uri-test',
        toolStatus: 'running',
        message: 'Testing redirect_uri manipulation',
      });

      const redirectFindings = await this.testRedirectUri(
        endpoints,
        options.redirectUri || `${targetUrl}/callback`,
        options.clientId
      );
      findings.push(...redirectFindings);

      // Step 3: Test state parameter bypass
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 45,
        currentTool: 'state-bypass-test',
        toolStatus: 'running',
        message: 'Testing state parameter bypass',
      });

      const stateFindings = await this.testStateBypass(endpoints, options.clientId);
      findings.push(...stateFindings);

      // Step 4: Test scope upgrade attacks
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 60,
        currentTool: 'scope-upgrade-test',
        toolStatus: 'running',
        message: 'Testing scope upgrade attacks',
      });

      const scopeFindings = await this.testScopeUpgrade(endpoints, options.clientId);
      findings.push(...scopeFindings);

      // Step 5: Test token leakage vectors
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 80,
        currentTool: 'token-leakage-test',
        toolStatus: 'running',
        message: 'Testing token leakage vectors',
      });

      const tokenFindings = await this.testTokenLeakage(endpoints, options.clientId);
      findings.push(...tokenFindings);

      // Step 6: Store findings
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 95,
        currentTool: 'storage',
        toolStatus: 'running',
        message: 'Storing findings',
      });

      for (const finding of findings) {
        await this.storeFinding(programId, finding, job.id!);
      }

      // Trigger handoffs for critical findings
      if (findings.some(f => f.severity === 'critical')) {
        await this.triggerHandoffs(programId, findings, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${findings.length} OAuth vulnerabilities`,
      });

      const result = {
        targetUrl,
        endpointsDiscovered: endpoints.length,
        findingsCount: findings.length,
        criticalCount: findings.filter(f => f.severity === 'critical').length,
        highCount: findings.filter(f => f.severity === 'high').length,
        findings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'OAuth testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Discover OAuth endpoints
   */
  private async discoverOAuthEndpoints(baseUrl: string): Promise<Array<{ type: string; url: string }>> {
    const endpoints: Array<{ type: string; url: string }> = [];

    // Try well-known endpoints first
    try {
      const wellKnownUrl = `${baseUrl}/.well-known/openid-configuration`;
      const response = await this.makeRequest(wellKnownUrl, 'GET');
      
      if (response.status === 200) {
        const config = JSON.parse(response.body);
        if (config.authorization_endpoint) {
          endpoints.push({ type: 'authorization', url: config.authorization_endpoint });
        }
        if (config.token_endpoint) {
          endpoints.push({ type: 'token', url: config.token_endpoint });
        }
        if (config.userinfo_endpoint) {
          endpoints.push({ type: 'userinfo', url: config.userinfo_endpoint });
        }
      }
    } catch {}

    // Probe common endpoints
    for (const endpoint of this.OAUTH_ENDPOINTS) {
      try {
        const url = `${baseUrl}${endpoint}`;
        const response = await this.makeRequest(url, 'GET');
        
        // OAuth endpoints typically return 400 (missing params) or redirect
        if (response.status === 400 || response.status === 302 || response.status === 200) {
          endpoints.push({ type: 'authorization', url });
        }
      } catch {}
    }

    return endpoints;
  }

  /**
   * Test redirect_uri manipulation
   */
  private async testRedirectUri(
    endpoints: Array<{ type: string; url: string }>,
    legitimateRedirectUri: string,
    clientId?: string
  ): Promise<OAuthFinding[]> {
    const findings: OAuthFinding[] = [];

    for (const endpoint of endpoints.filter(e => e.type === 'authorization')) {
      for (const bypass of this.REDIRECT_BYPASSES) {
        try {
          const maliciousUri = bypass(legitimateRedirectUri);
          const testUrl = this.buildOAuthUrl(endpoint.url, {
            client_id: clientId || 'test',
            redirect_uri: maliciousUri,
            response_type: 'code',
            scope: 'openid',
          });

          const response = await this.makeRequest(testUrl, 'GET');

          // Check if redirect_uri was accepted
          if (response.status === 302) {
            const location = response.headers['location'] || '';
            if (location.includes('evil') || location.includes(maliciousUri)) {
              findings.push({
                vulnerability: 'OAuth redirect_uri Bypass',
                severity: 'critical',
                endpoint: endpoint.url,
                payload: maliciousUri,
                description: `The OAuth authorization endpoint accepts a manipulated redirect_uri that could redirect tokens to an attacker-controlled domain.`,
                impact: 'Account takeover via OAuth token theft',
                evidence: `Redirect accepted to: ${location}`,
              });
            }
          }

          // Check if error message reveals accepted patterns
          if (response.status === 400 && response.body) {
            if (!response.body.includes('redirect_uri') && !response.body.includes('invalid')) {
              findings.push({
                vulnerability: 'OAuth redirect_uri Validation Weakness',
                severity: 'medium',
                endpoint: endpoint.url,
                payload: maliciousUri,
                description: `The OAuth endpoint may have weak redirect_uri validation.`,
                impact: 'Potential for redirect_uri bypass with further testing',
              });
            }
          }
        } catch {}
      }
    }

    return findings;
  }

  /**
   * Test state parameter bypass (CSRF)
   */
  private async testStateBypass(
    endpoints: Array<{ type: string; url: string }>,
    clientId?: string
  ): Promise<OAuthFinding[]> {
    const findings: OAuthFinding[] = [];

    for (const endpoint of endpoints.filter(e => e.type === 'authorization')) {
      // Test without state parameter
      try {
        const testUrl = this.buildOAuthUrl(endpoint.url, {
          client_id: clientId || 'test',
          redirect_uri: 'https://example.com/callback',
          response_type: 'code',
          scope: 'openid',
          // No state parameter
        });

        const response = await this.makeRequest(testUrl, 'GET');

        // If request proceeds without state, it's vulnerable to CSRF
        if (response.status === 302 || response.status === 200) {
          const location = response.headers['location'] || '';
          if (!location.includes('error')) {
            findings.push({
              vulnerability: 'OAuth State Parameter Not Required',
              severity: 'high',
              endpoint: endpoint.url,
              description: `The OAuth authorization endpoint does not require a state parameter, making it vulnerable to CSRF attacks.`,
              impact: 'Cross-Site Request Forgery leading to account linking attacks',
            });
          }
        }
      } catch {}

      // Test with predictable state
      try {
        const testUrl = this.buildOAuthUrl(endpoint.url, {
          client_id: clientId || 'test',
          redirect_uri: 'https://example.com/callback',
          response_type: 'code',
          scope: 'openid',
          state: '1', // Predictable state
        });

        const response = await this.makeRequest(testUrl, 'GET');

        if (response.status === 302 || response.status === 200) {
          findings.push({
            vulnerability: 'OAuth Accepts Weak State Parameter',
            severity: 'medium',
            endpoint: endpoint.url,
            payload: 'state=1',
            description: `The OAuth endpoint accepts a weak/predictable state parameter.`,
            impact: 'Potential CSRF if state validation is weak on callback',
          });
        }
      } catch {}
    }

    return findings;
  }

  /**
   * Test scope upgrade attacks
   */
  private async testScopeUpgrade(
    endpoints: Array<{ type: string; url: string }>,
    clientId?: string
  ): Promise<OAuthFinding[]> {
    const findings: OAuthFinding[] = [];

    const privilegedScopes = [
      'admin',
      'write',
      'delete',
      'user:admin',
      'repo',
      'gist',
      'admin:org',
      'admin:repo_hook',
      'admin:enterprise',
      'read:user write:user',
      'offline_access',
    ];

    for (const endpoint of endpoints.filter(e => e.type === 'authorization')) {
      for (const scope of privilegedScopes) {
        try {
          const testUrl = this.buildOAuthUrl(endpoint.url, {
            client_id: clientId || 'test',
            redirect_uri: 'https://example.com/callback',
            response_type: 'code',
            scope: scope,
            state: uuidv4(),
          });

          const response = await this.makeRequest(testUrl, 'GET');

          // Check if privileged scope is accepted
          if (response.status === 302 || response.status === 200) {
            const location = response.headers['location'] || '';
            if (!location.includes('error') && !location.includes('invalid_scope')) {
              findings.push({
                vulnerability: 'OAuth Scope Upgrade Possible',
                severity: 'high',
                endpoint: endpoint.url,
                payload: `scope=${scope}`,
                description: `The OAuth endpoint accepts a privileged scope "${scope}" that may grant elevated permissions.`,
                impact: 'Privilege escalation via OAuth scope manipulation',
              });
            }
          }
        } catch {}
      }
    }

    return findings;
  }

  /**
   * Test token leakage vectors
   */
  private async testTokenLeakage(
    endpoints: Array<{ type: string; url: string }>,
    clientId?: string
  ): Promise<OAuthFinding[]> {
    const findings: OAuthFinding[] = [];

    for (const endpoint of endpoints.filter(e => e.type === 'authorization')) {
      // Test implicit flow (token in URL fragment)
      try {
        const testUrl = this.buildOAuthUrl(endpoint.url, {
          client_id: clientId || 'test',
          redirect_uri: 'https://example.com/callback',
          response_type: 'token', // Implicit flow
          scope: 'openid',
          state: uuidv4(),
        });

        const response = await this.makeRequest(testUrl, 'GET');

        if (response.status === 302 || response.status === 200) {
          const location = response.headers['location'] || '';
          if (!location.includes('error') && !location.includes('unsupported_response_type')) {
            findings.push({
              vulnerability: 'OAuth Implicit Flow Enabled',
              severity: 'medium',
              endpoint: endpoint.url,
              payload: 'response_type=token',
              description: `The OAuth endpoint supports implicit flow which exposes tokens in URL fragments, making them vulnerable to leakage via Referer headers and browser history.`,
              impact: 'Token leakage via browser history, Referer headers, or XSS',
            });
          }
        }
      } catch {}

      // Test token + code hybrid flow
      try {
        const testUrl = this.buildOAuthUrl(endpoint.url, {
          client_id: clientId || 'test',
          redirect_uri: 'https://example.com/callback',
          response_type: 'code token', // Hybrid flow
          scope: 'openid',
          state: uuidv4(),
        });

        const response = await this.makeRequest(testUrl, 'GET');

        if (response.status === 302 || response.status === 200) {
          const location = response.headers['location'] || '';
          if (!location.includes('error')) {
            findings.push({
              vulnerability: 'OAuth Hybrid Flow Enabled',
              severity: 'low',
              endpoint: endpoint.url,
              payload: 'response_type=code token',
              description: `The OAuth endpoint supports hybrid flow which may expose tokens in URL fragments.`,
              impact: 'Potential token leakage in hybrid flow scenarios',
            });
          }
        }
      } catch {}
    }

    return findings;
  }

  /**
   * Build OAuth URL with parameters
   */
  private buildOAuthUrl(baseUrl: string, params: Record<string, string>): string {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }

  /**
   * Make HTTP request
   */
  private async makeRequest(
    url: string,
    method: string
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    try {
      const response = await fetch(url, {
        method,
        redirect: 'manual', // Don't follow redirects
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      });

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });

      return {
        status: response.status,
        body: await response.text(),
        headers,
      };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Store finding in database
   */
  private async storeFinding(programId: string, finding: OAuthFinding, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          programId,
          jobId,
          'oauth',
          finding.severity,
          finding.vulnerability,
          finding.endpoint,
          `${finding.description}\n\nImpact: ${finding.impact}`,
          JSON.stringify({ payload: finding.payload, evidence: finding.evidence }),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save OAuth finding');
    }
  }

  /**
   * Trigger handoffs for critical findings
   */
  private async triggerHandoffs(programId: string, findings: OAuthFinding[], jobId: string): Promise<void> {
    const criticalFindings = findings.filter(f => f.severity === 'critical');
    
    if (criticalFindings.length > 0) {
      await this.handoff('triage', {
        toAgent: 'triage',
        reason: `Found ${criticalFindings.length} critical OAuth vulnerabilities requiring immediate triage`,
        data: {
          findings: criticalFindings,
          urgency: 'critical',
        },
        priority: 10,
        metadata: {
          programId,
          parentJobId: jobId,
          source: 'oauth',
        },
      });
    }
  }
}

export default new OAuthAgent();
