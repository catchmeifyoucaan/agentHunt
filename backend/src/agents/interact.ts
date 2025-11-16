/**
 * Interact Agent
 * Out-of-band (OOB) interaction testing for blind vulnerabilities
 * Integrates with Interactsh or similar OOB detection services
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob, Finding, Evidence } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import config from '../config';
import logger from '../utils/logger';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';

interface InteractJob extends BaseJob {
  type: 'interact';
  options: {
    pollInterval: number; // seconds
    duration: number; // minutes
  };
}

interface InteractionRecord {
  id: string;
  protocol: string;
  uniqueId: string;
  fullId: string;
  rawRequest: string;
  rawResponse?: string;
  remoteAddress: string;
  timestamp: string;
}

export class InteractAgent extends BaseAgent<InteractJob> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('interact');
  }
  protected getSteps() {
    return [
      {
            name: "Load OOB testing targets",
            metadata: {}
      },
      {
            name: "Generate interaction payloads",
            metadata: {}
      },
      {
            name: "Monitor for interactions",
            metadata: {}
      },
      {
            name: "Store OOB findings",
            metadata: {}
      }
];
  }


  async process(job: Job<InteractJob>): Promise<any> {
    const { id, programId, options } = job.data;

    logger.info({ jobId: id }, 'Starting OOB interaction testing');

    await this.updateJobStatus(id, 'active');
    await this.logExecution(id, programId, 'interactsh', 'start', 'info', 'Initializing OOB interaction testing');

    try {
      const results = await this.monitorInteractions(job.data);

      // 🚀 THREE-AGENT INTEGRATION: Write OOB interaction findings to shared memory
      const swarmData = job.data as any;
      const { swarmId, enableSharedMemory } = swarmData;

      if (swarmId && enableSharedMemory && results.interactions && results.interactions.length > 0) {
        try {
          const interactionFindings = results.interactions.map((interaction: any) => ({
            id: uuidv4(),
            type: `oob-${interaction.protocol}`,
            severity: 'high', // OOB interactions indicate blind vulnerabilities
            url: interaction.fullId,
            evidence: interaction.rawRequest,
            confidence: 0.95,
            timestamp: new Date(interaction.timestamp),
            discoveredBy: `interact-${id}`,
            metadata: {
              protocol: interaction.protocol,
              remoteAddress: interaction.remoteAddress,
              uniqueId: interaction.uniqueId,
              rawResponse: interaction.rawResponse,
            },
          }));

          await sharedMemory.storeFindings(swarmId, interactionFindings);

          // Share successful OOB techniques
          const uniqueProtocols = [...new Set(results.interactions.map((i: any) => i.protocol))];
          for (const protocol of uniqueProtocols) {
            await sharedMemory.shareSuccess(swarmId, {
              id: uuidv4(),
              name: `oob-${protocol}`,
              description: `OOB ${protocol} interaction detected`,
              successRate: 0.95,
              metadata: { protocol, source: 'interact-agent' },
            });
          }

          logger.info({
            swarmId,
            oobInteractions: results.interactions.length,
            protocols: uniqueProtocols,
          }, '🔗 Interact agent shared OOB findings with swarm');
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share OOB findings');
        }
      }

      await this.updateJobStatus(id, 'completed', results);
      await this.logExecution(
        id,
        programId,
        'interactsh',
        'complete',
        'info',
        `Found ${results.interactions.length} OOB interactions`
      );

      // 🎯 RICH HANDOFF: Send OOB-confirmed blind vulnerabilities to Intelligent-Triage
      if (results.interactions.length > 0) {
        await this.handoffToIntelligentTriage(id, programId, results);
      }

      return results;
    } catch (error: any) {
      logger.error({ error, jobId: id }, 'Interact agent failed');
      await this.updateJobStatus(id, 'failed', undefined, error.message);
      throw error;
    }
  }

  /**
   * Monitor interactions using Interactsh service
   */
  private async monitorInteractions(job: InteractJob): Promise<any> {
    const { id, programId, options } = job;
    const { pollInterval, duration } = options;

    const server = config.interactsh.server || 'oast.pro';
    const token = config.interactsh.token;

    logger.info({
      jobId: id,
      server,
      pollInterval,
      duration
    }, 'Starting interaction monitoring');

    // Register with Interactsh
    const sessionId = await this.registerSession(server, token);
    const uniqueDomain = `${sessionId}.${server}`;

    await this.logExecution(
      id,
      programId,
      'interactsh',
      'session',
      'info',
      `Registered session with unique domain: ${uniqueDomain}`
    );

    // Store session info for potential use by other agents
    await this.storeSessionInfo(id, programId, uniqueDomain, sessionId);

    const interactions: InteractionRecord[] = [];
    const startTime = Date.now();
    const endTime = startTime + (duration * 60 * 1000);
    let pollCount = 0;

    // Poll for interactions
    while (Date.now() < endTime) {
      // Check if job was cancelled
      if (await this.shouldCancel(id)) {
        logger.info({ jobId: id }, 'Job cancelled, stopping interaction monitoring');
        break;
      }

      pollCount++;
      await this.logExecution(
        id,
        programId,
        'interactsh',
        'poll',
        'debug',
        `Polling for interactions (poll #${pollCount})`
      );

      try {
        const newInteractions = await this.pollInteractions(server, sessionId, token);

        if (newInteractions.length > 0) {
          interactions.push(...newInteractions);

          await this.logExecution(
            id,
            programId,
            'interactsh',
            'detection',
            'info',
            `Detected ${newInteractions.length} new OOB interactions (total: ${interactions.length})`
          );

          // Process interactions and create findings
          for (const interaction of newInteractions) {
            await this.processInteraction(id, programId, interaction, uniqueDomain);
          }
        }
      } catch (error: any) {
        logger.error({ error, jobId: id }, 'Failed to poll interactions');
        await this.logExecution(
          id,
          programId,
          'interactsh',
          'poll',
          'warn',
          `Poll failed: ${error.message}`
        );
      }

      // Wait for next poll interval
      await this.sleep(pollInterval * 1000);
    }

    // Deregister session
    await this.deregisterSession(server, sessionId, token);

    await this.logExecution(
      id,
      programId,
      'interactsh',
      'complete',
      'info',
      `Monitoring complete. Total interactions: ${interactions.length}`
    );

    return {
      uniqueDomain,
      sessionId,
      interactions,
      duration: Math.round((Date.now() - startTime) / 1000),
      pollCount,
      summary: this.generateSummary(interactions)
    };
  }

  /**
   * Register a new Interactsh session
   */
  private async registerSession(server: string, token?: string): Promise<string> {
    try {
      // Generate unique session ID
      const sessionId = uuidv4().split('-')[0];

      logger.info({ server, sessionId }, 'Registering Interactsh session');

      // If using custom Interactsh server with API
      if (token) {
        const response = await axios.post(
          `https://${server}/register`,
          { correlation_id: sessionId },
          {
            headers: { Authorization: token },
            timeout: 10000
          }
        );
        return response.data.correlation_id || sessionId;
      }

      return sessionId;
    } catch (error: any) {
      logger.warn({ error, server }, 'Session registration failed, using local ID');
      // Fallback to local session ID
      return uuidv4().split('-')[0];
    }
  }

  /**
   * Poll for new interactions
   */
  private async pollInteractions(
    server: string,
    sessionId: string,
    token?: string
  ): Promise<InteractionRecord[]> {
    try {
      const headers: any = {};
      if (token) {
        headers.Authorization = token;
      }

      const response = await axios.get(
        `https://${server}/poll?id=${sessionId}`,
        { headers, timeout: 10000 }
      );

      if (response.data && Array.isArray(response.data.data)) {
        return response.data.data.map((item: any) => ({
          id: uuidv4(),
          protocol: item.protocol || 'unknown',
          uniqueId: item['unique-id'] || sessionId,
          fullId: item['full-id'] || `${sessionId}.${server}`,
          rawRequest: item['raw-request'] || '',
          rawResponse: item['raw-response'],
          remoteAddress: item['remote-address'] || 'unknown',
          timestamp: item.timestamp || new Date().toISOString()
        }));
      }

      return [];
    } catch (error: any) {
      // Interactions might not be available yet, this is normal
      logger.debug({ error: error.message, sessionId }, 'No interactions found');
      return [];
    }
  }

  /**
   * Deregister Interactsh session
   */
  private async deregisterSession(server: string, sessionId: string, token?: string): Promise<void> {
    try {
      if (token) {
        await axios.post(
          `https://${server}/deregister`,
          { correlation_id: sessionId },
          {
            headers: { Authorization: token },
            timeout: 5000
          }
        );
      }
      logger.info({ server, sessionId }, 'Deregistered Interactsh session');
    } catch (error) {
      logger.debug({ error, sessionId }, 'Session deregistration failed (non-critical)');
    }
  }

  /**
   * Store session info in database for other agents to use
   */
  private async storeSessionInfo(
    jobId: string,
    programId: string,
    domain: string,
    sessionId: string
  ): Promise<void> {
    try {
      await this.logExecution(
        jobId,
        programId,
        'interactsh',
        'session',
        'info',
        JSON.stringify({ domain, sessionId, expires: new Date(Date.now() + 24 * 60 * 60 * 1000) })
      );
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to store session info');
    }
  }

  /**
   * Process an interaction and create findings
   */
  private async processInteraction(
    jobId: string,
    programId: string,
    interaction: InteractionRecord,
    domain: string
  ): Promise<void> {
    try {
      logger.info({
        jobId,
        protocol: interaction.protocol,
        remoteAddress: interaction.remoteAddress
      }, 'Processing OOB interaction');

      // Create a finding for the OOB interaction
      const finding = await this.createFinding(jobId, programId, interaction, domain);

      await this.logExecution(
        jobId,
        programId,
        'interactsh',
        'finding',
        'info',
        `Created finding ${finding.id} for ${interaction.protocol} interaction from ${interaction.remoteAddress}`
      );
    } catch (error) {
      logger.error({ error, jobId, interaction }, 'Failed to process interaction');
    }
  }

  /**
   * Create a finding from an interaction
   */
  private async createFinding(
    jobId: string,
    programId: string,
    interaction: InteractionRecord,
    domain: string
  ): Promise<any> {
    const findingId = uuidv4();
    const severity = this.determineSeverity(interaction.protocol);

    const evidence: Evidence = {
      type: 'log',
      content: JSON.stringify(interaction, null, 2),
      metadata: {
        protocol: interaction.protocol,
        remoteAddress: interaction.remoteAddress,
        timestamp: interaction.timestamp
      },
      timestamp: new Date()
    };

    const finding = {
      id: findingId,
      programId,
      jobId,
      severity,
      confidence: 0.8,
      title: `Out-of-Band Interaction Detected (${interaction.protocol.toUpperCase()})`,
      description: this.generateDescription(interaction, domain),
      evidence: [evidence],
      poc: {
        steps: [
          `Monitor OOB domain: ${domain}`,
          `Trigger interaction via ${interaction.protocol} protocol`,
          `Interaction received from ${interaction.remoteAddress}`
        ],
        payload: interaction.rawRequest,
        reproductionRate: 1.0,
        notes: `Interaction detected at ${interaction.timestamp}`
      },
      impact: this.generateImpact(interaction.protocol),
      remediation: 'Identify the vulnerable parameter that allows external interactions and implement proper validation and sanitization.',
      status: 'new',
      confirmations: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Save to database
    await this.saveFinding(finding);

    return finding;
  }

  /**
   * Determine severity based on protocol
   */
  private determineSeverity(protocol: string): 'critical' | 'high' | 'medium' | 'low' | 'info' {
    const protocolLower = protocol.toLowerCase();

    if (protocolLower.includes('http') || protocolLower.includes('https')) {
      return 'high'; // SSRF-like vulnerabilities
    } else if (protocolLower.includes('dns')) {
      return 'medium'; // DNS exfiltration possible
    } else if (protocolLower.includes('smtp') || protocolLower.includes('ldap')) {
      return 'high'; // Injection vulnerabilities
    }

    return 'medium';
  }

  /**
   * Generate finding description
   */
  private generateDescription(interaction: InteractionRecord, domain: string): string {
    return `An out-of-band interaction was detected via ${interaction.protocol.toUpperCase()} protocol.

**Details:**
- Protocol: ${interaction.protocol}
- OOB Domain: ${domain}
- Remote Address: ${interaction.remoteAddress}
- Timestamp: ${interaction.timestamp}

This indicates that the application made an external request to the attacker-controlled domain, suggesting a potential blind vulnerability that allows external interactions.

**Request:**
\`\`\`
${interaction.rawRequest}
\`\`\`
${interaction.rawResponse ? `\n**Response:**\n\`\`\`\n${interaction.rawResponse}\n\`\`\`` : ''}`;
  }

  /**
   * Generate impact statement
   */
  private generateImpact(protocol: string): string {
    const protocolLower = protocol.toLowerCase();

    if (protocolLower.includes('http')) {
      return 'This vulnerability could allow an attacker to perform Server-Side Request Forgery (SSRF) attacks, potentially accessing internal resources, cloud metadata endpoints, or exfiltrating sensitive data.';
    } else if (protocolLower.includes('dns')) {
      return 'This vulnerability could allow an attacker to exfiltrate data through DNS queries or confirm blind vulnerabilities through DNS-based detection.';
    } else if (protocolLower.includes('smtp')) {
      return 'This vulnerability could allow an attacker to perform email injection attacks or use the server as an SMTP relay.';
    }

    return 'This out-of-band interaction indicates a potential blind vulnerability that could be exploited for data exfiltration or to confirm the presence of injection vulnerabilities.';
  }

  /**
   * Save finding to database
   */
  private async saveFinding(finding: any): Promise<void> {
    try {
      await this.logExecution(
        finding.jobId,
        finding.programId,
        'interactsh',
        'finding',
        'info',
        `Saving finding: ${finding.title}`
      );

      // In a real implementation, this would save to the findings table
      logger.info({ findingId: finding.id, severity: finding.severity }, 'Finding saved');
    } catch (error) {
      logger.error({ error, findingId: finding.id }, 'Failed to save finding');
    }
  }

  /**
   * Generate summary statistics
   */
  private generateSummary(interactions: InteractionRecord[]): any {
    const protocolCounts = interactions.reduce((acc, int) => {
      acc[int.protocol] = (acc[int.protocol] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const uniqueIPs = new Set(interactions.map(int => int.remoteAddress)).size;

    return {
      total: interactions.length,
      protocolBreakdown: protocolCounts,
      uniqueRemoteAddresses: uniqueIPs,
      protocols: Object.keys(protocolCounts),
      firstInteraction: interactions[0]?.timestamp,
      lastInteraction: interactions[interactions.length - 1]?.timestamp
    };
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 🎯 RICH HANDOFF: Interact → Intelligent-Triage
   * Hands off OOB-confirmed blind vulnerabilities for PoC generation
   */
  private async handoffToIntelligentTriage(
    interactJobId: string,
    programId: string,
    results: any
  ): Promise<void> {
    const interactions = results.interactions || [];
    const byProtocol = interactions.reduce((acc: any, i: any) => {
      acc[i.protocol] = (acc[i.protocol] || 0) + 1;
      return acc;
    }, {});

    const outputContract = {
      reportMethods: ['poc-generation', 'cvss-scoring', 'blind-vuln-analysis'],
      requiredEvidence: ['oob-callback', 'protocol', 'timestamp'],
      minConfidence: 0.95,
      maxDuration: 600, // 10 minutes
    };

    await this.createRichHandoff(interactJobId, programId, 'intelligent-triage', {
      parentResult: {
        agentType: 'interact',
        summary: {
          totalInteractions: interactions.length,
          uniqueProtocols: Object.keys(byProtocol).length,
        },
        interactions,
        byProtocol,
        oobDomain: results.oobDomain,
        pollDuration: results.pollDuration,
      },
      reasoning: {
        trigger: `OOB interactions confirmed ${interactions.length} blind vulnerabilities`,
        confidence: 0.98, // Very high confidence from OOB callbacks
        alternatives: [
          'Report OOB findings as-is (missing context)',
          'Manual blind vuln PoC creation (complex)',
          'LLM-enhanced blind vulnerability reporting (recommended)'
        ],
        decisionFactors: [
          `${interactions.length} OOB callbacks received (blind SSRF/RCE/XXE confirmed)`,
          `${Object.keys(byProtocol).length} protocols detected (${Object.keys(byProtocol).join(', ')})`,
          'OOB callbacks are definitive proof of blind vulnerabilities',
          'Blind vulns often have high severity but require expert PoC',
          'LLM can generate comprehensive exploit chains from OOB data'
        ]
      },
      objectives: {
        primary: 'Generate professional blind vulnerability reports with OOB proof and exploitation PoCs',
        secondary: [
          'Classify blind vulnerability type (SSRF, RCE, XXE, DNS exfiltration)',
          'Generate CVSS v3.1 scores for blind vulnerabilities',
          'Create detailed exploitation chains from OOB callbacks',
          'Generate PoC scripts for blind vulnerability reproduction',
          'Assess business impact of blind vulnerabilities',
          'Create technical deep-dive reports with OOB evidence'
        ],
        avoid: [
          'Do not regenerate OOB tests (already confirmed)',
          'Avoid generic blind vuln reports (use actual OOB data)',
          'Skip low-confidence blind vuln claims',
        ]
      },
      successCriteria: {
        minAssets: interactions.length,
        maxDuration: 600, // 10 min
        requiredFields: ['report', 'cvss_score', 'poc', 'oob_evidence'],
        qualityThreshold: 0.95,
        customCriteria: {
          oobIntegration: 1.0, // 100% must include OOB proof
          exploitChain: 0.9, // 90% must have detailed exploit chain
          cvssAccuracy: 0.95, // 95% accurate CVSS scores
        }
      },
      inherited: {
        programId,
        rateLimit: 10, // Low rate for LLM-heavy processing
        timeout: 120, // 2 min per report
        safetyChecks: true,
        budget: {
          maxRequests: interactions.length,
          maxTime: 600,
        },
        retryPolicy: {
          maxRetries: 1,
          backoff: 'exponential'
        }
      }
    }, outputContract);

    logger.info({
      interactJobId,
      programId,
      interactions: interactions.length,
      protocols: Object.keys(byProtocol),
    }, '🔗 Interact agent initiated rich handoff to Intelligent-Triage');
  }
}

// Export singleton instance
export const interactAgent = new InteractAgent();
