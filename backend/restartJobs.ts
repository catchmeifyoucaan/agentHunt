import { QueueService } from './src/services/queue';
import logger from './src/utils/logger';
import { AgentType } from './shared/types'; // Assuming shared types are accessible

async function restartJobs() {
  const queueService = QueueService;

  const agentTypes: AgentType[] = [
    'discovery', 'subdomain', 'bruteforce', 'fingerprint', 'crawl', 'portscan',
    'scanner', 'interact', 'confirm', 'triage', 'manager', 'osint', 'xss',
    'sqli', 'webvulns', 'jsanalysis', 'cloudmisconfig',
  ];

  logger.info('Attempting to restart failed and pending jobs...');

  for (const type of agentTypes) {
    try {
      const queue = queueService['queues'].get(type); // Access private 'queues' map
      if (!queue) {
        logger.warn(`Queue ${type} not found, skipping.`);
        continue;
      }

      // Get failed jobs
      const failedJobs = await queue.getFailed();
      logger.info(`Found ${failedJobs.length} failed jobs in ${type} queue.`);
      for (const job of failedJobs) {
        logger.info(`Restarting failed job ${job.id} from ${type} queue.`);
        await queue.add(type, job.data, { jobId: job.id, attempts: job.opts.attempts });
        await job.remove(); // Remove the old failed job
      }

      // Get pending (waiting) jobs
      const waitingJobs = await queue.getWaiting();
      logger.info(`Found ${waitingJobs.length} pending jobs in ${type} queue.`);
      for (const job of waitingJobs) {
        logger.info(`Restarting pending job ${job.id} from ${type} queue.`);
        await queue.add(type, job.data, { jobId: job.id, attempts: job.opts.attempts });
        await job.remove(); // Remove the old pending job
      }

    } catch (error) {
      logger.error({ error, queueType: type }, `Error restarting jobs for queue ${type}`);
    }
  }
  logger.info('Finished attempting to restart jobs.');
  await queueService.close(); // Close the queue connection after operations
}

restartJobs().catch((error) => {
  logger.error({ error: error.message, stack: error.stack }, 'Unhandled error in restartJobs script');
  process.exit(1);
});
