import axios from 'axios';
import logger from '../utils/logger';

/**
 * Bugcrowd API Integration
 * Syncs programs, assets, and submissions
 */
class BugcrowdIntegration {
  private apiKey: string;
  private apiUrl = 'https://api.bugcrowd.com';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Get all programs
   */
  async getPrograms(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.apiUrl}/programs`, {
        headers: {
          Authorization: `Token ${this.apiKey}`,
          Accept: 'application/vnd.bugcrowd.v4+json',
        },
      });

      return response.data.programs || [];
    } catch (error) {
      logger.error({ error }, 'Failed to fetch Bugcrowd programs');
      throw error;
    }
  }

  /**
   * Get program targets
   */
  async getProgramTargets(programCode: string): Promise<any[]> {
    try {
      const response = await axios.get(`${this.apiUrl}/programs/${programCode}/targets`, {
        headers: {
          Authorization: `Token ${this.apiKey}`,
          Accept: 'application/vnd.bugcrowd.v4+json',
        },
      });

      return response.data.targets || [];
    } catch (error) {
      logger.error({ error, programCode }, 'Failed to fetch program targets');
      throw error;
    }
  }

  /**
   * Submit submission
   */
  async submitSubmission(programCode: string, submission: any): Promise<any> {
    try {
      const response = await axios.post(
        `${this.apiUrl}/submissions`,
        {
          target_code: programCode,
          ...submission,
        },
        {
          headers: {
            Authorization: `Token ${this.apiKey}`,
            Accept: 'application/vnd.bugcrowd.v4+json',
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error({ error }, 'Failed to submit Bugcrowd submission');
      throw error;
    }
  }
}

export default BugcrowdIntegration;
