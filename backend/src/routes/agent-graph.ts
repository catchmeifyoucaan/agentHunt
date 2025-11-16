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
import database from '../services/database';

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
    // Get coordinator stats (for orchestration layer)
    const coordinatorStats = agentCoordinator.getStatistics();

    // Get REAL agent statistics from database (24 agents, not 5 coordinator specialists)
    const allAgentTypes = [
      // Discovery & Recon
      'subdomain', 'discovery', 'fingerprint', 'portscan', 'osint',
      // Web Security
      'crawl', 'scanner', 'xss', 'sqli', 'webvulns',
      // API & Cloud
      'apifuzz', 'cloudmisconfig',
      // Advanced
      'jsanalysis', 'confirm', 'triage', 'bruteforce', 'interact', 'browser',
      // Three-Agent Architecture (THE MOST POWERFUL!)
      'planner', 'executor', 'researcher',
      // Specialized
      'ssrf', 'autonomous-scanner', 'intelligent-triage'
    ];

    const agentStatsResult = await database.query(`
      SELECT
        type as agent_type,
        COUNT(*) FILTER (WHERE status = 'active') as active_jobs,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
        COUNT(*) as total_jobs,
        AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))) as avg_duration_seconds
      FROM jobs
      GROUP BY type
      ORDER BY total_jobs DESC
    `);

    const statsMap: Record<string, any> = {};
    agentStatsResult.rows.forEach((row: any) => {
      statsMap[row.agent_type] = row;
    });

    const capacityMap: Record<string, number> = {
      'subdomain': 500, 'discovery': 300, 'fingerprint': 200, 'portscan': 150,
      'crawl': 100, 'osint': 100, 'apifuzz': 100,
      'scanner': 50, 'browser': 30, 'bruteforce': 25, 'interact': 20,
      'confirm': 150, 'triage': 100,
      'xss': 75, 'sqli': 75, 'ssrf': 75, 'webvulns': 100, 'jsanalysis': 50, 'cloudmisconfig': 100,
      'autonomous-scanner': 10, 'intelligent-triage': 20,
      'planner': 1, 'executor': 200, 'researcher': 50,
    };

    const agentStats = allAgentTypes.map((agentType) => {
      const stats = statsMap[agentType];
      const capacity = capacityMap[agentType] || 100;

      if (stats) {
        const totalJobs = parseInt(stats.total_jobs) || 0;
        const completedJobs = parseInt(stats.completed_jobs) || 0;
        const failedJobs = parseInt(stats.failed_jobs) || 0;

        return {
          agentId: agentType,
          specialization: [agentType],
          totalJobs,
          completedJobs,
          failedJobs,
          avgDuration: stats.avg_duration_seconds ? parseFloat(stats.avg_duration_seconds) : 0,
          successRate: totalJobs > 0 ? completedJobs / totalJobs : 0,
          currentLoad: parseInt(stats.active_jobs) || 0,
          capacity,
        };
      } else {
        return {
          agentId: agentType,
          specialization: [agentType],
          totalJobs: 0,
          completedJobs: 0,
          failedJobs: 0,
          avgDuration: 0,
          successRate: 0,
          currentLoad: 0,
          capacity,
        };
      }
    });

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
 * List all REAL agents with their current activity
 */
router.get('/agents', async (req: Request, res: Response) => {
  try {
    // Define all available agents (INCLUDING Three-Agent system)
    const allAgentTypes = [
      // Discovery & Recon
      'subdomain', 'discovery', 'fingerprint', 'portscan', 'osint',
      // Web Security
      'crawl', 'scanner', 'xss', 'sqli', 'webvulns',
      // API & Cloud
      'apifuzz', 'cloudmisconfig',
      // Advanced
      'jsanalysis', 'confirm', 'triage', 'bruteforce', 'interact', 'browser',
      // Three-Agent Architecture (THE MOST POWERFUL!)
      'planner', 'executor', 'researcher',
      // Specialized
      'ssrf', 'autonomous-scanner', 'intelligent-triage'
    ];

    // Get stats for agents that have run
    const agentStats = await database.query(`
      SELECT
        type as agent_type,
        COUNT(*) FILTER (WHERE status = 'active') as active_jobs,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
        COUNT(*) as total_jobs,
        MAX(started_at) as last_run,
        AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))) as avg_duration_seconds
      FROM jobs
      GROUP BY type
      ORDER BY active_jobs DESC, total_jobs DESC
    `);

    // Map stats by agent type
    const statsMap: Record<string, any> = {};
    agentStats.rows.forEach((row: any) => {
      statsMap[row.agent_type] = row;
    });

    // Agent specialization mapping
    const specializationMap: Record<string, string[]> = {
      subdomain: ['discovery', 'dns'],
      discovery: ['reconnaissance', 'enumeration'],
      fingerprint: ['technology detection', 'fingerprinting'],
      portscan: ['network scanning', 'port enumeration'],
      crawl: ['web crawling', 'endpoint discovery'],
      scanner: ['vulnerability scanning', 'nuclei'],
      confirm: ['verification', 'validation'],
      triage: ['prioritization', 'analysis'],
      osint: ['open source intelligence', 'reconnaissance'],
      xss: ['cross-site scripting', 'client-side'],
      sqli: ['sql injection', 'database'],
      apifuzz: ['api testing', 'rest/graphql'],
      webvulns: ['web vulnerabilities', 'owasp'],
      jsanalysis: ['javascript analysis', 'dom'],
      cloudmisconfig: ['cloud security', 'misconfigurations'],
      bruteforce: ['authentication', 'password attacks'],
      interact: ['interactive testing', 'manual'],
      browser: ['browser automation', 'headless'],
      // THREE-AGENT SYSTEM - The Most Powerful!
      planner: ['🧠 strategic planning', 'adaptive strategy', '20-200 parallel agents', 'attack chain discovery'],
      executor: ['⚡ swarm orchestration', 'tactical execution', 'atomic target claiming', 'parallel fuzzing'],
      researcher: ['🔬 multi-reviewer validation', 'PoC generation', 'false positive filtering', '5 specialized reviewers'],
      // Specialized Advanced
      ssrf: ['server-side request forgery', 'internal network'],
      'autonomous-scanner': ['AI-powered scanning', 'auto-discovery'],
      'intelligent-triage': ['ML-based prioritization', 'smart filtering'],
    };

    // Create agents list with all available agents
    const agents = allAgentTypes.map((agentType) => {
      const stats = statsMap[agentType];

      // Realistic capacities based on agent resource requirements
      const capacityMap: Record<string, number> = {
        // Lightweight agents - high capacity
        'subdomain': 500,
        'discovery': 300,
        'fingerprint': 200,
        'portscan': 150,
        // Medium agents
        'crawl': 100,
        'osint': 100,
        'apifuzz': 100,
        // Resource-intensive agents
        'scanner': 50,
        'browser': 30,
        'bruteforce': 25,
        'interact': 20,
        // Validation agents
        'confirm': 150,
        'triage': 100,
        // Specialized
        'xss': 75,
        'sqli': 75,
        'ssrf': 75,
        'webvulns': 100,
        'jsanalysis': 50,
        'cloudmisconfig': 100,
        // AI/ML agents - lower capacity due to compute
        'autonomous-scanner': 10,
        'intelligent-triage': 20,
        // Three-Agent System - MASSIVE parallel capacity
        'planner': 1,    // Only 1 active planner per program
        'executor': 200, // Can orchestrate 200 parallel agents
        'researcher': 50, // 50 concurrent validations (5 reviewers each)
      };

      const capacity = capacityMap[agentType] || 100;
      if (stats) {
        const activeJobs = parseInt(stats.active_jobs) || 0;
        const utilization = activeJobs / capacity;
        return {
          id: agentType,
          name: agentType.charAt(0).toUpperCase() + agentType.slice(1),
          type: agentType,
          specialization: specializationMap[agentType] || [agentType],
          status: activeJobs > 0 ? 'active' : 'idle',
          activeJobs,
          pendingJobs: parseInt(stats.pending_jobs) || 0,
          completedJobs: parseInt(stats.completed_jobs) || 0,
          failedJobs: parseInt(stats.failed_jobs) || 0,
          totalJobs: parseInt(stats.total_jobs) || 0,
          lastRun: stats.last_run,
          avgDuration: stats.avg_duration_seconds ? parseFloat(stats.avg_duration_seconds).toFixed(2) : null,
          currentLoad: activeJobs,
          capacity,
          utilization,
        };
      } else {
        // Agent exists but has never run
        return {
          id: agentType,
          name: agentType.charAt(0).toUpperCase() + agentType.slice(1),
          type: agentType,
          specialization: specializationMap[agentType] || [agentType],
          status: 'idle',
          activeJobs: 0,
          pendingJobs: 0,
          completedJobs: 0,
          failedJobs: 0,
          totalJobs: 0,
          lastRun: null,
          avgDuration: null,
          currentLoad: 0,
          capacity,
          utilization: 0,
        };
      }
    });

    res.json({
      agents,
      count: agents.length,
      summary: {
        totalAgents: agents.length,
        activeAgents: agents.filter((a: any) => a.status === 'active').length,
        totalActiveJobs: agents.reduce((sum: number, a: any) => sum + a.activeJobs, 0),
        totalJobs: agents.reduce((sum: number, a: any) => sum + a.totalJobs, 0),
      },
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
 * Get REAL knowledge base statistics from actual system activity
 */
router.get('/knowledge', async (req: Request, res: Response) => {
  try {
    // Get active agents count (agents with pending or active jobs)
    const activeAgentsResult = await database.query(`
      SELECT COUNT(DISTINCT type) as count
      FROM jobs
      WHERE status IN ('active', 'pending')
        AND completed_at IS NULL
    `);

    // Get total assets discovered (ALL TIME)
    const assetsResult = await database.query(`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT type) as types,
        COUNT(*) FILTER (WHERE type = 'subdomain') as subdomains,
        COUNT(*) FILTER (WHERE type = 'url') as urls,
        COUNT(*) FILTER (WHERE type = 'domain') as domains,
        COUNT(*) FILTER (WHERE type = 'ip') as ips,
        COUNT(*) FILTER (WHERE discovered_at > NOW() - INTERVAL '24 hours') as active_last_24h
      FROM assets
    `);

    // Get job execution statistics
    const jobsResult = await database.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))) as avg_duration_seconds
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '7 days'
    `);

    // Get workflow execution patterns
    const workflowsResult = await database.query(`
      SELECT
        COUNT(DISTINCT program_id) as programs_tested,
        COUNT(*) as total_executions,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_workflow_duration
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '7 days'
        AND completed_at IS NOT NULL
    `);

    // Get findings/vulnerabilities
    const findingsResult = await database.query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical,
        COUNT(*) FILTER (WHERE severity = 'high') as high,
        COUNT(*) FILTER (WHERE severity = 'medium') as medium,
        COUNT(*) FILTER (WHERE severity = 'low') as low,
        COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed
      FROM findings
    `);

    const assets = assetsResult.rows[0];
    const jobs = jobsResult.rows[0];
    const workflows = workflowsResult.rows[0];
    const findings = findingsResult.rows[0];

    const totalAssets = parseInt(assets.total) || 0;
    const totalJobs = parseInt(jobs.total) || 0;
    const completedJobs = parseInt(jobs.completed) || 0;
    const successRate = totalJobs > 0 ? completedJobs / totalJobs : 0;

    res.json({
      knowledgeBase: {
        // Real-time system activity
        activeAgents: parseInt(activeAgentsResult.rows[0].count) || 0,
        activeJobs: parseInt(jobs.active) || 0,
        pendingJobs: parseInt(jobs.pending) || 0,

        // Discoveries - Frontend expects this structure
        discoveries: {
          total: totalAssets,
          byType: {
            subdomain: parseInt(assets.subdomains) || 0,
            url: parseInt(assets.urls) || 0,
            domain: parseInt(assets.domains) || 0,
            ip: parseInt(assets.ips) || 0,
          },
        },

        // Attack Strategies - Frontend expects this structure
        strategies: {
          total: parseInt(findings.total) || 0,
          byType: {
            critical: parseInt(findings.critical) || 0,
            high: parseInt(findings.high) || 0,
            medium: parseInt(findings.medium) || 0,
            low: parseInt(findings.low) || 0,
          },
          avgSuccessRate: successRate,
        },

        // Asset discovery - THE REAL DATA!
        assetDiscovery: {
          totalAssets,
          assetTypes: parseInt(assets.types) || 0,
          breakdown: {
            subdomains: parseInt(assets.subdomains) || 0,
            urls: parseInt(assets.urls) || 0,
            domains: parseInt(assets.domains) || 0,
            ips: parseInt(assets.ips) || 0,
          },
          activeLast24h: parseInt(assets.active_last_24h) || 0,
        },

        // Job execution metrics
        executionMetrics: {
          totalJobs,
          completed: completedJobs,
          failed: parseInt(jobs.failed) || 0,
          successRate: (successRate * 100).toFixed(1),
          avgDuration: jobs.avg_duration_seconds
            ? `${(parseFloat(jobs.avg_duration_seconds) / 60).toFixed(1)} min`
            : 'N/A',
        },

        // Workflow patterns
        workflowExecution: {
          programsTested: parseInt(workflows.programs_tested) || 0,
          totalExecutions: parseInt(workflows.total_executions) || 0,
          avgDuration: workflows.avg_workflow_duration
            ? `${(parseFloat(workflows.avg_workflow_duration) / 60).toFixed(1)} min`
            : 'N/A',
        },

        // Vulnerabilities found
        vulnerabilities: {
          total: parseInt(findings.total) || 0,
          confirmed: parseInt(findings.confirmed) || 0,
          bySeverity: {
            critical: parseInt(findings.critical) || 0,
            high: parseInt(findings.high) || 0,
            medium: parseInt(findings.medium) || 0,
            low: parseInt(findings.low) || 0,
          },
        },

        // Metadata for compatibility
        metadata: {
          total: totalAssets + parseInt(findings.total) || 0,
        },
      },
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
 * GET /agent-graph/communications
 * Get agent-to-agent communications and workflow chains
 */
router.get('/communications', async (req: Request, res: Response) => {
  try {
    // Get job chains (parent-child relationships)
    const communications = await database.query(`
      SELECT
        j1.id as job_id,
        j1.type as agent_from,
        j1.status as from_status,
        j1.started_at,
        j1.metadata->>'parentJobId' as parent_job_id,
        j2.type as triggered_agent,
        j2.status as triggered_status,
        j1.metadata->>'tags' as tags
      FROM jobs j1
      LEFT JOIN jobs j2 ON j2.metadata->>'parentJobId' = j1.id::text
      WHERE j1.started_at > NOW() - INTERVAL '6 hours'
        AND (j1.metadata->>'parentJobId' IS NOT NULL OR j2.id IS NOT NULL)
      ORDER BY j1.started_at DESC
      LIMIT 100
    `);

    // Get workflow patterns
    const workflows = await database.query(`
      SELECT
        type,
        COUNT(*) as frequency,
        JSON_AGG(DISTINCT metadata->'tags') as common_tags,
        AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at))) as avg_duration
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '24 hours'
        AND metadata->>'requestedBy' IS NOT NULL
      GROUP BY type, metadata->>'requestedBy'
      ORDER BY frequency DESC
    `);

    res.json({
      communications: communications.rows,
      workflows: workflows.rows,
      count: communications.rows.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get communications');
    res.status(500).json({
      error: 'Failed to get communications',
      message: error.message,
    });
  }
});

/**
 * GET /agent-graph/three-agent
 * Get Three-Agent system status and activity
 */
router.get('/three-agent', async (req: Request, res: Response) => {
  try {
    // Get Three-Agent LLM calls
    const llmActivity = await database.query(`
      SELECT
        metadata->>'llmModel' as model,
        metadata->>'llmProvider' as provider,
        COUNT(*) as calls,
        SUM(CAST(metadata->>'tokensUsed' AS INTEGER)) as total_tokens,
        AVG(CAST(metadata->>'tokensUsed' AS INTEGER)) as avg_tokens,
        SUM(CAST(metadata->>'cost' AS DECIMAL)) as total_cost
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '24 hours'
        AND metadata->>'llmModel' IS NOT NULL
      GROUP BY metadata->>'llmModel', metadata->>'llmProvider'
    `);

    // Get jobs that used AI decision making
    const aiDecisions = await database.query(`
      SELECT
        type as agent,
        COUNT(*) as ai_decisions,
        JSON_AGG(metadata->'llmResponse') as responses
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '24 hours'
        AND metadata->>'llmResponse' IS NOT NULL
      GROUP BY type
    `);

    res.json({
      threeAgent: {
        llmActivity: llmActivity.rows,
        aiDecisions: aiDecisions.rows,
        totalCalls: llmActivity.rows.reduce((sum: number, row: any) => sum + parseInt(row.calls || 0), 0),
        totalTokens: llmActivity.rows.reduce((sum: number, row: any) => sum + parseInt(row.total_tokens || 0), 0),
        totalCost: llmActivity.rows.reduce((sum: number, row: any) => sum + parseFloat(row.total_cost || 0), 0),
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get Three-Agent data');
    res.status(500).json({
      error: 'Failed to get Three-Agent data',
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
