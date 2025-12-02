/**
 * Agent Message Consumer Worker
 * Background process that subscribes to agent inbox channels and processes messages.
 * Provides resilience via DB replay for missed messages and exposes metrics.
 */

import logger from '../utils/logger';
import database from '../services/database';
import agentCoordination from '../services/agent-coordination';
import { AgentMessage } from '../../../shared/agent-collaboration.types';

// Metrics for monitoring
interface MessageMetrics {
  received: number;
  processed: number;
  failed: number;
  replayed: number;
  lastProcessedAt: Date | null;
}

const metrics: Record<string, MessageMetrics> = {};

/**
 * Initialize metrics for an agent type
 */
function initMetrics(agentType: string): void {
  if (!metrics[agentType]) {
    metrics[agentType] = {
      received: 0,
      processed: 0,
      failed: 0,
      replayed: 0,
      lastProcessedAt: null,
    };
  }
}

/**
 * Get current metrics for all agent types
 */
export function getMessageMetrics(): Record<string, MessageMetrics> {
  return { ...metrics };
}

/**
 * Process a single message with error handling
 */
async function processMessage(
  agentType: string,
  message: AgentMessage,
  handler: (msg: AgentMessage) => Promise<void>
): Promise<boolean> {
  initMetrics(agentType);
  metrics[agentType].received++;

  try {
    await handler(message);
    await agentCoordination.markAsProcessed(message.id);
    metrics[agentType].processed++;
    metrics[agentType].lastProcessedAt = new Date();
    return true;
  } catch (error: any) {
    logger.error(
      { error, messageId: message.id, agentType, messageType: message.type },
      'Failed to process agent message'
    );
    metrics[agentType].failed++;
    return false;
  }
}

/**
 * Replay unprocessed messages from database
 * Called on startup and periodically to catch any missed messages
 */
async function replayUnprocessedMessages(
  agentType: string,
  handler: (msg: AgentMessage) => Promise<void>
): Promise<number> {
  initMetrics(agentType);

  try {
    const messages = await agentCoordination.receiveMessages(agentType, 100);

    if (messages.length === 0) {
      return 0;
    }

    logger.info(
      { agentType, count: messages.length },
      'Replaying unprocessed messages from database'
    );

    let replayedCount = 0;
    for (const message of messages) {
      const success = await processMessage(agentType, message, handler);
      if (success) {
        replayedCount++;
        metrics[agentType].replayed++;
      }
    }

    return replayedCount;
  } catch (error: any) {
    logger.error({ error, agentType }, 'Failed to replay unprocessed messages');
    return 0;
  }
}

/**
 * Message handler registry
 */
const messageHandlers: Map<string, (msg: AgentMessage) => Promise<void>> = new Map();

/**
 * Register a message handler for an agent type
 */
export function registerMessageHandler(
  agentType: string,
  handler: (msg: AgentMessage) => Promise<void>
): void {
  messageHandlers.set(agentType, handler);
  logger.info({ agentType }, 'Registered message handler');
}

/**
 * Start the message consumer for all registered handlers
 */
export async function startMessageConsumer(): Promise<void> {
  logger.info('Starting agent message consumer...');

  // Subscribe to real-time messages for each registered handler
  for (const [agentType, handler] of messageHandlers.entries()) {
    try {
      await agentCoordination.subscribeToMessages(agentType, async (message) => {
        await processMessage(agentType, message, handler);
      });

      // Replay any unprocessed messages on startup
      const replayed = await replayUnprocessedMessages(agentType, handler);
      if (replayed > 0) {
        logger.info({ agentType, replayed }, 'Replayed unprocessed messages on startup');
      }
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to start message consumer for agent type');
    }
  }

  // Periodic replay to catch any missed messages (every 60 seconds)
  setInterval(async () => {
    for (const [agentType, handler] of messageHandlers.entries()) {
      try {
        await replayUnprocessedMessages(agentType, handler);
      } catch (error: any) {
        logger.error({ error, agentType }, 'Periodic message replay failed');
      }
    }
  }, 60000);

  // Periodic cleanup of expired messages (every 5 minutes)
  setInterval(async () => {
    try {
      const cleaned = await agentCoordination.cleanupExpiredMessages();
      if (cleaned > 0) {
        logger.info({ cleaned }, 'Cleaned up expired agent messages');
      }
    } catch (error: any) {
      logger.error({ error }, 'Failed to cleanup expired messages');
    }
  }, 300000);

  logger.info(
    { handlerCount: messageHandlers.size },
    'Agent message consumer started'
  );
}

/**
 * Default message handlers for core agent types
 */
export function registerDefaultHandlers(): void {
  // Scanner agent handler
  registerMessageHandler('scanner', async (message) => {
    logger.info({ messageType: message.type, from: message.from.type }, 'Scanner processing message');

    if (message.type === 'query') {
      try {
        const findings = await database.query(
          `SELECT f.* FROM findings f
           JOIN jobs j ON f.job_id = j.id
           WHERE j.type = 'scanner'
           AND f.created_at > NOW() - INTERVAL '1 hour'
           ORDER BY f.created_at DESC
           LIMIT 10`
        );

        await agentCoordination.replyToMessage(
          message.id,
          {
            type: 'scanner',
            instanceId: 'scanner-consumer',
            capabilities: ['scan', 'nuclei'],
            currentLoad: 0,
            version: '1.0',
          },
          {
            response: `Found ${findings.rows.length} recent scan findings`,
            data: findings.rows.map((r: any) => ({
              title: r.title,
              severity: r.severity,
              url: r.url,
            })),
          }
        );
      } catch (error: any) {
        logger.error({ error }, 'Scanner query handler failed');
        throw error;
      }
    }
  });

  // Triage agent handler
  registerMessageHandler('triage', async (message) => {
    logger.info({ messageType: message.type, from: message.from.type }, 'Triage processing message');

    if (message.type === 'query') {
      try {
        const query = message.payload?.query || '';

        // Search knowledge base for similar findings
        const knowledgeStore = require('../services/knowledge/knowledge-store').default;
        const similarFindings = await knowledgeStore.search({
          query,
          limit: 5,
          minSimilarity: 0.7,
        });

        await agentCoordination.replyToMessage(
          message.id,
          {
            type: 'triage',
            instanceId: 'triage-consumer',
            capabilities: ['triage', 'analysis'],
            currentLoad: 0,
            version: '1.0',
          },
          {
            response: `Found ${similarFindings.length} similar findings in knowledge base`,
            data: similarFindings.map((f: any) => ({
              title: f.content?.title || 'Unknown',
              severity: f.content?.severity || 'unknown',
              similarity: f.similarityScore,
            })),
          }
        );
      } catch (error: any) {
        logger.error({ error }, 'Triage query handler failed');
        throw error;
      }
    }
  });

  // Manager agent handler for approval requests
  registerMessageHandler('manager', async (message) => {
    logger.info({ messageType: message.type, from: message.from.type }, 'Manager processing message');

    if (message.type === 'approval_request') {
      // Log approval request for manual review
      logger.warn(
        {
          from: message.from.type,
          action: message.payload?.action,
          reason: message.payload?.reason,
        },
        'Approval request received - requires manual review'
      );

      // Store in database for dashboard visibility
      try {
        await database.query(
          `INSERT INTO approval_requests (id, from_agent, action, reason, data, status, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO NOTHING`,
          [
            message.id,
            message.from.type,
            message.payload?.action,
            message.payload?.reason,
            JSON.stringify(message.payload?.data || {}),
          ]
        );
      } catch (error: any) {
        // Table might not exist yet - log but don't fail
        logger.debug({ error }, 'Failed to store approval request (table may not exist)');
      }
    }
  });

  logger.info('Registered default message handlers for scanner, triage, manager');
}

export default {
  startMessageConsumer,
  registerMessageHandler,
  registerDefaultHandlers,
  getMessageMetrics,
};
