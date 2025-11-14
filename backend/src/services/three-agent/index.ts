/**
 * Three-Agent Architecture - Main Export
 *
 * GeniusSwarms Phase 3: Autonomy
 *
 * This module implements the Three-Agent Architecture:
 * - Planner Agent: Strategic planning and adaptive strategy
 * - Executor Agent: Tactical execution with swarm orchestration
 * - Researcher Agent: Validation with multi-reviewer system
 *
 * Features:
 * - 20-200 parallel agents per swarm
 * - Redis-based shared memory coordination
 * - Real-time pub/sub updates
 * - Atomic target claiming
 * - Multi-reviewer validation (5 specialized reviewers)
 * - Attack chain discovery
 * - PoC generation and verification
 * - Dynamic strategy adaptation
 * - Knowledge base updates
 */

// Core agents
export { plannerAgent, PlannerAgent } from './planner-agent';
export { executorAgent, ExecutorAgent } from './executor-agent';
export { researcherAgent, ResearcherAgent } from './researcher-agent';

// Shared memory and coordination
export { sharedMemory } from './shared-memory';
export { orchestrator, ThreeAgentOrchestrator } from './orchestrator';

// Types
export * from './types';

// Examples
export * as examples from './example';

/**
 * Quick Start Example:
 *
 * ```typescript
 * import { orchestrator } from './services/three-agent';
 *
 * const session = await orchestrator.startSession(
 *   'program-id',
 *   {
 *     targets: [
 *       { id: 't1', type: 'domain', value: 'example.com', priority: 'critical' }
 *     ],
 *     constraints: { noDoS: true, rateLimit: 100 }
 *   },
 *   {
 *     maxSwarms: 10,
 *     maxAgents: 200,
 *     maxDuration: 3600000,
 *     autoValidate: true,
 *     generateChains: true
 *   }
 * );
 *
 * console.log(`Findings: ${session.researcherQueue.length}`);
 * console.log(`Validated: ${session.validatedFindings.filter(v => v.valid).length}`);
 * console.log(`Attack Chains: ${session.attackChains.length}`);
 * ```
 */
