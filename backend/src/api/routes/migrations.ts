/**
 * Database Migrations API Routes
 * Endpoints for managing database migrations
 */

import { Router } from 'express';
import { migrationRunner } from '../../services/database/migrations';
import logger from '../../utils/logger';

const router = Router();

/**
 * Get migration status
 * GET /api/v1/migrations/status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await migrationRunner.getStatus();

    res.json({
      success: true,
      status,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get migration status');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Run pending migrations
 * POST /api/v1/migrations/run
 */
router.post('/run', async (req, res) => {
  try {
    logger.info('Running database migrations via API');

    const result = await migrationRunner.runMigrations();

    const statusCode = result.success ? 200 : 500;

    res.status(statusCode).json({
      success: result.success,
      applied: result.applied,
      failed: result.failed,
      errors: result.errors,
      message: result.success
        ? 'All migrations applied successfully'
        : `${result.applied.length} migrations applied, ${result.failed.length} failed`,
    });
  } catch (error: any) {
    logger.error({ error }, 'Migration run failed');
    res.status(500).json({ error: error.message });
  }
});

export default router;
