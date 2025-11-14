/**
 * CSV Scope Parser
 * Parses scope documents in CSV format
 */

import { parse } from 'csv-parse/sync';
import { ParsedScope, CSVScopeRow } from '../types';
import logger from '../../../utils/logger';

export class CSVParser {
  /**
   * Parse CSV scope document
   */
  async parse(buffer: Buffer): Promise<ParsedScope> {
    try {
      const content = buffer.toString('utf-8');

      // Parse CSV
      const rows = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as CSVScopeRow[];

      logger.info({ rowCount: rows.length }, 'Parsing CSV scope document');

      const scope: ParsedScope = {
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
          parsedFrom: 'csv',
          parsedAt: new Date(),
        },
      };

      // Process each row
      for (const row of rows) {
        this.processRow(row, scope);
      }

      // Post-processing
      scope.targets = [...new Set([
        ...scope.domains,
        ...scope.subdomains,
        ...scope.ips,
        ...scope.urls,
      ])];

      logger.info({
        domains: scope.domains.length,
        subdomains: scope.subdomains.length,
        ips: scope.ips.length,
        credentials: Object.keys(scope.credentials).length,
        constraints: Object.keys(scope.constraints).length,
      }, 'CSV scope parsed successfully');

      return scope;
    } catch (error: any) {
      logger.error({ error }, 'Failed to parse CSV scope');
      throw new Error(`CSV parsing failed: ${error.message}`);
    }
  }

  /**
   * Process a single CSV row
   */
  private processRow(row: CSVScopeRow, scope: ParsedScope): void {
    const { type, value, priority, notes, constraint_details } = row;

    if (!type || !value) return;

    switch (type.toLowerCase()) {
      case 'domain':
        if (value.startsWith('*.')) {
          scope.wildcardDomains.push(value);
        } else {
          scope.domains.push(value);
        }
        if (priority === 'high' || priority === 'critical') {
          scope.priorities.push(value);
        }
        break;

      case 'subdomain':
        scope.subdomains.push(value);
        if (priority === 'high' || priority === 'critical') {
          scope.priorities.push(value);
        }
        break;

      case 'ip_range':
        scope.ipRanges.push(value);
        break;

      case 'ip':
        scope.ips.push(value);
        break;

      case 'url':
        scope.urls.push(value);
        break;

      case 'exclude':
        scope.outOfScope.push(value);
        if (value.includes('/')) {
          scope.excludedPaths.push(value);
        } else {
          scope.excludedDomains.push(value);
        }
        break;

      case 'constraint':
        this.processConstraint(value, constraint_details || notes, scope);
        break;

      case 'credential':
        this.processCredential(value, constraint_details || notes, priority, scope);
        break;

      case 'priority':
        scope.priorities.push(value);
        break;

      case 'deliverable':
        scope.deliverables.push(value);
        break;

      default:
        logger.warn({ type, value }, 'Unknown CSV row type');
    }
  }

  /**
   * Process constraint row
   */
  private processConstraint(constraint: string, details: string | undefined, scope: ParsedScope): void {
    const constraintLower = constraint.toLowerCase();

    if (constraintLower.includes('no_dos') || constraintLower.includes('dos')) {
      scope.constraints.noDoS = true;
    }

    if (constraintLower.includes('rate') || constraintLower.includes('limit')) {
      // Extract rate limit from details: "Rate limit: 100 req/min"
      const match = details?.match(/(\d+)\s*req/i);
      if (match) {
        scope.constraints.maxRateLimit = parseInt(match[1], 10);
      }
    }

    if (constraintLower.includes('window') || constraintLower.includes('time')) {
      // Extract testing window: "Mon-Fri 6pm-6am EST only"
      if (details) {
        scope.constraints.testingWindow = {
          start: details,
          end: details,
        };
      }
    }

    if (constraintLower.includes('auth') || constraintLower.includes('login')) {
      scope.constraints.requireAuth = true;
    }

    if (constraintLower.includes('prohibit') || constraintLower.includes('forbidden')) {
      if (!scope.constraints.prohibitedActions) {
        scope.constraints.prohibitedActions = [];
      }
      if (details) {
        scope.constraints.prohibitedActions.push(details);
      }
    }
  }

  /**
   * Process credential row
   */
  private processCredential(
    credType: string,
    credValue: string | undefined,
    priority: string | undefined,
    scope: ParsedScope
  ): void {
    if (!credValue) return;

    const type = this.detectCredentialType(credType, credValue);

    // Extract key from "Bearer abc123" or "admin:password"
    const value = credValue.replace(/^Bearer\s+/i, '').trim();

    // Use credential type or generate unique key
    const key = credType.toLowerCase().replace(/\s+/g, '_') || `credential_${Object.keys(scope.credentials).length + 1}`;

    scope.credentials[key] = {
      type,
      value,
      notes: priority ? `Priority: ${priority}` : undefined,
    };

    logger.info({ key, type }, 'Credential extracted from CSV');
  }

  /**
   * Detect credential type
   */
  private detectCredentialType(credType: string, credValue: string): 'api_key' | 'login' | 'jwt' | 'bearer' | 'custom' {
    const typeLower = credType.toLowerCase();
    const valueLower = credValue.toLowerCase();

    if (typeLower.includes('api') || valueLower.startsWith('bearer')) {
      return 'api_key';
    }

    if (typeLower.includes('login') || typeLower.includes('password') || credValue.includes(':')) {
      return 'login';
    }

    if (typeLower.includes('jwt') || valueLower.startsWith('ey')) {
      return 'jwt';
    }

    if (valueLower.startsWith('bearer ')) {
      return 'bearer';
    }

    return 'custom';
  }
}

export default new CSVParser();
