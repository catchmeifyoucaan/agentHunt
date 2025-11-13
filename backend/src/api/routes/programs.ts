import { Router } from 'express';
import database from '../../services/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get all programs
router.get('/', async (req, res) => {
  try {
    const result = await database.query('SELECT * FROM active_programs ORDER BY name');
    res.json({ programs: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get program by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await database.query('SELECT * FROM programs WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    res.json({ program: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new program
router.post('/', async (req, res) => {
  try {
    const { name, slug, platform, scope, policy, metadata } = req.body;

    const id = uuidv4();

    await database.query(
      `INSERT INTO programs (id, name, slug, platform, scope, policy, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, slug, platform, JSON.stringify(scope), JSON.stringify(policy), JSON.stringify(metadata || {})]
    );

    res.status(201).json({ id, message: 'Program created successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update program
router.put('/:id', async (req, res) => {
  try {
    const { name, platform, scope, policy, metadata } = req.body;

    await database.query(
      `UPDATE programs
       SET name = COALESCE($1, name),
           platform = COALESCE($2, platform),
           scope = COALESCE($3::jsonb, scope),
           policy = COALESCE($4::jsonb, policy),
           metadata = COALESCE($5::jsonb, metadata)
       WHERE id = $6`,
      [
        name,
        platform,
        scope ? JSON.stringify(scope) : null,
        policy ? JSON.stringify(policy) : null,
        metadata ? JSON.stringify(metadata) : null,
        req.params.id,
      ]
    );

    res.json({ message: 'Program updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete program
router.delete('/:id', async (req, res) => {
  try {
    await database.query('DELETE FROM programs WHERE id = $1', [req.params.id]);
    res.json({ message: 'Program deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get program assets
router.get('/:id/assets', async (req, res) => {
  try {
    const { type, status, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM assets WHERE program_id = $1';
    const params: any[] = [req.params.id];

    if (type) {
      query += ` AND type = $${params.length + 1}`;
      params.push(type);
    }

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY last_seen DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await database.query(query, params);

    res.json({ assets: result.rows, count: result.rowCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get program stats with internal/external breakdown
router.get('/:id/stats', async (req, res) => {
  try {
    const programId = req.params.id;

    // Get total subdomains with internal/external breakdown
    const subdomainStats = await database.query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN metadata->>'isInternal' = 'true' THEN 1 END) as internal,
         COUNT(CASE WHEN metadata->>'isInternal' = 'false' THEN 1 END) as external,
         COUNT(CASE WHEN metadata->>'isInternal' IS NULL THEN 1 END) as untagged
       FROM assets
       WHERE program_id = $1 AND type = 'subdomain'`,
      [programId]
    );

    // Get assets by type
    const assetsByType = await database.query(
      `SELECT type, COUNT(*) as count
       FROM assets
       WHERE program_id = $1
       GROUP BY type
       ORDER BY count DESC`,
      [programId]
    );

    // Get findings by severity
    const findingsBySeverity = await database.query(
      `SELECT severity, COUNT(*) as count
       FROM findings
       WHERE program_id = $1
       GROUP BY severity
       ORDER BY
         CASE severity
           WHEN 'critical' THEN 1
           WHEN 'high' THEN 2
           WHEN 'medium' THEN 3
           WHEN 'low' THEN 4
           ELSE 5
         END`,
      [programId]
    );

    // Get recent job activity
    const recentJobs = await database.query(
      `SELECT type, status, COUNT(*) as count
       FROM jobs
       WHERE program_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY type, status
       ORDER BY type, status`,
      [programId]
    );

    const stats = {
      subdomains: {
        total: parseInt(subdomainStats.rows[0]?.total || 0),
        external: parseInt(subdomainStats.rows[0]?.external || 0),
        internal: parseInt(subdomainStats.rows[0]?.internal || 0),
        untagged: parseInt(subdomainStats.rows[0]?.untagged || 0),
      },
      assetsByType: assetsByType.rows.reduce((acc: any, row: any) => {
        acc[row.type] = parseInt(row.count);
        return acc;
      }, {}),
      findingsBySeverity: findingsBySeverity.rows.reduce((acc: any, row: any) => {
        acc[row.severity] = parseInt(row.count);
        return acc;
      }, {}),
      recentJobs: recentJobs.rows,
    };

    res.json({ stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get program findings
router.get('/:id/findings', async (req, res) => {
  try {
    const { severity, status, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM findings WHERE program_id = $1';
    const params: any[] = [req.params.id];

    if (severity) {
      query += ` AND severity = $${params.length + 1}`;
      params.push(severity);
    }

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await database.query(query, params);

    res.json({ findings: result.rows, count: result.rowCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Pause program (stop all running jobs)
router.post('/:id/pause', async (req, res) => {
  try {
    const programId = req.params.id;

    // Check if program exists
    const programResult = await database.query('SELECT * FROM programs WHERE id = $1', [programId]);
    if (programResult.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    // Mark program as paused
    await database.query(
      `UPDATE programs
       SET paused = TRUE, paused_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [programId]
    );

    // Cancel all pending jobs for this program
    const cancelResult = await database.query(
      `UPDATE jobs
       SET status = 'cancelled',
           error = 'Cancelled due to program pause',
           completed_at = CURRENT_TIMESTAMP
       WHERE program_id = $1 AND status IN ('pending', 'active')
       RETURNING id`,
      [programId]
    );

    res.json({
      success: true,
      message: `Program paused successfully. ${cancelResult.rowCount} jobs cancelled.`,
      jobsCancelled: cancelResult.rowCount,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Resume program (restart from last state)
router.post('/:id/resume', async (req, res) => {
  try {
    const programId = req.params.id;

    // Check if program exists and is paused
    const programResult = await database.query(
      'SELECT * FROM programs WHERE id = $1',
      [programId]
    );

    if (programResult.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    const program = programResult.rows[0];
    if (!program.paused) {
      return res.status(400).json({ error: 'Program is not paused' });
    }

    // Mark program as resumed
    await database.query(
      `UPDATE programs
       SET paused = FALSE, resumed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [programId]
    );

    // Get cancelled jobs that can be restarted
    const cancelledJobs = await database.query(
      `SELECT id, type, options, metadata
       FROM jobs
       WHERE program_id = $1
         AND status = 'cancelled'
         AND error = 'Cancelled due to program pause'
       ORDER BY created_at ASC`,
      [programId]
    );

    // Recreate cancelled jobs as pending
    let jobsRestarted = 0;
    for (const job of cancelledJobs.rows) {
      await database.query(
        `UPDATE jobs
         SET status = 'pending',
             error = NULL,
             attempts = 0,
             completed_at = NULL
         WHERE id = $1`,
        [job.id]
      );
      jobsRestarted++;
    }

    res.json({
      success: true,
      message: `Program resumed successfully. ${jobsRestarted} jobs restarted.`,
      jobsRestarted,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
