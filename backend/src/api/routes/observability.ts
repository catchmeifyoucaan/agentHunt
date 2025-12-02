import { Router } from 'express';
import axios from 'axios';
import database from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

// Phoenix URL from environment or default
const PHOENIX_URL = process.env.PHOENIX_URL || 'http://localhost:6006';

/**
 * Get real-time agent statistics from database
 * GET /api/v1/observability/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const { timeRange = '1h' } = req.query;

    // Calculate time range
    const intervalMap: Record<string, string> = {
      '15m': '15 minutes',
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      '7d': '7 days',
    };
    const interval = intervalMap[timeRange as string] || '1 hour';

    // Get agent job statistics
    const jobStats = await database.query(`
      SELECT
        type as agent_type,
        status,
        COUNT(*) as count,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) as avg_duration_seconds
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '${interval}'
      GROUP BY type, status
      ORDER BY type, status
    `);

    // Get total counts
    const totals = await database.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE status = 'pending') as pending
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '${interval}'
    `);

    // Get asset discovery stats
    const assetStats = await database.query(`
      SELECT
        type,
        COUNT(*) as count
      FROM assets
      WHERE discovered_at > NOW() - INTERVAL '${interval}'
      GROUP BY type
      ORDER BY count DESC
    `);

    // Get findings stats
    const findingStats = await database.query(`
      SELECT
        severity,
        COUNT(*) as count
      FROM findings
      WHERE created_at > NOW() - INTERVAL '${interval}'
      GROUP BY severity
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'high' THEN 2
          WHEN 'medium' THEN 3
          WHEN 'low' THEN 4
          WHEN 'info' THEN 5
        END
    `);

    // Calculate metrics
    const totalJobs = totals.rows[0];
    const totalCompleted = parseInt(totalJobs.completed) || 0;
    const totalFailed = parseInt(totalJobs.failed) || 0;
    const errorRate =
      totalCompleted + totalFailed > 0
        ? ((totalFailed / (totalCompleted + totalFailed)) * 100).toFixed(2)
        : 0;

    // Group job stats by agent type
    const agentStats: Record<string, any> = {};
    jobStats.rows.forEach((row: any) => {
      if (!agentStats[row.agent_type]) {
        agentStats[row.agent_type] = {
          completed: 0,
          failed: 0,
          active: 0,
          pending: 0,
          avgDuration: 0,
        };
      }
      agentStats[row.agent_type][row.status] = parseInt(row.count);
      if (row.status === 'completed' && row.avg_duration_seconds) {
        agentStats[row.agent_type].avgDuration = parseFloat(row.avg_duration_seconds).toFixed(2);
      }
    });

    res.json({
      timeRange: interval,
      overview: {
        totalJobs:
          totalCompleted + totalFailed + parseInt(totalJobs.active) + parseInt(totalJobs.pending),
        completed: totalCompleted,
        failed: totalFailed,
        active: parseInt(totalJobs.active),
        pending: parseInt(totalJobs.pending),
        errorRate: parseFloat(errorRate as string),
      },
      agents: agentStats,
      assets: {
        total: assetStats.rows.reduce((sum: number, row: any) => sum + parseInt(row.count), 0),
        byType: assetStats.rows.reduce((acc: any, row: any) => {
          acc[row.type] = parseInt(row.count);
          return acc;
        }, {}),
      },
      findings: {
        total: findingStats.rows.reduce((sum: number, row: any) => sum + parseInt(row.count), 0),
        bySeverity: findingStats.rows.reduce((acc: any, row: any) => {
          acc[row.severity] = parseInt(row.count);
          return acc;
        }, {}),
      },
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch observability stats');
    res.status(500).json({
      error: 'Failed to fetch stats',
      message: error.message,
    });
  }
});

/**
 * Get recent agent executions with details
 * GET /api/v1/observability/executions
 */
router.get('/executions', async (req, res) => {
  try {
    const { limit = 50, agentType, status } = req.query;

    let query = `
      SELECT
        id,
        type as agent_type,
        status,
        started_at,
        completed_at,
        EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) as duration_seconds,
        error,
        metadata
      FROM jobs
      WHERE started_at IS NOT NULL
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (agentType) {
      query += ` AND type = $${paramIndex}`;
      params.push(agentType);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    query += ` ORDER BY started_at DESC LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await database.query(query, params);

    res.json({
      executions: result.rows.map((row: any) => ({
        id: row.id,
        agentType: row.agent_type,
        status: row.status,
        startTime: row.started_at,
        endTime: row.completed_at,
        duration: row.duration_seconds ? parseFloat(row.duration_seconds).toFixed(2) : null,
        error: row.error,
        metadata: row.metadata,
      })),
      count: result.rows.length,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch executions');
    res.status(500).json({
      error: 'Failed to fetch executions',
      message: error.message,
    });
  }
});

/**
 * Get OpenTelemetry traces from Phoenix or database
 * GET /api/v1/observability/traces
 */
router.get('/traces', async (req, res) => {
  try {
    const { timeRange = '1h', limit = 50 } = req.query;

    // Calculate time range
    const intervalMap: Record<string, string> = {
      '15m': '15 minutes',
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      '7d': '7 days',
    };
    const interval = intervalMap[timeRange as string] || '1 hour';

    // Note: Phoenix doesn't have a direct /v1/traces endpoint
    // We use our database jobs as traces instead

    // Fetch job executions as "traces"
    const result = await database.query(
      `
      SELECT
        id,
        type as agent_type,
        status,
        started_at,
        completed_at,
        EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) * 1000 as duration_ms,
        error,
        metadata
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '${interval}'
      ORDER BY started_at DESC
      LIMIT $1
    `,
      [limit]
    );

    // Transform to trace format expected by UI
    const traces = result.rows.map((row: any) => ({
      traceId: row.id,
      name: `${row.agent_type} execution`,
      timestamp: row.started_at,
      duration: row.duration_ms || 0,
      status: row.status === 'failed' ? 'error' : row.status === 'completed' ? 'ok' : 'pending',
      spans: [
        {
          spanId: `${row.id}-main`,
          name: row.agent_type,
          startTime: row.started_at,
          endTime: row.completed_at || new Date(),
          attributes: {
            agentType: row.agent_type,
            status: row.status,
            error: row.error,
            ...row.metadata,
          },
        },
      ],
      attributes: {
        agentType: row.agent_type,
        jobId: row.id,
      },
    }));

    res.json({
      traces,
      total: traces.length,
      timeRange: interval,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch traces');
    res.status(500).json({
      error: 'Failed to fetch traces',
      message: error.message,
    });
  }
});

/**
 * Get individual trace details
 * GET /api/v1/observability/traces/:traceId
 */
router.get('/traces/:traceId', async (req, res) => {
  try {
    const { traceId } = req.params;

    // Get job details from database (Phoenix doesn't have direct trace lookup)
    const result = await database.query(
      `
      SELECT
        id,
        type as agent_type,
        status,
        started_at,
        completed_at,
        EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) * 1000 as duration_ms,
        error,
        metadata,
        result
      FROM jobs
      WHERE id = $1
    `,
      [traceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Trace not found' });
    }

    const job = result.rows[0];
    const trace = {
      traceId: job.id,
      name: `${job.agent_type} execution`,
      timestamp: job.started_at,
      duration: job.duration_ms || 0,
      status: job.status === 'failed' ? 'error' : job.status === 'completed' ? 'ok' : 'pending',
      spans: [
        {
          spanId: `${job.id}-main`,
          name: job.agent_type,
          startTime: job.started_at,
          endTime: job.completed_at || new Date(),
          attributes: {
            agentType: job.agent_type,
            status: job.status,
            error: job.error,
            result: job.result,
            ...job.metadata,
          },
          events: job.error
            ? [
                {
                  name: 'error',
                  timestamp: job.completed_at || new Date(),
                  attributes: { error: job.error },
                },
              ]
            : [],
        },
      ],
      attributes: {
        agentType: job.agent_type,
        jobId: job.id,
      },
    };

    res.json(trace);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch trace');
    res.status(500).json({
      error: 'Failed to fetch trace',
      message: error.message,
    });
  }
});

/**
 * Get aggregated metrics for observability dashboard
 * GET /api/v1/observability/metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const { timeRange = '1h' } = req.query;

    // Calculate time range
    const intervalMap: Record<string, string> = {
      '15m': '15 minutes',
      '1h': '1 hour',
      '6h': '6 hours',
      '24h': '24 hours',
      '7d': '7 days',
    };
    const interval = intervalMap[timeRange as string] || '1 hour';

    // Get job metrics
    const jobMetrics = await database.query(`
      SELECT
        COUNT(*) as total_jobs,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - started_at)) * 1000) as avg_duration_ms,
        COUNT(DISTINCT type) as agent_types
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '${interval}'
    `);

    const metrics = jobMetrics.rows[0];
    const totalJobs = parseInt(metrics.total_jobs) || 0;
    const completed = parseInt(metrics.completed) || 0;
    const failed = parseInt(metrics.failed) || 0;
    const errorRate = completed + failed > 0 ? (failed / (completed + failed)) * 100 : 0;

    // Get LLM usage if available
    const llmMetrics = await database.query(`
      SELECT
        COUNT(*) as llm_calls,
        SUM(CAST(metadata->>'tokensUsed' AS INTEGER)) as total_tokens
      FROM jobs
      WHERE started_at > NOW() - INTERVAL '${interval}'
        AND metadata->>'tokensUsed' IS NOT NULL
    `);

    const llmData = llmMetrics.rows[0] || { llm_calls: 0, total_tokens: 0 };
    const tokensUsed = parseInt(llmData.total_tokens) || 0;
    const llmCalls = parseInt(llmData.llm_calls) || 0;

    // Estimate cost (rough estimate: $0.01 per 1000 tokens)
    const totalCost = (tokensUsed / 1000) * 0.01;

    res.json({
      totalTraces: totalJobs,
      avgDuration: parseFloat(metrics.avg_duration_ms) || 0,
      errorRate: parseFloat(errorRate.toFixed(2)),
      totalCost: parseFloat(totalCost.toFixed(4)),
      tokensUsed,
      agentExecutions: completed + failed,
      toolExecutions: totalJobs, // Simplified: each job is a tool execution
      llmCalls,
      timeRange: interval,
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch metrics');
    res.status(500).json({
      error: 'Failed to fetch metrics',
      message: error.message,
    });
  }
});

/**
 * Health check for Phoenix connectivity
 * GET /api/v1/observability/health
 */
router.get('/health', async (req, res) => {
  try {
    const phoenixHealth = await axios.get(`${PHOENIX_URL}/healthz`, { timeout: 2000 });

    // Check OTEL status
    const otelEnabled = process.env.OTEL_ENABLED === 'true';

    res.json({
      phoenixAvailable: phoenixHealth.data === 'OK',
      phoenixUrl: PHOENIX_URL,
      otelEnabled,
      otelServiceName: process.env.OTEL_SERVICE_NAME || 'agenthunt',
      message: otelEnabled
        ? 'Observability enabled. View traces at ' + PHOENIX_URL
        : 'OTEL disabled. Set OTEL_ENABLED=true to enable tracing.',
    });
  } catch (error) {
    res.json({
      phoenixAvailable: false,
      phoenixUrl: PHOENIX_URL,
      otelEnabled: process.env.OTEL_ENABLED === 'true',
      message: 'Phoenix is not reachable. Observability data will not be available.',
    });
  }
});

/**
 * Get all handoffs with pagination
 * GET /api/v1/observability/handoffs
 */
router.get('/handoffs', async (req, res) => {
  try {
    const { limit = 50, offset = 0, from_agent, to_agent } = req.query;

    let query = 'SELECT * FROM handoffs WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (from_agent) {
      query += ` AND from_agent = $${paramIndex}`;
      params.push(from_agent);
      paramIndex++;
    }

    if (to_agent) {
      query += ` AND to_agent = $${paramIndex}`;
      params.push(to_agent);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await database.query(query, params);

    res.json({
      handoffs: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    if (error.code === '42P01') {
      res.json({ handoffs: [], count: 0 });
    } else {
      logger.error({ error: error.message }, 'Failed to fetch handoffs');
      res.status(500).json({
        error: 'Failed to fetch handoffs',
        message: error.message,
      });
    }
  }
});

export default router;
