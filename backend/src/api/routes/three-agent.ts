/**
 * Three-Agent Architecture API Routes
 *
 * Endpoints for orchestrating Planner, Executor, and Researcher agents
 */

import { Router } from 'express';
import { orchestrator } from '../../services/three-agent/orchestrator';
import logger from '../../utils/logger';

const router = Router();

/**
 * POST /api/v1/three-agent/sessions
 * Start a new three-agent testing session
 */
router.post('/sessions', async (req, res) => {
  try {
    const { programId, scope, options } = req.body;

    if (!programId || !scope || !scope.targets) {
      return res.status(400).json({
        error: 'Program ID and scope with targets are required',
      });
    }

    // Start session asynchronously
    const session = await orchestrator.startSession(programId, scope, options || {});

    res.json({
      success: true,
      session: {
        id: session.id,
        programId: session.programId,
        state: session.state,
        plan: {
          id: session.plan.id,
          phases: session.plan.phases.length,
          estimatedDuration: Math.round(session.plan.totalEstimatedDuration / 1000 / 60),
        },
        startedAt: session.startedAt,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to start three-agent session');
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/three-agent/sessions/:sessionId
 * Get three-agent session status
 */
router.get('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await orchestrator.getSessionStatus(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    res.json({
      success: true,
      session: {
        id: session.id,
        programId: session.programId,
        state: session.state,
        plannerState: session.plannerState,
        swarmsDeployed: session.executorSwarms.length,
        findingsCount: session.researcherQueue.length,
        validatedCount: session.validatedFindings.filter((v) => v.valid).length,
        attackChainsCount: session.attackChains.length,
        startedAt: session.startedAt,
        completedAt: session.completedAt,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get session status');
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/three-agent/sessions/:sessionId/metrics
 * Get session performance metrics
 */
router.get('/sessions/:sessionId/metrics', async (req, res) => {
  try {
    const { sessionId } = req.params;

    const metrics = await orchestrator.getSessionMetrics(sessionId);

    if (!metrics) {
      return res.status(404).json({ error: 'Session not found or not completed' });
    }

    res.json({
      success: true,
      metrics: {
        duration: Math.round(metrics.duration / 1000 / 60), // minutes
        totalFindings: metrics.totalFindings,
        validatedFindings: metrics.validatedFindings,
        falsePositives: metrics.falsePositives,
        attackChains: metrics.attackChains,
        swarmsDeployed: metrics.swarmsDeployed,
        agentsUsed: metrics.agentsUsed,
        efficiency: {
          findingsPerMinute: metrics.efficiency.findingsPerMinute.toFixed(2),
          findingsPerAgent: metrics.efficiency.findingsPerAgent.toFixed(2),
          validationAccuracy: `${(metrics.efficiency.validationAccuracy * 100).toFixed(1)}%`,
        },
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get session metrics');
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v1/three-agent/sessions
 * List active sessions
 */
router.get('/sessions', async (req, res) => {
  try {
    const sessions = orchestrator.getActiveSessions();

    res.json({
      success: true,
      sessions: sessions.map((s) => ({
        id: s.id,
        programId: s.programId,
        state: s.state,
        findingsCount: s.researcherQueue.length,
        startedAt: s.startedAt,
      })),
      count: sessions.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to list sessions');
    res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/v1/three-agent/sessions/:sessionId
 * Cancel a running session
 */
router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;

    await orchestrator.cancelSession(sessionId);

    res.json({
      success: true,
      message: 'Session cancelled',
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to cancel session');
    res.status(500).json({ error: error.message });
  }
});

export default router;
