import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';

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

      // 🚀 THREE-AGENT INTEGRATION
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && result.secrets.length > 0) {
        try {
          const jsFindings = result.secrets.map((secret: any) => ({
            id: uuidv4(),
            type: 'js-secret',
            severity: 'high' as const,
            url: secret.url || 'unknown',
            evidence: `Secret found: ${secret.type}`,
            confidence: 0.85,
            timestamp: new Date(),
            discoveredBy: `jsanalysis-${job.id}`,
            metadata: { secretType: secret.type, pattern: secret.pattern, endpoints: result.endpoints.length },
          }));
          await sharedMemory.storeFindings(swarmId, jsFindings);
          await sharedMemory.shareSuccess(swarmId, {
            id: uuidv4(),
            name: 'js-secrets',
            description: `Found ${result.secrets.length} secrets in JS`,
            successRate: 0.85,
            metadata: { secrets: result.secrets.length, endpoints: result.endpoints.length },
          });
          logger.info({ swarmId, secretsShared: jsFindings.length }, 'JSAnalysis shared findings');
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share JS findings');
        }
      }

      // 🚀 RICH HANDOFFS: Jsanalysis → XSS/Scanner for discovered attack surface
      // Extract DOM sinks that could lead to XSS
      const domSinks = this.extractDomSinks(result);
      const apiEndpoints = result.endpoints.filter(e =>
        e.endpoint.includes('/api/') || e.endpoint.includes('/graphql') ||
        e.endpoint.match(/\/(v\d+|rest|endpoint)\//)
      );

      // Rich handoff to XSS for DOM sink exploitation
      if (domSinks.length > 0) {
        await this.handoffToXSS(job.id, programId, domSinks, result);
      }

      // Rich handoff to Scanner for discovered API endpoints
      if (apiEndpoints.length > 0) {
        await this.handoffToScanner(job.id, programId, apiEndpoints, result);
      }

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

  /**
   * Extract DOM sinks from JS analysis results that could lead to XSS
   */
  private extractDomSinks(result: JsAnalysisResult): any[] {
    const domSinks: any[] = [];

    // Common dangerous DOM sinks
    const dangerousSinks = [
      'innerHTML', 'outerHTML', 'insertAdjacentHTML',
      'document.write', 'document.writeln',
      'eval', 'setTimeout', 'setInterval',
      'Function', 'execScript',
      'location.href', 'location.assign', 'location.replace',
      'document.location', 'window.location'
    ];

    // Scan comments and code context for sink usage
    for (const comment of result.comments) {
      for (const sink of dangerousSinks) {
        if (comment.comment.toLowerCase().includes(sink.toLowerCase())) {
          domSinks.push({
            file: comment.file,
            sink,
            context: comment.comment,
            type: 'dom-xss',
            confidence: 0.6
          });
        }
      }
    }

    // Check endpoints that might have DOM manipulation
    for (const endpoint of result.endpoints) {
      const endpointStr = JSON.stringify(endpoint);
      for (const sink of dangerousSinks) {
        if (endpointStr.toLowerCase().includes(sink.toLowerCase())) {
          domSinks.push({
            file: endpoint.file,
            url: endpoint.url,
            endpoint: endpoint.endpoint,
            sink,
            type: 'dom-xss',
            confidence: 0.75
          });
        }
      }
    }

    return domSinks.slice(0, 100); // Limit to 100 most critical
  }

  /**
   * Rich handoff to XSS agent for DOM sink exploitation
   */
  private async handoffToXSS(
    jsJobId: string,
    programId: string,
    domSinks: any[],
    fullResult: JsAnalysisResult
  ): Promise<void> {
    try {
      const xssJobId = uuidv4();
      const queue = require('../services/queue').default;
      const storage = require('../services/storage').default;

      // Upload DOM sinks for XSS agent
      const sinksContent = JSON.stringify(domSinks, null, 2);
      const s3Key = await storage.uploadText(
        storage.generateKey(programId, 'jsanalysis', `${jsJobId}-dom-sinks.json`),
        sinksContent
      );

      // Extract URLs to test from DOM sinks
      const urlsToTest = [...new Set(domSinks.map(s => s.url).filter(Boolean))];

      await this.createRichHandoff(
        jsJobId,
        programId,
        'xss',
        {
          parentResult: {
            totalDomSinks: domSinks.length,
            domSinksFile: s3Key,
            sinkTypes: [...new Set(domSinks.map(s => s.sink))],
            byConfidence: {
              high: domSinks.filter(s => s.confidence >= 0.8).length,
              medium: domSinks.filter(s => s.confidence >= 0.6 && s.confidence < 0.8).length,
              low: domSinks.filter(s => s.confidence < 0.6).length,
            },
            jsFiles: fullResult.statistics.totalFiles,
            sampleSinks: domSinks.slice(0, 10),
          },
          reasoning: {
            trigger: 'dom-sinks-discovered-in-js',
            confidence: 0.88,
            alternatives: ['manual-dom-xss-testing', 'skip-dom-testing'],
            decisionFactors: [
              `Discovered ${domSinks.length} dangerous DOM sinks in ${fullResult.statistics.totalFiles} JS files`,
              'DOM-based XSS is critical in modern SPAs with client-side routing',
              'Automated testing can validate exploitability of innerHTML, eval, location sinks',
            ],
          },
          objectives: {
            primary: 'Test DOM sinks for XSS exploitation with source-to-sink taint analysis',
            secondary: [
              'Validate innerHTML/outerHTML sinks with HTML injection',
              'Test eval/Function/setTimeout sinks with code injection',
              'Verify location-based open redirect vulnerabilities',
              'Generate PoC payloads for confirmed DOM XSS',
            ],
            avoid: [
              'False positives from sanitized DOM operations',
              'Missing context-specific sink exploitation',
              'Over-testing framework-level safe DOM manipulation',
            ],
          },
          successCriteria: {
            minAssets: Math.floor(domSinks.length * 0.2), // 20% exploitation rate
            maxDuration: domSinks.length * 8, // 8 seconds per sink
            requiredFields: ['url', 'sink', 'payload', 'exploitable'],
            qualityThreshold: 0.75,
          },
          inherited: {
            programId,
            rateLimit: 100, // Moderate rate for DOM testing
            timeout: domSinks.length * 8000,
            safetyChecks: true,
            budget: { timeSeconds: domSinks.length * 8 },
          },
        },
        {
          format: 'dom-xss-result',
          requiredFields: ['confirmed', 'sink', 'payload', 'context'],
          shouldTriggerNextHandoff: true,
          expectedVolume: domSinks.length,
        }
      );

      await queue.addJob('xss', {
        id: xssJobId,
        type: 'xss',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          jsJobId,
          domSinksFile: s3Key,
          urls: urlsToTest.slice(0, 200), // Limit to 200 URLs
          domXss: true,
          reflectedXss: false, // Focus on DOM-based
          storedXss: false,
        },
        metadata: {
          requestedBy: 'jsanalysis-agent',
          handoffOrigin: 'rich-handoff',
          domSinksCount: domSinks.length,
        },
        createdAt: new Date(),
      });

      logger.info({ domSinks: domSinks.length, xssJobId }, '🤝 Rich handoff: Jsanalysis → XSS');
    } catch (error: any) {
      logger.error({ error }, 'Failed rich handoff to XSS agent');
    }
  }

  /**
   * Rich handoff to Scanner agent for discovered API endpoints
   */
  private async handoffToScanner(
    jsJobId: string,
    programId: string,
    apiEndpoints: any[],
    fullResult: JsAnalysisResult
  ): Promise<void> {
    try {
      const scannerJobId = uuidv4();
      const queue = require('../services/queue').default;
      const storage = require('../services/storage').default;

      // Build full API URLs
      const apiUrls = apiEndpoints.map(e => {
        try {
          // Try to build absolute URL
          if (e.endpoint.startsWith('http')) return e.endpoint;
          if (e.url && e.endpoint) {
            const base = new URL(e.url);
            return `${base.protocol}//${base.host}${e.endpoint}`;
          }
          return e.endpoint;
        } catch {
          return e.endpoint;
        }
      }).filter(Boolean);

      // Upload API endpoints list
      const apiContent = apiUrls.join('\n');
      const s3Key = await storage.uploadText(
        storage.generateKey(programId, 'jsanalysis', `${jsJobId}-api-endpoints.txt`),
        apiContent
      );

      await this.createRichHandoff(
        jsJobId,
        programId,
        'scanner',
        {
          parentResult: {
            totalAPIEndpoints: apiEndpoints.length,
            endpointsFile: s3Key,
            endpointAnalysis: {
              withAuth: apiEndpoints.filter(e => e.parameters?.some(p =>
                p.toLowerCase().includes('token') || p.toLowerCase().includes('auth')
              )).length,
              withParams: apiEndpoints.filter(e => e.parameters && e.parameters.length > 0).length,
              methods: [...new Set(apiEndpoints.map(e => e.method).filter(Boolean))],
            },
            discoveredFrom: fullResult.statistics.totalFiles,
            sampleEndpoints: apiEndpoints.slice(0, 20),
          },
          reasoning: {
            trigger: 'api-endpoints-discovered-in-js',
            confidence: 0.92,
            alternatives: ['skip-scanning', 'manual-api-testing'],
            decisionFactors: [
              `Discovered ${apiEndpoints.length} API endpoints in JavaScript files`,
              'Client-side API endpoints often have authentication/authorization issues',
              'Automated scanning can find injection, IDOR, and access control flaws',
            ],
          },
          objectives: {
            primary: 'Scan discovered API endpoints for injection, IDOR, auth bypass',
            secondary: [
              'Test authentication and authorization on all endpoints',
              'Identify parameter injection (XSS, SQLi, SSRF in API params)',
              'Discover IDOR via ID enumeration',
              'Find exposed admin/internal endpoints',
            ],
            avoid: [
              'Rate limit violations causing API blocks',
              'Testing without valid authentication tokens',
              'Missing REST-specific attack vectors',
            ],
          },
          successCriteria: {
            minAssets: Math.floor(apiEndpoints.length * 0.5), // 50% coverage
            maxDuration: apiEndpoints.length * 6, // 6 seconds per endpoint
            requiredFields: ['url', 'findings', 'statusCodes'],
            qualityThreshold: 0.8,
          },
          inherited: {
            programId,
            rateLimit: 150,
            timeout: apiEndpoints.length * 6000,
            safetyChecks: true,
            budget: { timeSeconds: apiEndpoints.length * 6 },
          },
        },
        {
          format: 'scanner-result',
          requiredFields: ['scanned', 'findings', 'bySeverity'],
          shouldTriggerNextHandoff: true,
          expectedVolume: apiEndpoints.length,
        }
      );

      await queue.addJob('scanner', {
        id: scannerJobId,
        type: 'scanner',
        programId,
        priority: 7,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          jsJobId,
          inputUrlsFile: s3Key,
          templateSet: 'fast', // Focus on common API vulns
          tier: 'tier1',
        },
        metadata: {
          requestedBy: 'jsanalysis-agent',
          handoffOrigin: 'rich-handoff',
          apiEndpointsCount: apiEndpoints.length,
        },
        createdAt: new Date(),
      });

      logger.info({ apiEndpoints: apiEndpoints.length, scannerJobId }, '🤝 Rich handoff: Jsanalysis → Scanner');
    } catch (error: any) {
      logger.error({ error }, 'Failed rich handoff to Scanner agent');
    }
  }
}
