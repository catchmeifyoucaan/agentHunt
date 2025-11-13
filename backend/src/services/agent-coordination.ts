/**
 * Agent Coordination Service
 * Enables agent-to-agent communication and collaboration
 * Inspired by Claude Code's Task delegation pattern
 */

import database from './database';
import logger from '../utils/logger';
import redis from './redis';
import { AgentMessage, AgentIdentity, MessageType } from '../../../shared/agent-collaboration.types';
import { v4 as uuidv4 } from 'uuid';

class AgentCoordinationService {
  private messageHandlers: Map<MessageType, (message: AgentMessage) => Promise<void>> = new Map();

  /**
   * Send a message from one agent to another
   */
  async sendMessage(message: Omit<AgentMessage, 'id' | 'createdAt'>): Promise<string> {
    const fullMessage: AgentMessage = {
      ...message,
      id: uuidv4(),
      createdAt: new Date()
    };

    try {
      // Store in database
      await database.query(
        `INSERT INTO agent_messages (id, type, from_agent_type, from_agent_instance, to_agent_type, to_agent_instance, payload, reply_to, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          fullMessage.id,
          fullMessage.type,
          fullMessage.from.type,
          fullMessage.from.instanceId,
          fullMessage.to.type,
          fullMessage.to.instanceId || null,
          fullMessage.payload,
          fullMessage.replyTo || null,
          fullMessage.expiresAt || null,
          fullMessage.createdAt
        ]
      );

      // Publish to Redis for real-time delivery
      await redis.publish(
        `agent:${fullMessage.to.type}:inbox`,
        JSON.stringify(fullMessage)
      );

      logger.debug(
        {
          messageId: fullMessage.id,
          from: fullMessage.from.type,
          to: fullMessage.to.type,
          type: fullMessage.type
        },
        'Agent message sent'
      );

      return fullMessage.id;
    } catch (error: any) {
      logger.error({ error, message }, 'Failed to send agent message');
      throw error;
    }
  }

  /**
   * Query another agent and wait for response
   */
  async queryAgent(
    from: AgentIdentity,
    toType: string,
    query: string,
    timeoutMs: number = 5000
  ): Promise<any> {
    const messageId = await this.sendMessage({
      type: 'query',
      from,
      to: {
        type: toType as any,
        instanceId: 'any',
        capabilities: [],
        currentLoad: 0,
        version: '1.0'
      },
      payload: { query },
      replyTo: uuidv4()
    });

    // Wait for response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Query timeout: No response from ${toType} agent`));
      }, timeoutMs);

      // Subscribe to response
      this.subscribeToReplies(from.type, async (message) => {
        if (message.replyTo === messageId) {
          clearTimeout(timeout);
          await this.markAsRead(message.id);
          resolve(message.payload);
        }
      });
    });
  }

  /**
   * Receive unread messages for an agent
   */
  async receiveMessages(agentType: string, limit: number = 10): Promise<AgentMessage[]> {
    try {
      const result = await database.query(
        `SELECT * FROM agent_messages
         WHERE to_agent_type = $1
           AND read_at IS NULL
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at ASC
         LIMIT $2`,
        [agentType, limit]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        from: {
          type: row.from_agent_type,
          instanceId: row.from_agent_instance,
          capabilities: [],
          currentLoad: 0,
          version: '1.0'
        },
        to: {
          type: row.to_agent_type,
          instanceId: row.to_agent_instance || 'any',
          capabilities: [],
          currentLoad: 0,
          version: '1.0'
        },
        payload: row.payload,
        replyTo: row.reply_to,
        expiresAt: row.expires_at,
        createdAt: row.created_at
      }));
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to receive messages');
      return [];
    }
  }

  /**
   * Mark a message as read
   */
  async markAsRead(messageId: string): Promise<void> {
    try {
      await database.query(
        `UPDATE agent_messages
         SET read_at = NOW()
         WHERE id = $1`,
        [messageId]
      );
    } catch (error: any) {
      logger.warn({ error, messageId }, 'Failed to mark message as read');
    }
  }

  /**
   * Mark a message as processed
   */
  async markAsProcessed(messageId: string): Promise<void> {
    try {
      await database.query(
        `UPDATE agent_messages
         SET processed_at = NOW()
         WHERE id = $1`,
        [messageId]
      );
    } catch (error: any) {
      logger.warn({ error, messageId }, 'Failed to mark message as processed');
    }
  }

  /**
   * Reply to a message
   */
  async reply(
    originalMessage: AgentMessage,
    from: AgentIdentity,
    responsePayload: any
  ): Promise<string> {
    return this.sendMessage({
      type: 'response',
      from,
      to: originalMessage.from,
      payload: responsePayload,
      replyTo: originalMessage.id
    });
  }

  /**
   * Subscribe to incoming messages (for real-time processing)
   */
  async subscribeToMessages(
    agentType: string,
    handler: (message: AgentMessage) => Promise<void>
  ): Promise<void> {
    try {
      const subscriber = redis.duplicate();
      await subscriber.subscribe(`agent:${agentType}:inbox`);

      subscriber.on('message', async (channel, messageData) => {
        try {
          const message = JSON.parse(messageData) as AgentMessage;
          await handler(message);
          await this.markAsProcessed(message.id);
        } catch (error: any) {
          logger.error({ error, channel }, 'Error processing agent message');
        }
      });

      logger.info({ agentType }, 'Subscribed to agent messages');
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to subscribe to messages');
      throw error;
    }
  }

  /**
   * Subscribe to replies for queries
   */
  private async subscribeToReplies(
    agentType: string,
    handler: (message: AgentMessage) => Promise<void>
  ): Promise<void> {
    try {
      const subscriber = redis.duplicate();
      await subscriber.subscribe(`agent:${agentType}:replies`);

      subscriber.on('message', async (channel, messageData) => {
        const message = JSON.parse(messageData) as AgentMessage;
        if (message.type === 'response') {
          await handler(message);
        }
      });
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to subscribe to replies');
    }
  }

  /**
   * Notify an agent about an event
   */
  async notifyAgent(
    from: AgentIdentity,
    toType: string,
    notification: {
      title: string;
      message: string;
      data?: any;
    }
  ): Promise<string> {
    return this.sendMessage({
      type: 'notification',
      from,
      to: {
        type: toType as any,
        instanceId: 'any',
        capabilities: [],
        currentLoad: 0,
        version: '1.0'
      },
      payload: notification
    });
  }

  /**
   * Request approval from another agent
   */
  async requestApproval(
    from: AgentIdentity,
    toType: string,
    request: {
      action: string;
      reason: string;
      data: any;
    },
    timeoutMs: number = 300000 // 5 minutes
  ): Promise<{ approved: boolean; reason?: string }> {
    const messageId = await this.sendMessage({
      type: 'approval_request',
      from,
      to: {
        type: toType as any,
        instanceId: 'any',
        capabilities: [],
        currentLoad: 0,
        version: '1.0'
      },
      payload: request,
      replyTo: uuidv4(),
      expiresAt: new Date(Date.now() + timeoutMs)
    });

    // Wait for approval response
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resolve({ approved: false, reason: 'Approval timeout' });
      }, timeoutMs);

      this.subscribeToReplies(from.type, async (message) => {
        if (message.replyTo === messageId) {
          clearTimeout(timeout);
          await this.markAsRead(message.id);
          resolve(message.payload);
        }
      });
    });
  }

  /**
   * Get agent capabilities (for smart routing)
   */
  async getAgentCapabilities(agentType: string): Promise<string[]> {
    // This would be extended with actual capability discovery
    // For now, return static capabilities based on agent type
    const capabilities: Record<string, string[]> = {
      discovery: ['domain-enumeration', 'chaos-integration', 'scope-validation'],
      subdomain: ['passive-recon', 'dns-resolution', 'subdomain-discovery'],
      bruteforce: ['dns-bruteforce', 'massdns', 'shuffledns'],
      fingerprint: ['http-fingerprinting', 'technology-detection', 'waf-detection'],
      portscan: ['tcp-scan', 'udp-scan', 'service-detection'],
      scanner: ['vulnerability-scanning', 'template-matching', 'nuclei'],
      crawler: ['web-crawling', 'endpoint-discovery', 'js-analysis'],
      triage: ['ai-analysis', 'false-positive-detection', 'severity-assessment'],
      confirm: ['vulnerability-verification', 'exploit-validation', 'poc-generation']
    };

    return capabilities[agentType] || [];
  }

  /**
   * Find best agent for a task based on capabilities
   */
  async findBestAgent(requiredCapabilities: string[]): Promise<string | null> {
    // Simple capability matching
    const agentTypes = ['discovery', 'subdomain', 'bruteforce', 'fingerprint', 'portscan', 'scanner', 'crawler', 'triage', 'confirm'];

    for (const agentType of agentTypes) {
      const capabilities = await this.getAgentCapabilities(agentType);
      const hasAll = requiredCapabilities.every(cap => capabilities.includes(cap));

      if (hasAll) {
        return agentType;
      }
    }

    return null;
  }

  /**
   * Clean up expired messages
   */
  async cleanupExpiredMessages(): Promise<number> {
    try {
      const result = await database.query(
        `DELETE FROM agent_messages
         WHERE expires_at IS NOT NULL
           AND expires_at < NOW()
         RETURNING id`
      );

      const count = result.rows.length;
      if (count > 0) {
        logger.info({ count }, 'Cleaned up expired agent messages');
      }
      return count;
    } catch (error: any) {
      logger.error({ error }, 'Failed to cleanup expired messages');
      return 0;
    }
  }

  /**
   * Get message statistics for monitoring
   */
  async getMessageStats(): Promise<{
    total: number;
    unread: number;
    processed: number;
    byType: Record<string, number>;
    byAgent: Record<string, number>;
  }> {
    try {
      const totalResult = await database.query(
        `SELECT COUNT(*) as count FROM agent_messages`
      );

      const unreadResult = await database.query(
        `SELECT COUNT(*) as count FROM agent_messages WHERE read_at IS NULL`
      );

      const processedResult = await database.query(
        `SELECT COUNT(*) as count FROM agent_messages WHERE processed_at IS NOT NULL`
      );

      const byTypeResult = await database.query(
        `SELECT type, COUNT(*) as count FROM agent_messages GROUP BY type`
      );

      const byAgentResult = await database.query(
        `SELECT to_agent_type, COUNT(*) as count FROM agent_messages GROUP BY to_agent_type`
      );

      return {
        total: parseInt(totalResult.rows[0].count),
        unread: parseInt(unreadResult.rows[0].count),
        processed: parseInt(processedResult.rows[0].count),
        byType: Object.fromEntries(
          byTypeResult.rows.map((r: any) => [r.type, parseInt(r.count)])
        ),
        byAgent: Object.fromEntries(
          byAgentResult.rows.map((r: any) => [r.to_agent_type, parseInt(r.count)])
        )
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to get message stats');
      return {
        total: 0,
        unread: 0,
        processed: 0,
        byType: {},
        byAgent: {}
      };
    }
  }
}

export default new AgentCoordinationService();
