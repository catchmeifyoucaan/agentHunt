/**
 * Agent Graph Routes - Phase 4: Graph of Agents
 *
 * REST API endpoints for multi-agent graph management:
 * - POST /agent-graph/orchestrate - Orchestrate scan using agent graph
 * - GET /agent-graph/statistics - Get graph and agent statistics
 * - GET /agent-graph/export - Export graph structure
 * - GET /agent-graph/agents - List all agents in graph
 * - GET /agent-graph/agents/:id - Get specific agent details
 * - GET /agent-graph/knowledge - Get knowledge base statistics
 * - GET /agent-graph/discoveries - Get agent discoveries
 * - GET /agent-graph/strategies - Get attack strategies
 */

import { Router, Request, Response } from 'express';
import { agentCoordinator } from '../services/agent-coordinator';
import logger from '../utils/logger';

const router = Router();

/**
 * POST /agent-graph/orchestrate
 * Orchestrate a scan using the multi-agent graph
 *
 * Body:
 * - programId: Program ID to scan
 */
router.post('/orchestrate', async (req: Request, res: Response) => {
  try {
    const { programId } = req.body;

    if (!programId) {
      return res.status(400).json({
        error: 'Missing required field: programId',
      });
    }

    logger.info({ programId }, 'Starting orchestrated scan');

    const result = await agentCoordinator.orchestrateScan(programId);

    res.json({
      message: 'Scan orchestration completed',
      result,
    });
  } catch (error: any) {
    logger.error({ error, programId: req.body.programId }, 'Failed to orchestrate scan');
    res.status(500).json({
      error: 'Failed to orchestrate scan',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/statistics
 * Get comprehensive statistics about the agent graph
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const [coordinatorStats, agentStats] = await Promise.all([
      agentCoordinator.getStatistics(),
      agentCoordinator.getAgentStatistics(),
    ]);

    res.json({
      coordinator: coordinatorStats,
      agents: agentStats,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get agent graph statistics');
    res.status(500).json({
      error: 'Failed to get statistics',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/export
 * Export agent graph structure for visualization
 */
router.get('/export', async (req: Request, res: Response) => {
  try {
    const graph = agentCoordinator.exportGraph();

    res.json({
      graph,
      metadata: {
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        exportedAt: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to export agent graph');
    res.status(500).json({
      error: 'Failed to export graph',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/agents
 * List all agents in the graph
 */
router.get('/agents', async (req: Request, res: Response) => {
  try {
    const graph = agentCoordinator.getGraph();
    const agents = graph.getAllAgents();

    res.json({
      agents: agents.map((agent) => ({
        id: agent.id,
        specialization: agent.specialization,
        capacity: agent.capacity,
        currentLoad: agent.currentLoad,
        utilization: agent.capacity > 0 ? agent.currentLoad / agent.capacity : 0,
        metadata: agent.metadata,
      })),
      count: agents.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to list agents');
    res.status(500).json({
      error: 'Failed to list agents',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/agents/:id
 * Get detailed information about a specific agent
 */
router.get('/agents/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const graph = agentCoordinator.getGraph();

    const agent = graph.getAgent(id);

    if (!agent) {
      return res.status(404).json({
        error: `Agent ${id} not found`,
      });
    }

    const edges = graph.getEdges(id);

    res.json({
      agent: {
        id: agent.id,
        specialization: agent.specialization,
        capacity: agent.capacity,
        currentLoad: agent.currentLoad,
        utilization: agent.capacity > 0 ? agent.currentLoad / agent.capacity : 0,
        metadata: agent.metadata,
      },
      edges: edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        type: edge.type,
        weight: edge.weight,
        metadata: edge.metadata,
      })),
    });
  } catch (error: any) {
    logger.error({ error, agentId: req.params.id }, 'Failed to get agent details');
    res.status(500).json({
      error: 'Failed to get agent details',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/knowledge
 * Get knowledge base statistics
 */
router.get('/knowledge', async (req: Request, res: Response) => {
  try {
    const graph = agentCoordinator.getGraph();
    const stats = graph.sharedState.getStatistics();

    res.json({
      knowledgeBase: stats,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get knowledge base statistics');
    res.status(500).json({
      error: 'Failed to get knowledge base statistics',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/discoveries
 * Get agent discoveries from knowledge base
 *
 * Query params:
 * - target: Filter by target URL/domain
 * - type: Filter by discovery type
 * - limit: Maximum results (default: 100)
 */
router.get('/discoveries', async (req: Request, res: Response) => {
  try {
    const target = req.query.target as string | undefined;
    const type = req.query.type as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

    const graph = agentCoordinator.getGraph();

    if (!target) {
      return res.status(400).json({
        error: 'Missing required query parameter: target',
      });
    }

    const discoveries = await graph.sharedState.getDiscoveries(target, type);

    res.json({
      discoveries: discoveries.slice(0, limit),
      count: discoveries.length,
      target,
      type,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get discoveries');
    res.status(500).json({
      error: 'Failed to get discoveries',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/strategies
 * Get attack strategies from knowledge base
 *
 * Query params:
 * - type: Vulnerability type (e.g., 'sqli', 'xss', 'rce')
 * - limit: Maximum results (default: 50)
 */
router.get('/strategies', async (req: Request, res: Response) => {
  try {
    const type = req.query.type as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    if (!type) {
      return res.status(400).json({
        error: 'Missing required query parameter: type',
      });
    }

    const graph = agentCoordinator.getGraph();
    const strategies = await graph.sharedState.getStrategies(type);

    res.json({
      strategies: strategies.slice(0, limit).map((s) => ({
        id: s.id,
        type: s.type,
        technique: s.technique,
        successRate: s.successRate,
        successCount: s.successCount,
        attemptCount: s.attemptCount,
        sharedBy: s.sharedBy,
        timestamp: s.timestamp,
        targetPattern: s.targetPattern,
      })),
      count: strategies.length,
      type,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get strategies');
    res.status(500).json({
      error: 'Failed to get strategies',
      message: error.message,
    });
  }
});

/**
 * POST /agent-graph/initialize
 * Initialize the agent coordinator
 */
router.post('/initialize', async (req: Request, res: Response) => {
  try {
    await agentCoordinator.initialize();

    res.json({
      message: 'Agent coordinator initialized',
      statistics: agentCoordinator.getStatistics(),
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to initialize agent coordinator');
    res.status(500).json({
      error: 'Failed to initialize coordinator',
      message: error.message,
    });
  }
});

export default router;
