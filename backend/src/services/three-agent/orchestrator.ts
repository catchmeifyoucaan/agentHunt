/**
 * Three-Agent Orchestrator
 * Coordinates Planner, Executor, and Researcher agents
 * Manages complete penetration testing lifecycle
 */

import logger from '../../utils/logger';
import { plannerAgent } from './planner-agent';
import { executorAgent } from './executor-agent';
import { researcherAgent } from './researcher-agent';
import { sharedMemory } from './shared-memory';
import database from '../database';
import {
  ThreeAgentSession,
  TestingPlan,
  Objective,
  Finding,
  ValidationResult,
  AttackChain,
  SessionMetrics,
  Target,
} from './types';
import { v4 as uuidv4 } from 'uuid';

export class ThreeAgentOrchestrator {
  private activeSessions: Map<string, ThreeAgentSession> = new Map();

  /**
   * Start comprehensive penetration testing session
   * Orchestrates all three agents for end-to-end testing
   */
  async startSession(
    programId: string,
    scope: {
      targets: Target[];
      constraints?: any;
      assetTypes?: string[];
      vulnerabilityFocus?: string[];
    },
    options: {
      maxSwarms?: number;
      maxAgents?: number;
      maxDuration?: number; // milliseconds
      autoValidate?: boolean;
      generateChains?: boolean;
    } = {}
  ): Promise<ThreeAgentSession> {
    if (!scope.targets || scope.targets.length === 0) {
      throw new Error('Three-Agent session requires at least one target in the scope.');
    }

    try {
      // Create session
      const session: ThreeAgentSession = {
        id: uuidv4(),
        programId,
        plan: {} as TestingPlan, // Will be created by Planner
        state: 'planning',
        plannerState: {
          currentPhase: '',
          currentObjective: '',
          completedObjectives: [],
          findingsCount: 0,
          criticalFindingsCount: 0,
          elapsedTime: 0,
          estimatedRemainingTime: 0,
        },
        executorSwarms: [],
        researcherQueue: [],
        validatedFindings: [],
        attackChains: [],
        startedAt: new Date(),
      };

      this.activeSessions.set(session.id, session);

      // Save session to database
      await this.saveSession(session);

      // ===================================
      // PHASE 1: PLANNER - Create Strategy
      // ===================================
      logger.info({ sessionId: session.id }, 'Phase 1: Creating testing strategy');

      const resourceBudget = {
        maxSwarms: options.maxSwarms || 10,
        maxAgents: options.maxAgents || 200,
        maxDuration: options.maxDuration || 3600000, // 1 hour default
      };

      const plan = await plannerAgent.createTestingStrategy(
        programId,
        scope,
        resourceBudget
      );

      session.plan = plan;
      session.state = 'executing';
      await this.saveSession(session);

      // ===================================
      // PHASE 2: EXECUTOR - Execute Plan
      // ===================================
      logger.info({ sessionId: session.id, phases: plan.phases.length }, 'Phase 2: Executing testing plan');

      const sessionStartTime = Date.now();

      // Execute phases sequentially (respecting dependencies)
      for (const phase of plan.phases) {
        logger.info({ sessionId: session.id, phase: phase.name }, `Executing phase: ${phase.name}`);

        // Update planner state
        await plannerAgent.advancePhase(programId, phase.name);

        // Convert phase objectives to execution objectives
        const objectives = this.createObjectivesFromPhase(phase, scope.targets, programId);

        // Execute objectives in parallel (up to maxSwarms at once)
        const batchSize = Math.min(objectives.length, resourceBudget.maxSwarms);
        for (let i = 0; i < objectives.length; i += batchSize) {
          const batch = objectives.slice(i, i + batchSize);

          const executionPromises = batch.map(objective =>
            executorAgent.executeObjective(objective, {
              swarmSize: phase.resourceAllocation.swarmSize,
              autonomyLevel: 'medium',
              sharedMemoryEnabled: true,
            })
          );

          const results = await Promise.allSettled(executionPromises);

          // Collect findings from successful executions
          results.forEach((result, idx) => {
            if (result.status === 'fulfilled') {
              const executionResult = result.value;
              session.researcherQueue.push(...executionResult.findings);

              // Track swarm config
              const objective = batch[idx];
              session.executorSwarms.push({
                id: uuidv4(),
                objectiveId: objective.id,
                swarmSize: phase.resourceAllocation.swarmSize,
                specialization: executorAgent['inferSpecialization'](objective),
                sharedMemoryEnabled: true,
                autonomyLevel: 'medium',
                coordinationStrategy: 'collaborative',
              });
            }
          });

          // Monitor progress
          const elapsedTime = Date.now() - sessionStartTime;
          const swarmId = session.executorSwarms[session.executorSwarms.length - 1]?.id;

          if (swarmId) {
            const progress = await plannerAgent.monitorProgress(
              programId,
              swarmId,
              elapsedTime
            );

            // Update session state
            session.plannerState.findingsCount = session.researcherQueue.length;
            session.plannerState.criticalFindingsCount = session.researcherQueue.filter(
              f => f.severity === 'critical' || f.severity === 'high'
            ).length;
            session.plannerState.elapsedTime = elapsedTime;

            await this.saveSession(session);

            // Adapt strategy if needed
            if (progress.shouldAdapt && progress.adaptationReason) {
              logger.info(
                { sessionId: session.id, reason: progress.adaptationReason },
                'Adapting strategy'
              );

              await plannerAgent.adaptStrategy(
                programId,
                swarmId,
                progress.adaptationReason,
                session.researcherQueue
              );
            }
          }
        }

        // Mark phase objectives as complete
        for (const objective of phase.objectives) {
          await plannerAgent.completeObjective(programId, objective);
        }
      }

      // ===================================
      // PHASE 3: RESEARCHER - Validate
      // ===================================
      if (options.autoValidate !== false) {
        logger.info(
          { sessionId: session.id, findings: session.researcherQueue.length },
          'Phase 3: Validating findings'
        );

        session.state = 'validating';
        await this.saveSession(session);

        // Validate all findings in parallel (batched)
        const validationBatchSize = 10;
        for (let i = 0; i < session.researcherQueue.length; i += validationBatchSize) {
          const batch = session.researcherQueue.slice(i, i + validationBatchSize);

          const validationPromises = batch.map(finding =>
            researcherAgent.validateFinding(finding)
          );

          const validations = await Promise.allSettled(validationPromises);

          validations.forEach(result => {
            if (result.status === 'fulfilled') {
              session.validatedFindings.push(result.value);
            }
          });

          await this.saveSession(session);
        }

        // Discover attack chains
        if (options.generateChains !== false) {
          logger.info({ sessionId: session.id }, 'Discovering attack chains');

          const validFindings = session.researcherQueue.filter(f => {
            const validation = session.validatedFindings.find(v => v.findingId === f.id);
            return validation?.valid === true;
          });

          if (validFindings.length >= 2) {
            const chains = await researcherAgent.discoverAttackChains(validFindings);
            session.attackChains = chains;
          }
        }

        // Update knowledge base
        await researcherAgent.updateKnowledgeBase(
          session.researcherQueue,
          session.validatedFindings
        );
      }

      // ===================================
      // COMPLETE SESSION
      // ===================================
      session.state = 'completed';
      session.completedAt = new Date();
      await this.saveSession(session);

      // Cleanup
      await plannerAgent.cleanup(programId);
      await sharedMemory.clearSwarm(session.id);

      logger.info(
        {
          sessionId: session.id,
          duration: Math.round((Date.now() - sessionStartTime) / 1000),
          findings: session.researcherQueue.length,
          validated: session.validatedFindings.filter(v => v.valid).length,
          chains: session.attackChains.length,
        },
        'Three-Agent session completed'
      );

      return session;
    } catch (error: any) {
      logger.error({ error, programId }, 'Session failed');

      // Update session state
      const session = this.activeSessions.get(programId);
      if (session) {
        session.state = 'failed';
        session.completedAt = new Date();
        await this.saveSession(session);
      }

      throw error;
    }
  }

  /**
   * Create execution objectives from testing phase
   */
  private createObjectivesFromPhase(
    phase: any,
    targets: Target[],
    programId: string
  ): Objective[] {
    const objectives: Objective[] = [];

    for (const objectiveDesc of phase.objectives) {
      // Determine objective type from description
      let type: Objective['type'] = 'vulnerability_scan';
      if (objectiveDesc.toLowerCase().includes('reconnaissance')) {
        type = 'reconnaissance';
      } else if (objectiveDesc.toLowerCase().includes('enumerate')) {
        type = 'enumeration';
      } else if (objectiveDesc.toLowerCase().includes('exploit')) {
        type = 'exploitation';
      } else if (objectiveDesc.toLowerCase().includes('validate')) {
        type = 'validation';
      }

      // Create objectives for each target
      for (const target of targets) {
        objectives.push({
          id: uuidv4(),
          type,
          target,
          description: objectiveDesc,
          parameters: {
            programId: programId  // Pass the programId to the executor
          },
          priority: target.priority === 'critical' ? 10 : target.priority === 'high' ? 7 : 5,
          timeout: phase.estimatedDuration,
        });
      }
    }

    return objectives;
  }

  /**
   * Get session status
   */
  async getSessionStatus(sessionId: string): Promise<ThreeAgentSession | null> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      return session;
    }

    // Try to load from database
    try {
      const result = await database.query(
        'SELECT * FROM three_agent_sessions WHERE id = $1',
        [sessionId]
      );

      if (result.rows.length > 0) {
        return result.rows[0].session_data as ThreeAgentSession;
      }
    } catch (error) {
      logger.error({ error, sessionId }, 'Failed to load session from database');
    }

    return null;
  }

  /**
   * Get session metrics
   */
  async getSessionMetrics(sessionId: string): Promise<SessionMetrics | null> {
    const session = await this.getSessionStatus(sessionId);
    if (!session || !session.completedAt) {
      return null;
    }

    const duration = session.completedAt.getTime() - session.startedAt.getTime();
    const totalFindings = session.researcherQueue.length;
    const validatedFindings = session.validatedFindings.filter(v => v.valid).length;
    const falsePositives = session.validatedFindings.filter(v => !v.valid).length;
    const agentsUsed = session.executorSwarms.reduce(
      (sum, swarm) => sum + swarm.swarmSize,
      0
    );

    return {
      duration,
      totalFindings,
      validatedFindings,
      falsePositives,
      attackChains: session.attackChains.length,
      swarmsDeployed: session.executorSwarms.length,
      agentsUsed,
      efficiency: {
        findingsPerMinute: (totalFindings / duration) * 60000,
        findingsPerAgent: agentsUsed > 0 ? totalFindings / agentsUsed : 0,
        validationAccuracy:
          totalFindings > 0 ? validatedFindings / totalFindings : 0,
      },
    };
  }

  /**
   * Save session to database
   */
  private async saveSession(session: ThreeAgentSession): Promise<void> {
    try {
      // Create table if not exists
      await database.query(`
        CREATE TABLE IF NOT EXISTS three_agent_sessions (
          id UUID PRIMARY KEY,
          program_id UUID NOT NULL,
          state TEXT NOT NULL,
          session_data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Upsert session
      await database.query(
        `INSERT INTO three_agent_sessions (id, program_id, state, session_data, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (id)
         DO UPDATE SET state = $3, session_data = $4, updated_at = CURRENT_TIMESTAMP`,
        [session.id, session.programId, session.state, JSON.stringify(session)]
      );
    } catch (error: any) {
      logger.error({ error, sessionId: session.id }, 'Failed to save session');
    }
  }

  /**
   * List active sessions
   */
  getActiveSessions(): ThreeAgentSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Cancel session
   */
  async cancelSession(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.state = 'failed';
      session.completedAt = new Date();
      await this.saveSession(session);
      this.activeSessions.delete(sessionId);

      logger.info({ sessionId }, 'Session cancelled');
    }
  }
}

// Singleton instance
export const orchestrator = new ThreeAgentOrchestrator();
export default orchestrator;
