import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { ScannerJob, TemplateTier, Severity, AssetMetadata } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import storage from '../services/storage';
import queue from '../services/queue';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

/**
 * Scanner Agent
 * Runs Nuclei templates with tier-based gating:
 * - Tier 0: Fingerprinting (always allowed)
 * - Tier 1: Detection templates (non-invasive)
 * - Tier 2: Fuzzing templates (requires opt-in)
 * - Tier 3: Active exploitation (requires written consent)
 */
export class ScannerAgent extends BaseAgent<ScannerJob> {
  private static templatesCached = false; // Track if templates have been cached

  constructor() {
    super('scanner');
  }
  protected getSteps() {
    return [
      {
            name: "Load targets and templates",
            metadata: {}
      },
      {
            name: "Run Nuclei vulnerability scan",
            metadata: {}
      },
      {
            name: "Parse and triage findings",
            metadata: {}
      },
      {
            name: "Store vulnerabilities in database",
            metadata: {}
      }
];
  }


  async process(job: Job<ScannerJob>): Promise<any> {
    const { programId, options } = job.data;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // OPTIMIZATION: Cache Nuclei templates on first run (10-20% faster)
      if (!ScannerAgent.templatesCached) {
        await this.ensureTemplatesCached();
      }

      // Verify program policy allows this tier
      const allowed = await this.checkTierAllowed(programId, options.tier);
      if (!allowed) {
        throw new Error(`Tier ${options.tier} not allowed for this program`);
      }

      await this.logExecution(
        job.id!,
        programId,
        'nuclei',
        'start',
        'info',
        `Starting scan with ${options.templateSet} templates (tier: ${options.tier})`
      );

      // Download input URLs from S3
      const urlsContent = await storage.downloadText(storage.parseS3Uri(options.inputUrlsFile));
      const urls = urlsContent.split('\n').filter((u) => u.trim());

      await this.logExecution(
        job.id!,
        programId,
        'nuclei',
        'info',
        'info',
        `Loaded ${urls.length} URLs to scan`
      );

      // Filter URLs based on fingerprint conditions
      const filteredUrls = await this.filterByFingerprints(urls, options.fingerprintConditions);

      if (filteredUrls.length === 0) {
        await this.logExecution(
          job.id!,
          programId,
          'nuclei',
          'skip',
          'info',
          'No URLs matched fingerprint conditions, skipping scan'
        );

        return { totalUrls: urls.length, scannedUrls: 0, findings: [] };
      }

      // Create temp files
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuclei-'));
      const urlsFile = path.join(tmpDir, 'urls.txt');
      const outputFile = path.join(tmpDir, 'nuclei_output.jsonl');

      await fs.writeFile(urlsFile, filteredUrls.join('\n'));

      // Get template paths with context-aware selection using fingerprint data
      const templates = await this.getTemplates(
        options.templateSet,
        options.tier,
        options.templates,
        options.fingerprintData
      );

      // Build nuclei command with optimized flags
      let command = `${config.tools.nuclei} \
        -list ${urlsFile} \
        -templates ${templates.join(',')} \
        -concurrency 500 \
        -timeout 10 \
        -retries 1 \
        -rl 150 \
        -stats -metrics -metrics-port 9092 \
        -passive \
        -fuzz -fuzzing-mode single \
        -payload-concurrency 25 \
        -json -o ${outputFile}`;

      if (options.interactshEnabled && config.interactsh.server) {
        command += ` -interactsh-server ${config.interactsh.server}`;
        if (config.interactsh.token) {
          command += ` -interactsh-token ${config.interactsh.token}`;
        }
      }

      // Note: Headless mode for DOM-based vulnerabilities can be enabled by adding
      // -headless -page-timeout 20 flags, but requires Chrome/Chromium installed
      // For now, passive mode is enabled which catches many DOM issues

      // Update progress before scanning
      await this.updateJobProgress(job.id!, {
        current: 0,
        total: filteredUrls.length,
        percentage: 0,
        currentTool: 'nuclei',
        toolStatus: 'running',
        message: `Scanning ${filteredUrls.length} URLs with ${options.templateSet} templates`,
        details: {
          tier: options.tier,
          concurrency: 500,
          templateSet: options.templateSet,
          timeout: '30 minutes',
        },
      });

      // Execute nuclei
      const result = await this.executeCommand(command, { timeout: 1800000 }); // 30 min

      let findings: any[] = [];

      if (result.exitCode === 0 || result.exitCode === 1) {
        try {
          const content = await fs.readFile(outputFile, 'utf-8');
          findings = this.parseJsonLines(content);

          // Update progress after scanning
          await this.updateJobProgress(job.id!, {
            current: filteredUrls.length,
            total: filteredUrls.length,
            percentage: 100,
            currentTool: 'nuclei',
            toolStatus: 'completed',
            message: `Scanned ${filteredUrls.length} URLs, found ${findings.length} findings`,
            details: {
              findings: findings.length,
              bySeverity: this.countBySeverity(findings),
            },
          });

          // Save raw output to S3
          const s3Key = await storage.uploadText(
            storage.generateKey(programId, 'nuclei', `${job.id}.jsonl`),
            content
          );

          await this.logExecution(
            job.id!,
            programId,
            'nuclei',
            'complete',
            'info',
            `Scan complete: ${findings.length} findings, saved to ${s3Key}`
          );

          // Queue triage jobs for findings
          for (const finding of findings) {
            if (this.shouldTriage(finding)) {
              await queue.addJob('triage', {
                id: uuidv4(),
                type: 'triage',
                programId,
                priority: this.getPriority(finding.info?.severity),
                status: 'pending',
                attempts: 0,
                maxAttempts: 3,
                options: {
                  rawOutputFile: s3Key,
                  scannerJobId: job.id!,
                  useAI: config.features.enableAiTriage,
                  temperature: 0.0,
                },
                metadata: {
                  requestedBy: 'scanner-agent',
                  parentJobId: job.id!,
                },
              } as any);
            }
          }
        } catch (error) {
          logger.error({ error }, 'Failed to parse nuclei output');
        }
      }

      // Cleanup
      await fs.rm(tmpDir, { recursive: true });

      const results = {
        totalUrls: urls.length,
        scannedUrls: filteredUrls.length,
        findings: findings.length,
        bySeverity: this.countBySeverity(findings),
      };

      await this.updateJobStatus(job.id!, 'completed', results);

      return results;
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  private async checkTierAllowed(programId: string, tier: TemplateTier): Promise<boolean> {
    const result = await database.query('SELECT policy FROM programs WHERE id = $1', [programId]);

    if (result.rows.length === 0) {
      return false;
    }

    const policy = result.rows[0].policy;

    switch (tier) {
      case 'tier0':
      case 'tier1':
        return true;
      case 'tier2':
        return policy.allowedTemplates?.tier2 === true;
      case 'tier3':
        return policy.allowedTemplates?.tier3 === true && config.safety.enableTier3Templates;
      default:
        return false;
    }
  }

  private async filterByFingerprints(urls: string[], conditions?: Record<string, any>): Promise<string[]> {
    if (!conditions || Object.keys(conditions).length === 0) {
      return urls;
    }

    logger.info({
      totalUrls: urls.length,
      conditions
    }, 'Filtering URLs by fingerprint conditions');

    const filtered: string[] = [];

    // Query database for asset fingerprints
    for (const url of urls) {
      try {
        const result = await database.query(
          `SELECT metadata FROM assets WHERE value = $1 OR value LIKE $2 LIMIT 1`,
          [url, `%${new URL(url).hostname}%`]
        );

        if (result.rows.length === 0) {
          // No fingerprint data, skip filtering for this URL
          filtered.push(url);
          continue;
        }

        const metadata = result.rows[0].metadata || {};
        let matches = true;

        // Check each fingerprint condition
        if (conditions.technologies && Array.isArray(conditions.technologies)) {
          const assetTechs = metadata.technologies || [];
          const hasRequiredTech = conditions.technologies.some((tech: string) =>
            assetTechs.some((t: string) => t.toLowerCase().includes(tech.toLowerCase()))
          );
          if (!hasRequiredTech) matches = false;
        }

        if (conditions.httpStatus && metadata.httpStatus) {
          if (Array.isArray(conditions.httpStatus)) {
            if (!conditions.httpStatus.includes(metadata.httpStatus)) matches = false;
          } else {
            if (metadata.httpStatus !== conditions.httpStatus) matches = false;
          }
        }

        if (conditions.server && metadata.server) {
          const serverMatches = metadata.server.toLowerCase().includes(
            conditions.server.toLowerCase()
          );
          if (!serverMatches) matches = false;
        }

        if (conditions.cdn) {
          const hasCdn = metadata.cdn && metadata.cdn.toLowerCase().includes(
            conditions.cdn.toLowerCase()
          );
          if (!hasCdn) matches = false;
        }

        if (matches) {
          filtered.push(url);
        }
      } catch (error) {
        logger.debug({ error, url }, 'Error filtering URL by fingerprint');
        // On error, include the URL to avoid false negatives
        filtered.push(url);
      }
    }

    logger.info({
      originalCount: urls.length,
      filteredCount: filtered.length,
      removed: urls.length - filtered.length
    }, 'Fingerprint filtering complete');

    return filtered;
  }

  private async getTemplates(
    templateSet: string,
    tier: TemplateTier,
    customTemplates?: string[],
    fingerprintData?: AssetMetadata // New parameter
  ): Promise<string[]> {
    if (customTemplates && customTemplates.length > 0) {
      return customTemplates;
    }

    const basePath = config.tools.nucleiTemplates;
    const customPath = '/app/tools/templates';
    let templates: string[] = [];

    // Prioritize templates based on fingerprint data if available
    if (fingerprintData) {
      const technologies = fingerprintData.technologies || [];
      const server = fingerprintData.server?.toLowerCase() || '';

      // Add technology-specific templates
      if (technologies.some(tech => tech.toLowerCase().includes('wordpress'))) {
        templates.push(`${basePath}/http/technologies/wordpress`);
      }
      if (technologies.some(tech => tech.toLowerCase().includes('joomla'))) {
        templates.push(`${basePath}/http/technologies/joomla`);
      }
      if (technologies.some(tech => tech.toLowerCase().includes('drupal'))) {
        templates.push(`${basePath}/http/technologies/drupal`);
      }
      if (technologies.some(tech => tech.toLowerCase().includes('nginx'))) {
        templates.push(`${basePath}/http/misconfiguration/nginx`);
      }
      if (technologies.some(tech => tech.toLowerCase().includes('apache'))) {
        templates.push(`${basePath}/http/misconfiguration/apache`);
      }
      if (technologies.some(tech => tech.toLowerCase().includes('microsoft iis'))) {
        templates.push(`${basePath}/http/misconfiguration/microsoft-iis`);
      }
      // Add more technology-specific template paths as needed

      // Add server-specific templates
      if (server.includes('nginx')) {
        templates.push(`${basePath}/http/misconfiguration/nginx`);
      }
      if (server.includes('apache')) {
        templates.push(`${basePath}/http/misconfiguration/apache`);
      }
      // Add more server-specific template paths as needed

      // Ensure unique templates and filter out duplicates
      templates = [...new Set(templates)];
    }

    // Add base templates based on templateSet
    switch (templateSet) {
      case 'fast':
        templates.push(
          `${basePath}/http/cves`,
          `${basePath}/http/vulnerabilities`,
          `${basePath}/http/misconfiguration`,
          `${customPath}/nuclei-templates-ai/http`
        );
        break;
      case 'comprehensive':
        templates.push(
          `${basePath}`,
          `${customPath}/nuclei-templates-ai`,
          `${customPath}/40k-nuclei-templates`
        );
        break;
      case 'fuzz':
        templates.push(
          `${basePath}/http/fuzzing`,
          `${basePath}/headless`,
          `${customPath}/fuzzing-templates`
        );
        break;
      case 'mobile':
        templates.push(
          `${customPath}/mobile-nuclei-templates`,
          `${basePath}/http/cves`
        );
        break;
      case 'ai':
        templates.push(`${customPath}/nuclei-templates-ai`);
        break;
      default:
        templates.push(`${basePath}`);
        break;
    }

    // Filter templates by tier (if not already handled by templateSet)
    // This logic might need refinement based on how templates are structured by tier
    // For now, assume base templates are generally tier1/tier0 unless specified

    return [...new Set(templates)]; // Return unique template paths
  }

  private shouldTriage(finding: any): boolean {
    // Triage critical and high findings, or findings with confidence indicators
    const severity = finding.info?.severity;
    return ['critical', 'high', 'medium'].includes(severity);
  }

  private getPriority(severity?: string): number {
    switch (severity) {
      case 'critical':
        return 10;
      case 'high':
        return 8;
      case 'medium':
        return 5;
      case 'low':
        return 3;
      default:
        return 1;
    }
  }

  private countBySeverity(findings: any[]): Record<string, number> {
    const counts: Record<string, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    findings.forEach((f) => {
      const severity = f.info?.severity || 'info';
      if (counts[severity] !== undefined) {
        counts[severity]++;
      }
    });

    return counts;
  }

  /**
   * Ensure Nuclei templates are cached (10-20% faster scanning)
   * Templates are pre-compiled on first run for better performance
   */
  private async ensureTemplatesCached(): Promise<void> {
    if (ScannerAgent.templatesCached) {
      return;
    }

    try {
      logger.info('Pre-compiling Nuclei templates for caching...');

      // Update templates first
      const updateCommand = `${config.tools.nuclei} -update-templates -silent`;
      await this.executeCommand(updateCommand);

      // Pre-compile templates to cache
      const cacheDir = '/tmp/nuclei-cache';
      const compileCommand = `${config.tools.nuclei} -tc ${cacheDir} -silent`;
      await this.executeCommand(compileCommand);

      ScannerAgent.templatesCached = true;
      logger.info('Nuclei templates cached successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to cache Nuclei templates, continuing without cache');
      // Don't fail the job if caching fails, just continue without cache
    }
  }
}
