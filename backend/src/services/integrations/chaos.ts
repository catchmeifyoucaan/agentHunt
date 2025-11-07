import axios from 'axios';
import logger from '../../utils/logger';

interface ChaosProgram {
  name: string;
  url?: string;
  bounty?: boolean;
  swag?: boolean;
  domains?: string[];
  subdomains?: string[];
}

class ChaosIntegration {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://chaos.projectdiscovery.io') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }

  async getPrograms(): Promise<ChaosProgram[]> {
    try {
      logger.info('Fetching programs from Chaos DB');

      const response = await axios.get(`${this.baseUrl}/api/v1/programs`, {
        headers: {
          'Authorization': this.apiKey,
        },
      });

      return response.data.programs || [];
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch Chaos programs');
      throw new Error(`Chaos API error: ${error.message}`);
    }
  }

  async getProgramAssets(programName: string): Promise<string[]> {
    try {
      logger.info({ program: programName }, 'Fetching assets from Chaos DB');

      const response = await axios.get(`${this.baseUrl}/api/v1/program/${programName}`, {
        headers: {
          'Authorization': this.apiKey,
        },
      });

      const domains = response.data.domains || [];
      const subdomains = response.data.subdomains || [];

      return [...domains, ...subdomains];
    } catch (error: any) {
      logger.error({ error: error.message, program: programName }, 'Failed to fetch Chaos assets');
      throw new Error(`Chaos API error: ${error.message}`);
    }
  }

  async searchProgram(query: string): Promise<ChaosProgram[]> {
    try {
      const allPrograms = await this.getPrograms();
      return allPrograms.filter((p) =>
        p.name.toLowerCase().includes(query.toLowerCase())
      );
    } catch (error: any) {
      logger.error({ error: error.message, query }, 'Failed to search Chaos programs');
      throw error;
    }
  }
}

export default ChaosIntegration;
