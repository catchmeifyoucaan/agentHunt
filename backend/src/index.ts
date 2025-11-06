import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import config from './config';
import logger from './utils/logger';
import database from './services/database';
import events from './services/events';

// Import routes
import programsRouter from './api/routes/programs';
import jobsRouter from './api/routes/jobs';
import managerRouter from './api/routes/manager';

// Initialize Express
const app = express();
const server = http.createServer(app);

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
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

// Health check
app.get('/health', async (req, res) => {
  const dbHealthy = await database.healthCheck();
  const status = dbHealthy ? 'healthy' : 'unhealthy';

  res.status(dbHealthy ? 200 : 503).json({
    status,
    timestamp: new Date().toISOString(),
    version: config.apiVersion,
  });
});

// API routes
app.use('/api/v1/programs', programsRouter);
app.use('/api/v1/jobs', jobsRouter);
app.use('/api/v1/manager', managerRouter);

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

server.listen(PORT, () => {
  logger.info({
    port: PORT,
    env: config.env,
    version: config.apiVersion,
  }, 'AgentHunt API server started');
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
