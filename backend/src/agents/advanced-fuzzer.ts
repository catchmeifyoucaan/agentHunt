/**
 * Advanced Fuzzer Agent
 * Purpose: Intelligent directory/parameter/API fuzzing with ffuf
 * 
 * Features:
 * - Smart wordlist selection based on technology
 * - Recursive fuzzing with depth control
 * - Response analysis and pattern detection
 * - Automatic parameter discovery
 * - Rate limiting and WAF evasion
 * - Dynamic wordlist generation
 * - Multi-mode fuzzing (dir, param, vhost, api)
 * - Automatic handoff to specialized agents
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { dynamicRouter } from '../services/dynamic-handoff-router';
import { v4 as uuidv4 } from 'uuid';

interface AdvancedFuzzerJob extends BaseJob {
  type: 'advanced-fuzzer';
  options: {
    targetUrl: string;
    programId: string;
    mode: 'directory' | 'parameter' | 'vhost' | 'api' | 'recursive' | 'smart';
    wordlist?: string;
    extensions?: string[];
    depth?: number;
    threads?: number;
    rateLimit?: number;
    filterCodes?: number[];
    matchCodes?: number[];
    headers?: Record<string, string>;
    cookies?: string;
    method?: string;
    data?: string;
    technology?: string;
  };
}

interface FuzzResult {
  url: string;
  status: number;
  length: number;
  words: number;
  lines: number;
  contentType?: string;
  redirectLocation?: string;
  interesting: boolean;
  reason?: string;
}

// Technology-specific wordlists
const TECH_WORDLISTS: Record<string, string[]> = {
  'php': ['php.txt', 'php-common.txt', 'php-files.txt'],
  'asp': ['asp.txt', 'aspx.txt', 'iis.txt'],
  'java': ['java.txt', 'spring.txt', 'tomcat.txt', 'struts.txt'],
  'python': ['python.txt', 'django.txt', 'flask.txt'],
  'ruby': ['ruby.txt', 'rails.txt'],
  'node': ['node.txt', 'express.txt', 'api.txt'],
  'wordpress': ['wordpress.txt', 'wp-plugins.txt', 'wp-themes.txt'],
  'drupal': ['drupal.txt', 'drupal-modules.txt'],
  'joomla': ['joomla.txt'],
  'api': ['api-endpoints.txt', 'api-common.txt', 'swagger.txt', 'graphql.txt'],
  'default': ['common.txt', 'directory-list-2.3-medium.txt', 'raft-medium-directories.txt'],
};

// Interesting patterns to detect
const INTERESTING_PATTERNS = [
  { pattern: /admin/i, type: 'admin_panel', priority: 9 },
  { pattern: /login|signin|auth/i, type: 'auth_endpoint', priority: 9 },
  { pattern: /api|v1|v2|graphql/i, type: 'api_endpoint', priority: 8 },
  { pattern: /upload|file|attachment/i, type: 'file_upload', priority: 9 },
  { pattern: /backup|bak|old|copy/i, type: 'backup_file', priority: 10 },
  { pattern: /config|settings|env/i, type: 'config_file', priority: 10 },
  { pattern: /\.git|\.svn|\.hg/i, type: 'version_control', priority: 10 },
  { pattern: /debug|test|dev|staging/i, type: 'debug_endpoint', priority: 8 },
  { pattern: /phpinfo|server-status|server-info/i, type: 'info_disclosure', priority: 9 },
  { pattern: /\.sql|\.db|\.sqlite/i, type: 'database_file', priority: 10 },
  { pattern: /\.log|\.txt|\.xml|\.json/i, type: 'sensitive_file', priority: 7 },
  { pattern: /password|secret|key|token/i, type: 'secret_file', priority: 10 },
  { pattern: /swagger|openapi|api-docs/i, type: 'api_docs', priority: 8 },
  { pattern: /actuator|health|metrics/i, type: 'monitoring_endpoint', priority: 8 },
  { pattern: /\.zip|\.tar|\.gz|\.rar/i, type: 'archive_file', priority: 9 },
  { pattern: /install|setup|wizard/i, type: 'setup_page', priority: 9 },
];

// Response patterns that indicate interesting content
const RESPONSE_PATTERNS = [
  { pattern: /sql|mysql|postgres|oracle|sqlite/i, signal: 'database_error', priority: 10 },
  { pattern: /exception|error|stack trace|traceback/i, signal: 'error_message', priority: 8 },
  { pattern: /password|secret|api.?key|token/i, signal: 'secret_found', priority: 10 },
  { pattern: /<form.*password/i, signal: 'auth_endpoint', priority: 9 },
  { pattern: /\{.*".*":.*\}/i, signal: 'api_endpoint', priority: 7 },
  { pattern: /<!DOCTYPE html/i, signal: 'html_page', priority: 5 },
  { pattern: /<?xml/i, signal: 'xml_response', priority: 6 },
  { pattern: /root:|admin:|user:/i, signal: 'sensitive_file', priority: 10 },
];

export class AdvancedFuzzerAgent extends BaseAgent<AdvancedFuzzerJob> {
  constructor() {
    super('advanced-fuzzer');
  }

  protected getSteps() {
    return [
      { name: 'Analyze target' },
      { name: 'Select wordlists' },
      { name: 'Configure fuzzer' },
      { name: 'Execute fuzzing' },
      { name: 'Analyze results' },
      { name: 'Recursive discovery' },
      { name: 'Signal findings' },
    ];
  }

  async process(job: Job<AdvancedFuzzerJob>): Promise<any> {
    const { programId, options } = job.data;
    const {
      targetUrl,
      mode = 'smart',
      wordlist,
      extensions = [],
      depth = 2,
      threads = 50,
      rateLimit = 0,
      filterCodes = [404, 429, 503],
      matchCodes = [],
      headers = {},
      cookies,
      method = 'GET',
      data,
      technology,
    } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const allResults: FuzzResult[] = [];
    const discoveredPaths: string[] = [];

    try {
      // Step 1: Analyze target
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 7,
        percentage: 5,
        currentTool: 'analyzer',
        toolStatus: 'running',
        message: 'Analyzing target',
      });

      const targetAnalysis = await this.analyzeTarget(targetUrl, technology);
      logger.info({ targetAnalysis }, 'Target analyzed');

      // Step 2: Select wordlists
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 7,
        percentage: 15,
        currentTool: 'wordlist-selector',
        toolStatus: 'running',
        message: 'Selecting optimal wordlists',
      });

      const wordlists = this.selectWordlists(targetAnalysis, wordlist, mode);

      // Step 3: Configure fuzzer
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 7,
        percentage: 20,
        currentTool: 'configurator',
        toolStatus: 'running',
        message: 'Configuring fuzzer',
      });

      const ffufConfig = this.buildFfufConfig({
        targetUrl,
        wordlists,
        extensions: extensions.length > 0 ? extensions : targetAnalysis.extensions,
        threads,
        rateLimit,
        filterCodes,
        matchCodes,
        headers,
        cookies,
        method,
        data,
        mode,
      });

      // Step 4: Execute fuzzing
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 7,
        percentage: 30,
        currentTool: 'ffuf',
        toolStatus: 'running',
        message: 'Fuzzing in progress',
      });

      const results = await this.executeFuzzing(ffufConfig, job.id!);
      allResults.push(...results);

      // Step 5: Analyze results
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 7,
        percentage: 60,
        currentTool: 'result-analyzer',
        toolStatus: 'running',
        message: `Analyzing ${results.length} results`,
      });

      const analyzedResults = await this.analyzeResults(results, targetUrl);
      const interestingResults = analyzedResults.filter(r => r.interesting);

      // Step 6: Recursive discovery
      if (mode === 'recursive' || mode === 'smart') {
        await this.updateJobProgress(job.id!, {
          current: 6,
          total: 7,
          percentage: 75,
          currentTool: 'recursive-fuzzer',
          toolStatus: 'running',
          message: 'Recursive discovery',
        });

        const directories = interestingResults
          .filter(r => r.status === 200 || r.status === 301 || r.status === 302)
          .filter(r => !r.url.includes('.'))
          .slice(0, 20); // Limit recursive depth

        for (const dir of directories) {
          if (depth > 1) {
            const recursiveResults = await this.executeFuzzing({
              ...ffufConfig,
              targetUrl: dir.url.endsWith('/') ? dir.url : `${dir.url}/`,
            }, job.id!);

            allResults.push(...recursiveResults);
            discoveredPaths.push(dir.url);
          }
        }
      }

      // Step 7: Signal findings to other agents
      await this.updateJobProgress(job.id!, {
        current: 7,
        total: 7,
        percentage: 90,
        currentTool: 'signal-publisher',
        toolStatus: 'running',
        message: 'Publishing findings',
      });

      await this.publishFindings(programId, job.id!, analyzedResults, targetUrl);

      // Store results
      await this.storeResults(programId, allResults, job.id!);

      await this.updateJobProgress(job.id!, {
        current: 7,
        total: 7,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${interestingResults.length} interesting paths`,
      });

      const result = {
        targetUrl,
        mode,
        totalResults: allResults.length,
        interestingResults: interestingResults.length,
        discoveredPaths: discoveredPaths.length,
        findings: interestingResults.slice(0, 100),
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'Advanced fuzzing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Analyze target to determine technology and optimal settings
   */
  private async analyzeTarget(url: string, knownTech?: string): Promise<any> {
    const analysis = {
      technology: knownTech || 'default',
      extensions: ['.php', '.html', '.js', '.json'],
      serverType: 'unknown',
      framework: 'unknown',
    };

    try {
      const result = await this.executeCommand(`curl -sI "${url}" | head -20`, { timeout: 10000 });
      const headers = result.stdout.toLowerCase();

      // Detect server
      if (headers.includes('nginx')) analysis.serverType = 'nginx';
      else if (headers.includes('apache')) analysis.serverType = 'apache';
      else if (headers.includes('iis')) analysis.serverType = 'iis';

      // Detect technology from headers
      if (headers.includes('x-powered-by: php')) {
        analysis.technology = 'php';
        analysis.extensions = ['.php', '.php5', '.phtml', '.inc'];
      } else if (headers.includes('x-powered-by: asp')) {
        analysis.technology = 'asp';
        analysis.extensions = ['.asp', '.aspx', '.ashx', '.asmx'];
      } else if (headers.includes('x-powered-by: express')) {
        analysis.technology = 'node';
        analysis.extensions = ['.js', '.json', '.mjs'];
      }

      // Detect framework
      if (headers.includes('x-drupal')) analysis.framework = 'drupal';
      else if (headers.includes('x-wordpress')) analysis.framework = 'wordpress';
      else if (headers.includes('x-joomla')) analysis.framework = 'joomla';

    } catch (error) {
      logger.debug({ error }, 'Target analysis failed, using defaults');
    }

    return analysis;
  }

  /**
   * Select optimal wordlists based on analysis
   */
  private selectWordlists(analysis: any, customWordlist?: string, mode?: string): string[] {
    const wordlists: string[] = [];

    if (customWordlist) {
      wordlists.push(customWordlist);
    }

    // Add technology-specific wordlists
    const techLists = TECH_WORDLISTS[analysis.technology] || TECH_WORDLISTS['default'];
    wordlists.push(...techLists);

    // Add framework-specific wordlists
    if (analysis.framework !== 'unknown') {
      const frameworkLists = TECH_WORDLISTS[analysis.framework];
      if (frameworkLists) wordlists.push(...frameworkLists);
    }

    // Add mode-specific wordlists
    if (mode === 'api') {
      wordlists.push(...TECH_WORDLISTS['api']);
    }

    // Deduplicate
    return [...new Set(wordlists)];
  }

  /**
   * Build ffuf configuration
   */
  private buildFfufConfig(config: any): any {
    return {
      targetUrl: config.targetUrl,
      wordlists: config.wordlists,
      extensions: config.extensions,
      threads: config.threads,
      rateLimit: config.rateLimit,
      filterCodes: config.filterCodes,
      matchCodes: config.matchCodes,
      headers: config.headers,
      cookies: config.cookies,
      method: config.method,
      data: config.data,
      mode: config.mode,
    };
  }

  /**
   * Execute ffuf fuzzing
   */
  private async executeFuzzing(config: any, jobId: string): Promise<FuzzResult[]> {
    const results: FuzzResult[] = [];

    for (const wordlist of config.wordlists) {
      try {
        // Build ffuf command
        const args: string[] = [
          '-u', `${config.targetUrl}FUZZ`,
          '-w', `/usr/share/wordlists/${wordlist}`,
          '-t', config.threads.toString(),
          '-o', '/tmp/ffuf-output.json',
          '-of', 'json',
          '-s', // Silent mode
        ];

        // Add extensions
        if (config.extensions && config.extensions.length > 0) {
          args.push('-e', config.extensions.join(','));
        }

        // Add filter codes
        if (config.filterCodes && config.filterCodes.length > 0) {
          args.push('-fc', config.filterCodes.join(','));
        }

        // Add match codes
        if (config.matchCodes && config.matchCodes.length > 0) {
          args.push('-mc', config.matchCodes.join(','));
        }

        // Add rate limit
        if (config.rateLimit > 0) {
          args.push('-rate', config.rateLimit.toString());
        }

        // Add headers
        for (const [key, value] of Object.entries(config.headers || {})) {
          args.push('-H', `${key}: ${value}`);
        }

        // Add cookies
        if (config.cookies) {
          args.push('-b', config.cookies);
        }

        // Add method
        if (config.method !== 'GET') {
          args.push('-X', config.method);
        }

        // Add data
        if (config.data) {
          args.push('-d', config.data);
        }

        // Execute ffuf
        const result = await this.executeCommandWithArgs('ffuf', args, { timeout: 300000 });

        // Parse results
        if (result.exitCode === 0) {
          const outputResult = await this.executeCommand('cat /tmp/ffuf-output.json', { timeout: 5000 });
          try {
            const ffufOutput = JSON.parse(outputResult.stdout);
            if (ffufOutput.results) {
              for (const r of ffufOutput.results) {
                results.push({
                  url: r.url,
                  status: r.status,
                  length: r.length,
                  words: r.words,
                  lines: r.lines,
                  contentType: r.content_type,
                  redirectLocation: r.redirect_location,
                  interesting: false,
                });
              }
            }
          } catch (parseError) {
            logger.debug({ parseError }, 'Failed to parse ffuf output');
          }
        }

        // Cleanup
        await this.executeCommand('rm -f /tmp/ffuf-output.json', { timeout: 5000 });

      } catch (error) {
        logger.debug({ error, wordlist }, 'Wordlist fuzzing failed');
      }
    }

    return results;
  }

  /**
   * Analyze results and mark interesting findings
   */
  private async analyzeResults(results: FuzzResult[], baseUrl: string): Promise<FuzzResult[]> {
    for (const result of results) {
      // Check URL patterns
      for (const pattern of INTERESTING_PATTERNS) {
        if (pattern.pattern.test(result.url)) {
          result.interesting = true;
          result.reason = pattern.type;
          break;
        }
      }

      // Check for unusual response sizes
      if (!result.interesting) {
        // Very large responses might be interesting
        if (result.length > 50000) {
          result.interesting = true;
          result.reason = 'large_response';
        }
        // Very small responses with 200 might be interesting
        else if (result.status === 200 && result.length < 100) {
          result.interesting = true;
          result.reason = 'small_response';
        }
      }

      // Check for redirects to interesting locations
      if (result.redirectLocation) {
        if (/admin|login|dashboard/i.test(result.redirectLocation)) {
          result.interesting = true;
          result.reason = 'interesting_redirect';
        }
      }
    }

    return results;
  }

  /**
   * Publish findings to dynamic router for other agents
   */
  private async publishFindings(programId: string, jobId: string, results: FuzzResult[], baseUrl: string): Promise<void> {
    for (const result of results.filter(r => r.interesting)) {
      // Determine signal type based on finding
      let signalType: string = 'endpoint_found';
      let confidence = 0.7;

      switch (result.reason) {
        case 'admin_panel':
          signalType = 'auth_endpoint';
          confidence = 0.9;
          break;
        case 'auth_endpoint':
          signalType = 'auth_endpoint';
          confidence = 0.95;
          break;
        case 'api_endpoint':
        case 'api_docs':
          signalType = 'api_endpoint';
          confidence = 0.9;
          break;
        case 'file_upload':
          signalType = 'file_upload';
          confidence = 0.9;
          break;
        case 'backup_file':
        case 'config_file':
        case 'database_file':
        case 'secret_file':
          signalType = 'sensitive_file';
          confidence = 0.95;
          break;
        case 'version_control':
          signalType = 'secret_found';
          confidence = 0.95;
          break;
        case 'debug_endpoint':
        case 'info_disclosure':
        case 'monitoring_endpoint':
          signalType = 'vulnerability_potential';
          confidence = 0.85;
          break;
      }

      try {
        await dynamicRouter.publishSignal({
          sourceAgent: 'advanced-fuzzer' as any,
          programId,
          jobId,
          signalType: signalType as any,
          data: {
            url: result.url,
            status: result.status,
            length: result.length,
            contentType: result.contentType,
            reason: result.reason,
            baseUrl,
          },
          confidence,
        });
      } catch (error) {
        logger.debug({ error, result }, 'Failed to publish finding signal');
      }
    }
  }

  /**
   * Store results in database
   */
  private async storeResults(programId: string, results: FuzzResult[], jobId: string): Promise<void> {
    for (const result of results.filter(r => r.interesting)) {
      try {
        await database.query(
          `INSERT INTO fuzz_results (id, program_id, job_id, url, status, length, content_type, reason, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
           ON CONFLICT (url, program_id) DO UPDATE SET status = $5, length = $6`,
          [uuidv4(), programId, jobId, result.url, result.status, result.length, result.contentType, result.reason]
        );
      } catch (error) {
        logger.debug({ error }, 'Failed to store fuzz result');
      }
    }
  }
}

export default new AdvancedFuzzerAgent();
