import { Router } from 'express';
import { managerAgent } from '../../agents/manager';
import database from '../../services/database';

const router = Router();

/**
 * Process conversational command
 * Example: "Start discovery for program Spotify using chaosdb and subfinder"
 */
router.post('/command', async (req, res) => {
  try {
    const { command, program_id, user_id = 'default' } = req.body;

    if (!command) {
      return res.status(400).json({ error: 'Missing required field: command' });
    }

    const result = await managerAgent.processCommand(command, user_id, program_id);

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get command history
 */
router.get('/history', async (req, res) => {
  try {
    const { user_id, program_id, limit = 50 } = req.query;

    let query = 'SELECT * FROM manager_commands WHERE 1=1';
    const params: any[] = [];

    if (user_id) {
      query += ` AND user_id = $${params.length + 1}`;
      params.push(user_id);
    }

    if (program_id) {
      query += ` AND program_id = $${params.length + 1}`;
      params.push(program_id);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await database.query(query, params);

    res.json({ commands: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
