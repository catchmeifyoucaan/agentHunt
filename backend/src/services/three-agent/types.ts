/**
 * Three-Agent Architecture Types
 * Defines types for Planner, Executor, and Researcher agents
 */

// ==============================================
// Common Types
// ==============================================

export interface Finding {
  id: string;
  type: string;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  url: string;
  evidence: string;
  httpRequest?: string;
  httpResponse?: string;
  metadata?: Record<string, any>;
  confidence: number; // 0.0-1.0
  timestamp: Date;
  discoveredBy?: string; // Agent ID
}

export interface Target {
  id: string;
  type: 'domain' | 'subdomain' | 'ip' | 'url' | 'endpoint';
  value: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  metadata?: Record<string, any>;
}

export interface Technique {
  id: string;
  name: string;
  description: string;
  successRate: number; // 0.0-1.0
  payload?: string;
  bypassMethod?: string;
  metadata?: Record<string, any>;
}

// ==============================================
// Planner Agent Types
// ==============================================

export interface TestingPhase {
  name: string;
  objectives: string[];
  estimatedDuration: number; // milliseconds
  resourceAllocation: {
    swarmSize: number;
    maxParallelCommands: number;
  };
  successCriteria: string[];
  dependencies: string[]; // Phase names that must complete first
}

export interface TestingPlan {
  id: string;
  programId: string;
  phases: TestingPhase[];
  totalEstimatedDuration: number; // milliseconds
  criticalPath: string[]; // Phase names in critical path
  resourceBudget: {
    maxSwarms: number;
    maxAgents: number;
    maxDuration: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface PlannerState {
  currentPhase: string;
  currentObjective: string;
  completedObjectives: string[];
  findingsCount: number;
  criticalFindingsCount: number;
  elapsedTime: number;
  estimatedRemainingTime: number;
}

export interface StrategyAdaptation {
  reason: string;
  changes: string[];
  newPhases?: TestingPhase[];
  resourceReallocation?: {
    from: string;
    to: string;
    amount: number;
  };
  expectedImprovement: string;
}

export interface ProgressUpdate {
  phaseProgress: Record<string, number>; // phase name -> % complete
  overallProgress: number; // 0.0-1.0
  findings: Finding[];
  currentFocus: string;
  recommendations: string[];
  shouldAdapt: boolean;
  adaptationReason?: string;
}

// ==============================================
// Executor Agent Types
// ==============================================

export interface Objective {
  id: string;
  type: 'reconnaissance' | 'enumeration' | 'vulnerability_scan' | 'exploitation' | 'validation';
  target: Target;
  description: string;
  parameters?: Record<string, any>;
  priority: number; // 1-10
  timeout?: number;
  constraints?: {
    noDoS?: boolean;
    rateLimit?: number;
    testingWindow?: {
      start: string;
      end: string;
    };
  };
}

export interface SwarmConfig {
  id: string;
  objectiveId: string;
  swarmSize: number;
  specialization: string; // 'xss', 'sqli', 'recon', etc.
  sharedMemoryEnabled: boolean;
  autonomyLevel: 'low' | 'medium' | 'high';
  maxDuration?: number;
  coordinationStrategy: 'independent' | 'collaborative' | 'hierarchical';
}

export interface SubAgent {
  id: string;
  swarmId: string;
  specialization: string;
  assignedTargets: Target[];
  status: 'idle' | 'running' | 'completed' | 'failed';
  findings: Finding[];
  startedAt?: Date;
  completedAt?: Date;
}

export interface SwarmResult {
  swarmId: string;
  objectiveId: string;
  totalAgents: number;
  completedAgents: number;
  failedAgents: number;
  findings: Finding[];
  successfulTechniques: Technique[];
  duration: number;
  efficiency: number; // findings per agent
}

export interface ExecutionResult {
  objectiveId: string;
  success: boolean;
  findings: Finding[];
  techniques: Technique[];
  duration: number;
  resourcesUsed: {
    swarms: number;
    agents: number;
    commands: number;
  };
  metadata?: Record<string, any>;
}

export interface ToolRequirement {
  purpose: string;
  language: 'python' | 'node' | 'bash' | 'go';
  inputs: Array<{ name: string; type: string; description: string }>;
  outputs: Array<{ name: string; type: string; description: string }>;
  requirements: string[];
  testCases?: Array<{ input: any; expectedOutput: any }>;
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  language: string;
  code: string;
  version: number;
  tested: boolean;
  successRate: number;
  createdAt: Date;
}

// ==============================================
// Researcher Agent Types
// ==============================================

export interface Review {
  reviewer: 'technical' | 'exploitability' | 'impact' | 'false_positive' | 'business';
  confidence: number; // 0.0-1.0
  verdict: 'valid' | 'invalid' | 'uncertain';
  reasoning: string;
  evidence?: string;
  metadata?: Record<string, any>;
}

export interface ValidationResult {
  findingId: string;
  valid: boolean;
  confidence: number; // 0.0-1.0
  reviews: Review[];
  poc?: string;
  pocVerified: boolean;
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  adjustedSeverity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  exploitability: number; // 0.0-1.0
  impact: number; // 0.0-1.0
  recommendations: string[];
  timestamp: Date;
}

export interface AttackChain {
  id: string;
  name: string;
  vulnerabilities: Finding[];
  steps: Array<{
    step: number;
    vulnerability: Finding;
    action: string;
    expectedResult: string;
  }>;
  combinedImpact: string;
  combinedSeverity: 'low' | 'medium' | 'high' | 'critical';
  poc?: string;
  verified: boolean;
  estimatedExploitTime: number; // milliseconds
}

export interface KnowledgeUpdate {
  patterns: Array<{
    pattern: string;
    occurrences: number;
    significance: number;
  }>;
  newTechniques: Technique[];
  falsePositiveIndicators: string[];
  successfulBypassMethods: string[];
  targetCharacteristics: Record<string, any>;
  recommendations: string[];
}

// ==============================================
// Shared Memory Types
// ==============================================

export interface SwarmMemory {
  swarmId: string;
  findings: Finding[];
  successfulTechniques: Technique[];
  failedAttempts: Array<{
    target: Target;
    technique: string;
    reason: string;
    timestamp: Date;
  }>;
  claimedTargets: Set<string>; // Target IDs
  sharedContext: Record<string, any>;
  updates: SwarmUpdate[];
}

export interface SwarmUpdate {
  type:
    | 'new_finding'
    | 'successful_technique'
    | 'failed_attempt'
    | 'critical_discovery'
    | 'strategy_change';
  agentId: string;
  timestamp: Date;
  data: any;
  priority: 'low' | 'medium' | 'high' | 'critical';
}

export interface CoordinationMessage {
  from: string; // Agent ID
  to: string; // Agent ID or 'all'
  type: 'claim_target' | 'share_finding' | 'share_technique' | 'request_help' | 'status_update';
  data: any;
  timestamp: Date;
}

// ==============================================
// Three-Agent Orchestration Types
// ==============================================

export interface ThreeAgentSession {
  id: string;
  programId: string;
  plan: TestingPlan;
  state: 'planning' | 'executing' | 'validating' | 'completed' | 'failed';
  plannerState: PlannerState;
  executorSwarms: SwarmConfig[];
  researcherQueue: Finding[];
  validatedFindings: ValidationResult[];
  attackChains: AttackChain[];
  startedAt: Date;
  completedAt?: Date;
  metadata?: Record<string, any>;
}

export interface AgentCommunication {
  from: 'planner' | 'executor' | 'researcher';
  to: 'planner' | 'executor' | 'researcher' | 'all';
  message: string;
  data?: any;
  timestamp: Date;
  requiresResponse: boolean;
}

export interface SessionMetrics {
  duration: number;
  totalFindings: number;
  validatedFindings: number;
  falsePositives: number;
  attackChains: number;
  swarmsDeployed: number;
  agentsUsed: number;
  efficiency: {
    findingsPerMinute: number;
    findingsPerAgent: number;
    validationAccuracy: number;
  };
}
