import config from '../config';
import logger from '../utils/logger';
import queue from '../services/queue';
import database from '../services/database';
import notification from '../services/notification';

// Import agents
import { DiscoveryAgent } from '../agents/discovery';
import { SubdomainAgent } from '../agents/subdomain';
import { BruteforceAgent } from '../agents/bruteforce';
import { FingerprintAgent } from '../agents/fingerprint';
import { CrawlAgent } from '../agents/crawl';
import { ScannerAgent } from '../agents/scanner';
import { PortScanAgent } from '../agents/portscan';
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
  const subdomainAgent = new SubdomainAgent();
  const bruteforceAgent = new BruteforceAgent();
  const fingerprintAgent = new FingerprintAgent();
  const crawlAgent = new CrawlAgent();
  const scannerAgent = new ScannerAgent();
  const portScanAgent = new PortScanAgent();
  const confirmAgent = new ConfirmAgent();
  const triageAgent = new TriageAgent();

  // Create workers for each agent type
  queue.createWorker('discovery', async (job) => {
    return await discoveryAgent.process(job as any);
  }, { concurrency: 2 });

  queue.createWorker('subdomain', async (job) => {
    return await subdomainAgent.process(job as any);
  }, { concurrency: 3 });

  queue.createWorker('bruteforce', async (job) => {
    return await bruteforceAgent.process(job as any);
  }, { concurrency: 2 });

  queue.createWorker('fingerprint', async (job) => {
    return await fingerprintAgent.process(job as any);
  }, { concurrency: 3 });

  queue.createWorker('crawl', async (job) => {
    return await crawlAgent.process(job as any);
  }, { concurrency: 2 });

  queue.createWorker('scanner', async (job) => {
    return await scannerAgent.process(job as any);
  }, { concurrency: config.worker.workerConcurrency });

  queue.createWorker('confirm', async (job) => {
    return await confirmAgent.process(job as any);
  }, { concurrency: 5 });

  queue.createWorker('triage', async (job) => {
    return await triageAgent.process(job as any);
  }, { concurrency: 3 });

  // Create port scan worker if enabled
  if (config.features.enablePortScanning) {
    queue.createWorker('portscan', async (job) => {
      return await portScanAgent.process(job as any);
    }, { concurrency: 2 });
  }

  const workerStats = {
    discovery: 2,
    subdomain: 3,
    bruteforce: 2,
    fingerprint: 3,
    crawl: 2,
    scanner: config.worker.workerConcurrency,
    confirm: 5,
    triage: 3,
    portscan: config.features.enablePortScanning ? 2 : 0,
  };

  logger.info({ concurrency: workerStats }, 'All workers started successfully');

  // Send Telegram notification about workers starting
  await notification.notifyOps(
    '✅ Workers Started',
    `All AgentHunt workers have been started successfully!\n\n` +
    `*Worker Concurrency:*\n` +
    `• Discovery: ${workerStats.discovery}\n` +
    `• Subdomain: ${workerStats.subdomain}\n` +
    `• Bruteforce: ${workerStats.bruteforce}\n` +
    `• Fingerprint: ${workerStats.fingerprint}\n` +
    `• Crawl: ${workerStats.crawl}\n` +
    `• Port Scan: ${workerStats.portscan}\n` +
    `• Scanner: ${workerStats.scanner}\n` +
    `• Confirm: ${workerStats.confirm}\n` +
    `• Triage: ${workerStats.triage}`,
    'info'
  );

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
  await notification.notifyOps('⚠️ Workers Shutting Down', 'AgentHunt workers are shutting down (SIGTERM received)', 'warn');
  await queue.close();
  await database.close();
  logger.info('Workers closed');
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down workers');
  await notification.notifyOps('⚠️ Workers Shutting Down', 'AgentHunt workers are shutting down (SIGINT received)', 'warn');
  await queue.close();
  await database.close();
  logger.info('Workers closed');
  process.exit(0);
});
