import { Router } from 'express';
import { DashboardService } from '../../services/dashboard';
import database from '../../services/database';

const router = Router();
const dashboardService = new DashboardService();

router.get('/stats', async (req, res) => {
  try {
    const stats = await dashboardService.getHandoffStats();
    res.json({ data: stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recent-handoffs', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const handoffs = await dashboardService.getRecentHandoffs(limit);
    res.json({ data: handoffs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get handoff chain for visualization
router.get('/handoff-chain', async (req, res) => {
  try {
    const programId = req.query.programId as string;
    const rootJobId = req.query.rootJobId as string;

    let query = `
      SELECT 
        rh.id,
        rh.from_agent_type,
        rh.to_agent_type,
        rh.status,
        rh.created_at,
        rh.completed_at,
        rh.reasoning,
        rh.parent_result,
        rh.from_job_id,
        rh.to_job_id
      FROM rich_handoffs rh
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (programId) {
      query += ` AND rh.program_id = $${paramIndex}`;
      params.push(programId);
      paramIndex++;
    }

    if (rootJobId) {
      // Get all handoffs in the chain starting from root job
      query += ` AND (
        rh.from_job_id = $${paramIndex} OR
        rh.to_job_id IN (
          SELECT id FROM jobs WHERE parent_job_id = $${paramIndex}
        )
      )`;
      params.push(rootJobId);
    }

    query += ` ORDER BY rh.created_at ASC`;

    const result = await database.query(query, params);

    res.json({
      handoffs: result.rows,
      programId,
      rootJobId,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
