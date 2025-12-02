/**
 * God Mode Orchestrator Agent
 * Purpose: Fully autonomous bug hunting with AI intelligence
 * 
 * Capabilities:
 * - Reads ALL findings from ALL agents
 * - Understands target completely
 * - Generates custom attack strategies
 * - Combines vulns into chains
 * - Predicts high-value bugs
 * - Auto-prioritizes efforts
 * - Learns from exploits
 * - Generates reports
 * - Submits to platforms
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import ai from '../services/ai';
import queue from '../services/queue';
import { v4 as uuidv4 } from 'uuid';

interface GodModeJob extends BaseJob {
  type: 'god-mode';
  options: {
    programId: string;
    mode: 'full-auto' | 'supervised' | 'analysis-only';
    targetDomains: string[];
    budget?: {
      maxJobs: number;
      maxTimeHours: number;
      maxCost: number;
    };
    autoSubmit?: boolean;
  };
}

interface AttackStrategy {
  id: string;
  name: string;
  priority: number;
  agents: string[];
  reasoning: string;
  expectedImpact: string;
  estimatedTime: number;
}

interface GodModeState {
  phase: 'recon' | 'scanning' | 'exploitation' | 'chaining' | 'reporting';
  findingsCount: number;
  criticalFindings: number;
  jobsLaunched: number;
  strategiesExecuted: string[];
  learnings: string[];
}

export class GodModeAgent extends BaseAgent<GodModeJob> {
  private state: GodModeState = {
    phase: 'recon',
    findingsCount: 0,
    criticalFindings: 0,
    jobsLaunched: 0,
    strategiesExecuted: [],
    learnings: [],
  };

  constructor() {
    super('god-mode');
  }

  protected getSteps() {
    return [
      { name: 'Analyze target' },
      { name: 'Generate attack strategy' },
      { name: 'Execute reconnaissance' },
      { name: 'Launch scanning agents' },
      { name: 'Analyze findings' },
      { name: 'Generate exploit chains' },
      { name: 'Prioritize and report' },
      { name: 'Learn and adapt' },
    ];
  }

  async process(job: Job<GodModeJob>): Promise<any> {
    const { programId, options } = job.data;
    const { mode, targetDomains, budget, autoSubmit = false } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Step 1: Analyze target
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 8,
        percentage: 5,
        currentTool: 'target-analyzer',
        toolStatus: 'running',
        message: 'Analyzing target environment',
      });

      const targetAnalysis = await this.analyzeTarget(programId, targetDomains);
      logger.info({ targetAnalysis }, 'Target analysis complete');

      // Step 2: Generate attack strategy
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 8,
        percentage: 15,
        currentTool: 'strategy-generator',
        toolStatus: 'running',
        message: 'Generating attack strategy with AI',
      });

      const strategies = await this.generateAttackStrategies(targetAnalysis, programId);
      logger.info({ strategyCount: strategies.length }, 'Attack strategies generated');

      // Step 3: Execute reconnaissance
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 8,
        percentage: 25,
        currentTool: 'recon',
        toolStatus: 'running',
        message: 'Executing reconnaissance phase',
      });

      this.state.phase = 'recon';
      await this.executeReconnaissance(programId, targetDomains, budget);

      // Step 4: Launch scanning agents
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 8,
        percentage: 40,
        currentTool: 'scanner-orchestrator',
        toolStatus: 'running',
        message: 'Launching scanning agents',
      });

      this.state.phase = 'scanning';
      await this.launchScanningAgents(programId, strategies, budget);

      // Step 5: Analyze findings
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 8,
        percentage: 55,
        currentTool: 'finding-analyzer',
        toolStatus: 'running',
        message: 'Analyzing discovered findings',
      });

      const findings = await this.analyzeFindings(programId);
      this.state.findingsCount = findings.length;
      this.state.criticalFindings = findings.filter((f: any) => f.severity === 'critical').length;

      // Step 6: Generate exploit chains
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 8,
        percentage: 70,
        currentTool: 'chain-generator',
        toolStatus: 'running',
        message: 'Generating exploit chains',
      });

      this.state.phase = 'chaining';
      const chains = await this.generateExploitChains(programId, findings);

      // Step 7: Prioritize and report
      await this.updateJobProgress(job.id!, {
        current: 7,
        total: 8,
        percentage: 85,
        currentTool: 'reporter',
        toolStatus: 'running',
        message: 'Generating reports and prioritizing',
      });

      this.state.phase = 'reporting';
      const reports = await this.generateReports(programId, findings, chains, autoSubmit);

      // Step 8: Learn and adapt
      await this.updateJobProgress(job.id!, {
        current: 8,
        total: 8,
        percentage: 95,
        currentTool: 'learner',
        toolStatus: 'running',
        message: 'Learning from results',
      });

      await this.learnFromResults(programId, findings, chains);

      await this.updateJobProgress(job.id!, {
        current: 8,
        total: 8,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `God Mode complete: ${this.state.criticalFindings} critical findings`,
      });

      const result = {
        programId,
        mode,
        state: this.state,
        strategiesExecuted: strategies.length,
        findingsCount: this.state.findingsCount,
        criticalFindings: this.state.criticalFindings,
        chainsGenerated: chains.length,
        reportsGenerated: reports.length,
        learnings: this.state.learnings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error }, 'God Mode execution failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Analyze target environment
   */
  private async analyzeTarget(programId: string, domains: string[]): Promise<any> {
    // Load program info
    const programResult = await database.query(
      'SELECT * FROM programs WHERE id = $1',
      [programId]
    );
    const program = programResult.rows[0];

    // Load existing assets
    const assetsResult = await database.query(
      'SELECT type, COUNT(*) as count FROM assets WHERE program_id = $1 GROUP BY type',
      [programId]
    );

    // Load existing findings
    const findingsResult = await database.query(
      'SELECT type, severity, COUNT(*) as count FROM findings WHERE program_id = $1 GROUP BY type, severity',
      [programId]
    );

    // Analyze tech stack from fingerprinting
    const techResult = await database.query(
      `SELECT DISTINCT jsonb_array_elements_text(metadata->'technologies') as tech 
       FROM assets WHERE program_id = $1 AND metadata->'technologies' IS NOT NULL`,
      [programId]
    );

    return {
      program,
      domains,
      assets: assetsResult.rows,
      existingFindings: findingsResult.rows,
      technologies: techResult.rows.map((r: any) => r.tech),
      attackSurface: {
        domainCount: domains.length,
        assetCount: assetsResult.rows.reduce((sum: number, r: any) => sum + parseInt(r.count), 0),
      },
    };
  }

  /**
   * Generate AI-powered attack strategies
   */
  private async generateAttackStrategies(analysis: any, programId: string): Promise<AttackStrategy[]> {
    const strategies: AttackStrategy[] = [];

    try {
      const prompt = `You are an elite bug bounty hunter. Analyze this target and generate attack strategies:

Target: ${analysis.program?.name || 'Unknown'}
Domains: ${analysis.domains.join(', ')}
Technologies: ${analysis.technologies.join(', ')}
Existing Assets: ${JSON.stringify(analysis.assets)}
Previous Findings: ${JSON.stringify(analysis.existingFindings)}

Generate 5 prioritized attack strategies. For each strategy, specify:
1. Name
2. Priority (1-10)
3. Which agents to use
4. Reasoning
5. Expected impact
6. Estimated time in minutes

Respond with JSON array: [{ "name": "...", "priority": 10, "agents": ["scanner", "xss"], "reasoning": "...", "expectedImpact": "...", "estimatedTime": 30 }]`;

      const response = await this.callAI(prompt);
      
      try {
        const aiStrategies = JSON.parse(response);
        for (const s of aiStrategies) {
          strategies.push({
            id: uuidv4(),
            name: s.name,
            priority: s.priority,
            agents: s.agents,
            reasoning: s.reasoning,
            expectedImpact: s.expectedImpact,
            estimatedTime: s.estimatedTime,
          });
        }
      } catch {
        // Fallback strategies
        strategies.push(...this.getDefaultStrategies());
      }
    } catch {
      strategies.push(...this.getDefaultStrategies());
    }

    // Sort by priority
    strategies.sort((a, b) => b.priority - a.priority);

    return strategies;
  }

  /**
   * Get default attack strategies
   */
  private getDefaultStrategies(): AttackStrategy[] {
    return [
      {
        id: uuidv4(),
        name: 'Full Reconnaissance',
        priority: 10,
        agents: ['discovery', 'subdomain', 'fingerprint', 'crawl'],
        reasoning: 'Comprehensive asset discovery is the foundation',
        expectedImpact: 'Discover hidden attack surface',
        estimatedTime: 60,
      },
      {
        id: uuidv4(),
        name: 'Critical Vulnerability Scan',
        priority: 9,
        agents: ['scanner', 'sqli', 'ssrf', 'rce'],
        reasoning: 'Target high-severity vulnerabilities first',
        expectedImpact: 'Critical findings with high bounty potential',
        estimatedTime: 45,
      },
      {
        id: uuidv4(),
        name: 'Authentication Testing',
        priority: 8,
        agents: ['oauth', 'jwt-attack', 'authbypass', 'idor'],
        reasoning: 'Auth vulnerabilities often lead to account takeover',
        expectedImpact: 'Account takeover, privilege escalation',
        estimatedTime: 30,
      },
      {
        id: uuidv4(),
        name: 'Business Logic Analysis',
        priority: 7,
        agents: ['business-logic', 'racecondition', 'idor'],
        reasoning: 'Logic flaws are often missed by automated tools',
        expectedImpact: 'Unique findings with less competition',
        estimatedTime: 40,
      },
      {
        id: uuidv4(),
        name: 'Advanced Attack Vectors',
        priority: 6,
        agents: ['request-smuggling', 'cache-poisoning', 'prototype-pollution'],
        reasoning: 'Advanced techniques for mature targets',
        expectedImpact: 'High-impact, low-competition findings',
        estimatedTime: 50,
      },
    ];
  }

  /**
   * Execute reconnaissance phase
   */
  private async executeReconnaissance(
    programId: string,
    domains: string[],
    budget?: any
  ): Promise<void> {
    const reconAgents = ['discovery', 'subdomain', 'fingerprint', 'crawl', 'portscan'];

    for (const agentType of reconAgents) {
      if (budget && this.state.jobsLaunched >= budget.maxJobs) break;

      await this.launchAgent(programId, agentType, { domains });
      this.state.jobsLaunched++;
    }

    // Wait for recon to complete (simplified)
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  /**
   * Launch scanning agents based on strategies
   */
  private async launchScanningAgents(
    programId: string,
    strategies: AttackStrategy[],
    budget?: any
  ): Promise<void> {
    for (const strategy of strategies) {
      if (budget && this.state.jobsLaunched >= budget.maxJobs) break;

      for (const agentType of strategy.agents) {
        if (budget && this.state.jobsLaunched >= budget.maxJobs) break;

        await this.launchAgent(programId, agentType, {
          strategy: strategy.name,
          priority: strategy.priority,
        });

        this.state.jobsLaunched++;
        this.state.strategiesExecuted.push(strategy.name);
      }
    }
  }

  /**
   * Launch a specific agent
   */
  private async launchAgent(programId: string, agentType: string, options: any): Promise<void> {
    try {
      await queue.addJob(agentType as any, {
        id: uuidv4(),
        type: agentType,
        programId,
        priority: options.priority || 5,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options,
        metadata: {
          requestedBy: 'god-mode',
          strategy: options.strategy,
        },
        createdAt: new Date(),
      });

      logger.info({ agentType, programId }, 'God Mode launched agent');
    } catch (error) {
      logger.error({ error, agentType }, 'Failed to launch agent');
    }
  }

  /**
   * Analyze all findings
   */
  private async analyzeFindings(programId: string): Promise<any[]> {
    const result = await database.query(
      `SELECT * FROM findings WHERE program_id = $1 ORDER BY 
       CASE severity 
         WHEN 'critical' THEN 1 
         WHEN 'high' THEN 2 
         WHEN 'medium' THEN 3 
         WHEN 'low' THEN 4 
         ELSE 5 
       END`,
      [programId]
    );

    return result.rows;
  }

  /**
   * Generate exploit chains from findings
   */
  private async generateExploitChains(programId: string, findings: any[]): Promise<any[]> {
    if (findings.length < 2) return [];

    // Launch exploit chain agent
    await this.launchAgent(programId, 'exploit-chain', {
      findingIds: findings.map(f => f.id),
      autoChain: true,
      generatePoC: true,
    });

    // Return existing chains
    const result = await database.query(
      `SELECT * FROM findings WHERE program_id = $1 AND type = 'exploit-chain'`,
      [programId]
    );

    return result.rows;
  }

  /**
   * Generate reports for findings
   */
  private async generateReports(
    programId: string,
    findings: any[],
    chains: any[],
    autoSubmit: boolean
  ): Promise<any[]> {
    const reports: any[] = [];

    // Prioritize critical and high findings
    const priorityFindings = findings.filter(f => 
      f.severity === 'critical' || f.severity === 'high'
    );

    for (const finding of priorityFindings.slice(0, 10)) {
      // Launch report generator
      await this.launchAgent(programId, 'report-generator', {
        findingId: finding.id,
        format: 'hackerone',
        includePoC: true,
        includeRemediation: true,
      });

      reports.push({ findingId: finding.id, status: 'generating' });

      // Auto-submit if enabled
      if (autoSubmit) {
        await this.launchAgent(programId, 'bounty-platform', {
          findingId: finding.id,
          platform: 'hackerone',
          action: 'submit',
          dryRun: false,
        });
      }
    }

    return reports;
  }

  /**
   * Learn from results and adapt
   */
  private async learnFromResults(
    programId: string,
    findings: any[],
    chains: any[]
  ): Promise<void> {
    // Analyze what worked
    const successfulTypes = findings
      .filter(f => f.severity === 'critical' || f.severity === 'high')
      .map(f => f.type);

    const typeCount = new Map<string, number>();
    for (const type of successfulTypes) {
      typeCount.set(type, (typeCount.get(type) || 0) + 1);
    }

    // Generate learnings
    const learnings: string[] = [];

    if (typeCount.size > 0) {
      const topTypes = [...typeCount.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      learnings.push(`Most successful vulnerability types: ${topTypes.map(t => t[0]).join(', ')}`);
    }

    if (chains.length > 0) {
      learnings.push(`Generated ${chains.length} exploit chains from ${findings.length} findings`);
    }

    if (this.state.criticalFindings > 0) {
      learnings.push(`Found ${this.state.criticalFindings} critical vulnerabilities`);
    }

    this.state.learnings = learnings;

    // Store learnings for future runs
    try {
      await database.query(
        `INSERT INTO god_mode_learnings (id, program_id, learnings, findings_count, critical_count, created_at)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [uuidv4(), programId, JSON.stringify(learnings), findings.length, this.state.criticalFindings]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to store learnings');
    }
  }

  /**
   * Call AI service
   */
  private async callAI(prompt: string): Promise<string> {
    try {
      const response = await (ai as any).generateText?.(prompt) ||
                       await (ai as any).chat?.([{ role: 'user', content: prompt }]) ||
                       '';
      return response;
    } catch {
      return '';
    }
  }
}

export default new GodModeAgent();
