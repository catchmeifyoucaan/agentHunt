import { Job } from 'bullmq';
import { BaseAgent } from './base';
import config from '../config';

/**
 * API Fuzzing Agent
 * Fuzzes REST/GraphQL APIs for vulnerabilities
 */
export class ApiFuzzAgent extends BaseAgent<any> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('scanner');
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

      const command = `${config.tools.nuclei} -target ${endpoints.join(',')} -t ${templates} -concurrency 500 -json`;

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
