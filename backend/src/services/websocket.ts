/**
 * WebSocket Server for Real-Time Updates
 * Streams job progress, agent health, and workflow execution to frontend
 */

import { Server as HTTPServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import redis from './redis';
import logger from '../utils/logger';
import { JobProgress } from '../../../shared/agent-collaboration.types';

interface WSClient {
  ws: WebSocket;
  subscriptions: Set<string>;
  userId?: string;
  programId?: string;
}

class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, WSClient> = new Map();
  private redisSubscriber: any = null;

  /**
   * Initialize WebSocket server
   */
  async initialize(server: HTTPServer): Promise<void> {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = this.generateClientId();
      this.clients.set(clientId, {
        ws,
        subscriptions: new Set(),
      });

      logger.info({ clientId, ip: req.socket.remoteAddress }, 'WebSocket client connected');

      ws.on('message', async (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          await this.handleMessage(clientId, data);
        } catch (error: any) {
          logger.error({ error, clientId }, 'Failed to handle WebSocket message');
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        logger.info({ clientId }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error({ error, clientId }, 'WebSocket error');
      });

      // Send welcome message
      ws.send(
        JSON.stringify({
          type: 'connected',
          clientId,
          message: 'Connected to AgentHunt WebSocket server',
        })
      );
    });

    // Subscribe to Redis pub/sub for real-time updates
    await this.subscribeToRedis();

    logger.info('WebSocket server initialized');
  }

  /**
   * Subscribe to Redis channels for real-time updates
   */
  private async subscribeToRedis(): Promise<void> {
    this.redisSubscriber = redis.duplicate();

    // Subscribe to all job progress channels
    await this.redisSubscriber.psubscribe('job:*:progress');

    // Subscribe to agent health updates
    await this.redisSubscriber.psubscribe('agent:*:health');

    // Subscribe to workflow execution updates
    await this.redisSubscriber.psubscribe('workflow:*:progress');

    // Subscribe to handoff status updates
    await this.redisSubscriber.psubscribe('handoff:*:status');

    // Subscribe to program-wide updates
    await this.redisSubscriber.psubscribe('program:*:jobs');
    await this.redisSubscriber.psubscribe('program:*:findings');
    await this.redisSubscriber.psubscribe('program:*:handoffs');

    // Subscribe to severity-specific finding channels
    await this.redisSubscriber.psubscribe('findings:*');

    this.redisSubscriber.on('pmessage', (pattern: string, channel: string, message: string) => {
      try {
        const data = JSON.parse(message);

        // Determine message type from channel
        if (channel.includes(':progress')) {
          this.broadcast(channel, {
            type: 'job:progress',
            channel,
            data,
          });
        } else if (channel.includes(':health')) {
          this.broadcast(channel, {
            type: 'agent:health',
            channel,
            data,
          });
        } else if (channel.includes(':workflow')) {
          this.broadcast(channel, {
            type: 'workflow:progress',
            channel,
            data,
          });
        } else if (channel.includes('handoff:') && channel.includes(':status')) {
          this.broadcast(channel, {
            type: 'handoff:status',
            channel,
            data,
          });
        } else if (channel.includes(':jobs')) {
          this.broadcast(channel, {
            type: 'program:jobs',
            channel,
            data,
          });
        } else if (channel.includes(':findings')) {
          this.broadcast(channel, {
            type: 'program:findings',
            channel,
            data,
          });
        } else if (channel.includes(':handoffs')) {
          this.broadcast(channel, {
            type: 'program:handoffs',
            channel,
            data,
          });
        } else if (channel.startsWith('findings:')) {
          this.broadcast(channel, {
            type: 'finding:severity',
            channel,
            data,
          });
        }
      } catch (error: any) {
        logger.error({ error, channel }, 'Failed to process Redis message');
      }
    });

    logger.info('Subscribed to Redis pub/sub channels for real-time updates');
  }

  /**
   * Handle incoming WebSocket messages
   */
  private async handleMessage(clientId: string, data: any): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (data.type) {
      case 'subscribe':
        // Subscribe to specific job, program, or agent updates
        if (data.jobId) {
          client.subscriptions.add(`job:${data.jobId}:progress`);
          logger.debug({ clientId, jobId: data.jobId }, 'Client subscribed to job progress');
        }
        if (data.programId) {
          client.programId = data.programId;
          client.subscriptions.add(`program:${data.programId}:*`);
          logger.debug(
            { clientId, programId: data.programId },
            'Client subscribed to program updates'
          );
        }
        if (data.agentType) {
          client.subscriptions.add(`agent:${data.agentType}:health`);
          logger.debug(
            { clientId, agentType: data.agentType },
            'Client subscribed to agent health'
          );
        }
        if (data.workflowId) {
          client.subscriptions.add(`workflow:${data.workflowId}:progress`);
          logger.debug({ clientId, workflowId: data.workflowId }, 'Client subscribed to workflow');
        }
        if (data.handoffId) {
          client.subscriptions.add(`handoff:${data.handoffId}:status`);
          logger.debug(
            { clientId, handoffId: data.handoffId },
            'Client subscribed to handoff status'
          );
        }
        if (data.severity) {
          client.subscriptions.add(`findings:${data.severity}`);
          logger.debug(
            { clientId, severity: data.severity },
            'Client subscribed to severity findings'
          );
        }
        if (data.subscribeAll) {
          client.subscriptions.add('*');
          logger.debug({ clientId }, 'Client subscribed to all events');
        }

        client.ws.send(
          JSON.stringify({
            type: 'subscribed',
            subscriptions: Array.from(client.subscriptions),
          })
        );
        break;

      case 'unsubscribe':
        if (data.jobId) {
          client.subscriptions.delete(`job:${data.jobId}:progress`);
        }
        if (data.programId) {
          client.subscriptions.delete(`program:${data.programId}:*`);
        }
        if (data.agentType) {
          client.subscriptions.delete(`agent:${data.agentType}:health`);
        }

        client.ws.send(
          JSON.stringify({
            type: 'unsubscribed',
            subscriptions: Array.from(client.subscriptions),
          })
        );
        break;

      case 'ping':
        client.ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;

      default:
        logger.warn({ type: data.type }, 'Unknown WebSocket message type');
    }
  }

  /**
   * Broadcast message to subscribed clients
   */
  private broadcast(channel: string, message: any): void {
    let sentCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      // Check if client is subscribed to this channel
      const isSubscribed = Array.from(client.subscriptions).some((sub) => {
        if (sub.endsWith(':*')) {
          // Wildcard subscription
          const prefix = sub.slice(0, -2);
          return channel.startsWith(prefix);
        }
        return sub === channel;
      });

      if (isSubscribed && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify(message));
          sentCount++;
        } catch (error: any) {
          logger.error({ error, clientId }, 'Failed to send message to client');
        }
      }
    }

    if (sentCount > 0) {
      logger.debug({ channel, sentCount }, 'Broadcast message to clients');
    }
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: any): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      try {
        client.ws.send(JSON.stringify(message));
      } catch (error: any) {
        logger.error({ error, clientId }, 'Failed to send message to client');
      }
    }
  }

  /**
   * Broadcast to all clients
   */
  broadcastToAll(message: any): void {
    for (const [clientId, client] of this.clients.entries()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(JSON.stringify(message));
        } catch (error: any) {
          logger.error({ error, clientId }, 'Failed to broadcast to client');
        }
      }
    }
  }

  /**
   * Get connected clients count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Get client subscriptions
   */
  getClientSubscriptions(): Map<string, string[]> {
    const subscriptions = new Map<string, string[]>();
    for (const [clientId, client] of this.clients.entries()) {
      subscriptions.set(clientId, Array.from(client.subscriptions));
    }
    return subscriptions;
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Cleanup and close
   */
  async close(): Promise<void> {
    if (this.redisSubscriber) {
      await this.redisSubscriber.punsubscribe();
      this.redisSubscriber.quit();
    }

    for (const [clientId, client] of this.clients.entries()) {
      client.ws.close();
    }

    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }

    logger.info('WebSocket server closed');
  }
}

export default new WebSocketService();
