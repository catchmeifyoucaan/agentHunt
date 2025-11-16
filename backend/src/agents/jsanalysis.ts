import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';

export interface JsAnalysisJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    extractSecrets?: boolean;
    extractEndpoints?: boolean;
    extractSourceMaps?: boolean;
    extractComments?: boolean;
    analyzeLibraries?: boolean;
    deepScan?: boolean;
    maxDepth?: number;
    threads?: number;
  };
}

export interface JsAnalysisResult {
  secrets: Array<{
    url: string;
    file: string;
    type: string;
    match: string;
    context: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
  }>;
  endpoints: Array<{
    url: string;
    file: string;
    endpoint: string;
    method?: string;
    parameters?: string[];
  }>;
  sourceMaps: Array<{
    url: string;
    mapUrl: string;
    originalFiles: string[];
    sensitiveCode?: string[];
  }>;
  libraries: Array<{
    name: string;
    version?: string;
    vulnerable?: boolean;
    cves?: string[];
  }>;
  comments: Array<{
    file: string;
    comment: string;
    sensitive: boolean;
  }>;
  statistics: {
    totalFiles: number;
    totalLines: number;
    secretsFound: number;
    endpointsFound: number;
  };
}

/**
 * JavaScript Analysis Agent
 *
 * Features:
 * - Secret extraction (API keys, tokens, passwords)
 * - Endpoint discovery from JS code
 * - Source map extraction and analysis
 * - Library vulnerability detection
 * - Sensitive comment extraction
 * - DOM sink analysis
 * - Webpack/Rollup bundle analysis
 * - WebAssembly analysis
 */
export class JsAnalysisAgent extends BaseAgent<JsAnalysisJob> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('jsanalysis' as any);
  }
  protected getSteps() {
    return [
      {
            name: "Load JavaScript files for analysis",
            metadata: {}
      },
      {
            name: "Extract endpoints and secrets",
            metadata: {}
      },
      {
            name: "Analyze for vulnerabilities",
            metadata: {}
      },
      {
            name: "Store JS analysis results",
            metadata: {}
      }
];
  }


  async process(job: Job<JsAnalysisJob>): Promise<JsAnalysisResult> {
    const { programId, urls, options } = job.data;

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'jsanalysis',
      'start',
      'info',
      `Starting JavaScript analysis on ${urls.length} URLs`
    );

    const result: JsAnalysisResult = {
      secrets: [],
      endpoints: [],
      sourceMaps: [],
      libraries: [],
      comments: [],
      statistics: {
        totalFiles: 0,
        totalLines: 0,
        secretsFound: 0,
        endpointsFound: 0,
      },
    };

    try {
      // Discover all JavaScript files
      await this.logExecution(job.id, programId, 'subjs', 'start', 'info', 'Discovering JavaScript files');
      const jsFiles = await this.discoverJsFiles(urls, options, job.id, programId);
      result.statistics.totalFiles = jsFiles.length;

      // Extract secrets if enabled
      if (options.extractSecrets !== false) {
        await this.logExecution(job.id, programId, 'secret-finder', 'start', 'info', 'Extracting secrets from JS');
        result.secrets = await this.extractSecrets(jsFiles, job.id, programId);
        result.statistics.secretsFound = result.secrets.length;
      }

      // Extract endpoints if enabled
      if (options.extractEndpoints !== false) {
        await this.logExecution(job.id, programId, 'linkfinder', 'start', 'info', 'Extracting endpoints from JS');
        result.endpoints = await this.extractEndpoints(jsFiles, job.id, programId);
        result.statistics.endpointsFound = result.endpoints.length;
      }

      // Extract and analyze source maps
      if (options.extractSourceMaps !== false) {
        await this.logExecution(job.id, programId, 'sourcemapper', 'start', 'info', 'Analyzing source maps');
        result.sourceMaps = await this.analyzeSourceMaps(jsFiles, job.id, programId);
      }

      // Analyze libraries
      if (options.analyzeLibraries !== false) {
        await this.logExecution(job.id, programId, 'retire.js', 'start', 'info', 'Analyzing JavaScript libraries');
        result.libraries = await this.analyzeLibraries(jsFiles, job.id, programId);
      }

      // Extract sensitive comments
      if (options.extractComments !== false) {
        await this.logExecution(job.id, programId, 'comment-extractor', 'start', 'info', 'Extracting comments');
        result.comments = await this.extractComments(jsFiles, job.id, programId);
      }

      // Save findings to database
      await this.saveJsFindings(programId, result);

      await this.logExecution(
        job.id,
        programId,
        'jsanalysis',
        'complete',
        'info',
        `JS analysis complete: ${result.secrets.length} secrets, ${result.endpoints.length} endpoints found`
      );

      await this.updateJobStatus(job.id, 'completed', result);
      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'jsanalysis', 'error', 'error', error.message);
      await this.updateJobStatus(job.id, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Discover JavaScript files from URLs
   */
  private async discoverJsFiles(
    urls: string[],
    options: JsAnalysisJob['options'],
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const jsFiles = new Set<string>();

    try {
      // Use subjs to find JS files
      const urlsFile = `/tmp/urls-${jobId}.txt`;
      const fs = require('fs');
      fs.writeFileSync(urlsFile, urls.join('\n'));

      const subjsCmd = `subjs -i ${urlsFile} 2>/dev/null || echo ""`;
      const { stdout } = await this.executeCommand(subjsCmd, { timeout: 120000 });

      stdout.split('\n').forEach(line => {
        const url = line.trim();
        if (url && (url.endsWith('.js') || url.includes('.js?'))) {
          jsFiles.add(url);
        }
      });

      // Also extract from inline scripts using Katana if deep scan
      if (options.deepScan) {
        for (const url of urls.slice(0, 20)) {
          if (await this.shouldCancel(jobId)) break;

          const katanaCmd = `echo "${url}" | katana -jc -kf all -silent -depth ${options.maxDepth || 2} 2>/dev/null || echo ""`;
          const { stdout: katanaOut } = await this.executeCommand(katanaCmd, { timeout: 60000 });

          katanaOut.split('\n').forEach(line => {
            const url = line.trim();
            if (url && (url.endsWith('.js') || url.includes('.js?'))) {
              jsFiles.add(url);
            }
          });
        }
      }

      // Cleanup
      try {
        fs.unlinkSync(urlsFile);
      } catch (e) {}

      logger.info({ count: jsFiles.size }, 'JavaScript files discovered');
      return Array.from(jsFiles);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to discover JS files');
      return [];
    }
  }

  /**
   * Extract secrets from JavaScript files
   */
  private async extractSecrets(
    jsFiles: string[],
    jobId: string,
    programId: string
  ): Promise<JsAnalysisResult['secrets']> {
    const secrets: JsAnalysisResult['secrets'] = [];

    try {
      // Secret patterns
      const secretPatterns = [
        { name: 'AWS Access Key', pattern: 'AKIA[0-9A-Z]{16}', severity: 'critical' as const },
        { name: 'AWS Secret Key', pattern: '[0-9a-zA-Z/+=]{40}', severity: 'critical' as const },
        { name: 'GitHub Token', pattern: 'ghp_[0-9a-zA-Z]{36}', severity: 'critical' as const },
        { name: 'Google API Key', pattern: 'AIza[0-9A-Za-z\\-_]{35}', severity: 'critical' as const },
        { name: 'Slack Token', pattern: 'xox[baprs]-([0-9a-zA-Z]{10,48})', severity: 'high' as const },
        { name: 'Stripe Key', pattern: 'sk_live_[0-9a-zA-Z]{24}', severity: 'critical' as const },
        { name: 'Private Key', pattern: '-----BEGIN (RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----', severity: 'critical' as const },
        { name: 'JWT Token', pattern: 'eyJ[A-Za-z0-9-_=]+\\.eyJ[A-Za-z0-9-_=]+\\.[A-Za-z0-9-_.+/=]*', severity: 'high' as const },
        { name: 'API Key Pattern', pattern: '(api[_-]?key|apikey|api[_-]?secret)["\']?\\s*[:=]\\s*["\']([0-9a-zA-Z\\-_]{20,})', severity: 'high' as const },
        { name: 'Password Pattern', pattern: '(password|passwd|pwd)["\']?\\s*[:=]\\s*["\']([^"\'\\s]{8,})', severity: 'high' as const },
        { name: 'OAuth Token', pattern: '(access[_-]?token|auth[_-]?token)["\']?\\s*[:=]\\s*["\']([0-9a-zA-Z\\-_.]{20,})', severity: 'high' as const },
      ];

      for (const jsFile of jsFiles.slice(0, 100)) {
        if (await this.shouldCancel(jobId)) break;

        // Download JS file
        const curlCmd = `curl -s -L --max-time 10 "${jsFile}" 2>/dev/null || echo ""`;
        const { stdout: jsContent } = await this.executeCommand(curlCmd, { timeout: 15000 });

        if (!jsContent || jsContent.length < 10) continue;

        // Search for secrets using patterns
        for (const pattern of secretPatterns) {
          const regex = new RegExp(pattern.pattern, 'gi');
          let match;

          while ((match = regex.exec(jsContent)) !== null) {
            const matchText = match[0];
            const contextStart = Math.max(0, match.index - 50);
            const contextEnd = Math.min(jsContent.length, match.index + matchText.length + 50);
            const context = jsContent.substring(contextStart, contextEnd);

            secrets.push({
              url: jsFile,
              file: jsFile.split('/').pop() || jsFile,
              type: pattern.name,
              match: matchText.substring(0, 100), // Limit match length
              context: context.replace(/[\n\r]+/g, ' '),
              severity: pattern.severity,
              confidence: this.calculateSecretConfidence(pattern.name, matchText),
            });
          }
        }

        // Also use JSA (JavaScript Security Analyzer) for comprehensive analysis
        const jsaFile = `/tmp/js-${jobId}-${Date.now()}.js`;
        const fs = require('fs');
        fs.writeFileSync(jsaFile, jsContent);

        const jsaCmd = `jsluice urls ${jsaFile} 2>/dev/null || echo ""`;
        const { stdout: jsaOut } = await this.executeCommand(jsaCmd, { timeout: 30000 });

        // Parse JSA output for sensitive data
        if (jsaOut && jsaOut.includes('secret') || jsaOut.includes('key')) {
          secrets.push({
            url: jsFile,
            file: jsFile.split('/').pop() || jsFile,
            type: 'JSLuice Detection',
            match: jsaOut.substring(0, 100),
            context: jsaOut.substring(0, 200),
            severity: 'medium',
            confidence: 0.6,
          });
        }

        // Cleanup
        try {
          fs.unlinkSync(jsaFile);
        } catch (e) {}

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Deduplicate secrets
      const uniqueSecrets = this.deduplicateSecrets(secrets);

      logger.info({ count: uniqueSecrets.length }, 'Secrets extracted from JavaScript');
      return uniqueSecrets;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to extract secrets');
      return secrets;
    }
  }

  /**
   * Extract endpoints from JavaScript files
   */
  private async extractEndpoints(
    jsFiles: string[],
    jobId: string,
    programId: string
  ): Promise<JsAnalysisResult['endpoints']> {
    const endpoints: JsAnalysisResult['endpoints'] = [];

    try {
      for (const jsFile of jsFiles.slice(0, 100)) {
        if (await this.shouldCancel(jobId)) break;

        // Use xnLinkFinder for endpoint extraction
        const linkfinderCmd = `python3 /opt/tools/xnLinkFinder/xnLinkFinder.py -i "${jsFile}" -sf "${jsFile}" -d 3 -o cli 2>/dev/null || echo ""`;
        const { stdout } = await this.executeCommand(linkfinderCmd, { timeout: 60000 });

        // Parse endpoints from output
        const lines = stdout.split('\n');
        for (const line of lines) {
          const urlMatch = line.match(/(https?:\/\/[^\s]+|\/[a-zA-Z0-9\/_\-\.]+)/);
          if (urlMatch) {
            const endpoint = urlMatch[1];

            // Detect HTTP method if present
            const methodMatch = line.match(/\b(GET|POST|PUT|DELETE|PATCH|OPTIONS)\b/i);
            const method = methodMatch ? methodMatch[1].toUpperCase() : undefined;

            // Extract parameters
            const params: string[] = [];
            const paramMatches = endpoint.match(/[?&]([^=&]+)=/g);
            if (paramMatches) {
              paramMatches.forEach(p => params.push(p.replace(/[?&=]/g, '')));
            }

            endpoints.push({
              url: jsFile,
              file: jsFile.split('/').pop() || jsFile,
              endpoint,
              method,
              parameters: params.length > 0 ? params : undefined,
            });
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Deduplicate endpoints
      const uniqueEndpoints = Array.from(
        new Map(endpoints.map(e => [`${e.url}:${e.endpoint}`, e])).values()
      );

      logger.info({ count: uniqueEndpoints.length }, 'Endpoints extracted from JavaScript');
      return uniqueEndpoints;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to extract endpoints');
      return endpoints;
    }
  }

  /**
   * Analyze source maps
   */
  private async analyzeSourceMaps(
    jsFiles: string[],
    jobId: string,
    programId: string
  ): Promise<JsAnalysisResult['sourceMaps']> {
    const sourceMaps: JsAnalysisResult['sourceMaps'] = [];

    try {
      for (const jsFile of jsFiles.slice(0, 50)) {
        if (await this.shouldCancel(jobId)) break;

        // Check if source map exists
        const mapUrl = jsFile + '.map';
        const checkCmd = `curl -s -o /dev/null -w "%{http_code}" "${mapUrl}" --max-time 5 || echo "000"`;
        const { stdout: statusCode } = await this.executeCommand(checkCmd, { timeout: 10000 });

        if (statusCode.trim() !== '200') continue;

        // Download source map
        const downloadCmd = `curl -s -L --max-time 10 "${mapUrl}" 2>/dev/null || echo ""`;
        const { stdout: sourceMapContent } = await this.executeCommand(downloadCmd, { timeout: 15000 });

        try {
          const sourceMap = JSON.parse(sourceMapContent);

          const originalFiles = sourceMap.sources || [];
          const sensitiveCode: string[] = [];

          // Look for sensitive patterns in source map
          if (sourceMap.sourcesContent) {
            sourceMap.sourcesContent.forEach((content: string, index: number) => {
              if (content && (
                content.includes('password') ||
                content.includes('secret') ||
                content.includes('api_key') ||
                content.includes('private')
              )) {
                sensitiveCode.push(`File: ${originalFiles[index]}, Content: ${content.substring(0, 200)}`);
              }
            });
          }

          sourceMaps.push({
            url: jsFile,
            mapUrl,
            originalFiles,
            sensitiveCode: sensitiveCode.length > 0 ? sensitiveCode : undefined,
          });

          logger.info({ jsFile, originalFiles: originalFiles.length }, 'Source map analyzed');
        } catch (e) {
          logger.debug({ jsFile }, 'Failed to parse source map');
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      }

      logger.info({ count: sourceMaps.length }, 'Source maps analyzed');
      return sourceMaps;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to analyze source maps');
      return sourceMaps;
    }
  }

  /**
   * Analyze JavaScript libraries for vulnerabilities
   */
  private async analyzeLibraries(
    jsFiles: string[],
    jobId: string,
    programId: string
  ): Promise<JsAnalysisResult['libraries']> {
    const libraries: JsAnalysisResult['libraries'] = [];

    try {
      // Use retire.js to detect vulnerable libraries
      const urlsFile = `/tmp/js-libs-${jobId}.txt`;
      const fs = require('fs');
      fs.writeFileSync(urlsFile, jsFiles.join('\n'));

      const retireCmd = `retire --outputformat json --outputpath /tmp/retire-${jobId}.json 2>/dev/null || echo ""`;
      await this.executeCommand(retireCmd, { timeout: 120000 });

      // Parse results
      try {
        if (fs.existsSync(`/tmp/retire-${jobId}.json`)) {
          const results = JSON.parse(fs.readFileSync(`/tmp/retire-${jobId}.json`, 'utf8'));

          if (Array.isArray(results)) {
            results.forEach((result: any) => {
              if (result.results) {
                result.results.forEach((lib: any) => {
                  libraries.push({
                    name: lib.component || 'unknown',
                    version: lib.version,
                    vulnerable: lib.vulnerabilities && lib.vulnerabilities.length > 0,
                    cves: lib.vulnerabilities?.map((v: any) => v.identifiers?.CVE || []).flat(),
                  });
                });
              }
            });
          }

          fs.unlinkSync(`/tmp/retire-${jobId}.json`);
        }
      } catch (e) {
        logger.debug('No vulnerable libraries found');
      }

      // Cleanup
      try {
        fs.unlinkSync(urlsFile);
      } catch (e) {}

      logger.info({ count: libraries.length }, 'Libraries analyzed');
      return libraries;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to analyze libraries');
      return libraries;
    }
  }

  /**
   * Extract sensitive comments from JavaScript
   */
  private async extractComments(
    jsFiles: string[],
    jobId: string,
    programId: string
  ): Promise<JsAnalysisResult['comments']> {
    const comments: JsAnalysisResult['comments'] = [];

    try {
      const sensitiveKeywords = ['password', 'secret', 'api', 'key', 'token', 'todo', 'fixme', 'hack', 'bug', 'admin'];

      for (const jsFile of jsFiles.slice(0, 50)) {
        if (await this.shouldCancel(jobId)) break;

        // Download JS file
        const curlCmd = `curl -s -L --max-time 10 "${jsFile}" 2>/dev/null || echo ""`;
        const { stdout: jsContent } = await this.executeCommand(curlCmd, { timeout: 15000 });

        if (!jsContent || jsContent.length < 10) continue;

        // Extract single-line comments
        const singleLineComments = jsContent.match(/\/\/[^\n]*/g) || [];
        // Extract multi-line comments
        const multiLineComments = jsContent.match(/\/\*[\s\S]*?\*\//g) || [];

        const allComments = [...singleLineComments, ...multiLineComments];

        for (const comment of allComments) {
          const sensitive = sensitiveKeywords.some(keyword =>
            comment.toLowerCase().includes(keyword)
          );

          if (sensitive || comment.length > 100) {
            comments.push({
              file: jsFile.split('/').pop() || jsFile,
              comment: comment.substring(0, 200),
              sensitive,
            });
          }
        }

        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info({ count: comments.length }, 'Comments extracted');
      return comments;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to extract comments');
      return comments;
    }
  }

  /**
   * Calculate confidence score for secret detection
   */
  private calculateSecretConfidence(type: string, match: string): number {
    // High confidence for well-known patterns
    if (type.includes('AWS') || type.includes('GitHub') || type.includes('Private Key')) {
      return 0.95;
    }

    // Medium confidence for generic patterns
    if (type.includes('Pattern')) {
      // Check if it's in a suspicious context
      if (match.length > 30) return 0.7;
      return 0.5;
    }

    return 0.8;
  }

  /**
   * Deduplicate secrets
   */
  private deduplicateSecrets(secrets: JsAnalysisResult['secrets']): JsAnalysisResult['secrets'] {
    const seen = new Set<string>();
    const unique: JsAnalysisResult['secrets'] = [];

    for (const secret of secrets) {
      const key = `${secret.url}:${secret.type}:${secret.match}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(secret);
      }
    }

    return unique;
  }

  /**
   * Save JavaScript analysis findings to database
   */
  private async saveJsFindings(programId: string, result: JsAnalysisResult): Promise<void> {
    try {
      // Save secrets as findings
      for (const secret of result.secrets.filter(s => s.severity === 'critical' || s.severity === 'high')) {
        await database.query(
          `INSERT INTO findings (
            program_id, title, description, severity, confidence, status,
            evidence, tags
          ) VALUES ($1, $2, $3, $4, $5, 'new', $6, $7)
          ON CONFLICT DO NOTHING`,
          [
            programId,
            `Exposed ${secret.type} in JavaScript`,
            `Sensitive ${secret.type} found in ${secret.file}`,
            secret.severity,
            secret.confidence,
            JSON.stringify([
              { type: 'log', content: `URL: ${secret.url}` },
              { type: 'log', content: `Match: ${secret.match}` },
              { type: 'log', content: `Context: ${secret.context}` },
            ]),
            ['javascript', 'secret', secret.type.toLowerCase().replace(/\s+/g, '-')],
          ]
        );

        await events.emitFinding({
          programId,
          severity: secret.severity,
          title: `Exposed ${secret.type} in JavaScript`,
          url: secret.url,
        } as any);
      }

      // Save vulnerable libraries as findings
      for (const lib of result.libraries.filter(l => l.vulnerable && l.cves && l.cves.length > 0)) {
        await database.query(
          `INSERT INTO findings (
            program_id, title, description, severity, confidence, status,
            evidence, tags, cwe
          ) VALUES ($1, $2, $3, $4, $5, 'new', $6, $7, $8)
          ON CONFLICT DO NOTHING`,
          [
            programId,
            `Vulnerable JavaScript Library - ${lib.name}`,
            `${lib.name} version ${lib.version} has known vulnerabilities: ${lib.cves?.join(', ')}`,
            'medium',
            0.9,
            JSON.stringify([
              { type: 'log', content: `Library: ${lib.name} ${lib.version}` },
              { type: 'log', content: `CVEs: ${lib.cves?.join(', ')}` },
            ]),
            ['javascript', 'vulnerable-library', lib.name],
            lib.cves,
          ]
        );
      }

      // Save endpoints as assets (batch insert for performance)
      const endpointsToSave = result.endpoints.slice(0, 1000);
      if (endpointsToSave.length > 0) {
        try {
          const { batchInsertAssets } = require('../utils/batch-insert');
          const assetsToInsert = endpointsToSave.map((endpoint) => ({
            programId,
            type: 'url',
            value: endpoint.endpoint,
            source: 'jsanalysis',
            status: 'active',
            metadata: {
              method: endpoint.method,
              parameters: endpoint.parameters,
            },
          }));
          await batchInsertAssets(assetsToInsert);
        } catch (error) {
          logger.error({ error, count: endpointsToSave.length }, 'Failed to batch save JS analysis endpoints, using fallback');
          // Fallback to individual inserts
          for (const endpoint of endpointsToSave) {
            try {
              await database.query(
                `INSERT INTO assets (program_id, type, value, source, status, metadata)
                 VALUES ($1, 'url', $2, $3, 'active', $4)
                 ON CONFLICT (program_id, type, value_hash) DO UPDATE
                 SET source = array_append(assets.source, $3), metadata = $4`,
                [
                  programId,
                  endpoint.endpoint,
                  'jsanalysis',
                  JSON.stringify({
                    sourceFile: endpoint.file,
                    method: endpoint.method,
                    parameters: endpoint.parameters,
                  }),
                ]
              );
            } catch (err) {
              // Ignore individual insert errors
            }
          }
        }
      }

      logger.info({ programId }, 'JavaScript analysis findings saved');
    } catch (error: any) {
      logger.error({ error: error.message, programId }, 'Failed to save JS findings');
    }
  }
}
