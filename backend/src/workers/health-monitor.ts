/**
 * Health Monitoring Worker
 * Periodically checks the health of all agent instances
 * and triggers self-healing actions when needed.
 */

import { parentPort } from 'worker_threads';
import logger from '../utils/logger';
import agentHealth from '../services/agent-health';
import database from '../services/database';
import { managerAgent } from '../agents/manager';

const CHECK_INTERVAL = 60000; // 1 minute

async function checkAllAgentsHealth() {
  logger.info('Running periodic health check for all agents...');

  try {
    const result = await database.query('SELECT agent_type, instance_id, program_id FROM agent_health');
    const agents = result.rows;

    for (const agent of agents) {
      const health = await agentHealth.getHealth(agent.agent_type, agent.instance_id, agent.program_id);

      if (!health) continue;

      const status = health.status;

      if (status === 'unhealthy' || status === 'offline') {
        logger.warn(
          { agentType: agent.agent_type, instanceId: agent.instance_id, programId: agent.program_id, status },
          'Unhealthy agent detected, notifying Manager Agent for restart.'
        );

        // Notify Manager Agent to restart the unhealthy agent
        try {
          await managerAgent.processCommand(
            `restart worker for agent ${agent.agent_type} in program ${agent.program_id}`,
            'system-health-monitor'
          );
        } catch (error) {
          logger.error(
            { error, agentType: agent.agent_type, programId: agent.program_id },
            'Failed to request agent restart from Manager Agent.'
          );
        }
      }

      // Check for high failure rate and trigger recovery
      if (health.metrics.errorRate > 25) { // 25% error rate
        logger.warn(
          { agentType: agent.agent_type, programId: agent.program_id, errorRate: health.metrics.errorRate },
          'High error rate detected, triggering automated recovery.'
        );
        try {
          await managerAgent.processCommand(
            `start recovery for program ${agent.program_id}`,
            'system-health-monitor'
          );
        } catch (error) {
          logger.error(
            { error, agentType: agent.agent_type, programId: agent.program_id },
            'Failed to trigger automated recovery.'
          );
        }
      }
    }
  } catch (error) {
    logger.error({ error }, 'Failed to run periodic health check');
  }
}

function start() {
  logger.info('Starting health monitoring worker...');
  setInterval(checkAllAgentsHealth, CHECK_INTERVAL);
  checkAllAgentsHealth(); // Run once on startup
}

start();
