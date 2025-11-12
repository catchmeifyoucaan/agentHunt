/**
 * One-time script to process all untagged subdomains
 * This will tag them as internal/external and create fingerprint/portscan jobs
 */

import database from './src/services/database';
import queue from './src/services/queue';
import logger from './src/utils/logger';
import { v4 as uuidv4 } from 'uuid';

async function processUntaggedSubdomains() {
  try {
    const programId = '1b245aae-e17d-4bd1-a3c3-cb6acb0034e9';

    // Create a fake completed subdomain job to trigger auto-orchestrator
    const fakeJobId = uuidv4();

    await database.query(
      `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata, created_at)
       VALUES ($1, 'subdomain', $2, 5, 'completed', 0, 3, '{}', '{"requestedBy": "manual-trigger"}', NOW())`,
      [fakeJobId, programId]
    );

    logger.info({ fakeJobId, programId }, 'Created fake job to trigger auto-orchestrator');

    // Import and call auto-orchestrator
    const autoOrchestrator = (await import('./src/services/auto-orchestrator')).default;
    await autoOrchestrator.onJobComplete(fakeJobId);

    logger.info('Finished processing all untagged subdomains');

    // Give it time to create jobs
    setTimeout(() => process.exit(0), 5000);
  } catch (error) {
    logger.error({ error }, 'Failed to process untagged subdomains');
    process.exit(1);
  }
}

processUntaggedSubdomains();
