import { Router } from 'express';
import workflowEngine from '../services/workflow-engine';
import logger from '../utils/logger';

const router = Router();

/**
 * List all workflows
 */
router.get('/', async (req, res) => {
  try {
    const workflows = await workflowEngine.listWorkflows();
    res.json(workflows);
  } catch (error: any) {
    logger.error({ error }, 'Failed to list workflows');
    res.status(500).json({ error: 'Failed to list workflows' });
  }
});

/**
 * Get workflow details
 */
router.get('/:name', async (req, res) => {
  try {
    const workflow = await workflowEngine.getWorkflow(req.params.name);
    if (!workflow) {
      return res.status(404).json({ error: 'Workflow not found' });
    }
    res.json(workflow);
  } catch (error: any) {
    logger.error({ error, name: req.params.name }, 'Failed to get workflow');
    res.status(500).json({ error: 'Failed to get workflow' });
  }
});

/**
 * Execute workflow
 */
router.post('/:name/execute', async (req, res) => {
  try {
    const { context } = req.body;
    const executionId = await workflowEngine.executeWorkflow(req.params.name, context || {});
    res.json({ executionId });
  } catch (error: any) {
    logger.error({ error, name: req.params.name }, 'Failed to execute workflow');
    res.status(500).json({ error: error.message || 'Failed to execute workflow' });
  }
});

/**
 * Toggle workflow enabled state
 */
router.patch('/:name/enabled', async (req, res) => {
  try {
    const { enabled } = req.body;
    await workflowEngine.setWorkflowEnabled(req.params.name, enabled);
    res.json({ success: true, enabled });
  } catch (error: any) {
    logger.error({ error, name: req.params.name }, 'Failed to toggle workflow');
    res.status(500).json({ error: 'Failed to toggle workflow' });
  }
});

/**
 * List workflow executions
 */
router.get('/executions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 10;
    const executions = await workflowEngine.listExecutions(limit);
    res.json(executions);
  } catch (error: any) {
    logger.error({ error }, 'Failed to list executions');
    res.status(500).json({ error: 'Failed to list executions' });
  }
});

/**
 * Get execution status
 */
router.get('/executions/:id', async (req, res) => {
  try {
    const execution = await workflowEngine.getExecutionStatus(req.params.id);
    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }
    res.json(execution);
  } catch (error: any) {
    logger.error({ error, id: req.params.id }, 'Failed to get execution');
    res.status(500).json({ error: 'Failed to get execution' });
  }
});

export default router;
