import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import database from './database';
import {
  BaseEvent,
  LogEvent,
  FindingEvent,
  JobEvent,
  ProgressEvent,
  HumanActionRequest,
} from '../../../shared/types';

class EventService extends EventEmitter {
  private static instance: EventService;
  private wss?: WebSocketServer;
  private clients: Map<string, WebSocket>;

  private constructor() {
    super();
    this.clients = new Map();
  }

  public static getInstance(): EventService {
    if (!EventService.instance) {
      EventService.instance = new EventService();
    }
    return EventService.instance;
  }

  /**
   * Initialize WebSocket server
   */
  public initializeWebSocket(server: any): void {
    this.wss = new WebSocketServer({ server, path: '/events' });

    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = uuidv4();
      this.clients.set(clientId, ws);

      logger.info({ clientId, ip: req.socket.remoteAddress }, 'WebSocket client connected');

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(clientId, data);
        } catch (error) {
          logger.error({ error, clientId }, 'Failed to parse WebSocket message');
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        logger.info({ clientId }, 'WebSocket client disconnected');
      });

      ws.on('error', (error) => {
        logger.error({ error, clientId }, 'WebSocket error');
        this.clients.delete(clientId);
      });

      // Send initial connection success
      this.sendToClient(clientId, {
        type: 'connection',
        status: 'connected',
        clientId,
      });
    });

    logger.info('WebSocket server initialized');
  }

  /**
   * Handle messages from clients (subscriptions, filters, etc.)
   */
  private handleClientMessage(clientId: string, data: any): void {
    // Implement subscription logic
    logger.debug({ clientId, data }, 'Received client message');
  }

  /**
   * Send event to specific client
   */
  private sendToClient(clientId: string, data: any): void {
    const ws = this.clients.get(clientId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  /**
   * Broadcast event to all connected clients
   */
  private broadcast(data: any): void {
    const message = JSON.stringify(data);
    this.clients.forEach((ws, clientId) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  /**
   * Emit and persist log event
   */
  public async emitLog(event: Omit<LogEvent, 'id' | 'type' | 'timestamp'>): Promise<void> {
    const logEvent: LogEvent = {
      id: uuidv4(),
      type: 'log',
      timestamp: new Date(),
      ...event,
    };

    // Persist to database
    await this.persistEvent(logEvent);

    // Broadcast to clients
    this.broadcast(logEvent);

    // Emit for internal listeners
    this.emit('log', logEvent);

    // Also log to system logger
    logger[logEvent.level](
      {
        programId: logEvent.programId,
        jobId: logEvent.jobId,
        workerId: logEvent.workerId,
        tool: logEvent.tool,
        context: logEvent.context,
      },
      logEvent.message
    );
  }

  /**
   * Emit finding event
   */
  public async emitFinding(finding: FindingEvent['finding']): Promise<void> {
    const findingEvent: FindingEvent = {
      id: uuidv4(),
      type: 'finding',
      timestamp: new Date(),
      programId: finding.programId,
      finding,
    };

    await this.persistEvent(findingEvent);
    this.broadcast(findingEvent);
    this.emit('finding', findingEvent);

    logger.info(
      {
        findingId: finding.id,
        severity: finding.severity,
        title: finding.title,
      },
      'New finding emitted'
    );
  }

  /**
   * Emit job status event
   */
  public async emitJobStatus(job: JobEvent['job']): Promise<void> {
    const jobEvent: JobEvent = {
      id: uuidv4(),
      type: 'job_status',
      timestamp: new Date(),
      programId: job.programId,
      jobId: job.id,
      workerId: job.workerId,
      job,
    };

    await this.persistEvent(jobEvent);
    this.broadcast(jobEvent);
    this.emit('job_status', jobEvent);
  }

  /**
   * Emit progress event
   */
  public async emitProgress(
    event: Omit<ProgressEvent, 'id' | 'type' | 'timestamp'>
  ): Promise<void> {
    const progressEvent: ProgressEvent = {
      id: uuidv4(),
      type: 'progress',
      timestamp: new Date(),
      ...event,
    };

    // Don't persist progress events (too frequent)
    this.broadcast(progressEvent);
    this.emit('progress', progressEvent);
  }

  /**
   * Emit human action request
   */
  public async emitHumanActionRequest(
    event: Omit<HumanActionRequest, 'id' | 'type' | 'timestamp'>
  ): Promise<void> {
    const actionRequest: HumanActionRequest = {
      id: uuidv4(),
      type: 'human_action_request',
      timestamp: new Date(),
      ...event,
    };

    await this.persistEvent(actionRequest);
    this.broadcast(actionRequest);
    this.emit('human_action_request', actionRequest);

    logger.warn(
      {
        action: actionRequest.action,
        reason: actionRequest.reason,
      },
      'Human action required'
    );
  }

  /**
   * Persist event to database
   */
  private async persistEvent(event: BaseEvent): Promise<void> {
    try {
      await database.query(
        `INSERT INTO events (id, type, program_id, job_id, worker_id, level, tool, context, message, payload, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          event.id,
          event.type,
          event.programId || null,
          event.jobId || null,
          event.workerId || null,
          (event as LogEvent).level || null,
          (event as LogEvent).tool || null,
          (event as LogEvent).context || null,
          (event as LogEvent).message || null,
          JSON.stringify(event),
          event.timestamp,
        ]
      );
    } catch (error) {
      logger.error({ error, event }, 'Failed to persist event');
    }
  }

  /**
   * Get recent events
   */
  public async getEvents(filters: {
    programId?: string;
    jobId?: string;
    type?: string;
    limit?: number;
  }): Promise<BaseEvent[]> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIndex = 1;

    if (filters.programId) {
      conditions.push(`program_id = $${paramIndex++}`);
      params.push(filters.programId);
    }

    if (filters.jobId) {
      conditions.push(`job_id = $${paramIndex++}`);
      params.push(filters.jobId);
    }

    if (filters.type) {
      conditions.push(`type = $${paramIndex++}`);
      params.push(filters.type);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit || 100;

    const result = await database.query(
      `SELECT payload FROM events ${whereClause} ORDER BY timestamp DESC LIMIT $${paramIndex}`,
      [...params, limit]
    );

    return result.rows.map((row) => row.payload);
  }

  public close(): void {
    if (this.wss) {
      this.wss.close();
      logger.info('WebSocket server closed');
    }
  }
}

export default EventService.getInstance();
