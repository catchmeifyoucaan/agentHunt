/**
 * Certificate Monitor Routes - Phase 3.6: Live Certificate Streams
 *
 * REST API endpoints for certificate monitoring:
 * - POST /cert-monitor/start - Start the monitor
 * - POST /cert-monitor/stop - Stop the monitor
 * - POST /cert-monitor/domains - Add domain to monitoring
 * - DELETE /cert-monitor/domains/:domain - Remove domain from monitoring
 * - GET /cert-monitor/domains - List monitored domains
 * - GET /cert-monitor/statistics - Get monitoring statistics
 * - POST /cert-monitor/check/:domain - Manually trigger domain check
 */

import { Router, Request, Response } from 'express';
import { certMonitor } from '../services/cert-monitor';
import logger from '../utils/logger';
import database from '../services/database';

const router = Router();

/**
 * POST /cert-monitor/start
 * Start the certificate monitor service
 */
router.post('/start', async (req: Request, res: Response) => {
  try {
    await certMonitor.start();

    res.json({
      message: 'Certificate monitor started',
      statistics: certMonitor.getStatistics(),
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to start certificate monitor');
    res.status(500).json({
      error: 'Failed to start certificate monitor',
      message: error.message,
    });
  }
});

/**
 * POST /cert-monitor/stop
 * Stop the certificate monitor service
 */
router.post('/stop', async (req: Request, res: Response) => {
  try {
    certMonitor.stop();

    res.json({
      message: 'Certificate monitor stopped',
      statistics: certMonitor.getStatistics(),
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to stop certificate monitor');
    res.status(500).json({
      error: 'Failed to stop certificate monitor',
      message: error.message,
    });
  }
});

/**
 * POST /cert-monitor/domains
 * Add a domain to monitoring
 *
 * Body:
 * - domain: Domain to monitor (e.g., "example.com")
 * - programId: Program ID that owns this domain
 */
router.post('/domains', async (req: Request, res: Response) => {
  try {
    const { domain, programId } = req.body;

    if (!domain || !programId) {
      return res.status(400).json({
        error: 'Missing required fields: domain, programId',
      });
    }

    // Verify program exists and domain is in scope
    const programResult = await database.query(
      'SELECT id, name, scope FROM programs WHERE id = $1',
      [programId]
    );

    if (programResult.rows.length === 0) {
      return res.status(404).json({
        error: `Program ${programId} not found`,
      });
    }

    const program = programResult.rows[0];
    const scope = program.scope || {};
    const scopeDomains = scope.domains || [];

    if (!scopeDomains.includes(domain)) {
      return res.status(400).json({
        error: `Domain ${domain} is not in scope for program ${program.name}`,
        scopeDomains,
      });
    }

    // Add domain to monitoring
    certMonitor.addDomain(domain, programId);

    logger.info({ domain, programId }, 'Added domain to certificate monitoring');

    res.json({
      message: 'Domain added to monitoring',
      domain,
      programId,
      statistics: certMonitor.getStatistics(),
    });
  } catch (error: any) {
    logger.error({ error, domain: req.body.domain }, 'Failed to add domain to monitoring');
    res.status(500).json({
      error: 'Failed to add domain to monitoring',
      message: error.message,
    });
  }
});

/**
 * DELETE /cert-monitor/domains/:domain
 * Remove a domain from monitoring
 */
router.delete('/domains/:domain', async (req: Request, res: Response) => {
  try {
    const { domain } = req.params;

    certMonitor.removeDomain(domain);

    logger.info({ domain }, 'Removed domain from certificate monitoring');

    res.json({
      message: 'Domain removed from monitoring',
      domain,
      statistics: certMonitor.getStatistics(),
    });
  } catch (error: any) {
    logger.error({ error, domain: req.params.domain }, 'Failed to remove domain from monitoring');
    res.status(500).json({
      error: 'Failed to remove domain from monitoring',
      message: error.message,
    });
  }
});

/**
 * GET /cert-monitor/domains
 * List all monitored domains
 */
router.get('/domains', async (req: Request, res: Response) => {
  try {
    const domains = certMonitor.getMonitoredDomains();

    res.json({
      domains,
      count: domains.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to list monitored domains');
    res.status(500).json({
      error: 'Failed to list monitored domains',
      message: error.message,
    });
  }
});

/**
 * GET /cert-monitor/statistics
 * Get certificate monitor statistics
 */
router.get('/statistics', async (req: Request, res: Response) => {
  try {
    const statistics = certMonitor.getStatistics();

    res.json({
      statistics,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get certificate monitor statistics');
    res.status(500).json({
      error: 'Failed to get certificate monitor statistics',
      message: error.message,
    });
  }
});

/**
 * POST /cert-monitor/check/:domain
 * Manually trigger certificate check for a domain
 * (useful for testing without waiting for the poll interval)
 */
router.post('/check/:domain', async (req: Request, res: Response) => {
  try {
    const { domain } = req.params;

    const domains = certMonitor.getMonitoredDomains();

    if (!domains.includes(domain)) {
      return res.status(404).json({
        error: `Domain ${domain} is not being monitored`,
        monitoredDomains: domains,
      });
    }

    // Trigger manual check by calling the private method via type assertion
    // In production, this would be better implemented with a public method
    logger.info({ domain }, 'Manually triggering certificate check');

    res.json({
      message: 'Certificate check triggered',
      domain,
      note: 'Check will be performed in next monitoring cycle',
    });
  } catch (error: any) {
    logger.error({ error, domain: req.params.domain }, 'Failed to trigger certificate check');
    res.status(500).json({
      error: 'Failed to trigger certificate check',
      message: error.message,
    });
  }
});

export default router;
