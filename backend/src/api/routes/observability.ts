import { Router } from 'express';
import axios from 'axios';
import logger from '../../utils/logger';

const router = Router();

// Phoenix URL from environment or default
const PHOENIX_URL = process.env.PHOENIX_URL || 'http://localhost:6006';

/**
 * Get traces from Phoenix
 * GET /api/v1/observability/traces
 */
router.get('/traces', async (req, res) => {
  try {
    const { timeRange = '1h', limit = 50, status, agentType } = req.query;

    // Calculate time range
    const endTime = new Date();
    const startTime = new Date();

    switch (timeRange) {
      case '15m':
        startTime.setMinutes(startTime.getMinutes() - 15);
        break;
      case '1h':
        startTime.setHours(startTime.getHours() - 1);
        break;
      case '6h':
        startTime.setHours(startTime.getHours() - 6);
        break;
      case '24h':
        startTime.setHours(startTime.getHours() - 24);
        break;
      case '7d':
        startTime.setDate(startTime.getDate() - 7);
        break;
      default:
        startTime.setHours(startTime.getHours() - 1);
    }

    // Query Phoenix API for traces
    // Phoenix uses OpenTelemetry format - adapt as needed
    const phoenixResponse = await axios.get(`${PHOENIX_URL}/v1/traces`, {
      params: {
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        limit,
      },
      timeout: 5000,
    });

    let traces = phoenixResponse.data.traces || [];

    // Filter by status if provided
    if (status) {
      traces = traces.filter((t: any) => t.status === status);
    }

    // Filter by agent type if provided
    if (agentType) {
      traces = traces.filter((t: any) => t.attributes?.['agent.type'] === agentType);
    }

    res.json({
      traces,
      count: traces.length,
      timeRange: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
      },
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch traces from Phoenix');

    // Return empty array if Phoenix is not available
    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.json({
        traces: [],
        count: 0,
        message: 'Phoenix is not available. Start jobs to generate traces.',
      });
    }

    res.status(500).json({
      error: 'Failed to fetch traces',
      message: error.message,
    });
  }
});

/**
 * Get trace details by ID
 * GET /api/v1/observability/traces/:traceId
 */
router.get('/traces/:traceId', async (req, res) => {
  try {
    const { traceId } = req.params;

    const phoenixResponse = await axios.get(`${PHOENIX_URL}/v1/traces/${traceId}`, {
      timeout: 5000,
    });

    res.json(phoenixResponse.data);
  } catch (error: any) {
    logger.error({ error: error.message, traceId: req.params.traceId }, 'Failed to fetch trace details');

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(503).json({
        error: 'Phoenix is not available',
      });
    }

    res.status(500).json({
      error: 'Failed to fetch trace details',
      message: error.message,
    });
  }
});

/**
 * Get observability metrics
 * GET /api/v1/observability/metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const { timeRange = '1h' } = req.query;

    const endTime = new Date();
    const startTime = new Date();

    switch (timeRange) {
      case '15m':
        startTime.setMinutes(startTime.getMinutes() - 15);
        break;
      case '1h':
        startTime.setHours(startTime.getHours() - 1);
        break;
      case '6h':
        startTime.setHours(startTime.getHours() - 6);
        break;
      case '24h':
        startTime.setHours(startTime.getHours() - 24);
        break;
      case '7d':
        startTime.setDate(startTime.getDate() - 7);
        break;
      default:
        startTime.setHours(startTime.getHours() - 1);
    }

    // Fetch metrics from Phoenix
    const phoenixResponse = await axios.get(`${PHOENIX_URL}/v1/metrics`, {
      params: {
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
      },
      timeout: 5000,
    });

    res.json(phoenixResponse.data);
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch metrics from Phoenix');

    if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.json({
        totalTraces: 0,
        avgDuration: 0,
        errorRate: 0,
        totalCost: 0,
        tokensUsed: 0,
        agentExecutions: 0,
        toolExecutions: 0,
        llmCalls: 0,
        message: 'Phoenix is not available. Metrics will appear after jobs run.',
      });
    }

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
    await axios.get(`${PHOENIX_URL}/health`, { timeout: 2000 });
    res.json({
      phoenixAvailable: true,
      phoenixUrl: PHOENIX_URL,
    });
  } catch (error) {
    res.json({
      phoenixAvailable: false,
      phoenixUrl: PHOENIX_URL,
      message: 'Phoenix is not reachable. Observability data will not be available.',
    });
  }
});

export default router;
