/**
 * Enhanced API Routes
 * Routes for new platform features: Ingestion, Asset Graph, HITL, Policy, AI Ensemble, Reports
 */

import { Router } from 'express';
import { Pool } from 'pg';
import { IngestionService } from '../services/ingestion';
import { AssetGraphService } from '../services/asset-graph';
import { HITLService } from '../services/hitl';
import { PolicyEngineService } from '../services/policy-engine';
import { AIEnsembleService } from '../services/ai-ensemble';
import { ReportGeneratorService } from '../services/report-generator';
import logger from '../utils/logger';

export function createEnhancedRoutes(db: Pool): Router {
  const router = Router();

  // Initialize services
  const ingestionService = new IngestionService(db);
  const assetGraphService = new AssetGraphService(db);
  const hitlService = new HITLService(db);
  const policyEngine = new PolicyEngineService(db);
  const aiEnsemble = new AIEnsembleService(db);
  const reportGenerator = new ReportGeneratorService(db, process.env.ANTHROPIC_API_KEY || '');

  // ========================================================================
  // INGESTION LAYER ROUTES
  // ========================================================================

  /**
   * POST /api/enhanced/ingestion/sources
   * Create a new data source
   */
  router.post('/ingestion/sources', async (req, res) => {
    try {
      const source = await ingestionService.createDataSource(req.body);
      res.json(source);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create data source');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/ingestion/run/:sourceId
   * Run ingestion for a data source
   */
  router.post('/ingestion/run/:sourceId', async (req, res) => {
    try {
      const { sourceId } = req.params;
      const { programId } = req.body;

      const job = await ingestionService.runIngestion(sourceId, programId);
      res.json(job);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to run ingestion');
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================================================
  // ASSET GRAPH ROUTES
  // ========================================================================

  /**
   * POST /api/enhanced/asset-graph/infer/:assetId
   * Infer relationships for an asset
   */
  router.post('/asset-graph/infer/:assetId', async (req, res) => {
    try {
      const { assetId } = req.params;
      const relationships = await assetGraphService.inferRelationships(assetId);
      res.json({ relationships, count: relationships.length });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to infer relationships');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/enhanced/asset-graph/:programId
   * Get asset graph for a program
   */
  router.get('/asset-graph/:programId', async (req, res) => {
    try {
      const { programId } = req.params;
      const graph = await assetGraphService.getAssetGraph(programId);
      res.json(graph);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get asset graph');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/asset-graph/attack-paths/:programId
   * Discover attack paths
   */
  router.post('/asset-graph/attack-paths/:programId', async (req, res) => {
    try {
      const { programId } = req.params;
      const { minRiskScore } = req.body;

      const attackPaths = await assetGraphService.discoverAttackPaths(
        programId,
        minRiskScore || 5.0
      );

      res.json({ attackPaths, count: attackPaths.length });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to discover attack paths');
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================================================
  // HUMAN-IN-THE-LOOP (HITL) ROUTES
  // ========================================================================

  /**
   * POST /api/enhanced/hitl/requests
   * Create an approval request
   */
  router.post('/hitl/requests', async (req, res) => {
    try {
      const { type, requestedBy, action, reason, riskLevel, context, options } = req.body;

      const request = await hitlService.createApprovalRequest(
        type,
        requestedBy,
        action,
        reason,
        riskLevel,
        context,
        options
      );

      res.json(request);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create approval request');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/hitl/requests/:requestId/approve
   * Submit approval/rejection
   */
  router.post('/hitl/requests/:requestId/approve', async (req, res) => {
    try {
      const { requestId } = req.params;
      const { userId, decision, comment } = req.body;

      const request = await hitlService.submitApproval(requestId, userId, decision, comment);

      res.json(request);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to submit approval');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * GET /api/enhanced/hitl/requests/pending
   * Get pending approval requests
   */
  router.get('/hitl/requests/pending', async (req, res) => {
    try {
      const { userId } = req.query;
      const requests = await hitlService.getPendingApprovals(userId as string);
      res.json({ requests, count: requests.length });
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to get pending approvals');
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================================================
  // POLICY ENGINE ROUTES
  // ========================================================================

  /**
   * POST /api/enhanced/policy/rules
   * Create a policy rule
   */
  router.post('/policy/rules', async (req, res) => {
    try {
      const rule = await policyEngine.createPolicyRule(req.body);
      res.json(rule);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create policy rule');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/policy/consent
   * Create a consent record
   */
  router.post('/policy/consent', async (req, res) => {
    try {
      const consent = await policyEngine.createConsentRecord(req.body);
      res.json(consent);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to create consent record');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/policy/check-consent
   * Check if consent exists for a target
   */
  router.post('/policy/check-consent', async (req, res) => {
    try {
      const { programId, target, scope } = req.body;
      const result = await policyEngine.hasConsent(programId, target, scope);
      res.json(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to check consent');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/policy/evaluate
   * Evaluate job against policies
   */
  router.post('/policy/evaluate', async (req, res) => {
    try {
      const { job, asset } = req.body;
      const result = await policyEngine.evaluateJobPolicy(job, asset);
      res.json(result);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to evaluate policy');
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================================================
  // AI ENSEMBLE ROUTES
  // ========================================================================

  /**
   * POST /api/enhanced/ai-ensemble/triage/:findingId
   * Triage a finding with AI ensemble
   */
  router.post('/ai-ensemble/triage/:findingId', async (req, res) => {
    try {
      const { findingId } = req.params;

      // Get finding from database
      const findingResult = await db.query('SELECT * FROM findings WHERE id = $1', [findingId]);

      if (findingResult.rows.length === 0) {
        return res.status(404).json({ error: 'Finding not found' });
      }

      const finding = findingResult.rows[0];

      const ensembleResult = await aiEnsemble.triageFinding({
        id: finding.id,
        programId: finding.program_id,
        assetId: finding.asset_id,
        severity: finding.severity,
        confidence: finding.confidence,
        title: finding.title,
        description: finding.description,
        cvss: finding.cvss,
        cwe: finding.cwe,
        evidence: finding.evidence,
        poc: finding.poc,
        impact: finding.impact,
        remediation: finding.remediation,
        status: finding.status,
        confirmations: finding.confirmations,
        triageResult: finding.triage_result,
        submittedAt: finding.submitted_at,
        createdAt: finding.created_at,
        updatedAt: finding.updated_at,
      });

      res.json(ensembleResult);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to triage with ensemble');
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================================================
  // REPORT GENERATION ROUTES
  // ========================================================================

  /**
   * POST /api/enhanced/reports/generate/:findingId
   * Generate a report for a finding
   */
  router.post('/reports/generate/:findingId', async (req, res) => {
    try {
      const { findingId } = req.params;
      const { platform, useAI } = req.body;

      const report = await reportGenerator.generateReport(
        findingId,
        platform || 'generic',
        useAI !== false
      );

      res.json(report);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to generate report');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/reports/:reportId/review
   * Review and approve a report
   */
  router.post('/reports/:reportId/review', async (req, res) => {
    try {
      const { reportId } = req.params;
      const { reviewedBy, reviewNotes } = req.body;

      const report = await reportGenerator.reviewReport(reportId, reviewedBy, reviewNotes);

      res.json(report);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to review report');
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/enhanced/reports/:reportId/submit
   * Submit a report to a platform
   */
  router.post('/reports/:reportId/submit', async (req, res) => {
    try {
      const { reportId } = req.params;
      const { submitter } = req.body;

      const report = await reportGenerator.submitReport(reportId, submitter);

      res.json(report);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to submit report');
      res.status(500).json({ error: error.message });
    }
  });

  // ========================================================================
  // HEALTH CHECK
  // ========================================================================

  router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      services: {
        ingestion: true,
        assetGraph: true,
        hitl: true,
        policyEngine: true,
        aiEnsemble: true,
        reportGenerator: true,
      },
      timestamp: new Date(),
    });
  });

  return router;
}
