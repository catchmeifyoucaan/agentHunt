/**
 * Evolution System API Routes
 *
 * Real-time monitoring and control for Phase 4 Evolution features:
 * - Tool auto-generation
 * - Auto-debugging
 * - Causal learning
 * - Self-analysis & pivoting
 */

import { Router } from 'express';
import { toolGenerator } from '../../services/evolution/tool-generator';
import { autoDebugger } from '../../services/evolution/auto-debugger';
import { causalLearner } from '../../services/evolution/causal-learner';
import { selfAnalyzer } from '../../services/evolution/self-analyzer';
import logger from '../../utils/logger';

const router = Router();

// ==============================================
// Tool Generation
// ==============================================

/**
 * Generate a custom tool
 * POST /api/v1/evolution/tools/generate
 */
router.post('/tools/generate', async (req, res) => {
  try {
    const { purpose, language, inputs, outputs, requirements, testCases, constraints } = req.body;

    if (!purpose || !language) {
      return res.status(400).json({ error: 'Purpose and language are required' });
    }

    const tool = await toolGenerator.generateTool({
      purpose,
      language,
      inputs: inputs || [],
      outputs: outputs || [],
      requirements: requirements || [],
      testCases,
      constraints,
    });

    res.json({
      success: true,
      tool: {
        id: tool.id,
        name: tool.name,
        language: tool.language,
        tested: tool.tested,
        successRate: tool.successRate,
        code: tool.code,
        testResults: tool.testResults,
        debugHistory: tool.debugHistory,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Tool generation failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Search for existing tools
 * GET /api/v1/evolution/tools/search?q=keyword
 */
router.get('/tools/search', async (req, res) => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      return res.status(400).json({ error: 'Search query is required' });
    }

    const tools = await toolGenerator.searchTools(q);

    res.json({
      success: true,
      tools: tools.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        language: t.language,
        tested: t.tested,
        successRate: t.successRate,
        updatedAt: t.updatedAt,
      })),
      count: tools.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Tool search failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get working tools (high success rate)
 * GET /api/v1/evolution/tools/working
 */
router.get('/tools/working', async (req, res) => {
  try {
    const minSuccessRate = parseFloat(req.query.minSuccessRate as string) || 0.8;

    const tools = await toolGenerator.getWorkingTools(minSuccessRate);

    res.json({
      success: true,
      tools: tools.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        language: t.language,
        successRate: t.successRate,
        updatedAt: t.updatedAt,
      })),
      count: tools.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get working tools');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get tool generation statistics
 * GET /api/v1/evolution/tools/stats
 */
router.get('/tools/stats', async (req, res) => {
  try {
    const stats = await toolGenerator.getStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get tool stats');
    res.status(500).json({ error: error.message });
  }
});

// ==============================================
// Auto-Debugging
// ==============================================

/**
 * Debug code
 * POST /api/v1/evolution/debug
 */
router.post('/debug', async (req, res) => {
  try {
    const { code, language, error, errorType, stackTrace, context, constraints } = req.body;

    if (!code || !language || !error) {
      return res.status(400).json({ error: 'Code, language, and error are required' });
    }

    const result = await autoDebugger.debugCode({
      code,
      language,
      error,
      errorType,
      stackTrace,
      context,
      constraints,
    });

    res.json({
      success: true,
      debug: {
        id: result.id,
        success: result.success,
        fixedCode: result.fixedCode,
        attempts: result.attempts.length,
        attemptDetails: result.attempts.map(a => ({
          attemptNumber: a.attemptNumber,
          analysis: a.analysis,
          proposedFix: a.proposedFix,
          testSuccess: a.testSuccess,
          error: a.error,
        })),
        finalError: result.finalError,
        duration: result.duration,
        learningAdded: result.learningAdded,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Debug failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get debugging statistics
 * GET /api/v1/evolution/debug/stats
 */
router.get('/debug/stats', async (req, res) => {
  try {
    const stats = await autoDebugger.getStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get debug stats');
    res.status(500).json({ error: error.message });
  }
});

// ==============================================
// Causal Learning
// ==============================================

/**
 * Record observation for learning
 * POST /api/v1/evolution/causal/observe
 */
router.post('/causal/observe', async (req, res) => {
  try {
    const { action, context, outcome } = req.body;

    if (!action || !context || !outcome) {
      return res.status(400).json({ error: 'Action, context, and outcome are required' });
    }

    await causalLearner.learnFromObservation({
      action,
      context,
      outcome,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      message: 'Observation recorded and learning updated',
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to record observation');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Predict outcome of action
 * POST /api/v1/evolution/causal/predict
 */
router.post('/causal/predict', async (req, res) => {
  try {
    const { action, context } = req.body;

    if (!action || !context) {
      return res.status(400).json({ error: 'Action and context are required' });
    }

    const prediction = await causalLearner.predictOutcome(action, context);

    res.json({
      success: true,
      prediction: {
        action: prediction.action,
        predictedOutcome: prediction.predictedOutcome,
        confidence: prediction.confidence,
        supportingRulesCount: prediction.supportingRules.length,
        alternatives: prediction.alternativeOutcomes.map(a => ({
          outcome: a.outcome,
          probability: a.probability,
        })),
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Prediction failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get recommended actions for goal
 * POST /api/v1/evolution/causal/recommend
 */
router.post('/causal/recommend', async (req, res) => {
  try {
    const { desiredOutcome, context } = req.body;

    if (!desiredOutcome || !context) {
      return res.status(400).json({ error: 'Desired outcome and context are required' });
    }

    const recommendations = await causalLearner.recommendActions(desiredOutcome, context);

    res.json({
      success: true,
      recommendations: recommendations.map(r => ({
        action: r.action,
        confidence: r.confidence,
        supportingRulesCount: r.rules.length,
      })),
    });
  } catch (error: any) {
    logger.error({ error }, 'Recommendation failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get causal learning statistics
 * GET /api/v1/evolution/causal/stats
 */
router.get('/causal/stats', async (req, res) => {
  try {
    const stats = await causalLearner.getStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get causal stats');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Export causal rules
 * GET /api/v1/evolution/causal/rules
 */
router.get('/causal/rules', async (req, res) => {
  try {
    const rules = causalLearner.exportRules();

    res.json({
      success: true,
      rules: rules.slice(0, 100).map(r => ({ // Limit to top 100
        id: r.id,
        action: r.action,
        effect: r.effect,
        confidence: r.confidence,
        supportCount: r.supportCount,
        lastSeenAt: r.lastSeenAt,
      })),
      totalRules: rules.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to export rules');
    res.status(500).json({ error: error.message });
  }
});

// ==============================================
// Self-Analysis & Pivoting
// ==============================================

/**
 * Analyze performance
 * POST /api/v1/evolution/analyze
 */
router.post('/analyze', async (req, res) => {
  try {
    const metrics = req.body;

    if (!metrics.agentId || !metrics.sessionId) {
      return res.status(400).json({ error: 'Agent ID and session ID are required' });
    }

    const analysis = await selfAnalyzer.analyzePerformance({
      ...metrics,
      timestamp: new Date(),
    });

    res.json({
      success: true,
      analysis: {
        overallScore: analysis.overallScore,
        bottlenecks: analysis.bottlenecks,
        strengths: analysis.strengths,
        weaknesses: analysis.weaknesses,
        comparisonToBaseline: analysis.comparisonToBaseline,
        pivotRecommended: analysis.pivotRecommended,
        pivotStrategy: analysis.pivotStrategy,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Analysis failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Execute pivot strategy
 * POST /api/v1/evolution/pivot
 */
router.post('/pivot', async (req, res) => {
  try {
    const { agentId, strategy, beforeMetrics } = req.body;

    if (!agentId || !strategy || !beforeMetrics) {
      return res.status(400).json({
        error: 'Agent ID, strategy, and before metrics are required',
      });
    }

    const result = await selfAnalyzer.executePivot(agentId, strategy, beforeMetrics);

    res.json({
      success: true,
      pivot: {
        strategyId: result.strategyId,
        applied: result.applied,
        success: result.success,
        learnings: result.learnings,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Pivot execution failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get analysis history
 * GET /api/v1/evolution/analyze/history/:agentId
 */
router.get('/analyze/history/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    const history = await selfAnalyzer.getAnalysisHistory(agentId, limit);

    res.json({
      success: true,
      history,
      count: history.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get analysis history');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get pivot statistics
 * GET /api/v1/evolution/pivot/stats
 */
router.get('/pivot/stats', async (req, res) => {
  try {
    const stats = await selfAnalyzer.getPivotStats();

    res.json({
      success: true,
      stats,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get pivot stats');
    res.status(500).json({ error: error.message });
  }
});

// ==============================================
// Monitoring Dashboard
// ==============================================

/**
 * Get comprehensive evolution system status
 * GET /api/v1/evolution/status
 */
router.get('/status', async (req, res) => {
  try {
    const [toolStats, debugStats, causalStats, pivotStats] = await Promise.all([
      toolGenerator.getStats(),
      autoDebugger.getStats(),
      causalLearner.getStats(),
      selfAnalyzer.getPivotStats(),
    ]);

    res.json({
      success: true,
      status: {
        toolGeneration: {
          totalTools: toolStats.totalTools,
          testedTools: toolStats.testedTools,
          workingTools: toolStats.workingTools,
          avgSuccessRate: toolStats.avgSuccessRate,
          byLanguage: toolStats.byLanguage,
        },
        autoDebugging: {
          totalPatterns: debugStats.totalPatterns,
          avgConfidence: debugStats.avgConfidence,
          byLanguage: debugStats.byLanguage,
          topPatterns: debugStats.topPatterns.slice(0, 5),
        },
        causalLearning: {
          totalRules: causalStats.totalRules,
          avgConfidence: causalStats.avgConfidence,
          byAction: causalStats.byAction,
          topRules: causalStats.topRules.slice(0, 5),
        },
        selfAnalysis: {
          totalPivots: pivotStats.totalPivots,
          successfulPivots: pivotStats.successfulPivots,
          avgImpactSpeed: pivotStats.avgImpactSpeed,
          avgImpactQuality: pivotStats.avgImpactQuality,
        },
      },
      timestamp: new Date(),
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get evolution status');
    res.status(500).json({ error: error.message });
  }
});

export default router;
