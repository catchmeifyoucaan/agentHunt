// Initialize OpenTelemetry tracing FIRST (must be before other imports)
import './services/tracing';

import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import config from './config';
import logger from './utils/logger';
import database from './services/database';
import events from './services/events';
import queue from './services/queue';
import notification from './services/notification';

// Import routes
import programsRouter from './api/routes/programs';
import jobsRouter from './api/routes/jobs';
import managerRouter from './api/routes/manager';
import exportsRouter from './api/routes/exports';
import submissionsRouter from './api/routes/submissions';
import integrationsRouter from './api/routes/integrations';
import settingsRouter from './api/routes/settings';
import uploadsRouter from './api/routes/uploads';
import observabilityRouter from './api/routes/observability';
import knowledgeRouter from './api/routes/knowledge';
import certMonitorRouter from './routes/cert-monitor';
import patternsRouter from './routes/patterns';
import agentGraphRouter from './routes/agent-graph';

// Initialize Express
const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: false, // Disable CSP for API
}));
app.use(cors({
  origin: true, // Allow all origins in development
  credentials: true,
}));
app.use(compression() as any);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
  windowMs: config.security.rateLimitWindowMs,
  max: config.security.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

// Health check - comprehensive system status
app.get('/health', async (req, res) => {
  try {
    const [dbHealthy, redisHealthy, queueStats, binaries] = await Promise.all([
      database.healthCheck(),
      checkRedisHealth(),
      getQueueStats(),
      checkCriticalBinaries(),
    ]);

    const services = {
      database: {
        status: dbHealthy ? 'healthy' : 'unhealthy',
        details: dbHealthy ? 'Connected' : 'Connection failed',
      },
      redis: {
        status: redisHealthy ? 'healthy' : 'unhealthy',
        details: redisHealthy ? 'Connected' : 'Connection failed',
      },
      queues: {
        status: redisHealthy ? 'healthy' : 'unhealthy',
        stats: queueStats,
      },
      workers: {
        status: 'running',
        details: 'Check PM2 status for worker health',
      },
      binaries: {
        status: binaries.allPresent ? 'healthy' : 'unhealthy',
        details: binaries.allPresent ? 'All critical binaries found' : 'Some critical binaries missing',
        missing: binaries.missing,
        present: binaries.present,
      },
    };

    const allHealthy = dbHealthy && redisHealthy && binaries.allPresent;
    const status = allHealthy ? 'healthy' : 'degraded';

    res.status(allHealthy ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      version: config.apiVersion,
      uptime: process.uptime(),
      services,
    });
  } catch (error) {
    logger.error({ error }, 'Health check error');
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      version: config.apiVersion,
      error: 'Health check failed',
    });
  }
});

// Helper function to check Redis health
async function checkRedisHealth(): Promise<boolean> {
  try {
    const queues = queue.getAllQueues();
    if (queues.size === 0) return false;

    // Try to get counts from one queue to verify Redis connection
    const firstQueue = queues.values().next().value;
    await firstQueue.getJobCounts();
    return true;
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    return false;
  }
}

// Helper function to get queue statistics
async function getQueueStats(): Promise<any> {
  try {
    const queues = queue.getAllQueues();
    const stats: any = {};

    for (const [name, queueInstance] of queues.entries()) {
      try {
        const counts = await queueInstance.getJobCounts();
        stats[name] = {
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          completed: counts.completed || 0,
          failed: counts.failed || 0,
        };
      } catch (error) {
        stats[name] = { error: 'Failed to get counts' };
      }
    }

    return stats;
  } catch (error) {
    logger.error({ error }, 'Failed to get queue stats');
    return { error: 'Failed to retrieve queue statistics' };
  }
}

// Helper function to check critical binaries exist
async function checkCriticalBinaries(): Promise<{
  allPresent: boolean;
  missing: string[];
  present: string[];
}> {
  const criticalBinaries = [
    { name: 'subfinder', path: config.tools.subfinder },
    { name: 'httpx', path: config.tools.httpx },
    { name: 'naabu', path: config.tools.naabu },
    { name: 'nuclei', path: config.tools.nuclei },
  ];

  const missing: string[] = [];
  const present: string[] = [];

  for (const binary of criticalBinaries) {
    try {
      await fs.access(binary.path, fsSync.constants.F_OK);
      present.push(binary.name);
    } catch (error) {
      missing.push(binary.name);
      logger.warn({ binary: binary.name, path: binary.path }, 'Critical binary not found');
    }
  }

  return {
    allPresent: missing.length === 0,
    missing,
    present,
  };
}

// API routes
app.use('/api/v1/programs', programsRouter);
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/manager', managerRouter);
app.use('/api/v1/exports', exportsRouter);
app.use('/api/v1/submissions', submissionsRouter);
app.use('/api/v1/integrations', integrationsRouter);
app.use('/api/v1/settings', settingsRouter);
app.use('/api/v1/uploads', uploadsRouter);
app.use('/api/v1/observability', observabilityRouter);
app.use('/api/v1/knowledge', knowledgeRouter);
app.use('/api/v1/cert-monitor', certMonitorRouter);
app.use('/api/v1/patterns', patternsRouter);
app.use('/api/v1/agent-graph', agentGraphRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err, path: req.path }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize WebSocket for events
events.initializeWebSocket(server);

// Start server
const PORT = config.port;

server.listen(PORT, async () => {
  logger.info({
    port: PORT,
    env: config.env,
    version: config.apiVersion,
  }, 'AgentHunt API server started');

  // Send Telegram notification
  await notification.notifyBackendStarted(PORT);

  // Start cleanup task for stuck jobs (runs every 5 minutes)
  setInterval(async () => {
    try {
      const result = await database.query(
        `UPDATE jobs 
         SET status = 'cancelled', 
             error = 'Auto-cancelled: Job running for more than 30 minutes'
         WHERE status = 'active' 
           AND started_at IS NOT NULL
           AND started_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
         RETURNING id, type`
      );

      if (result.rows.length > 0) {
        logger.warn(
          { count: result.rows.length, jobs: result.rows },
          'Auto-cancelled stuck jobs'
        );
        
        // Remove from queue
        for (const row of result.rows) {
          try {
            await queue.removeJob(row.type as any, row.id);
          } catch (err) {
            logger.error({ error: err, jobId: row.id }, 'Failed to remove job from queue');
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup stuck jobs');
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // Run cleanup immediately on startup
  setTimeout(async () => {
    try {
      const result = await database.query(
        `UPDATE jobs 
         SET status = 'cancelled', 
             error = 'Auto-cancelled: Job running for more than 30 minutes'
         WHERE status = 'active' 
           AND started_at IS NOT NULL
           AND started_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
         RETURNING id, type`
      );

      if (result.rows.length > 0) {
        logger.warn(
          { count: result.rows.length, jobs: result.rows },
          'Auto-cancelled stuck jobs on startup'
        );
        
        for (const row of result.rows) {
          try {
            await queue.removeJob(row.type as any, row.id);
          } catch (err) {
            logger.error({ error: err, jobId: row.id }, 'Failed to remove job from queue');
          }
        }
      }
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup stuck jobs on startup');
    }
  }, 5000); // Run after 5 seconds
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully');

  server.close(async () => {
    await database.close();
    await events.close();
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully');

  server.close(async () => {
    await database.close();
    await events.close();
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
