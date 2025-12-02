import axios from 'axios';
import logger from '../../utils/logger';

/**
 * HackerOne API Integration
 * Syncs programs, assets, and submissions
 */
class HackerOneIntegration {
  private username: string;
  private token: string;
  private apiUrl = 'https://api.hackerone.com/v1';

  constructor(username: string, token: string) {
    this.username = username;
    this.token = token;
  }

  /**
   * Get all programs
   */
  async getPrograms(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.apiUrl}/hackers/programs`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.token}`).toString('base64')}`,
        },
      });

      return response.data.data || [];
    } catch (error) {
      logger.error({ error }, 'Failed to fetch HackerOne programs');
      throw error;
    }
  }

  /**
   * Get program scope
   */
  async getProgramScope(handle: string): Promise<any> {
    try {
      const response = await axios.get(`${this.apiUrl}/hackers/programs/${handle}`, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.username}:${this.token}`).toString('base64')}`,
        },
      });

      return response.data.data.attributes.structured_scope_versions[0] || {};
    } catch (error) {
      logger.error({ error, handle }, 'Failed to fetch program scope');
      throw error;
    }
  }

  /**
   * Submit report
   */
  async submitReport(programId: string, report: any): Promise<any> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/hackers/reports`,
        {
          data: {
            type: 'report',
            attributes: report,
          },
        },
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.username}:${this.token}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error({ error }, 'Failed to submit HackerOne report');
      throw error;
    }
  }
}

export default HackerOneIntegration;
