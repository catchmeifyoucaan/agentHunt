/**
 * Pattern Manager Service - Phase 3.5: Formal Patterns
 *
 * Central service for managing and executing workflow patterns:
 * - Register and list available patterns
 * - Execute patterns with validation
 * - Track pattern execution history
 * - Provide pattern recommendations
 *
 * Patterns enable standardized, repeatable workflows for different scan types.
 */

import { BasePattern, Pattern, PatternExecutionResult } from '../patterns/base';
import {
  FullReconPattern,
  QuickScanPattern,
  DeepScanPattern,
  WordPressScanPattern,
  APIScanPattern,
  ThreeAgentSwarmPattern,
  CloudSecurityPattern,
  SSRFHuntPattern,
  XSSHuntPattern,
  SQLiHuntPattern,
  AuthBypassPattern,
  OSINTPattern,
  JSAnalysisPattern,
  BugBountySpeedrunPattern,
  CriticalOnlyPattern,
  patterns as patternClasses,
} from '../patterns/implementations';
import logger from '../utils/logger';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';
import database from '../services/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * Pattern execution history entry
 */
export interface PatternExecutionHistory {
  id: string;
  patternName: string;
  programId: string;
  executionId: string;
  status: 'in_progress' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  stepsExecuted: number;
  stepsTotal: number;
}

/**
 * Pattern Manager - Central service for pattern operations
 */
export class PatternManager {
  private static instance: PatternManager;
  private patterns: Map<string, BasePattern> = new Map();
  private tracer = trace.getTracer('agenthunt-pattern-manager');

  private constructor() {
    this.registerPatterns();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): PatternManager {
    if (!PatternManager.instance) {
      PatternManager.instance = new PatternManager();
    }
    return PatternManager.instance;
  }

  /**
   * Register all available patterns (15 total)
   */
  private registerPatterns(): void {
    // Original 5 patterns
    this.patterns.set('full-recon', new FullReconPattern());
    this.patterns.set('quick-scan', new QuickScanPattern());
    this.patterns.set('deep-scan', new DeepScanPattern());
    this.patterns.set('wordpress-scan', new WordPressScanPattern());
    this.patterns.set('api-scan', new APIScanPattern());

    // New advanced patterns (10 additional)
    this.patterns.set('three-agent-swarm', new ThreeAgentSwarmPattern());
    this.patterns.set('cloud-security', new CloudSecurityPattern());
    this.patterns.set('ssrf-hunt', new SSRFHuntPattern());
    this.patterns.set('xss-hunt', new XSSHuntPattern());
    this.patterns.set('sqli-hunt', new SQLiHuntPattern());
    this.patterns.set('auth-bypass', new AuthBypassPattern());
    this.patterns.set('osint-recon', new OSINTPattern());
    this.patterns.set('js-analysis', new JSAnalysisPattern());
    this.patterns.set('bug-bounty-speedrun', new BugBountySpeedrunPattern());
    this.patterns.set('critical-only', new CriticalOnlyPattern());

    logger.info({ count: this.patterns.size }, 'Patterns registered (15 workflow patterns available)');
  }

  /**
   * Register a custom pattern
   */
  registerPattern(name: string, pattern: BasePattern): void {
    const validation = pattern.validate();

    if (!validation.valid) {
      throw new Error(`Invalid pattern: ${validation.errors.join(', ')}`);
    }

    this.patterns.set(name, pattern);
    logger.info({ name, definition: pattern.getDefinition() }, 'Custom pattern registered');
  }

  /**
   * Get list of all available patterns
   */
  listPatterns(filters?: { tags?: string[]; maxDuration?: number }): Pattern[] {
    let patterns = Array.from(this.patterns.values()).map((p) => p.getDefinition());

    // Apply filters
    if (filters?.tags && filters.tags.length > 0) {
      patterns = patterns.filter((p) => filters.tags!.some((tag) => p.tags.includes(tag)));
    }

    // Sort by name
    patterns.sort((a, b) => a.name.localeCompare(b.name));

    return patterns;
  }

  /**
   * Get pattern by name
   */
  getPattern(name: string): Pattern | null {
    const pattern = this.patterns.get(name);
    return pattern ? pattern.getDefinition() : null;
  }

  /**
   * Execute a pattern
   */
  async executePattern(
    patternName: string,
    programId: string,
    options: any = {}
  ): Promise<PatternExecutionResult> {
    const span = this.tracer.startSpan('pattern_manager.execute', {
      attributes: {
        'pattern.name': patternName,
        'pattern.program_id': programId,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        // Get pattern
        const pattern = this.patterns.get(patternName);

        if (!pattern) {
          throw new Error(`Pattern "${patternName}" not found`);
        }

        // Validate pattern
        const validation = pattern.validate();
        if (!validation.valid) {
          throw new Error(`Invalid pattern: ${validation.errors.join(', ')}`);
        }

        // Verify program exists
        const programResult = await database.query('SELECT id, name FROM programs WHERE id = $1', [
          programId,
        ]);

        if (programResult.rows.length === 0) {
          throw new Error(`Program ${programId} not found`);
        }

        logger.info(
          { pattern: patternName, programId, program: programResult.rows[0].name },
          'Executing pattern'
        );

        // Execute pattern
        const result = await pattern.execute(programId, options);

        // Save execution history
        await this.saveExecutionHistory(result);

        span.setAttributes({
          'pattern.execution_id': result.executionId,
          'pattern.status': result.status,
          'pattern.steps_executed': result.steps.length,
          'pattern.duration_ms': result.totalDuration || 0,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return result;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

        logger.error({ error, patternName, programId }, 'Pattern execution failed');
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get pattern execution history
   */
  async getExecutionHistory(
    programId?: string,
    patternName?: string,
    limit: number = 50
  ): Promise<PatternExecutionHistory[]> {
    try {
      let query = `
        SELECT * FROM pattern_executions
        WHERE 1=1
      `;
      const params: any[] = [];
      let paramIndex = 1;

      if (programId) {
        query += ` AND program_id = $${paramIndex}`;
        params.push(programId);
        paramIndex++;
      }

      if (patternName) {
        query += ` AND pattern_name = $${paramIndex}`;
        params.push(patternName);
        paramIndex++;
      }

      query += ` ORDER BY started_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await database.query(query, params);

      return result.rows.map((row) => ({
        id: row.id,
        patternName: row.pattern_name,
        programId: row.program_id,
        executionId: row.execution_id,
        status: row.status,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        duration: row.duration,
        stepsExecuted: row.steps_executed,
        stepsTotal: row.steps_total,
      }));
    } catch (error: any) {
      // If table doesn't exist yet, return empty array
      if (error.code === '42P01') {
        logger.debug('Pattern executions table does not exist yet');
        return [];
      }
      throw error;
    }
  }

  /**
   * Get pattern recommendations based on program characteristics
   */
  async getRecommendations(programId: string): Promise<{
    recommended: Pattern[];
    reasons: Record<string, string[]>;
  }> {
    try {
      // Get program info
      const programResult = await database.query('SELECT name, scope FROM programs WHERE id = $1', [
        programId,
      ]);

      if (programResult.rows.length === 0) {
        throw new Error(`Program ${programId} not found`);
      }

      const program = programResult.rows[0];
      const scope = program.scope || {};
      const reasons: Record<string, string[]> = {};

      // Get asset count
      const assetsResult = await database.query(
        'SELECT COUNT(*) as count FROM assets WHERE program_id = $1',
        [programId]
      );
      const assetCount = parseInt(assetsResult.rows[0]?.count || '0', 10);

      // Get recent execution history
      const history = await this.getExecutionHistory(programId, undefined, 10);
      const recentPatterns = new Set(history.map((h) => h.patternName));

      // Recommendation logic
      const recommended: Pattern[] = [];

      // If no assets, recommend full-recon
      if (assetCount === 0) {
        const pattern = this.getPattern('full-recon');
        if (pattern) {
          recommended.push(pattern);
          reasons['full-recon'] = ['No assets discovered yet', 'Comprehensive first scan'];
        }
      }

      // If assets exist but no recent scans, recommend quick-scan
      if (assetCount > 0 && !recentPatterns.has('quick-scan')) {
        const pattern = this.getPattern('quick-scan');
        if (pattern) {
          recommended.push(pattern);
          reasons['quick-scan'] = [`${assetCount} assets available`, 'Fast vulnerability check'];
        }
      }

      // If WordPress detected, recommend wordpress-scan
      const wordpressResult = await database.query(
        `SELECT COUNT(*) as count FROM assets
         WHERE program_id = $1
         AND metadata->>'technologies' LIKE '%WordPress%'`,
        [programId]
      );
      const wordpressCount = parseInt(wordpressResult.rows[0]?.count || '0', 10);

      if (wordpressCount > 0 && !recentPatterns.has('wordpress-scan')) {
        const pattern = this.getPattern('wordpress-scan');
        if (pattern) {
          recommended.push(pattern);
          reasons['wordpress-scan'] = [
            `${wordpressCount} WordPress sites detected`,
            'Specialized WP vulnerability testing',
          ];
        }
      }

      // If API endpoints detected, recommend api-scan
      const apiResult = await database.query(
        `SELECT COUNT(*) as count FROM assets
         WHERE program_id = $1
         AND (value LIKE '%api%' OR value LIKE '%rest%' OR value LIKE '%graphql%')`,
        [programId]
      );
      const apiCount = parseInt(apiResult.rows[0]?.count || '0', 10);

      if (apiCount > 0 && !recentPatterns.has('api-scan')) {
        const pattern = this.getPattern('api-scan');
        if (pattern) {
          recommended.push(pattern);
          reasons['api-scan'] = [`${apiCount} API endpoints detected`, 'API security testing'];
        }
      }

      logger.info(
        { programId, recommended: recommended.map((p) => p.name) },
        'Generated pattern recommendations'
      );

      return { recommended, reasons };
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to generate recommendations');
      return { recommended: [], reasons: {} };
    }
  }

  /**
   * Save pattern execution history to database
   */
  private async saveExecutionHistory(result: PatternExecutionResult): Promise<void> {
    try {
      // Create table if not exists
      await database.query(`
        CREATE TABLE IF NOT EXISTS pattern_executions (
          id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
          pattern_name VARCHAR(100) NOT NULL,
          program_id UUID NOT NULL,
          execution_id UUID NOT NULL,
          status VARCHAR(50) NOT NULL,
          started_at TIMESTAMP NOT NULL,
          completed_at TIMESTAMP,
          duration INTEGER,
          steps_executed INTEGER,
          steps_total INTEGER,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert execution record
      await database.query(
        `INSERT INTO pattern_executions
         (pattern_name, program_id, execution_id, status, started_at, completed_at, duration, steps_executed, steps_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          result.patternName,
          result.programId,
          result.executionId,
          result.status,
          result.startedAt,
          result.completedAt,
          result.totalDuration,
          result.steps.length,
          result.steps.length,
        ]
      );

      logger.debug(
        { executionId: result.executionId, pattern: result.patternName },
        'Saved pattern execution history'
      );
    } catch (error: any) {
      logger.error({ error, executionId: result.executionId }, 'Failed to save execution history');
      // Don't throw - history save is not critical
    }
  }

  /**
   * Get statistics about pattern usage
   */
  async getStatistics(): Promise<{
    totalExecutions: number;
    byPattern: Record<string, number>;
    byStatus: Record<string, number>;
    averageDuration: Record<string, number>;
  }> {
    try {
      const statsResult = await database.query(`
        SELECT
          COUNT(*) as total_executions,
          COUNT(*) FILTER (WHERE status = 'completed') as completed,
          COUNT(*) FILTER (WHERE status = 'failed') as failed,
          COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress,
          pattern_name,
          AVG(duration) as avg_duration
        FROM pattern_executions
        GROUP BY pattern_name
      `);

      const stats = {
        totalExecutions: 0,
        byPattern: {} as Record<string, number>,
        byStatus: { completed: 0, failed: 0, in_progress: 0 } as Record<string, number>,
        averageDuration: {} as Record<string, number>,
      };

      statsResult.rows.forEach((row) => {
        stats.totalExecutions += parseInt(row.total_executions, 10);
        stats.byPattern[row.pattern_name] = parseInt(row.total_executions, 10);
        stats.byStatus.completed += parseInt(row.completed, 10);
        stats.byStatus.failed += parseInt(row.failed, 10);
        stats.byStatus.in_progress += parseInt(row.in_progress, 10);
        stats.averageDuration[row.pattern_name] = parseFloat(row.avg_duration) || 0;
      });

      return stats;
    } catch (error: any) {
      logger.error({ error }, 'Failed to get pattern statistics');
      return {
        totalExecutions: 0,
        byPattern: {},
        byStatus: { completed: 0, failed: 0, in_progress: 0 },
        averageDuration: {},
      };
    }
  }
}

/**
 * Export singleton instance
 */
export const patternManager = PatternManager.getInstance();

export default patternManager;
