import database from './database';
import logger from '../utils/logger';
import { AgentType } from '../../../shared/agent-collaboration.types';

interface AgentSettings {
  agentType: AgentType;
  settings: Record<string, any>;
}

class AgentSettingsService {
  /**
   * Retrieves settings for a specific agent type.
   */
  async getSettings(agentType: AgentType): Promise<AgentSettings | null> {
    try {
      const result = await database.query(
        `SELECT agent_type, settings FROM agent_settings WHERE agent_type = $1`,
        [agentType]
      );

      if (result.rows.length === 0) {
        return null;
      }

      return {
        agentType: result.rows[0].agent_type,
        settings: result.rows[0].settings,
      };
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to retrieve agent settings');
      throw error;
    }
  }

  /**
   * Updates settings for a specific agent type.
   * If settings for the agent type do not exist, they will be created.
   */
  async updateSettings(agentType: AgentType, newSettings: Record<string, any>): Promise<AgentSettings> {
    try {
      const result = await database.query(
        `INSERT INTO agent_settings (agent_type, settings)
         VALUES ($1, $2)
         ON CONFLICT (agent_type) DO UPDATE SET settings = EXCLUDED.settings, updated_at = CURRENT_TIMESTAMP
         RETURNING agent_type, settings`,
        [agentType, newSettings]
      );

      logger.info({ agentType }, 'Agent settings updated');
      return {
        agentType: result.rows[0].agent_type,
        settings: result.rows[0].settings,
      };
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to update agent settings');
      throw error;
    }
  }

  /**
   * Retrieves all agent settings.
   */
  async getAllSettings(): Promise<AgentSettings[]> {
    try {
      const result = await database.query(`SELECT agent_type, settings FROM agent_settings`);
      return result.rows.map((row: any) => ({
        agentType: row.agent_type,
        settings: row.settings,
      }));
    } catch (error: any) {
      logger.error({ error }, 'Failed to retrieve all agent settings');
      throw error;
    }
  }
}

export default new AgentSettingsService();