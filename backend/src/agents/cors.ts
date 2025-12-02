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

export interface CORSJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testNullOrigin?: boolean;
    testReflectedOrigin?: boolean;
    testSubdomainBypass?: boolean;
    testCredentialLeak?: boolean;
    testPreflightBypass?: boolean;
    timeout?: number;
  };
}

export interface CORSResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type:
      | 'cors-null-origin'
      | 'cors-reflected-origin'
      | 'cors-subdomain-wildcard'
      | 'cors-credential-leak'
      | 'cors-preflight-bypass'
      | 'cors-misconfiguration';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    evidence: string;
    origin: string;
    headers: Record<string, string>;
    impact: string;
    remediation: string;
  }>;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * CORS Misconfiguration Agent
 *
 * Detects and exploits CORS (Cross-Origin Resource Sharing) misconfigurations:
 * - Null origin bypass
 * - Reflected origin (any origin accepted)
 * - Subdomain wildcard bypass
 * - Credential leakage (ACAO + ACAC)
 * - Pre-flight request bypass
 * - Insecure CORS patterns
 *
 * Attack scenarios:
 * - Data exfiltration from authenticated endpoints
 * - Account takeover via credential theft
 * - Subdomain takeover amplification
 *
 * Tools: Custom CORS scanner, Burp Collaborator patterns
 */
export class CORSAgent extends BaseAgent<CORSJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('cors' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify CORS-enabled endpoints', metadata: { phase: 'discovery' } },
      { name: 'Test null origin bypass', metadata: { phase: 'null-origin-testing' } },
      { name: 'Test reflected origin', metadata: { phase: 'reflected-origin-testing' } },
      { name: 'Test subdomain bypass', metadata: { phase: 'subdomain-testing' } },
      { name: 'Test credential leakage', metadata: { phase: 'credential-testing' } },
      { name: 'Test preflight bypass', metadata: { phase: 'preflight-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<CORSJob>): Promise<CORSResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'cors',
      'start',
      'info',
      `Starting CORS testing on ${urls.length} URLs`
    );

    const result: CORSResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify CORS-enabled endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const endpoints = await this.identifyCORSEndpoints(urls, programId, job.id);
      result.testedEndpoints = endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', { endpointsFound: endpoints.length });

      // Step 2: Null origin bypass
      if (options.testNullOrigin !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const nullOriginVulns = await this.testNullOrigin(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...nullOriginVulns);
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: nullOriginVulns.length,
        });
      }

      // Step 3: Reflected origin
      if (options.testReflectedOrigin !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const reflectedOriginVulns = await this.testReflectedOrigin(
          endpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...reflectedOriginVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: reflectedOriginVulns.length,
        });
      }

      // Step 4: Subdomain bypass
      if (options.testSubdomainBypass !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const subdomainVulns = await this.testSubdomainBypass(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...subdomainVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: subdomainVulns.length,
        });
      }

      // Step 5: Credential leakage
      if (options.testCredentialLeak !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const credentialVulns = await this.testCredentialLeakage(
          endpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...credentialVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: credentialVulns.length,
        });
      }

      // Step 6: Preflight bypass
      if (options.testPreflightBypass !== false) {
        await this.updateStepStatus(job.id, 5, 'running');
        const preflightVulns = await this.testPreflightBypass(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...preflightVulns);
        await this.updateStepStatus(job.id, 5, 'completed', {
          vulnerabilitiesFound: preflightVulns.length,
        });
      }

      // Step 7: Store findings
      await this.updateStepStatus(job.id, 6, 'running');
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }
      await this.updateStepStatus(job.id, 6, 'completed', {
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
        'cors',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} CORS vulnerabilities in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'cors', 'error', 'error', `Error: ${error.message}`);
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify endpoints with CORS headers
   */
  private async identifyCORSEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const corsEndpoints: string[] = [];

    for (const url of urls) {
      try {
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            Origin: 'https://evil.com',
          },
          validateStatus: () => true,
        });

        // Check for CORS headers
        const hasAccessControlHeaders =
          response.headers['access-control-allow-origin'] ||
          response.headers['access-control-allow-credentials'] ||
          response.headers['access-control-allow-methods'];

        if (hasAccessControlHeaders) {
          corsEndpoints.push(url);
        }
      } catch (error: any) {
        logger.debug({ url, error: error.message }, 'Error checking for CORS');
      }
    }

    // If no CORS endpoints found, test API endpoints anyway
    return corsEndpoints.length > 0
      ? corsEndpoints
      : urls.filter((url) =>
          ['/api/', '/v1/', '/v2/', '/graphql', '/rest/'].some((pattern) =>
            url.toLowerCase().includes(pattern)
          )
        );
  }

  /**
   * Test null origin bypass
   * Some applications trust the "null" origin
   */
  private async testNullOrigin(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CORSJob['options']
  ): Promise<CORSResult['vulnerabilities']> {
    const vulnerabilities: CORSResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(endpoint, {
          timeout: 10000,
          headers: {
            Origin: 'null',
          },
          validateStatus: () => true,
        });

        const acao = response.headers['access-control-allow-origin'];
        const acac = response.headers['access-control-allow-credentials'];

        // Vulnerable if ACAO reflects "null"
        if (acao === 'null') {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'cors-null-origin',
            severity: acac === 'true' ? 'high' : 'medium',
            confidence: 0.95,
            evidence: `Access-Control-Allow-Origin: null${acac === 'true' ? ', Access-Control-Allow-Credentials: true' : ''}`,
            origin: 'null',
            headers: {
              'Access-Control-Allow-Origin': acao,
              'Access-Control-Allow-Credentials': acac || '',
            },
            impact:
              'Null origin bypass allows attacker-controlled pages (sandboxed iframes, data: URIs) to make authenticated cross-origin requests and steal sensitive data.',
            remediation:
              'Never allow "null" as a valid origin. Implement a strict allowlist of trusted origins. Avoid reflecting the Origin header without validation.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing null origin');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test reflected origin (any origin accepted)
   */
  private async testReflectedOrigin(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CORSJob['options']
  ): Promise<CORSResult['vulnerabilities']> {
    const vulnerabilities: CORSResult['vulnerabilities'] = [];

    const testOrigins = [
      'https://evil.com',
      'https://attacker.com',
      'https://malicious.net',
      'http://localhost:8080',
    ];

    for (const endpoint of endpoints) {
      for (const testOrigin of testOrigins) {
        try {
          const response = await axios.get(endpoint, {
            timeout: 10000,
            headers: {
              Origin: testOrigin,
            },
            validateStatus: () => true,
          });

          const acao = response.headers['access-control-allow-origin'];
          const acac = response.headers['access-control-allow-credentials'];

          // Vulnerable if ACAO reflects our malicious origin
          if (acao === testOrigin) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'cors-reflected-origin',
              severity: acac === 'true' ? 'critical' : 'high',
              confidence: 0.98,
              evidence: `Access-Control-Allow-Origin reflects attacker origin: ${testOrigin}${acac === 'true' ? ', Access-Control-Allow-Credentials: true (CRITICAL)' : ''}`,
              origin: testOrigin,
              headers: {
                'Access-Control-Allow-Origin': acao,
                'Access-Control-Allow-Credentials': acac || '',
              },
              impact:
                acac === 'true'
                  ? 'CRITICAL: Any origin can make credentialed requests. Attacker can steal session tokens, authentication cookies, PII, and perform account takeover.'
                  : 'Any origin can read public responses. Moderate impact if sensitive data exposed.',
              remediation:
                'Never reflect the Origin header without validation. Implement strict origin allowlist. If credentials required, NEVER use dynamic origins.',
            });
            break; // One finding per endpoint
          }
        } catch (error: any) {
          logger.debug({ endpoint, testOrigin, error: error.message }, 'Error testing reflected origin');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test subdomain wildcard bypass
   */
  private async testSubdomainBypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CORSJob['options']
  ): Promise<CORSResult['vulnerabilities']> {
    const vulnerabilities: CORSResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Extract domain from endpoint
        const urlObj = new URL(endpoint);
        const domain = urlObj.hostname;

        // Test various subdomain patterns
        const subdomainOrigins = [
          `https://evil.${domain}`,
          `https://attacker.${domain}`,
          `https://malicious-${domain}`,
          `https://${domain}.evil.com`,
        ];

        for (const subdomainOrigin of subdomainOrigins) {
          const response = await axios.get(endpoint, {
            timeout: 10000,
            headers: {
              Origin: subdomainOrigin,
            },
            validateStatus: () => true,
          });

          const acao = response.headers['access-control-allow-origin'];
          const acac = response.headers['access-control-allow-credentials'];

          // Vulnerable if subdomain is accepted
          if (acao && (acao === subdomainOrigin || acao === '*')) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'cors-subdomain-wildcard',
              severity: acac === 'true' ? 'high' : 'medium',
              confidence: 0.85,
              evidence: `Subdomain origin accepted: ${subdomainOrigin}, ACAO: ${acao}${acac === 'true' ? ', ACAC: true' : ''}`,
              origin: subdomainOrigin,
              headers: {
                'Access-Control-Allow-Origin': acao,
                'Access-Control-Allow-Credentials': acac || '',
              },
              impact:
                'Subdomain wildcard allows attackers who compromise any subdomain (via subdomain takeover, XSS, etc.) to exfiltrate data from main domain.',
              remediation:
                'Never use regex-based subdomain matching. Maintain explicit allowlist of trusted origins. Monitor for subdomain takeovers.',
            });
            break;
          }
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing subdomain bypass');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test credential leakage (ACAO + ACAC = critical)
   */
  private async testCredentialLeakage(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CORSJob['options']
  ): Promise<CORSResult['vulnerabilities']> {
    const vulnerabilities: CORSResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test with attacker origin
        const response = await axios.get(endpoint, {
          timeout: 10000,
          headers: {
            Origin: 'https://attacker-credential-test.com',
            Cookie: 'session=test123', // Simulate authenticated request
          },
          validateStatus: () => true,
        });

        const acao = response.headers['access-control-allow-origin'];
        const acac = response.headers['access-control-allow-credentials'];

        // Critical if both ACAO (wildcard or reflected) and ACAC=true
        const hasWildcardWithCredentials = acao === '*' && acac === 'true';
        const hasReflectedWithCredentials =
          acao === 'https://attacker-credential-test.com' && acac === 'true';

        if (hasWildcardWithCredentials) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'cors-credential-leak',
            severity: 'critical',
            confidence: 1.0,
            evidence: `CRITICAL: Access-Control-Allow-Origin: *, Access-Control-Allow-Credentials: true (invalid but dangerous if browsers allow)`,
            origin: '*',
            headers: {
              'Access-Control-Allow-Origin': acao,
              'Access-Control-Allow-Credentials': acac,
            },
            impact:
              'CRITICAL: Wildcard with credentials is invalid but indicates severe misconfiguration. If any browser allows this, all authenticated data is exposed.',
            remediation:
              'NEVER use ACAO: * with ACAC: true. This is invalid per CORS spec but indicates dangerous configuration.',
          });
        } else if (hasReflectedWithCredentials) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'cors-credential-leak',
            severity: 'critical',
            confidence: 0.98,
            evidence: `CRITICAL: Reflected origin with credentials enabled - attacker can steal authentication tokens and session data`,
            origin: 'https://attacker-credential-test.com',
            headers: {
              'Access-Control-Allow-Origin': acao,
              'Access-Control-Allow-Credentials': acac,
            },
            impact:
              'CRITICAL: Attacker can make authenticated cross-origin requests and steal cookies, session tokens, JWT, PII, financial data. Account takeover possible.',
            remediation:
              'Implement strict origin allowlist. Never reflect Origin header when ACAC=true. Use HttpOnly cookies for sensitive tokens.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing credential leakage');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test preflight bypass
   */
  private async testPreflightBypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: CORSJob['options']
  ): Promise<CORSResult['vulnerabilities']> {
    const vulnerabilities: CORSResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Send OPTIONS request (preflight)
        const preflightResponse = await axios.options(endpoint, {
          timeout: 10000,
          headers: {
            Origin: 'https://evil.com',
            'Access-Control-Request-Method': 'DELETE',
            'Access-Control-Request-Headers': 'X-Custom-Header',
          },
          validateStatus: () => true,
        });

        const acam = preflightResponse.headers['access-control-allow-methods'];
        const acah = preflightResponse.headers['access-control-allow-headers'];
        const acao = preflightResponse.headers['access-control-allow-origin'];

        // Check if dangerous methods allowed
        const dangerousMethods = ['DELETE', 'PUT', 'PATCH'];
        const allowsDangerousMethods = dangerousMethods.some(
          (method) => acam && acam.toUpperCase().includes(method)
        );

        // Check if all headers allowed
        const allowsAllHeaders = acah === '*' || (acah && acah.toLowerCase().includes('x-custom-header'));

        if (allowsDangerousMethods && (acao === 'https://evil.com' || acao === '*')) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'cors-preflight-bypass',
            severity: 'high',
            confidence: 0.9,
            evidence: `Dangerous methods allowed (${acam}), Origin: ${acao}${allowsAllHeaders ? ', All custom headers allowed' : ''}`,
            origin: 'https://evil.com',
            headers: {
              'Access-Control-Allow-Origin': acao || '',
              'Access-Control-Allow-Methods': acam || '',
              'Access-Control-Allow-Headers': acah || '',
            },
            impact:
              'Permissive preflight allows attackers to perform state-changing operations (DELETE, PUT, PATCH) with custom headers from malicious origins.',
            remediation:
              'Restrict Access-Control-Allow-Methods to only necessary methods. Validate Access-Control-Allow-Headers. Implement proper origin validation.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing preflight bypass');
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: CORSResult['vulnerabilities'],
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
          `Origin: ${vuln.origin}`,
          vuln.remediation,
          vuln.confidence,
          JSON.stringify({
            endpoint: vuln.endpoint,
            origin: vuln.origin,
            headers: vuln.headers,
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
    vulnerabilities: CORSResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `cors-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `cors-${jobId}`,
        metadata: {
          origin: vuln.origin,
          headers: vuln.headers,
          impact: vuln.impact,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ CORS agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share CORS findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<CORSJob>, result: CORSResult) {
    const { programId } = job.data;

    // Critical CORS issues -> immediate escalation
    const criticalVulns = result.vulnerabilities.filter(
      (v) =>
        v.severity === 'critical' ||
        v.type === 'cors-credential-leak' ||
        v.type === 'cors-reflected-origin'
    );

    if (criticalVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'cors',
        'triage',
        {
          reason: 'Critical CORS misconfigurations detected (credential leak risk)',
          vulnerabilities: criticalVulns,
          priority: 'critical',
        },
        programId
      );
    }

    // Confirm all findings
    if (result.vulnerabilities.length > 0) {
      await this.createHandoff(
        job.id,
        'cors',
        'confirm',
        {
          reason: 'CORS vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'cors-misconfiguration',
        },
        programId
      );
    }
  }
}
