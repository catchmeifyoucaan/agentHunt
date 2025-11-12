/**
 * Browser Agent - Phase 2.4: Enhanced Tool Suite
 *
 * Browser automation for testing vulnerabilities that require a real browser:
 * - XSS (Cross-Site Scripting) - detect alert() triggers
 * - CSRF (Cross-Site Request Forgery) - check token presence
 * - Authentication bypass - test auth flows
 * - Client-side logic - test JavaScript-heavy apps
 *
 * Uses Playwright for headless browser automation with:
 * - Video recording for PoC
 * - Screenshot capture
 * - Network traffic monitoring
 * - Cookie/localStorage access
 */

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { BaseAgent } from './base';
import { Job } from 'bullmq';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import database from '../services/database';

interface BrowserTestJob extends BaseJob {
  type: 'confirm';  // Use existing AgentType
  options: {
    urls: string[];
    tests: ('xss' | 'csrf' | 'auth')[];
    payloads?: string[];
    credentials?: { username: string; password: string };
  };
}

interface BrowserTestResult {
  url: string;
  testType: string;
  vulnerable: boolean;
  payload?: string;
  screenshot?: string;
  video?: string;
  details?: any;
}

/**
 * BrowserAgent - Automated browser testing for web vulnerabilities
 */
export class BrowserAgent extends BaseAgent<BrowserTestJob> {
  private browser: Browser | null = null;
  private videoDir = '/tmp/browser-videos';
  private screenshotDir = '/tmp/browser-screenshots';

  constructor() {
    super('confirm');
  }

  /**
   * Initialize browser
   */
  private async initialize(): Promise<void> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
        ],
      });

      // Create directories
      await fs.mkdir(this.videoDir, { recursive: true });
      await fs.mkdir(this.screenshotDir, { recursive: true });

      logger.info('Browser initialized (Chromium headless)');
    }
  }

  /**
   * Cleanup browser
   */
  private async cleanup(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      logger.info('Browser closed');
    }
  }

  async process(job: Job<BrowserTestJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');
    await this.logExecution(
      job.id!,
      programId,
      'browser',
      'start',
      'info',
      `Starting browser tests for ${options.urls.length} URLs`
    );

    try {
      await this.initialize();

      const results: BrowserTestResult[] = [];

      for (const url of options.urls) {
        for (const testType of options.tests) {
          let result: BrowserTestResult | null = null;

          switch (testType) {
            case 'xss':
              result = await this.testXSS(url, options.payloads || this.getDefaultXSSPayloads());
              break;
            case 'csrf':
              result = await this.testCSRF(url);
              break;
            case 'auth':
              if (options.credentials) {
                result = await this.testAuthFlow(url, options.credentials);
              }
              break;
          }

          if (result) {
            results.push(result);

            // Save finding if vulnerable
            if (result.vulnerable) {
              await this.saveFinding(programId, result);
            }
          }
        }
      }

      await this.updateJobStatus(job.id!, 'completed', {
        tested: options.urls.length,
        vulnerable: results.filter((r) => r.vulnerable).length,
        results,
      });

      await this.logExecution(
        job.id!,
        programId,
        'browser',
        'complete',
        'info',
        `Browser tests complete: ${results.filter((r) => r.vulnerable).length} vulnerabilities found`
      );

      return { success: true, results };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.updateJobStatus(job.id!, 'failed', null, errorMessage);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Test for XSS vulnerabilities
   */
  async testXSS(url: string, payloads: string[]): Promise<BrowserTestResult> {
    const span = this.tracer.startSpan('browser.test_xss', {
      attributes: {
        'test.url': url,
        'test.payload_count': payloads.length,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        const testId = uuidv4().slice(0, 8);
        const browserContext = await this.browser!.newContext({
          recordVideo: {
            dir: this.videoDir,
            size: { width: 1280, height: 720 },
          },
        });

        const page = await browserContext.newPage();
        let xssTriggered = false;
        let triggeredPayload = '';

        // Set up alert/dialog listener
        page.on('dialog', async (dialog) => {
          xssTriggered = true;
          logger.info({ url, dialogType: dialog.type(), message: dialog.message() }, 'XSS dialog detected');
          await dialog.dismiss();
        });

        // Test each payload
        for (const payload of payloads) {
          try {
            // Try URL parameter injection
            const testUrl = `${url}${url.includes('?') ? '&' : '?'}test=${encodeURIComponent(payload)}`;
            await page.goto(testUrl, { waitUntil: 'networkidle', timeout: 10000 });
            await page.waitForTimeout(2000); // Wait for potential XSS

            if (xssTriggered) {
              triggeredPayload = payload;
              break;
            }

            // Try form input injection
            const forms = await page.locator('form').count();
            if (forms > 0) {
              const inputs = await page.locator('input[type="text"], input:not([type]), textarea').all();
              for (const input of inputs) {
                await input.fill(payload);
              }

              const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
              if (await submitBtn.count() > 0) {
                await submitBtn.click();
                await page.waitForTimeout(2000);

                if (xssTriggered) {
                  triggeredPayload = payload;
                  break;
                }
              }
            }
          } catch (error) {
            logger.debug({ error, payload }, 'XSS test error (continuing)');
          }

          if (xssTriggered) break;
        }

        // Capture evidence
        const screenshotPath = path.join(this.screenshotDir, `xss-${testId}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });

        // Get video path from page (Playwright stores video per page)
        let videoPath: string | undefined;
        try {
          videoPath = await page.video()?.path();
        } catch (e) {
          logger.warn('Failed to get video path');
        }

        await browserContext.close();

        const result: BrowserTestResult = {
          url,
          testType: 'xss',
          vulnerable: xssTriggered,
          payload: triggeredPayload || undefined,
          screenshot: screenshotPath,
          video: xssTriggered ? videoPath : undefined,
          details: {
            testedPayloads: payloads.length,
            triggerLocation: xssTriggered ? 'detected' : 'none',
          },
        };

        span.setAttributes({
          'test.vulnerable': xssTriggered,
          'test.payload': triggeredPayload,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return result;
      } catch (error) {
        span.recordException(error as Error);
        const errorMessage = error instanceof Error ? error.message : String(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Test for CSRF vulnerabilities
   */
  async testCSRF(url: string): Promise<BrowserTestResult> {
    try {
      const testId = uuidv4().slice(0, 8);
      const browserContext = await this.browser!.newContext();
      const page = await browserContext.newPage();

      await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });

      // Check for CSRF token in meta tags
      const csrfMeta = await page.evaluate((): string | null => {
        const meta = (globalThis as any).document.querySelector('meta[name="csrf-token"], meta[name="X-CSRF-TOKEN"]');
        return meta?.getAttribute('content') || null;
      });

      // Check for CSRF token in forms
      const csrfFormToken = await page.evaluate((): string | null => {
        const input = (globalThis as any).document.querySelector('input[name="csrf_token"], input[name="_token"], input[name="csrf"]');
        return input?.getAttribute('value') || null;
      });

      // Test if POST request works without CSRF token
      let vulnerableToCSRF = false;
      try {
        const response = await page.evaluate(async (targetUrl) => {
          const res = await fetch(targetUrl, {
            method: 'POST',
            body: JSON.stringify({ action: 'test' }),
            headers: { 'Content-Type': 'application/json' },
          });
          return { status: res.status, ok: res.ok };
        }, url);

        // If request succeeds without CSRF token, it's vulnerable
        vulnerableToCSRF = response.ok && !csrfMeta && !csrfFormToken;
      } catch (error) {
        // Request failed, likely protected
      }

      const screenshotPath = path.join(this.screenshotDir, `csrf-${testId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      await browserContext.close();

      return {
        url,
        testType: 'csrf',
        vulnerable: vulnerableToCSRF,
        screenshot: screenshotPath,
        details: {
          csrfMetaToken: !!csrfMeta,
          csrfFormToken: !!csrfFormToken,
          postWithoutTokenSucceeded: vulnerableToCSRF,
        },
      };
    } catch (error) {
      logger.error({ error, url }, 'CSRF test failed');
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        url,
        testType: 'csrf',
        vulnerable: false,
        details: { error: errorMessage },
      };
    }
  }

  /**
   * Test authentication flow
   */
  async testAuthFlow(url: string, credentials: { username: string; password: string }): Promise<BrowserTestResult> {
    try {
      const testId = uuidv4().slice(0, 8);
      const browserContext = await this.browser!.newContext();
      const page = await browserContext.newPage();

      // Test direct navigation without auth
      const bypassAttempt = await page.goto(`${url}/admin`, { waitUntil: 'networkidle', timeout: 10000 });
      const authBypassed = bypassAttempt?.status() === 200 && !page.url().includes('login');

      // Test credential stuffing
      await page.goto(`${url}/login`, { waitUntil: 'networkidle', timeout: 10000 });

      await page.fill('input[name="username"], input[type="text"]', credentials.username);
      await page.fill('input[name="password"], input[type="password"]', credentials.password);
      await page.click('button[type="submit"], input[type="submit"]');

      await page.waitForTimeout(2000);

      const authSuccess = page.url().includes('dashboard') || page.url().includes('profile') || page.url().includes('admin');

      const screenshotPath = path.join(this.screenshotDir, `auth-${testId}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      await browserContext.close();

      return {
        url,
        testType: 'auth',
        vulnerable: authBypassed || authSuccess,
        screenshot: screenshotPath,
        details: {
          authBypass: authBypassed,
          credentialValid: authSuccess,
          finalUrl: page.url(),
        },
      };
    } catch (error) {
      logger.error({ error, url }, 'Auth test failed');
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        url,
        testType: 'auth',
        vulnerable: false,
        details: { error: errorMessage },
      };
    }
  }

  /**
   * Save finding to database
   */
  private async saveFinding(programId: string, result: BrowserTestResult): Promise<void> {
    try {
      // This would integrate with the existing findings system
      logger.info(
        {
          programId,
          url: result.url,
          testType: result.testType,
          vulnerable: result.vulnerable,
        },
        'Browser vulnerability found'
      );

      // Save to findings table with screenshot/video evidence
      const severity = result.testType === 'xss' ? 'high' : result.testType === 'csrf' ? 'medium' : 'low';
      const findingTitle = `${result.testType.toUpperCase()} vulnerability detected via browser automation`;
      const description = `Browser automation testing detected a ${result.testType} vulnerability on ${result.url}`;

      await database.query(
        `INSERT INTO findings (
          id, program_id, asset_id, severity, confidence, title, description,
          cvss, cwe, evidence, poc, impact, remediation, status, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())`,
        [
          uuidv4(),
          programId,
          result.url, // Using URL as asset_id temporarily
          severity,
          result.vulnerable ? 0.8 : 0.2,
          findingTitle,
          description,
          result.testType === 'xss' ? 7.5 : 5.0,
          result.testType === 'xss' ? ['CWE-79'] : result.testType === 'csrf' ? ['CWE-352'] : ['CWE-287'],
          JSON.stringify({
            type: 'browser-test',
            url: result.url,
            testType: result.testType,
            screenshot: result.screenshot,
            video: result.video,
            details: result.details,
          }),
          JSON.stringify({
            steps: [
              `1. Navigate to ${result.url}`,
              `2. Test ${result.testType} vulnerability`,
              result.vulnerable ? `3. Vulnerability confirmed` : `3. No vulnerability detected`,
            ],
            reproductionRate: result.vulnerable ? 0.9 : 0,
            payload: result.payload,
          }),
          result.testType === 'xss'
            ? 'Attacker can execute arbitrary JavaScript in user browsers'
            : result.testType === 'csrf'
            ? 'Attacker can perform unauthorized actions on behalf of authenticated users'
            : 'Authentication bypass may be possible',
          result.testType === 'xss'
            ? 'Implement proper output encoding and Content Security Policy'
            : result.testType === 'csrf'
            ? 'Implement CSRF tokens on all state-changing operations'
            : 'Review authentication implementation',
          result.vulnerable ? 'new' : 'false_positive',
        ]
      );

      logger.info({ programId, url: result.url }, 'Browser finding saved to database');
    } catch (error) {
      logger.error({ error }, 'Failed to save browser finding');
    }
  }

  /**
   * Get default XSS payloads
   */
  private getDefaultXSSPayloads(): string[] {
    return [
      '<script>alert(1)</script>',
      '<img src=x onerror=alert(1)>',
      '<svg onload=alert(1)>',
      '"><script>alert(1)</script>',
      "'><script>alert(1)</script>",
      'javascript:alert(1)',
      '<iframe src="javascript:alert(1)">',
      '<body onload=alert(1)>',
      '<input onfocus=alert(1) autofocus>',
      '<marquee onstart=alert(1)>',
    ];
  }
}
