import config from '../config';
import logger from '../utils/logger';
import queue from '../services/queue';
import database from '../services/database';
import notification from '../services/notification';
import autoOrchestrator from '../services/auto-orchestrator';

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
import { InteractAgent } from '../agents/interact';
// New advanced agents
import { OsintAgent } from '../agents/osint';
import { XssAgent } from '../agents/xss';
import { SqliAgent } from '../agents/sqli';
import { WebVulnsAgent } from '../agents/webvulns';
import { JsAnalysisAgent } from '../agents/jsanalysis';
import { CloudMisconfigAgent } from '../agents/cloudmisconfig';

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
  const interactAgent = new InteractAgent();
  // Initialize new advanced agents
  const osintAgent = new OsintAgent();
  const xssAgent = new XssAgent();
  const sqliAgent = new SqliAgent();
  const webVulnsAgent = new WebVulnsAgent();
  const jsAnalysisAgent = new JsAnalysisAgent();
  const cloudMisconfigAgent = new CloudMisconfigAgent();

  // Create workers for each agent type with HIGH CONCURRENCY and auto-orchestration
  queue.createWorker('discovery', async (job) => {
    const result = await discoveryAgent.process(job as any);
    await autoOrchestrator.onJobComplete(job.id!);
    return result;
  }, { concurrency: 10 });

  queue.createWorker('subdomain', async (job) => {
    const result = await subdomainAgent.process(job as any);
    await autoOrchestrator.onJobComplete(job.id!);
    return result;
  }, { concurrency: 15 });

  queue.createWorker('bruteforce', async (job) => {
    const result = await bruteforceAgent.process(job as any);
    await autoOrchestrator.onJobComplete(job.id!);
    return result;
  }, { concurrency: 10 });

  queue.createWorker('fingerprint', async (job) => {
    const result = await fingerprintAgent.process(job as any);
    await autoOrchestrator.onJobComplete(job.id!);
    return result;
  }, { concurrency: 20 });

  queue.createWorker('crawl', async (job) => {
    const result = await crawlAgent.process(job as any);
    await autoOrchestrator.onJobComplete(job.id!);
    return result;
  }, { concurrency: 15 });

  queue.createWorker('scanner', async (job) => {
    const result = await scannerAgent.process(job as any);
    await autoOrchestrator.onJobComplete(job.id!);
    return result;
  }, { concurrency: config.worker.workerConcurrency });

  queue.createWorker('confirm', async (job) => {
    const result = await confirmAgent.process(job as any);
    return result;
  }, { concurrency: 25 });

  queue.createWorker('triage', async (job) => {
    const result = await triageAgent.process(job as any);
    return result;
  }, { concurrency: 15 });

  queue.createWorker('interact', async (job) => {
    const result = await interactAgent.process(job as any);
    return result;
  }, { concurrency: 10 });

  // Create port scan worker if enabled
  if (config.features.enablePortScanning) {
    queue.createWorker('portscan', async (job) => {
      const result = await portScanAgent.process(job as any);
      await autoOrchestrator.onJobComplete(job.id!);
      return result;
    }, { concurrency: 12 });
  }

  // Create new advanced workers with HIGH CONCURRENCY
  if (config.features.enableOsint) {
    queue.createWorker('osint', async (job) => {
      return await osintAgent.process(job as any);
    }, { concurrency: 10 });
  }

  if (config.features.enableXssScanning) {
    queue.createWorker('xss', async (job) => {
      return await xssAgent.process(job as any);
    }, { concurrency: 20 });
  }

  if (config.features.enableSqliScanning) {
    queue.createWorker('sqli', async (job) => {
      return await sqliAgent.process(job as any);
    }, { concurrency: 15 });
  }

  if (config.features.enableWebVulnScanning) {
    queue.createWorker('webvulns', async (job) => {
      return await webVulnsAgent.process(job as any);
    }, { concurrency: 25 });
  }

  if (config.features.enableJsAnalysis) {
    queue.createWorker('jsanalysis', async (job) => {
      return await jsAnalysisAgent.process(job as any);
    }, { concurrency: 15 });
  }

  if (config.features.enableCloudMisconfigScan) {
    queue.createWorker('cloudmisconfig', async (job) => {
      return await cloudMisconfigAgent.process(job as any);
    }, { concurrency: 12 });
  }

  const workerStats: any = {
    discovery: 10,
    subdomain: 15,
    bruteforce: 10,
    fingerprint: 20,
    crawl: 15,
    scanner: config.worker.workerConcurrency,
    confirm: 25,
    triage: 15,
    interact: 10,
    portscan: 12,
  };

  // Add new worker stats if enabled
  if (config.features.enableOsint) workerStats.osint = 10;
  if (config.features.enableXssScanning) workerStats.xss = 20;
  if (config.features.enableSqliScanning) workerStats.sqli = 15;
  if (config.features.enableWebVulnScanning) workerStats.webvulns = 25;
  if (config.features.enableJsAnalysis) workerStats.jsanalysis = 15;
  if (config.features.enableCloudMisconfigScan) workerStats.cloudmisconfig = 12;

  logger.info({ concurrency: workerStats }, 'All workers started successfully');

  // Build worker stats message
  let workerStatsMessage = `*Core Workers:*\n` +
    `• Discovery: ${workerStats.discovery}\n` +
    `• Subdomain: ${workerStats.subdomain}\n` +
    `• Fingerprint: ${workerStats.fingerprint}\n` +
    `• Crawl: ${workerStats.crawl}\n` +
    `• Port Scan: ${workerStats.portscan}\n` +
    `• Scanner: ${workerStats.scanner}\n` +
    `• Triage: ${workerStats.triage}\n` +
    `• Confirm: ${workerStats.confirm}\n` +
    `• Interact: ${workerStats.interact}`;

  if (Object.keys(workerStats).length > 9) {
    workerStatsMessage += `\n\n*Advanced Workers:*`;
    if (config.features.enableOsint) workerStatsMessage += `\n• OSINT: ${workerStats.osint}`;
    if (config.features.enableXssScanning) workerStatsMessage += `\n• XSS Scanner: ${workerStats.xss}`;
    if (config.features.enableSqliScanning) workerStatsMessage += `\n• SQLi Scanner: ${workerStats.sqli}`;
    if (config.features.enableWebVulnScanning) workerStatsMessage += `\n• Web Vulns: ${workerStats.webvulns}`;
    if (config.features.enableJsAnalysis) workerStatsMessage += `\n• JS Analysis: ${workerStats.jsanalysis}`;
    if (config.features.enableCloudMisconfigScan) workerStatsMessage += `\n• Cloud Misconfig: ${workerStats.cloudmisconfig}`;
  }

  // Send Telegram notification about workers starting
  await notification.notifyOps(
    '✅ AgentHunt Workers Started',
    `All AgentHunt workers have been started successfully!\n\n${workerStatsMessage}`,
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
