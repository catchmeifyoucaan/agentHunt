import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';

export interface SqliJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    level?: number; // 1-5
    risk?: number; // 1-3
    technique?: string; // BEUSTQ
    dbms?: string; // mysql, postgres, mssql, oracle, etc.
    useSqlmap?: boolean;
    useGhauri?: boolean;
    threads?: number;
    timeout?: number;
    tamper?: string[];
    skipWaf?: boolean;
    dumpData?: boolean;
  };
}

export interface SqliResult {
  vulnerabilities: Array<{
    url: string;
    parameter: string;
    technique: string;
    dbms?: string;
    dbVersion?: string;
    payload: string;
    evidence: string;
    severity: 'critical' | 'high' | 'medium';
    confidence: number;
    poc: string;
    databaseInfo?: {
      currentUser?: string;
      currentDb?: string;
      hostname?: string;
      dumpedTables?: string[];
    };
  }>;
  testedUrls: number;
  executionTime: number;
}

/**
 * SQL Injection Vulnerability Scanning Agent
 *
 * Features:
 * - Comprehensive SQLi detection (Error-based, Boolean-based, Time-based, Union, Stacked queries)
 * - Multi-DBMS support (MySQL, PostgreSQL, MSSQL, Oracle, SQLite, etc.)
 * - WAF bypass techniques and tamper scripts
 * - Automatic database enumeration and dumping
 * - Both SQLMap and Ghauri integration for maximum coverage
 * - Intelligent risk/level configuration
 * - Thread-based concurrent testing
 */
export class SqliAgent extends BaseAgent<SqliJob> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('sqli' as any);
  }
  protected getSteps() {
    return [
      {
            name: "Load endpoints for SQLi testing",
            metadata: {}
      },
      {
            name: "Run SQLi scanner (sqlmap/ghauri)",
            metadata: {}
      },
      {
            name: "Validate SQL injection",
            metadata: {}
      },
      {
            name: "Store SQLi findings",
            metadata: {}
      }
];
  }


  async process(job: Job<SqliJob>): Promise<SqliResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'sqli',
      'start',
      'info',
      `Starting SQLi scanning on ${urls.length} URLs`
    );

    const result: SqliResult = {
      vulnerabilities: [],
      testedUrls: 0,
      executionTime: 0,
    };

    try {
      // Save URLs to temporary file
      const urlsFile = `/tmp/sqli-urls-${job.id}.txt`;
      const fs = require('fs');
      fs.writeFileSync(urlsFile, urls.join('\n'));

      // Check for cancellation
      if (await this.shouldCancel(job.id)) {
        throw new Error('Job cancelled');
      }

      // Run SQLMap if enabled (default)
      if (options.useSqlmap !== false) {
        await this.logExecution(job.id, programId, 'sqlmap', 'start', 'info', 'Running SQLMap scanner');
        const sqlmapResults = await this.runSqlmap(urls, options, job.id, programId);
        result.vulnerabilities.push(...sqlmapResults);
      }

      // Run Ghauri if enabled
      if (options.useGhauri) {
        await this.logExecution(job.id, programId, 'ghauri', 'start', 'info', 'Running Ghauri scanner');
        const ghauriResults = await this.runGhauri(urls, options, job.id, programId);
        result.vulnerabilities.push(...ghauriResults);
      }

      // Deduplicate findings
      result.vulnerabilities = this.deduplicateFindings(result.vulnerabilities);

      result.testedUrls = urls.length;
      result.executionTime = Date.now() - startTime;

      // Save findings to database
      await this.saveSqliFindings(programId, result.vulnerabilities);

      // Cleanup
      try {
        fs.unlinkSync(urlsFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      await this.logExecution(
        job.id,
        programId,
        'sqli',
        'complete',
        'info',
        `SQLi scanning complete: ${result.vulnerabilities.length} vulnerabilities found in ${result.executionTime}ms`
      );

      await this.updateJobStatus(job.id, 'completed', result);
      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'sqli', 'error', 'error', error.message);
      await this.updateJobStatus(job.id, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Run SQLMap scanner
   */
  private async runSqlmap(
    urls: string[],
    options: SqliJob['options'],
    jobId: string,
    programId: string
  ): Promise<SqliResult['vulnerabilities']> {
    const vulnerabilities: SqliResult['vulnerabilities'] = [];

    try {
      const level = options.level || 1;
      const risk = options.risk || 1;
      const threads = options.threads || 5;
      const timeout = options.timeout || 30;

      for (const url of urls) {
        if (await this.shouldCancel(jobId)) break;

        // Build SQLMap command
        let sqlmapCmd = `sqlmap -u "${url}"`;
        sqlmapCmd += ` --batch`; // Non-interactive mode
        sqlmapCmd += ` --random-agent`; // Random user agent
        sqlmapCmd += ` --level=${level}`;
        sqlmapCmd += ` --risk=${risk}`;
        sqlmapCmd += ` --threads=${threads}`;
        sqlmapCmd += ` --timeout=${timeout}`;
        sqlmapCmd += ` --technique=${options.technique || 'BEUSTQ'}`; // All techniques

        // Output options
        const outputDir = `/tmp/sqlmap-${jobId}`;
        sqlmapCmd += ` --output-dir=${outputDir}`;
        sqlmapCmd += ` --flush-session`; // Fresh scan

        // DBMS specification if provided
        if (options.dbms) {
          sqlmapCmd += ` --dbms=${options.dbms}`;
        }

        // WAF detection and bypass
        if (!options.skipWaf) {
          sqlmapCmd += ` --identify-waf`;
        }

        // Tamper scripts for WAF bypass
        if (options.tamper && options.tamper.length > 0) {
          sqlmapCmd += ` --tamper=${options.tamper.join(',')}`;
        } else if (!options.skipWaf) {
          // Default tamper scripts
          sqlmapCmd += ` --tamper=space2comment,between`;
        }

        // Database enumeration if vulnerable
        if (options.dumpData) {
          sqlmapCmd += ` --current-user --current-db --hostname --is-dba`;
        }

        // Smart detection
        sqlmapCmd += ` --smart`;

        // Skip static parameters
        sqlmapCmd += ` --skip-static`;

        logger.info({ url, command: 'sqlmap' }, 'Running SQLMap');

        const { stdout, stderr, exitCode } = await this.executeCommand(sqlmapCmd, {
          timeout: timeout * 1000 + 60000, // Add buffer
        });

        // Parse SQLMap output
        const findings = this.parseSqlmapOutput(stdout, stderr, url);
        vulnerabilities.push(...findings);

        // If vulnerable and dump requested, extract database info
        if (findings.length > 0 && options.dumpData) {
          const dbInfo = await this.extractDatabaseInfo(url, outputDir, jobId);
          findings.forEach(f => {
            f.databaseInfo = dbInfo;
          });
        }

        // Save output to S3
        try {
          const outputKey = await this.saveOutput(programId, 'sqlmap', stdout, 'txt');
          logger.info({ url, outputKey }, 'SQLMap output saved');
        } catch (e) {
          logger.warn({ error: e }, 'Failed to save SQLMap output');
        }

        // Rate limiting between scans
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      logger.info({ count: vulnerabilities.length }, 'SQLMap scan complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'SQLMap scan failed');
      return vulnerabilities;
    }
  }

  /**
   * Run Ghauri scanner (faster, more modern SQLi tool)
   */
  private async runGhauri(
    urls: string[],
    options: SqliJob['options'],
    jobId: string,
    programId: string
  ): Promise<SqliResult['vulnerabilities']> {
    const vulnerabilities: SqliResult['vulnerabilities'] = [];

    try {
      const level = options.level || 1;
      const threads = options.threads || 5;
      const timeout = options.timeout || 30;

      for (const url of urls) {
        if (await this.shouldCancel(jobId)) break;

        // Build Ghauri command
        let ghauriCmd = `ghauri -u "${url}"`;
        ghauriCmd += ` --batch`;
        ghauriCmd += ` --level=${level}`;
        ghauriCmd += ` --threads=${threads}`;
        ghauriCmd += ` --timeout=${timeout}`;

        // DBMS specification
        if (options.dbms) {
          ghauriCmd += ` --dbms=${options.dbms}`;
        }

        // Output to JSON
        const outputFile = `/tmp/ghauri-${jobId}-${Date.now()}.json`;
        ghauriCmd += ` --output=${outputFile}`;

        logger.info({ url, command: 'ghauri' }, 'Running Ghauri');

        const { stdout, stderr, exitCode } = await this.executeCommand(ghauriCmd, {
          timeout: timeout * 1000 + 60000,
        });

        // Parse Ghauri output
        try {
          const fs = require('fs');
          if (fs.existsSync(outputFile)) {
            const results = JSON.parse(fs.readFileSync(outputFile, 'utf8'));

            if (results.vulnerable) {
              vulnerabilities.push({
                url,
                parameter: results.parameter || 'unknown',
                technique: results.technique || 'unknown',
                dbms: results.dbms,
                dbVersion: results.version,
                payload: results.payload || '',
                evidence: results.evidence || stdout,
                severity: 'critical',
                confidence: 0.95,
                poc: this.generatePoc(url, results.parameter, results.payload),
              });
            }

            fs.unlinkSync(outputFile);
          }
        } catch (parseError: any) {
          logger.error({ error: parseError.message }, 'Failed to parse Ghauri results');
        }

        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      logger.info({ count: vulnerabilities.length }, 'Ghauri scan complete');
      return vulnerabilities;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Ghauri scan failed');
      return vulnerabilities;
    }
  }

  /**
   * Parse SQLMap output
   */
  private parseSqlmapOutput(stdout: string, stderr: string, url: string): SqliResult['vulnerabilities'] {
    const vulnerabilities: SqliResult['vulnerabilities'] = [];

    try {
      // Check for vulnerability indicators
      const isVulnerable = stdout.includes('is vulnerable') ||
                          stdout.includes('Parameter:') && stdout.includes('Type:') ||
                          stdout.includes('injectable');

      if (!isVulnerable) {
        return vulnerabilities;
      }

      // Extract parameter name
      const paramMatch = stdout.match(/Parameter: ([^\s]+)/);
      const parameter = paramMatch ? paramMatch[1] : 'unknown';

      // Extract technique/type
      const typeMatch = stdout.match(/Type: ([^\n]+)/);
      const technique = typeMatch ? typeMatch[1].trim() : 'unknown';

      // Extract DBMS
      const dbmsMatch = stdout.match(/back-end DBMS: ([^\n]+)/);
      const dbms = dbmsMatch ? dbmsMatch[1].trim() : undefined;

      // Extract payload
      const payloadMatch = stdout.match(/Payload: ([^\n]+)/);
      const payload = payloadMatch ? payloadMatch[1].trim() : '';

      vulnerabilities.push({
        url,
        parameter,
        technique,
        dbms,
        payload,
        evidence: stdout.substring(0, 500),
        severity: 'critical',
        confidence: 0.9,
        poc: this.generatePoc(url, parameter, payload),
      });

      logger.info({ url, parameter, technique }, 'SQLi vulnerability found');
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to parse SQLMap output');
    }

    return vulnerabilities;
  }

  /**
   * Extract database information from SQLMap output
   */
  private async extractDatabaseInfo(url: string, outputDir: string, jobId: string): Promise<any> {
    const dbInfo: any = {};

    try {
      const fs = require('fs');
      const path = require('path');

      // Look for log files
      if (fs.existsSync(outputDir)) {
        const files = fs.readdirSync(outputDir);

        for (const file of files) {
          if (file.endsWith('.log')) {
            const logPath = path.join(outputDir, file);
            const logContent = fs.readFileSync(logPath, 'utf8');

            // Extract current user
            const userMatch = logContent.match(/current user: '([^']+)'/);
            if (userMatch) dbInfo.currentUser = userMatch[1];

            // Extract current database
            const dbMatch = logContent.match(/current database: '([^']+)'/);
            if (dbMatch) dbInfo.currentDb = dbMatch[1];

            // Extract hostname
            const hostMatch = logContent.match(/hostname: '([^']+)'/);
            if (hostMatch) dbInfo.hostname = hostMatch[1];
          }
        }
      }

      return dbInfo;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to extract database info');
      return dbInfo;
    }
  }

  /**
   * Generate PoC for SQLi finding
   */
  private generatePoc(url: string, parameter: string, payload: string): string {
    if (!payload) return `curl -X GET "${url}"`;

    const separator = url.includes('?') ? '&' : '?';
    return `curl -X GET "${url}${separator}${parameter}=${encodeURIComponent(payload)}"`;
  }

  /**
   * Deduplicate findings by URL and parameter
   */
  private deduplicateFindings(vulnerabilities: SqliResult['vulnerabilities']): SqliResult['vulnerabilities'] {
    const seen = new Set<string>();
    const unique: SqliResult['vulnerabilities'] = [];

    for (const vuln of vulnerabilities) {
      const key = `${vuln.url}:${vuln.parameter}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(vuln);
      }
    }

    return unique;
  }

  /**
   * Save SQLi findings to database
   */
  private async saveSqliFindings(programId: string, vulnerabilities: SqliResult['vulnerabilities']): Promise<void> {
    try {
      for (const vuln of vulnerabilities) {
        // Check if finding already exists
        const existing = await database.query(
          `SELECT id FROM findings WHERE program_id = $1 AND title = $2 AND evidence->0->>'content' = $3`,
          [programId, 'SQL Injection Vulnerability', vuln.url]
        );

        if (existing.rows.length > 0) {
          logger.debug({ url: vuln.url }, 'SQLi finding already exists, skipping');
          continue;
        }

        const description = `SQL Injection vulnerability found at ${vuln.url} in parameter "${vuln.parameter}" using ${vuln.technique} technique.${vuln.dbms ? ` Database: ${vuln.dbms}` : ''}${vuln.databaseInfo?.currentUser ? ` Current user: ${vuln.databaseInfo.currentUser}` : ''}`;

        await database.query(
          `INSERT INTO findings (
            program_id, title, description, severity, confidence, status,
            evidence, poc, tags, cvss_score, cwe
          ) VALUES ($1, $2, $3, $4, $5, 'new', $6, $7, $8, $9, $10)`,
          [
            programId,
            'SQL Injection Vulnerability',
            description,
            vuln.severity,
            vuln.confidence,
            JSON.stringify([
              {
                type: 'request',
                content: vuln.url,
                metadata: {
                  parameter: vuln.parameter,
                  technique: vuln.technique,
                  dbms: vuln.dbms,
                },
              },
              {
                type: 'response',
                content: vuln.evidence,
              },
            ]),
            JSON.stringify({
              steps: [
                `Navigate to: ${vuln.url}`,
                `Inject payload in parameter: ${vuln.parameter}`,
                `Payload: ${vuln.payload}`,
                `Observe SQL injection execution`,
              ],
              curl: vuln.poc,
              payload: vuln.payload,
              reproductionRate: vuln.confidence,
              notes: vuln.databaseInfo ? `Database info: ${JSON.stringify(vuln.databaseInfo)}` : undefined,
            }),
            ['sqli', vuln.technique, vuln.parameter, vuln.dbms || 'unknown'].filter(Boolean),
            9.8, // CVSS score for SQLi
            ['CWE-89'], // SQL Injection CWE
          ]
        );

        // Emit finding event
        await events.emitFinding({
          programId,
          severity: vuln.severity,
          title: 'SQL Injection Vulnerability',
          url: vuln.url,
        } as any);
      }

      logger.info({ count: vulnerabilities.length, programId }, 'SQLi findings saved to database');
    } catch (error: any) {
      logger.error({ error: error.message, programId }, 'Failed to save SQLi findings');
    }
  }
}
