import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import database from '../../services/database';
import queue from '../../services/queue';
import { BaseJob } from '../../../../shared/types';

const router = Router();

// Get all jobs
router.get('/', async (req, res) => {
  try {
    const { program_id, type, status, limit = 100, offset = 0 } = req.query;

    let query = 'SELECT * FROM jobs WHERE 1=1';
    const params: any[] = [];

    if (program_id) {
      query += ` AND program_id = $${params.length + 1}`;
      params.push(program_id);
    }

    if (type) {
      query += ` AND type = $${params.length + 1}`;
      params.push(type);
    }

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await database.query(query, params);

    res.json({ jobs: result.rows, count: result.rowCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get all active jobs with details (must be before /:id)
router.get('/active', async (req, res) => {
  try {
    const result = await database.query(
      `SELECT j.*,
              EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - j.started_at))::integer as elapsed_seconds,
              CASE
                WHEN j.type = 'crawl' THEN (j.options->>'depth')::text || ' depth'
                WHEN j.type = 'scanner' THEN (j.options->>'templateSet')::text || ' templates'
                WHEN j.type = 'portscan' THEN (j.options->>'ports')::text || ' ports'
                ELSE j.type
              END as job_description
       FROM jobs j
       WHERE j.status = 'active'
       ORDER BY j.started_at DESC
       LIMIT 50`
    );

    res.json({ jobs: result.rows, count: result.rowCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get job by ID
router.get('/:id', async (req, res) => {
  try {
    const result = await database.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({ job: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create new job
router.post('/', async (req, res) => {
  try {
    const { type, program_id, priority = 5, options, metadata = {} } = req.body;

    if (!type || !program_id || !options) {
      return res.status(400).json({ error: 'Missing required fields: type, program_id, options' });
    }

    const id = uuidv4();

    const job: BaseJob = {
      id,
      type,
      programId: program_id,
      priority,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options,
      metadata: {
        ...metadata,
        requestedBy: 'api',
      },
    } as any;

    // Add to queue
    await queue.addJob(type, job);

    res.status(201).json({ id, message: 'Job created and queued successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel job
router.post('/:id/cancel', async (req, res) => {
  try {
    await database.query(
      `UPDATE jobs SET status = 'cancelled' WHERE id = $1 AND status IN ('pending', 'active')`,
      [req.params.id]
    );

    res.json({ message: 'Job cancelled successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Retry failed job
router.post('/:id/retry', async (req, res) => {
  try {
    const result = await database.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    if (job.status !== 'failed') {
      return res.status(400).json({ error: 'Only failed jobs can be retried' });
    }

    // Reset job status
    await database.query(
      `UPDATE jobs SET status = 'pending', attempts = 0, error = NULL WHERE id = $1`,
      [req.params.id]
    );

    // Re-add to queue
    await queue.addJob(job.type, { ...job, status: 'pending', attempts: 0 });

    res.json({ message: 'Job queued for retry' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Requeue pending job (for stuck jobs that aren't in the queue)
router.post('/:id/requeue', async (req, res) => {
  try {
    const result = await database.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const job = result.rows[0];

    if (job.status !== 'pending') {
      return res.status(400).json({ error: 'Only pending jobs can be requeued' });
    }

    // Build job object with proper structure
    const jobData: BaseJob = {
      id: job.id,
      type: job.type,
      programId: job.program_id,
      priority: job.priority,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      metadata: job.metadata || {},
    } as any;

    // Add options based on job type
    if (job.options) {
      (jobData as any).options = job.options;
    }

    // Add to queue
    await queue.addJob(job.type, jobData);

    res.json({ message: 'Job requeued successfully', id: job.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get job events/logs
router.get('/:id/events', async (req, res) => {
  try {
    const { limit = 100, offset = 0, level } = req.query;

    let query = 'SELECT * FROM events WHERE job_id = $1';
    const params: any[] = [req.params.id];

    if (level) {
      query += ` AND level = $${params.length + 1}`;
      params.push(level);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await database.query(query, params);

    res.json({ events: result.rows, count: result.rowCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stream job logs via Server-Sent Events
router.get('/:id/logs/stream', async (req, res) => {
  const jobId = req.params.id;

  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connected', jobId })}\n\n`);

  // Listen for log events
  const eventHandler = (event: any) => {
    if (event.jobId === jobId) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  const events = require('../../services/events').default;
  events.on('log', eventHandler);
  events.on('progress', eventHandler);
  events.on('job_status', eventHandler);

  // Cleanup on client disconnect
  req.on('close', () => {
    events.off('log', eventHandler);
    events.off('progress', eventHandler);
    events.off('job_status', eventHandler);
    res.end();
  });
});

// Get queue statistics
router.get('/stats/queues', async (req, res) => {
  try {
    const queues = queue.getAllQueues();
    const stats: any = {};

    for (const [name, q] of queues.entries()) {
      const counts = await q.getJobCounts();
      stats[name] = counts;
    }

    res.json({ queues: stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
