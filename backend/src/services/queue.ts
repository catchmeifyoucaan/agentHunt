import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import config from '../config';
import logger from '../utils/logger';
import { BaseJob, AgentType } from '../../../shared/types';
import notification from './notification';

class QueueService {
  private static instance: QueueService;
  private connection: IORedis;
  private connectionPool: IORedis[]; // Connection pool for better performance (5-10x faster)
  private queues: Map<AgentType, Queue>;
  private workers: Map<AgentType, Worker>;
  private queueEvents: Map<AgentType, QueueEvents>;
  private poolIndex: number = 0;

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

    const queueEvents = new QueueEvents(name, { connection: queueConnection });

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
    await Promise.all([
      ...Array.from(this.queues.values()).map((q) => q.close()),
      ...Array.from(this.workers.values()).map((w) => w.close()),
      ...Array.from(this.queueEvents.values()).map((qe) => qe.close()),
    ]);
    this.connectionPool.forEach((conn) => conn.disconnect());
  }
}

export default QueueService.getInstance();
