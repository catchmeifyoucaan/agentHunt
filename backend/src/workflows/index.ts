/**
 * Workflow Registry
 * Register all declarative workflows here
 */

import workflowEngine from '../services/workflow-engine';
import { subdomainEnumerationWorkflow } from './subdomain-enumeration';
import { vulnerabilityScanningWorkflow } from './vulnerability-scanning';
import logger from '../utils/logger';

/**
 * Register all workflows with the workflow engine
 */
export async function registerAllWorkflows(): Promise<void> {
  logger.info('Registering declarative workflows...');

  const workflows = [subdomainEnumerationWorkflow, vulnerabilityScanningWorkflow];

  for (const workflow of workflows) {
    try {
      await workflowEngine.registerWorkflow(workflow);
      logger.info({ workflow: workflow.name, version: workflow.version }, 'Workflow registered');
    } catch (error: any) {
      logger.error({ error, workflow: workflow.name }, 'Failed to register workflow');
    }
  }

  logger.info({ count: workflows.length }, 'All workflows registered');
}

/**
 * Execute workflow based on job completion
 */
export async function executeWorkflowsForJob(
  jobType: string,
  result: any,
  programId: string
): Promise<void> {
  const workflows = await workflowEngine.listWorkflows();

  for (const workflow of workflows) {
    if (!workflow.enabled) continue;

    // Check if workflow should be triggered
    const triggerContext = {
      agentType: jobType,
      result,
      programId,
    };

    // Load full workflow to check trigger condition
    // In production, this would be optimized with cached workflow definitions
    try {
      // For now, just log that workflows could be executed
      logger.debug(
        { workflow: workflow.name, jobType, programId },
        'Checking workflow trigger conditions'
      );
    } catch (error: any) {
      logger.error({ error, workflow: workflow.name }, 'Failed to check workflow trigger');
    }
  }
}
