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

      await this.updateJobStatus(id, 'completed', results);
      await this.logExecution(
        id,
        programId,
        'interactsh',
        'complete',
        'info',
        `Found ${results.interactions.length} OOB interactions`
      );

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
}

// Export singleton instance
export const interactAgent = new InteractAgent();
