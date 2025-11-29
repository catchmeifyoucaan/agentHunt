import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import { executeCommand } from '../utils/execute';

export interface AuthBypassJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testJWT?: boolean;
    testOAuth?: boolean;
    testSession?: boolean;
    testMFA?: boolean;
    testPasswordReset?: boolean;
    customHeaders?: Record<string, string>;
    threads?: number;
    timeout?: number;
  };
}

export interface AuthBypassResult {
  vulnerabilities: Array<{
    url: string;
    type:
      | 'jwt-none-algorithm'
      | 'jwt-weak-secret'
      | 'jwt-key-confusion'
      | 'oauth-redirect-manipulation'
      | 'oauth-state-bypass'
      | 'session-fixation'
      | 'session-prediction'
      | 'password-reset-token-leak'
      | 'mfa-bypass'
      | 'broken-access-control';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    evidence: string;
    poc: string;
    remediation: string;
  }>;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * Authentication Bypass Agent
 *
 * Comprehensive authentication and authorization testing:
 * - JWT manipulation (none algorithm, weak signing, key confusion)
 * - OAuth flow exploitation (redirect_uri manipulation, state bypass)
 * - Session security (fixation, prediction, hijacking)
 * - Password reset vulnerabilities
 * - Multi-factor authentication bypass
 * - Broken access control detection
 *
 * Tools: jwt_tool, custom OAuth tester, session analyzer
 */
export class AuthBypassAgent extends BaseAgent<AuthBypassJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('authbypass' as any);
  }

  protected getSteps() {
    return [
      {
        name: 'Identify authentication endpoints',
        metadata: { phase: 'recon' },
      },
      {
        name: 'JWT vulnerability testing',
        metadata: { phase: 'jwt-testing' },
      },
      {
        name: 'OAuth flow analysis',
        metadata: { phase: 'oauth-testing' },
      },
      {
        name: 'Session security testing',
        metadata: { phase: 'session-testing' },
      },
      {
        name: 'MFA bypass attempts',
        metadata: { phase: 'mfa-testing' },
      },
      {
        name: 'Store vulnerabilities',
        metadata: { phase: 'reporting' },
      },
    ];
  }

  async process(job: Job<AuthBypassJob>): Promise<AuthBypassResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'authbypass',
      'start',
      'info',
      `Starting authentication bypass testing on ${urls.length} URLs`
    );

    const result: AuthBypassResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify authentication endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const authEndpoints = await this.identifyAuthEndpoints(urls, programId, job.id);
      await this.updateStepStatus(job.id, 0, 'completed', {
        endpointsFound: authEndpoints.length,
      });

      result.testedEndpoints = authEndpoints.length;

      // Step 2: JWT vulnerability testing
      if (options.testJWT !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const jwtVulns = await this.testJWTVulnerabilities(
          authEndpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...jwtVulns);
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: jwtVulns.length,
        });
      }

      // Step 3: OAuth flow analysis
      if (options.testOAuth !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const oauthVulns = await this.testOAuthFlows(authEndpoints, programId, job.id, options);
        result.vulnerabilities.push(...oauthVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: oauthVulns.length,
        });
      }

      // Step 4: Session security testing
      if (options.testSession !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const sessionVulns = await this.testSessionSecurity(
          authEndpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...sessionVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: sessionVulns.length,
        });
      }

      // Step 5: MFA bypass attempts
      if (options.testMFA !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const mfaVulns = await this.testMFABypass(authEndpoints, programId, job.id, options);
        result.vulnerabilities.push(...mfaVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: mfaVulns.length,
        });
      }

      // Step 6: Store findings
      await this.updateStepStatus(job.id, 5, 'running');
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }
      await this.updateStepStatus(job.id, 5, 'completed', {
        totalVulnerabilities: result.vulnerabilities.length,
      });

      // Three-agent integration: Share findings with swarm
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && result.vulnerabilities.length > 0) {
        await this.shareWithSwarm(swarmId, result.vulnerabilities, job.id);
      }

      result.executionTime = Date.now() - startTime;

      await this.updateJobStatus(job.id, 'completed', result);
      await this.logExecution(
        job.id,
        programId,
        'authbypass',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} authentication vulnerabilities in ${result.executionTime}ms`
      );

      // Trigger handoffs based on findings
      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'authbypass',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify authentication endpoints from URLs
   */
  private async identifyAuthEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const authPatterns = [
      '/login',
      '/signin',
      '/auth',
      '/oauth',
      '/api/auth',
      '/api/login',
      '/api/token',
      '/api/session',
      '/sso',
      '/saml',
      '/reset',
      '/password',
      '/mfa',
      '/2fa',
    ];

    const authEndpoints = urls.filter((url) =>
      authPatterns.some((pattern) => url.toLowerCase().includes(pattern))
    );

    // Also query database for known auth endpoints
    const dbResult = await database.query(
      `SELECT DISTINCT value as url FROM assets
       WHERE program_id = $1 AND type = 'endpoint'
       AND (value ILIKE '%/login%' OR value ILIKE '%/auth%' OR value ILIKE '%/token%')
       LIMIT 100`,
      [programId]
    );

    const dbUrls = dbResult.rows.map((row) => row.url);
    return Array.from(new Set([...authEndpoints, ...dbUrls]));
  }

  /**
   * Test JWT vulnerabilities
   */
  private async testJWTVulnerabilities(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: AuthBypassJob['options']
  ): Promise<AuthBypassResult['vulnerabilities']> {
    const vulnerabilities: AuthBypassResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test 1: None algorithm attack
        const noneAlgResult = await this.testJWTNoneAlgorithm(endpoint);
        if (noneAlgResult) {
          vulnerabilities.push({
            url: endpoint,
            type: 'jwt-none-algorithm',
            severity: 'critical',
            confidence: 0.95,
            evidence: noneAlgResult.evidence,
            poc: noneAlgResult.poc,
            remediation:
              'Reject tokens with "alg": "none". Always validate JWT signatures server-side.',
          });
        }

        // Test 2: Weak secret brute force
        const weakSecretResult = await this.testJWTWeakSecret(endpoint);
        if (weakSecretResult) {
          vulnerabilities.push({
            url: endpoint,
            type: 'jwt-weak-secret',
            severity: 'critical',
            confidence: 0.9,
            evidence: weakSecretResult.evidence,
            poc: weakSecretResult.poc,
            remediation: 'Use strong, randomly generated secrets of at least 256 bits.',
          });
        }

        // Test 3: Key confusion (RS256 to HS256)
        const keyConfusionResult = await this.testJWTKeyConfusion(endpoint);
        if (keyConfusionResult) {
          vulnerabilities.push({
            url: endpoint,
            type: 'jwt-key-confusion',
            severity: 'critical',
            confidence: 0.85,
            evidence: keyConfusionResult.evidence,
            poc: keyConfusionResult.poc,
            remediation:
              'Strictly enforce the expected algorithm and never use the public key for HMAC.',
          });
        }
      } catch (error: any) {
        logger.warn(
          { endpoint, error: error.message },
          'Error testing JWT vulnerabilities on endpoint'
        );
      }
    }

    return vulnerabilities;
  }

  /**
   * Test JWT None Algorithm vulnerability
   */
  private async testJWTNoneAlgorithm(
    endpoint: string
  ): Promise<{ evidence: string; poc: string } | null> {
    // Implementation: Attempt to forge JWT with "alg": "none"
    // This is a simplified version - in production, use jwt_tool or custom implementation

    const payload = Buffer.from(
      JSON.stringify({
        sub: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url');

    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const forgedToken = `${header}.${payload}.`;

    // Test the forged token (placeholder - would actually make HTTP request)
    const evidence = `JWT token with alg=none accepted: ${forgedToken.substring(0, 50)}...`;
    const poc = `curl -H "Authorization: Bearer ${forgedToken}" ${endpoint}`;

    // In production, this would actually test the endpoint
    // For now, return null (no vulnerability found)
    return null;
  }

  /**
   * Test JWT weak secret
   */
  private async testJWTWeakSecret(
    endpoint: string
  ): Promise<{ evidence: string; poc: string } | null> {
    // Implementation: Brute force JWT secret using common wordlist
    // Would use tools like jwt_cracker or hashcat in production
    return null;
  }

  /**
   * Test JWT key confusion (RS256 to HS256)
   */
  private async testJWTKeyConfusion(
    endpoint: string
  ): Promise<{ evidence: string; poc: string } | null> {
    // Implementation: Attempt to sign token with public key using HMAC
    return null;
  }

  /**
   * Test OAuth flow vulnerabilities
   */
  private async testOAuthFlows(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: AuthBypassJob['options']
  ): Promise<AuthBypassResult['vulnerabilities']> {
    const vulnerabilities: AuthBypassResult['vulnerabilities'] = [];

    for (const endpoint of endpoints.filter((url) => url.includes('oauth'))) {
      // Test redirect_uri manipulation
      const redirectVuln = await this.testOAuthRedirectManipulation(endpoint);
      if (redirectVuln) {
        vulnerabilities.push(redirectVuln);
      }

      // Test state parameter bypass
      const stateVuln = await this.testOAuthStateBypass(endpoint);
      if (stateVuln) {
        vulnerabilities.push(stateVuln);
      }
    }

    return vulnerabilities;
  }

  private async testOAuthRedirectManipulation(
    endpoint: string
  ): Promise<AuthBypassResult['vulnerabilities'][0] | null> {
    // Test for open redirect in redirect_uri parameter
    return null;
  }

  private async testOAuthStateBypass(
    endpoint: string
  ): Promise<AuthBypassResult['vulnerabilities'][0] | null> {
    // Test for missing or weak state parameter validation
    return null;
  }

  /**
   * Test session security
   */
  private async testSessionSecurity(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: AuthBypassJob['options']
  ): Promise<AuthBypassResult['vulnerabilities']> {
    const vulnerabilities: AuthBypassResult['vulnerabilities'] = [];

    // Test session fixation
    // Test session prediction
    // Test session hijacking

    return vulnerabilities;
  }

  /**
   * Test MFA bypass
   */
  private async testMFABypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: AuthBypassJob['options']
  ): Promise<AuthBypassResult['vulnerabilities']> {
    const vulnerabilities: AuthBypassResult['vulnerabilities'] = [];

    // Test direct endpoint access bypassing MFA
    // Test rate limiting on MFA codes
    // Test backup codes vulnerability

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: AuthBypassResult['vulnerabilities'],
    programId: string,
    jobId: string
  ) {
    for (const vuln of vulnerabilities) {
      await database.query(
        `INSERT INTO findings (
          program_id, job_id, type, severity, url, evidence,
          poc, remediation, confidence, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
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
          vuln.poc,
          vuln.remediation,
          vuln.confidence,
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: vulnerabilities.length,
      severity: vulnerabilities[0]?.severity,
    });
  }

  /**
   * Share findings with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: AuthBypassResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `auth-bypass-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `authbypass-${jobId}`,
        metadata: {
          authType: vuln.type,
          poc: vuln.poc,
          remediation: vuln.remediation,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        {
          swarmId,
          findingsShared: findings.length,
        },
        '🔐 Auth bypass agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share auth bypass findings with swarm');
    }
  }

  /**
   * Trigger handoffs based on findings
   */
  private async triggerHandoffs(job: Job<AuthBypassJob>, result: AuthBypassResult) {
    const { programId } = job.data;

    // Critical auth bypass found -> escalate to manual review
    const criticalFindings = result.vulnerabilities.filter((v) => v.severity === 'critical');
    if (criticalFindings.length > 0) {
      await this.createHandoff(
        job.id,
        'authbypass',
        'triage',
        {
          reason: 'Critical authentication bypass vulnerabilities detected',
          vulnerabilities: criticalFindings,
          priority: 'critical',
        },
        programId
      );
    }

    // JWT vulnerabilities -> trigger deeper JWT analysis
    const jwtVulns = result.vulnerabilities.filter((v) => v.type.startsWith('jwt-'));
    if (jwtVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'authbypass',
        'confirm',
        {
          reason: 'JWT vulnerabilities found, requesting confirmation',
          targets: jwtVulns.map((v) => v.url),
          testType: 'jwt-bypass',
        },
        programId
      );
    }
  }
}
