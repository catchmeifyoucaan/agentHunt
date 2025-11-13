import config from '../config';
import logger from '../utils/logger';
import queue from '../services/queue';
import database from '../services/database';
import notification from '../services/notification';
import autoOrchestrator from '../services/auto-orchestrator';
import orchestrator from '../services/orchestrator';
import { AgentType } from '../../../shared/types';

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

  // Determine which queues this worker instance should process
  const workerQueuesEnv = process.env.WORKER_QUEUES;
  let queuesToProcess: AgentType[];

  if (workerQueuesEnv) {
    queuesToProcess = workerQueuesEnv.split(',').map(q => q.trim()) as AgentType[];
    logger.info({ workerQueues: queuesToProcess }, 'Worker configured to process specific queues');
  } else {
    // Default to all queues if WORKER_QUEUES is not set
    queuesToProcess = [
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
      'osint',
      'xss',
      'sqli',
      'webvulns',
      'jsanalysis',
      'cloudmisconfig',
      'high-cpu-queue',
      'network-io-queue',
    ];
    logger.info('Worker configured to process all queues (WORKER_QUEUES not set)');
  }

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
  const osintAgent = new OsintAgent();
  const xssAgent = new XssAgent();
  const sqliAgent = new SqliAgent();
  const webVulnsAgent = new WebVulnsAgent();
  const jsAnalysisAgent = new JsAnalysisAgent();
  const cloudMisconfigAgent = new CloudMisconfigAgent();

  // Map agent types to their instances and default concurrency
  const agentMap = new Map<AgentType, { instance: any; concurrency: number }>([
    ['discovery', { instance: discoveryAgent, concurrency: 150 }],
    ['subdomain', { instance: subdomainAgent, concurrency: 200 }],
    ['bruteforce', { instance: bruteforceAgent, concurrency: 120 }],
    ['fingerprint', { instance: fingerprintAgent, concurrency: 250 }],
    ['crawl', { instance: crawlAgent, concurrency: 150 }],
    ['scanner', { instance: scannerAgent, concurrency: Math.max(120, config.worker.workerConcurrency * 15) }],
    ['confirm', { instance: confirmAgent, concurrency: 150 }],
    ['triage', { instance: triageAgent, concurrency: 120 }],
    ['interact', { instance: interactAgent, concurrency: 40 }],
    ['portscan', { instance: portScanAgent, concurrency: 36 }],
    ['osint', { instance: osintAgent, concurrency: 40 }],
    ['xss', { instance: xssAgent, concurrency: 80 }],
    ['sqli', { instance: sqliAgent, concurrency: 60 }],
    ['webvulns', { instance: webVulnsAgent, concurrency: 100 }],
    ['jsanalysis', { instance: jsAnalysisAgent, concurrency: 60 }],
    ['cloudmisconfig', { instance: cloudMisconfigAgent, concurrency: 48 }],
    ['high-cpu-queue', { instance: null, concurrency: config.worker.workerConcurrency }], // Placeholder for specialized queue
    ['network-io-queue', { instance: null, concurrency: config.worker.workerConcurrency }], // Placeholder for specialized queue
  ]);

  // Create workers for the queues this instance should process
  for (const queueName of queuesToProcess) {
    const agentConfig = agentMap.get(queueName);
    if (agentConfig) {
      // Handle specialized queues without a direct agent instance
      if (queueName === 'high-cpu-queue' || queueName === 'network-io-queue') {
        queue.createWorker([queueName], async (job) => {
          logger.info({ queue: queueName, jobId: job.id }, 'Processing specialized queue job');
          // For specialized queues, the job data itself should contain the agent type and options
          // This worker acts as a dispatcher or a generic processor for these queues
          // Further logic would be needed here to dynamically load/dispatch based on job.data.type
          return { status: 'processed_by_specialized_queue' };
        }, { concurrency: agentConfig.concurrency });
      } else if (agentConfig.instance) {
        // Normal agent queues - use processWithTracing for OTEL observability
        queue.createWorker([queueName], async (job) => {
          const result = await agentConfig.instance.processWithTracing(job as any);
          await autoOrchestrator.onJobComplete(job.id!);
          await orchestrator.onJobComplete(job.id!, queueName, job.data.programId, result); // Call orchestrator
          return result;
        }, { concurrency: agentConfig.concurrency });
      }
    } else {
      logger.warn({ queueName }, 'No agent configuration found for queue, skipping worker creation');
    }
  }

  const workerStats: any = {};
  for (const queueName of queuesToProcess) {
    const agentConfig = agentMap.get(queueName);
    if (agentConfig) {
      workerStats[queueName] = agentConfig.concurrency;
    }
  }

  logger.info({ concurrency: workerStats }, 'All workers started successfully');

  // Build worker stats message
  let workerStatsMessage = `*Workers Started:*\n`;
  for (const [queueName, concurrency] of Object.entries(workerStats)) {
    workerStatsMessage += `• ${queueName}: ${concurrency}\n`;
  }

  // Send Telegram notification about workers starting
  await notification.notifyOps(
    '✅ AgentHunt Workers Started',
    `All AgentHunt workers have been started successfully!\n\n${workerStatsMessage}`,
    'info'
  );
}

// Start workers
startWorkers().catch((error) => {
  logger.error({ error }, 'Fatal error starting workers');
  process.exit(1);
});
