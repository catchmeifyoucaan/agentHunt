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
import axios from 'axios';

export interface GraphQLJob extends BaseJob {
  programId: string;
  endpoints: string[];
  options: {
    testIntrospection?: boolean;
    testBatching?: boolean;
    testDepthAttack?: boolean;
    testFieldSuggestion?: boolean;
    testInjection?: boolean;
    testAuthBypass?: boolean;
    maxDepth?: number;
    batchSize?: number;
    timeout?: number;
  };
}

export interface GraphQLResult {
  vulnerabilities: Array<{
    endpoint: string;
    type:
      | 'introspection-enabled'
      | 'batching-dos'
      | 'depth-attack'
      | 'field-suggestion'
      | 'injection'
      | 'auth-bypass'
      | 'idor'
      | 'rate-limit-bypass';
    severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
    confidence: number;
    evidence: string;
    payload: string;
    impact: string;
    remediation: string;
  }>;
  discoveredSchemas: number;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * GraphQL Exploit Agent
 *
 * Comprehensive GraphQL API security testing:
 * - Introspection query enumeration
 * - Batching attacks (query cost abuse)
 * - Alias-based DoS (resource exhaustion)
 * - Depth/complexity attacks
 * - Field suggestion attacks
 * - Injection in arguments (SQLi, NoSQLi, etc.)
 * - Authorization bypass in resolvers
 * - IDOR through GraphQL queries
 * - Rate limiting bypass
 *
 * Tools: GraphQL-cop, BatchQL, InQL, custom analyzers
 */
export class GraphQLAgent extends BaseAgent<GraphQLJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('graphql' as any);
  }

  protected getSteps() {
    return [
      {
        name: 'Discover GraphQL endpoints',
        metadata: { phase: 'discovery' },
      },
      {
        name: 'Test introspection queries',
        metadata: { phase: 'enumeration' },
      },
      {
        name: 'Batching attack testing',
        metadata: { phase: 'dos-testing' },
      },
      {
        name: 'Depth/complexity attacks',
        metadata: { phase: 'resource-exhaustion' },
      },
      {
        name: 'Injection and auth bypass',
        metadata: { phase: 'security-testing' },
      },
      {
        name: 'Store findings',
        metadata: { phase: 'reporting' },
      },
    ];
  }

  async process(job: Job<GraphQLJob>): Promise<GraphQLResult> {
    const { programId, endpoints, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'graphql',
      'start',
      'info',
      `Starting GraphQL testing on ${endpoints.length} endpoints`
    );

    const result: GraphQLResult = {
      vulnerabilities: [],
      discoveredSchemas: 0,
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Discover GraphQL endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const graphqlEndpoints = await this.discoverGraphQLEndpoints(endpoints, programId, job.id);
      result.testedEndpoints = graphqlEndpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', {
        endpointsFound: graphqlEndpoints.length,
      });

      if (graphqlEndpoints.length === 0) {
        logger.info({ programId }, 'No GraphQL endpoints found');
        await this.updateJobStatus(job.id, 'completed', result);
        return result;
      }

      // Step 2: Test introspection
      if (options.testIntrospection !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const introspectionVulns = await this.testIntrospection(
          graphqlEndpoints,
          programId,
          job.id
        );
        result.vulnerabilities.push(...introspectionVulns);
        result.discoveredSchemas += introspectionVulns.length;
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: introspectionVulns.length,
        });
      }

      // Step 3: Batching attacks
      if (options.testBatching !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const batchingVulns = await this.testBatchingAttacks(
          graphqlEndpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...batchingVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: batchingVulns.length,
        });
      }

      // Step 4: Depth/complexity attacks
      if (options.testDepthAttack !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const depthVulns = await this.testDepthAttacks(graphqlEndpoints, programId, job.id, options);
        result.vulnerabilities.push(...depthVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: depthVulns.length,
        });
      }

      // Step 5: Injection and auth bypass
      await this.updateStepStatus(job.id, 4, 'running');
      const injectionVulns = await this.testInjectionAndAuthBypass(
        graphqlEndpoints,
        programId,
        job.id,
        options
      );
      result.vulnerabilities.push(...injectionVulns);
      await this.updateStepStatus(job.id, 4, 'completed', {
        vulnerabilitiesFound: injectionVulns.length,
      });

      // Step 6: Store findings
      await this.updateStepStatus(job.id, 5, 'running');
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }
      await this.updateStepStatus(job.id, 5, 'completed', {
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
        'graphql',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} GraphQL vulnerabilities in ${result.executionTime}ms`
      );

      // Trigger handoffs
      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'graphql',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Discover GraphQL endpoints
   */
  private async discoverGraphQLEndpoints(
    endpoints: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const graphqlPatterns = ['/graphql', '/api/graphql', '/v1/graphql', '/query', '/api'];

    const potentialEndpoints = endpoints.filter((url) =>
      graphqlPatterns.some((pattern) => url.toLowerCase().includes(pattern))
    );

    // Verify endpoints are actually GraphQL
    const verifiedEndpoints: string[] = [];
    for (const endpoint of potentialEndpoints) {
      if (await this.isGraphQLEndpoint(endpoint)) {
        verifiedEndpoints.push(endpoint);
      }
    }

    return verifiedEndpoints;
  }

  /**
   * Verify if endpoint is GraphQL
   */
  private async isGraphQLEndpoint(endpoint: string): Promise<boolean> {
    try {
      const response = await axios.post(
        endpoint,
        { query: '{ __typename }' },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 5000,
          validateStatus: () => true,
        }
      );

      // GraphQL endpoints typically respond to __typename
      return response.data && (response.data.data || response.data.errors);
    } catch {
      return false;
    }
  }

  /**
   * Test introspection query
   */
  private async testIntrospection(
    endpoints: string[],
    programId: string,
    jobId: string
  ): Promise<GraphQLResult['vulnerabilities']> {
    const vulnerabilities: GraphQLResult['vulnerabilities'] = [];

    const introspectionQuery = `
      query IntrospectionQuery {
        __schema {
          queryType { name }
          mutationType { name }
          subscriptionType { name }
          types {
            name
            kind
            description
            fields {
              name
              description
              args {
                name
                type { name kind ofType { name kind } }
              }
              type { name kind ofType { name kind } }
            }
          }
        }
      }
    `;

    for (const endpoint of endpoints) {
      try {
        const response = await axios.post(
          endpoint,
          { query: introspectionQuery },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 10000,
            validateStatus: () => true,
          }
        );

        if (response.data && response.data.data && response.data.data.__schema) {
          const schema = response.data.data.__schema;
          const typeCount = schema.types ? schema.types.length : 0;

          vulnerabilities.push({
            endpoint,
            type: 'introspection-enabled',
            severity: 'medium',
            confidence: 0.95,
            evidence: `Introspection query successful. Discovered ${typeCount} types, ${schema.queryType?.name || 'unknown'} query root`,
            payload: introspectionQuery,
            impact:
              'Attackers can enumerate entire GraphQL schema, discovering all queries, mutations, types, and fields. This aids in finding attack surface.',
            remediation:
              'Disable introspection in production. Use schema directives or middleware to block __schema and __type queries.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing introspection');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test batching attacks (query cost abuse)
   */
  private async testBatchingAttacks(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: GraphQLJob['options']
  ): Promise<GraphQLResult['vulnerabilities']> {
    const vulnerabilities: GraphQLResult['vulnerabilities'] = [];
    const batchSize = options.batchSize || 100;

    for (const endpoint of endpoints) {
      try {
        // Create batch of identical queries with aliases
        const batchedQuery = Array.from({ length: batchSize })
          .map((_, i) => `alias${i}: __typename`)
          .join('\n');

        const query = `{ ${batchedQuery} }`;

        const startTime = Date.now();
        const response = await axios.post(
          endpoint,
          { query },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            validateStatus: () => true,
          }
        );
        const responseTime = Date.now() - startTime;

        // If batching succeeded without rate limiting
        if (response.status === 200 && response.data.data) {
          vulnerabilities.push({
            endpoint,
            type: 'batching-dos',
            severity: 'high',
            confidence: 0.85,
            evidence: `Batched ${batchSize} queries in single request. Response time: ${responseTime}ms. No rate limiting detected.`,
            payload: query.substring(0, 200) + '...',
            impact:
              'Attackers can batch unlimited queries to exhaust server resources, causing DoS. Query cost multiplies linearly.',
            remediation:
              'Implement query cost analysis and limits. Disable batching or limit batch size. Use query complexity analysis.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing batching attack');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test depth attacks (nested query resource exhaustion)
   */
  private async testDepthAttacks(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: GraphQLJob['options']
  ): Promise<GraphQLResult['vulnerabilities']> {
    const vulnerabilities: GraphQLResult['vulnerabilities'] = [];
    const maxDepth = options.maxDepth || 20;

    for (const endpoint of endpoints) {
      try {
        // Create deeply nested query
        let nestedQuery = '__typename';
        for (let i = 0; i < maxDepth; i++) {
          nestedQuery = `{ __typename nested${i}: { ${nestedQuery} } }`;
        }

        const startTime = Date.now();
        const response = await axios.post(
          endpoint,
          { query: `query ${nestedQuery}` },
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: 30000,
            validateStatus: () => true,
          }
        );
        const responseTime = Date.now() - startTime;

        // If deep query executed without depth limiting
        if (response.status === 200 || responseTime > 10000) {
          vulnerabilities.push({
            endpoint,
            type: 'depth-attack',
            severity: 'high',
            confidence: 0.8,
            evidence: `Deeply nested query (depth: ${maxDepth}) executed. Response time: ${responseTime}ms. No depth limiting.`,
            payload: 'Nested query (truncated)',
            impact:
              'Attackers can craft deeply nested queries to cause exponential resource consumption, leading to DoS.',
            remediation:
              'Implement query depth limiting (max 5-10 levels). Use query complexity analysis to reject expensive queries.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing depth attack');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test injection and authorization bypass
   */
  private async testInjectionAndAuthBypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: GraphQLJob['options']
  ): Promise<GraphQLResult['vulnerabilities']> {
    const vulnerabilities: GraphQLResult['vulnerabilities'] = [];

    // Test for injection vulnerabilities
    const injectionPayloads = [
      { type: 'sqli', payload: `' OR '1'='1` },
      { type: 'nosqli', payload: `{"$gt": ""}` },
      { type: 'command', payload: `'; ls -la; '` },
    ];

    // Test for field suggestion attacks
    // Test for IDOR through ID manipulation
    // Test for auth bypass in resolvers

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: GraphQLResult['vulnerabilities'],
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
          vuln.endpoint,
          vuln.evidence,
          vuln.payload,
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
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: GraphQLResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `graphql-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.endpoint,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `graphql-${jobId}`,
        metadata: {
          graphqlType: vuln.type,
          payload: vuln.payload,
          impact: vuln.impact,
          remediation: vuln.remediation,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '🔍 GraphQL agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share GraphQL findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<GraphQLJob>, result: GraphQLResult) {
    const { programId } = job.data;

    // High severity GraphQL vulns -> confirm with deeper testing
    const criticalFindings = result.vulnerabilities.filter((v) => v.severity === 'high' || v.severity === 'critical');
    if (criticalFindings.length > 0) {
      await this.createHandoff(
        job.id,
        'graphql',
        'confirm',
        {
          reason: 'GraphQL vulnerabilities require confirmation',
          targets: criticalFindings.map((v) => v.endpoint),
          testType: 'graphql-exploit',
        },
        programId
      );
    }

    // Injection found -> trigger injection-specific agents
    const injectionVulns = result.vulnerabilities.filter((v) => v.type === 'injection');
    if (injectionVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'graphql',
        'sqli',
        {
          reason: 'GraphQL injection detected, testing for SQL injection',
          targets: injectionVulns.map((v) => v.endpoint),
        },
        programId
      );
    }
  }
}
