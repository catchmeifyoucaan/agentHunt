/**
 * Executor Agent - Tactical Layer
 * Deploys swarms of sub-agents for parallel execution
 * Coordinates through shared memory
 * Generates custom tools when needed
 */

import logger from '../../utils/logger';
import llmEngine from '../llm/llm-engine';
import { sharedMemory } from './shared-memory';
import sandboxExecutor from '../sandbox/sandbox-executor';
import queue from '../queue';
import { AgentType } from '../../../../shared/types';
import {
  Objective,
  SwarmConfig,
  SubAgent,
  SwarmResult,
  ExecutionResult,
  ToolRequirement,
  Tool,
  Finding,
  Target,
  Technique,
} from './types';
import { v4 as uuidv4 } from 'uuid';

export class ExecutorAgent {
  private activeSwarms: Map<string, SwarmConfig> = new Map();
  private subAgents: Map<string, SubAgent> = new Map();
  private generatedTools: Map<string, Tool> = new Map();

  /**
   * Execute objective by deploying swarm
   * Main entry point for tactical execution
   */
  async executeObjective(
    objective: Objective,
    swarmConfig: Partial<SwarmConfig> = {}
  ): Promise<ExecutionResult> {
    logger.info({ objectiveId: objective.id, type: objective.type }, 'Executing objective');

    const startTime = Date.now();

    try {
      // Create swarm configuration
      const config: SwarmConfig = {
        id: swarmConfig.id || uuidv4(),
        objectiveId: objective.id,
        swarmSize: swarmConfig.swarmSize || this.calculateOptimalSwarmSize(objective),
        specialization: swarmConfig.specialization || this.inferSpecialization(objective),
        sharedMemoryEnabled: swarmConfig.sharedMemoryEnabled ?? true,
        autonomyLevel: swarmConfig.autonomyLevel || 'medium',
        maxDuration: swarmConfig.maxDuration || objective.timeout || 300000, // 5 min default
        coordinationStrategy: swarmConfig.coordinationStrategy || 'collaborative',
      };

      this.activeSwarms.set(config.id, config);

      // Deploy swarm
      const swarmResult = await this.deploySwarm(config, objective);

      // Aggregate results
      const executionResult: ExecutionResult = {
        objectiveId: objective.id,
        success: swarmResult.completedAgents > 0,
        findings: swarmResult.findings,
        techniques: swarmResult.successfulTechniques,
        duration: Date.now() - startTime,
        resourcesUsed: {
          swarms: 1,
          agents: swarmResult.totalAgents,
          commands: swarmResult.findings.length, // Approximate
        },
        metadata: {
          efficiency: swarmResult.efficiency,
          failedAgents: swarmResult.failedAgents,
        },
      };

      logger.info(
        {
          objectiveId: objective.id,
          findings: executionResult.findings.length,
          duration: Math.round(executionResult.duration / 1000),
        },
        'Objective execution completed'
      );

      return executionResult;
    } catch (error: any) {
      logger.error({ error, objectiveId: objective.id }, 'Failed to execute objective');

      return {
        objectiveId: objective.id,
        success: false,
        findings: [],
        techniques: [],
        duration: Date.now() - startTime,
        resourcesUsed: { swarms: 0, agents: 0, commands: 0 },
        metadata: { error: error.message },
      };
    } finally {
      // Cleanup
      if (swarmConfig.id) {
        this.activeSwarms.delete(swarmConfig.id);
      }
    }
  }

  /**
   * Deploy swarm of REAL TOOL AGENTS (not LLM sub-agents)
   * Coordinates parallel execution through shared memory
   * This bridges three-agent orchestration to actual security tools
   */
  private async deploySwarm(config: SwarmConfig, objective: Objective): Promise<SwarmResult> {
    logger.info(
      { swarmId: config.id, size: config.swarmSize, specialization: config.specialization },
      'Deploying tool agent swarm'
    );

    const startTime = Date.now();

    // Map specialization to real agent type
    const agentType = this.mapSpecializationToAgentType(config.specialization);

    if (!agentType) {
      logger.warn(
        { specialization: config.specialization },
        'No agent mapping found, falling back to LLM agents'
      );
      return await this.deployLLMSwarm(config, objective); // Fallback to original implementation
    }

    // Distribute targets among agents
    const targetChunks = this.distributeTargets([objective.target], config.swarmSize);

    // Dispatch REAL tool agent jobs
    const jobPromises: Promise<any>[] = [];
    const jobIds: string[] = [];

    for (let i = 0; i < config.swarmSize; i++) {
      if (!targetChunks[i] || targetChunks[i].length === 0) continue;

      const target = targetChunks[i][0]; // Each agent gets one target
      const jobId = `${config.id}-job-${i}`;

      // Create job data for tool agent
      const jobData = {
        id: jobId,
        programId: objective.parameters?.programId || 'three-agent-session',
        target: target.value,
        type: target.type,
        priority: objective.priority || 5,

        // Three-agent integration flags
        swarmId: config.id,
        enableSharedMemory: config.sharedMemoryEnabled,
        swarmContext: {
          objectiveId: objective.id,
          specialization: config.specialization,
          autonomyLevel: config.autonomyLevel,
        },
      };

      try {
        const job = await queue.addJob(agentType, jobData as any, {
          priority: objective.priority || 5,
          jobId,
        });

        jobIds.push(jobId);
        jobPromises.push((job as any).waitUntilFinished((queue as any).getQueueEvents(agentType)));

        logger.debug({ agentType, jobId, target: target.value }, 'Tool agent job dispatched');
      } catch (error: any) {
        logger.error({ error, agentType, jobId }, 'Failed to dispatch tool agent job');
      }
    }

    // Subscribe to shared memory updates
    if (config.sharedMemoryEnabled) {
      await this.setupSharedMemoryCoordination(config.id, []);
    }

    // Wait for all jobs to complete (or timeout)
    const timeout = config.maxDuration || objective.timeout || 300000;
    const jobResults = await Promise.race([
      Promise.allSettled(jobPromises),
      new Promise<never[]>((resolve) => setTimeout(() => resolve([]), timeout)),
    ]);

    // Collect findings from shared memory (where tool agents write them)
    const allFindings = config.sharedMemoryEnabled ? await sharedMemory.getFindings(config.id) : [];

    // Get successful techniques shared by agents
    const techniques = config.sharedMemoryEnabled
      ? await sharedMemory.getTechniques(config.id)
      : [];

    // Calculate metrics
    const completedAgents = jobResults.filter((r: any) => r && r.status === 'fulfilled').length;
    const failedAgents = jobResults.filter((r: any) => r && r.status === 'rejected').length;

    const result: SwarmResult = {
      swarmId: config.id,
      objectiveId: objective.id,
      totalAgents: jobIds.length,
      completedAgents,
      failedAgents,
      findings: allFindings,
      successfulTechniques: techniques,
      duration: Date.now() - startTime,
      efficiency: completedAgents > 0 ? allFindings.length / completedAgents : 0,
    };

    logger.info(
      {
        swarmId: config.id,
        agentType,
        jobsDispatched: jobIds.length,
        completed: completedAgents,
        failed: failedAgents,
        findings: allFindings.length,
        techniques: techniques.length,
        efficiency: result.efficiency.toFixed(2),
      },
      'Tool agent swarm deployment completed'
    );

    return result;
  }

  /**
   * Fallback: Deploy LLM-powered sub-agents (original implementation)
   * Used when no tool agent mapping exists
   */
  private async deployLLMSwarm(config: SwarmConfig, objective: Objective): Promise<SwarmResult> {
    logger.info({ swarmId: config.id, size: config.swarmSize }, 'Deploying LLM swarm (fallback)');

    const startTime = Date.now();

    // Distribute targets among agents
    const targetChunks = this.distributeTargets([objective.target], config.swarmSize);

    // Create sub-agents
    const agents: SubAgent[] = [];
    for (let i = 0; i < config.swarmSize; i++) {
      const agent: SubAgent = {
        id: `${config.id}-agent-${i}`,
        swarmId: config.id,
        specialization: config.specialization,
        assignedTargets: targetChunks[i] || [],
        status: 'idle',
        findings: [],
      };
      agents.push(agent);
      this.subAgents.set(agent.id, agent);
    }

    // Subscribe to shared memory updates if enabled
    if (config.sharedMemoryEnabled) {
      await this.setupSharedMemoryCoordination(config.id, agents);
    }

    // Execute agents in parallel
    const agentPromises = agents.map((agent) => this.executeSubAgent(agent, objective, config));

    // Wait for all agents or timeout
    const agentResults = await Promise.allSettled(agentPromises);

    // Collect all findings from shared memory
    const allFindings = config.sharedMemoryEnabled
      ? await sharedMemory.getFindings(config.id)
      : agents.flatMap((a) => a.findings);

    // Get successful techniques
    const techniques = config.sharedMemoryEnabled
      ? await sharedMemory.getTechniques(config.id)
      : [];

    // Calculate metrics
    const completedAgents = agentResults.filter((r) => r.status === 'fulfilled').length;
    const failedAgents = agentResults.filter((r) => r.status === 'rejected').length;

    const result: SwarmResult = {
      swarmId: config.id,
      objectiveId: objective.id,
      totalAgents: config.swarmSize,
      completedAgents,
      failedAgents,
      findings: allFindings,
      successfulTechniques: techniques,
      duration: Date.now() - startTime,
      efficiency: completedAgents > 0 ? allFindings.length / completedAgents : 0,
    };

    // Cleanup shared memory if enabled
    if (config.sharedMemoryEnabled) {
      await this.cleanupSharedMemory(config.id, agents);
    }

    // Cleanup sub-agents
    agents.forEach((a) => this.subAgents.delete(a.id));

    logger.info(
      {
        swarmId: config.id,
        findings: result.findings.length,
        efficiency: result.efficiency.toFixed(2),
      },
      'LLM swarm deployment completed'
    );

    return result;
  }

  /**
   * Execute individual sub-agent
   * Autonomous agent with access to shared memory and tools
   */
  private async executeSubAgent(
    agent: SubAgent,
    objective: Objective,
    config: SwarmConfig
  ): Promise<void> {
    logger.debug(
      { agentId: agent.id, targets: agent.assignedTargets.length },
      'Executing sub-agent'
    );

    agent.status = 'running';
    agent.startedAt = new Date();

    try {
      // Check if targets already claimed by other agents
      if (config.sharedMemoryEnabled) {
        const availableTargets = await sharedMemory.claimTargets(
          config.id,
          agent.id,
          agent.assignedTargets
        );
        agent.assignedTargets = availableTargets;

        if (availableTargets.length === 0) {
          logger.debug({ agentId: agent.id }, 'No unclaimed targets available');
          agent.status = 'completed';
          return;
        }
      }

      // Get context from shared memory
      let sharedContext = {};
      if (config.sharedMemoryEnabled) {
        sharedContext = await sharedMemory.getAllContext(config.id);
      }

      // Build agent prompt based on objective and specialization
      const agentPrompt = this.buildAgentPrompt(agent, objective, config, sharedContext);

      // Execute agent reasoning with LLM (Grok for fast reasoning, fallback to serverless)
      const response = await llmEngine.complete(agentPrompt, undefined, 'grok,serverless');

      // Parse agent response for findings and techniques
      const { findings, techniques } = this.parseAgentResponse(response, agent, objective);

      // Store findings in agent and shared memory
      agent.findings = findings;
      if (config.sharedMemoryEnabled && findings.length > 0) {
        await sharedMemory.storeFindings(config.id, findings);
      }

      // Share successful techniques
      if (config.sharedMemoryEnabled && techniques.length > 0) {
        for (const technique of techniques) {
          await sharedMemory.shareSuccess(config.id, technique);
        }
      }

      // Execute any generated commands if needed
      if (config.autonomyLevel === 'high') {
        await this.executeAgentCommands(agent, config, objective);
      }

      agent.status = 'completed';
      agent.completedAt = new Date();

      logger.debug(
        { agentId: agent.id, findings: findings.length },
        'Sub-agent execution completed'
      );
    } catch (error: any) {
      logger.error({ error, agentId: agent.id }, 'Sub-agent execution failed');
      agent.status = 'failed';
      agent.completedAt = new Date();

      // Record failure in shared memory
      if (config.sharedMemoryEnabled && agent.assignedTargets.length > 0) {
        await sharedMemory.recordFailure(
          config.id,
          agent.assignedTargets[0],
          config.specialization,
          error.message
        );
      }
    } finally {
      // Release claimed targets
      if (config.sharedMemoryEnabled) {
        await sharedMemory.releaseTargets(
          config.id,
          agent.assignedTargets.map((t) => t.id)
        );
      }
    }
  }

  /**
   * Build agent prompt based on context
   */
  private buildAgentPrompt(
    agent: SubAgent,
    objective: Objective,
    config: SwarmConfig,
    sharedContext: Record<string, any>
  ): string {
    const targets = agent.assignedTargets.map((t) => `${t.type}: ${t.value}`).join(', ');

    return `You are an autonomous security testing agent (${agent.id}) specializing in ${config.specialization}.

**Objective:** ${objective.description}
**Type:** ${objective.type}
**Targets:** ${targets}

**Your Role:**
You are part of a swarm of ${config.swarmSize} agents working collaboratively. Your specialization is ${config.specialization}.

**Constraints:**
${JSON.stringify(objective.constraints || {}, null, 2)}

**Shared Context:**
${Object.keys(sharedContext).length > 0 ? JSON.stringify(sharedContext, null, 2) : 'No shared context yet'}

**Your Task:**
1. Analyze the assigned targets for ${config.specialization} vulnerabilities
2. Generate testing strategies and techniques
3. Identify potential findings with evidence
4. Share successful techniques with the swarm

**Output Format:**
Return a JSON object with:
{
  "findings": [
    {
      "type": "vulnerability type",
      "url": "target URL",
      "severity": "info|low|medium|high|critical",
      "evidence": "what you found",
      "confidence": 0.0-1.0,
      "httpRequest": "optional request",
      "httpResponse": "optional response"
    }
  ],
  "techniques": [
    {
      "name": "technique name",
      "description": "what it does",
      "successRate": 0.0-1.0,
      "payload": "optional payload",
      "bypassMethod": "optional bypass description"
    }
  ],
  "reasoning": "Your analysis process"
}

Focus on actionable findings with evidence. Be thorough but avoid false positives.`;
  }

  /**
   * Parse agent LLM response
   */
  private parseAgentResponse(
    response: string,
    agent: SubAgent,
    objective: Objective
  ): { findings: Finding[]; techniques: Technique[] } {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return { findings: [], techniques: [] };
      }

      const data = JSON.parse(jsonMatch[0]);

      const findings: Finding[] = (data.findings || []).map((f: any) => ({
        id: uuidv4(),
        type: f.type,
        severity: f.severity || 'info',
        url: f.url || objective.target.value,
        evidence: f.evidence,
        httpRequest: f.httpRequest,
        httpResponse: f.httpResponse,
        confidence: f.confidence || 0.5,
        timestamp: new Date(),
        discoveredBy: agent.id,
        metadata: f.metadata,
      }));

      const techniques: Technique[] = (data.techniques || []).map((t: any) => ({
        id: uuidv4(),
        name: t.name,
        description: t.description,
        successRate: t.successRate || 0.5,
        payload: t.payload,
        bypassMethod: t.bypassMethod,
        metadata: t.metadata,
      }));

      return { findings, techniques };
    } catch (error: any) {
      logger.error({ error, agentId: agent.id }, 'Failed to parse agent response');
      return { findings: [], techniques: [] };
    }
  }

  /**
   * Execute agent-generated commands in sandbox
   */
  private async executeAgentCommands(
    agent: SubAgent,
    config: SwarmConfig,
    objective: Objective
  ): Promise<void> {
    // In high autonomy mode, agents can generate and execute commands
    // For now, this is a placeholder for Phase 3.2+ implementation
    logger.debug({ agentId: agent.id }, 'Command execution not yet implemented');
  }

  /**
   * Setup shared memory coordination
   */
  private async setupSharedMemoryCoordination(swarmId: string, agents: SubAgent[]): Promise<void> {
    // Subscribe to swarm updates
    await sharedMemory.subscribeToUpdates(swarmId, (update) => {
      logger.debug({ swarmId, updateType: update.type }, 'Swarm update received');

      // Agents can react to updates in real-time
      if (update.type === 'successful_technique') {
        logger.info({ swarmId, technique: update.data }, 'New technique available');
      } else if (update.type === 'critical_discovery') {
        logger.warn({ swarmId, discovery: update.data }, 'Critical discovery shared');
      }
    });

    logger.debug({ swarmId, agents: agents.length }, 'Shared memory coordination setup');
  }

  /**
   * Cleanup shared memory coordination
   */
  private async cleanupSharedMemory(swarmId: string, agents: SubAgent[]): Promise<void> {
    // Note: We don't clear the swarm data here as Researcher needs it for validation
    // Only unsubscribe from updates
    logger.debug({ swarmId }, 'Shared memory cleanup completed');
  }

  /**
   * Calculate optimal swarm size based on objective
   */
  private calculateOptimalSwarmSize(objective: Objective): number {
    // Base size on objective type and priority
    let baseSize = 20;

    if (objective.type === 'reconnaissance') {
      baseSize = 30; // More agents for broad discovery
    } else if (objective.type === 'exploitation') {
      baseSize = 10; // Fewer agents for focused exploitation
    } else if (objective.type === 'vulnerability_scan') {
      baseSize = 50; // Many agents for parallel scanning
    }

    // Adjust for priority
    const priorityMultiplier = objective.priority / 5;
    return Math.max(5, Math.round(baseSize * priorityMultiplier));
  }

  /**
   * Infer specialization from objective
   */
  private inferSpecialization(objective: Objective): string {
    const type = objective.type;
    const description = objective.description.toLowerCase();

    if (description.includes('xss') || description.includes('cross-site')) {
      return 'xss';
    } else if (description.includes('sql') || description.includes('injection')) {
      return 'sqli';
    } else if (description.includes('auth')) {
      return 'authentication';
    } else if (type === 'reconnaissance') {
      return 'recon';
    } else if (type === 'enumeration') {
      return 'enumeration';
    } else {
      return 'general';
    }
  }

  /**
   * Map specialization to actual tool agent type
   * This bridges three-agent swarms to real security tool agents
   */
  private mapSpecializationToAgentType(specialization: string): AgentType | null {
    const mapping: Record<string, AgentType> = {
      // Core vulnerability scanners
      xss: 'xss',
      sqli: 'sqli',
      ssrf: 'ssrf',
      scanner: 'scanner',
      webvulns: 'webvulns',

      // Reconnaissance & enumeration
      recon: 'discovery',
      discovery: 'discovery',
      enumeration: 'subdomain',
      subdomain: 'subdomain',
      bruteforce: 'bruteforce',
      portscan: 'portscan',
      osint: 'osint',

      // Technology analysis
      fingerprint: 'fingerprint',
      jsanalysis: 'jsanalysis',
      apifuzz: 'scanner', // Use scanner agent type for API fuzzing

      // Advanced testing
      browser: 'confirm', // Browser agent uses confirm type
      crawl: 'crawl',
      cloudmisconfig: 'cloudmisconfig',
      interact: 'interact',

      // Analysis & validation
      triage: 'triage',
      confirm: 'confirm',

      // Advanced AI-powered agents
      autonomous: 'scanner', // Autonomous scanner uses scanner type
      'intelligent-triage': 'triage', // Intelligent triage uses triage type
      orchestration: 'manager',
      manager: 'manager',

      // Fallback mappings
      general: 'scanner',
      authentication: 'webvulns',
      api: 'scanner',
      oob: 'interact',
      learning: 'scanner', // For autonomous learning capabilities
    };

    return mapping[specialization] || null;
  }

  /**
   * Distribute targets among agents
   */
  private distributeTargets(targets: Target[], agentCount: number): Target[][] {
    const chunks: Target[][] = Array.from({ length: agentCount }, () => []);

    targets.forEach((target, index) => {
      chunks[index % agentCount].push(target);
    });

    return chunks;
  }

  /**
   * Generate custom tool for specific task
   * Uses LLM to write code, then tests in sandbox
   */
  async generateTool(requirement: ToolRequirement): Promise<Tool> {
    logger.info({ purpose: requirement.purpose }, 'Generating custom tool');

    try {
      const toolPrompt = `You are a security tool developer. Generate a ${requirement.language} script for the following purpose:

**Purpose:** ${requirement.purpose}

**Inputs:**
${requirement.inputs.map((i) => `- ${i.name} (${i.type}): ${i.description}`).join('\n')}

**Outputs:**
${requirement.outputs.map((o) => `- ${o.name} (${o.type}): ${o.description}`).join('\n')}

**Requirements:**
${requirement.requirements.join('\n')}

Generate production-ready code with:
1. Proper error handling
2. Clear comments
3. Type safety where applicable
4. Efficient algorithms

Return only the code, no explanations.`;

      // Use Grok for fast code generation, fallback to serverless
      const code = await llmEngine.complete(toolPrompt, undefined, 'grok,serverless');

      // Create tool
      const tool: Tool = {
        id: uuidv4(),
        name: requirement.purpose.replace(/\s+/g, '_').toLowerCase(),
        description: requirement.purpose,
        language: requirement.language,
        code,
        version: 1,
        tested: false,
        successRate: 0.0,
        createdAt: new Date(),
      };

      // Test tool in sandbox if test cases provided
      if (requirement.testCases && requirement.testCases.length > 0) {
        const testResult = await this.testTool(tool, requirement.testCases);
        tool.tested = testResult.success;
        tool.successRate = testResult.successRate;
      }

      this.generatedTools.set(tool.id, tool);

      logger.info({ toolId: tool.id, name: tool.name, tested: tool.tested }, 'Tool generated');

      return tool;
    } catch (error: any) {
      logger.error({ error, purpose: requirement.purpose }, 'Failed to generate tool');
      throw error;
    }
  }

  /**
   * Test generated tool in sandbox
   */
  private async testTool(
    tool: Tool,
    testCases: Array<{ input: any; expectedOutput: any }>
  ): Promise<{ success: boolean; successRate: number }> {
    try {
      let passedTests = 0;

      for (const testCase of testCases) {
        const result = await sandboxExecutor.execute({
          code: tool.code,
          config: {
            language: tool.language as any,
            timeoutMs: 5000,
          },
          stdin: testCase.input,
        });

        if (result.success && this.outputMatches(result.stdout, testCase.expectedOutput)) {
          passedTests++;
        }
      }

      const successRate = passedTests / testCases.length;
      const success = successRate >= 0.8; // 80% pass rate required

      return { success, successRate };
    } catch (error: any) {
      logger.error({ error, toolId: tool.id }, 'Tool testing failed');
      return { success: false, successRate: 0.0 };
    }
  }

  /**
   * Check if output matches expected
   */
  private outputMatches(actual: any, expected: any): boolean {
    // Simple comparison - could be enhanced with fuzzy matching
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  /**
   * Get active swarms
   */
  getActiveSwarms(): SwarmConfig[] {
    return Array.from(this.activeSwarms.values());
  }

  /**
   * Get swarm status
   */
  getSwarmStatus(swarmId: string): {
    config: SwarmConfig | undefined;
    agents: SubAgent[];
  } {
    return {
      config: this.activeSwarms.get(swarmId),
      agents: Array.from(this.subAgents.values()).filter((a) => a.swarmId === swarmId),
    };
  }
}

// Singleton instance
export const executorAgent = new ExecutorAgent();
export default executorAgent;
