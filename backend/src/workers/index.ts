import config from '../config';
import logger from '../utils/logger';
import queue from '../services/queue';
import database from '../services/database';

// Import agents
import { DiscoveryAgent } from '../agents/discovery';
import { FingerprintAgent } from '../agents/fingerprint';
import { CrawlAgent } from '../agents/crawl';
import { ScannerAgent } from '../agents/scanner';
import { ConfirmAgent } from '../agents/confirm';
import { TriageAgent } from '../agents/triage';

/**
 * Worker Process
 * Starts workers for all agent types and processes jobs from the queue
 */

async function startWorkers() {
  logger.info('Starting AgentHunt workers...');

  // Check database connection
  const dbHealthy = await database.healthCheck();
  if (!dbHealthy) {
    logger.error('Database connection failed, exiting');
    process.exit(1);
  }

  // Initialize agents
  const discoveryAgent = new DiscoveryAgent();
  const fingerprintAgent = new FingerprintAgent();
  const crawlAgent = new CrawlAgent();
  const scannerAgent = new ScannerAgent();
  const confirmAgent = new ConfirmAgent();
  const triageAgent = new TriageAgent();

  // Create workers for each agent type
  queue.createWorker('discovery', async (job) => {
    return await discoveryAgent.process(job);
  }, { concurrency: 2 });

  queue.createWorker('fingerprint', async (job) => {
    return await fingerprintAgent.process(job);
  }, { concurrency: 3 });

  queue.createWorker('crawl', async (job) => {
    return await crawlAgent.process(job);
  }, { concurrency: 2 });

  queue.createWorker('scanner', async (job) => {
    return await scannerAgent.process(job);
  }, { concurrency: config.worker.workerConcurrency });

  queue.createWorker('confirm', async (job) => {
    return await confirmAgent.process(job);
  }, { concurrency: 5 });

  queue.createWorker('triage', async (job) => {
    return await triageAgent.process(job);
  }, { concurrency: 3 });

  logger.info({
    concurrency: {
      discovery: 2,
      fingerprint: 3,
      crawl: 2,
      scanner: config.worker.workerConcurrency,
      confirm: 5,
      triage: 3,
    },
  }, 'All workers started successfully');

  // Heartbeat for worker health monitoring
  setInterval(async () => {
    try {
      const queues = queue.getAllQueues();
      const stats: any = {};

      for (const [name, q] of queues.entries()) {
        const counts = await q.getJobCounts();
        stats[name] = counts;
      }

      logger.debug({ queues: stats }, 'Worker heartbeat');
    } catch (error) {
      logger.error({ error }, 'Heartbeat failed');
    }
  }, 30000); // Every 30 seconds
}

// Start workers
startWorkers().catch((error) => {
  logger.error({ error }, 'Failed to start workers');
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down workers');
  await queue.close();
  await database.close();
  logger.info('Workers closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down workers');
  await queue.close();
  await database.close();
  logger.info('Workers closed');
  process.exit(0);
});
