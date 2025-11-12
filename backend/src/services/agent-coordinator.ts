/**
 * Agent Coordinator - Phase 4: Graph of Agents
 *
 * Central orchestrator for multi-agent coordination:
 * - Initializes agent graph with specialized agents
 * - Distributes work intelligently across agents
 * - Monitors agent discoveries and coordinates responses
 * - Manages agent lifecycle and load balancing
 * - Provides graph analytics and visualization
 *
 * Enables 4-10x better scalability through distributed parallel execution.
 */

import { AgentGraph } from '../graph/agent-graph';
import logger from '../utils/logger';
import database from '../config/database';
import events from './events';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

/**
 * Orchestration result
 */
export interface OrchestrationResult {
  programId: string;
  totalTargets: number;
  assignments: Array<{
    agentId: string;
    jobId: string;
    targetCount: number;
    specialization: string;
  }>;
  duration: number;
}

/**
 * Agent statistics
 */
export interface AgentStatistics {
  agentId: string;
  specialization: string[];
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  avgDuration: number;
  successRate: number;
  currentLoad: number;
  capacity: number;
}

/**
 * AgentCoordinator - Orchestrates multi-agent system
 */
export class AgentCoordinator {
  private static instance: AgentCoordinator;
  private graph: AgentGraph;
  private tracer = trace.getTracer('agenthunt-coordinator');
  private isInitialized = false;

  private constructor() {
    this.graph = new AgentGraph();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AgentCoordinator {
    if (!AgentCoordinator.instance) {
      AgentCoordinator.instance = new AgentCoordinator();
    }
    return AgentCoordinator.instance;
  }

  /**
   * Initialize the agent graph with specialized agents
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Agent coordinator already initialized');
      return;
    }

    logger.info('Initializing agent coordinator');

    // Register specialized agents
    // Note: Actual agent instances are created by workers, we just register their capabilities

    // WordPress specialist - handles all WordPress sites
    this.graph.addAgent('wordpress_specialist', null, ['wordpress'], 100, {
      features: ['wp_scan', 'wp_plugin_enum', 'wp_user_enum'],
      version: '1.0.0',
    });

    // Joomla specialist - handles all Joomla sites
    this.graph.addAgent('joomla_specialist', null, ['joomla'], 50, {
      features: ['joomla_scan', 'joomla_config_check'],
      version: '1.0.0',
    });

    // Drupal specialist - handles all Drupal sites
    this.graph.addAgent('drupal_specialist', null, ['drupal'], 50, {
      features: ['drupal_scan', 'drupal_module_check'],
      version: '1.0.0',
    });

    // API specialist - handles all API endpoints
    this.graph.addAgent('api_specialist', null, ['api', 'rest', 'graphql'], 200, {
      features: ['api_scan', 'graphql_introspection', 'rest_fuzzing'],
      version: '1.0.0',
    });

    // Generic scanner - handles everything else (wildcard)
    this.graph.addAgent('generic_scanner', null, ['*'], 500, {
      features: ['nuclei', 'httpx', 'katana'],
      version: '1.0.0',
    });

    // Set up agent relationships (edges)
    this.setupAgentRelationships();

    // Subscribe to agent discovery events
    this.subscribeToEvents();

    this.isInitialized = true;
    logger.info(
      {
        agents: this.graph.getAllAgents().length,
        stats: this.graph.getStatistics(),
      },
      'Agent coordinator initialized'
    );
  }

  /**
   * Set up relationships between agents
   */
  private setupAgentRelationships(): void {
    // WordPress specialist can handoff to SQLi specialist if needed
    this.graph.connect('wordpress_specialist', 'sqli_specialist', 'handoff', 0.8);

    // API specialist can coordinate with scanner for detailed testing
    this.graph.connect('api_specialist', 'generic_scanner', 'coordination', 0.6);

    // All specialists share state with each other
    const specialists = ['wordpress_specialist', 'joomla_specialist', 'drupal_specialist', 'api_specialist'];
    for (const agent1 of specialists) {
      for (const agent2 of specialists) {
        if (agent1 !== agent2) {
          this.graph.connect(agent1, agent2, 'shared_state', 1.0);
        }
      }
    }

    // Generic scanner is fallback for all specialists
    for (const specialist of specialists) {
      this.graph.connect(specialist, 'generic_scanner', 'fallback', 0.5);
    }

    logger.debug('Agent relationships configured');
  }

  /**
   * Subscribe to agent discovery events
   */
  private subscribeToEvents(): void {
    // Listen for agent discoveries
    events.on('agent:discovery', async (event: any) => {
      await this.handleAgentDiscovery(event);
    });

    logger.debug('Subscribed to agent events');
  }

  /**
   * Handle agent discovery event
   */
  private async handleAgentDiscovery(event: any): Promise<void> {
    const { sourceAgent, discovery } = event;

    logger.info(
      {
        sourceAgent,
        discoveryType: discovery.type,
        target: discovery.target,
      },
      'Handling agent discovery'
    );

    // High-value target? Alert all agents
    if (discovery.type === 'high_value_target' || discovery.confidence >= 0.9) {
      await this.broadcastToAgents(discovery);
    }

    // WordPress discovered? Notify WordPress specialist
    if (discovery.type === 'technology' && discovery.details.technology === 'WordPress') {
      await this.notifyAgent('wordpress_specialist', discovery);
    }

    // API endpoint discovered? Notify API specialist
    if (discovery.type === 'api_endpoint') {
      await this.notifyAgent('api_specialist', discovery);
    }
  }

  /**
   * Broadcast discovery to all agents
   */
  private async broadcastToAgents(discovery: any): Promise<void> {
    logger.info(
      {
        discoveryType: discovery.type,
        target: discovery.target,
      },
      'Broadcasting discovery to all agents'
    );

    await events.emit('agent:broadcast', {
      type: 'broadcast',
      discovery,
    });
  }

  /**
   * Notify specific agent about a discovery
   */
  private async notifyAgent(agentId: string, discovery: any): Promise<void> {
    logger.debug(
      {
        agentId,
        discoveryType: discovery.type,
      },
      'Notifying agent about discovery'
    );

    await events.emit(`agent:${agentId}:notify`, {
      type: 'notification',
      discovery,
    });
  }

  /**
   * Orchestrate a full scan using the agent graph
   */
  async orchestrateScan(programId: string): Promise<OrchestrationResult> {
    const span = this.tracer.startSpan('coordinator.orchestrate_scan', {
      attributes: {
        'coordinator.program_id': programId,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      const startTime = Date.now();

      try {
        if (!this.isInitialized) {
          await this.initialize();
        }

        logger.info({ programId }, 'Orchestrating scan');

        // 1. Get all assets from database
        const assets = await this.getAssets(programId);

        if (assets.length === 0) {
          logger.warn({ programId }, 'No assets found for program');
          span.setAttribute('coordinator.assets_count', 0);
          span.setStatus({ code: SpanStatusCode.OK });

          return {
            programId,
            totalTargets: 0,
            assignments: [],
            duration: Date.now() - startTime,
          };
        }

        // 2. Distribute work across specialized agents
        const assignments = await this.graph.distributeWork(assets, programId);

        const duration = Date.now() - startTime;

        span.setAttributes({
          'coordinator.assets_count': assets.length,
          'coordinator.assignments_count': assignments.length,
          'coordinator.duration_ms': duration,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        logger.info(
          {
            programId,
            totalAssets: assets.length,
            assignments: assignments.length,
            duration,
          },
          'Scan orchestration completed'
        );

        return {
          programId,
          totalTargets: assets.length,
          assignments: assignments.map((a) => ({
            agentId: a.agentId,
            jobId: a.jobId,
            targetCount: a.targets.length,
            specialization: a.specialization,
          })),
          duration,
        };
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        logger.error({ error, programId }, 'Failed to orchestrate scan');
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Get assets for a program
   */
  private async getAssets(programId: string): Promise<any[]> {
    try {
      const result = await database.query(
        `SELECT id, value, type, metadata, status
         FROM assets
         WHERE program_id = $1
         AND status = 'active'
         ORDER BY created_at DESC
         LIMIT 10000`,
        [programId]
      );

      return result.rows.map((row) => ({
        id: row.id,
        value: row.value,
        type: row.type,
        metadata: row.metadata || {},
        status: row.status,
      }));
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to get assets');
      return [];
    }
  }

  /**
   * Get agent statistics
   */
  async getAgentStatistics(): Promise<AgentStatistics[]> {
    const agents = this.graph.getAllAgents();
    const stats: AgentStatistics[] = [];

    for (const agent of agents) {
      try {
        // Get job statistics from database
        const result = await database.query(
          `SELECT
            COUNT(*) as total_jobs,
            COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
            COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
            AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration
           FROM jobs
           WHERE type = $1
           AND created_at > NOW() - INTERVAL '7 days'`,
          [agent.id]
        );

        const row = result.rows[0] || {};
        const totalJobs = parseInt(row.total_jobs || '0', 10);
        const completedJobs = parseInt(row.completed_jobs || '0', 10);
        const failedJobs = parseInt(row.failed_jobs || '0', 10);
        const avgDuration = parseFloat(row.avg_duration || '0');

        stats.push({
          agentId: agent.id,
          specialization: agent.specialization,
          totalJobs,
          completedJobs,
          failedJobs,
          avgDuration,
          successRate: totalJobs > 0 ? completedJobs / totalJobs : 0,
          currentLoad: agent.currentLoad,
          capacity: agent.capacity,
        });
      } catch (error: any) {
        logger.error({ error, agentId: agent.id }, 'Failed to get agent statistics');
      }
    }

    return stats;
  }

  /**
   * Get the agent graph instance
   */
  getGraph(): AgentGraph {
    return this.graph;
  }

  /**
   * Get coordinator statistics
   */
  getStatistics(): {
    initialized: boolean;
    graph: ReturnType<AgentGraph['getStatistics']>;
    knowledgeBase: ReturnType<AgentGraph['sharedState']['getStatistics']>;
  } {
    return {
      initialized: this.isInitialized,
      graph: this.graph.getStatistics(),
      knowledgeBase: this.graph.sharedState.getStatistics(),
    };
  }

  /**
   * Export agent graph (for visualization)
   */
  exportGraph(): ReturnType<AgentGraph['exportGraph']> {
    return this.graph.exportGraph();
  }
}

/**
 * Export singleton instance
 */
export const agentCoordinator = AgentCoordinator.getInstance();

export default agentCoordinator;
