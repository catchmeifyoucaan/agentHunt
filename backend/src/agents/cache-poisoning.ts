/**
 * Cache Poisoning Agent
 * Purpose: Detect web cache poisoning vulnerabilities
 * 
 * Attack Types:
 * - Web Cache Deception
 * - Cache Key Injection
 * - Response Splitting
 * - Fat GET Requests
 * - Unkeyed Header Injection
 * - Parameter Cloaking
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface CachePoisoningJob extends BaseJob {
  type: 'cache-poisoning';
  options: {
    targetUrl: string;
    programId: string;
    testAllVectors?: boolean;
  };
}

interface CachePoisoningFinding {
  vulnerability: string;
  variant: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  endpoint: string;
  payload: string;
  description: string;
  impact: string;
  evidence?: string;
}

export class CachePoisoningAgent extends BaseAgent<CachePoisoningJob> {
  // Unkeyed headers commonly used for cache poisoning
  private readonly UNKEYED_HEADERS = [
    'X-Forwarded-Host',
    'X-Forwarded-Scheme',
    'X-Forwarded-Proto',
    'X-Original-URL',
    'X-Rewrite-URL',
    'X-Host',
    'X-Forwarded-Server',
    'X-HTTP-Method-Override',
    'X-Forwarded-For',
    'X-Real-IP',
    'X-Custom-IP-Authorization',
    'X-Original-Host',
    'Forwarded',
    'CF-Connecting-IP',
    'True-Client-IP',
    'Client-IP',
    'X-Client-IP',
    'X-Cluster-Client-IP',
  ];

  // Cache buster patterns
  private readonly CACHE_BUSTERS = [
    (url: string) => `${url}?cb=${Date.now()}`,
    (url: string) => `${url}?_=${Math.random().toString(36).substring(7)}`,
  ];

  constructor() {
    super('cache-poisoning');
  }

  protected getSteps() {
    return [
      { name: 'Analyze caching behavior' },
      { name: 'Test unkeyed headers' },
      { name: 'Test web cache deception' },
      { name: 'Test parameter cloaking' },
      { name: 'Test fat GET requests' },
      { name: 'Store findings' },
    ];
  }

  async process(job: Job<CachePoisoningJob>): Promise<any> {
    const { programId, options } = job.data;
    const { targetUrl, testAllVectors = true } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const findings: CachePoisoningFinding[] = [];

    try {
      // Step 1: Analyze caching behavior
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'cache-analyzer',
        toolStatus: 'running',
        message: 'Analyzing caching behavior',
      });

      const cacheInfo = await this.analyzeCacheBehavior(targetUrl);
      logger.info({ cacheInfo }, 'Cache behavior analysis complete');

      // Step 2: Test unkeyed headers
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'unkeyed-header-test',
        toolStatus: 'running',
        message: 'Testing unkeyed headers',
      });

      const headerFindings = await this.testUnkeyedHeaders(targetUrl, cacheInfo);
      findings.push(...headerFindings);

      // Step 3: Test web cache deception
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 45,
        currentTool: 'cache-deception-test',
        toolStatus: 'running',
        message: 'Testing web cache deception',
      });

      const deceptionFindings = await this.testWebCacheDeception(targetUrl);
      findings.push(...deceptionFindings);

      // Step 4: Test parameter cloaking
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 60,
        currentTool: 'param-cloaking-test',
        toolStatus: 'running',
        message: 'Testing parameter cloaking',
      });

      const cloakingFindings = await this.testParameterCloaking(targetUrl);
      findings.push(...cloakingFindings);

      // Step 5: Test fat GET requests
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 80,
        currentTool: 'fat-get-test',
        toolStatus: 'running',
        message: 'Testing fat GET requests',
      });

      const fatGetFindings = await this.testFatGetRequests(targetUrl);
      findings.push(...fatGetFindings);

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

      if (findings.length > 0) {
        await this.triggerHandoffs(programId, findings, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${findings.length} cache poisoning vulnerabilities`,
      });

      const result = {
        targetUrl,
        cacheInfo,
        findingsCount: findings.length,
        criticalCount: findings.filter(f => f.severity === 'critical').length,
        findings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'Cache poisoning testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Analyze caching behavior
   */
  private async analyzeCacheBehavior(url: string): Promise<{
    isCached: boolean;
    cacheHeaders: Record<string, string>;
    cacheType?: string;
    maxAge?: number;
  }> {
    try {
      const response = await this.makeRequest(url, 'GET', {});
      
      const cacheHeaders: Record<string, string> = {};
      const cacheRelatedHeaders = [
        'cache-control',
        'age',
        'x-cache',
        'x-cache-hits',
        'cf-cache-status',
        'x-varnish',
        'x-drupal-cache',
        'x-proxy-cache',
        'x-rack-cache',
        'x-fastly-request-id',
        'x-served-by',
        'x-timer',
        'via',
        'vary',
        'etag',
        'last-modified',
        'expires',
      ];

      for (const header of cacheRelatedHeaders) {
        if (response.headers[header]) {
          cacheHeaders[header] = response.headers[header];
        }
      }

      const isCached = !!(
        cacheHeaders['x-cache']?.includes('HIT') ||
        cacheHeaders['cf-cache-status']?.includes('HIT') ||
        cacheHeaders['x-proxy-cache']?.includes('HIT') ||
        cacheHeaders['age'] ||
        cacheHeaders['x-varnish']
      );

      let cacheType: string | undefined;
      if (cacheHeaders['cf-cache-status']) cacheType = 'Cloudflare';
      else if (cacheHeaders['x-varnish']) cacheType = 'Varnish';
      else if (cacheHeaders['x-fastly-request-id']) cacheType = 'Fastly';
      else if (cacheHeaders['x-drupal-cache']) cacheType = 'Drupal';

      let maxAge: number | undefined;
      const cacheControl = cacheHeaders['cache-control'];
      if (cacheControl) {
        const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
        if (maxAgeMatch) maxAge = parseInt(maxAgeMatch[1]);
      }

      return { isCached, cacheHeaders, cacheType, maxAge };
    } catch (error) {
      return { isCached: false, cacheHeaders: {} };
    }
  }

  /**
   * Test unkeyed headers for cache poisoning
   */
  private async testUnkeyedHeaders(
    url: string,
    cacheInfo: any
  ): Promise<CachePoisoningFinding[]> {
    const findings: CachePoisoningFinding[] = [];
    const canary = `cptest${Date.now()}`;

    for (const header of this.UNKEYED_HEADERS) {
      try {
        // Use cache buster to ensure fresh request
        const testUrl = this.CACHE_BUSTERS[0](url);

        // First request: poison the cache
        const poisonHeaders = { [header]: `evil.com/${canary}` };
        const poisonResponse = await this.makeRequest(testUrl, 'GET', poisonHeaders);

        // Check if our canary appears in the response
        if (poisonResponse.body.includes(canary) || poisonResponse.body.includes('evil.com')) {
          // Second request: verify cache poisoning (without the header)
          await new Promise(resolve => setTimeout(resolve, 500));
          const verifyResponse = await this.makeRequest(testUrl, 'GET', {});

          if (verifyResponse.body.includes(canary) || verifyResponse.body.includes('evil.com')) {
            findings.push({
              vulnerability: 'Cache Poisoning via Unkeyed Header',
              variant: 'unkeyed-header',
              severity: 'high',
              endpoint: url,
              payload: `${header}: evil.com/${canary}`,
              description: `The ${header} header is reflected in the response and not included in the cache key, allowing cache poisoning.`,
              impact: 'Persistent XSS, phishing, or malware distribution affecting all users',
              evidence: `Header ${header} reflected in cached response`,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, header }, 'Unkeyed header test error');
      }
    }

    return findings;
  }

  /**
   * Test web cache deception
   */
  private async testWebCacheDeception(url: string): Promise<CachePoisoningFinding[]> {
    const findings: CachePoisoningFinding[] = [];

    // Static file extensions that are typically cached
    const staticExtensions = [
      '.css',
      '.js',
      '.jpg',
      '.png',
      '.gif',
      '.ico',
      '.svg',
      '.woff',
      '.woff2',
    ];

    // Path confusion patterns
    const pathPatterns = [
      (u: string) => `${u}/nonexistent.css`,
      (u: string) => `${u}/..%2fnonexistent.css`,
      (u: string) => `${u}%2f..%2fnonexistent.css`,
      (u: string) => `${u}/;nonexistent.css`,
      (u: string) => `${u}/.css`,
      (u: string) => `${u}%00.css`,
      (u: string) => `${u}%0a.css`,
    ];

    for (const pattern of pathPatterns) {
      try {
        const testUrl = pattern(url);
        
        // Request the deceptive URL
        const response = await this.makeRequest(testUrl, 'GET', {});

        // Check if we got the original page content (not 404)
        if (response.status === 200 && response.body.length > 100) {
          // Check if it was cached
          const cacheInfo = await this.analyzeCacheBehavior(testUrl);
          
          if (cacheInfo.isCached) {
            findings.push({
              vulnerability: 'Web Cache Deception',
              variant: 'path-confusion',
              severity: 'high',
              endpoint: testUrl,
              payload: testUrl,
              description: 'The application serves dynamic content at a URL with a static file extension, which gets cached.',
              impact: 'Sensitive user data cached and accessible to attackers',
              evidence: `URL ${testUrl} returns dynamic content and is cached`,
            });
            break; // One finding is enough
          }
        }
      } catch (error) {
        logger.debug({ error }, 'Web cache deception test error');
      }
    }

    return findings;
  }

  /**
   * Test parameter cloaking
   */
  private async testParameterCloaking(url: string): Promise<CachePoisoningFinding[]> {
    const findings: CachePoisoningFinding[] = [];
    const canary = `cloaktest${Date.now()}`;

    // Parameter cloaking patterns
    const cloakingPatterns = [
      `?utm_content=x%26callback=${canary}`,
      `?_=${Date.now()}&callback=${canary}`,
      `?;callback=${canary}`,
      `?%00callback=${canary}`,
    ];

    for (const pattern of cloakingPatterns) {
      try {
        const testUrl = `${url}${pattern}`;
        const response = await this.makeRequest(testUrl, 'GET', {});

        if (response.body.includes(canary)) {
          // Verify caching
          const cacheInfo = await this.analyzeCacheBehavior(testUrl);
          
          if (cacheInfo.isCached) {
            findings.push({
              vulnerability: 'Cache Poisoning via Parameter Cloaking',
              variant: 'parameter-cloaking',
              severity: 'medium',
              endpoint: url,
              payload: pattern,
              description: 'Hidden parameters are reflected in the response but not included in the cache key.',
              impact: 'Cache poisoning with attacker-controlled content',
              evidence: `Parameter cloaking pattern ${pattern} reflected and cached`,
            });
            break;
          }
        }
      } catch (error) {
        logger.debug({ error }, 'Parameter cloaking test error');
      }
    }

    return findings;
  }

  /**
   * Test fat GET requests
   */
  private async testFatGetRequests(url: string): Promise<CachePoisoningFinding[]> {
    const findings: CachePoisoningFinding[] = [];
    const canary = `fatget${Date.now()}`;

    try {
      const testUrl = this.CACHE_BUSTERS[0](url);

      // Send GET request with body
      const response = await this.makeRequest(testUrl, 'GET', {
        'Content-Type': 'application/x-www-form-urlencoded',
      }, `callback=${canary}`);

      if (response.body.includes(canary)) {
        // Verify caching
        await new Promise(resolve => setTimeout(resolve, 500));
        const verifyResponse = await this.makeRequest(testUrl, 'GET', {});

        if (verifyResponse.body.includes(canary)) {
          findings.push({
            vulnerability: 'Cache Poisoning via Fat GET Request',
            variant: 'fat-get',
            severity: 'high',
            endpoint: url,
            payload: `GET with body: callback=${canary}`,
            description: 'The server processes GET request bodies and the response is cached.',
            impact: 'Cache poisoning with attacker-controlled content',
            evidence: 'GET request body reflected in cached response',
          });
        }
      }
    } catch (error) {
      logger.debug({ error }, 'Fat GET test error');
    }

    return findings;
  }

  /**
   * Make HTTP request
   */
  private async makeRequest(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string
  ): Promise<{ status: number; body: string; headers: Record<string, string> }> {
    try {
      const requestHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        ...headers,
      };

      const response = await fetch(url, {
        method,
        headers: requestHeaders,
        body: body || undefined,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key.toLowerCase()] = value;
      });

      return {
        status: response.status,
        body: await response.text(),
        headers: responseHeaders,
      };
    } catch (error) {
      return { status: 0, body: '', headers: {} };
    }
  }

  /**
   * Store finding in database
   */
  private async storeFinding(programId: string, finding: CachePoisoningFinding, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          programId,
          jobId,
          'cache-poisoning',
          finding.severity,
          finding.vulnerability,
          finding.endpoint,
          `${finding.description}\n\nImpact: ${finding.impact}`,
          JSON.stringify({ variant: finding.variant, payload: finding.payload, evidence: finding.evidence }),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save cache poisoning finding');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(programId: string, findings: CachePoisoningFinding[], jobId: string): Promise<void> {
    const criticalFindings = findings.filter(f => f.severity === 'critical' || f.severity === 'high');
    
    if (criticalFindings.length > 0) {
      await this.handoff('triage', {
        toAgent: 'triage',
        reason: `Found ${criticalFindings.length} cache poisoning vulnerabilities`,
        data: { findings: criticalFindings, urgency: 'high' },
        priority: 9,
        metadata: { programId, parentJobId: jobId, source: 'cache-poisoning' },
      });
    }
  }
}

export default new CachePoisoningAgent();
