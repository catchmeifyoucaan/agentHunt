/**
 * Agent Health Monitoring Service
 * Monitors agent performance and enables self-healing
 * Inspired by Claude Code's robust error handling
 */

import database from './database';
import logger from '../utils/logger';
import notification from './notification';
import { AgentHealth, AgentStatus, HealthMetrics, HealthIssue } from '../../../shared/agent-collaboration.types';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

class AgentHealthService {
  private monitoringIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Initialize health monitoring for an agent
   */
  async initializeHealth(agentType: string, instanceId: string, programId: string): Promise<void> {
    try {
      // Create or update health record
      await database.query(
        `INSERT INTO agent_health (
          agent_type, instance_id, program_id, status, last_heartbeat
        ) VALUES ($1, $2, $3, 'healthy', NOW())
        ON CONFLICT (agent_type, instance_id, program_id)
        DO UPDATE SET last_heartbeat = NOW(), status = 'healthy'`,
        [agentType, instanceId, programId]
      );

      logger.info({ agentType, instanceId, programId }, 'Agent health initialized');
    } catch (error: any) {
      logger.error({ error, agentType, instanceId, programId }, 'Failed to initialize health');
    }
  }

  /**
   * Record a heartbeat from an agent
   */
  async recordHeartbeat(
    agentType: string,
    instanceId: string,
    programId: string,
    metrics?: Partial<HealthMetrics>
  ): Promise<void> {
    try {
      const updates: string[] = ['last_heartbeat = NOW()'];
      const values: any[] = [];
      let paramIndex = 1;

      if (metrics) {
        if (metrics.jobsProcessed !== undefined) {
          updates.push(`jobs_processed = $${paramIndex++}`);
          values.push(metrics.jobsProcessed);
        }
        if (metrics.jobsFailed !== undefined) {
          updates.push(`jobs_failed = $${paramIndex++}`);
          values.push(metrics.jobsFailed);
        }
        if (metrics.avgDuration !== undefined) {
          updates.push(`avg_duration = $${paramIndex++}`);
          values.push(metrics.avgDuration);
        }
        if (metrics.memoryUsage !== undefined) {
          updates.push(`memory_usage = $${paramIndex++}`);
          values.push(metrics.memoryUsage);
        }
        if (metrics.cpuUsage !== undefined) {
          updates.push(`cpu_usage = $${paramIndex++}`);
          values.push(metrics.cpuUsage);
        }
        if (metrics.queueDepth !== undefined) {
          updates.push(`queue_depth = $${paramIndex++}`);
          values.push(metrics.queueDepth);
        }
        if (metrics.errorRate !== undefined) {
          updates.push(`error_rate = $${paramIndex++}`);
          values.push(metrics.errorRate);
        }
      }

      values.push(agentType, instanceId, programId);

      await database.query(
        `UPDATE agent_health
         SET ${updates.join(', ')}
         WHERE agent_type = $${paramIndex++} AND instance_id = $${paramIndex++} AND program_id = $${paramIndex}`,
        values
      );

      // Check for health issues
      await this.checkHealth(agentType, instanceId, programId);
    } catch (error: any) {
      logger.error({ error, agentType, instanceId, programId }, 'Failed to record heartbeat');
    }
  }

  /**
   * Check agent health and detect issues
   */
  async checkHealth(agentType: string, instanceId: string, programId: string): Promise<AgentStatus> {
    try {
      const health = await this.getHealth(agentType, instanceId, programId);
      if (!health) {
        return 'offline';
      }

      const issues: HealthIssue[] = [];
      let newStatus: AgentStatus = 'healthy';

      // Check heartbeat freshness
      const heartbeatAge = Date.now() - health.lastHeartbeat.getTime();
      if (heartbeatAge > 300000) { // 5 minutes
        newStatus = 'offline';
        issues.push({
          severity: 'critical',
          type: 'heartbeat_timeout',
          message: `No heartbeat for ${Math.floor(heartbeatAge / 60000)} minutes`,
          timestamp: new Date()
        });
      }

      // Check error rate
      if (health.metrics.errorRate > 10) {
        newStatus = newStatus === 'offline' ? 'offline' : 'degraded';
        issues.push({
          severity: 'high',
          type: 'high_error_rate',
          message: `Error rate: ${health.metrics.errorRate.toFixed(2)}%`,
          timestamp: new Date()
        });
      }

      // Check memory usage
      if (health.metrics.memoryUsage > 3000) { // 3GB
        newStatus = newStatus === 'offline' ? 'offline' : 'unhealthy';
        issues.push({
          severity: 'critical',
          type: 'high_memory_usage',
          message: `Memory usage: ${health.metrics.memoryUsage}MB`,
          timestamp: new Date()
        });
      } else if (health.metrics.memoryUsage > 2000) { // 2GB
        newStatus = (newStatus as AgentStatus) === 'offline' || (newStatus as AgentStatus) === 'unhealthy' ? newStatus : 'degraded';
        issues.push({
          severity: 'medium',
          type: 'elevated_memory_usage',
          message: `Memory usage: ${health.metrics.memoryUsage}MB`,
          timestamp: new Date()
        });
      }

      // Check CPU usage
      if (health.metrics.cpuUsage > 90) {
        newStatus = newStatus === 'offline' || newStatus === 'unhealthy' ? newStatus : 'degraded';
        issues.push({
          severity: 'medium',
          type: 'high_cpu_usage',
          message: `CPU usage: ${health.metrics.cpuUsage}%`,
          timestamp: new Date()
        });
      }

      // Check queue depth
      if (health.metrics.queueDepth > 1000) {
        newStatus = newStatus === 'offline' || newStatus === 'unhealthy' ? newStatus : 'degraded';
        issues.push({
          severity: 'medium',
          type: 'queue_backup',
          message: `Queue depth: ${health.metrics.queueDepth}`,
          timestamp: new Date()
        });
      }

      // Update status if changed
      if (newStatus !== health.status) {
        await this.updateStatus(agentType, instanceId, programId, newStatus);

        // Notify ops about status change
        if (newStatus === 'unhealthy' || newStatus === 'offline') {
          await notification.notifyOps(
            `🔴 Agent ${agentType} ${newStatus}`,
            `Agent ${agentType} (${instanceId}) is now ${newStatus}\n\nIssues:\n${issues.map(i => `• ${i.message}`).join('\n')}`,
            'error'
          );
        }
      }

      // Record issues
      for (const issue of issues) {
        await this.recordIssue(agentType, instanceId, programId, issue);
      }

      // Attempt self-healing if unhealthy
      if (newStatus === 'unhealthy') {
        await this.attemptSelfHealing(agentType, instanceId, programId, issues);
      }

      return newStatus;
    } catch (error: any) {
      logger.error({ error, agentType, instanceId, programId }, 'Failed to check health');
      return 'offline';
    }
  }

  /**
   * Get current health for an agent
   */
  async getHealth(agentType: string, instanceId: string, programId: string): Promise<AgentHealth | null> {
    try {
      const result = await database.query(
        `SELECT * FROM agent_health WHERE agent_type = $1 AND instance_id = $2 AND program_id = $3`,
        [agentType, instanceId, programId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Get active issues
      const issuesResult = await database.query(
        `SELECT * FROM agent_health_issues
         WHERE health_id = (SELECT id FROM agent_health WHERE agent_type = $1 AND instance_id = $2 AND program_id = $3)
           AND resolved_at IS NULL
         ORDER BY created_at DESC`,
        [agentType, instanceId, programId]
      );

      const issues: HealthIssue[] = issuesResult.rows.map((i: any) => ({
        severity: i.severity,
        type: i.type,
        message: i.message,
        timestamp: i.created_at,
        autoHealing: i.auto_healing_attempted ? {
          attempted: true,
          successful: i.auto_healing_successful,
          action: i.auto_healing_action
        } : undefined
      }));

      return {
        agentType: row.agent_type,
        instanceId: row.instance_id,
        programId: row.program_id,
        status: row.status,
        metrics: {
          jobsProcessed: row.jobs_processed,
          jobsFailed: row.jobs_failed,
          avgDuration: row.avg_duration,
          memoryUsage: row.memory_usage,
          cpuUsage: row.cpu_usage,
          queueDepth: row.queue_depth,
          errorRate: parseFloat(row.error_rate)
        },
        lastHeartbeat: row.last_heartbeat,
        issues: issues.length > 0 ? issues : undefined
      };
    } catch (error: any) {
      logger.error({ error, agentType, instanceId, programId }, 'Failed to get health');
      return null;
    }
  }

  /**
   * Update agent status
   */
  private async updateStatus(
    agentType: string,
    instanceId: string,
    programId: string,
    status: AgentStatus
  ): Promise<void> {
    try {
      await database.query(
        `UPDATE agent_health SET status = $1 WHERE agent_type = $2 AND instance_id = $3 AND program_id = $4`,
        [status, agentType, instanceId, programId]
      );

      logger.info({ agentType, instanceId, programId, status }, 'Agent status updated');
    } catch (error: any) {
      logger.error({ error, agentType, instanceId, programId }, 'Failed to update status');
    }
  }

  /**
   * Record a health issue
   */
  private async recordIssue(
    agentType: string,
    instanceId: string,
    programId: string,
    issue: HealthIssue
  ): Promise<void> {
    try {
      const healthId = await database.query(
        `SELECT id FROM agent_health WHERE agent_type = $1 AND instance_id = $2 AND program_id = $3`,
        [agentType, instanceId, programId]
      );

      if (healthId.rows.length === 0) return;

      await database.query(
        `INSERT INTO agent_health_issues (id, health_id, severity, type, message)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuidv4(), healthId.rows[0].id, issue.severity, issue.type, issue.message]
      );
    } catch (error: any) {
      logger.error({ error, issue, agentType, instanceId, programId }, 'Failed to record health issue');
    }
  }

  /**
   * Attempt self-healing actions
   */
  private async attemptSelfHealing(
    agentType: string,
    instanceId: string,
    programId: string,
    issues: HealthIssue[]
  ): Promise<void> {
    for (const issue of issues) {
      try {
        if (issue.type === 'high_memory_usage') {
          // Strategy 1: Force garbage collection
          if (global.gc) {
            const beforeMem = process.memoryUsage().heapUsed;
            global.gc();
            const afterMem = process.memoryUsage().heapUsed;
            const freed = beforeMem - afterMem;

            logger.info({
              agentType,
              instanceId,
              programId,
              freedMB: (freed / 1024 / 1024).toFixed(2)
            }, 'Triggered garbage collection');

            await this.recordHealingAttempt(
              agentType,
              instanceId,
              programId,
              issue,
              freed > 0,
              'garbage_collection'
            );

            // Strategy 2: Clear old cache entries if available
            if (freed < 50 * 1024 * 1024) { // Less than 50MB freed
              logger.warn({ agentType, instanceId, programId }, 'GC freed minimal memory, suggesting restart');
              await notification.notifyOps(
                `⚠️ Agent ${agentType} memory issue`,
                `Agent ${agentType} freed only ${(freed / 1024 / 1024).toFixed(2)}MB. Consider restarting.`,
                'warn'
              );
            }
          }
        } else if (issue.type === 'high_error_rate') {
          // Strategy 3: Pause agent temporarily to prevent cascade failures
          logger.warn({ agentType, instanceId, programId }, 'High error rate detected - implementing circuit breaker');

          // Pause queue for 60 seconds
          const queue = require('./queue').default;
          await queue.pauseAgent(agentType);

          setTimeout(async () => {
            await queue.resumeAgent(agentType);
            logger.info({ agentType, instanceId, programId }, 'Circuit breaker reset - resuming agent');
          }, 60000);

          await this.recordHealingAttempt(
            agentType,
            instanceId,
            programId,
            issue,
            true,
            'circuit_breaker_pause'
          );

          await notification.notifyOps(
            `🔌 Circuit breaker activated`,
            `Agent ${agentType} paused for 60s due to high error rate (${issue.message})`,
            'warn'
          );
        } else if (issue.type === 'queue_backup') {
          // Strategy 4: Clear stuck jobs older than 24 hours
          logger.info({ agentType, instanceId, programId }, 'Clearing stuck jobs from queue backup');

          const clearedCount = await this.clearStuckJobs(agentType);

          await this.recordHealingAttempt(
            agentType,
            instanceId,
            programId,
            issue,
            clearedCount > 0,
            `cleared_${clearedCount}_stuck_jobs`
          );

          if (clearedCount > 0) {
            await notification.notifyOps(
              `🧹 Cleared stuck jobs`,
              `Removed ${clearedCount} stuck jobs from ${agentType} queue`,
              'info'
            );
          }
        } else if (issue.type === 'high_cpu_usage') {
          // Strategy 5: Reduce concurrency temporarily
          logger.warn({ agentType, instanceId, programId }, 'High CPU - suggesting concurrency reduction');

          await notification.notifyOps(
            `⚡ High CPU on ${agentType}`,
            `Agent ${agentType} CPU at ${issue.message}. Consider reducing concurrency or scaling horizontally.`,
            'warn'
          );

          await this.recordHealingAttempt(
            agentType,
            instanceId,
            programId,
            issue,
            false,
            'manual_scaling_suggested'
          );
        }
      } catch (healingError: any) {
        logger.error({
          error: healingError,
          agentType,
          instanceId,
          programId,
          issueType: issue.type
        }, 'Self-healing action failed');
      }
    }
  }

  /**
   * Record self-healing attempt
   */
  private async recordHealingAttempt(
    agentType: string,
    instanceId: string,
    programId: string,
    issue: HealthIssue,
    successful: boolean,
    action: string
  ): Promise<void> {
    try {
      const healthId = await database.query(
        `SELECT id FROM agent_health WHERE agent_type = $1 AND instance_id = $2 AND program_id = $3`,
        [agentType, instanceId, programId]
      );

      if (healthId.rows.length === 0) return;

      await database.query(
        `UPDATE agent_health_issues
         SET auto_healing_attempted = TRUE,
             auto_healing_successful = $1,
             auto_healing_action = $2
         WHERE health_id = $3
           AND type = $4
           AND resolved_at IS NULL`,
        [successful, action, healthId.rows[0].id, issue.type]
      );

      logger.info({ agentType, instanceId, programId, issue: issue.type, successful, action }, 'Self-healing attempt recorded');
    } catch (error: any) {
      logger.error({ error, agentType, instanceId, programId }, 'Failed to record healing attempt');
    }
  }

  /**
   * Clear stuck jobs (jobs active for more than 24 hours)
   */
  private async clearStuckJobs(agentType: string): Promise<number> {
    try {
      // Find stuck jobs
      const result = await database.query(
        `SELECT id FROM jobs
         WHERE status = 'active'
           AND agent_type = $1
           AND updated_at < NOW() - INTERVAL '24 hours'`,
        [agentType]
      );

      const stuckJobIds = result.rows.map((r: any) => r.id);

      if (stuckJobIds.length === 0) {
        return 0;
      }

      // Mark them as failed
      await database.query(
        `UPDATE jobs
         SET status = 'failed',
             error = 'Job stuck for > 24 hours - auto-cleared by health system',
             ended_at = NOW()
         WHERE id = ANY($1)`,
        [stuckJobIds]
      );

      logger.info({ agentType, count: stuckJobIds.length }, 'Cleared stuck jobs');
      return stuckJobIds.length;
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to clear stuck jobs');
      return 0;
    }
  }

  /**
   * Start continuous health monitoring
   */
  async startMonitoring(agentType: string, instanceId: string, programId: string, intervalMs: number = 30000): Promise<void> {
    const key = `${agentType}:${instanceId}:${programId}`;

    // Clear existing monitor if any
    if (this.monitoringIntervals.has(key)) {
      clearInterval(this.monitoringIntervals.get(key)!);
    }

    // Initialize health
    await this.initializeHealth(agentType, instanceId, programId);

    // Start monitoring loop
    const interval = setInterval(async () => {
      const metrics: Partial<HealthMetrics> = {
        memoryUsage: Math.floor(process.memoryUsage().heapUsed / 1024 / 1024),
        cpuUsage: Math.floor(os.loadavg()[0] * 100 / os.cpus().length)
      };

      await this.recordHeartbeat(agentType, instanceId, programId, metrics);
    }, intervalMs);

    this.monitoringIntervals.set(key, interval);

    logger.info({ agentType, instanceId, programId, intervalMs }, 'Health monitoring started');
  }

  /**
   * Stop health monitoring
   */
  stopMonitoring(agentType: string, instanceId: string, programId: string): void {
    const key = `${agentType}:${instanceId}:${programId}`;

    if (this.monitoringIntervals.has(key)) {
      clearInterval(this.monitoringIntervals.get(key)!);
      this.monitoringIntervals.delete(key);

      logger.info({ agentType, instanceId, programId }, 'Health monitoring stopped');
    }
  }

  /**
   * Get overall health summary
   */
  async getHealthSummary(): Promise<any> {
    try {
      const result = await database.query(`SELECT * FROM agent_health_summary`);
      return result.rows;
    } catch (error: any) {
      logger.error({ error }, 'Failed to get health summary');
      return [];
    }
  }
}

export default new AgentHealthService();
