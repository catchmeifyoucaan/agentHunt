import { Job } from 'bullmq';
import { BaseAgent } from './base';
import config from '../config';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';

/**
 * API Fuzzing Agent
 * Fuzzes REST/GraphQL APIs for vulnerabilities
 */
export class ApiFuzzAgent extends BaseAgent<any> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('scanner');
  }

  getSteps(): { name: string; metadata?: any }[] {
    return [
      { name: 'Identify API endpoints and type (REST/GraphQL)' },
      { name: 'Select appropriate fuzzing templates' },
      { name: 'Execute Nuclei fuzzing with high concurrency' },
      { name: 'Analyze fuzzing results for vulnerabilities' },
      { name: 'Report findings with endpoint details' },
    ];
  }

  async process(job: Job<any>): Promise<any> {
    const { programId, options } = job.data;
    const { endpoints, type = 'rest' } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Use Nuclei fuzzing templates
      const templates =
        type === 'graphql'
          ? `${config.tools.nucleiTemplates}/http/fuzzing/graphql-fuzzing.yaml`
          : `${config.tools.nucleiTemplates}/http/fuzzing/`;

      const command = `${config.tools.nuclei} -target ${endpoints.join(',')} -t ${templates} -concurrency 500 -jsonl`;

      const result = await this.executeCommand(command);

      // Parse findings from Nuclei output
      const findings = result.stdout ? this.parseJsonLines(result.stdout) : [];

      // 🚀 THREE-AGENT INTEGRATION: Write API fuzzing findings to shared memory
      const swarmData = job.data as any;
      const { swarmId, enableSharedMemory } = swarmData;

      if (swarmId && enableSharedMemory && findings.length > 0) {
        try {
          const apiFuzzFindings = findings.map((f: any) => ({
            id: uuidv4(),
            type: `api-fuzz-${f.info?.name || 'generic'}`,
            severity: f.info?.severity || 'medium',
            url: f.matched_at || f.host,
            evidence: f.extracted_results || f.matcher_name,
            confidence: 0.8,
            timestamp: new Date(),
            discoveredBy: `apifuzz-${job.id}`,
            metadata: {
              apiType: type,
              endpoint: f.host,
              template: f['template-id'],
            },
          }));

          await sharedMemory.storeFindings(swarmId, apiFuzzFindings);

          await sharedMemory.shareSuccess(swarmId, {
            id: uuidv4(),
            name: `apifuzz-${type}`,
            description: `API fuzzing found ${findings.length} vulnerabilities in ${type} endpoints`,
            successRate: 0.8,
            metadata: { apiType: type, findings: findings.length, source: 'apifuzz-agent' },
          });

          logger.info(
            {
              swarmId,
              apiFuzzFindings: findings.length,
              apiType: type,
            },
            '🔗 API Fuzz agent shared findings with swarm'
          );
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share API fuzz findings');
        }
      }

      // 🎯 RICH HANDOFF: Send high-confidence API fuzzing findings to Confirm agent
      const highConfidenceAPI = findings.filter((f: any) => {
        const severity = f.info?.severity?.toLowerCase();
        const name = f.info?.name?.toLowerCase() || '';
        const tags = f.info?.tags || [];

        // High-impact API vulnerabilities
        return (
          (severity === 'high' || severity === 'critical') &&
          (name.includes('auth') ||
            name.includes('bypass') ||
            name.includes('injection') ||
            name.includes('idor') ||
            name.includes('graphql') ||
            name.includes('ssrf') ||
            tags.includes('auth-bypass') ||
            tags.includes('idor') ||
            tags.includes('injection'))
        );
      });

      if (highConfidenceAPI.length > 0) {
        await this.handoffToConfirm(job.id!, programId, highConfidenceAPI, findings, type);
      }

      await this.updateJobStatus(job.id!, 'completed', {
        endpointsTested: endpoints.length,
        vulnerabilitiesFound: findings.length,
      });

      return { success: true, findings };
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * 🎯 RICH HANDOFF: API Fuzzing → Confirm
   * Hands off high-confidence API vulnerabilities for multi-method validation
   */
  private async handoffToConfirm(
    apifuzzJobId: string,
    programId: string,
    vulnerabilities: any[],
    allFindings: any[],
    apiType: string
  ): Promise<void> {
    const uniqueEndpoints = new Set(vulnerabilities.map((v) => v.matched_at || v.host));
    const uniqueVulnTypes = new Set(vulnerabilities.map((v) => v.info?.name || 'unknown'));

    // Categorize by vulnerability type
    const byType = {
      authBypass: vulnerabilities.filter((v) => {
        const name = v.info?.name?.toLowerCase() || '';
        return name.includes('auth') || name.includes('bypass');
      }).length,
      idor: vulnerabilities.filter((v) => {
        const name = v.info?.name?.toLowerCase() || '';
        return name.includes('idor') || name.includes('bola');
      }).length,
      injection: vulnerabilities.filter((v) => {
        const name = v.info?.name?.toLowerCase() || '';
        const tags = v.info?.tags || [];
        return (
          name.includes('injection') ||
          name.includes('sqli') ||
          name.includes('nosql') ||
          tags.includes('injection')
        );
      }).length,
      graphql: vulnerabilities.filter((v) => {
        const name = v.info?.name?.toLowerCase() || '';
        return name.includes('graphql') || name.includes('introspection');
      }).length,
      ssrf: vulnerabilities.filter((v) => {
        const name = v.info?.name?.toLowerCase() || '';
        return name.includes('ssrf');
      }).length,
    };

    // Calculate average severity score
    const severityScore =
      vulnerabilities.reduce((acc, v) => {
        const severity = v.info?.severity?.toLowerCase();
        if (severity === 'critical') return acc + 4;
        if (severity === 'high') return acc + 3;
        if (severity === 'medium') return acc + 2;
        return acc + 1;
      }, 0) / vulnerabilities.length;

    const outputContract = {
      confirmationMethods: ['retry', 'auth-test', 'replay', 'mutation'],
      requiredEvidence: ['http-response', 'status-code', 'response-diff'],
      minConfidence: 0.8,
      maxRetries: 3,
    };

    await this.createRichHandoff(
      apifuzzJobId,
      programId,
      'confirm',
      {
        parentResult: {
          agentType: 'apifuzz',
          apiType,
          summary: {
            totalFindings: allFindings.length,
            highConfidenceVulns: vulnerabilities.length,
            uniqueEndpoints: uniqueEndpoints.size,
            uniqueVulnTypes: uniqueVulnTypes.size,
          },
          vulnerabilities,
          byType,
          severityScore,
          templates: Array.from(new Set(vulnerabilities.map((v) => v['template-id']))),
          detectionMethod: 'nuclei-api-fuzzing',
        },
        reasoning: {
          trigger: `Found ${vulnerabilities.length} high-severity API vulnerabilities across ${uniqueEndpoints.size} endpoints`,
          confidence: Math.min(0.95, 0.7 + severityScore / 10),
          alternatives: [
            'Skip confirmation and report as-is (high false-positive risk)',
            'Manual validation (slower but thorough)',
            'Automated multi-method confirmation (recommended)',
          ],
          decisionFactors: [
            `${byType.authBypass} authentication bypass findings require validation`,
            `${byType.idor} IDOR/BOLA findings need access control testing`,
            `${byType.injection} injection vulnerabilities detected`,
            apiType === 'graphql'
              ? 'GraphQL-specific validation needed'
              : 'REST API confirmation required',
            `Average severity score: ${severityScore.toFixed(2)}/4.0`,
          ],
        },
        objectives: {
          primary: `Multi-method confirmation of ${apiType.toUpperCase()} API vulnerabilities with exploit validation`,
          secondary: [
            'Validate authentication bypass with credential testing',
            'Confirm IDOR/BOLA with object reference manipulation',
            'Test injection points with safe payloads',
            apiType === 'graphql'
              ? 'Validate GraphQL introspection and mutation abuse'
              : 'Confirm REST parameter pollution',
            'Verify rate limiting and WAF bypass techniques',
            'Generate API-specific PoC (curl, Postman, Python)',
          ],
          avoid: [
            'Do not perform destructive mutations on production data',
            'Avoid triggering account lockouts with auth bypass tests',
            'Skip excessive retries that may trigger rate limiting',
            'Do not enumerate all objects for IDOR (sample 3-5 IDs max)',
          ],
        },
        successCriteria: {
          minAssets: vulnerabilities.length,
          maxDuration: 600, // 10 min for API confirmation
          requiredFields: [
            'url',
            'method',
            'vulnerability_type',
            'confirmation_status',
            'exploit_proof',
          ],
          qualityThreshold: 0.8,
          customCriteria: {
            confirmationRate: 0.6, // 60%+ must confirm
            evidenceTypes: ['response-diff', 'status-code', 'auth-state'],
            pocFormats: ['curl', 'http-raw'],
          },
        },
        inherited: {
          programId,
          rateLimit: byType.authBypass > 0 ? 10 : 30, // Conservative for auth bypass
          timeout: 30,
          safetyChecks: true,
          budget: {
            maxRequests: vulnerabilities.length * 5, // 5 confirmation attempts per vuln
            maxTime: 600,
          },
          retryPolicy: {
            maxRetries: 2,
            backoff: 'exponential',
          },
        },
      },
      outputContract
    );

    logger.info(
      {
        apifuzzJobId,
        programId,
        apiType,
        vulnerabilities: vulnerabilities.length,
        endpoints: uniqueEndpoints.size,
        byType,
      },
      '🔗 API Fuzzing agent initiated rich handoff to Confirm'
    );
  }
}
