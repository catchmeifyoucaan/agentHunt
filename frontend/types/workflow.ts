// Workflow and Job Chain Types

export interface JobTraceNode {
  id: string;
  type: string;
  status: string;
  createdAt: Date | string;
  completedAt?: Date | string;
  parentJobId?: string;
  children: JobTraceNode[];
  depth: number;
}

export interface WorkflowChain {
  id: string;
  rootJobId: string;
  totalJobs: number;
  completedJobs: number;
  status: 'running' | 'completed' | 'failed' | 'mixed';
  chain: JobTraceNode;
}