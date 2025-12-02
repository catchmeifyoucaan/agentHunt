/**
 * Predictive Parallel Intelligence (PPI) Engine
 * 
 * Purpose: Predict optimal agent sequences and parallelize exploitation paths
 * 
 * Features:
 * - Historical success pattern analysis
 * - Vulnerability correlation matrix
 * - Optimal agent sequence prediction
 * - Parallel path planning
 * - Success probability estimation
 * - Resource optimization
 */

import database from './database';
import redis from './redis';
import logger from '../utils/logger';
import ai from './ai';
import { AgentType } from '../../../shared/types';
// UUID generation - use crypto.randomUUID() or fallback
const uuidv4 = (): string => {
  try {
    return require('crypto').randomUUID();
  } catch {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }
};

interface PredictionContext {
  programId: string;
  targetUrl?: string;
  technologies?: string[];
  discoveredAssets?: number;
  currentFindings?: any[];
  completedAgents?: AgentType[];
  budget?: { timeSeconds: number; maxJobs: number };
}

interface AgentPrediction {
  agent: AgentType;
  probability: number;
  expectedFindings: number;
  estimatedTime: number;
  reasoning: string;
  dependencies: AgentType[];
  canParallelize: boolean;
}

interface ExploitPath {
  id: string;
  steps: AgentPrediction[];
  totalProbability: number;
  estimatedTime: number;
  expectedValue: number;
  parallelGroups: AgentType[][];
}

// Historical success rates by agent (learned from data)
const DEFAULT_SUCCESS_RATES: Record<string, number> = {
  'discovery': 0.95,
  'subdomain': 0.90,
  'fingerprint': 0.92,
  'crawl': 0.88,
  'scanner': 0.75,
  'jsanalysis': 0.70,
  'xss': 0.35,
  'sqli': 0.25,
  'ssrf': 0.20,
  'idor': 0.30,
  'authbypass': 0.25,
  'csrf': 0.40,
  'xxe': 0.15,
  'templateinjection': 0.18,
  'deserialization': 0.12,
  'graphql': 0.45,
  'websocket': 0.30,
  'cors': 0.50,
  'cache-poisoning': 0.15,
  'request-smuggling': 0.10,
  'prototype-pollution': 0.20,
  'racecondition': 0.25,
};

// Agent dependencies (what must run before)
const AGENT_DEPENDENCIES: Record<string, AgentType[]> = {
  'fingerprint': ['discovery'],
  'crawl': ['fingerprint'],
  'scanner': ['fingerprint'],
  'jsanalysis': ['crawl'],
  'xss': ['crawl', 'scanner'],
  'sqli': ['crawl', 'scanner'],
  'ssrf': ['crawl', 'parameter-discovery'],
  'idor': ['crawl', 'apifuzz'],
  'authbypass': ['crawl', 'fingerprint'],
  'csrf': ['crawl'],
  'xxe': ['crawl', 'fingerprint'],
  'templateinjection': ['fingerprint', 'scanner'],
  'graphql': ['crawl', 'fingerprint'],
  'websocket': ['crawl'],
  'cors': ['crawl'],
  'cache-poisoning': ['fingerprint'],
  'request-smuggling': ['fingerprint'],
};

// Agents that can run in parallel
const PARALLEL_GROUPS: AgentType[][] = [
  ['discovery', 'osint', 'github-secrets'],
  ['subdomain', 'portscan'],
  ['fingerprint', 'crawl'],
  ['scanner', 'jsanalysis', 'parameter-discovery'],
  ['xss', 'sqli', 'ssrf', 'csrf', 'idor'],
  ['authbypass', 'oauth', 'jwt-attack'],
  ['xxe', 'templateinjection', 'deserialization'],
  ['graphql', 'grpc', 'websocket'],
  ['cors', 'cache-poisoning', 'request-smuggling'],
];

// Technology to agent mapping (which agents are most effective)
const TECH_AGENT_AFFINITY: Record<string, { agent: AgentType; boost: number }[]> = {
  'php': [
    { agent: 'sqli', boost: 1.3 },
    { agent: 'templateinjection', boost: 1.2 },
    { agent: 'deserialization', boost: 1.4 },
    { agent: 'xxe', boost: 1.2 },
  ],
  'java': [
    { agent: 'deserialization', boost: 1.5 },
    { agent: 'xxe', boost: 1.3 },
    { agent: 'templateinjection', boost: 1.2 },
  ],
  'node': [
    { agent: 'prototype-pollution', boost: 1.5 },
    { agent: 'ssrf', boost: 1.2 },
    { agent: 'xss', boost: 1.1 },
  ],
  'python': [
    { agent: 'templateinjection', boost: 1.4 },
    { agent: 'deserialization', boost: 1.3 },
    { agent: 'ssrf', boost: 1.2 },
  ],
  'graphql': [
    { agent: 'graphql', boost: 2.0 },
    { agent: 'idor', boost: 1.3 },
    { agent: 'sqli', boost: 1.2 },
  ],
  'wordpress': [
    { agent: 'sqli', boost: 1.4 },
    { agent: 'xss', boost: 1.3 },
    { agent: 'authbypass', boost: 1.2 },
  ],
  'react': [
    { agent: 'xss', boost: 1.2 },
    { agent: 'prototype-pollution', boost: 1.3 },
  ],
  'aws': [
    { agent: 'ssrf', boost: 1.5 },
    { agent: 'cloudmisconfig', boost: 1.4 },
    { agent: 'idor', boost: 1.2 },
  ],
};

class PPIEngine {
  private correlationMatrix: Map<string, Map<string, number>> = new Map();
  private successHistory: Map<string, number[]> = new Map();

  constructor() {
    this.loadHistoricalData();
  }

  /**
   * Predict optimal next agents based on current context
   */
  async predictNextAgents(context: PredictionContext): Promise<AgentPrediction[]> {
    const predictions: AgentPrediction[] = [];
    const completedSet = new Set(context.completedAgents || []);

    // Get all candidate agents
    const candidates = this.getCandidateAgents(completedSet);

    for (const agent of candidates) {
      // Check dependencies
      const deps = AGENT_DEPENDENCIES[agent] || [];
      const depsComplete = deps.every(d => completedSet.has(d));
      if (!depsComplete) continue;

      // Calculate base probability
      let probability = await this.getSuccessProbability(agent, context.programId);

      // Apply technology boosts
      if (context.technologies) {
        for (const tech of context.technologies) {
          const affinities = TECH_AGENT_AFFINITY[tech.toLowerCase()];
          if (affinities) {
            const match = affinities.find(a => a.agent === agent);
            if (match) {
              probability *= match.boost;
            }
          }
        }
      }

      // Apply correlation boosts from current findings
      if (context.currentFindings && context.currentFindings.length > 0) {
        const correlationBoost = await this.getCorrelationBoost(agent, context.currentFindings);
        probability *= correlationBoost;
      }

      // Cap probability at 0.95
      probability = Math.min(probability, 0.95);

      // Estimate findings and time
      const expectedFindings = await this.estimateFindings(agent, context);
      const estimatedTime = await this.estimateTime(agent, context);

      // Generate reasoning
      const reasoning = this.generateReasoning(agent, probability, context);

      predictions.push({
        agent,
        probability,
        expectedFindings,
        estimatedTime,
        reasoning,
        dependencies: deps,
        canParallelize: this.canParallelize(agent, completedSet),
      });
    }

    // Sort by probability * expectedFindings (expected value)
    predictions.sort((a, b) => 
      (b.probability * b.expectedFindings) - (a.probability * a.expectedFindings)
    );

    return predictions.slice(0, 10);
  }

  /**
   * Generate optimal exploitation paths
   */
  async generateExploitPaths(context: PredictionContext, maxPaths: number = 5): Promise<ExploitPath[]> {
    const paths: ExploitPath[] = [];
    const predictions = await this.predictNextAgents(context);

    // Generate paths using beam search
    const beams: { agents: AgentType[]; prob: number; findings: number; time: number }[] = [
      { agents: [], prob: 1.0, findings: 0, time: 0 }
    ];

    for (let depth = 0; depth < 6; depth++) {
      const newBeams: typeof beams = [];

      for (const beam of beams) {
        const nextContext = {
          ...context,
          completedAgents: [...(context.completedAgents || []), ...beam.agents],
        };

        const nextPredictions = await this.predictNextAgents(nextContext);

        for (const pred of nextPredictions.slice(0, 3)) {
          newBeams.push({
            agents: [...beam.agents, pred.agent],
            prob: beam.prob * pred.probability,
            findings: beam.findings + pred.expectedFindings,
            time: beam.time + pred.estimatedTime,
          });
        }
      }

      // Keep top beams
      newBeams.sort((a, b) => (b.prob * b.findings) - (a.prob * a.findings));
      beams.length = 0;
      beams.push(...newBeams.slice(0, maxPaths * 2));
    }

    // Convert beams to paths
    for (const beam of beams.slice(0, maxPaths)) {
      const steps = await Promise.all(
        beam.agents.map(async (agent) => {
          const prob = await this.getSuccessProbability(agent, context.programId);
          return {
            agent,
            probability: prob,
            expectedFindings: await this.estimateFindings(agent, context),
            estimatedTime: await this.estimateTime(agent, context),
            reasoning: '',
            dependencies: AGENT_DEPENDENCIES[agent] || [],
            canParallelize: true,
          };
        })
      );

      const parallelGroups = this.groupForParallelExecution(beam.agents);

      paths.push({
        id: uuidv4(),
        steps,
        totalProbability: beam.prob,
        estimatedTime: beam.time,
        expectedValue: beam.prob * beam.findings,
        parallelGroups,
      });
    }

    return paths;
  }

  /**
   * Get AI-powered attack strategy
   */
  async getAIStrategy(context: PredictionContext): Promise<string> {
    const predictions = await this.predictNextAgents(context);
    const paths = await this.generateExploitPaths(context, 3);

    const prompt = `You are an expert bug bounty hunter. Based on the following analysis, provide a strategic attack plan.

Target Context:
- Technologies: ${context.technologies?.join(', ') || 'Unknown'}
- Discovered Assets: ${context.discoveredAssets || 0}
- Current Findings: ${context.currentFindings?.length || 0}
- Completed Agents: ${context.completedAgents?.join(', ') || 'None'}

Top Predicted Agents (by success probability):
${predictions.slice(0, 5).map(p => `- ${p.agent}: ${(p.probability * 100).toFixed(1)}% success, ~${p.expectedFindings} findings`).join('\n')}

Recommended Attack Paths:
${paths.map((p, i) => `Path ${i + 1}: ${p.steps.map(s => s.agent).join(' → ')} (${(p.totalProbability * 100).toFixed(1)}% success)`).join('\n')}

Provide a concise attack strategy (3-5 bullet points) focusing on:
1. Which agents to prioritize and why
2. What vulnerabilities are most likely based on the tech stack
3. Any parallel execution opportunities
4. Specific techniques to try`;

    try {
      const response = await (ai as any).generateText?.(prompt) || 
                       await (ai as any).chat?.([{ role: 'user', content: prompt }]) ||
                       'Unable to generate strategy';
      return response;
    } catch (error) {
      logger.error({ error }, 'Failed to generate AI strategy');
      return 'Strategy generation failed';
    }
  }

  /**
   * Record success/failure for learning
   */
  async recordOutcome(
    programId: string,
    agent: AgentType,
    success: boolean,
    findingsCount: number,
    context: PredictionContext
  ): Promise<void> {
    try {
      // Store in database
      await database.query(
        `INSERT INTO ppi_outcomes (id, program_id, agent, success, findings_count, technologies, context, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          programId,
          agent,
          success,
          findingsCount,
          JSON.stringify(context.technologies || []),
          JSON.stringify(context),
        ]
      );

      // Update success history
      const key = `${programId}:${agent}`;
      if (!this.successHistory.has(key)) {
        this.successHistory.set(key, []);
      }
      this.successHistory.get(key)!.push(success ? 1 : 0);

      // Update correlation matrix if we have findings
      if (findingsCount > 0 && context.currentFindings) {
        await this.updateCorrelations(agent, context.currentFindings);
      }

      logger.debug({ agent, success, findingsCount }, 'PPI outcome recorded');
    } catch (error) {
      logger.error({ error }, 'Failed to record PPI outcome');
    }
  }

  /**
   * Get success probability for an agent
   */
  private async getSuccessProbability(agent: AgentType, programId: string): Promise<number> {
    // Check program-specific history first
    const key = `${programId}:${agent}`;
    const history = this.successHistory.get(key);
    
    if (history && history.length >= 5) {
      // Use recent history
      const recent = history.slice(-20);
      return recent.reduce((a, b) => a + b, 0) / recent.length;
    }

    // Fall back to global history
    try {
      const result = await database.query(
        `SELECT AVG(CASE WHEN success THEN 1 ELSE 0 END) as rate
         FROM ppi_outcomes
         WHERE agent = $1 AND created_at > NOW() - INTERVAL '30 days'`,
        [agent]
      );

      if (result.rows[0]?.rate) {
        return parseFloat(result.rows[0].rate);
      }
    } catch (error) {
      // Ignore DB errors
    }

    // Fall back to defaults
    return DEFAULT_SUCCESS_RATES[agent] || 0.3;
  }

  /**
   * Get correlation boost based on current findings
   */
  private async getCorrelationBoost(agent: AgentType, findings: any[]): Promise<number> {
    let boost = 1.0;

    for (const finding of findings) {
      const findingType = finding.type || finding.info?.name || '';
      const correlations = this.correlationMatrix.get(findingType);
      
      if (correlations) {
        const agentCorrelation = correlations.get(agent);
        if (agentCorrelation) {
          boost *= (1 + agentCorrelation);
        }
      }
    }

    return Math.min(boost, 2.0); // Cap at 2x
  }

  /**
   * Update correlation matrix
   */
  private async updateCorrelations(agent: AgentType, previousFindings: any[]): Promise<void> {
    for (const finding of previousFindings) {
      const findingType = finding.type || finding.info?.name || '';
      
      if (!this.correlationMatrix.has(findingType)) {
        this.correlationMatrix.set(findingType, new Map());
      }

      const current = this.correlationMatrix.get(findingType)!.get(agent) || 0;
      this.correlationMatrix.get(findingType)!.set(agent, current + 0.1);
    }
  }

  /**
   * Estimate expected findings
   */
  private async estimateFindings(agent: AgentType, context: PredictionContext): Promise<number> {
    const baseEstimates: Record<string, number> = {
      'discovery': 50,
      'subdomain': 30,
      'fingerprint': 20,
      'crawl': 100,
      'scanner': 15,
      'jsanalysis': 10,
      'xss': 3,
      'sqli': 2,
      'ssrf': 1,
      'idor': 2,
      'authbypass': 1,
      'csrf': 2,
    };

    let estimate = baseEstimates[agent] || 2;

    // Scale by discovered assets
    if (context.discoveredAssets) {
      estimate *= Math.log10(context.discoveredAssets + 1);
    }

    return Math.round(estimate);
  }

  /**
   * Estimate execution time in seconds
   */
  private async estimateTime(agent: AgentType, context: PredictionContext): Promise<number> {
    const baseTime: Record<string, number> = {
      'discovery': 120,
      'subdomain': 180,
      'fingerprint': 60,
      'crawl': 300,
      'scanner': 600,
      'jsanalysis': 120,
      'xss': 180,
      'sqli': 240,
      'ssrf': 120,
      'idor': 180,
    };

    let time = baseTime[agent] || 120;

    // Scale by assets
    if (context.discoveredAssets) {
      time *= Math.sqrt(context.discoveredAssets / 100);
    }

    return Math.round(time);
  }

  /**
   * Get candidate agents
   */
  private getCandidateAgents(completed: Set<AgentType>): AgentType[] {
    const allAgents: AgentType[] = [
      'discovery', 'subdomain', 'fingerprint', 'crawl', 'scanner',
      'jsanalysis', 'xss', 'sqli', 'ssrf', 'idor', 'authbypass',
      'csrf', 'xxe', 'templateinjection', 'deserialization',
      'graphql', 'grpc', 'websocket', 'cors', 'cache-poisoning',
      'request-smuggling', 'prototype-pollution', 'racecondition',
      'oauth', 'jwt-attack', 'business-logic',
    ];

    return allAgents.filter(a => !completed.has(a));
  }

  /**
   * Check if agent can run in parallel with completed agents
   */
  private canParallelize(agent: AgentType, completed: Set<AgentType>): boolean {
    for (const group of PARALLEL_GROUPS) {
      if (group.includes(agent)) {
        // Check if any agent in the same group is NOT completed
        const groupNotComplete = group.some(g => !completed.has(g) && g !== agent);
        if (groupNotComplete) return true;
      }
    }
    return false;
  }

  /**
   * Group agents for parallel execution
   */
  private groupForParallelExecution(agents: AgentType[]): AgentType[][] {
    const groups: AgentType[][] = [];
    const remaining = new Set(agents);

    while (remaining.size > 0) {
      const group: AgentType[] = [];
      
      for (const agent of remaining) {
        // Check if this agent can run with current group
        const canAdd = group.length === 0 || 
          PARALLEL_GROUPS.some(pg => pg.includes(agent) && group.some(g => pg.includes(g)));
        
        if (canAdd) {
          group.push(agent);
          remaining.delete(agent);
        }
      }

      if (group.length > 0) {
        groups.push(group);
      } else {
        // Fallback: add one at a time
        const next = remaining.values().next().value;
        groups.push([next]);
        remaining.delete(next);
      }
    }

    return groups;
  }

  /**
   * Generate reasoning for prediction
   */
  private generateReasoning(agent: AgentType, probability: number, context: PredictionContext): string {
    const reasons: string[] = [];

    if (probability > 0.7) {
      reasons.push('High historical success rate');
    }

    if (context.technologies) {
      for (const tech of context.technologies) {
        const affinities = TECH_AGENT_AFFINITY[tech.toLowerCase()];
        if (affinities?.some(a => a.agent === agent)) {
          reasons.push(`Strong affinity with ${tech}`);
        }
      }
    }

    if (context.currentFindings && context.currentFindings.length > 0) {
      reasons.push('Correlated with existing findings');
    }

    return reasons.join('; ') || 'Standard recommendation';
  }

  /**
   * Load historical data on startup
   */
  private async loadHistoricalData(): Promise<void> {
    try {
      const result = await database.query(
        `SELECT program_id, agent, success
         FROM ppi_outcomes
         WHERE created_at > NOW() - INTERVAL '30 days'
         ORDER BY created_at DESC
         LIMIT 10000`
      );

      for (const row of result.rows) {
        const key = `${row.program_id}:${row.agent}`;
        if (!this.successHistory.has(key)) {
          this.successHistory.set(key, []);
        }
        this.successHistory.get(key)!.push(row.success ? 1 : 0);
      }

      logger.info({ records: result.rows.length }, 'PPI historical data loaded');
    } catch (error) {
      logger.debug({ error }, 'Failed to load PPI historical data');
    }
  }
}

export const ppiEngine = new PPIEngine();
export default ppiEngine;
