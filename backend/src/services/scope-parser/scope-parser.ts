/**
 * Main Scope Parser
 * Orchestrates parsing of different scope document formats
 */

import { ParsedScope, TestingConfig, AttackSurface } from './types';
// Use PDF stub to avoid DOMMatrix issues in Node.js
import pdfParser from './parsers/pdf-stub';
import csvParser from './parsers/csv';
import docxParser from './parsers/docx';
import llm from '../llm/llm-engine';
import logger from '../../utils/logger';

class ScopeParser {
  /**
   * Parse scope document (auto-detect format from buffer/extension)
   */
  async parseDocument(
    buffer: Buffer,
    format: 'pdf' | 'docx' | 'csv' | 'text' | 'auto' = 'auto',
    filename?: string
  ): Promise<ParsedScope> {
    try {
      // Auto-detect format if needed
      let detectedFormat = format;

      if (format === 'auto' && filename) {
        detectedFormat = this.detectFormat(filename);
      }

      logger.info({ format: detectedFormat, filename }, 'Parsing scope document');

      // Route to appropriate parser
      switch (detectedFormat) {
        case 'pdf':
          return await pdfParser.parse(buffer);

        case 'docx':
          return await docxParser.parse(buffer);

        case 'csv':
          return await csvParser.parse(buffer);

        case 'text':
          return await this.parseText(buffer.toString('utf-8'));

        default:
          throw new Error(`Unsupported format: ${detectedFormat}`);
      }
    } catch (error: any) {
      logger.error({ error, format, filename }, 'Scope parsing failed');
      throw new Error(`Scope parsing failed: ${error.message}`);
    }
  }

  /**
   * Detect format from filename
   */
  private detectFormat(filename: string): 'pdf' | 'docx' | 'csv' | 'text' {
    const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));

    switch (ext) {
      case '.pdf':
        return 'pdf';
      case '.docx':
      case '.doc':
        return 'docx';
      case '.csv':
        return 'csv';
      case '.txt':
      case '.text':
        return 'text';
      default:
        logger.warn({ filename, ext }, 'Unknown file format, defaulting to text');
        return 'text';
    }
  }

  /**
   * Parse plain text scope
   */
  private async parseText(text: string): Promise<ParsedScope> {
    logger.info({ textLength: text.length }, 'Parsing text scope');

    // Use LLM to parse (same as PDF parser fallback)
    const parsed = await llm.complete(
      `Parse this scope document and extract targets in JSON format: ${text.substring(0, 5000)}`,
      'Extract domains, IPs, URLs in JSON format.'
    );

    // Basic parsing fallback
    return {
      targets: [],
      domains: [],
      subdomains: [],
      wildcardDomains: [],
      ipRanges: [],
      ips: [],
      urls: [],
      outOfScope: [],
      excludedDomains: [],
      excludedPaths: [],
      constraints: {
        noDoS: false,
        requireAuth: false,
      },
      credentials: {},
      priorities: [],
      deliverables: [],
      metadata: {
        parsedFrom: 'text',
        parsedAt: new Date(),
      },
    };
  }

  /**
   * Identify attack surface from parsed scope
   */
  async identifyAttackSurface(scope: ParsedScope): Promise<AttackSurface> {
    try {
      logger.info('Analyzing attack surface');

      const analysis = await llm.reason(
        `Given these targets and constraints, identify:
1. High-value targets (admin panels, APIs, upload functions, payment gateways)
2. Low-hanging fruit (known CVEs, misconfigurations, common vulnerabilities)
3. Complex attack chains worth investigating
4. Areas likely overlooked by automated scanners

Targets: ${JSON.stringify(scope.targets)}
Priorities: ${JSON.stringify(scope.priorities)}
Constraints: ${JSON.stringify(scope.constraints)}`,
        {
          domains: scope.domains,
          subdomains: scope.subdomains,
          priorities: scope.priorities,
        }
      );

      return {
        highValue:
          analysis.actions
            ?.filter((a: any) => a.type === 'high_value')
            .map((a: any) => a.tool || a.parameters?.target) || [],
        quickWins:
          analysis.actions
            ?.filter((a: any) => a.type === 'quick_win')
            .map((a: any) => a.tool || a.parameters?.target) || [],
        deepDives:
          analysis.actions
            ?.filter((a: any) => a.type === 'deep_dive')
            .map((a: any) => a.tool || a.parameters?.target) || [],
        novel:
          analysis.actions
            ?.filter((a: any) => a.type === 'novel')
            .map((a: any) => a.tool || a.parameters?.target) || [],
      };
    } catch (error: any) {
      logger.error({ error }, 'Attack surface analysis failed');

      // Return empty attack surface on error
      return {
        highValue: scope.priorities,
        quickWins: [],
        deepDives: [],
        novel: [],
      };
    }
  }

  /**
   * Convert parsed scope to testing configuration
   */
  async convertToTestingConfig(scope: ParsedScope): Promise<TestingConfig> {
    logger.info('Converting scope to testing configuration');

    return {
      programs: scope.targets.map((target) => ({
        name: target,
        domains: [target],
        rateLimit: scope.constraints.maxRateLimit || 100,
        timeout: 86400, // 24 hours
        excludedPaths: scope.excludedPaths,
        credentials: Object.keys(scope.credentials).length > 0 ? scope.credentials : null,
        priority: scope.priorities.includes(target) ? 'high' : 'normal',
      })),
      globalConstraints: {
        noDoS: scope.constraints.noDoS,
        authenticated: scope.constraints.requireAuth,
        reportFormat: scope.deliverables,
      },
    };
  }

  /**
   * Validate parsed scope
   */
  validateScope(scope: ParsedScope): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check for at least one target
    if (scope.targets.length === 0 && scope.domains.length === 0 && scope.ips.length === 0) {
      errors.push('No targets found in scope document');
    }

    // Check metadata
    if (!scope.metadata || !scope.metadata.parsedAt) {
      errors.push('Invalid metadata');
    }

    // Warn about excluded paths without domains
    if (scope.excludedPaths.length > 0 && scope.domains.length === 0) {
      errors.push('Excluded paths found but no domains defined');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

export default new ScopeParser();
