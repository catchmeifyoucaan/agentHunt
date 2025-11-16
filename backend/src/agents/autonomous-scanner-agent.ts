/**
 * Autonomous Scanner Agent - Phase 2 Intelligence Demo
 * Demonstrates RAG knowledge base, research engine, and metacognitive reasoning
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import { BaseJob } from '../../../shared/types';
import knowledgeStore from '../services/knowledge/knowledge-store';
import researchEngine from '../services/knowledge/research-engine';
import metacognitive from '../services/knowledge/metacognitive-reasoning';
import logger from '../utils/logger';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';

interface ScanJob extends BaseJob {
  targetUrl: string;
  vulnerabilityType?: string;
  programId: string;
}

/**
 * Autonomous Scanner with Learning Capabilities
 * - Uses RAG knowledge base to learn from past scans
 * - Researches vulnerabilities automatically
 * - Reflects on actions and adapts strategy
 * - Self-improves over time
 */
export class AutonomousScannerAgent extends BaseAgent<ScanJob> {
  private enhanced = new EnhancedAgentCapabilities();
  private actions: Array<{ action: string; reasoning: string; timestamp: Date }> = [];
  private results: Array<{ success: boolean; output?: string; error?: string; duration: number }> = [];

  constructor() {
    super('scanner');
  }

  protected getSteps(): Array<{ name: string; metadata?: any }> {
    return [
      { name: 'research_knowledge', metadata: { description: 'Research vulnerability knowledge' } },
      { name: 'get_recommendations', metadata: { description: 'Get knowledge-based recommendations' } },
      { name: 'execute_scan', metadata: { description: 'Execute security scan' } },
      { name: 'reflect_and_learn', metadata: { description: 'Reflect on actions and learn' } },
      { name: 'adapt_strategy', metadata: { description: 'Adapt strategy if needed' } },
    ];
  }

  async process(job: Job<ScanJob>): Promise<any> {
    const { targetUrl, vulnerabilityType, programId } = job.data;

    logger.info(
      {
        jobId: job.id,
        targetUrl,
        vulnerabilityType,
      },
      'Starting autonomous scan with intelligence'
    );

    // Step 1: Research the vulnerability type
    if (vulnerabilityType) {
      await this.researchVulnerability(vulnerabilityType);
    }

    // Step 2: Get recommendations from knowledge base
    const recommendations = await this.getRecommendations(targetUrl, vulnerabilityType);

    // Step 3: Execute scans based on recommendations
    const findings = await this.executeScanWithLearning(
      targetUrl,
      recommendations,
      vulnerabilityType || 'general'
    );

    // Step 4: Reflect on actions
    const reflection = await this.reflectOnActions();

    // Step 5: Adapt strategy if needed
    if (reflection.shouldPivot) {
      await this.adaptStrategy(reflection);
    }

    // Step 6: Record learning
    await this.recordLearning(findings, reflection);

    // 🚀 THREE-AGENT INTEGRATION: Write autonomous scan findings to shared memory
    const swarmData = job.data as any;
    const { swarmId, enableSharedMemory } = swarmData;

    if (swarmId && enableSharedMemory && findings.length > 0) {
      try {
        const autonomousFindings = findings.map((finding: any) => ({
          id: uuidv4(),
          type: `autonomous-${finding.type || 'vulnerability'}`,
          severity: finding.severity || 'medium',
          url: finding.url || targetUrl,
          evidence: finding.evidence || finding.description,
          confidence: finding.confidence || 0.8,
          timestamp: new Date(),
          discoveredBy: `autonomous-scanner-${job.id}`,
          metadata: {
            researchBased: true,
            recommendationsUsed: recommendations.length,
            llmReasoning: finding.reasoning,
            actionsTaken: this.actions.length,
          },
        }));

        await sharedMemory.storeFindings(swarmId, autonomousFindings);

        // Share autonomous learning insights
        if (reflection.insights.length > 0) {
          await sharedMemory.shareSuccess(swarmId, {
            id: uuidv4(),
            name: 'autonomous-learning',
            description: `Autonomous scanner learned ${reflection.insights.length} insights`,
            successRate: this.results.filter(r => r.success).length / this.results.length,
            metadata: {
              insights: reflection.insights.slice(0, 5),
              actionsCount: this.actions.length,
              source: 'autonomous-scanner',
            },
          });
        }

        logger.info({
          swarmId,
          autonomousFindings: findings.length,
          insights: reflection.insights.length,
        }, '🔗 Autonomous scanner shared findings with swarm');
      } catch (error) {
        logger.error({ error, swarmId }, 'Failed to share autonomous scanner findings');
      }
    }

    return {
      findings,
      reflection,
      recommendationsUsed: recommendations.length,
      actionsCount: this.actions.length,
      successRate: this.results.filter(r => r.success).length / this.results.length,
      learned: reflection.insights.length,
    };
  }

  /**
   * Research vulnerability using external sources
   */
  private async researchVulnerability(vulnerabilityType: string): Promise<void> {
    this.recordAction('research_vulnerability', `Researching ${vulnerabilityType}`);

    const startTime = Date.now();

    try {
      logger.info({ vulnerabilityType }, 'Researching vulnerability');

      // Use research engine to find CVEs, exploits, etc.
      const research = await researchEngine.researchVulnerability(vulnerabilityType);

      this.recordResult(true, `Found ${research.cves.length} CVEs, ${research.exploits.length} exploits`, Date.now() - startTime);

      logger.info(
        {
          cves: research.cves.length,
          exploits: research.exploits.length,
          githubRepos: research.githubRepos.length,
          knowledgeAdded: research.knowledgeEntriesCreated,
        },
        'Research completed'
      );
    } catch (error: any) {
      this.recordResult(false, undefined, Date.now() - startTime, error.message);
      logger.error({ error }, 'Research failed');
    }
  }

  /**
   * Get recommendations from knowledge base
   */
  private async getRecommendations(
    targetUrl: string,
    vulnerabilityType?: string
  ): Promise<Array<{ action: string; reasoning: string; confidence: number }>> {
    this.recordAction('get_recommendations', 'Getting knowledge-based recommendations');

    const startTime = Date.now();

    try {
      const recommendations = await knowledgeStore.getRecommendations({
        targetUrl,
        vulnerabilityType,
        previousAttempts: [], // Could track this across runs
        tags: ['web', 'security'],
      });

      this.recordResult(true, `Got ${recommendations.length} recommendations`, Date.now() - startTime);

      const actions = recommendations.map(rec => ({
        action: `Test using: ${rec.entry.title}`,
        reasoning: rec.reasoning,
        confidence: rec.confidence,
      }));

      logger.info({ count: actions.length }, 'Recommendations retrieved');

      return actions.slice(0, 3); // Top 3 recommendations
    } catch (error: any) {
      this.recordResult(false, undefined, Date.now() - startTime, error.message);
      logger.error({ error }, 'Failed to get recommendations');
      return [];
    }
  }

  /**
   * Execute scan with learning
   */
  private async executeScanWithLearning(
    targetUrl: string,
    recommendations: Array<{ action: string; reasoning: string; confidence: number }>,
    vulnerabilityType: string
  ): Promise<any[]> {
    const findings: any[] = [];

    // Get suggested payloads from research engine
    const payloads = await researchEngine.getRecommendedPayloads(vulnerabilityType);

    // Try basic payloads first
    for (const payload of payloads.basic.slice(0, 3)) {
      this.recordAction('test_payload', `Testing basic payload: ${payload.substring(0, 50)}`);

      const startTime = Date.now();

      try {
        // Use sandbox to test payload safely
        const testCode = this.generateTestCode(targetUrl, payload, vulnerabilityType);
        const result = await this.enhanced.executeInSandbox(testCode, 'python', {
          allowNetwork: true,
          timeout: 30000,
          agentId: this.workerId,
        });

        if (result.success && result.stdout.includes('VULNERABLE')) {
          findings.push({
            type: vulnerabilityType,
            payload,
            evidence: result.stdout,
            severity: 'medium',
          });

          this.recordResult(true, 'Vulnerability found!', Date.now() - startTime);
        } else {
          this.recordResult(false, 'Not vulnerable', Date.now() - startTime);
        }
      } catch (error: any) {
        this.recordResult(false, undefined, Date.now() - startTime, error.message);
      }
    }

    return findings;
  }

  /**
   * Reflect on actions taken
   */
  private async reflectOnActions(): Promise<any> {
    logger.info('Agent reflecting on actions');

    const reflection = await metacognitive.reflect(
      this.agentType,
      this.actions,
      this.results,
      { targetUrl: 'current-target' }
    );

    logger.info(
      {
        insights: reflection.insights.length,
        mistakes: reflection.mistakes.length,
        shouldPivot: reflection.shouldPivot,
        confidence: reflection.confidence,
      },
      'Reflection completed'
    );

    return reflection;
  }

  /**
   * Adapt strategy based on reflection
   */
  private async adaptStrategy(reflection: any): Promise<void> {
    logger.info('Adapting strategy based on reflection');

    const currentStrategy = 'Test basic payloads first, then advanced if needed';
    const recentResults = this.results.slice(-5).map((r, i) => ({
      action: this.actions[i]?.action || 'unknown',
      success: r.success,
      reason: r.error,
    }));

    const adaptation = await metacognitive.adaptStrategy(
      currentStrategy,
      recentResults,
      'Find vulnerabilities efficiently'
    );

    logger.info(
      {
        expectedImprovement: adaptation.expectedImprovement,
        riskLevel: adaptation.riskLevel,
      },
      'Strategy adapted'
    );

    // In production, would update agent's strategy here
  }

  /**
   * Record learning in knowledge base
   */
  private async recordLearning(findings: any[], reflection: any): Promise<void> {
    logger.info({ findings: findings.length }, 'Recording learning');

    // If we found something, record it as successful knowledge usage
    for (const finding of findings) {
      // Could create a new knowledge entry for this finding
      await knowledgeStore.addEntry({
        type: 'finding',
        title: `${finding.type} found in scan`,
        description: `Successful ${finding.type} detection`,
        content: JSON.stringify(finding),
        severity: finding.severity,
        tags: [finding.type, 'automated', 'learned'],
        source: 'internal',
      });
    }

    logger.info('Learning recorded');
  }

  /**
   * Record an action
   */
  private recordAction(action: string, reasoning: string): void {
    this.actions.push({
      action,
      reasoning,
      timestamp: new Date(),
    });
  }

  /**
   * Record a result
   */
  private recordResult(success: boolean, output?: string, duration: number = 0, error?: string): void {
    this.results.push({
      success,
      output,
      error,
      duration,
    });
  }

  /**
   * Generate test code for a payload
   */
  private generateTestCode(targetUrl: string, payload: string, vulnerabilityType: string): string {
    // Simple test code generator
    // In production, would use LLM to generate this

    if (vulnerabilityType.toLowerCase().includes('xss')) {
      return `
import requests

url = "${targetUrl}"
payload = """${payload}"""

# Test for XSS
response = requests.get(url, params={"q": payload})

if payload in response.text:
    print("VULNERABLE: XSS payload reflected")
else:
    print("NOT VULNERABLE: Payload not reflected")
`;
    }

    return `print("Test not implemented for ${vulnerabilityType}")`;
  }
}
