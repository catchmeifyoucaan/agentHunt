import database from './database';
import storage from './storage';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

/**
 * Smart Scheduling Service
 * Intelligent job prioritization and resource allocation based on:
 * - Historical success rates
 * - Asset priority scoring
 * - Resource availability
 * - Time-based optimization
 */
class SmartSchedulingService {
  private static instance: SmartSchedulingService;

  private constructor() {}

  public static getInstance(): SmartSchedulingService {
    if (!SmartSchedulingService.instance) {
      SmartSchedulingService.instance = new SmartSchedulingService();
    }
    return SmartSchedulingService.instance;
  }

  /**
   * Calculate priority score for a job based on multiple factors
   */
  public async calculateJobPriority(jobData: any): Promise<number> {
    const { type, programId, options } = jobData;

    let score = 5; // Base priority

    try {
      // Factor 1: Program historical success rate
      const programStats = await this.getProgramStats(programId);
      if (programStats.findingRate > 0.1) {
        score += 2; // High-value program
      }

      // Factor 2: Asset freshness
      if (type === 'fingerprint' || type === 'scanner') {
        const assetAge = await this.getAssetAge(programId);
        if (assetAge < 24) {
          score += 1; // Recent assets, higher priority
        }
      }

      // Factor 3: Job type importance
      const typeScores: Record<string, number> = {
        scanner: 3,
        confirm: 3,
        triage: 2,
        fingerprint: 2,
        crawl: 1,
        discovery: 1,
      };
      score += typeScores[type] || 0;

      // Factor 4: Time of day optimization (less load = higher priority)
      const hour = new Date().getHours();
      if (hour >= 22 || hour <= 6) {
        score += 1; // Off-peak hours
      }

      // Factor 5: Queue depth (if queue is empty, prioritize discovery)
      const queueDepth = await this.getQueueDepth(type);
      if (queueDepth === 0 && type === 'discovery') {
        score += 2;
      }

      // Log scheduling decision
      await this.logSchedulingDecision(jobData, score, {
        programStats,
        assetAge: await this.getAssetAge(programId),
        hour,
        queueDepth,
      });

      return Math.min(10, Math.max(1, score));
    } catch (error) {
      logger.error({ error }, 'Failed to calculate job priority');
      return 5; // Default priority
    }
  }

  /**
   * Get program statistics
   */
  private async getProgramStats(programId: string): Promise<any> {
    const result = await database.query(
      `SELECT
        COUNT(DISTINCT f.id) as total_findings,
        COUNT(DISTINCT a.id) as total_assets,
        COUNT(DISTINCT j.id) as total_jobs,
        AVG(CASE WHEN j.status = 'completed' THEN 1 ELSE 0 END) as success_rate
       FROM programs p
       LEFT JOIN findings f ON p.id = f.program_id
       LEFT JOIN assets a ON p.id = a.program_id
       LEFT JOIN jobs j ON p.id = j.program_id
       WHERE p.id = $1
       GROUP BY p.id`,
      [programId]
    );

    const row = result.rows[0] || {};
    return {
      totalFindings: parseInt(row.total_findings || 0),
      totalAssets: parseInt(row.total_assets || 0),
      totalJobs: parseInt(row.total_jobs || 0),
      successRate: parseFloat(row.success_rate || 0),
      findingRate: parseInt(row.total_findings || 0) / Math.max(1, parseInt(row.total_jobs || 1)),
    };
  }

  /**
   * Get average asset age in hours
   */
  private async getAssetAge(programId: string): Promise<number> {
    const result = await database.query(
      `SELECT AVG(EXTRACT(EPOCH FROM (NOW() - first_seen)) / 3600) as avg_age_hours
       FROM assets WHERE program_id = $1`,
      [programId]
    );

    return parseFloat(result.rows[0]?.avg_age_hours || 72);
  }

  /**
   * Get queue depth for a job type
   */
  private async getQueueDepth(type: string): Promise<number> {
    const result = await database.query(
      `SELECT COUNT(*) as count FROM jobs WHERE type = $1 AND status = 'pending'`,
      [type]
    );

    return parseInt(result.rows[0]?.count || 0);
  }

  /**
   * Log scheduling decision for analytics
   */
  private async logSchedulingDecision(jobData: any, score: number, factors: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO scheduling_logs (id, job_type, program_id, priority_score, factors, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [uuidv4(), jobData.type, jobData.programId, score, JSON.stringify(factors)]
      );
    } catch (error) {
      // Non-critical, just log
      logger.debug({ error }, 'Failed to log scheduling decision');
    }
  }

  /**
   * Recommend optimal time for job execution
   */
  public async recommendExecutionTime(jobType: string): Promise<Date> {
    // Analyze historical data to find optimal execution windows
    const result = await database.query(
      `SELECT EXTRACT(HOUR FROM created_at) as hour,
              AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration,
              COUNT(*) as job_count
       FROM jobs
       WHERE type = $1 AND status = 'completed'
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY avg_duration ASC
       LIMIT 1`,
      [jobType]
    );

    if (result.rows.length > 0) {
      const optimalHour = parseInt(result.rows[0].hour);
      const now = new Date();
      const recommended = new Date();
      recommended.setHours(optimalHour, 0, 0, 0);

      // If optimal hour has passed today, recommend tomorrow
      if (recommended < now) {
        recommended.setDate(recommended.getDate() + 1);
      }

      return recommended;
    }

    // Default: recommend off-peak hours (2 AM)
    const recommended = new Date();
    recommended.setHours(2, 0, 0, 0);
    if (recommended < new Date()) {
      recommended.setDate(recommended.getDate() + 1);
    }

    return recommended;
  }
}

export default SmartSchedulingService.getInstance();
