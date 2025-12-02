import { Router } from 'express';
import { managerAgent } from '../../agents/manager';
import database from '../../services/database';
import { HITLService } from '../../services/hitl';
import loadBalancer from '../../services/load-balancer';

const router = Router();
const hitlService = new HITLService(database);

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

/**
 * Get pending approval requests for Manager Agent operations
 */
router.get('/approvals/pending', async (req, res) => {
  try {
    const { user_id } = req.query; // Optional: filter by user who needs to approve
    const pendingApprovals = await hitlService.getPendingApprovals(user_id as string);
    res.json({ approvals: pendingApprovals });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Approve a Manager Agent operation
 */
router.post('/approvals/:requestId/approve', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { user_id = 'default' } = req.body; // User performing the approval

    const updatedRequest = await hitlService.submitApproval(requestId, user_id, 'approve');
    res.json({ success: true, approval: updatedRequest });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Reject a Manager Agent operation
 */
router.post('/approvals/:requestId/reject', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { user_id = 'default', reason } = req.body; // User performing the rejection

    const updatedRequest = await hitlService.submitApproval(requestId, user_id, 'reject', reason);
    res.json({ success: true, approval: updatedRequest });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get performance bottlenecks and recommendations
 */
router.get('/performance/bottlenecks', async (req, res) => {
  try {
    const program_id = req.query.program_id ? String(req.query.program_id) : undefined;
    const recommendations = await loadBalancer.getRecommendations();

    // Filter by program if specified
    let bottlenecks = recommendations;
    if (program_id) {
      // Get agent types active in this program
      const programAgentsResult = await database.query(
        `SELECT DISTINCT type FROM jobs WHERE program_id = $1`,
        [program_id]
      );
      const programAgents = new Set(programAgentsResult.rows.map((r) => r.type));
      bottlenecks = recommendations.filter((b) => programAgents.has(b.agentType));
    }

    res.json({ bottlenecks });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get agent availability status
 */
router.get('/performance/availability/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const availability = await loadBalancer.checkAgentAvailability(agentType);
    res.json(availability);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get manager console messages/logs
 */
router.get('/console', async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    const result = await database.query(
      `SELECT * FROM manager_commands 
       ORDER BY timestamp DESC 
       LIMIT $1`,
      [limit]
    );

    res.json({
      messages: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    // If table doesn't exist, return empty
    if (error.code === '42P01') {
      res.json({ messages: [], count: 0 });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

export default router;
