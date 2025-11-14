/**
 * Three-Agent Architecture - Example Usage
 *
 * This example demonstrates an end-to-end penetration test using
 * the Three-Agent Architecture:
 * - Planner: Creates strategic testing plan
 * - Executor: Deploys swarms for parallel execution
 * - Researcher: Validates findings with multi-reviewer system
 */

import { orchestrator } from './orchestrator';
import { Target } from './types';
import logger from '../../utils/logger';

/**
 * Example 1: Comprehensive Web Application Pentest
 *
 * This example shows how to conduct a full penetration test
 * on a web application with 200 parallel agents
 */
export async function exampleComprehensivePentest() {
  logger.info('Starting comprehensive pentest example');

  // Define testing scope
  const scope = {
    targets: [
      {
        id: 'target-1',
        type: 'domain' as const,
        value: 'example.com',
        priority: 'critical' as const,
        metadata: {
          technologies: ['Node.js', 'React', 'PostgreSQL'],
          endpoints: ['api.example.com', 'admin.example.com'],
        },
      },
      {
        id: 'target-2',
        type: 'subdomain' as const,
        value: 'api.example.com',
        priority: 'high' as const,
        metadata: {
          apiVersion: 'v2',
          authentication: 'OAuth2',
        },
      },
      {
        id: 'target-3',
        type: 'url' as const,
        value: 'https://example.com/admin',
        priority: 'critical' as const,
        metadata: {
          requiresAuth: true,
        },
      },
    ],
    constraints: {
      noDoS: true,
      rateLimit: 100, // requests per second
      testingWindow: {
        start: '09:00',
        end: '17:00',
      },
    },
    assetTypes: ['web_application', 'api', 'admin_panel'],
    vulnerabilityFocus: [
      'OWASP Top 10',
      'Authentication bypass',
      'Authorization issues',
      'SQL injection',
      'XSS',
      'API security',
    ],
  };

  // Configure session options
  const options = {
    maxSwarms: 10, // Deploy up to 10 swarms in parallel
    maxAgents: 200, // Total 200 agents across all swarms
    maxDuration: 3600000, // 1 hour testing session
    autoValidate: true, // Automatically validate findings
    generateChains: true, // Discover attack chains
  };

  try {
    // Start three-agent session
    const session = await orchestrator.startSession(
      'program-123', // Bug bounty program ID
      scope,
      options
    );

    logger.info({ sessionId: session.id }, 'Session started');

    // ===================================
    // Session automatically executes:
    // ===================================

    // 1. PLANNER creates strategic testing plan
    //    - Analyzes scope and creates phases
    //    - Estimates duration and resource needs
    //    - Identifies critical path

    // 2. EXECUTOR deploys swarms for each phase
    //    Phase 1: Reconnaissance (30 agents)
    //      - Subdomain enumeration
    //      - Technology identification
    //      - Endpoint discovery
    //      - Attack surface mapping
    //
    //    Phase 2: Vulnerability Discovery (50 agents)
    //      - Injection testing (SQLi, XSS, etc.)
    //      - Authentication/authorization testing
    //      - API security testing
    //      - Configuration issues
    //
    //    Phase 3: Deep Exploitation (30 agents)
    //      - Vulnerability chaining
    //      - Privilege escalation
    //      - PoC development
    //      - Impact validation

    // 3. RESEARCHER validates all findings
    //    - 5 specialized reviewers per finding:
    //      * Technical accuracy
    //      * Exploitability assessment
    //      * Impact analysis
    //      * False positive detection
    //      * Business risk evaluation
    //    - Generates PoCs for validated vulnerabilities
    //    - Discovers attack chains
    //    - Updates knowledge base

    // ===================================
    // Get results
    // ===================================

    logger.info({
      state: session.state,
      findings: session.researcherQueue.length,
      validated: session.validatedFindings.filter(v => v.valid).length,
      chains: session.attackChains.length,
    }, 'Session completed');

    // Get detailed metrics
    const metrics = await orchestrator.getSessionMetrics(session.id);
    if (metrics) {
      logger.info({
        duration: `${Math.round(metrics.duration / 1000 / 60)} minutes`,
        totalFindings: metrics.totalFindings,
        validFindings: metrics.validatedFindings,
        falsePositives: metrics.falsePositives,
        attackChains: metrics.attackChains,
        efficiency: {
          findingsPerMinute: metrics.efficiency.findingsPerMinute.toFixed(2),
          findingsPerAgent: metrics.efficiency.findingsPerAgent.toFixed(2),
          validationAccuracy: `${(metrics.efficiency.validationAccuracy * 100).toFixed(1)}%`,
        },
      }, 'Session metrics');
    }

    // ===================================
    // Access validated findings
    // ===================================

    const criticalFindings = session.validatedFindings.filter(
      v => v.valid && (v.severity === 'critical' || v.adjustedSeverity === 'critical')
    );

    logger.info({ critical: criticalFindings.length }, 'Critical findings discovered');

    for (const validation of criticalFindings) {
      const finding = session.researcherQueue.find(f => f.id === validation.findingId);
      if (finding) {
        logger.info({
          type: finding.type,
          url: finding.url,
          confidence: validation.confidence.toFixed(2),
          exploitability: validation.exploitability.toFixed(2),
          hasPoc: !!validation.poc,
        }, 'Critical finding');
      }
    }

    // ===================================
    // Access attack chains
    // ===================================

    for (const chain of session.attackChains) {
      logger.info({
        name: chain.name,
        severity: chain.combinedSeverity,
        steps: chain.steps.length,
        impact: chain.combinedImpact,
      }, 'Attack chain discovered');
    }

    return session;
  } catch (error) {
    logger.error({ error }, 'Comprehensive pentest failed');
    throw error;
  }
}

/**
 * Example 2: Focused API Security Test
 *
 * This example shows a focused test on API endpoints
 * with smaller swarm size
 */
export async function exampleFocusedApiTest() {
  logger.info('Starting focused API test example');

  const scope = {
    targets: [
      {
        id: 'api-1',
        type: 'url' as const,
        value: 'https://api.example.com/v2/users',
        priority: 'high' as const,
      },
      {
        id: 'api-2',
        type: 'url' as const,
        value: 'https://api.example.com/v2/payments',
        priority: 'critical' as const,
      },
    ],
    constraints: {
      noDoS: true,
      rateLimit: 50,
    },
    vulnerabilityFocus: [
      'Authentication bypass',
      'Authorization issues',
      'Mass assignment',
      'Rate limiting',
      'Input validation',
    ],
  };

  const options = {
    maxSwarms: 3,
    maxAgents: 50,
    maxDuration: 1800000, // 30 minutes
    autoValidate: true,
    generateChains: true,
  };

  const session = await orchestrator.startSession('program-api-test', scope, options);

  logger.info({
    findings: session.researcherQueue.length,
    validated: session.validatedFindings.filter(v => v.valid).length,
  }, 'API test completed');

  return session;
}

/**
 * Example 3: Monitor Session Progress in Real-time
 *
 * This example shows how to monitor an ongoing session
 */
export async function exampleMonitorSession(sessionId: string) {
  logger.info({ sessionId }, 'Monitoring session');

  // Poll session status
  const interval = setInterval(async () => {
    const session = await orchestrator.getSessionStatus(sessionId);

    if (!session) {
      clearInterval(interval);
      logger.warn({ sessionId }, 'Session not found');
      return;
    }

    logger.info({
      sessionId,
      state: session.state,
      currentPhase: session.plannerState.currentPhase,
      findings: session.plannerState.findingsCount,
      criticalFindings: session.plannerState.criticalFindingsCount,
      elapsedTime: `${Math.round(session.plannerState.elapsedTime / 1000 / 60)} minutes`,
      swarmsDeployed: session.executorSwarms.length,
    }, 'Session status');

    // Stop monitoring when completed
    if (session.state === 'completed' || session.state === 'failed') {
      clearInterval(interval);
      logger.info({ sessionId, finalState: session.state }, 'Session finished');
    }
  }, 10000); // Check every 10 seconds
}

/**
 * Example 4: Custom Testing Phase
 *
 * This example shows how to use individual agents
 * for custom workflows
 */
export async function exampleCustomWorkflow() {
  logger.info('Starting custom workflow example');

  const { plannerAgent } = require('./planner-agent');
  const { executorAgent } = require('./executor-agent');
  const { researcherAgent } = require('./researcher-agent');

  // 1. Create custom testing strategy
  const plan = await plannerAgent.createTestingStrategy(
    'custom-program',
    {
      targets: [
        {
          id: 't1',
          type: 'domain' as const,
          value: 'custom.example.com',
          priority: 'high' as const,
        },
      ],
    },
    {
      maxSwarms: 5,
      maxAgents: 100,
      maxDuration: 1800000,
    }
  );

  logger.info({ phases: plan.phases.length }, 'Custom plan created');

  // 2. Execute specific objective
  const objective = {
    id: 'obj-1',
    type: 'vulnerability_scan' as const,
    target: {
      id: 't1',
      type: 'domain' as const,
      value: 'custom.example.com',
      priority: 'high' as const,
    },
    description: 'Scan for XSS vulnerabilities',
    priority: 8,
  };

  const result = await executorAgent.executeObjective(objective, {
    swarmSize: 20,
    specialization: 'xss',
    autonomyLevel: 'high',
  });

  logger.info({ findings: result.findings.length }, 'Objective executed');

  // 3. Validate findings individually
  for (const finding of result.findings) {
    const validation = await researcherAgent.validateFinding(finding);

    logger.info({
      findingId: finding.id,
      valid: validation.valid,
      confidence: validation.confidence.toFixed(2),
    }, 'Finding validated');
  }

  // 4. Discover attack chains
  if (result.findings.length >= 2) {
    const chains = await researcherAgent.discoverAttackChains(result.findings);
    logger.info({ chains: chains.length }, 'Attack chains discovered');
  }
}

/**
 * Run all examples (for testing)
 */
export async function runAllExamples() {
  try {
    logger.info('Running all Three-Agent examples');

    // Example 1: Comprehensive pentest (commented out to avoid long execution)
    // await exampleComprehensivePentest();

    // Example 2: Focused API test (commented out)
    // await exampleFocusedApiTest();

    // Example 4: Custom workflow
    await exampleCustomWorkflow();

    logger.info('All examples completed successfully');
  } catch (error) {
    logger.error({ error }, 'Examples failed');
    throw error;
  }
}

// Export for use in other modules
export default {
  exampleComprehensivePentest,
  exampleFocusedApiTest,
  exampleMonitorSession,
  exampleCustomWorkflow,
  runAllExamples,
};
