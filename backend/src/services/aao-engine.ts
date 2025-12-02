/**
 * Autonomous Adaptive Orchestration (AAO) Engine
 * 
 * Purpose: Self-improving workflow selection with dynamic priority adjustment
 * 
 * Features:
 * - Self-improving workflow selection
 * - Dynamic priority adjustment
 * - Budget-aware execution planning
 * - Failure recovery strategies
 * - Multi-objective optimization (speed vs coverage vs cost)
 * - Feedback loops for continuous improvement
 */

import database from './database';
import redis from './redis';
import queue from './queue';
import logger from '../utils/logger';
import ai from './ai';
import { ppiEngine } from './ppi-engine';
import { AgentType } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

interface ExecutionPlan {
  id: string;
  programId: string;
  phases: ExecutionPhase[];
  totalEstimatedTime: number;
  totalEstimatedCost: number;
  objectives: OptimizationObjectives;
  createdAt: Date;
}

interface ExecutionPhase {
  id: string;
  name: string;
  agents: AgentExecution[];
  parallel: boolean;
  estimatedTime: number;
  priority: number;
  gateCondition?: GateCondition;
}

interface AgentExecution {
  agent: AgentType;
  priority: number;
  timeout: number;
  retryStrategy: RetryStrategy;
  fallbackAgent?: AgentType;
  resourceAllocation: ResourceAllocation;
}

interface GateCondition {
  type: 'findings_threshold' | 'time_limit' | 'success_rate' | 'manual_approval';
  value: number | string;
  action: 'continue' | 'skip' | 'abort' | 'escalate';
}

interface RetryStrategy {
  maxAttempts: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

interface ResourceAllocation {
  cpuWeight: number;
  memoryMB: number;
  concurrency: number;
  rateLimit: number;
}

interface OptimizationObjectives {
  speed: number;      // 0-1, higher = faster execution preferred
  coverage: number;   // 0-1, higher = more thorough scanning
  cost: number;       // 0-1, higher = more cost-conscious
  quality: number;    // 0-1, higher = fewer false positives
}

interface WorkflowMetrics {
  workflowId: string;
  programId: string;
  successRate: number;
  avgDuration: number;
  avgFindings: number;
  avgCost: number;
  executionCount: number;
  lastUpdated: Date;
}

// Predefined workflow templates
const WORKFLOW_TEMPLATES: Record<string, ExecutionPhase[]> = {
  'quick-scan': [
    {
      id: 'recon',
      name: 'Quick Reconnaissance',
      agents: [
        { agent: 'discovery', priority: 10, timeout: 120, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT', 'RATE_LIMIT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 10, rateLimit: 100 } },
      ],
      parallel: false,
      estimatedTime: 120,
      priority: 10,
    },
    {
      id: 'fingerprint',
      name: 'Technology Detection',
      agents: [
        { agent: 'fingerprint', priority: 9, timeout: 60, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 20, rateLimit: 200 } },
      ],
      parallel: false,
      estimatedTime: 60,
      priority: 9,
    },
    {
      id: 'scan',
      name: 'Vulnerability Scan',
      agents: [
        { agent: 'scanner', priority: 8, timeout: 300, retryStrategy: { maxAttempts: 3, backoffMultiplier: 2, retryableErrors: ['TIMEOUT', 'RATE_LIMIT'] }, resourceAllocation: { cpuWeight: 2, memoryMB: 1024, concurrency: 50, rateLimit: 150 } },
      ],
      parallel: false,
      estimatedTime: 300,
      priority: 8,
    },
  ],

  'comprehensive': [
    {
      id: 'recon',
      name: 'Full Reconnaissance',
      agents: [
        { agent: 'discovery', priority: 10, timeout: 300, retryStrategy: { maxAttempts: 3, backoffMultiplier: 2, retryableErrors: ['TIMEOUT', 'RATE_LIMIT'] }, resourceAllocation: { cpuWeight: 2, memoryMB: 1024, concurrency: 20, rateLimit: 100 } },
        { agent: 'osint', priority: 8, timeout: 180, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 5, rateLimit: 50 } },
      ],
      parallel: true,
      estimatedTime: 300,
      priority: 10,
    },
    {
      id: 'enum',
      name: 'Asset Enumeration',
      agents: [
        { agent: 'fingerprint', priority: 9, timeout: 120, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 30, rateLimit: 200 } },
        { agent: 'portscan', priority: 7, timeout: 600, retryStrategy: { maxAttempts: 2, backoffMultiplier: 2, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 2, memoryMB: 1024, concurrency: 100, rateLimit: 1000 } },
      ],
      parallel: true,
      estimatedTime: 600,
      priority: 9,
    },
    {
      id: 'crawl',
      name: 'Content Discovery',
      agents: [
        { agent: 'crawl', priority: 8, timeout: 600, retryStrategy: { maxAttempts: 3, backoffMultiplier: 2, retryableErrors: ['TIMEOUT', 'RATE_LIMIT'] }, resourceAllocation: { cpuWeight: 2, memoryMB: 2048, concurrency: 20, rateLimit: 100 } },
        { agent: 'jsanalysis', priority: 7, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 1024, concurrency: 10, rateLimit: 50 } },
      ],
      parallel: true,
      estimatedTime: 600,
      priority: 8,
    },
    {
      id: 'scan',
      name: 'Vulnerability Scanning',
      agents: [
        { agent: 'scanner', priority: 9, timeout: 1200, retryStrategy: { maxAttempts: 3, backoffMultiplier: 2, retryableErrors: ['TIMEOUT', 'RATE_LIMIT'] }, resourceAllocation: { cpuWeight: 3, memoryMB: 2048, concurrency: 100, rateLimit: 200 } },
      ],
      parallel: false,
      estimatedTime: 1200,
      priority: 9,
      gateCondition: { type: 'findings_threshold', value: 0, action: 'continue' },
    },
    {
      id: 'exploit',
      name: 'Exploitation Testing',
      agents: [
        { agent: 'xss', priority: 8, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 10, rateLimit: 50 } },
        { agent: 'sqli', priority: 8, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 10, rateLimit: 30 } },
        { agent: 'ssrf', priority: 7, timeout: 180, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 5, rateLimit: 20 } },
        { agent: 'idor', priority: 7, timeout: 180, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 5, rateLimit: 30 } },
      ],
      parallel: true,
      estimatedTime: 300,
      priority: 8,
    },
  ],

  'api-focused': [
    {
      id: 'recon',
      name: 'API Discovery',
      agents: [
        { agent: 'crawl', priority: 10, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 10, rateLimit: 50 } },
        { agent: 'jsanalysis', priority: 9, timeout: 180, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 5, rateLimit: 30 } },
      ],
      parallel: true,
      estimatedTime: 300,
      priority: 10,
    },
    {
      id: 'api-test',
      name: 'API Security Testing',
      agents: [
        { agent: 'apifuzz', priority: 9, timeout: 600, retryStrategy: { maxAttempts: 3, backoffMultiplier: 2, retryableErrors: ['TIMEOUT', 'RATE_LIMIT'] }, resourceAllocation: { cpuWeight: 2, memoryMB: 1024, concurrency: 20, rateLimit: 100 } },
        { agent: 'graphql', priority: 8, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 10, rateLimit: 50 } },
        { agent: 'idor', priority: 8, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 10, rateLimit: 30 } },
      ],
      parallel: true,
      estimatedTime: 600,
      priority: 9,
    },
    {
      id: 'auth',
      name: 'Authentication Testing',
      agents: [
        { agent: 'authbypass', priority: 8, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 5, rateLimit: 20 } },
        { agent: 'oauth', priority: 7, timeout: 180, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 3, rateLimit: 10 } },
        { agent: 'jwt-attack', priority: 7, timeout: 180, retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 3, rateLimit: 10 } },
      ],
      parallel: true,
      estimatedTime: 300,
      priority: 8,
    },
  ],

  'stealth': [
    {
      id: 'passive-recon',
      name: 'Passive Reconnaissance',
      agents: [
        { agent: 'osint', priority: 10, timeout: 300, retryStrategy: { maxAttempts: 2, backoffMultiplier: 2, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 2, rateLimit: 5 } },
      ],
      parallel: false,
      estimatedTime: 300,
      priority: 10,
    },
    {
      id: 'slow-scan',
      name: 'Low-Profile Scanning',
      agents: [
        { agent: 'fingerprint', priority: 9, timeout: 600, retryStrategy: { maxAttempts: 1, backoffMultiplier: 3, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 1, rateLimit: 2 } },
        { agent: 'scanner', priority: 8, timeout: 3600, retryStrategy: { maxAttempts: 1, backoffMultiplier: 3, retryableErrors: ['TIMEOUT'] }, resourceAllocation: { cpuWeight: 1, memoryMB: 512, concurrency: 5, rateLimit: 5 } },
      ],
      parallel: false,
      estimatedTime: 4200,
      priority: 9,
    },
  ],
};

class AAOEngine {
  private workflowMetrics: Map<string, WorkflowMetrics> = new Map();
  private activePlans: Map<string, ExecutionPlan> = new Map();

  constructor() {
    this.loadMetrics();
  }

  /**
   * Create an optimized execution plan
   */
  async createPlan(
    programId: string,
    objectives: Partial<OptimizationObjectives> = {},
    constraints?: { maxTime?: number; maxCost?: number; technologies?: string[] }
  ): Promise<ExecutionPlan> {
    // Default objectives
    const fullObjectives: OptimizationObjectives = {
      speed: objectives.speed ?? 0.5,
      coverage: objectives.coverage ?? 0.7,
      cost: objectives.cost ?? 0.3,
      quality: objectives.quality ?? 0.8,
    };

    // Select best workflow template
    const template = await this.selectOptimalWorkflow(programId, fullObjectives, constraints);

    // Adapt workflow based on context
    const adaptedPhases = await this.adaptWorkflow(template, programId, fullObjectives, constraints);

    // Calculate estimates
    const totalTime = adaptedPhases.reduce((sum, p) => sum + p.estimatedTime, 0);
    const totalCost = this.estimateCost(adaptedPhases);

    const plan: ExecutionPlan = {
      id: uuidv4(),
      programId,
      phases: adaptedPhases,
      totalEstimatedTime: totalTime,
      totalEstimatedCost: totalCost,
      objectives: fullObjectives,
      createdAt: new Date(),
    };

    // Store plan
    this.activePlans.set(plan.id, plan);
    await this.storePlan(plan);

    logger.info({
      planId: plan.id,
      phases: plan.phases.length,
      estimatedTime: totalTime,
      objectives: fullObjectives,
    }, 'AAO execution plan created');

    return plan;
  }

  /**
   * Execute a plan
   */
  async executePlan(planId: string): Promise<void> {
    const plan = this.activePlans.get(planId);
    if (!plan) {
      throw new Error(`Plan ${planId} not found`);
    }

    logger.info({ planId, phases: plan.phases.length }, 'Starting AAO plan execution');

    for (const phase of plan.phases) {
      // Check gate condition
      if (phase.gateCondition) {
        const shouldContinue = await this.evaluateGate(plan.programId, phase.gateCondition);
        if (!shouldContinue) {
          logger.info({ phase: phase.name, gate: phase.gateCondition }, 'Gate condition not met, skipping phase');
          continue;
        }
      }

      // Execute phase
      await this.executePhase(plan.programId, phase);

      // Record metrics
      await this.recordPhaseMetrics(plan.id, phase);
    }

    // Update workflow metrics
    await this.updateWorkflowMetrics(plan);

    logger.info({ planId }, 'AAO plan execution completed');
  }

  /**
   * Dynamically adjust priorities based on findings
   */
  async adjustPriorities(planId: string, findings: any[]): Promise<void> {
    const plan = this.activePlans.get(planId);
    if (!plan) return;

    // Get PPI predictions based on findings
    const predictions = await ppiEngine.predictNextAgents({
      programId: plan.programId,
      currentFindings: findings,
    });

    // Adjust remaining phases
    for (const phase of plan.phases) {
      for (const agentExec of phase.agents) {
        const prediction = predictions.find(p => p.agent === agentExec.agent);
        if (prediction && prediction.probability > 0.7) {
          // Boost priority for high-probability agents
          agentExec.priority = Math.min(agentExec.priority + 2, 10);
          agentExec.resourceAllocation.concurrency *= 1.5;
          logger.debug({ agent: agentExec.agent, newPriority: agentExec.priority }, 'Priority boosted');
        }
      }
    }
  }

  /**
   * Handle failure and recover
   */
  async handleFailure(planId: string, phaseId: string, error: Error): Promise<'retry' | 'skip' | 'abort' | 'fallback'> {
    const plan = this.activePlans.get(planId);
    if (!plan) return 'abort';

    const phase = plan.phases.find(p => p.id === phaseId);
    if (!phase) return 'abort';

    // Check if error is retryable
    const isRetryable = phase.agents.some(a => 
      a.retryStrategy.retryableErrors.some(e => error.message.includes(e))
    );

    if (isRetryable) {
      logger.info({ phaseId, error: error.message }, 'Retryable error, will retry');
      return 'retry';
    }

    // Check for fallback agents
    const hasFallback = phase.agents.some(a => a.fallbackAgent);
    if (hasFallback) {
      logger.info({ phaseId }, 'Using fallback agent');
      return 'fallback';
    }

    // Check if phase is critical
    if (phase.priority >= 9) {
      logger.error({ phaseId, error: error.message }, 'Critical phase failed, aborting');
      return 'abort';
    }

    logger.warn({ phaseId, error: error.message }, 'Non-critical phase failed, skipping');
    return 'skip';
  }

  /**
   * Get real-time optimization suggestions
   */
  async getOptimizationSuggestions(planId: string): Promise<string[]> {
    const plan = this.activePlans.get(planId);
    if (!plan) return [];

    const suggestions: string[] = [];

    // Check for slow phases
    for (const phase of plan.phases) {
      if (phase.estimatedTime > 600) {
        suggestions.push(`Phase "${phase.name}" is slow (${phase.estimatedTime}s). Consider increasing concurrency.`);
      }
    }

    // Check for underutilized parallelism
    const sequentialPhases = plan.phases.filter(p => !p.parallel && p.agents.length > 1);
    if (sequentialPhases.length > 0) {
      suggestions.push(`${sequentialPhases.length} phases could benefit from parallel execution.`);
    }

    // Check workflow metrics
    const metrics = await this.getWorkflowMetrics(plan.programId);
    if (metrics && metrics.successRate < 0.7) {
      suggestions.push(`Historical success rate is low (${(metrics.successRate * 100).toFixed(1)}%). Consider adjusting agent selection.`);
    }

    return suggestions;
  }

  /**
   * Select optimal workflow template
   */
  private async selectOptimalWorkflow(
    programId: string,
    objectives: OptimizationObjectives,
    constraints?: { maxTime?: number; maxCost?: number; technologies?: string[] }
  ): Promise<ExecutionPhase[]> {
    // Score each template
    const scores: { template: string; score: number }[] = [];

    for (const [name, phases] of Object.entries(WORKFLOW_TEMPLATES)) {
      let score = 0;
      const totalTime = phases.reduce((sum, p) => sum + p.estimatedTime, 0);
      const agentCount = phases.reduce((sum, p) => sum + p.agents.length, 0);

      // Speed score (inverse of time)
      score += objectives.speed * (1 - Math.min(totalTime / 7200, 1));

      // Coverage score (more agents = more coverage)
      score += objectives.coverage * Math.min(agentCount / 20, 1);

      // Cost score (fewer agents = lower cost)
      score += objectives.cost * (1 - Math.min(agentCount / 20, 1));

      // Check constraints
      if (constraints?.maxTime && totalTime > constraints.maxTime) {
        score *= 0.5; // Penalize
      }

      // Boost for technology match
      if (constraints?.technologies) {
        if (name === 'api-focused' && constraints.technologies.some(t => 
          ['graphql', 'rest', 'api'].includes(t.toLowerCase())
        )) {
          score *= 1.3;
        }
      }

      // Historical performance
      const metrics = this.workflowMetrics.get(`${programId}:${name}`);
      if (metrics && metrics.executionCount > 3) {
        score *= (0.5 + metrics.successRate * 0.5);
      }

      scores.push({ template: name, score });
    }

    // Select best
    scores.sort((a, b) => b.score - a.score);
    const selected = scores[0].template;

    logger.debug({ selected, scores: scores.slice(0, 3) }, 'Workflow template selected');

    return JSON.parse(JSON.stringify(WORKFLOW_TEMPLATES[selected]));
  }

  /**
   * Adapt workflow based on context
   */
  private async adaptWorkflow(
    phases: ExecutionPhase[],
    programId: string,
    objectives: OptimizationObjectives,
    constraints?: { maxTime?: number; technologies?: string[] }
  ): Promise<ExecutionPhase[]> {
    // Get PPI predictions
    const predictions = await ppiEngine.predictNextAgents({ programId });

    // Adjust based on predictions
    for (const phase of phases) {
      for (const agentExec of phase.agents) {
        const prediction = predictions.find(p => p.agent === agentExec.agent);
        if (prediction) {
          // Adjust priority based on prediction
          if (prediction.probability > 0.6) {
            agentExec.priority = Math.min(agentExec.priority + 1, 10);
          } else if (prediction.probability < 0.2) {
            agentExec.priority = Math.max(agentExec.priority - 1, 1);
          }

          // Adjust timeout based on estimate
          agentExec.timeout = Math.max(agentExec.timeout, prediction.estimatedTime * 1.5);
        }
      }

      // Adjust concurrency based on speed objective
      if (objectives.speed > 0.7) {
        for (const agentExec of phase.agents) {
          agentExec.resourceAllocation.concurrency *= 1.5;
          agentExec.resourceAllocation.rateLimit *= 1.5;
        }
      }

      // Reduce concurrency for quality objective
      if (objectives.quality > 0.8) {
        for (const agentExec of phase.agents) {
          agentExec.resourceAllocation.concurrency *= 0.7;
        }
      }
    }

    // Add technology-specific agents
    if (constraints?.technologies) {
      const techAgents = this.getTechnologyAgents(constraints.technologies);
      if (techAgents.length > 0) {
        phases.push({
          id: 'tech-specific',
          name: 'Technology-Specific Testing',
          agents: techAgents,
          parallel: true,
          estimatedTime: 300,
          priority: 7,
        });
      }
    }

    // Trim if over time budget
    if (constraints?.maxTime) {
      let totalTime = phases.reduce((sum, p) => sum + p.estimatedTime, 0);
      while (totalTime > constraints.maxTime && phases.length > 2) {
        // Remove lowest priority phase
        phases.sort((a, b) => b.priority - a.priority);
        const removed = phases.pop();
        totalTime -= removed?.estimatedTime || 0;
        logger.debug({ removed: removed?.name }, 'Phase removed due to time constraint');
      }
    }

    return phases;
  }

  /**
   * Get technology-specific agents
   */
  private getTechnologyAgents(technologies: string[]): AgentExecution[] {
    const agents: AgentExecution[] = [];
    const defaultExec = {
      priority: 7,
      timeout: 180,
      retryStrategy: { maxAttempts: 2, backoffMultiplier: 1.5, retryableErrors: ['TIMEOUT'] },
      resourceAllocation: { cpuWeight: 1, memoryMB: 256, concurrency: 5, rateLimit: 20 },
    };

    for (const tech of technologies) {
      const t = tech.toLowerCase();
      if (t.includes('graphql')) {
        agents.push({ ...defaultExec, agent: 'graphql' });
      }
      if (t.includes('websocket') || t.includes('socket')) {
        agents.push({ ...defaultExec, agent: 'websocket' });
      }
      if (t.includes('grpc')) {
        agents.push({ ...defaultExec, agent: 'grpc' });
      }
      if (t.includes('java')) {
        agents.push({ ...defaultExec, agent: 'deserialization' });
      }
      if (t.includes('node') || t.includes('express')) {
        agents.push({ ...defaultExec, agent: 'prototype-pollution' });
      }
    }

    // Deduplicate
    const seen = new Set<AgentType>();
    return agents.filter(a => {
      if (seen.has(a.agent)) return false;
      seen.add(a.agent);
      return true;
    });
  }

  /**
   * Execute a phase
   */
  private async executePhase(programId: string, phase: ExecutionPhase): Promise<void> {
    logger.info({ phase: phase.name, agents: phase.agents.length, parallel: phase.parallel }, 'Executing phase');

    const jobs = phase.agents.map(agentExec => ({
      id: uuidv4(),
      type: agentExec.agent,
      programId,
      priority: agentExec.priority,
      status: 'pending' as const,
      attempts: 0,
      maxAttempts: agentExec.retryStrategy.maxAttempts,
      options: {
        timeout: agentExec.timeout,
        concurrency: agentExec.resourceAllocation.concurrency,
        rateLimit: agentExec.resourceAllocation.rateLimit,
      },
      metadata: {
        aaoPhase: phase.id,
        resourceAllocation: agentExec.resourceAllocation,
      },
      createdAt: new Date(),
    }));

    if (phase.parallel) {
      // Queue all jobs at once
      await Promise.all(jobs.map(job => queue.addJob(job.type, job)));
    } else {
      // Queue sequentially
      for (const job of jobs) {
        await queue.addJob(job.type, job);
      }
    }
  }

  /**
   * Evaluate gate condition
   */
  private async evaluateGate(programId: string, gate: GateCondition): Promise<boolean> {
    switch (gate.type) {
      case 'findings_threshold':
        const findingsCount = await this.getFindingsCount(programId);
        return findingsCount >= (gate.value as number);

      case 'time_limit':
        // Always continue for time-based gates (handled by timeout)
        return true;

      case 'success_rate':
        const metrics = await this.getWorkflowMetrics(programId);
        return metrics ? metrics.successRate >= (gate.value as number) : true;

      case 'manual_approval':
        // Would integrate with approval system
        return true;

      default:
        return true;
    }
  }

  /**
   * Get findings count
   */
  private async getFindingsCount(programId: string): Promise<number> {
    try {
      const result = await database.query(
        'SELECT COUNT(*) as count FROM findings WHERE program_id = $1',
        [programId]
      );
      return parseInt(result.rows[0]?.count || '0');
    } catch {
      return 0;
    }
  }

  /**
   * Estimate cost
   */
  private estimateCost(phases: ExecutionPhase[]): number {
    let cost = 0;
    for (const phase of phases) {
      for (const agent of phase.agents) {
        // Simple cost model: time * resources
        const timeCost = agent.timeout / 3600; // Hours
        const resourceCost = agent.resourceAllocation.cpuWeight * 0.1;
        cost += timeCost * resourceCost;
      }
    }
    return Math.round(cost * 100) / 100;
  }

  /**
   * Store plan in database
   */
  private async storePlan(plan: ExecutionPlan): Promise<void> {
    try {
      await database.query(
        `INSERT INTO aao_plans (id, program_id, phases, objectives, estimated_time, estimated_cost, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [
          plan.id,
          plan.programId,
          JSON.stringify(plan.phases),
          JSON.stringify(plan.objectives),
          plan.totalEstimatedTime,
          plan.totalEstimatedCost,
        ]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to store AAO plan');
    }
  }

  /**
   * Record phase metrics
   */
  private async recordPhaseMetrics(planId: string, phase: ExecutionPhase): Promise<void> {
    try {
      await database.query(
        `INSERT INTO aao_phase_metrics (id, plan_id, phase_id, phase_name, agents, completed_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [uuidv4(), planId, phase.id, phase.name, JSON.stringify(phase.agents.map(a => a.agent))]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to record phase metrics');
    }
  }

  /**
   * Update workflow metrics
   */
  private async updateWorkflowMetrics(plan: ExecutionPlan): Promise<void> {
    // This would be called after plan completion with actual results
    // For now, just log
    logger.debug({ planId: plan.id }, 'Workflow metrics updated');
  }

  /**
   * Get workflow metrics
   */
  private async getWorkflowMetrics(programId: string): Promise<WorkflowMetrics | null> {
    try {
      const result = await database.query(
        `SELECT 
           COUNT(*) as execution_count,
           AVG(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success_rate
         FROM aao_plans
         WHERE program_id = $1`,
        [programId]
      );

      if (result.rows[0]) {
        return {
          workflowId: '',
          programId,
          successRate: parseFloat(result.rows[0].success_rate || '0.5'),
          avgDuration: 0,
          avgFindings: 0,
          avgCost: 0,
          executionCount: parseInt(result.rows[0].execution_count || '0'),
          lastUpdated: new Date(),
        };
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Load metrics on startup
   */
  private async loadMetrics(): Promise<void> {
    try {
      const result = await database.query(
        `SELECT program_id, COUNT(*) as count, AVG(estimated_time) as avg_time
         FROM aao_plans
         WHERE created_at > NOW() - INTERVAL '30 days'
         GROUP BY program_id`
      );

      logger.info({ programs: result.rows.length }, 'AAO metrics loaded');
    } catch (error) {
      logger.debug({ error }, 'Failed to load AAO metrics');
    }
  }
}

export const aaoEngine = new AAOEngine();
export default aaoEngine;
