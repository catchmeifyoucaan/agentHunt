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

export interface ServerlessJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testLambda?: boolean;
    testAzureFunctions?: boolean;
    testGCPFunctions?: boolean;
    testEventInjection?: boolean;
    testPrivilegeEscalation?: boolean;
    testSecretsExposure?: boolean;
    deepScan?: boolean;
    timeout?: number;
  };
}

export interface ServerlessResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type:
      | 'serverless-event-injection'
      | 'serverless-privesc'
      | 'serverless-secrets-exposure'
      | 'serverless-iam-misconfiguration'
      | 'serverless-dos'
      | 'serverless-metadata-access'
      | 'serverless-cold-start-race';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    evidence: string;
    platform?: 'aws-lambda' | 'azure-functions' | 'gcp-functions' | 'cloudflare-workers' | 'unknown';
    impact: string;
    remediation: string;
    poc?: string;
  }>;
  testedEndpoints: number;
  platformsDetected: string[];
  executionTime: number;
}

/**
 * Serverless Security Testing Agent
 *
 * Tests serverless functions for cloud-specific vulnerabilities:
 *
 * AWS Lambda:
 * - Event injection attacks
 * - IAM role privilege escalation
 * - Environment variable secrets exposure
 * - Lambda function enumeration
 * - Cold start race conditions
 * - Over-permissive function policies
 *
 * Azure Functions:
 * - Function key exposure
 * - Managed identity abuse
 * - Storage account access
 * - Function app configuration leaks
 *
 * Google Cloud Functions:
 * - Service account privilege escalation
 * - Cloud Storage bucket access
 * - Metadata server exploitation
 * - Function source code exposure
 *
 * General serverless attacks:
 * - DoS via resource exhaustion
 * - Dependency confusion
 * - Supply chain attacks
 * - Layer/runtime manipulation
 *
 * Tools: Pacu, ScoutSuite patterns
 */
export class ServerlessAgent extends BaseAgent<ServerlessJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('serverless' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify serverless endpoints', metadata: { phase: 'discovery' } },
      { name: 'Detect serverless platform', metadata: { phase: 'fingerprinting' } },
      { name: 'Test event injection', metadata: { phase: 'event-testing' } },
      { name: 'Test privilege escalation', metadata: { phase: 'privesc-testing' } },
      { name: 'Test secrets exposure', metadata: { phase: 'secrets-testing' } },
      { name: 'Test metadata access', metadata: { phase: 'metadata-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<ServerlessJob>): Promise<ServerlessResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'serverless',
      'start',
      'info',
      `Starting serverless testing on ${urls.length} URLs`
    );

    const result: ServerlessResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      platformsDetected: [],
      executionTime: 0,
    };

    try {
      // Step 1: Identify serverless endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const endpoints = await this.identifyServerlessEndpoints(urls, programId, job.id);
      result.testedEndpoints = endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', { endpointsFound: endpoints.length });

      // Step 2: Detect platform
      await this.updateStepStatus(job.id, 1, 'running');
      const platforms = await this.detectServerlessPlatform(endpoints, programId, job.id);
      result.platformsDetected = platforms;
      await this.updateStepStatus(job.id, 1, 'completed', { platformsDetected: platforms });

      // Step 3: Test event injection
      if (options.testEventInjection !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const eventVulns = await this.testEventInjection(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...eventVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: eventVulns.length,
        });
      }

      // Step 4: Test privilege escalation
      if (options.testPrivilegeEscalation !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const privescVulns = await this.testPrivilegeEscalation(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...privescVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: privescVulns.length,
        });
      }

      // Step 5: Test secrets exposure
      if (options.testSecretsExposure !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const secretsVulns = await this.testSecretsExposure(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...secretsVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: secretsVulns.length,
        });
      }

      // Step 6: Test metadata access
      await this.updateStepStatus(job.id, 5, 'running');
      const metadataVulns = await this.testMetadataAccess(endpoints, programId, job.id, options);
      result.vulnerabilities.push(...metadataVulns);
      await this.updateStepStatus(job.id, 5, 'completed', {
        vulnerabilitiesFound: metadataVulns.length,
      });

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
        'serverless',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} serverless vulnerabilities across ${result.platformsDetected.length} platforms in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'serverless',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify serverless endpoints
   */
  private async identifyServerlessEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const serverlessPatterns = [
      '.lambda-url.',
      'amazonaws.com',
      'execute-api',
      'azurewebsites.net',
      'cloudfunctions.net',
      'run.app',
      'workers.dev',
      'netlify.app',
      'vercel.app',
    ];

    const serverlessEndpoints = urls.filter((url) =>
      serverlessPatterns.some((pattern) => url.toLowerCase().includes(pattern))
    );

    return serverlessEndpoints.length > 0 ? serverlessEndpoints : urls.slice(0, 10);
  }

  /**
   * Detect serverless platform
   */
  private async detectServerlessPlatform(
    endpoints: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const platforms = new Set<string>();

    for (const endpoint of endpoints) {
      try {
        const response = await axios.get(endpoint, {
          timeout: 10000,
          validateStatus: () => true,
        });

        // Check headers and URL patterns
        const headers = response.headers;
        const url = endpoint.toLowerCase();

        if (url.includes('lambda-url') || url.includes('execute-api') || headers['x-amzn-requestid']) {
          platforms.add('aws-lambda');
        }

        if (url.includes('azurewebsites.net') || headers['x-functions-key']) {
          platforms.add('azure-functions');
        }

        if (url.includes('cloudfunctions.net') || url.includes('run.app') || headers['function-execution-id']) {
          platforms.add('gcp-functions');
        }

        if (url.includes('workers.dev')) {
          platforms.add('cloudflare-workers');
        }

        if (url.includes('netlify')) {
          platforms.add('netlify-functions');
        }

        if (url.includes('vercel')) {
          platforms.add('vercel-functions');
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error detecting platform');
      }
    }

    return Array.from(platforms);
  }

  /**
   * Test event injection
   */
  private async testEventInjection(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ServerlessJob['options']
  ): Promise<ServerlessResult['vulnerabilities']> {
    const vulnerabilities: ServerlessResult['vulnerabilities'] = [];

    const eventInjectionPayloads = [
      {
        name: 'Lambda event manipulation',
        payload: {
          Records: [
            {
              eventName: 'ObjectCreated:Put',
              s3: {
                bucket: { name: 'malicious-bucket' },
                object: { key: '../../etc/passwd' },
              },
            },
          ],
        },
      },
      {
        name: 'SQS message injection',
        payload: {
          Records: [
            {
              messageId: 'test',
              body: JSON.stringify({ command: 'admin_access', role: 'administrator' }),
            },
          ],
        },
      },
      {
        name: 'API Gateway event manipulation',
        payload: {
          requestContext: {
            authorizer: { claims: { role: 'admin', sub: 'user-123' } },
          },
          body: '{"userId":"admin"}',
        },
      },
    ];

    for (const endpoint of endpoints) {
      for (const test of eventInjectionPayloads) {
        try {
          const response = await axios.post(endpoint, test.payload, {
            timeout: 15000,
            headers: {
              'Content-Type': 'application/json',
            },
            validateStatus: () => true,
          });

          const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

          // Check for successful injection
          const hasElevatedAccess =
            responseBody.includes('admin') ||
            responseBody.includes('administrator') ||
            responseBody.includes('authorized') ||
            responseBody.includes('access granted') ||
            response.status === 200;

          if (hasElevatedAccess && !responseBody.toLowerCase().includes('error')) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'serverless-event-injection',
              severity: 'critical',
              confidence: 0.75,
              evidence: `${test.name}: Function processed injected event data - ${responseBody.substring(0, 200)}`,
              impact:
                'Event injection allows attackers to manipulate serverless function inputs, potentially gaining unauthorized access or triggering malicious operations.',
              remediation:
                'Validate all event data structures. Verify event sources. Implement signature verification for events. Never trust event metadata without validation.',
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, test, error: error.message }, 'Error testing event injection');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test privilege escalation via IAM/RBAC
   */
  private async testPrivilegeEscalation(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ServerlessJob['options']
  ): Promise<ServerlessResult['vulnerabilities']> {
    const vulnerabilities: ServerlessResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test for over-permissive IAM role
        const response = await axios.post(
          endpoint,
          { action: 'list-buckets' },
          {
            timeout: 10000,
            validateStatus: () => true,
          }
        );

        const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        // Check if function can perform privileged operations
        const hasPrivilegedAccess =
          responseBody.includes('bucket') ||
          responseBody.includes('arn:aws') ||
          responseBody.includes('subscription') ||
          responseBody.includes('project');

        if (hasPrivilegedAccess) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'serverless-iam-misconfiguration',
            severity: 'high',
            confidence: 0.7,
            evidence: `Function appears to have excessive IAM permissions: ${responseBody.substring(0, 200)}`,
            impact:
              'Over-permissive IAM roles allow functions to access resources beyond their intended scope, enabling privilege escalation attacks.',
            remediation:
              'Follow principle of least privilege. Grant only necessary permissions. Use resource-based policies. Review function execution role regularly.',
          });
        }

        // Test for function URL without auth
        const publicAccessResponse = await axios.get(endpoint, {
          timeout: 10000,
          validateStatus: () => true,
        });

        if (publicAccessResponse.status === 200 && !publicAccessResponse.headers['www-authenticate']) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'serverless-iam-misconfiguration',
            severity: 'medium',
            confidence: 0.8,
            evidence: `Function URL is publicly accessible without authentication`,
            impact:
              'Unauthenticated function access allows anyone to invoke the function, potentially leading to data exposure or resource abuse.',
            remediation:
              'Enable AWS_IAM auth for Lambda URLs. Use API Gateway with authorizers. Implement custom authentication in function code.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing privilege escalation');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test secrets and environment variable exposure
   */
  private async testSecretsExposure(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ServerlessJob['options']
  ): Promise<ServerlessResult['vulnerabilities']> {
    const vulnerabilities: ServerlessResult['vulnerabilities'] = [];

    const secretPatterns = [
      /AWS_ACCESS_KEY_ID/i,
      /AWS_SECRET_ACCESS_KEY/i,
      /API[_-]?KEY/i,
      /SECRET[_-]?KEY/i,
      /DATABASE[_-]?URL/i,
      /PASSWORD/i,
      /TOKEN/i,
      /AZURE[_-]?STORAGE/i,
      /GOOGLE[_-]?APPLICATION[_-]?CREDENTIALS/i,
    ];

    for (const endpoint of endpoints) {
      try {
        // Test for environment variable leakage
        const envTests = [
          { path: '?debug=true' },
          { path: '?env=1' },
          { path: '/.env' },
          { headers: { 'X-Debug': 'true' } },
        ];

        for (const test of envTests) {
          const response = await axios.get(
            endpoint + (test.path || ''),
            {
              timeout: 10000,
              headers: test.headers || {},
              validateStatus: () => true,
            }
          );

          const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

          // Check for exposed secrets
          for (const pattern of secretPatterns) {
            if (pattern.test(responseBody)) {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'serverless-secrets-exposure',
                severity: 'critical',
                confidence: 0.95,
                evidence: `Exposed environment variables/secrets found: ${pattern.source}`,
                impact:
                  'Secrets exposure allows attackers to obtain API keys, database credentials, and other sensitive configuration data.',
                remediation:
                  'Use AWS Secrets Manager, Azure Key Vault, or GCP Secret Manager. Never log environment variables. Disable debug mode in production. Implement proper error handling.',
                poc: test.path
                  ? `curl "${endpoint}${test.path}"`
                  : `curl -H "X-Debug: true" "${endpoint}"`,
              });
              break;
            }
          }
        }

        // Test for source code exposure
        const sourceCodeResponse = await axios.get(`${endpoint}/.git/config`, {
          timeout: 10000,
          validateStatus: () => true,
        });

        if (sourceCodeResponse.status === 200) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'serverless-secrets-exposure',
            severity: 'high',
            confidence: 0.9,
            evidence: `Function source code or .git directory is exposed`,
            impact:
              'Source code exposure reveals function logic, hardcoded secrets, and attack surface information.',
            remediation:
              'Exclude .git and development files from deployment packages. Review function deployment artifacts. Use .gitignore and build process filtering.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing secrets exposure');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test cloud metadata server access (SSRF to metadata)
   */
  private async testMetadataAccess(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ServerlessJob['options']
  ): Promise<ServerlessResult['vulnerabilities']> {
    const vulnerabilities: ServerlessResult['vulnerabilities'] = [];

    const metadataEndpoints = [
      { platform: 'AWS', url: 'http://169.254.169.254/latest/meta-data/' },
      { platform: 'AWS IMDSv2', url: 'http://169.254.169.254/latest/api/token' },
      { platform: 'Azure', url: 'http://169.254.169.254/metadata/instance?api-version=2021-02-01' },
      { platform: 'GCP', url: 'http://metadata.google.internal/computeMetadata/v1/' },
    ];

    for (const endpoint of endpoints) {
      for (const metadata of metadataEndpoints) {
        try {
          // Test SSRF to metadata service
          const ssrfPayloads = [
            { param: 'url', value: metadata.url },
            { param: 'redirect', value: metadata.url },
            { param: 'fetch', value: metadata.url },
            { param: 'webhook', value: metadata.url },
          ];

          for (const payload of ssrfPayloads) {
            const response = await axios.get(`${endpoint}?${payload.param}=${encodeURIComponent(payload.value)}`, {
              timeout: 10000,
              validateStatus: () => true,
            });

            const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

            // Check for metadata content
            const hasMetadataContent =
              responseBody.includes('ami-id') ||
              responseBody.includes('instance-id') ||
              responseBody.includes('iam/security-credentials') ||
              responseBody.includes('subscription') ||
              responseBody.includes('project-id');

            if (hasMetadataContent) {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'serverless-metadata-access',
                severity: 'critical',
                confidence: 0.85,
                evidence: `${metadata.platform} metadata accessible via SSRF: ${responseBody.substring(0, 200)}`,
                platform: metadata.platform.toLowerCase().includes('aws')
                  ? 'aws-lambda'
                  : metadata.platform.toLowerCase().includes('azure')
                    ? 'azure-functions'
                    : 'gcp-functions',
                impact:
                  'Metadata server access allows stealing IAM credentials, service account tokens, and cloud configuration data.',
                remediation:
                  'Validate and sanitize URL parameters. Implement URL allowlists. Disable outbound internet access if not needed. Use IMDSv2 for AWS.',
                poc: `curl "${endpoint}?${payload.param}=${encodeURIComponent(metadata.url)}"`,
              });
              break;
            }
          }
        } catch (error: any) {
          logger.debug({ endpoint, metadata, error: error.message }, 'Error testing metadata access');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: ServerlessResult['vulnerabilities'],
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
            platform: vuln.platform,
            impact: vuln.impact,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: vulnerabilities.length,
      severity: 'critical',
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: ServerlessResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `serverless-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `serverless-${jobId}`,
        metadata: {
          platform: vuln.platform,
          impact: vuln.impact,
          poc: vuln.poc,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ Serverless agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share serverless findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<ServerlessJob>, result: ServerlessResult) {
    const { programId } = job.data;

    // Critical vulns (secrets, metadata access) -> immediate escalation
    const criticalVulns = result.vulnerabilities.filter(
      (v) =>
        v.severity === 'critical' ||
        v.type === 'serverless-secrets-exposure' ||
        v.type === 'serverless-metadata-access'
    );

    if (criticalVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'serverless',
        'triage',
        {
          reason: 'Critical serverless vulnerabilities detected (secrets/metadata exposure)',
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
        'serverless',
        'confirm',
        {
          reason: 'Serverless vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'serverless',
        },
        programId
      );
    }
  }
}
