/**
 * Auto-Scaling Service
 * 
 * Provides automatic worker scaling based on:
 * - Queue depth
 * - CPU/Memory utilization
 * - Time of day
 * - Cost constraints
 * 
 * Supports:
 * - Kubernetes HPA integration
 * - Docker Swarm scaling
 * - AWS ECS/Fargate
 * - Manual scaling triggers
 */

import logger from '../utils/logger';
import database from './database';
import redis from './redis';
import { metrics } from './metrics';
import { alerting } from './alerting';
import { v4 as uuidv4 } from 'uuid';

interface ScalingConfig {
  enabled: boolean;
  minWorkers: number;
  maxWorkers: number;
  targetQueueDepth: number;
  scaleUpThreshold: number;
  scaleDownThreshold: number;
  cooldownPeriod: number; // seconds
  costLimit?: number; // dollars per hour
  provider: 'kubernetes' | 'docker-swarm' | 'aws-ecs' | 'manual';
  providerConfig?: Record<string, any>;
}

interface ScalingDecision {
  id: string;
  timestamp: Date;
  currentWorkers: number;
  targetWorkers: number;
  reason: string;
  metrics: {
    queueDepth: number;
    avgProcessingTime: number;
    cpuUtilization?: number;
    memoryUtilization?: number;
  };
  executed: boolean;
}

interface WorkerStatus {
  id: string;
  type: string;
  status: 'running' | 'idle' | 'stopping';
  startedAt: Date;
  jobsProcessed: number;
  lastHeartbeat: Date;
}

const DEFAULT_CONFIG: ScalingConfig = {
  enabled: false,
  minWorkers: 1,
  maxWorkers: 10,
  targetQueueDepth: 100,
  scaleUpThreshold: 1.5, // Scale up when queue > target * 1.5
  scaleDownThreshold: 0.3, // Scale down when queue < target * 0.3
  cooldownPeriod: 300, // 5 minutes
  provider: 'manual',
};

class AutoScalingService {
  private config: ScalingConfig = DEFAULT_CONFIG;
  private currentWorkers: number = 1;
  private lastScalingAction: Date = new Date(0);
  private scalingHistory: ScalingDecision[] = [];
  private workers: Map<string, WorkerStatus> = new Map();

  /**
   * Configure auto-scaling
   */
  configure(config: Partial<ScalingConfig>): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
    logger.info({ config: this.config }, 'Auto-scaling configured');
  }

  /**
   * Register a worker
   */
  registerWorker(workerId: string, type: string): void {
    this.workers.set(workerId, {
      id: workerId,
      type,
      status: 'running',
      startedAt: new Date(),
      jobsProcessed: 0,
      lastHeartbeat: new Date(),
    });
    this.currentWorkers = this.workers.size;
    logger.info({ workerId, type, totalWorkers: this.currentWorkers }, 'Worker registered');
  }

  /**
   * Unregister a worker
   */
  unregisterWorker(workerId: string): void {
    this.workers.delete(workerId);
    this.currentWorkers = this.workers.size;
    logger.info({ workerId, totalWorkers: this.currentWorkers }, 'Worker unregistered');
  }

  /**
   * Update worker heartbeat
   */
  heartbeat(workerId: string, jobsProcessed?: number): void {
    const worker = this.workers.get(workerId);
    if (worker) {
      worker.lastHeartbeat = new Date();
      if (jobsProcessed !== undefined) {
        worker.jobsProcessed = jobsProcessed;
      }
    }
  }

  /**
   * Evaluate scaling needs
   */
  async evaluate(): Promise<ScalingDecision | null> {
    if (!this.config.enabled) {
      return null;
    }

    // Check cooldown
    const timeSinceLastAction = Date.now() - this.lastScalingAction.getTime();
    if (timeSinceLastAction < this.config.cooldownPeriod * 1000) {
      return null;
    }

    // Gather metrics
    const queueDepth = await this.getTotalQueueDepth();
    const avgProcessingTime = await this.getAverageProcessingTime();

    const currentMetrics = {
      queueDepth,
      avgProcessingTime,
    };

    // Calculate target workers
    let targetWorkers = this.currentWorkers;
    let reason = '';

    const queueRatio = queueDepth / this.config.targetQueueDepth;

    if (queueRatio > this.config.scaleUpThreshold && this.currentWorkers < this.config.maxWorkers) {
      // Scale up
      const additionalWorkers = Math.ceil((queueDepth - this.config.targetQueueDepth) / this.config.targetQueueDepth);
      targetWorkers = Math.min(this.currentWorkers + additionalWorkers, this.config.maxWorkers);
      reason = `Queue depth (${queueDepth}) exceeds threshold (${this.config.targetQueueDepth * this.config.scaleUpThreshold})`;
    } else if (queueRatio < this.config.scaleDownThreshold && this.currentWorkers > this.config.minWorkers) {
      // Scale down
      targetWorkers = Math.max(this.currentWorkers - 1, this.config.minWorkers);
      reason = `Queue depth (${queueDepth}) below threshold (${this.config.targetQueueDepth * this.config.scaleDownThreshold})`;
    }

    // Check cost limit
    if (this.config.costLimit && targetWorkers > this.currentWorkers) {
      const estimatedCost = await this.estimateHourlyCost(targetWorkers);
      if (estimatedCost > this.config.costLimit) {
        targetWorkers = this.currentWorkers;
        reason = `Cost limit would be exceeded ($${estimatedCost}/hr > $${this.config.costLimit}/hr)`;
      }
    }

    if (targetWorkers === this.currentWorkers) {
      return null;
    }

    const decision: ScalingDecision = {
      id: uuidv4(),
      timestamp: new Date(),
      currentWorkers: this.currentWorkers,
      targetWorkers,
      reason,
      metrics: currentMetrics,
      executed: false,
    };

    return decision;
  }

  /**
   * Execute scaling decision
   */
  async executeScaling(decision: ScalingDecision): Promise<boolean> {
    logger.info({
      decisionId: decision.id,
      from: decision.currentWorkers,
      to: decision.targetWorkers,
      reason: decision.reason,
    }, 'Executing scaling decision');

    try {
      switch (this.config.provider) {
        case 'kubernetes':
          await this.scaleKubernetes(decision.targetWorkers);
          break;
        case 'docker-swarm':
          await this.scaleDockerSwarm(decision.targetWorkers);
          break;
        case 'aws-ecs':
          await this.scaleAWSECS(decision.targetWorkers);
          break;
        case 'manual':
          logger.info({ targetWorkers: decision.targetWorkers }, 'Manual scaling required');
          await alerting.sendAlert({
            type: 'system_health',
            severity: 'medium',
            title: 'Manual Scaling Required',
            message: `Scale workers from ${decision.currentWorkers} to ${decision.targetWorkers}\nReason: ${decision.reason}`,
            metadata: decision,
          });
          break;
      }

      decision.executed = true;
      this.lastScalingAction = new Date();
      this.scalingHistory.push(decision);

      // Keep only last 100 decisions
      if (this.scalingHistory.length > 100) {
        this.scalingHistory = this.scalingHistory.slice(-100);
      }

      // Record metric
      metrics.setGauge('agenthunt_workers_target', {}, decision.targetWorkers);

      return true;
    } catch (error) {
      logger.error({ error, decision }, 'Failed to execute scaling');
      return false;
    }
  }

  /**
   * Scale Kubernetes deployment
   */
  private async scaleKubernetes(replicas: number): Promise<void> {
    const namespace = this.config.providerConfig?.namespace || 'default';
    const deployment = this.config.providerConfig?.deployment || 'agenthunt-worker';

    // Would use @kubernetes/client-node
    logger.info({ namespace, deployment, replicas }, 'Scaling Kubernetes deployment');

    // kubectl scale deployment/agenthunt-worker --replicas=N
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      await execAsync(`kubectl scale deployment/${deployment} --replicas=${replicas} -n ${namespace}`);
    } catch (error) {
      logger.error({ error }, 'kubectl scale failed');
      throw error;
    }
  }

  /**
   * Scale Docker Swarm service
   */
  private async scaleDockerSwarm(replicas: number): Promise<void> {
    const service = this.config.providerConfig?.service || 'agenthunt_worker';

    logger.info({ service, replicas }, 'Scaling Docker Swarm service');

    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      await execAsync(`docker service scale ${service}=${replicas}`);
    } catch (error) {
      logger.error({ error }, 'docker service scale failed');
      throw error;
    }
  }

  /**
   * Scale AWS ECS service
   */
  private async scaleAWSECS(replicas: number): Promise<void> {
    const cluster = this.config.providerConfig?.cluster || 'agenthunt';
    const service = this.config.providerConfig?.service || 'agenthunt-worker';

    logger.info({ cluster, service, replicas }, 'Scaling AWS ECS service');

    // Would use @aws-sdk/client-ecs
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);

    try {
      await execAsync(
        `aws ecs update-service --cluster ${cluster} --service ${service} --desired-count ${replicas}`
      );
    } catch (error) {
      logger.error({ error }, 'aws ecs update-service failed');
      throw error;
    }
  }

  /**
   * Get total queue depth across all queues
   */
  private async getTotalQueueDepth(): Promise<number> {
    try {
      const queues = ['discovery', 'fingerprint', 'scanner', 'crawl', 'triage', 'xss', 'sqli'];
      let total = 0;

      for (const queue of queues) {
        try {
          const waiting = await (redis as any).llen?.(`bull:${queue}:wait`) || 0;
          const active = await (redis as any).llen?.(`bull:${queue}:active`) || 0;
          total += waiting + active;
        } catch {
          // Queue might not exist
        }
      }

      return total;
    } catch (error) {
      logger.debug({ error }, 'Failed to get queue depth');
      return 0;
    }
  }

  /**
   * Get average processing time
   */
  private async getAverageProcessingTime(): Promise<number> {
    try {
      const result = await database.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_time
         FROM jobs
         WHERE status = 'completed'
           AND completed_at > NOW() - INTERVAL '1 hour'`
      );
      return parseFloat(result.rows[0]?.avg_time || '0');
    } catch {
      return 0;
    }
  }

  /**
   * Estimate hourly cost
   */
  private async estimateHourlyCost(workers: number): Promise<number> {
    // Simple cost model: $0.10 per worker per hour
    const costPerWorkerHour = this.config.providerConfig?.costPerWorkerHour || 0.10;
    return workers * costPerWorkerHour;
  }

  /**
   * Get scaling history
   */
  getHistory(): ScalingDecision[] {
    return this.scalingHistory;
  }

  /**
   * Get current status
   */
  getStatus(): {
    enabled: boolean;
    currentWorkers: number;
    minWorkers: number;
    maxWorkers: number;
    workers: WorkerStatus[];
    lastScalingAction: Date;
  } {
    return {
      enabled: this.config.enabled,
      currentWorkers: this.currentWorkers,
      minWorkers: this.config.minWorkers,
      maxWorkers: this.config.maxWorkers,
      workers: Array.from(this.workers.values()),
      lastScalingAction: this.lastScalingAction,
    };
  }

  /**
   * Start auto-scaling loop
   */
  startAutoScaling(intervalMs: number = 60000): NodeJS.Timeout {
    logger.info({ intervalMs }, 'Starting auto-scaling loop');

    return setInterval(async () => {
      try {
        const decision = await this.evaluate();
        if (decision) {
          await this.executeScaling(decision);
        }
      } catch (error) {
        logger.error({ error }, 'Auto-scaling evaluation failed');
      }
    }, intervalMs);
  }

  /**
   * Force scale to specific count
   */
  async forceScale(targetWorkers: number, reason: string = 'Manual override'): Promise<boolean> {
    const decision: ScalingDecision = {
      id: uuidv4(),
      timestamp: new Date(),
      currentWorkers: this.currentWorkers,
      targetWorkers: Math.max(this.config.minWorkers, Math.min(targetWorkers, this.config.maxWorkers)),
      reason,
      metrics: {
        queueDepth: await this.getTotalQueueDepth(),
        avgProcessingTime: await this.getAverageProcessingTime(),
      },
      executed: false,
    };

    return this.executeScaling(decision);
  }
}

export const autoScaling = new AutoScalingService();
export default autoScaling;
