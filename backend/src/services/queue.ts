import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { BaseJob, AgentType } from '../../../shared/types';
import notification from './notification';
import { dynamicRouter } from './dynamic-handoff-router';

class QueueService {
  private static instance: QueueService;
  private connection: IORedis;
  private connectionPool: IORedis[]; // Connection pool for better performance (5-10x faster)
  private eventsConnection: IORedis; // Dedicated connection for QueueEvents (BullMQ best practice)
  private queues: Map<AgentType, Queue>;
  private workers: Map<AgentType, Worker>;
  private queueEvents: Map<AgentType, QueueEvents>;
  private poolIndex: number = 0;
  private isShuttingDown: boolean = false;

  private constructor() {
    // Create connection pool (5-10x better throughput under load)
    const poolSize = parseInt(process.env.REDIS_POOL_SIZE || '5', 10);
    this.connectionPool = [];

    for (let i = 0; i < poolSize; i++) {
      this.connectionPool.push(
        new IORedis({
          host: config.redis.host,
          port: config.redis.port,
          password: config.redis.password,
          maxRetriesPerRequest: null,
          tls: config.redis.tls ? { rejectUnauthorized: false } : undefined,
        })
      );
    }

    // Use first connection as primary
    this.connection = this.connectionPool[0];

    // Dedicated connection for QueueEvents (BullMQ recommends separate connections for pub/sub)
    this.eventsConnection = new IORedis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      maxRetriesPerRequest: null,
      tls: config.redis.tls ? { rejectUnauthorized: false } : undefined,
    });

    this.queues = new Map();
    this.workers = new Map();
    this.queueEvents = new Map();

    // Initialize queues for all agent types
    const agentTypes: AgentType[] = [
      'discovery',
      'subdomain',
      'bruteforce',
      'fingerprint',
      'crawl',
      'portscan',
      'scanner',
      'interact',
      'confirm',
      'triage',
      'manager',
      'osint',
      'xss',
      'sqli',
      'webvulns',
      'jsanalysis',
      'cloudmisconfig',
      'three-agent',
      // PayloadsAllTheThings Agents
      'clickjacking',
      'dns-rebinding',
      'crlf-injection',
      'open-redirect',
      'lfirfi',
      'nosql-injection',
      'host-header-injection',
      'csv-injection',
      'ldap-injection',
      'saml-injection',
      'web-cache-deception',
      'mass-assignment',
      'http-parameter-pollution',
      'latex-injection',
      'xpath-injection',
      'command-injection',
      'file-upload',
    ];

    agentTypes.forEach((type) => {
      this.createQueue(type);
    });

    // Create specialized queues
    this.createQueue('high-cpu-queue');
    this.createQueue('network-io-queue');
  }

  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  /**
   * Get connection from pool (round-robin for load distribution)
   */
  private getConnection(): IORedis {
    this.poolIndex = (this.poolIndex + 1) % this.connectionPool.length;
    return this.connectionPool[this.poolIndex];
  }

  private createQueue(name: AgentType): void {
    // Use connection pool for better performance
    const queueConnection = this.getConnection();
    const queue = new Queue(name, {
      connection: queueConnection,
      defaultJobOptions: {
        attempts: config.worker.jobRetryAttempts,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 1000,
        removeOnFail: 2000,
      },
    });

    // Use dedicated events connection (BullMQ best practice to avoid MAXCLIENTS and pub/sub interference)
    const queueEvents = new QueueEvents(name, { connection: this.eventsConnection });

    queueEvents.on('completed', async ({ jobId }) => {
      logger.info({ queue: name, jobId }, 'Job completed');
      try {
        const job = await queue.getJob(jobId);
        if (job && job.data) {
          const jobData = job.data as BaseJob;
          await notification.notifyJobStatusChange(
            name,
            jobId,
            jobData.programId,
            'active',
            'completed',
            job.returnvalue
          );
        }
      } catch (error) {
        logger.error({ error, jobId }, 'Failed to send completion notification');
      }
    });

    queueEvents.on('failed', async ({ jobId, failedReason }) => {
      logger.error({ queue: name, jobId, failedReason }, 'Job failed');
      try {
        const job = await queue.getJob(jobId);
        if (job && job.data) {
          const jobData = job.data as BaseJob;
          await notification.notifyJobStatusChange(
            name,
            jobId,
            jobData.programId,
            'active',
            'failed',
            undefined,
            failedReason
          );
        }
      } catch (error) {
        logger.error({ error, jobId }, 'Failed to send failure notification');
      }
    });

    this.queues.set(name, queue);
    this.queueEvents.set(name, queueEvents);

    logger.info({ queue: name }, 'Queue created');
  }

  public async addJob<T extends BaseJob>(
    queueName: AgentType,
    jobData: T,
    options?: {
      priority?: number;
      delay?: number;
      jobId?: string;
    }
  ): Promise<Job<T>> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.add(queueName, jobData, {
      priority: options?.priority || jobData.priority || 5,
      delay: options?.delay,
      jobId: options?.jobId || jobData.id,
    });

    logger.info(
      {
        queue: queueName,
        jobId: job.id,
        priority: jobData.priority,
      },
      'Job added to queue'
    );

    // 🚀 DYNAMIC ROUTING: Publish job creation to dynamic router
    // This enables all agents to participate in dynamic handoff system
    try {
      if (jobData.programId && job.id) {
        const signalType = this.inferSignalTypeFromJob(queueName, jobData);
        await dynamicRouter.publishSignal({
          sourceAgent: (jobData as any).metadata?.sourceAgent || 'queue-service',
          programId: jobData.programId,
          jobId: job.id,
          signalType: signalType as any,
          data: {
            targetAgent: queueName,
            jobType: jobData.type,
            priority: jobData.priority,
            ...((jobData as any).metadata || {}),
          },
          confidence: (jobData.priority || 5) / 10,
        });
        logger.debug({ queueName, signalType, jobId: job.id }, 'Job published to dynamic router');
      }
    } catch (error) {
      // Non-fatal - job is still queued
      logger.debug({ error }, 'Dynamic router publish failed (non-fatal)');
    }

    // Send Telegram notification for job creation
    notification
      .notifyJobCreated(queueName, job.id!, jobData.programId, jobData.priority || 5)
      .catch((error) => {
        logger.error({ error, jobId: job.id }, 'Failed to send job creation notification');
      });

    return job as Job<T>;
  }

  public createWorker<T extends BaseJob>(
    queueNames: AgentType[], // Changed to array
    processor: (job: Job<T>) => Promise<any>,
    options?: {
      concurrency?: number;
    }
  ): Worker<T>[] {
    const workers: Worker<T>[] = [];

    for (const queueName of queueNames) {
      const worker = new Worker<T>(
        queueName,
        async (job: Job<T>) => {
          logger.info(
            {
              queue: queueName,
              jobId: job.id,
              attempt: job.attemptsMade + 1,
            },
            'Processing job'
          );

          // Send notification when job starts processing (pending -> active)
          try {
            const jobData = job.data as BaseJob;
            await notification.notifyJobStatusChange(
              queueName,
              job.id!,
              jobData.programId,
              'pending',
              'active'
            );
          } catch (error) {
            logger.error({ error, jobId: job.id }, 'Failed to send active notification');
          }

          try {
            const result = await processor(job);
            logger.info({ queue: queueName, jobId: job.id }, 'Job processed successfully');
            return result;
          } catch (error) {
            logger.error({ queue: queueName, jobId: job.id, error }, 'Job processing failed');
            throw error;
          }
        },
        {
          connection: this.getConnection(), // Use connection pool
          concurrency: options?.concurrency || config.worker.workerConcurrency,
          lockDuration: config.worker.jobTimeoutMs,
        }
      );

      worker.on('completed', (job) => {
        logger.debug({ queue: queueName, jobId: job.id }, 'Worker completed job');
      });

      worker.on('failed', (job, err) => {
        logger.error({ queue: queueName, jobId: job?.id, error: err }, 'Worker failed job');
      });

      this.workers.set(queueName, worker as Worker);
      logger.info({ queue: queueName }, `Worker created for queue: ${queueName}`);
      workers.push(worker);
    }
    return workers;
  }

  public getQueue(queueName: AgentType): Queue | undefined {
    return this.queues.get(queueName);
  }

  public getWorker(queueName: AgentType): Worker | undefined {
    return this.workers.get(queueName);
  }

  public getAllQueues(): Map<AgentType, Queue> {
    return this.queues;
  }

  public async getQueueMetrics(queueName: AgentType): Promise<{
    waiting: number;
    active: number;
    delayed: number;
    failed: number;
    completed: number;
    paused: number;
  }> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    const counts = await queue.getJobCounts();
    return {
      waiting: counts.waiting,
      active: counts.active,
      delayed: counts.delayed,
      failed: counts.failed,
      completed: counts.completed,
      paused: counts.paused,
    };
  }

  public async removeJob(queueName: AgentType, jobId: string): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    const job = await queue.getJob(jobId);
    if (job) {
      await job.remove();
    }
  }

  public async pauseQueue(queueName: AgentType): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.pause();
  }

  public async resumeQueue(queueName: AgentType): Promise<void> {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    await queue.resume();
  }

  public async closeAll(): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Queue service already shutting down');
      return;
    }
    this.isShuttingDown = true;
    logger.info('Gracefully shutting down queue service...');

    // Close workers first (stop processing new jobs)
    logger.info({ workerCount: this.workers.size }, 'Closing workers...');
    await Promise.all(
      Array.from(this.workers.values()).map(async (w) => {
        try {
          await w.close();
        } catch (error) {
          logger.error({ error }, 'Error closing worker');
        }
      })
    );

    // Close queue events
    logger.info({ eventsCount: this.queueEvents.size }, 'Closing queue events...');
    await Promise.all(
      Array.from(this.queueEvents.values()).map(async (qe) => {
        try {
          await qe.close();
        } catch (error) {
          logger.error({ error }, 'Error closing queue events');
        }
      })
    );

    // Close queues
    logger.info({ queueCount: this.queues.size }, 'Closing queues...');
    await Promise.all(
      Array.from(this.queues.values()).map(async (q) => {
        try {
          await q.close();
        } catch (error) {
          logger.error({ error }, 'Error closing queue');
        }
      })
    );

    // Close Redis connections
    logger.info('Closing Redis connections...');
    try {
      await this.eventsConnection.quit();
    } catch (error) {
      logger.error({ error }, 'Error closing events connection');
    }

    for (const conn of this.connectionPool) {
      try {
        await conn.quit();
      } catch (error) {
        logger.error({ error }, 'Error closing pool connection');
      }
    }

    logger.info('Queue service shutdown complete');
  }

  /**
   * Get pool statistics for monitoring
   */
  public getPoolStats(): {
    poolSize: number;
    activeConnections: number;
    isShuttingDown: boolean;
    queuesCount: number;
    workersCount: number;
  } {
    return {
      poolSize: this.connectionPool.length,
      activeConnections: this.connectionPool.filter((c) => c.status === 'ready').length,
      isShuttingDown: this.isShuttingDown,
      queuesCount: this.queues.size,
      workersCount: this.workers.size,
    };
  }

  /**
   * Infer signal type from job queue name and data for dynamic routing
   */
  private inferSignalTypeFromJob(queueName: AgentType, jobData: BaseJob): string {
    // Map agent types to signal types
    const agentToSignal: Record<string, string> = {
      'xss': 'dom_sink_found',
      'sqli': 'database_error',
      'ssrf': 'ssrf_potential',
      'lfi': 'lfi_potential',
      'lfirfi': 'lfi_potential',
      'webvulns': 'vulnerability_potential',
      'scanner': 'vulnerability_potential',
      'crawl': 'url_discovered',
      'discovery': 'url_discovered',
      'subdomain': 'subdomain_found',
      'fingerprint': 'technology_detected',
      'jsanalysis': 'js_file_found',
      'apifuzz': 'api_endpoint',
      'graphql': 'graphql_endpoint',
      'websocket': 'websocket_endpoint',
      'idor': 'idor_potential',
      'authbypass': 'auth_endpoint',
      'oauth': 'oauth_flow',
      'jwt-attack': 'jwt_token',
      'csrf': 'form_found',
      'cors': 'cors_misconfiguration',
      'cache-poisoning': 'cache_header',
      'request-smuggling': 'header_found',
      'templateinjection': 'template_syntax',
      'deserialization': 'serialized_data',
      'prototype-pollution': 'technology_detected',
      'xxe': 'serialized_data',
      'cloudmisconfig': 'cloud_resource',
      'cloud-storage': 'cloud_resource',
      'secrethunter': 'secret_found',
      'github-secrets': 'secret_found',
      'subdomain-takeover': 'subdomain_found',
      'portscan': 'port_open',
      'triage': 'vulnerability_potential',
      'confirm': 'vulnerability_potential',
      // PayloadsAllTheThings agents
      'clickjacking': 'header_found',
      'dns-rebinding': 'technology_detected',
      'crlf-injection': 'header_found',
      'open-redirect': 'open_redirect',
      'nosql-injection': 'database_error',
      'host-header-injection': 'header_found',
      'csv-injection': 'vulnerability_potential',
      'ldap-injection': 'vulnerability_potential',
      'saml-injection': 'auth_endpoint',
      'web-cache-deception': 'cache_header',
      'mass-assignment': 'parameter_found',
      'http-parameter-pollution': 'parameter_found',
      'latex-injection': 'vulnerability_potential',
      'xpath-injection': 'vulnerability_potential',
      'command-injection': 'rce_potential',
      'file-upload': 'file_upload',
    };

    return agentToSignal[queueName] || 'vulnerability_potential';
  }
}

export default QueueService.getInstance();
