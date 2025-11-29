/**
 * Pattern Routes - Phase 3.5: Formal Patterns
 *
 * REST API endpoints for pattern management:
 * - GET /patterns - List all available patterns
 * - GET /patterns/:name - Get specific pattern details
 * - POST /patterns/:name/execute - Execute a pattern
 * - GET /patterns/executions - Get execution history
 * - GET /patterns/recommendations/:programId - Get pattern recommendations
 * - GET /patterns/statistics - Get usage statistics
 */

import { Router, Request, Response } from 'express';
import { patternManager } from '../services/pattern-manager';
import logger from '../utils/logger';

const router = Router();

/**
 * GET /patterns
 * List all available patterns with optional filtering
 *
 * Query params:
 * - tags: comma-separated list of tags to filter by
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tags = req.query.tags ? (req.query.tags as string).split(',') : undefined;

    const patterns = patternManager.listPatterns({ tags });

    res.json({
      patterns,
      count: patterns.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to list patterns');
    res.status(500).json({
      error: 'Failed to list patterns',
      message: error.message,
    });
  }
});

/**
 * GET /patterns/:name
 * Get detailed information about a specific pattern
 */
router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;

    const pattern = patternManager.getPattern(name);

    if (!pattern) {
      return res.status(404).json({
        error: 'Pattern not found',
        pattern: name,
      });
    }

    res.json({ pattern });
  } catch (error: any) {
    logger.error({ error, pattern: req.params.name }, 'Failed to get pattern');
    res.status(500).json({
      error: 'Failed to get pattern',
      message: error.message,
    });
  }
});

/**
 * POST /patterns/:name/execute
 * Execute a pattern for a specific program
 *
 * Body:
 * - programId: UUID of the program
 * - options: Optional pattern-specific options
 */
router.post('/:name/execute', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { programId, options = {} } = req.body;

    if (!programId) {
      return res.status(400).json({
        error: 'Missing required field: programId',
      });
    }

    logger.info({ pattern: name, programId, options }, 'Executing pattern');

    const result = await patternManager.executePattern(name, programId, options);

    res.json({
      message: 'Pattern execution started',
      result,
    });
  } catch (error: any) {
    logger.error(
      { error, pattern: req.params.name, programId: req.body.programId },
      'Failed to execute pattern'
    );

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to execute pattern',
      message: error.message,
    });
  }
});

/**
 * GET /patterns/executions
 * Get pattern execution history
 *
 * Query params:
 * - programId: Filter by program ID
 * - patternName: Filter by pattern name
 * - limit: Maximum number of results (default: 50)
 */
router.get('/executions/history', async (req: Request, res: Response) => {
  try {
    const programId = req.query.programId as string | undefined;
    const patternName = req.query.patternName as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;

    const history = await patternManager.getExecutionHistory(programId, patternName, limit);

    res.json({
      executions: history,
      count: history.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get execution history');
    res.status(500).json({
      error: 'Failed to get execution history',
      message: error.message,
    });
  }
});

/**
 * GET /patterns/recommendations/:programId
 * Get recommended patterns for a program based on its characteristics
 */
router.get('/recommendations/:programId', async (req: Request, res: Response) => {
  try {
    const { programId } = req.params;

    const recommendations = await patternManager.getRecommendations(programId);

    res.json({
      programId,
      recommended: recommendations.recommended,
      reasons: recommendations.reasons,
      count: recommendations.recommended.length,
    });
  } catch (error: any) {
    logger.error({ error, programId: req.params.programId }, 'Failed to get recommendations');

    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: error.message,
      });
    }

    res.status(500).json({
      error: 'Failed to get recommendations',
      message: error.message,
    });
  }
});

/**
 * GET /patterns/statistics
 * Get usage statistics for all patterns
 */
router.get('/statistics/usage', async (req: Request, res: Response) => {
  try {
    const statistics = await patternManager.getStatistics();

    res.json({
      statistics,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get pattern statistics');
    res.status(500).json({
      error: 'Failed to get pattern statistics',
      message: error.message,
    });
  }
});

export default router;
