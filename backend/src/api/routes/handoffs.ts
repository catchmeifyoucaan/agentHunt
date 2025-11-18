import { Router } from 'express';
import database from '../../services/database';
import logger from '../../utils/logger';

const router = Router();

/**
 * Get all handoffs with pagination
 * GET /api/v1/handoffs
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, offset = 0, from_agent, to_agent, program_id } = req.query;

    let query = 'SELECT * FROM handoffs WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    if (program_id) {
      query += ` AND job_id IN (SELECT id FROM jobs WHERE program_id = $${paramIndex})`;
      params.push(program_id);
      paramIndex++;
    }

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
      total: result.rowCount,
    });
  } catch (error: any) {
    if (error.code === '42P01') {
      res.json({ handoffs: [], count: 0, total: 0 });
    } else {
      logger.error({ error: error.message }, 'Failed to fetch handoffs');
      res.status(500).json({
        error: 'Failed to fetch handoffs',
        message: error.message,
      });
    }
  }
});

/**
 * Get handoff by ID
 * GET /api/v1/handoffs/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await database.query(
      'SELECT * FROM handoffs WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Handoff not found' });
    }

    res.json({ handoff: result.rows[0] });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to fetch handoff');
    res.status(500).json({
      error: 'Failed to fetch handoff',
      message: error.message,
    });
  }
});

export default router;
