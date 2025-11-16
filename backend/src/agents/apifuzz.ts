import { Job } from 'bullmq';
import { BaseAgent } from './base';
import config from '../config';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';

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

      await this.updateJobStatus(job.id!, 'completed', {
        endpointsTested: endpoints.length,
      });

      return { success: true };
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }
}
