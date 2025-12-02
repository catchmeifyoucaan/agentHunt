/**
 * AgentHunt Interceptor - Main Service
 * 
 * A complete Burp Suite Pro alternative built from scratch.
 * 
 * Features:
 * - MITM Proxy with SSL interception
 * - Request/Response history & replay
 * - Turbo Intruder for race conditions
 * - GraphQL introspection & testing
 * - WebSocket interception
 * - Session management & token extraction
 * - Advanced scanning with context
 */

import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';

// Import sub-modules
import { ProxyCore, InterceptedRequest, InterceptedResponse, InterceptionRule, ProxyConfig } from './proxy-core';
import turboIntruder, { TurboIntruder, TurboRequest, AttackConfig, AttackResult, PayloadSet } from './turbo-intruder';
import graphqlAnalyzer, { GraphQLAnalyzer, GraphQLTestResult } from './graphql-analyzer';

// ============================================
// Types
// ============================================

export interface InterceptorConfig {
  proxy: Partial<ProxyConfig>;
  autoStartProxy: boolean;
  enableWebSocket: boolean;
  enableGraphQL: boolean;
  maxHistorySize: number;
  sessionTimeout: number;
}

export interface RepeaterRequest {
  id: string;
  name: string;
  request: InterceptedRequest;
  responses: InterceptedResponse[];
  createdAt: Date;
  lastUsed: Date;
}

export interface ComparerItem {
  id: string;
  type: 'request' | 'response';
  content: string;
  label: string;
}

export interface ScanConfig {
  target: string;
  scope: string[];
  scanTypes: ScanType[];
  authentication?: {
    type: 'none' | 'basic' | 'bearer' | 'cookie';
    credentials?: Record<string, string>;
  };
  rateLimit: number;
  maxDepth: number;
  followRedirects: boolean;
}

export type ScanType = 
  | 'sqli'
  | 'xss'
  | 'ssrf'
  | 'idor'
  | 'auth_bypass'
  | 'info_disclosure'
  | 'misconfig'
  | 'graphql'
  | 'websocket';

export interface ScanResult {
  id: string;
  config: ScanConfig;
  startTime: Date;
  endTime?: Date;
  status: 'running' | 'completed' | 'cancelled' | 'error';
  findings: ScanFinding[];
  requestCount: number;
  progress: number;
}

export interface ScanFinding {
  id: string;
  type: ScanType;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  url: string;
  parameter?: string;
  payload?: string;
  evidence: string;
  request?: InterceptedRequest;
  response?: InterceptedResponse;
  remediation: string;
  references: string[];
  cvss?: number;
  cwe?: string;
}

// ============================================
// Main Interceptor Service
// ============================================

class InterceptorService extends EventEmitter {
  private static instance: InterceptorService;
  
  // Core components
  private proxy: ProxyCore | null = null;
  private config: InterceptorConfig;
  
  // State
  private repeaterRequests: Map<string, RepeaterRequest> = new Map();
  private activeScans: Map<string, ScanResult> = new Map();
  private comparerItems: ComparerItem[] = [];
  
  // Statistics
  private stats = {
    totalRequests: 0,
    totalResponses: 0,
    interceptedRequests: 0,
    droppedRequests: 0,
    modifiedRequests: 0,
    attacksRun: 0,
    findingsCount: 0,
  };

  private constructor() {
    super();
    this.config = {
      proxy: {
        port: 8080,
        host: '127.0.0.1',
        enableSsl: true,
        interceptEnabled: false,
        recordHistory: true,
        maxHistorySize: 10000,
        timeout: 30000,
      },
      autoStartProxy: false,
      enableWebSocket: true,
      enableGraphQL: true,
      maxHistorySize: 10000,
      sessionTimeout: 3600000,
    };
  }

  public static getInstance(): InterceptorService {
    if (!InterceptorService.instance) {
      InterceptorService.instance = new InterceptorService();
    }
    return InterceptorService.instance;
  }

  // ============================================
  // Proxy Management
  // ============================================

  public async startProxy(config?: Partial<ProxyConfig>): Promise<void> {
    if (this.proxy) {
      await this.stopProxy();
    }

    const proxyConfig = { ...this.config.proxy, ...config };
    this.proxy = new ProxyCore(proxyConfig);

    // Set up event handlers
    this.proxy.on('request', (req: InterceptedRequest) => {
      this.stats.totalRequests++;
      this.emit('proxy-request', req);
    });

    this.proxy.on('response', (res: InterceptedResponse) => {
      this.stats.totalResponses++;
      this.emit('proxy-response', res);
    });

    this.proxy.on('intercept-request', (req: InterceptedRequest) => {
      this.stats.interceptedRequests++;
      this.emit('intercept-request', req);
    });

    this.proxy.on('intercept-response', (res: InterceptedResponse) => {
      this.emit('intercept-response', res);
    });

    this.proxy.on('websocket-message', (msg: any) => {
      this.emit('websocket-message', msg);
    });

    this.proxy.on('token-extracted', (token: any) => {
      this.emit('token-extracted', token);
    });

    await this.proxy.start();
    logger.info({ port: proxyConfig.port }, 'Interceptor proxy started');
  }

  public async stopProxy(): Promise<void> {
    if (this.proxy) {
      await this.proxy.stop();
      this.proxy = null;
      logger.info('Interceptor proxy stopped');
    }
  }

  public getProxyStatus(): { running: boolean; config?: ProxyConfig } {
    if (this.proxy) {
      return { running: true, config: this.proxy.getConfig() };
    }
    return { running: false };
  }

  public setInterceptionEnabled(enabled: boolean): void {
    if (this.proxy) {
      this.proxy.setIntercepting(enabled);
    }
  }

  public addInterceptionRule(rule: InterceptionRule): void {
    if (this.proxy) {
      this.proxy.addRule(rule);
    }
  }

  public removeInterceptionRule(ruleId: string): void {
    if (this.proxy) {
      this.proxy.removeRule(ruleId);
    }
  }

  public getInterceptionRules(): InterceptionRule[] {
    return this.proxy?.getRules() || [];
  }

  public forwardRequest(requestId: string, modified?: InterceptedRequest): void {
    if (this.proxy) {
      if (modified) {
        this.stats.modifiedRequests++;
      }
      this.proxy.forwardInterceptedRequest(requestId, modified);
    }
  }

  public dropRequest(requestId: string): void {
    if (this.proxy) {
      this.stats.droppedRequests++;
      this.proxy.dropInterceptedRequest(requestId);
    }
  }

  public getCACertificate(): string | null {
    return this.proxy?.getCACertificate() || null;
  }

  // ============================================
  // History & Replay
  // ============================================

  public getHistory(): { requests: InterceptedRequest[]; responses: InterceptedResponse[] } {
    return this.proxy?.getHistory() || { requests: [], responses: [] };
  }

  public getRequest(requestId: string): InterceptedRequest | undefined {
    return this.proxy?.getRequest(requestId);
  }

  public getResponse(requestId: string): InterceptedResponse | undefined {
    return this.proxy?.getResponse(requestId);
  }

  public clearHistory(): void {
    this.proxy?.clearHistory();
  }

  // ============================================
  // Repeater
  // ============================================

  public addToRepeater(request: InterceptedRequest, name?: string): string {
    const id = uuidv4();
    const repeaterReq: RepeaterRequest = {
      id,
      name: name || `Request ${this.repeaterRequests.size + 1}`,
      request: { ...request },
      responses: [],
      createdAt: new Date(),
      lastUsed: new Date(),
    };

    this.repeaterRequests.set(id, repeaterReq);
    this.emit('repeater-added', repeaterReq);
    return id;
  }

  public async sendRepeaterRequest(
    repeaterId: string,
    modifications?: Partial<InterceptedRequest>
  ): Promise<InterceptedResponse | null> {
    const repeater = this.repeaterRequests.get(repeaterId);
    if (!repeater) {
      return null;
    }

    // Apply modifications
    const request = { ...repeater.request, ...modifications };

    // Send request using turbo intruder (single request mode)
    const turboReq: TurboRequest = {
      id: uuidv4(),
      method: request.method,
      url: request.url,
      headers: request.headers as Record<string, string>,
      body: request.body,
    };

    try {
      const result = await turboIntruder.raceConditionAttack(turboReq, [''], {
        concurrency: 1,
        useSinglePacket: false,
      });

      if (result.responses.length > 0) {
        const response = result.responses[0];
        const interceptedResponse: InterceptedResponse = {
          id: response.requestId,
          requestId: request.id,
          timestamp: response.timestamp,
          statusCode: response.statusCode,
          statusMessage: '',
          httpVersion: '1.1',
          headers: response.headers,
          body: response.body,
          bodyText: response.bodyText,
          contentType: response.headers['content-type'] as string,
          contentLength: response.body.length,
          responseTime: response.responseTime,
          modified: false,
        };

        repeater.responses.push(interceptedResponse);
        repeater.lastUsed = new Date();

        return interceptedResponse;
      }
    } catch (error: any) {
      logger.error({ error: error.message, repeaterId }, 'Repeater request failed');
    }

    return null;
  }

  public getRepeaterRequests(): RepeaterRequest[] {
    return Array.from(this.repeaterRequests.values());
  }

  public deleteRepeaterRequest(repeaterId: string): boolean {
    return this.repeaterRequests.delete(repeaterId);
  }

  // ============================================
  // Turbo Intruder (Race Conditions)
  // ============================================

  public async runRaceConditionAttack(
    request: TurboRequest,
    payloads: string[],
    config?: Partial<AttackConfig>
  ): Promise<AttackResult> {
    this.stats.attacksRun++;
    const result = await turboIntruder.raceConditionAttack(request, payloads, config);
    this.emit('attack-complete', result);
    return result;
  }

  public async runParallelFuzz(
    request: TurboRequest,
    payloadSets: PayloadSet[],
    config?: Partial<AttackConfig>
  ): Promise<AttackResult> {
    this.stats.attacksRun++;
    const result = await turboIntruder.parallelFuzz(request, payloadSets, config);
    this.emit('attack-complete', result);
    return result;
  }

  public cancelAttack(attackId: string): boolean {
    return turboIntruder.cancelAttack(attackId);
  }

  public getActiveAttacks(): string[] {
    return turboIntruder.getActiveAttacks();
  }

  // ============================================
  // GraphQL Testing
  // ============================================

  public async introspectGraphQL(
    url: string,
    headers?: Record<string, string>
  ): Promise<any> {
    return graphqlAnalyzer.introspect(url, headers);
  }

  public async scanGraphQL(
    url: string,
    headers?: Record<string, string>
  ): Promise<GraphQLTestResult> {
    const result = await graphqlAnalyzer.scanForVulnerabilities(url, headers);
    this.stats.findingsCount += result.vulnerabilities.length;
    this.emit('graphql-scan-complete', result);
    return result;
  }

  public async executeGraphQLQuery(
    url: string,
    query: string,
    variables?: Record<string, any>,
    headers?: Record<string, string>
  ): Promise<any> {
    return graphqlAnalyzer.executeQuery(url, query, variables, headers);
  }

  // ============================================
  // Comparer
  // ============================================

  public addToComparer(item: Omit<ComparerItem, 'id'>): string {
    const id = uuidv4();
    this.comparerItems.push({ ...item, id });
    return id;
  }

  public getComparerItems(): ComparerItem[] {
    return [...this.comparerItems];
  }

  public compareItems(id1: string, id2: string): {
    differences: Array<{ line: number; type: 'added' | 'removed' | 'changed'; content: string }>;
    similarity: number;
  } {
    const item1 = this.comparerItems.find((i) => i.id === id1);
    const item2 = this.comparerItems.find((i) => i.id === id2);

    if (!item1 || !item2) {
      return { differences: [], similarity: 0 };
    }

    const lines1 = item1.content.split('\n');
    const lines2 = item2.content.split('\n');
    const differences: Array<{ line: number; type: 'added' | 'removed' | 'changed'; content: string }> = [];

    // Simple line-by-line diff
    const maxLines = Math.max(lines1.length, lines2.length);
    let matchingLines = 0;

    for (let i = 0; i < maxLines; i++) {
      if (i >= lines1.length) {
        differences.push({ line: i + 1, type: 'added', content: lines2[i] });
      } else if (i >= lines2.length) {
        differences.push({ line: i + 1, type: 'removed', content: lines1[i] });
      } else if (lines1[i] !== lines2[i]) {
        differences.push({ line: i + 1, type: 'changed', content: `${lines1[i]} → ${lines2[i]}` });
      } else {
        matchingLines++;
      }
    }

    const similarity = maxLines > 0 ? matchingLines / maxLines : 1;

    return { differences, similarity };
  }

  public clearComparer(): void {
    this.comparerItems = [];
  }

  // ============================================
  // Active Scanning
  // ============================================

  public async startScan(config: ScanConfig): Promise<string> {
    const scanId = uuidv4();
    const scan: ScanResult = {
      id: scanId,
      config,
      startTime: new Date(),
      status: 'running',
      findings: [],
      requestCount: 0,
      progress: 0,
    };

    this.activeScans.set(scanId, scan);
    this.emit('scan-started', scan);

    // Run scan asynchronously
    this.runScan(scanId).catch((error) => {
      logger.error({ error: error.message, scanId }, 'Scan failed');
      scan.status = 'error';
      this.emit('scan-error', { scanId, error: error.message });
    });

    return scanId;
  }

  private async runScan(scanId: string): Promise<void> {
    const scan = this.activeScans.get(scanId);
    if (!scan) return;

    const { config } = scan;

    try {
      // Run different scan types
      for (const scanType of config.scanTypes) {
        if (scan.status === 'cancelled') break;

        switch (scanType) {
          case 'graphql':
            if (config.target.includes('graphql')) {
              const graphqlResult = await this.scanGraphQL(config.target);
              for (const vuln of graphqlResult.vulnerabilities) {
                scan.findings.push({
                  id: vuln.id,
                  type: 'graphql',
                  severity: vuln.severity,
                  title: vuln.title,
                  description: vuln.description,
                  url: config.target,
                  payload: vuln.payload,
                  evidence: vuln.evidence,
                  remediation: vuln.remediation,
                  references: [],
                });
              }
            }
            break;

          case 'sqli':
          case 'xss':
          case 'ssrf':
            // Use turbo intruder for parameter fuzzing
            await this.runParameterFuzzing(scan, scanType);
            break;

          // Add more scan types as needed
        }

        scan.progress = ((config.scanTypes.indexOf(scanType) + 1) / config.scanTypes.length) * 100;
        this.emit('scan-progress', { scanId, progress: scan.progress });
      }

      scan.status = 'completed';
      scan.endTime = new Date();
      this.stats.findingsCount += scan.findings.length;
      this.emit('scan-completed', scan);
    } catch (error: any) {
      scan.status = 'error';
      scan.endTime = new Date();
      throw error;
    }
  }

  private async runParameterFuzzing(scan: ScanResult, type: ScanType): Promise<void> {
    const payloads = this.getPayloadsForType(type);

    const request: TurboRequest = {
      id: uuidv4(),
      method: 'GET',
      url: scan.config.target + '?param=FUZZ',
      headers: {
        'User-Agent': 'AgentHunt-Scanner/1.0',
        ...(scan.config.authentication?.credentials || {}),
      },
    };

    const result = await turboIntruder.parallelFuzz(request, [
      { name: 'payloads', type: 'list', values: payloads },
    ], {
      concurrency: scan.config.rateLimit || 10,
      timeout: 10000,
    });

    // Analyze responses for vulnerabilities
    for (const response of result.responses) {
      const finding = this.analyzeResponseForVuln(response, type, scan.config.target);
      if (finding) {
        scan.findings.push(finding);
      }
    }

    scan.requestCount += result.totalRequests;
  }

  private getPayloadsForType(type: ScanType): string[] {
    const payloads: Record<ScanType, string[]> = {
      sqli: [
        "' OR '1'='1",
        "1' AND '1'='1",
        "1 UNION SELECT NULL--",
        "'; DROP TABLE users--",
        "1' AND SLEEP(5)--",
      ],
      xss: [
        '<script>alert(1)</script>',
        '"><img src=x onerror=alert(1)>',
        "javascript:alert(1)",
        '<svg/onload=alert(1)>',
        "'-alert(1)-'",
      ],
      ssrf: [
        'http://127.0.0.1',
        'http://localhost',
        'http://169.254.169.254',
        'file:///etc/passwd',
        'http://[::1]',
      ],
      idor: ['1', '2', '0', '-1', 'admin'],
      auth_bypass: ['admin', 'true', '1', 'null', ''],
      info_disclosure: ['../', '....//....//etc/passwd', '%00', '.git/config'],
      misconfig: ['/', '/.env', '/config', '/admin', '/debug'],
      graphql: [],
      websocket: [],
    };

    return payloads[type] || [];
  }

  private analyzeResponseForVuln(
    response: any,
    type: ScanType,
    url: string
  ): ScanFinding | null {
    const body = response.bodyText || '';

    // Simple pattern matching for demo
    const patterns: Record<ScanType, RegExp[]> = {
      sqli: [/SQL syntax/i, /mysql_fetch/i, /ORA-\d+/i, /PostgreSQL/i],
      xss: [/<script>alert\(1\)<\/script>/i, /onerror=alert/i],
      ssrf: [/root:x:0:0/i, /ami-id/i, /instance-id/i],
      idor: [],
      auth_bypass: [],
      info_disclosure: [/DB_PASSWORD/i, /API_KEY/i, /SECRET/i],
      misconfig: [/Index of/i, /Directory listing/i],
      graphql: [],
      websocket: [],
    };

    for (const pattern of patterns[type] || []) {
      if (pattern.test(body)) {
        return {
          id: uuidv4(),
          type,
          severity: this.getSeverityForType(type),
          title: `Potential ${type.toUpperCase()} Vulnerability`,
          description: `Pattern matched: ${pattern.source}`,
          url,
          evidence: body.substring(0, 500),
          remediation: this.getRemediationForType(type),
          references: [],
        };
      }
    }

    return null;
  }

  private getSeverityForType(type: ScanType): ScanFinding['severity'] {
    const severities: Record<ScanType, ScanFinding['severity']> = {
      sqli: 'critical',
      xss: 'high',
      ssrf: 'high',
      idor: 'high',
      auth_bypass: 'critical',
      info_disclosure: 'medium',
      misconfig: 'medium',
      graphql: 'medium',
      websocket: 'medium',
    };
    return severities[type] || 'medium';
  }

  private getRemediationForType(type: ScanType): string {
    const remediations: Record<ScanType, string> = {
      sqli: 'Use parameterized queries and input validation',
      xss: 'Implement output encoding and Content Security Policy',
      ssrf: 'Whitelist allowed URLs and block internal IPs',
      idor: 'Implement proper authorization checks',
      auth_bypass: 'Review authentication logic and session management',
      info_disclosure: 'Remove sensitive information from responses',
      misconfig: 'Review server configuration and disable directory listing',
      graphql: 'Disable introspection and implement query complexity limits',
      websocket: 'Implement proper authentication and message validation',
    };
    return remediations[type] || 'Review and fix the vulnerability';
  }

  public getScan(scanId: string): ScanResult | undefined {
    return this.activeScans.get(scanId);
  }

  public getActiveScans(): ScanResult[] {
    return Array.from(this.activeScans.values()).filter((s) => s.status === 'running');
  }

  public cancelScan(scanId: string): boolean {
    const scan = this.activeScans.get(scanId);
    if (scan && scan.status === 'running') {
      scan.status = 'cancelled';
      scan.endTime = new Date();
      this.emit('scan-cancelled', scan);
      return true;
    }
    return false;
  }

  // ============================================
  // Statistics
  // ============================================

  public getStats(): typeof this.stats {
    return { ...this.stats };
  }

  public resetStats(): void {
    this.stats = {
      totalRequests: 0,
      totalResponses: 0,
      interceptedRequests: 0,
      droppedRequests: 0,
      modifiedRequests: 0,
      attacksRun: 0,
      findingsCount: 0,
    };
  }

  // ============================================
  // Session Data
  // ============================================

  public getSessionData(): {
    cookies: Record<string, Record<string, string>>;
    tokens: Record<string, string>;
    authHeaders: Record<string, string>;
  } {
    const session = this.proxy?.getSession();
    if (!session) {
      return { cookies: {}, tokens: {}, authHeaders: {} };
    }

    const cookies: Record<string, Record<string, string>> = {};
    session.cookies.forEach((domainCookies, domain) => {
      cookies[domain] = {};
      domainCookies.forEach((value, name) => {
        cookies[domain][name] = value;
      });
    });

    const tokens: Record<string, string> = {};
    session.tokens.forEach((value, name) => {
      tokens[name] = value;
    });

    const authHeaders: Record<string, string> = {};
    session.authHeaders.forEach((value, name) => {
      authHeaders[name] = value;
    });

    return { cookies, tokens, authHeaders };
  }
}

// Export singleton and types
export const interceptor = InterceptorService.getInstance();
export default interceptor;

// Re-export sub-modules
export { ProxyCore } from './proxy-core';
export { TurboIntruder } from './turbo-intruder';
export { GraphQLAnalyzer } from './graphql-analyzer';
export * from './proxy-core';
export * from './turbo-intruder';
export * from './graphql-analyzer';
