/**
 * Planner Agent - Strategic Layer
 * Creates comprehensive testing strategies and adapts based on findings
 * Monitors progress and reallocates resources dynamically
 */

import logger from '../../utils/logger';
import llmEngine from '../llm/llm-engine';
import { sharedMemory } from './shared-memory';
import {
  TestingPlan,
  TestingPhase,
  PlannerState,
  StrategyAdaptation,
  ProgressUpdate,
  Finding,
  Target,
} from './types';
import { v4 as uuidv4 } from 'uuid';

export class PlannerAgent {
  private plannerState: Map<string, PlannerState> = new Map();
  private activePlans: Map<string, TestingPlan> = new Map();

  /**
   * Create comprehensive testing strategy for a program
   * Breaks down scope into phases with duration estimates
   */
  async createTestingStrategy(
    programId: string,
    scope: {
      targets: Target[];
      constraints?: {
        noDoS?: boolean;
        rateLimit?: number;
        testingWindow?: { start: string; end: string };
      };
      assetTypes?: string[];
      vulnerabilityFocus?: string[];
    },
    resourceBudget: {
      maxSwarms: number;
      maxAgents: number;
      maxDuration: number; // milliseconds
    }
  ): Promise<TestingPlan> {
    logger.info({ programId }, 'Creating testing strategy');

    try {
      // Analyze scope with LLM to create strategic plan
      const strategyPrompt = `You are a senior penetration testing strategist. Create a comprehensive testing plan for the following scope:

**Targets:**
${scope.targets.map(t => `- ${t.type}: ${t.value} (Priority: ${t.priority})`).join('\n')}

**Constraints:**
${JSON.stringify(scope.constraints || {}, null, 2)}

**Asset Types:**
${scope.assetTypes?.join(', ') || 'Not specified'}

**Vulnerability Focus:**
${scope.vulnerabilityFocus?.join(', ') || 'All OWASP Top 10'}

**Resource Budget:**
- Max Swarms: ${resourceBudget.maxSwarms}
- Max Agents: ${resourceBudget.maxAgents}
- Max Duration: ${Math.round(resourceBudget.maxDuration / 1000 / 60)} minutes

Create a phased testing strategy with:
1. Phase names and objectives
2. Estimated duration for each phase
3. Resource allocation (swarm size, parallel commands)
4. Success criteria
5. Dependencies between phases
6. Critical path identification

Return a JSON object with this structure:
{
  "phases": [
    {
      "name": "Phase name",
      "objectives": ["objective1", "objective2"],
      "estimatedDuration": milliseconds,
      "resourceAllocation": {
        "swarmSize": number,
        "maxParallelCommands": number
      },
      "successCriteria": ["criteria1", "criteria2"],
      "dependencies": ["phase names that must complete first"]
    }
  ],
  "criticalPath": ["phase1", "phase2"],
  "reasoning": "Why this strategy is optimal"
}`;

      // Use Bedrock Claude Opus for strategic planning (high-level reasoning)
      const response = await llmEngine.complete(strategyPrompt, undefined, 'bedrock');

      let strategyData;
      try {
        // Extract JSON from response
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          strategyData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in LLM response');
        }
      } catch (parseError) {
        logger.error({ parseError, response }, 'Failed to parse LLM strategy response');
        // Fallback to default strategy
        strategyData = this.createDefaultStrategy(scope.targets, resourceBudget);
      }

      // Create testing plan
      const plan: TestingPlan = {
        id: uuidv4(),
        programId,
        phases: strategyData.phases.map((p: any) => ({
          name: p.name,
          objectives: p.objectives,
          estimatedDuration: p.estimatedDuration,
          resourceAllocation: {
            swarmSize: Math.min(p.resourceAllocation.swarmSize, resourceBudget.maxAgents),
            maxParallelCommands: p.resourceAllocation.maxParallelCommands,
          },
          successCriteria: p.successCriteria,
          dependencies: p.dependencies || [],
        })),
        totalEstimatedDuration: strategyData.phases.reduce(
          (sum: number, p: any) => sum + p.estimatedDuration,
          0
        ),
        criticalPath: strategyData.criticalPath || [],
        resourceBudget,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Store plan
      this.activePlans.set(programId, plan);

      // Initialize planner state
      this.plannerState.set(programId, {
        currentPhase: plan.phases[0]?.name || '',
        currentObjective: plan.phases[0]?.objectives[0] || '',
        completedObjectives: [],
        findingsCount: 0,
        criticalFindingsCount: 0,
        elapsedTime: 0,
        estimatedRemainingTime: plan.totalEstimatedDuration,
      });

      logger.info(
        {
          programId,
          planId: plan.id,
          phases: plan.phases.length,
          totalDuration: Math.round(plan.totalEstimatedDuration / 1000 / 60),
        },
        'Testing strategy created'
      );

      return plan;
    } catch (error: any) {
      logger.error({ error, programId }, 'Failed to create testing strategy');
      throw error;
    }
  }

  /**
   * Create default strategy when LLM fails
   */
  private createDefaultStrategy(
    targets: Target[],
    resourceBudget: { maxSwarms: number; maxAgents: number; maxDuration: number }
  ): any {
    const baseSwarmSize = Math.min(20, Math.floor(resourceBudget.maxAgents / 3));

    return {
      phases: [
        {
          name: 'Reconnaissance',
          objectives: [
            'Enumerate subdomains',
            'Identify technologies',
            'Map attack surface',
            'Discover endpoints',
          ],
          estimatedDuration: Math.round(resourceBudget.maxDuration * 0.2),
          resourceAllocation: {
            swarmSize: baseSwarmSize,
            maxParallelCommands: 50,
          },
          successCriteria: ['All targets enumerated', 'Technology stack identified'],
          dependencies: [],
        },
        {
          name: 'Vulnerability Discovery',
          objectives: [
            'Test for injection vulnerabilities',
            'Check authentication/authorization',
            'Test for XSS',
            'Scan for misconfigurations',
          ],
          estimatedDuration: Math.round(resourceBudget.maxDuration * 0.5),
          resourceAllocation: {
            swarmSize: Math.min(50, resourceBudget.maxAgents),
            maxParallelCommands: 100,
          },
          successCriteria: ['All endpoints tested', 'High-value findings validated'],
          dependencies: ['Reconnaissance'],
        },
        {
          name: 'Deep Exploitation',
          objectives: [
            'Chain vulnerabilities',
            'Escalate privileges',
            'Validate critical findings',
            'Develop PoCs',
          ],
          estimatedDuration: Math.round(resourceBudget.maxDuration * 0.3),
          resourceAllocation: {
            swarmSize: Math.min(30, Math.floor(resourceBudget.maxAgents / 2)),
            maxParallelCommands: 30,
          },
          successCriteria: ['All critical findings validated', 'PoCs developed'],
          dependencies: ['Vulnerability Discovery'],
        },
      ],
      criticalPath: ['Reconnaissance', 'Vulnerability Discovery', 'Deep Exploitation'],
      reasoning: 'Default three-phase strategy: recon → discovery → exploitation',
    };
  }

  /**
   * Monitor progress and generate updates
   * Continuously tracks swarm progress and findings
   */
  async monitorProgress(
    programId: string,
    swarmId: string,
    elapsedTime: number
  ): Promise<ProgressUpdate> {
    try {
      const plan = this.activePlans.get(programId);
      const state = this.plannerState.get(programId);

      if (!plan || !state) {
        throw new Error('No active plan or state found');
      }

      // Get current findings from shared memory
      const findings = await sharedMemory.getFindings(swarmId);
      const stats = await sharedMemory.getStats(swarmId);

      // Update state
      state.findingsCount = findings.length;
      state.criticalFindingsCount = findings.filter(
        f => f.severity === 'critical' || f.severity === 'high'
      ).length;
      state.elapsedTime = elapsedTime;

      // Calculate phase progress
      const phaseProgress: Record<string, number> = {};
      for (const phase of plan.phases) {
        // Simple progress calculation based on time elapsed
        const phaseElapsed = phase.name === state.currentPhase ? elapsedTime : 0;
        phaseProgress[phase.name] = Math.min(
          1.0,
          phaseElapsed / phase.estimatedDuration
        );
      }

      // Overall progress
      const completedPhases = plan.phases.filter(p =>
        state.completedObjectives.some(obj => p.objectives.includes(obj))
      );
      const overallProgress = completedPhases.length / plan.phases.length;

      // Generate recommendations
      const recommendations = this.generateRecommendations(
        findings,
        state,
        plan,
        stats
      );

      // Determine if strategy should adapt
      const shouldAdapt = this.shouldAdaptStrategy(findings, state, plan, elapsedTime);
      const adaptationReason = shouldAdapt
        ? this.getAdaptationReason(findings, state, plan, elapsedTime)
        : undefined;

      const update: ProgressUpdate = {
        phaseProgress,
        overallProgress,
        findings,
        currentFocus: state.currentObjective,
        recommendations,
        shouldAdapt,
        adaptationReason,
      };

      logger.debug(
        {
          programId,
          swarmId,
          progress: Math.round(overallProgress * 100),
          findings: findings.length,
        },
        'Progress update generated'
      );

      return update;
    } catch (error: any) {
      logger.error({ error, programId, swarmId }, 'Failed to monitor progress');
      throw error;
    }
  }

  /**
   * Generate strategic recommendations based on current state
   */
  private generateRecommendations(
    findings: Finding[],
    state: PlannerState,
    plan: TestingPlan,
    stats: any
  ): string[] {
    const recommendations: string[] = [];

    // Check for low findings rate
    if (state.elapsedTime > 60000 && findings.length < 5) {
      recommendations.push(
        'Low findings rate - consider expanding scope or adjusting techniques'
      );
    }

    // Check for high critical findings
    if (state.criticalFindingsCount > 3) {
      recommendations.push(
        'Multiple critical findings - prioritize validation and PoC development'
      );
    }

    // Check for claimed targets bottleneck
    if (stats.claimedTargets > stats.findings * 2) {
      recommendations.push(
        'Many claimed targets with few findings - agents may be stuck, consider timeout reduction'
      );
    }

    // Check for successful techniques
    if (stats.techniques > 5) {
      recommendations.push(
        `${stats.techniques} successful techniques shared - ensure all agents are leveraging them`
      );
    }

    // Time-based recommendations
    const timeRemaining = plan.totalEstimatedDuration - state.elapsedTime;
    if (timeRemaining < plan.totalEstimatedDuration * 0.2 && state.findingsCount < 10) {
      recommendations.push(
        'Approaching time limit with few findings - focus on high-value targets'
      );
    }

    return recommendations;
  }

  /**
   * Determine if strategy should adapt
   */
  private shouldAdaptStrategy(
    findings: Finding[],
    state: PlannerState,
    plan: TestingPlan,
    elapsedTime: number
  ): boolean {
    // Adapt if we found many critical findings early (shift to exploitation)
    if (state.criticalFindingsCount >= 5 && elapsedTime < plan.totalEstimatedDuration * 0.3) {
      return true;
    }

    // Adapt if no findings after significant time (try different approach)
    if (findings.length === 0 && elapsedTime > plan.totalEstimatedDuration * 0.4) {
      return true;
    }

    // Adapt if we're ahead of schedule with good findings
    if (
      findings.length > 20 &&
      state.criticalFindingsCount > 3 &&
      elapsedTime < plan.totalEstimatedDuration * 0.5
    ) {
      return true;
    }

    return false;
  }

  /**
   * Get reason for strategy adaptation
   */
  private getAdaptationReason(
    findings: Finding[],
    state: PlannerState,
    plan: TestingPlan,
    elapsedTime: number
  ): string {
    if (state.criticalFindingsCount >= 5 && elapsedTime < plan.totalEstimatedDuration * 0.3) {
      return 'Early critical findings detected - shifting focus to exploitation';
    }

    if (findings.length === 0 && elapsedTime > plan.totalEstimatedDuration * 0.4) {
      return 'No findings after significant time - trying alternative techniques';
    }

    if (
      findings.length > 20 &&
      state.criticalFindingsCount > 3 &&
      elapsedTime < plan.totalEstimatedDuration * 0.5
    ) {
      return 'Ahead of schedule with strong findings - accelerating to deep exploitation';
    }

    return 'Strategy adaptation needed';
  }

  /**
   * Adapt strategy based on findings and progress
   * Dynamic strategy modification
   */
  async adaptStrategy(
    programId: string,
    swarmId: string,
    reason: string,
    currentFindings: Finding[]
  ): Promise<StrategyAdaptation> {
    logger.info({ programId, swarmId, reason }, 'Adapting testing strategy');

    try {
      const plan = this.activePlans.get(programId);
      const state = this.plannerState.get(programId);

      if (!plan || !state) {
        throw new Error('No active plan or state found');
      }

      // Use LLM to generate adaptation strategy
      const adaptationPrompt = `You are a senior penetration testing strategist. Analyze the current testing progress and adapt the strategy.

**Current Strategy:**
${plan.phases.map(p => `- ${p.name}: ${p.objectives.join(', ')}`).join('\n')}

**Current State:**
- Current Phase: ${state.currentPhase}
- Elapsed Time: ${Math.round(state.elapsedTime / 1000 / 60)} minutes
- Total Findings: ${state.findingsCount}
- Critical Findings: ${state.criticalFindingsCount}
- Completed Objectives: ${state.completedObjectives.join(', ')}

**Recent Findings:**
${currentFindings
  .slice(0, 10)
  .map(f => `- ${f.severity.toUpperCase()}: ${f.type} at ${f.url}`)
  .join('\n')}

**Adaptation Reason:**
${reason}

Provide strategic adaptations as JSON:
{
  "changes": ["change1", "change2"],
  "newPhases": [
    {
      "name": "Phase name",
      "objectives": ["obj1", "obj2"],
      "estimatedDuration": milliseconds,
      "resourceAllocation": {
        "swarmSize": number,
        "maxParallelCommands": number
      },
      "successCriteria": ["criteria1"],
      "dependencies": []
    }
  ],
  "resourceReallocation": {
    "from": "phase name",
    "to": "phase name",
    "amount": percentage
  },
  "expectedImprovement": "What this adaptation will achieve"
}`;

      // Use Bedrock Claude Opus for strategic adaptation decisions
      const response = await llmEngine.complete(adaptationPrompt, undefined, 'bedrock');

      let adaptationData;
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          adaptationData = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON in response');
        }
      } catch (parseError) {
        logger.error({ parseError }, 'Failed to parse adaptation response');
        // Fallback adaptation
        adaptationData = {
          changes: ['Increase focus on discovered vulnerabilities'],
          newPhases: [],
          expectedImprovement: 'Better resource utilization',
        };
      }

      const adaptation: StrategyAdaptation = {
        reason,
        changes: adaptationData.changes || [],
        newPhases: adaptationData.newPhases || [],
        resourceReallocation: adaptationData.resourceReallocation,
        expectedImprovement: adaptationData.expectedImprovement || 'Improved efficiency',
      };

      // Apply adaptations to plan
      if (adaptation.newPhases && adaptation.newPhases.length > 0) {
        plan.phases.push(...adaptation.newPhases);
        plan.updatedAt = new Date();
      }

      // Update state
      await sharedMemory.setContext(swarmId, 'strategy_adaptation', adaptation);

      logger.info(
        { programId, swarmId, changes: adaptation.changes.length },
        'Strategy adapted'
      );

      return adaptation;
    } catch (error: any) {
      logger.error({ error, programId, swarmId }, 'Failed to adapt strategy');
      throw error;
    }
  }

  /**
   * Mark objective as completed
   */
  async completeObjective(programId: string, objective: string): Promise<void> {
    const state = this.plannerState.get(programId);
    if (state) {
      state.completedObjectives.push(objective);
      logger.debug({ programId, objective }, 'Objective completed');
    }
  }

  /**
   * Move to next phase
   */
  async advancePhase(programId: string, nextPhase: string): Promise<void> {
    const state = this.plannerState.get(programId);
    const plan = this.activePlans.get(programId);

    if (state && plan) {
      const phase = plan.phases.find(p => p.name === nextPhase);
      if (phase) {
        state.currentPhase = nextPhase;
        state.currentObjective = phase.objectives[0] || '';
        logger.info({ programId, nextPhase }, 'Advanced to next phase');
      }
    }
  }

  /**
   * Get current plan
   */
  getPlan(programId: string): TestingPlan | undefined {
    return this.activePlans.get(programId);
  }

  /**
   * Get current state
   */
  getState(programId: string): PlannerState | undefined {
    return this.plannerState.get(programId);
  }

  /**
   * Clean up completed session
   */
  async cleanup(programId: string): Promise<void> {
    this.activePlans.delete(programId);
    this.plannerState.delete(programId);
    logger.info({ programId }, 'Planner cleanup completed');
  }
}

// Singleton instance
export const plannerAgent = new PlannerAgent();
export default plannerAgent;
