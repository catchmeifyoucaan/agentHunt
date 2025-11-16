/**
 * Agent Collaboration Types
 * Inspired by Claude Code's multi-agent coordination patterns
 */

export type AgentType =
  | 'discovery'
  | 'subdomain'
  | 'bruteforce'
  | 'fingerprint'
  | 'crawl'
  | 'portscan'
  | 'scanner'
  | 'interact'
  | 'confirm'
  | 'triage'
  | 'intelligent-triage'
  | 'browser'
  | 'manager'
  | 'three-agent'
  | 'osint'
  | 'xss'
  | 'sqli'
  | 'webvulns'
  | 'jsanalysis'
  | 'cloudmisconfig'
  | 'apifuzzing'
  | 'apifuzz'
  | 'ssrf'
  | 'deserialization'
  | 'racecondition'
  | 'authbypass'
  | 'secrethunter'
  | 'socialmediaosint'
  | 'visualrecon'
  | 'dependencyscan'
  | 'ctmonitor'
  | 'wafbypass'
  | 'iacscan'
  | 'businesslogic'
  | 'high-cpu-queue'
  | 'network-io-queue';

export type MessageType = 'handoff' | 'query' | 'notification' | 'approval_request' | 'response';
export type AgentStatus = 'healthy' | 'degraded' | 'unhealthy' | 'offline';
export type JobProgressStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

/**
 * Agent Identity
 * Uniquely identifies an agent instance with its capabilities
 */
export interface AgentIdentity {
  type: AgentType;
  instanceId: string;
  capabilities: string[];
  currentLoad: number;
  version: string;
}

/**
 * Agent-to-Agent Message
 * Protocol for agents to communicate with each other
 */
export interface AgentMessage {
  id: string;
  type: MessageType;
  from: AgentIdentity;
  to: AgentIdentity;
  payload: any;
  replyTo?: string;
  expiresAt?: Date;
  createdAt: Date;
}

/**
 * Rich Context Handoff
 * Complete context package for agent-to-agent handoffs
 * Based on Claude Code's context preservation pattern
 */
export interface RichHandoff {
  id: string;
  fromAgent: AgentInfo;
  toAgent: AgentInfo;

  // Complete context package
  context: HandoffContext;

  // Return expectations
  outputContract: OutputContract;

  // Metadata
  createdAt: Date;
  status: 'pending' | 'accepted' | 'rejected' | 'completed';
}

export interface AgentInfo {
  type: AgentType;
  instanceId: string;
  jobId: string;
  programId: string;
}

export interface HandoffContext {
  // All data from parent job
  parentResult: {
    type?: string;
    data?: any;
    metrics?: JobMetrics;
    timestamp?: Date;
    [key: string]: any; // Allow additional properties from agents
  };

  // Why this handoff happened
  reasoning: {
    trigger: string;
    confidence: number;
    alternatives?: string[];
    decisionFactors: Record<string, any> | string[];
  };

  // What the next agent should do
  objectives: {
    primary: string;
    secondary: string[];
    avoid?: string[];
  };

  // How success is measured
  successCriteria: {
    minAssets?: number;
    maxDuration?: number;
    requiredFields?: string[];
    qualityThreshold?: number;
    customCriteria?: Record<string, any>; // Allow custom criteria
  };

  // Constraints from parent
  inherited: {
    programId: string;
    rateLimit: number;
    timeout: number;
    safetyChecks?: string[] | boolean; // Allow boolean for backward compatibility
    budget?: {
      maxCost?: number;
      maxTime?: number;
      maxResources?: number;
      [key: string]: any; // Allow additional budget properties
    };
    retryPolicy?: any; // Allow retry policy
  };
}

export interface OutputContract {
  format?: 'structured' | 'unstructured' | string; // Allow any string format
  requiredFields?: string[];
  shouldTriggerNextHandoff?: boolean;
  [key: string]: any; // Allow additional properties
  expectedVolume?: {
    min: number;
    max: number;
  } | number; // Allow number for simpler cases
}

export interface JobMetrics {
  duration: number;
  itemsProcessed: number;
  itemsFound: number;
  cost: number;
  resourceUsage: {
    cpu: number;
    memory: number;
    network: number;
  };
}

/**
 * Job Progress Tracking
 * Inspired by Claude Code's TodoWrite pattern
 */
export interface JobProgress {
  jobId: string;
  phase: string;
  steps: ProgressStep[];
  currentStep: number;
  estimatedCompletion: Date;
  overallProgress: number; // 0-100
}

export interface ProgressStep {
  name: string;
  status: JobProgressStatus;
  startTime?: Date;
  endTime?: Date;
  progress?: number; // 0-100
  metadata?: Record<string, any>;
  error?: string;
}

/**
 * Command Validation
 * Pre-execution validation to prevent errors
 */
export interface CommandValidation {
  safe: boolean;
  reasons: string[];
  estimatedResources?: ResourceEstimate;
  warnings?: string[];
}

export interface ResourceEstimate {
  memory: number; // MB
  cpu: number; // Cores
  duration: number; // Seconds
  networkIO: number; // MB
  diskIO: number; // MB
}

/**
 * Checkpoint System
 * Rollback capability for failed jobs
 */
export interface Checkpoint {
  id: string;
  jobId: string;
  state: CheckpointState;
  createdAt: Date;
}

export interface CheckpointState {
  jobStatus: string;
  assetCount: number;
  findingCount: number;
  handoffCount: number;
  artifacts: string[];
  databaseSnapshot?: any;
}

/**
 * Agent Health
 * Monitoring and self-healing
 */
export interface AgentHealth {
  agentType: AgentType;
  instanceId: string;
  status: AgentStatus;
  metrics: HealthMetrics;
  lastHeartbeat: Date;
  issues?: HealthIssue[];
}

export interface HealthMetrics {
  jobsProcessed: number;
  jobsFailed: number;
  avgDuration: number;
  memoryUsage: number;
  cpuUsage: number;
  queueDepth: number;
  errorRate: number;
}

export interface HealthIssue {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  message: string;
  timestamp: Date;
  autoHealing?: {
    attempted: boolean;
    successful: boolean;
    action: string;
  };
}

/**
 * Declarative Workflow
 * Define agent workflows as reusable templates
 */
export interface AgentWorkflow {
  name: string;
  version: string;
  description: string;
  trigger: TriggerCondition;
  steps: WorkflowStep[];
  errorHandling: ErrorStrategy;
  metadata?: Record<string, any>;
}

export interface TriggerCondition {
  on: 'job:complete' | 'job:failed' | 'threshold:exceeded' | 'manual' | 'schedule';
  when: (context: any) => boolean;
  filters?: Record<string, any>;
}

export interface WorkflowStep {
  id: string;
  name: string;
  agent: AgentType | 'multi';
  input: (context: any) => any;
  output: string; // Variable name for next steps
  parallel?: boolean;
  retryStrategy?: RetryStrategy;
  timeout?: number;
  dependencies?: string[]; // Step IDs that must complete first
}

export interface RetryStrategy {
  maxAttempts: number;
  backoff: 'linear' | 'exponential';
  initialDelay: number;
  maxDelay: number;
  retryOn?: string[]; // Error types to retry
}

export interface ErrorStrategy {
  onStepFailure: 'stop' | 'continue' | 'rollback';
  onCriticalFailure: 'stop' | 'rollback' | 'notify';
  notifyOn: ('step-failure' | 'critical-failure' | 'degraded-performance')[];
  fallback?: WorkflowStep;
}

/**
 * Parallel Job Specification
 * For scheduling independent jobs concurrently
 */
export interface ParallelJobSpec {
  jobs: JobSpec[];
  maxConcurrency?: number;
  waitFor?: 'all' | 'any' | 'first';
  timeout?: number;
}

export interface JobSpec {
  type: AgentType;
  priority: 'low' | 'medium' | 'high' | 'critical';
  dependencies: string[]; // Job IDs
  waitFor?: 'completion' | 'start';
  input: any;
  constraints?: {
    maxDuration?: number;
    maxCost?: number;
    requiredCapabilities?: string[];
  };
}

/**
 * Validation Result
 * Generic validation response
 */
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

export interface ValidationError {
  code: string;
  message: string;
  field?: string;
  severity: 'error' | 'critical';
}

export interface ValidationWarning {
  code: string;
  message: string;
  field?: string;
  suggestion?: string;
}
