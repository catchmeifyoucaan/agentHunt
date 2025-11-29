/**
 * Load Balancer Service
 * Implements dynamic handoff distribution with agent availability checks
 */

import logger from '../utils/logger';
import database from './database';
import agentHealth from './agent-health';
import queue from './queue';

interface AgentAvailability {
  agentType: string;
  available: boolean;
  queueDepth: number;
  activeJobs: number;
  healthStatus: 'healthy' | 'degraded' | 'unhealthy' | 'offline';
  capacity: number;
  currentLoad: number; // 0-1
}

interface LoadBalancingDecision {
  agentType: string;
  shouldRoute: boolean;
  reason: string;
  alternativeAgents?: string[];
}

class LoadBalancerService {
  private readonly MAX_QUEUE_DEPTH = 100; // Maximum jobs waiting in queue
  private readonly MAX_ACTIVE_JOBS = 20; // Maximum concurrent active jobs
  private readonly HEALTHY_THRESHOLD = 0.8; // 80% capacity is considered healthy

  /**
   * Check if an agent is available to accept new handoffs
   */
  async checkAgentAvailability(agentType: string): Promise<AgentAvailability> {
    try {
      // Get agent health status
      const healthResult = await database.query(
        `SELECT 
          agent_type,
          status,
          queue_depth,
          jobs_processed,
          jobs_failed,
          last_heartbeat
        FROM agent_health
        WHERE agent_type = $1
        ORDER BY last_heartbeat DESC
        LIMIT 1`,
        [agentType]
      );

      if (healthResult.rows.length === 0) {
        return {
          agentType,
          available: false,
          queueDepth: 0,
          activeJobs: 0,
          healthStatus: 'offline',
          capacity: 0,
          currentLoad: 1.0,
        };
      }

      const health = healthResult.rows[0];
      const queueDepth = parseInt(health.queue_depth || '0');
      const activeJobs = await this.getActiveJobCount(agentType);
      const healthStatus = health.status as 'healthy' | 'degraded' | 'unhealthy' | 'offline';

      // Calculate capacity and load
      const capacity = this.MAX_ACTIVE_JOBS;
      const currentLoad = activeJobs / capacity;

      // Determine availability
      const available =
        healthStatus === 'healthy' &&
        queueDepth < this.MAX_QUEUE_DEPTH &&
        currentLoad < this.HEALTHY_THRESHOLD;

      return {
        agentType,
        available,
        queueDepth,
        activeJobs,
        healthStatus,
        capacity,
        currentLoad,
      };
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to check agent availability');
      return {
        agentType,
        available: false,
        queueDepth: 0,
        activeJobs: 0,
        healthStatus: 'offline',
        capacity: 0,
        currentLoad: 1.0,
      };
    }
  }

  /**
   * Get active job count for an agent type
   */
  private async getActiveJobCount(agentType: string): Promise<number> {
    try {
      const result = await database.query(
        `SELECT COUNT(*) as count
        FROM jobs
        WHERE type = $1 AND status IN ('pending', 'active')
        `,
        [agentType]
      );
      return parseInt(result.rows[0]?.count || '0');
    } catch (error) {
      logger.error({ error, agentType }, 'Failed to get active job count');
      return 0;
    }
  }

  /**
   * Make load balancing decision for a handoff
   */
  async shouldRouteHandoff(
    toAgentType: string,
    alternativeAgents?: string[]
  ): Promise<LoadBalancingDecision> {
    try {
      const availability = await this.checkAgentAvailability(toAgentType);

      if (availability.available) {
        return {
          agentType: toAgentType,
          shouldRoute: true,
          reason: 'Agent is available and healthy',
        };
      }

      // Agent is not available, check alternatives
      if (alternativeAgents && alternativeAgents.length > 0) {
        for (const altAgent of alternativeAgents) {
          const altAvailability = await this.checkAgentAvailability(altAgent);
          if (altAvailability.available) {
            return {
              agentType: altAgent,
              shouldRoute: true,
              reason: `Primary agent unavailable, routing to alternative: ${altAgent}`,
              alternativeAgents: [altAgent],
            };
          }
        }
      }

      // No agents available
      return {
        agentType: toAgentType,
        shouldRoute: false,
        reason: `Agent ${toAgentType} is unavailable: ${availability.healthStatus}, queue depth: ${availability.queueDepth}, load: ${(availability.currentLoad * 100).toFixed(0)}%`,
        alternativeAgents,
      };
    } catch (error: any) {
      logger.error({ error, toAgentType }, 'Failed to make load balancing decision');
      return {
        agentType: toAgentType,
        shouldRoute: false,
        reason: `Error checking availability: ${error.message}`,
      };
    }
  }

  /**
   * Get best available agent from a list of candidates
   */
  async selectBestAgent(agentCandidates: string[]): Promise<string | null> {
    try {
      const availabilities = await Promise.all(
        agentCandidates.map((agent) => this.checkAgentAvailability(agent))
      );

      // Filter available agents
      const available = availabilities.filter((a) => a.available);

      if (available.length === 0) {
        return null;
      }

      // Sort by load (lowest first), then by queue depth
      available.sort((a, b) => {
        if (a.currentLoad !== b.currentLoad) {
          return a.currentLoad - b.currentLoad;
        }
        return a.queueDepth - b.queueDepth;
      });

      return available[0].agentType;
    } catch (error: any) {
      logger.error({ error, agentCandidates }, 'Failed to select best agent');
      return null;
    }
  }

  /**
   * Check if queue is full and apply backpressure
   */
  async checkQueueFull(agentType: string): Promise<{
    isFull: boolean;
    queueDepth: number;
    shouldBackpressure: boolean;
  }> {
    try {
      const availability = await this.checkAgentAvailability(agentType);
      const isFull = availability.queueDepth >= this.MAX_QUEUE_DEPTH;
      const shouldBackpressure = isFull || availability.currentLoad >= this.HEALTHY_THRESHOLD;

      return {
        isFull,
        queueDepth: availability.queueDepth,
        shouldBackpressure,
      };
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to check queue full status');
      return {
        isFull: true, // Assume full on error to be safe
        queueDepth: 0,
        shouldBackpressure: true,
      };
    }
  }

  /**
   * Get load balancing recommendations
   */
  async getRecommendations(): Promise<
    Array<{
      agentType: string;
      issue: string;
      recommendation: string;
      severity: 'critical' | 'high' | 'medium' | 'low';
    }>
  > {
    try {
      const agentTypes = [
        'discovery',
        'subdomain',
        'bruteforce',
        'fingerprint',
        'crawl',
        'portscan',
        'scanner',
        'interact',
        'confirm',
        'triage',
        'osint',
        'xss',
        'sqli',
        'webvulns',
        'jsanalysis',
        'cloudmisconfig',
      ];

      const recommendations: any[] = [];

      for (const agentType of agentTypes) {
        const availability = await this.checkAgentAvailability(agentType);

        if (!availability.available) {
          let severity: 'critical' | 'high' | 'medium' | 'low' = 'low';
          let issue = '';
          let recommendation = '';

          if (availability.healthStatus === 'offline') {
            severity = 'critical';
            issue = `Agent ${agentType} is offline`;
            recommendation = 'Check agent health and restart if needed';
          } else if (availability.queueDepth >= this.MAX_QUEUE_DEPTH) {
            severity = 'high';
            issue = `Queue depth (${availability.queueDepth}) exceeds maximum (${this.MAX_QUEUE_DEPTH})`;
            recommendation = 'Scale up workers or reduce job creation rate';
          } else if (availability.currentLoad >= this.HEALTHY_THRESHOLD) {
            severity = 'medium';
            issue = `High load (${(availability.currentLoad * 100).toFixed(0)}%) on ${agentType}`;
            recommendation = 'Consider adding more workers or reducing concurrency';
          }

          if (issue) {
            recommendations.push({
              agentType,
              issue,
              recommendation,
              severity,
            });
          }
        }
      }

      return recommendations;
    } catch (error: any) {
      logger.error({ error }, 'Failed to get load balancing recommendations');
      return [];
    }
  }
}

export const loadBalancer = new LoadBalancerService();
export default loadBalancer;
