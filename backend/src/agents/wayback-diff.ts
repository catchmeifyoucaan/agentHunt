/**
 * Wayback Machine Differential Analysis Agent
 * Purpose: Find removed/old endpoints that still exist
 * 
 * Method:
 * - Fetch all historical URLs from Wayback Machine CDX API
 * - Compare with current site crawl
 * - Test removed endpoints for accessibility
 * - Find backup files, old admin panels, archived API versions
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import https from 'https';
import http from 'http';

interface WaybackDiffJob extends BaseJob {
  type: 'wayback-diff';
  options: {
    targetDomain: string;
    programId: string;
    maxUrls?: number;
    testRemovedEndpoints?: boolean;
    findBackupFiles?: boolean;
  };
}

interface WaybackUrl {
  url: string;
  timestamp: string;
  statusCode: string;
  mimeType: string;
}

interface DiffResult {
  historicalOnly: string[];      // URLs that existed historically but not in current crawl
  currentOnly: string[];         // URLs that exist now but not historically
  backupFiles: string[];         // .bak, .old, .backup, etc.
  oldApiVersions: string[];      // /api/v1, /api/v2, etc.
  adminPanels: string[];         // /admin, /dashboard, /manage, etc.
  interestingEndpoints: string[];// Potentially sensitive endpoints
}

export class WaybackDiffAgent extends BaseAgent<WaybackDiffJob> {
  private readonly WAYBACK_CDX_API = 'https://web.archive.org/cdx/search/cdx';
  
  private readonly BACKUP_PATTERNS = [
    /\.(bak|backup|old|orig|original|copy|tmp|temp|swp|save)$/i,
    /\.(sql|db|sqlite|mdb)$/i,
    /\.(zip|tar|gz|rar|7z)$/i,
    /\.(log|logs)$/i,
    /~$/,
    /\.DS_Store$/i,
    /\.git\//i,
    /\.svn\//i,
    /\.env/i,
    /config\.(json|yaml|yml|xml|ini|php|js)$/i,
  ];

  private readonly ADMIN_PATTERNS = [
    /\/admin/i,
    /\/dashboard/i,
    /\/manage/i,
    /\/control/i,
    /\/panel/i,
    /\/backend/i,
    /\/cms/i,
    /\/wp-admin/i,
    /\/administrator/i,
    /\/console/i,
    /\/portal/i,
    /\/staff/i,
    /\/internal/i,
  ];

  private readonly API_VERSION_PATTERN = /\/api\/v\d+/i;

  constructor() {
    super('wayback-diff');
  }

  protected getSteps() {
    return [
      { name: 'Fetch historical URLs from Wayback Machine' },
      { name: 'Get current crawl data' },
      { name: 'Perform differential analysis' },
      { name: 'Test removed endpoints' },
      { name: 'Identify backup files and sensitive paths' },
      { name: 'Store findings and trigger handoffs' },
    ];
  }

  async process(job: Job<WaybackDiffJob>): Promise<any> {
    const { programId, options } = job.data;
    const { targetDomain, maxUrls = 10000, testRemovedEndpoints = true, findBackupFiles = true } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Step 1: Fetch historical URLs from Wayback Machine
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'wayback-cdx',
        toolStatus: 'running',
        message: `Fetching historical URLs for ${targetDomain}`,
      });

      const historicalUrls = await this.fetchWaybackUrls(targetDomain, maxUrls);
      logger.info({ domain: targetDomain, count: historicalUrls.length }, 'Fetched historical URLs');

      // Step 2: Get current crawl data from database
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'database',
        toolStatus: 'running',
        message: 'Loading current crawl data',
      });

      const currentUrls = await this.getCurrentCrawlUrls(programId, targetDomain);
      logger.info({ domain: targetDomain, count: currentUrls.length }, 'Loaded current crawl URLs');

      // Step 3: Perform differential analysis
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 40,
        currentTool: 'diff-analysis',
        toolStatus: 'running',
        message: 'Analyzing differences',
      });

      const diffResult = this.performDiff(historicalUrls, currentUrls);
      logger.info({
        historicalOnly: diffResult.historicalOnly.length,
        backupFiles: diffResult.backupFiles.length,
        adminPanels: diffResult.adminPanels.length,
        oldApiVersions: diffResult.oldApiVersions.length,
      }, 'Differential analysis complete');

      // Step 4: Test removed endpoints
      let accessibleEndpoints: string[] = [];
      if (testRemovedEndpoints && diffResult.historicalOnly.length > 0) {
        await this.updateJobProgress(job.id!, {
          current: 4,
          total: 6,
          percentage: 55,
          currentTool: 'endpoint-tester',
          toolStatus: 'running',
          message: `Testing ${Math.min(diffResult.historicalOnly.length, 500)} removed endpoints`,
        });

        accessibleEndpoints = await this.testEndpoints(
          diffResult.historicalOnly.slice(0, 500),
          job.id!,
          programId
        );
        logger.info({ accessible: accessibleEndpoints.length }, 'Found accessible removed endpoints');
      }

      // Step 5: Identify backup files and sensitive paths
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 75,
        currentTool: 'backup-finder',
        toolStatus: 'running',
        message: 'Identifying backup files and sensitive paths',
      });

      // Combine all interesting findings
      const allInteresting = [
        ...diffResult.backupFiles,
        ...diffResult.adminPanels,
        ...diffResult.oldApiVersions,
        ...diffResult.interestingEndpoints,
      ];

      // Test interesting paths if they weren't in the removed endpoints test
      let accessibleInteresting: string[] = [];
      if (findBackupFiles && allInteresting.length > 0) {
        const untested = allInteresting.filter(url => !accessibleEndpoints.includes(url));
        accessibleInteresting = await this.testEndpoints(
          untested.slice(0, 200),
          job.id!,
          programId
        );
      }

      // Step 6: Store findings
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 90,
        currentTool: 'storage',
        toolStatus: 'running',
        message: 'Storing findings',
      });

      const findings = await this.storeFindings(
        programId,
        targetDomain,
        {
          accessibleRemovedEndpoints: accessibleEndpoints,
          accessibleBackupFiles: accessibleInteresting.filter(url => 
            this.BACKUP_PATTERNS.some(p => p.test(url))
          ),
          accessibleAdminPanels: accessibleInteresting.filter(url =>
            this.ADMIN_PATTERNS.some(p => p.test(url))
          ),
          oldApiVersions: accessibleInteresting.filter(url =>
            this.API_VERSION_PATTERN.test(url)
          ),
        },
        job.id!
      );

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
        message: `Found ${findings.length} interesting endpoints`,
      });

      const result = {
        domain: targetDomain,
        historicalUrlsAnalyzed: historicalUrls.length,
        currentUrlsCompared: currentUrls.length,
        removedEndpointsFound: diffResult.historicalOnly.length,
        accessibleRemovedEndpoints: accessibleEndpoints.length,
        backupFilesFound: diffResult.backupFiles.length,
        adminPanelsFound: diffResult.adminPanels.length,
        oldApiVersionsFound: diffResult.oldApiVersions.length,
        totalFindings: findings.length,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, domain: targetDomain }, 'Wayback diff analysis failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Fetch historical URLs from Wayback Machine CDX API
   */
  private async fetchWaybackUrls(domain: string, maxUrls: number): Promise<WaybackUrl[]> {
    const params = new URLSearchParams({
      url: `*.${domain}/*`,
      output: 'json',
      fl: 'original,timestamp,statuscode,mimetype',
      collapse: 'urlkey',
      limit: maxUrls.toString(),
      filter: 'statuscode:200',
    });

    const url = `${this.WAYBACK_CDX_API}?${params.toString()}`;

    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const lines = data.trim().split('\n');
            if (lines.length <= 1) {
              resolve([]);
              return;
            }

            // Skip header row
            const urls: WaybackUrl[] = lines.slice(1).map(line => {
              try {
                const parsed = JSON.parse(line);
                return {
                  url: parsed[0],
                  timestamp: parsed[1],
                  statusCode: parsed[2],
                  mimeType: parsed[3],
                };
              } catch {
                return null;
              }
            }).filter((u): u is WaybackUrl => u !== null);

            resolve(urls);
          } catch (error) {
            // Try parsing as JSON array
            try {
              const parsed = JSON.parse(data);
              if (Array.isArray(parsed) && parsed.length > 1) {
                const urls: WaybackUrl[] = parsed.slice(1).map((row: any[]) => ({
                  url: row[0],
                  timestamp: row[1],
                  statusCode: row[2],
                  mimeType: row[3],
                }));
                resolve(urls);
              } else {
                resolve([]);
              }
            } catch {
              resolve([]);
            }
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Get current crawl URLs from database
   */
  private async getCurrentCrawlUrls(programId: string, domain: string): Promise<string[]> {
    try {
      const result = await database.query(
        `SELECT DISTINCT url FROM crawl_results 
         WHERE program_id = $1 
         AND url LIKE $2
         ORDER BY url`,
        [programId, `%${domain}%`]
      );
      return result.rows.map((r: any) => r.url);
    } catch (error) {
      // Table might not exist, return empty
      logger.debug({ error }, 'Could not fetch crawl results');
      return [];
    }
  }

  /**
   * Perform differential analysis between historical and current URLs
   */
  private performDiff(historical: WaybackUrl[], current: string[]): DiffResult {
    const historicalSet = new Set(historical.map(h => this.normalizeUrl(h.url)));
    const currentSet = new Set(current.map(c => this.normalizeUrl(c)));

    const historicalOnly: string[] = [];
    const backupFiles: string[] = [];
    const adminPanels: string[] = [];
    const oldApiVersions: string[] = [];
    const interestingEndpoints: string[] = [];

    for (const h of historical) {
      const normalized = this.normalizeUrl(h.url);
      
      if (!currentSet.has(normalized)) {
        historicalOnly.push(h.url);

        // Categorize the URL
        if (this.BACKUP_PATTERNS.some(p => p.test(h.url))) {
          backupFiles.push(h.url);
        }
        if (this.ADMIN_PATTERNS.some(p => p.test(h.url))) {
          adminPanels.push(h.url);
        }
        if (this.API_VERSION_PATTERN.test(h.url)) {
          oldApiVersions.push(h.url);
        }
        if (this.isInteresting(h.url)) {
          interestingEndpoints.push(h.url);
        }
      }
    }

    const currentOnly = current.filter(c => !historicalSet.has(this.normalizeUrl(c)));

    return {
      historicalOnly,
      currentOnly,
      backupFiles: [...new Set(backupFiles)],
      adminPanels: [...new Set(adminPanels)],
      oldApiVersions: [...new Set(oldApiVersions)],
      interestingEndpoints: [...new Set(interestingEndpoints)],
    };
  }

  /**
   * Normalize URL for comparison
   */
  private normalizeUrl(url: string): string {
    try {
      const parsed = new URL(url);
      // Remove trailing slash, lowercase, remove common tracking params
      let normalized = `${parsed.protocol}//${parsed.host}${parsed.pathname}`.toLowerCase();
      normalized = normalized.replace(/\/+$/, '');
      return normalized;
    } catch {
      return url.toLowerCase().replace(/\/+$/, '');
    }
  }

  /**
   * Check if URL is potentially interesting
   */
  private isInteresting(url: string): boolean {
    const interestingPatterns = [
      /debug/i,
      /test/i,
      /dev/i,
      /staging/i,
      /internal/i,
      /private/i,
      /secret/i,
      /hidden/i,
      /upload/i,
      /download/i,
      /export/i,
      /import/i,
      /backup/i,
      /dump/i,
      /phpinfo/i,
      /info\.php/i,
      /\.htaccess/i,
      /\.htpasswd/i,
      /web\.config/i,
      /crossdomain\.xml/i,
      /clientaccesspolicy\.xml/i,
    ];
    return interestingPatterns.some(p => p.test(url));
  }

  /**
   * Test if endpoints are accessible
   */
  private async testEndpoints(
    urls: string[],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const accessible: string[] = [];
    const batchSize = 50;

    for (let i = 0; i < urls.length; i += batchSize) {
      const batch = urls.slice(i, i + batchSize);
      
      const results = await Promise.allSettled(
        batch.map(url => this.checkUrl(url))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled' && result.value) {
          accessible.push(batch[j]);
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return accessible;
  }

  /**
   * Check if a URL is accessible (returns 200-399)
   */
  private checkUrl(url: string): Promise<boolean> {
    return new Promise((resolve) => {
      const protocol = url.startsWith('https') ? https : http;
      const timeout = 5000;

      const req = protocol.get(url, { timeout }, (res) => {
        resolve(res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 400);
      });

      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  /**
   * Store findings in database
   */
  private async storeFindings(
    programId: string,
    domain: string,
    results: {
      accessibleRemovedEndpoints: string[];
      accessibleBackupFiles: string[];
      accessibleAdminPanels: string[];
      oldApiVersions: string[];
    },
    jobId: string
  ): Promise<any[]> {
    const findings: any[] = [];

    // Store backup file findings
    for (const url of results.accessibleBackupFiles) {
      const finding = {
        id: uuidv4(),
        programId,
        jobId,
        type: 'backup-file-exposure',
        severity: 'high',
        title: `Backup/Sensitive File Exposed: ${new URL(url).pathname}`,
        url,
        description: `A backup or sensitive file was found accessible at a historical URL that may contain sensitive information.`,
        evidence: { url, source: 'wayback-diff' },
      };
      findings.push(finding);
      await this.saveFinding(finding);
    }

    // Store admin panel findings
    for (const url of results.accessibleAdminPanels) {
      const finding = {
        id: uuidv4(),
        programId,
        jobId,
        type: 'admin-panel-exposure',
        severity: 'medium',
        title: `Admin Panel Found: ${new URL(url).pathname}`,
        url,
        description: `An administrative panel was found at a historical URL that is still accessible.`,
        evidence: { url, source: 'wayback-diff' },
      };
      findings.push(finding);
      await this.saveFinding(finding);
    }

    // Store old API version findings
    for (const url of results.oldApiVersions) {
      const finding = {
        id: uuidv4(),
        programId,
        jobId,
        type: 'old-api-version',
        severity: 'low',
        title: `Old API Version Accessible: ${new URL(url).pathname}`,
        url,
        description: `An old API version was found that may lack security patches or have deprecated vulnerabilities.`,
        evidence: { url, source: 'wayback-diff' },
      };
      findings.push(finding);
      await this.saveFinding(finding);
    }

    // Store interesting removed endpoints (sample)
    const interestingRemoved = results.accessibleRemovedEndpoints
      .filter(url => this.isInteresting(url))
      .slice(0, 20);

    for (const url of interestingRemoved) {
      const finding = {
        id: uuidv4(),
        programId,
        jobId,
        type: 'forgotten-endpoint',
        severity: 'info',
        title: `Forgotten Endpoint: ${new URL(url).pathname}`,
        url,
        description: `A historical endpoint that was removed from the current site is still accessible.`,
        evidence: { url, source: 'wayback-diff' },
      };
      findings.push(finding);
      await this.saveFinding(finding);
    }

    return findings;
  }

  /**
   * Save a finding to the database
   */
  private async saveFinding(finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          finding.id,
          finding.programId,
          finding.jobId,
          finding.type,
          finding.severity,
          finding.title,
          finding.url,
          finding.description,
          JSON.stringify(finding.evidence),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save wayback diff finding');
    }
  }

  /**
   * Trigger handoffs for critical findings
   */
  private async triggerHandoffs(programId: string, findings: any[], jobId: string): Promise<void> {
    // Hand off backup files to scanner for deeper analysis
    const backupFindings = findings.filter(f => f.type === 'backup-file-exposure');
    if (backupFindings.length > 0) {
      await this.handoff('scanner', {
        toAgent: 'scanner',
        reason: `Found ${backupFindings.length} exposed backup files that need vulnerability scanning`,
        data: {
          urls: backupFindings.map(f => f.url),
          scanType: 'sensitive-file',
        },
        priority: 8,
        metadata: {
          programId,
          parentJobId: jobId,
          source: 'wayback-diff',
        },
      });
    }

    // Hand off admin panels to auth-bypass agent
    const adminFindings = findings.filter(f => f.type === 'admin-panel-exposure');
    if (adminFindings.length > 0) {
      await this.handoff('auth-bypass', {
        toAgent: 'auth-bypass',
        reason: `Found ${adminFindings.length} admin panels that need authentication testing`,
        data: {
          urls: adminFindings.map(f => f.url),
          testType: 'admin-panel',
        },
        priority: 7,
        metadata: {
          programId,
          parentJobId: jobId,
          source: 'wayback-diff',
        },
      });
    }
  }
}

export default new WaybackDiffAgent();
