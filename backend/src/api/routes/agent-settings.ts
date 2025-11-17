import { Router } from 'express';
import agentSettingsService from '../../services/agent-settings';
import { AgentType } from '../../../../shared/agent-collaboration.types';
import logger from '../../utils/logger';

const router = Router();

/**
 * Get all agent settings
 */
router.get('/', async (req, res) => {
  try {
    const settings = await agentSettingsService.getAllSettings();
    res.json({ settings });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get all agent settings');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get settings for a specific agent type
 */
router.get('/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const settings = await agentSettingsService.getSettings(agentType as AgentType);

    if (!settings) {
      return res.status(404).json({ error: `Settings for agent type ${agentType} not found` });
    }

    res.json({ settings });
  } catch (error: any) {
    logger.error({ error, agentType: req.params.agentType }, 'Failed to get agent settings');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Update settings for a specific agent type
 */
router.post('/:agentType', async (req, res) => {
  try {
    const { agentType } = req.params;
    const newSettings = req.body;

    if (!newSettings || Object.keys(newSettings).length === 0) {
      return res.status(400).json({ error: 'Request body cannot be empty' });
    }

    const updatedSettings = await agentSettingsService.updateSettings(agentType as AgentType, newSettings);
    res.json({ settings: updatedSettings });
  } catch (error: any) {
    logger.error({ error, agentType: req.params.agentType }, 'Failed to update agent settings');
    res.status(500).json({ error: error.message });
  }
});

export default router;
