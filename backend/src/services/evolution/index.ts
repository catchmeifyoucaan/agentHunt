/**
 * Evolution System - Main Export
 *
 * GeniusSwarms Phase 4: Evolution
 *
 * This module implements advanced autonomous capabilities:
 * - Tool Auto-Generation: Agents create custom security tools on-the-fly
 * - Auto-Debugging: Agents debug themselves and fix errors autonomously
 * - Causal Learning (AIRIS-style): Learn cause-effect relationships
 * - Self-Analysis & Auto-Pivoting: Continuous performance optimization
 *
 * Features:
 * - LLM-powered code generation with testing
 * - Automatic error fix attempts with pattern learning
 * - Symbolic representation of causality
 * - Real-time performance monitoring
 * - Automatic strategy adaptation
 */

// Tool Generation
export { toolGenerator, ToolGenerator } from './tool-generator';
export type { ToolRequirement, GeneratedTool, TestResult } from './tool-generator';

// Auto-Debugging
export { autoDebugger, AutoDebugger } from './auto-debugger';
export type { DebugRequest, DebugResult, DebugAttempt, DebugPattern } from './auto-debugger';

// Causal Learning
export { causalLearner, CausalLearner } from './causal-learner';
export type { CausalObservation, CausalRule, CausalPrediction } from './causal-learner';

// Self-Analysis
export { selfAnalyzer, SelfAnalyzer } from './self-analyzer';
export type {
  PerformanceMetrics,
  PerformanceAnalysis,
  PivotStrategy,
  PivotResult,
} from './self-analyzer';

/**
 * Quick Start Example - Tool Auto-Generation:
 *
 * ```typescript
 * import { toolGenerator } from './services/evolution';
 *
 * const tool = await toolGenerator.generateTool({
 *   purpose: 'Extract subdomains from SSL certificates',
 *   language: 'python',
 *   inputs: [
 *     { name: 'domain', type: 'string', description: 'Target domain' }
 *   ],
 *   outputs: [
 *     { name: 'subdomains', type: 'list', description: 'Found subdomains' }
 *   ],
 *   requirements: ['Use requests library', 'Handle SSL errors'],
 *   testCases: [
 *     {
 *       input: { domain: 'example.com' },
 *       expectedOutput: { subdomains: ['www.example.com', 'api.example.com'] }
 *     }
 *   ]
 * });
 *
 * console.log(`Tool generated: ${tool.name}`);
 * console.log(`Success rate: ${(tool.successRate * 100).toFixed(1)}%`);
 * ```
 *
 * Quick Start Example - Auto-Debugging:
 *
 * ```typescript
 * import { autoDebugger } from './services/evolution';
 *
 * const result = await autoDebugger.debugCode({
 *   code: 'def parse_json(data):\n    return json.loads(data)',
 *   language: 'python',
 *   error: 'NameError: name "json" is not defined',
 *   context: {
 *     inputs: { data: '{"key": "value"}' },
 *     expectedOutput: { key: 'value' }
 *   }
 * });
 *
 * if (result.success) {
 *   console.log('Fixed code:', result.fixedCode);
 *   console.log('Attempts:', result.attempts.length);
 * }
 * ```
 *
 * Quick Start Example - Causal Learning:
 *
 * ```typescript
 * import { causalLearner } from './services/evolution';
 *
 * // Learn from observation
 * await causalLearner.learnFromObservation({
 *   action: 'sql_injection_test',
 *   context: {
 *     hasWAF: false,
 *     inputValidation: false,
 *     parameterized: false
 *   },
 *   outcome: {
 *     success: true,
 *     result: { vulnerability: 'SQL Injection' },
 *     metrics: { confidence: 0.95 }
 *   },
 *   timestamp: new Date()
 * });
 *
 * // Predict outcome
 * const prediction = await causalLearner.predictOutcome(
 *   'sql_injection_test',
 *   { hasWAF: true, inputValidation: true }
 * );
 *
 * console.log('Predicted outcome:', prediction.predictedOutcome);
 * console.log('Confidence:', prediction.confidence);
 * ```
 *
 * Quick Start Example - Self-Analysis:
 *
 * ```typescript
 * import { selfAnalyzer } from './services/evolution';
 *
 * const analysis = await selfAnalyzer.analyzePerformance({
 *   agentId: 'agent-123',
 *   sessionId: 'session-456',
 *   timeElapsed: 300000,
 *   tasksCompleted: 25,
 *   tasksFailed: 5,
 *   findingsGenerated: 12,
 *   successRate: 0.8,
 *   efficiency: 2.4,
 *   resourceUsage: {
 *     llmCalls: 50,
 *     sandboxExecutions: 30,
 *     databaseQueries: 40
 *   },
 *   errors: [],
 *   timestamp: new Date()
 * });
 *
 * console.log('Overall score:', analysis.overallScore);
 * console.log('Bottlenecks:', analysis.bottlenecks.length);
 *
 * if (analysis.pivotRecommended && analysis.pivotStrategy) {
 *   console.log('Pivot recommended:', analysis.pivotStrategy.reason);
 *   console.log('Expected improvements:', analysis.pivotStrategy.expectedImpact);
 * }
 * ```
 */
