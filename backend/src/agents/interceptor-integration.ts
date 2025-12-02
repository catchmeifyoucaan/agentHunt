/**
 * Interceptor Integration for Agents
 * 
 * This module provides the bridge between security agents and the Interceptor service.
 * It handles:
 * - Authenticated session management
 * - Race condition attacks
 * - Multi-step exploit chains
 * - GraphQL testing
 * - Business logic flaw detection
 */

import { interceptor } from '../services/interceptor';
import { TurboRequest, AttackConfig, PayloadSet } from '../services/interceptor/turbo-intruder';
import { SessionManagerService } from '../services/session-manager';
import logger from '../utils/logger';

// ============================================
// Types for Agent Integration
// ============================================

export interface AuthenticatedScanConfig {
  programId: string;
  credentialId: string;
  targets: string[];
  scanTypes: string[];
  maintainSession: boolean;
}

export interface RaceConditionTarget {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  payloadPosition?: string; // Where to inject: 'url' | 'body' | 'header'
  payloadMarker?: string; // e.g., '§FUZZ§'
}

export interface BusinessLogicFlow {
  name: string;
  steps: BusinessLogicStep[];
  expectedBehavior: string;
  vulnerabilityIndicators: string[];
}

export interface BusinessLogicStep {
  name: string;
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  extractors?: Array<{
    name: string;
    type: 'regex' | 'json' | 'header' | 'cookie';
    pattern: string;
  }>;
  assertions?: Array<{
    type: 'status' | 'body' | 'header';
    operator: 'equals' | 'contains' | 'matches';
    value: string;
  }>;
}

// ============================================
// Agent Integration Class
// ============================================

export class AgentInterceptorBridge {
  private sessionManager: SessionManagerService;

  constructor() {
    this.sessionManager = new SessionManagerService();
  }

  // ============================================
  // 1. AUTHENTICATED SCANNING
  // ============================================

  /**
   * Used by: SQLi Agent, XSS Agent, IDOR Agent, etc.
   * When: Testing endpoints that require authentication
   * What for: Maintaining valid sessions while fuzzing
   */
  async scanWithAuthentication(config: AuthenticatedScanConfig): Promise<any[]> {
    const findings: any[] = [];

    // 1. Get credentials for this program
    const session = await this.sessionManager.getOrCreateSession(
      config.programId,
      config.credentialId
    );

    if (!session) {
      logger.error({ programId: config.programId }, 'Failed to create authenticated session');
      return findings;
    }

    logger.info({
      programId: config.programId,
      targets: config.targets.length,
      sessionId: session.id,
    }, 'Starting authenticated scan');

    // 2. For each target, make authenticated requests
    for (const target of config.targets) {
      try {
        // Build request with session cookies/tokens
        const request: TurboRequest = {
          id: '',
          method: 'GET',
          url: target,
          headers: {
            ...session.headers,
            'Cookie': this.formatCookies(session.cookies),
          },
        };

        // Add to repeater for manual review
        interceptor.addToRepeater({
          id: '',
          timestamp: new Date(),
          method: request.method,
          url: request.url,
          host: new URL(target).hostname,
          port: 443,
          path: new URL(target).pathname,
          httpVersion: '1.1',
          headers: request.headers,
          body: Buffer.from(''),
          cookies: session.cookies,
          queryParams: {},
          isHttps: true,
          clientIp: 'agent',
          modified: false,
        }, `Auth Scan: ${new URL(target).pathname}`);

        // 3. Run parameter fuzzing with authentication
        const payloads = this.getPayloadsForScanType(config.scanTypes);
        
        const result = await interceptor.runParallelFuzz(request, payloads, {
          concurrency: 10,
          timeout: 15000,
        });

        // 4. Analyze responses for vulnerabilities
        for (const response of result.responses) {
          const vuln = this.analyzeAuthenticatedResponse(response, config.scanTypes);
          if (vuln) {
            findings.push({
              ...vuln,
              target,
              authenticated: true,
              sessionId: session.id,
            });
          }
        }

        // 5. Check if session is still valid, refresh if needed
        if (await this.sessionManager.isSessionExpired(session.id)) {
          await this.sessionManager.refreshSession(session.id);
        }

      } catch (error: any) {
        logger.error({ error: error.message, target }, 'Authenticated scan failed for target');
      }
    }

    return findings;
  }

  // ============================================
  // 2. RACE CONDITION TESTING
  // ============================================

  /**
   * Used by: Race Condition Agent
   * When: Testing for TOCTOU, double-spend, limit bypass
   * What for: Exploiting timing vulnerabilities
   */
  async testRaceCondition(target: RaceConditionTarget, testType: string): Promise<any> {
    logger.info({ url: target.url, testType }, 'Starting race condition test');

    // Build the base request
    const request: TurboRequest = {
      id: '',
      method: target.method,
      url: target.url,
      headers: target.headers || {},
      body: target.body,
    };

    // Different attack strategies based on test type
    let config: Partial<AttackConfig>;
    let payloads: string[];

    switch (testType) {
      case 'double-spend':
        // Send identical requests simultaneously
        config = {
          type: 'race',
          useSinglePacket: true,
          useLastByteSync: true,
          concurrency: 10,
        };
        payloads = Array(10).fill(''); // 10 identical requests
        break;

      case 'limit-bypass':
        // Try to exceed limits (e.g., coupon usage, vote count)
        config = {
          type: 'race',
          useSinglePacket: true,
          useLastByteSync: true,
          concurrency: 20,
        };
        payloads = Array(20).fill('');
        break;

      case 'toctou':
        // Time-of-check to time-of-use
        config = {
          type: 'race',
          useHttp2: true, // HTTP/2 multiplexing for precise timing
          concurrency: 5,
        };
        payloads = Array(5).fill('');
        break;

      case 'session-race':
        // Race condition in session handling
        config = {
          type: 'race',
          useSinglePacket: true,
          concurrency: 10,
        };
        payloads = Array(10).fill('');
        break;

      default:
        config = {
          type: 'race',
          useSinglePacket: true,
          concurrency: 10,
        };
        payloads = Array(10).fill('');
    }

    // Execute the race condition attack
    const result = await interceptor.runRaceConditionAttack(request, payloads, config);

    // Analyze for race condition indicators
    const analysis = this.analyzeRaceConditionResult(result, testType);

    return {
      testType,
      target: target.url,
      result: {
        totalRequests: result.totalRequests,
        successfulRequests: result.successfulRequests,
        statistics: result.statistics,
      },
      analysis,
      vulnerable: analysis.indicators.length > 0,
      confidence: analysis.confidence,
    };
  }

  // ============================================
  // 3. BUSINESS LOGIC TESTING
  // ============================================

  /**
   * Used by: Business Logic Agent
   * When: Testing multi-step workflows
   * What for: Finding logic flaws in application flows
   */
  async testBusinessLogicFlow(
    programId: string,
    credentialId: string,
    flow: BusinessLogicFlow
  ): Promise<any> {
    logger.info({ flowName: flow.name, steps: flow.steps.length }, 'Testing business logic flow');

    // Get authenticated session
    const session = await this.sessionManager.getOrCreateSession(programId, credentialId);
    if (!session) {
      throw new Error('Failed to create session for business logic testing');
    }

    const results: any[] = [];
    const extractedValues: Record<string, string> = {};

    // Execute each step in sequence
    for (let i = 0; i < flow.steps.length; i++) {
      const step = flow.steps[i];
      
      // Replace placeholders with extracted values
      let url = this.replacePlaceholders(step.request.url, extractedValues);
      let body = step.request.body ? this.replacePlaceholders(step.request.body, extractedValues) : undefined;
      let headers = { ...step.request.headers };
      
      // Add session headers
      headers = {
        ...headers,
        ...session.headers,
        'Cookie': this.formatCookies(session.cookies),
      };

      // Build and send request
      const request: TurboRequest = {
        id: '',
        method: step.request.method,
        url,
        headers,
        body,
      };

      // Use repeater to send single request
      const repeaterId = interceptor.addToRepeater({
        id: '',
        timestamp: new Date(),
        method: request.method,
        url: request.url,
        host: new URL(url).hostname,
        port: 443,
        path: new URL(url).pathname,
        httpVersion: '1.1',
        headers: request.headers,
        body: body ? Buffer.from(body) : Buffer.from(''),
        cookies: session.cookies,
        queryParams: {},
        isHttps: true,
        clientIp: 'agent',
        modified: false,
      }, `${flow.name} - Step ${i + 1}: ${step.name}`);

      const response = await interceptor.sendRepeaterRequest(repeaterId);

      if (!response) {
        results.push({
          step: step.name,
          success: false,
          error: 'No response received',
        });
        continue;
      }

      // Extract values for next steps
      if (step.extractors) {
        for (const extractor of step.extractors) {
          const value = this.extractValue(response, extractor);
          if (value) {
            extractedValues[extractor.name] = value;
          }
        }
      }

      // Check assertions
      let assertionsPassed = true;
      const assertionResults: any[] = [];

      if (step.assertions) {
        for (const assertion of step.assertions) {
          const passed = this.checkAssertion(response, assertion);
          assertionResults.push({ ...assertion, passed });
          if (!passed) assertionsPassed = false;
        }
      }

      results.push({
        step: step.name,
        success: assertionsPassed,
        statusCode: response.statusCode,
        extractedValues: { ...extractedValues },
        assertions: assertionResults,
      });

      // Update session cookies from response
      this.updateSessionFromResponse(session, response);
    }

    // Now test for logic flaws by manipulating the flow
    const flawTests = await this.testFlowManipulations(flow, session, extractedValues);

    return {
      flowName: flow.name,
      normalExecution: results,
      flawTests,
      vulnerabilities: flawTests.filter((t: any) => t.vulnerable),
    };
  }

  /**
   * Test various manipulations of the business logic flow
   */
  private async testFlowManipulations(
    flow: BusinessLogicFlow,
    session: any,
    extractedValues: Record<string, string>
  ): Promise<any[]> {
    const tests: any[] = [];

    // Test 1: Skip steps
    for (let skipIndex = 0; skipIndex < flow.steps.length - 1; skipIndex++) {
      const test = await this.testSkipStep(flow, session, extractedValues, skipIndex);
      tests.push({
        type: 'skip_step',
        skippedStep: flow.steps[skipIndex].name,
        ...test,
      });
    }

    // Test 2: Repeat steps
    for (let repeatIndex = 0; repeatIndex < flow.steps.length; repeatIndex++) {
      const test = await this.testRepeatStep(flow, session, extractedValues, repeatIndex);
      tests.push({
        type: 'repeat_step',
        repeatedStep: flow.steps[repeatIndex].name,
        ...test,
      });
    }

    // Test 3: Reverse order
    const reverseTest = await this.testReverseOrder(flow, session, extractedValues);
    tests.push({
      type: 'reverse_order',
      ...reverseTest,
    });

    // Test 4: Parameter tampering at each step
    for (let stepIndex = 0; stepIndex < flow.steps.length; stepIndex++) {
      const test = await this.testParameterTampering(flow, session, extractedValues, stepIndex);
      tests.push({
        type: 'parameter_tampering',
        step: flow.steps[stepIndex].name,
        ...test,
      });
    }

    return tests;
  }

  // ============================================
  // 4. GRAPHQL TESTING
  // ============================================

  /**
   * Used by: GraphQL Agent
   * When: Testing GraphQL endpoints
   * What for: Schema discovery, auth bypass, injection
   */
  async testGraphQLEndpoint(
    url: string,
    headers?: Record<string, string>
  ): Promise<any> {
    logger.info({ url }, 'Testing GraphQL endpoint');

    // 1. Introspect schema
    const schema = await interceptor.introspectGraphQL(url, headers);

    // 2. Scan for vulnerabilities
    const scanResult = await interceptor.scanGraphQL(url, headers);

    // 3. Generate and test queries based on schema
    const queryTests: any[] = [];

    if (schema) {
      // Test for IDOR on ID-based queries
      const idorTests = await this.testGraphQLIDOR(url, schema, headers);
      queryTests.push(...idorTests);

      // Test for injection in string parameters
      const injectionTests = await this.testGraphQLInjection(url, schema, headers);
      queryTests.push(...injectionTests);

      // Test for authorization bypass
      const authTests = await this.testGraphQLAuthBypass(url, schema, headers);
      queryTests.push(...authTests);
    }

    return {
      url,
      introspectionEnabled: !!schema,
      schema: schema ? { types: schema.types?.length || 0 } : null,
      vulnerabilities: scanResult.vulnerabilities,
      queryTests,
    };
  }

  private async testGraphQLIDOR(url: string, schema: any, headers?: Record<string, string>): Promise<any[]> {
    const tests: any[] = [];
    
    // Find queries with ID parameters
    const queryType = schema.types?.find((t: any) => t.name === 'Query');
    if (!queryType?.fields) return tests;

    for (const field of queryType.fields) {
      const idArg = field.args?.find((a: any) => 
        a.name.toLowerCase().includes('id') || 
        a.type?.name === 'ID'
      );

      if (idArg) {
        // Test with different ID values
        const testIds = ['1', '2', '0', '-1', 'admin', '999999'];
        
        for (const testId of testIds) {
          const query = `query { ${field.name}(${idArg.name}: "${testId}") { __typename } }`;
          
          try {
            const result = await interceptor.executeGraphQLQuery(url, query, {}, headers);
            
            if (result.data && !result.errors) {
              tests.push({
                type: 'idor',
                field: field.name,
                testId,
                success: true,
                response: result,
              });
            }
          } catch (error) {
            // Expected for invalid IDs
          }
        }
      }
    }

    return tests;
  }

  private async testGraphQLInjection(url: string, schema: any, headers?: Record<string, string>): Promise<any[]> {
    const tests: any[] = [];
    const injectionPayloads = [
      "' OR '1'='1",
      '"; DROP TABLE users; --',
      '<script>alert(1)</script>',
      '${7*7}',
      '{{7*7}}',
    ];

    const queryType = schema.types?.find((t: any) => t.name === 'Query');
    if (!queryType?.fields) return tests;

    for (const field of queryType.fields) {
      const stringArg = field.args?.find((a: any) => 
        a.type?.name === 'String' || a.type?.ofType?.name === 'String'
      );

      if (stringArg) {
        for (const payload of injectionPayloads) {
          const query = `query { ${field.name}(${stringArg.name}: "${payload}") { __typename } }`;
          
          try {
            const result = await interceptor.executeGraphQLQuery(url, query, {}, headers);
            
            // Check for injection indicators in response
            const responseStr = JSON.stringify(result);
            if (
              responseStr.includes('SQL') ||
              responseStr.includes('syntax') ||
              responseStr.includes('49') || // 7*7
              responseStr.includes('<script>')
            ) {
              tests.push({
                type: 'injection',
                field: field.name,
                payload,
                vulnerable: true,
                response: result,
              });
            }
          } catch (error) {
            // May indicate injection worked
          }
        }
      }
    }

    return tests;
  }

  private async testGraphQLAuthBypass(url: string, schema: any, headers?: Record<string, string>): Promise<any[]> {
    const tests: any[] = [];

    // Test mutations without authentication
    const mutationType = schema.types?.find((t: any) => t.name === 'Mutation');
    if (!mutationType?.fields) return tests;

    const sensitivePatterns = /admin|delete|update|create|user|password|role/i;

    for (const field of mutationType.fields) {
      if (sensitivePatterns.test(field.name)) {
        // Try to execute without auth
        const query = `mutation { ${field.name} { __typename } }`;
        
        try {
          const result = await interceptor.executeGraphQLQuery(url, query, {}, {}); // No auth headers
          
          if (!result.errors?.some((e: any) => 
            /auth|unauthorized|forbidden|permission/i.test(e.message)
          )) {
            tests.push({
              type: 'auth_bypass',
              mutation: field.name,
              vulnerable: true,
              response: result,
            });
          }
        } catch (error) {
          // Expected for protected mutations
        }
      }
    }

    return tests;
  }

  // ============================================
  // 5. IDOR TESTING WITH SESSION CONTEXT
  // ============================================

  /**
   * Used by: IDOR Agent
   * When: Testing for insecure direct object references
   * What for: Accessing other users' data
   */
  async testIDOR(
    programId: string,
    credentialIds: string[], // Multiple user accounts
    targetEndpoints: Array<{ url: string; idParam: string; method: string }>
  ): Promise<any[]> {
    const findings: any[] = [];

    if (credentialIds.length < 2) {
      logger.warn('IDOR testing requires at least 2 user accounts');
      return findings;
    }

    // Get sessions for both users
    const sessions = await Promise.all(
      credentialIds.map(id => this.sessionManager.getOrCreateSession(programId, id))
    );

    const [userA, userB] = sessions;
    if (!userA || !userB) {
      logger.error('Failed to create sessions for IDOR testing');
      return findings;
    }

    for (const endpoint of targetEndpoints) {
      // 1. User A accesses their own resource
      const userARequest = await this.makeAuthenticatedRequest(
        endpoint.url.replace('{id}', userA.userId || '1'),
        endpoint.method,
        userA
      );

      // 2. User A tries to access User B's resource
      const crossAccessRequest = await this.makeAuthenticatedRequest(
        endpoint.url.replace('{id}', userB.userId || '2'),
        endpoint.method,
        userA
      );

      // 3. Compare responses
      if (crossAccessRequest.statusCode === 200) {
        // Potential IDOR - User A could access User B's data
        findings.push({
          type: 'idor',
          endpoint: endpoint.url,
          severity: 'high',
          description: `User A was able to access User B's resource`,
          evidence: {
            ownResourceStatus: userARequest.statusCode,
            crossAccessStatus: crossAccessRequest.statusCode,
            crossAccessBody: crossAccessRequest.bodyText?.substring(0, 500),
          },
        });
      }
    }

    return findings;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private formatCookies(cookies: Record<string, string>): string {
    return Object.entries(cookies)
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }

  private getPayloadsForScanType(scanTypes: string[]): PayloadSet[] {
    const payloadSets: PayloadSet[] = [];

    if (scanTypes.includes('sqli')) {
      payloadSets.push({
        name: 'sqli',
        type: 'list',
        values: ["'", "''", "' OR '1'='1", "1' AND '1'='1", "' UNION SELECT NULL--"],
      });
    }

    if (scanTypes.includes('xss')) {
      payloadSets.push({
        name: 'xss',
        type: 'list',
        values: ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'-alert(1)-'"],
      });
    }

    if (scanTypes.includes('ssrf')) {
      payloadSets.push({
        name: 'ssrf',
        type: 'list',
        values: ['http://127.0.0.1', 'http://localhost', 'http://169.254.169.254'],
      });
    }

    return payloadSets;
  }

  private analyzeAuthenticatedResponse(response: any, scanTypes: string[]): any | null {
    const body = response.bodyText || '';

    // SQLi indicators
    if (scanTypes.includes('sqli')) {
      if (/SQL syntax|mysql_fetch|ORA-\d+|PostgreSQL|sqlite/i.test(body)) {
        return {
          type: 'sqli',
          severity: 'critical',
          evidence: body.substring(0, 500),
        };
      }
    }

    // XSS indicators
    if (scanTypes.includes('xss')) {
      if (/<script>alert\(1\)<\/script>|onerror=alert/i.test(body)) {
        return {
          type: 'xss',
          severity: 'high',
          evidence: body.substring(0, 500),
        };
      }
    }

    return null;
  }

  private analyzeRaceConditionResult(result: any, testType: string): any {
    const indicators: string[] = [];
    let confidence = 0;

    // Check for status code variations
    const statusCodes = new Set(result.responses.map((r: any) => r.statusCode));
    if (statusCodes.size > 1) {
      indicators.push(`Multiple status codes: ${Array.from(statusCodes).join(', ')}`);
      confidence += 0.3;
    }

    // Check for body variations
    const bodyHashes = new Set(result.responses.map((r: any) => this.hashString(r.bodyText || '')));
    if (bodyHashes.size > 1 && bodyHashes.size < result.responses.length) {
      indicators.push(`${bodyHashes.size} unique response bodies`);
      confidence += 0.3;
    }

    // Check for multiple successes (potential race win)
    const successCount = result.responses.filter((r: any) => r.statusCode >= 200 && r.statusCode < 300).length;
    if (successCount > 1 && testType === 'double-spend') {
      indicators.push(`${successCount} successful responses - potential double-spend`);
      confidence += 0.4;
    }

    return {
      indicators,
      confidence: Math.min(confidence, 1),
      statistics: result.statistics,
    };
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private replacePlaceholders(str: string, values: Record<string, string>): string {
    let result = str;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
  }

  private extractValue(response: any, extractor: any): string | null {
    switch (extractor.type) {
      case 'regex':
        const match = response.bodyText?.match(new RegExp(extractor.pattern));
        return match ? match[1] : null;
      case 'json':
        try {
          const json = JSON.parse(response.bodyText || '{}');
          return extractor.pattern.split('.').reduce((obj: any, key: string) => obj?.[key], json);
        } catch {
          return null;
        }
      case 'header':
        return response.headers[extractor.pattern.toLowerCase()];
      case 'cookie':
        // Extract from Set-Cookie header
        const cookies = response.headers['set-cookie'];
        if (cookies) {
          const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
          const cookieMatch = cookieStr.match(new RegExp(`${extractor.pattern}=([^;]+)`));
          return cookieMatch ? cookieMatch[1] : null;
        }
        return null;
      default:
        return null;
    }
  }

  private checkAssertion(response: any, assertion: any): boolean {
    let value: string;

    switch (assertion.type) {
      case 'status':
        value = String(response.statusCode);
        break;
      case 'body':
        value = response.bodyText || '';
        break;
      case 'header':
        value = response.headers[assertion.headerName?.toLowerCase()] || '';
        break;
      default:
        return false;
    }

    switch (assertion.operator) {
      case 'equals':
        return value === assertion.value;
      case 'contains':
        return value.includes(assertion.value);
      case 'matches':
        return new RegExp(assertion.value).test(value);
      default:
        return false;
    }
  }

  private updateSessionFromResponse(session: any, response: any): void {
    const setCookies = response.headers['set-cookie'];
    if (setCookies) {
      const cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
      for (const cookie of cookies) {
        const [nameValue] = cookie.split(';');
        const [name, value] = nameValue.split('=');
        if (name && value) {
          session.cookies[name.trim()] = value.trim();
        }
      }
    }
  }

  private async makeAuthenticatedRequest(url: string, method: string, session: any): Promise<any> {
    const request: TurboRequest = {
      id: '',
      method,
      url,
      headers: {
        ...session.headers,
        'Cookie': this.formatCookies(session.cookies),
      },
    };

    const result = await interceptor.runRaceConditionAttack(request, [''], {
      concurrency: 1,
      useSinglePacket: false,
    });

    return result.responses[0] || { statusCode: 0, bodyText: '' };
  }

  // Placeholder methods for flow manipulation tests
  private async testSkipStep(flow: BusinessLogicFlow, session: any, values: Record<string, string>, skipIndex: number): Promise<any> {
    // Implementation would execute flow skipping the specified step
    return { vulnerable: false, description: 'Step skip test' };
  }

  private async testRepeatStep(flow: BusinessLogicFlow, session: any, values: Record<string, string>, repeatIndex: number): Promise<any> {
    // Implementation would execute flow repeating the specified step
    return { vulnerable: false, description: 'Step repeat test' };
  }

  private async testReverseOrder(flow: BusinessLogicFlow, session: any, values: Record<string, string>): Promise<any> {
    // Implementation would execute flow in reverse order
    return { vulnerable: false, description: 'Reverse order test' };
  }

  private async testParameterTampering(flow: BusinessLogicFlow, session: any, values: Record<string, string>, stepIndex: number): Promise<any> {
    // Implementation would tamper with parameters at the specified step
    return { vulnerable: false, description: 'Parameter tampering test' };
  }
}

// Export singleton
export const agentInterceptor = new AgentInterceptorBridge();
export default agentInterceptor;
