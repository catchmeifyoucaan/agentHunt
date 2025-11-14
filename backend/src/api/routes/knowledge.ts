/**
 * Knowledge Base API Routes
 *
 * REST API endpoints for shared knowledge base:
 * - GET /knowledge/stats - Get knowledge base statistics
 * - GET /knowledge/discoveries - Get all discoveries
 * - GET /knowledge/strategies - Get successful attack strategies
 * - GET /knowledge/metadata - Get target metadata
 */

import { Router, Request, Response } from 'express';
import logger from '../../utils/logger';
import database from '../../services/database';
import researchEngine from '../../services/knowledge/research-engine';
import knowledgeStore from '../../services/knowledge/knowledge-store';

const router = Router();

/**
 * GET /api/v1/knowledge/stats
 * Get knowledge base statistics
 */
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const { programId } = req.query;

    // Get discovery counts by severity (findings table doesn't have 'type' column)
    const discoveryStatsQuery = programId
      ? `SELECT
           COUNT(*) FILTER (WHERE severity = 'critical') as critical,
           COUNT(*) FILTER (WHERE severity = 'high') as high,
           COUNT(*) FILTER (WHERE severity = 'medium') as medium,
           COUNT(*) FILTER (WHERE severity = 'low') as low,
           COUNT(*) FILTER (WHERE severity = 'info') as info,
           COUNT(*) as total
         FROM findings WHERE program_id = $1`
      : `SELECT
           COUNT(*) FILTER (WHERE severity = 'critical') as critical,
           COUNT(*) FILTER (WHERE severity = 'high') as high,
           COUNT(*) FILTER (WHERE severity = 'medium') as medium,
           COUNT(*) FILTER (WHERE severity = 'low') as low,
           COUNT(*) FILTER (WHERE severity = 'info') as info,
           COUNT(*) as total
         FROM findings`;

    const discoveryStats = programId
      ? await database.query(discoveryStatsQuery, [programId])
      : await database.query(discoveryStatsQuery);

    // Get strategy stats
    const strategyStatsQuery = programId
      ? `SELECT
           COUNT(*) FILTER (WHERE severity = 'critical' OR severity = 'high') as sqli,
           COUNT(*) FILTER (WHERE severity = 'medium') as xss,
           COUNT(*) FILTER (WHERE severity = 'low') as rce,
           COUNT(*) as total
         FROM findings WHERE program_id = $1`
      : `SELECT
           COUNT(*) FILTER (WHERE severity = 'critical' OR severity = 'high') as sqli,
           COUNT(*) FILTER (WHERE severity = 'medium') as xss,
           COUNT(*) FILTER (WHERE severity = 'low') as rce,
           COUNT(*) as total
         FROM findings`;

    const strategyStats = programId
      ? await database.query(strategyStatsQuery, [programId])
      : await database.query(strategyStatsQuery);

    // Get metadata stats
    const metadataStatsQuery = programId
      ? `SELECT COUNT(*) as total FROM assets WHERE program_id = $1 AND metadata IS NOT NULL`
      : `SELECT COUNT(*) as total FROM assets WHERE metadata IS NOT NULL`;

    const metadataStats = programId
      ? await database.query(metadataStatsQuery, [programId])
      : await database.query(metadataStatsQuery);

    // Calculate average success rate based on confidence scores
    const successRateQuery = programId
      ? `SELECT AVG(confidence) as avg_success_rate FROM findings WHERE program_id = $1 AND status != 'false_positive'`
      : `SELECT AVG(confidence) as avg_success_rate FROM findings WHERE status != 'false_positive'`;

    const successRateStats = programId
      ? await database.query(successRateQuery, [programId])
      : await database.query(successRateQuery);

    const discoveries = discoveryStats.rows[0] || {};
    const strategies = strategyStats.rows[0] || {};
    const avgSuccessRate = parseFloat(successRateStats.rows[0]?.avg_success_rate || '0');

    res.json({
      discoveries: {
        total: parseInt(discoveries.total || '0'),
        byType: {
          critical: parseInt(discoveries.critical || '0'),
          high: parseInt(discoveries.high || '0'),
          medium: parseInt(discoveries.medium || '0'),
          low: parseInt(discoveries.low || '0'),
          info: parseInt(discoveries.info || '0'),
        },
      },
      strategies: {
        total: parseInt(strategies.total || '0'),
        byType: {
          sqli: parseInt(strategies.sqli || '0'),
          xss: parseInt(strategies.xss || '0'),
          rce: parseInt(strategies.rce || '0'),
        },
        avgSuccessRate: Math.round(avgSuccessRate * 100) / 100, // Round to 2 decimal places
      },
      metadata: {
        total: parseInt(metadataStats.rows[0]?.total || '0'),
      },
      agentContributions: {}, // Empty for now, will be populated by agent graph system
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get knowledge base stats');
    res.status(500).json({
      error: 'Failed to get knowledge base stats',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/knowledge/discoveries
 * Get recent discoveries
 */
router.get('/discoveries', async (req: Request, res: Response) => {
  try {
    const { programId, limit = 50, type } = req.query;

    let query = `
      SELECT
        id,
        program_id,
        asset_id,
        title as target,
        severity as type,
        description as details,
        created_at as timestamp,
        confidence
      FROM findings
    `;

    const params: any[] = [];
    const conditions: string[] = [];

    if (programId) {
      params.push(programId);
      conditions.push(`program_id = $${params.length}`);
    }

    if (type) {
      params.push(type);
      conditions.push(`severity = $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string));

    const result = await database.query(query, params);

    res.json({
      discoveries: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get discoveries');
    res.status(500).json({
      error: 'Failed to get discoveries',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/knowledge/strategies
 * Get successful attack strategies
 */
router.get('/strategies', async (req: Request, res: Response) => {
  try {
    const { programId, limit = 50 } = req.query;

    let query = `
      SELECT
        id,
        severity as type,
        title as technique,
        evidence->>'payload' as payload,
        1 as success_count,
        1 as attempt_count,
        confidence as success_rate,
        created_at as timestamp
      FROM findings
      WHERE confidence > 0.5
    `;

    const params: any[] = [];

    if (programId) {
      params.push(programId);
      query += ` AND program_id = $${params.length}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string));

    const result = await database.query(query, params);

    res.json({
      strategies: result.rows,
      count: result.rows.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get strategies');
    res.status(500).json({
      error: 'Failed to get strategies',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/knowledge/metadata
 * Get target metadata
 */
router.get('/metadata', async (req: Request, res: Response) => {
  try {
    const { programId, limit = 50 } = req.query;

    let query = `
      SELECT
        value as target,
        metadata->'technologies' as technologies,
        metadata->>'waf' as waf,
        metadata->>'cdn' as cdn,
        metadata->>'httpStatus' as http_status,
        metadata->>'responseTime' as response_time,
        last_scanned as last_checked
      FROM assets
      WHERE metadata IS NOT NULL
    `;

    const params: any[] = [];

    if (programId) {
      params.push(programId);
      query += ` AND program_id = $${params.length}`;
    }

    query += ` ORDER BY last_scanned DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit as string));

    const result = await database.query(query, params);

    res.json({
      metadata: result.rows.map(row => ({
        target: row.target,
        technologies: row.technologies || [],
        waf: row.waf,
        cdn: row.cdn,
        httpStatus: parseInt(row.http_status) || 200,
        responseTime: parseInt(row.response_time) || 0,
        lastChecked: row.last_checked,
      })),
      count: result.rows.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get target metadata');
    res.status(500).json({
      error: 'Failed to get target metadata',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/knowledge/research
 * Research a vulnerability using CVE/ExploitDB/GitHub
 */
router.post('/research', async (req: Request, res: Response) => {
  try {
    const { vulnerability, type } = req.body;

    if (!vulnerability) {
      return res.status(400).json({ error: 'Vulnerability name or description required' });
    }

    const results = await researchEngine.research(vulnerability, type);

    res.json({
      success: true,
      results: {
        cveResults: results.cveResults,
        exploitResults: results.exploitResults,
        githubResults: results.githubResults,
        summary: results.summary,
      },
      cached: false,
    });
  } catch (error: any) {
    logger.error({ error }, 'Research failed');
    res.status(500).json({
      error: 'Research failed',
      message: error.message,
    });
  }
});

/**
 * POST /api/v1/knowledge/store
 * Store discovery in knowledge base
 */
router.post('/store', async (req: Request, res: Response) => {
  try {
    const { discovery } = req.body;

    if (!discovery || !discovery.type || !discovery.target) {
      return res.status(400).json({ error: 'Discovery with type and target required' });
    }

    await knowledgeStore.storeDiscovery(discovery);

    res.json({
      success: true,
      message: 'Discovery stored successfully',
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to store discovery');
    res.status(500).json({
      error: 'Failed to store discovery',
      message: error.message,
    });
  }
});

/**
 * GET /api/v1/knowledge/similar
 * Find similar vulnerabilities using vector search
 */
router.get('/similar', async (req: Request, res: Response) => {
  try {
    const { query, limit = 10 } = req.query;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({ error: 'Query string required' });
    }

    const similar = await knowledgeStore.findSimilar(query, parseInt(limit as string));

    res.json({
      success: true,
      similar,
      count: similar.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Similar search failed');
    res.status(500).json({
      error: 'Similar search failed',
      message: error.message,
    });
  }
});

export default router;
