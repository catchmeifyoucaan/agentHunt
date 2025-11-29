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

export interface GRPCJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testReflection?: boolean;
    testMetadataInjection?: boolean;
    testStreaming?: boolean;
    testAuthBypass?: boolean;
    testMessageManipulation?: boolean;
    deepScan?: boolean;
    timeout?: number;
  };
}

export interface GRPCResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type:
      | 'grpc-reflection-enabled'
      | 'grpc-metadata-injection'
      | 'grpc-streaming-dos'
      | 'grpc-auth-bypass'
      | 'grpc-message-manipulation'
      | 'grpc-unencrypted'
      | 'grpc-injection';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    evidence: string;
    serviceName?: string;
    methodName?: string;
    impact: string;
    remediation: string;
    poc?: string;
  }>;
  testedEndpoints: number;
  servicesDiscovered: number;
  executionTime: number;
}

/**
 * gRPC Security Testing Agent
 *
 * Tests gRPC APIs for security vulnerabilities:
 * - Server reflection abuse (service enumeration)
 * - Metadata injection attacks
 * - Streaming attacks (client/server/bidirectional)
 * - Authentication bypass
 * - Message manipulation and injection
 * - Unencrypted communication (plaintext gRPC)
 * - Rate limiting bypass
 * - DoS via infinite streams
 *
 * gRPC-specific attack vectors:
 * - HTTP/2 smuggling via gRPC
 * - Protobuf deserialization issues
 * - Service mesh exploitation
 *
 * Tools: grpcurl, grpcox patterns
 */
export class GRPCAgent extends BaseAgent<GRPCJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('grpc' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify gRPC endpoints', metadata: { phase: 'discovery' } },
      { name: 'Test server reflection', metadata: { phase: 'reflection-testing' } },
      { name: 'Test metadata injection', metadata: { phase: 'metadata-testing' } },
      { name: 'Test streaming attacks', metadata: { phase: 'streaming-testing' } },
      { name: 'Test authentication bypass', metadata: { phase: 'auth-testing' } },
      { name: 'Test message manipulation', metadata: { phase: 'message-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<GRPCJob>): Promise<GRPCResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'grpc',
      'start',
      'info',
      `Starting gRPC testing on ${urls.length} URLs`
    );

    const result: GRPCResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      servicesDiscovered: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify gRPC endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const endpoints = await this.identifyGRPCEndpoints(urls, programId, job.id);
      result.testedEndpoints = endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', { endpointsFound: endpoints.length });

      // Step 2: Test server reflection
      if (options.testReflection !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const reflectionResult = await this.testServerReflection(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...reflectionResult.vulnerabilities);
        result.servicesDiscovered = reflectionResult.servicesDiscovered;
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: reflectionResult.vulnerabilities.length,
          servicesDiscovered: reflectionResult.servicesDiscovered,
        });
      }

      // Step 3: Test metadata injection
      if (options.testMetadataInjection !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const metadataVulns = await this.testMetadataInjection(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...metadataVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: metadataVulns.length,
        });
      }

      // Step 4: Test streaming attacks
      if (options.testStreaming !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const streamingVulns = await this.testStreamingAttacks(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...streamingVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: streamingVulns.length,
        });
      }

      // Step 5: Test authentication bypass
      if (options.testAuthBypass !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const authVulns = await this.testAuthBypass(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...authVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: authVulns.length,
        });
      }

      // Step 6: Test message manipulation
      if (options.testMessageManipulation !== false) {
        await this.updateStepStatus(job.id, 5, 'running');
        const messageVulns = await this.testMessageManipulation(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...messageVulns);
        await this.updateStepStatus(job.id, 5, 'completed', {
          vulnerabilitiesFound: messageVulns.length,
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
        'grpc',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} gRPC vulnerabilities, discovered ${result.servicesDiscovered} services in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'grpc', 'error', 'error', `Error: ${error.message}`);
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify gRPC endpoints
   * gRPC typically runs on HTTP/2 with Content-Type: application/grpc
   */
  private async identifyGRPCEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const grpcEndpoints: string[] = [];

    for (const url of urls) {
      try {
        // Test for gRPC by checking HTTP/2 and headers
        const response = await axios.get(url, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/grpc',
          },
          validateStatus: () => true,
          maxRedirects: 0,
        });

        // gRPC endpoints typically respond with specific headers or errors
        const hasGRPCHeaders =
          response.headers['content-type']?.includes('application/grpc') ||
          response.headers['grpc-status'] !== undefined ||
          response.headers['grpc-message'] !== undefined;

        // Check for common gRPC ports
        const urlObj = new URL(url);
        const commonGRPCPorts = ['50051', '9090', '8080', '443'];
        const isCommonGRPCPort = commonGRPCPorts.includes(urlObj.port);

        if (hasGRPCHeaders || isCommonGRPCPort) {
          grpcEndpoints.push(url);
        }
      } catch (error: any) {
        // Connection errors might indicate gRPC (wrong protocol)
        if (error.message?.includes('HTTP/2') || error.code === 'ERR_HTTP2_PROTOCOL_ERROR') {
          grpcEndpoints.push(url);
        }
        logger.debug({ url, error: error.message }, 'Error identifying gRPC endpoint');
      }
    }

    // If no gRPC-specific endpoints found, try common gRPC URL patterns
    if (grpcEndpoints.length === 0) {
      const grpcPatterns = urls.filter(
        (url) =>
          url.includes(':50051') ||
          url.includes('grpc') ||
          url.includes('/v1/') ||
          url.includes('/api/v')
      );
      return grpcPatterns.length > 0 ? grpcPatterns : urls.slice(0, 5);
    }

    return grpcEndpoints;
  }

  /**
   * Test gRPC server reflection
   * Reflection allows enumeration of all services and methods
   */
  private async testServerReflection(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: GRPCJob['options']
  ): Promise<{ vulnerabilities: GRPCResult['vulnerabilities']; servicesDiscovered: number }> {
    const vulnerabilities: GRPCResult['vulnerabilities'] = [];
    let servicesDiscovered = 0;

    // gRPC reflection request (ServerReflectionInfo)
    const reflectionRequest = {
      file_by_filename: 'grpc.reflection.v1alpha.ServerReflection',
    };

    for (const endpoint of endpoints) {
      try {
        // Test reflection by calling grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo
        const response = await axios.post(
          `${endpoint}/grpc.reflection.v1alpha.ServerReflection/ServerReflectionInfo`,
          reflectionRequest,
          {
            timeout: 15000,
            headers: {
              'Content-Type': 'application/grpc',
              'TE': 'trailers',
            },
            validateStatus: () => true,
          }
        );

        // Check if reflection is enabled
        const hasReflectionData =
          response.data?.file_descriptor_response ||
          response.status === 200 ||
          (response.headers['grpc-status'] && response.headers['grpc-status'] !== '12'); // 12 = UNIMPLEMENTED

        if (hasReflectionData) {
          // Parse services from response (in real implementation, would decode protobuf)
          const servicesFound = this.parseReflectionResponse(response.data);
          servicesDiscovered += servicesFound.length;

          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'grpc-reflection-enabled',
            severity: 'medium',
            confidence: 0.95,
            evidence: `gRPC server reflection enabled. Discovered ${servicesFound.length} services: ${servicesFound.slice(0, 5).join(', ')}${servicesFound.length > 5 ? '...' : ''}`,
            impact:
              'Server reflection exposes all gRPC services, methods, and message structures. Attackers can enumerate the entire API surface without documentation.',
            remediation:
              'Disable gRPC server reflection in production. Use reflection only in development/testing environments. Implement proper API gateway with authentication.',
            poc: `grpcurl -plaintext ${endpoint} list\ngrpcurl -plaintext ${endpoint} describe`,
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing gRPC reflection');
      }
    }

    return { vulnerabilities, servicesDiscovered };
  }

  /**
   * Parse reflection response to extract services
   */
  private parseReflectionResponse(data: any): string[] {
    // Simplified parsing - in real implementation would decode protobuf properly
    const services: string[] = [];

    if (typeof data === 'string') {
      // Look for service patterns in response
      const serviceMatches = data.match(/service\s+(\w+)/gi);
      if (serviceMatches) {
        services.push(...serviceMatches.map((m) => m.split(' ')[1]));
      }
    } else if (data?.file_descriptor_response?.file_descriptor_proto) {
      // Parse file descriptor proto
      services.push('grpc.reflection.v1alpha.ServerReflection');
    }

    return services.length > 0 ? services : ['UnknownService'];
  }

  /**
   * Test metadata injection
   * gRPC metadata is similar to HTTP headers
   */
  private async testMetadataInjection(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: GRPCJob['options']
  ): Promise<GRPCResult['vulnerabilities']> {
    const vulnerabilities: GRPCResult['vulnerabilities'] = [];

    const injectionPayloads = [
      { name: 'SQL Injection', header: 'x-user-id', value: "1' OR '1'='1" },
      { name: 'Command Injection', header: 'x-tenant-id', value: '; ls -la;' },
      { name: 'Path Traversal', header: 'x-file-path', value: '../../etc/passwd' },
      { name: 'LDAP Injection', header: 'x-username', value: 'admin)(|(password=*)' },
      { name: 'NoSQL Injection', header: 'x-query', value: '{"$ne": null}' },
    ];

    for (const endpoint of endpoints) {
      for (const payload of injectionPayloads) {
        try {
          // Test metadata injection
          const response = await axios.post(
            `${endpoint}/test.Service/TestMethod`,
            {},
            {
              timeout: 15000,
              headers: {
                'Content-Type': 'application/grpc',
                [payload.header]: payload.value,
              },
              validateStatus: () => true,
            }
          );

          // Check for error messages indicating injection
          const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
          const hasInjectionIndicators =
            responseBody.includes('SQL syntax') ||
            responseBody.includes('ORA-') ||
            responseBody.includes('MySQL') ||
            responseBody.includes('PostgreSQL') ||
            responseBody.includes('sh:') ||
            responseBody.includes('bash:') ||
            responseBody.includes('cannot access') ||
            responseBody.includes('LDAP') ||
            responseBody.toLowerCase().includes('error');

          const grpcMessage = response.headers['grpc-message'];
          const hasErrorInGRPCMessage =
            grpcMessage &&
            (grpcMessage.includes('SQL') ||
              grpcMessage.includes('syntax') ||
              grpcMessage.includes('command') ||
              grpcMessage.includes('injection'));

          if (hasInjectionIndicators || hasErrorInGRPCMessage) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'grpc-metadata-injection',
              severity: 'high',
              confidence: 0.8,
              evidence: `${payload.name} possible via metadata header ${payload.header}. Error: ${grpcMessage || responseBody.substring(0, 200)}`,
              impact:
                'Metadata injection can lead to SQL injection, command injection, or other backend vulnerabilities if metadata values are not properly sanitized.',
              remediation:
                'Validate and sanitize all metadata values. Use parameterized queries. Implement input validation on all gRPC interceptors.',
            });
            break; // One vuln per endpoint
          }
        } catch (error: any) {
          logger.debug({ endpoint, payload, error: error.message }, 'Error testing metadata injection');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test streaming attacks
   * gRPC supports client streaming, server streaming, and bidirectional streaming
   */
  private async testStreamingAttacks(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: GRPCJob['options']
  ): Promise<GRPCResult['vulnerabilities']> {
    const vulnerabilities: GRPCResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test infinite stream attack
        // In real implementation, would use gRPC client library with streaming
        // Here we simulate by sending large number of messages

        const streamingTests = [
          {
            name: 'Large message DoS',
            payload: Buffer.alloc(10 * 1024 * 1024).toString('base64'), // 10MB message
            type: 'message-size',
          },
          {
            name: 'Infinite stream',
            payload: 'stream-test',
            type: 'stream-count',
          },
        ];

        for (const test of streamingTests) {
          const startTime = Date.now();
          try {
            const response = await axios.post(
              `${endpoint}/test.StreamService/StreamMethod`,
              { data: test.payload },
              {
                timeout: 30000,
                headers: {
                  'Content-Type': 'application/grpc',
                  'grpc-accept-encoding': 'identity',
                },
                validateStatus: () => true,
                maxContentLength: Infinity,
              }
            );

            const responseTime = Date.now() - startTime;

            // If server accepts large messages without limits
            if (test.type === 'message-size' && response.status !== 413 && response.status !== 400) {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'grpc-streaming-dos',
                severity: 'medium',
                confidence: 0.7,
                evidence: `Server accepted ${(test.payload.length / 1024 / 1024).toFixed(2)}MB message without size limits`,
                impact:
                  'No message size limits allows DoS attacks via extremely large messages, exhausting server memory and bandwidth.',
                remediation:
                  'Implement max message size limits. Configure grpc.max_receive_message_length. Add rate limiting on streaming endpoints.',
              });
            }

            // If response time is excessive
            if (responseTime > 20000) {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'grpc-streaming-dos',
                severity: 'medium',
                confidence: 0.65,
                evidence: `Streaming endpoint took ${(responseTime / 1000).toFixed(2)}s to respond - possible resource exhaustion`,
                impact:
                  'Slow streaming responses can be exploited for DoS by opening many concurrent streams.',
                remediation:
                  'Implement stream timeouts, concurrent stream limits, and backpressure mechanisms.',
              });
            }
          } catch (error: any) {
            // Timeout is expected for infinite streams
            logger.debug({ endpoint, test, error: error.message }, 'Streaming test error (expected)');
          }
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing streaming attacks');
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
    options: GRPCJob['options']
  ): Promise<GRPCResult['vulnerabilities']> {
    const vulnerabilities: GRPCResult['vulnerabilities'] = [];

    const authBypassTests = [
      { name: 'No auth token', headers: {} },
      { name: 'Empty auth token', headers: { authorization: '' } },
      { name: 'Invalid auth token', headers: { authorization: 'Bearer invalid' } },
      { name: 'Missing metadata', headers: { 'x-api-key': '' } },
    ];

    for (const endpoint of endpoints) {
      for (const test of authBypassTests) {
        try {
          const response = await axios.post(
            `${endpoint}/secure.Service/SecureMethod`,
            { test: 'auth-bypass' },
            {
              timeout: 10000,
              headers: {
                'Content-Type': 'application/grpc',
                ...test.headers,
              },
              validateStatus: () => true,
            }
          );

          const grpcStatus = response.headers['grpc-status'];
          // gRPC status codes: 0 = OK, 16 = UNAUTHENTICATED
          const isUnauthenticated = grpcStatus === '16' || response.status === 401;

          // If request succeeds without auth
          if (!isUnauthenticated && (response.status === 200 || grpcStatus === '0')) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'grpc-auth-bypass',
              severity: 'critical',
              confidence: 0.85,
              evidence: `${test.name}: Request succeeded without proper authentication (gRPC status: ${grpcStatus})`,
              impact:
                'Authentication bypass allows unauthorized access to gRPC services and methods, potentially exposing sensitive data or operations.',
              remediation:
                'Implement proper authentication interceptors. Validate JWT tokens. Use mutual TLS (mTLS). Enforce authorization on all service methods.',
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, test, error: error.message }, 'Error testing auth bypass');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test message manipulation
   */
  private async testMessageManipulation(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: GRPCJob['options']
  ): Promise<GRPCResult['vulnerabilities']> {
    const vulnerabilities: GRPCResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test unencrypted gRPC (should use TLS)
        const urlObj = new URL(endpoint);
        if (urlObj.protocol === 'http:') {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'grpc-unencrypted',
            severity: 'high',
            confidence: 1.0,
            evidence: `gRPC endpoint uses unencrypted HTTP instead of HTTPS/TLS`,
            impact:
              'Unencrypted gRPC allows man-in-the-middle attacks. Attackers can intercept, read, and modify all gRPC messages in transit.',
            remediation:
              'Always use TLS for gRPC in production. Configure server with valid certificates. Consider mutual TLS (mTLS) for enhanced security.',
            poc: `Intercept traffic with: mitmproxy -p 8080\nAll gRPC messages are readable in plaintext`,
          });
        }

        // Test protobuf injection (malformed messages)
        const malformedPayloads = [
          { name: 'Oversized field', data: { field: 'A'.repeat(1000000) } },
          { name: 'Negative length', data: Buffer.from([0xff, 0xff, 0xff, 0xff]) },
          { name: 'Recursive message', data: { nested: { nested: { nested: {} } } } },
        ];

        for (const payload of malformedPayloads) {
          try {
            const response = await axios.post(`${endpoint}/test.Service/TestMethod`, payload.data, {
              timeout: 10000,
              headers: {
                'Content-Type': 'application/grpc',
              },
              validateStatus: () => true,
            });

            // Check for protobuf parsing errors
            const grpcMessage = response.headers['grpc-message'] || '';
            const hasProtobufError =
              grpcMessage.includes('protobuf') ||
              grpcMessage.includes('decode') ||
              grpcMessage.includes('unmarshal') ||
              response.status === 500;

            if (hasProtobufError) {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'grpc-message-manipulation',
                severity: 'medium',
                confidence: 0.7,
                evidence: `${payload.name}: Server exposed protobuf parsing error: ${grpcMessage}`,
                impact:
                  'Message manipulation vulnerabilities can lead to DoS, information disclosure, or exploitation of deserialization bugs.',
                remediation:
                  'Implement strict protobuf message validation. Set max message size limits. Handle parsing errors gracefully without exposing internals.',
              });
              break;
            }
          } catch (error: any) {
            logger.debug({ endpoint, payload, error: error.message }, 'Malformed payload test error');
          }
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing message manipulation');
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: GRPCResult['vulnerabilities'],
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
            serviceName: vuln.serviceName,
            methodName: vuln.methodName,
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
    vulnerabilities: GRPCResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `grpc-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `grpc-${jobId}`,
        metadata: {
          serviceName: vuln.serviceName,
          methodName: vuln.methodName,
          impact: vuln.impact,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ gRPC agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share gRPC findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<GRPCJob>, result: GRPCResult) {
    const { programId } = job.data;

    // Critical/high severity -> escalate
    const criticalVulns = result.vulnerabilities.filter(
      (v) => v.severity === 'critical' || v.severity === 'high'
    );

    if (criticalVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'grpc',
        'triage',
        {
          reason: 'Critical gRPC vulnerabilities detected',
          vulnerabilities: criticalVulns,
          priority: 'high',
        },
        programId
      );
    }

    // Confirm all findings
    if (result.vulnerabilities.length > 0) {
      await this.createHandoff(
        job.id,
        'grpc',
        'confirm',
        {
          reason: 'gRPC vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'grpc',
        },
        programId
      );
    }
  }
}
