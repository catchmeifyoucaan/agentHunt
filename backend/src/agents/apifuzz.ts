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
      { name: 'Report findings with endpoint details' }
    ];
  }

  async process(job: Job<any>): Promise<any> {
    const { programId, options } = job.data;
    const { endpoints, type = 'rest' } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Use Nuclei fuzzing templates
      const templates = type === 'graphql'
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

          logger.info({
            swarmId,
            apiFuzzFindings: findings.length,
            apiType: type,
          }, '🔗 API Fuzz agent shared findings with swarm');
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share API fuzz findings');
        }
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
}
