/**
 * Workflow Tracing Service
 * Tracks and visualizes multi-step job execution chains
 */

import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface JobTraceNode {
  id: string;
  type: string;
  status: string;
  createdAt: Date;
  completedAt?: Date;
  parentJobId?: string;
  children: JobTraceNode[];
  depth: number;
}

interface WorkflowChain {
  id: string;
  rootJobId: string;
  totalJobs: number;
  completedJobs: number;
  status: 'running' | 'completed' | 'failed' | 'mixed';
  chain: JobTraceNode[];
}

class WorkflowTracingService {
  /**
   * Get a complete job execution chain starting from a root job
   */
  async getExecutionChain(jobId: string): Promise<WorkflowChain | null> {
    try {
      // First, find the root job (job with no parent)
      const rootJobId = await this.findRootJob(jobId);
      if (!rootJobId) {
        return null;
      }

      // Get the full chain starting from root
      const chain = await this.buildJobTraceTree(rootJobId);
      
      // Calculate workflow statistics
      const allJobs = this.flattenTree(chain);
      const completedJobs = allJobs.filter(j => j.status === 'completed').length;
      const failedJobs = allJobs.filter(j => j.status === 'failed').length;
      
      let status: 'running' | 'completed' | 'failed' | 'mixed' = 'running';
      if (failedJobs > 0 && completedJobs === 0) {
        status = 'failed';
      } else if (completedJobs === allJobs.length) {
        status = 'completed';
      } else if (failedJobs > 0) {
        status = 'mixed';
      }

      return {
        id: uuidv4(),
        rootJobId,
        totalJobs: allJobs.length,
        completedJobs,
        status,
        chain
      };
    } catch (error: any) {
      logger.error({ error, jobId }, 'Failed to get execution chain');
      throw error;
    }
  }

  /**
   * Find the root job (job with no parent) for a given job
   */
  private async findRootJob(jobId: string): Promise<string | null> {
    let currentId = jobId;
    
    while (currentId) {
      const result = await database.query(
        'SELECT parent_job_id FROM jobs WHERE id = $1',
        [currentId]
      );
      
      if (result.rows.length === 0) {
        return null; // Job doesn't exist
      }
      
      const parentJobId = result.rows[0].parent_job_id;
      if (!parentJobId) {
        return currentId; // This is the root
      }
      
      currentId = parentJobId;
    }
    
    return null;
  }

  /**
   * Build a tree structure of job relationships
   */
  private async buildJobTraceTree(jobId: string, depth: number = 0, visited: Set<string> = new Set()): Promise<JobTraceNode> {
    if (visited.has(jobId)) {
      // Avoid circular references
      return {
        id: jobId,
        type: 'circular-reference',
        status: 'error',
        createdAt: new Date(),
        depth,
        children: []
      };
    }
    
    visited.add(jobId);
    
    const result = await database.query(`
      SELECT id, type, status, created_at, completed_at, parent_job_id
      FROM jobs 
      WHERE id = $1
    `, [jobId]);
    
    if (result.rows.length === 0) {
      throw new Error(`Job not found: ${jobId}`);
    }
    
    const jobRow = result.rows[0];
    
    // Get child jobs
    const childResult = await database.query(`
      SELECT id FROM jobs 
      WHERE parent_job_id = $1
      ORDER BY created_at ASC
    `, [jobId]);
    
    const children: JobTraceNode[] = [];
    for (const childRow of childResult.rows) {
      const childNode = await this.buildJobTraceTree(childRow.id, depth + 1, new Set(visited));
      children.push(childNode);
    }
    
    return {
      id: jobRow.id,
      type: jobRow.type,
      status: jobRow.status,
      createdAt: jobRow.created_at,
      completedAt: jobRow.completed_at,
      parentJobId: jobRow.parent_job_id,
      children,
      depth
    };
  }

  /**
   * Flatten the tree structure to get all jobs in the chain
   */
  private flattenTree(node: JobTraceNode): JobTraceNode[] {
    const result: JobTraceNode[] = [node];
    for (const child of node.children) {
      result.push(...this.flattenTree(child));
    }
    return result;
  }

  /**
   * Get all active workflow chains for a program
   */
  async getActiveWorkflows(programId: string): Promise<WorkflowChain[]> {
    try {
      // Get all root jobs for the program (jobs with no parent)
      const rootJobsResult = await database.query(`
        SELECT j1.id 
        FROM jobs j1 
        LEFT JOIN jobs j2 ON j1.id = j2.parent_job_id 
        WHERE j1.program_id = $1 AND j1.parent_job_id IS NULL
        GROUP BY j1.id
        HAVING COUNT(j2.id) >= 0  -- Include jobs that have or don't have children
        ORDER BY j1.created_at DESC
        LIMIT 50
      `, [programId]);

      const workflows: WorkflowChain[] = [];
      for (const row of rootJobsResult.rows) {
        const chain = await this.getExecutionChain(row.id);
        if (chain) {
          workflows.push(chain);
        }
      }

      return workflows;
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to get active workflows');
      throw error;
    }
  }

  /**
   * Get statistics for a workflow chain
   */
  async getWorkflowStats(jobId: string): Promise<{
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    runningJobs: number;
    avgJobDuration: number; // in seconds
    totalDuration: number; // in seconds
  } | null> {
    const chain = await this.getExecutionChain(jobId);
    if (!chain) return null;

    const allJobs = this.flattenTree(chain.chain);

    const completedJobs = allJobs.filter(j => j.status === 'completed');
    const failedJobs = allJobs.filter(j => j.status === 'failed');
    const runningJobs = allJobs.filter(j => j.status === 'pending' || j.status === 'active');

    // Calculate average job duration
    let totalJobDuration = 0;
    let completedCount = 0;
    for (const job of completedJobs) {
      if (job.createdAt && job.completedAt) {
        const duration = new Date(job.completedAt).getTime() - new Date(job.createdAt).getTime();
        totalJobDuration += duration;
        completedCount++;
      }
    }
    const avgJobDuration = completedCount > 0 ? Math.round(totalJobDuration / completedCount / 1000) : 0;

    // Calculate total workflow duration
    const creationTimes = allJobs.map(j => new Date(j.createdAt).getTime());
    const completionTimes = completedJobs.map(j => j.completedAt ? new Date(j.completedAt!).getTime() : null).filter(Boolean) as number[];
    
    const minCreation = Math.min(...creationTimes);
    const maxCompletion = completionTimes.length > 0 ? Math.max(...completionTimes) : Date.now();
    const totalDuration = Math.round((maxCompletion - minCreation) / 1000);

    return {
      totalJobs: allJobs.length,
      completedJobs: completedJobs.length,
      failedJobs: failedJobs.length,
      runningJobs: runningJobs.length,
      avgJobDuration,
      totalDuration
    };
  }

  /**
   * Search for jobs in a workflow by type or status
   */
  async searchInWorkflow(rootJobId: string, filters: {
    type?: string;
    status?: string;
    limit?: number;
  }): Promise<JobTraceNode[]> {
    const chain = await this.getExecutionChain(rootJobId);
    if (!chain) return [];

    const allJobs = this.flattenTree(chain.chain);
    let filteredJobs = allJobs;

    if (filters.type) {
      filteredJobs = filteredJobs.filter(j => j.type === filters.type);
    }
    if (filters.status) {
      filteredJobs = filteredJobs.filter(j => j.status === filters.status);
    }

    return filteredJobs.slice(0, filters.limit || 50);
  }
}

export const workflowTracingService = new WorkflowTracingService();
export default workflowTracingService;