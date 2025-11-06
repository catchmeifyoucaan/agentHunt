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

export default router;
