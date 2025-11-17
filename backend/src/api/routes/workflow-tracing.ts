import { Router } from 'express';
import { workflowTracingService } from '../services/workflow-tracing';
import database from '../services/database';

const router = Router();

/**
 * Get execution chain for a specific job
 */
router.get('/chains/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const chain = await workflowTracingService.getExecutionChain(jobId);
    
    if (!chain) {
      return res.status(404).json({ error: 'Job chain not found' });
    }
    
    res.json(chain);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get active workflows for a program
 */
router.get('/programs/:programId/workflows', async (req, res) => {
  try {
    const { programId } = req.params;
    const workflows = await workflowTracingService.getActiveWorkflows(programId);
    
    res.json({ workflows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get workflow statistics for a job
 */
router.get('/stats/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const stats = await workflowTracingService.getWorkflowStats(jobId);
    
    if (!stats) {
      return res.status(404).json({ error: 'Job not found or no workflow data' });
    }
    
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search for jobs in a workflow
 */
router.get('/search/:rootJobId', async (req, res) => {
  try {
    const { rootJobId } = req.params;
    const { type, status, limit } = req.query;
    
    const results = await workflowTracingService.searchInWorkflow(rootJobId, {
      type: type as string,
      status: status as string,
      limit: limit ? parseInt(limit as string, 10) : undefined
    });
    
    res.json({ results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get job lineage (ancestors and descendants)
 */
router.get('/lineage/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Using the database function directly
    const result = await database.query(
      'SELECT * FROM get_job_lineage($1)',
      [jobId]
    );
    
    res.json({ lineage: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;