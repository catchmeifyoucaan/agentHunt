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

      const response = await axios.get(`${this.baseUrl}/api/v1/bbp`, {
        headers: {
          'Authorization': this.apiKey,
        },
      });

      return response.data || [];
    } catch (error: any) {
      logger.error({
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        endpoint: `${this.baseUrl}/api/v1/bbp`
      }, 'Failed to fetch Chaos programs');
      throw new Error(`Chaos API error (${error.response?.status || 'unknown'}): ${error.message}`);
    }
  }

  async getProgramAssets(programName: string): Promise<string[]> {
    try {
      logger.info({ program: programName }, 'Fetching assets from Chaos DB');

      const response = await axios.get(`${this.baseUrl}/api/v1/bbp/${programName}`, {
        headers: {
          'Authorization': this.apiKey,
        },
      });

      const domains = response.data.domains || [];
      const subdomains = response.data.subdomains || [];

      return [...domains, ...subdomains];
    } catch (error: any) {
      logger.error({
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        program: programName,
        endpoint: `${this.baseUrl}/api/v1/bbp/${programName}`
      }, 'Failed to fetch Chaos assets');
      throw new Error(`Chaos API error (${error.response?.status || 'unknown'}): ${error.message}`);
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
