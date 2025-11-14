/**
 * Intelligent Triage Agent - Enhanced with LLM Reasoning
 * Demonstrates integration of LLM capabilities for smart vulnerability analysis
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';

interface TriageJob extends BaseJob {
  findings: Array<{
    id: string;
    url: string;
    type: string;
    severity: string;
    evidence: string;
    template?: string;
    matcher?: string;
    httpRequest?: string;
    httpResponse?: string;
  }>;
  programId: string;
}

/**
 * Enhanced Triage Agent with LLM-powered analysis
 * Uses AI to reduce false positives and assess true severity
 */
export class IntelligentTriageAgent extends BaseAgent<TriageJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('triage');
  }

  protected getSteps(): Array<{ name: string; metadata?: any }> {
    return [
      { name: 'load_findings', metadata: { description: 'Load vulnerability findings' } },
      { name: 'llm_analysis', metadata: { description: 'Analyze findings with LLM' } },
      { name: 'generate_exploits', metadata: { description: 'Generate PoC exploits for confirmed vulns' } },
      { name: 'store_results', metadata: { description: 'Store triage results' } },
    ];
  }

  async process(job: Job<TriageJob>): Promise<any> {
    const { findings, programId } = job.data;

    logger.info(
      {
        jobId: job.id,
        programId,
        findingsCount: findings.length,
      },
      'Starting intelligent triage with LLM analysis'
    );

    // Step 1: Analyze each finding with LLM
    const analyzedFindings = [];

    for (const finding of findings) {
      try {
        logger.info({ findingId: finding.id, type: finding.type }, 'Analyzing finding with LLM');

        // Use LLM to analyze if this is a true positive
        const analysis = await this.enhanced.analyzeVulnerability(
          {
            url: finding.url,
            type: finding.type,
            evidence: finding.evidence,
            httpRequest: finding.httpRequest,
            httpResponse: finding.httpResponse,
          },
          this.agentType
        );

        analyzedFindings.push({
          ...finding,
          llmAnalysis: analysis,
          originalSeverity: finding.severity,
          adjustedSeverity: analysis.severity,
          isTruePositive: analysis.isTruePositive,
          confidence: analysis.confidence,
        });

        logger.info(
          {
            findingId: finding.id,
            isTruePositive: analysis.isTruePositive,
            confidence: analysis.confidence,
            severity: analysis.severity,
          },
          'LLM analysis completed'
        );
      } catch (error: any) {
        logger.error({ error, findingId: finding.id }, 'Failed to analyze finding');

        // Keep original finding on error
        analyzedFindings.push({
          ...finding,
          llmAnalysis: null,
          isTruePositive: true, // Conservative: assume true
          confidence: 0.5,
        });
      }
    }

    // Step 2: Generate exploits for high-confidence true positives
    const confirmedVulns = analyzedFindings.filter(
      f => f.isTruePositive && f.confidence >= 0.7 && ['high', 'critical'].includes(f.adjustedSeverity || '')
    );

    logger.info(
      {
        total: findings.length,
        confirmed: confirmedVulns.length,
        falsePositives: analyzedFindings.filter(f => !f.isTruePositive).length,
      },
      'Triage analysis summary'
    );

    const exploits = [];

    for (const vuln of confirmedVulns.slice(0, 5)) {
      // Limit to 5 exploits
      try {
        logger.info({ findingId: vuln.id, type: vuln.type }, 'Generating PoC exploit');

        const exploitCode = await this.enhanced.generateExploit(
          {
            vulnerability: {
              type: vuln.type,
              target: vuln.url,
              context: vuln.evidence || 'No evidence provided'
            },
            environment: {
              framework: 'requests'
            }
          },
          this.agentType
        );

        exploits.push({
          findingId: vuln.id,
          code: exploitCode,
          language: 'python',
        });

        logger.info({ findingId: vuln.id, codeLength: exploitCode.length }, 'PoC exploit generated');
      } catch (error: any) {
        logger.error({ error, findingId: vuln.id }, 'Failed to generate exploit');
      }
    }

    // Step 3: Return results
    const result = {
      programId,
      totalFindings: findings.length,
      analyzedFindings,
      confirmedVulnerabilities: confirmedVulns.length,
      falsePositives: analyzedFindings.filter(f => !f.isTruePositive).length,
      exploitsGenerated: exploits.length,
      exploits,
      summary: {
        critical: analyzedFindings.filter(f => f.adjustedSeverity === 'critical' && f.isTruePositive).length,
        high: analyzedFindings.filter(f => f.adjustedSeverity === 'high' && f.isTruePositive).length,
        medium: analyzedFindings.filter(f => f.adjustedSeverity === 'medium' && f.isTruePositive).length,
        low: analyzedFindings.filter(f => f.adjustedSeverity === 'low' && f.isTruePositive).length,
        info: analyzedFindings.filter(f => f.adjustedSeverity === 'info' && f.isTruePositive).length,
      },
    };

    logger.info(
      {
        jobId: job.id,
        summary: result.summary,
        accuracy: `${((result.confirmedVulnerabilities / result.totalFindings) * 100).toFixed(1)}%`,
      },
      'Intelligent triage completed'
    );

    return result;
  }
}
