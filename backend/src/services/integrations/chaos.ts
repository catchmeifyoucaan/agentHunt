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
  private dnsApiUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.projectdiscovery.io') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.dnsApiUrl = 'https://dns.projectdiscovery.io';
  }

  async getPrograms(): Promise<ChaosProgram[]> {
    try {
      logger.info('Fetching programs from Chaos DB (GitHub)');

      // Fetch from public GitHub repository (no auth required)
      const response = await axios.get(
        'https://raw.githubusercontent.com/projectdiscovery/public-bugbounty-programs/main/chaos-bugbounty-list.json'
      );

      const data = response.data;
      const programs = data.programs || [];

      // Transform to our format
      return programs.map((p: any) => ({
        name: p.name,
        url: p.url,
        bounty: p.bounty || false,
        swag: p.swag || false,
        domains: p.domains || [],
      }));
    } catch (error: any) {
      logger.error({
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
      }, 'Failed to fetch Chaos programs');
      throw new Error(`Chaos API error (${error.response?.status || 'unknown'}): ${error.message}`);
    }
  }

  async getProgramAssets(programName: string): Promise<string[]> {
    try {
      logger.info({ program: programName }, 'Fetching assets from Chaos DB');

      // First, get the program's domains from the public list
      const programs = await this.getPrograms();
      const program = programs.find(
        (p) => p.name.toLowerCase() === programName.toLowerCase()
      );

      if (!program || !program.domains || program.domains.length === 0) {
        logger.warn({ programName }, 'Program not found or has no domains');
        return [];
      }

      // Fetch subdomains for each domain using the DNS API
      const allSubdomains: string[] = [];

      for (const domain of program.domains) {
        try {
          const response = await axios.get(
            `${this.dnsApiUrl}/dns/${domain}/subdomains`,
            {
              headers: {
                Authorization: this.apiKey,
                Connection: 'close',
              },
            }
          );

          const subdomains = response.data.subdomains || [];
          allSubdomains.push(...subdomains);
        } catch (domainError: any) {
          // Log but don't fail - some domains might not have data
          logger.warn({
            domain,
            error: domainError.message,
            status: domainError.response?.status,
          }, 'Failed to fetch subdomains for domain');
        }
      }

      // Include the main domains too
      allSubdomains.unshift(...program.domains);

      return [...new Set(allSubdomains)]; // Remove duplicates
    } catch (error: any) {
      logger.error({
        error: error.message,
        status: error.response?.status,
        data: error.response?.data,
        program: programName,
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
