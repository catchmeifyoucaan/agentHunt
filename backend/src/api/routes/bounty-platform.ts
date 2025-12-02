/**
 * Bounty Platform API Routes
 * 
 * Full HackerOne/Bugcrowd/Intigriti integration endpoints
 */

import { Router, Request, Response } from 'express';
import { bountyPlatform } from '../../services/bounty-platform-integration';
import logger from '../../utils/logger';

const router = Router();

// ============================================
// Authentication
// ============================================

router.post('/auth', async (req: Request, res: Response) => {
  try {
    const { platform, identifier, token } = req.body;
    const success = await bountyPlatform.addCredentials({
      platform,
      identifier,
      token,
      enabled: true,
    });
    res.json({ success, message: success ? 'Authenticated' : 'Authentication failed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Programs
// ============================================

router.get('/programs', async (req: Request, res: Response) => {
  try {
    const programs = bountyPlatform.getPrograms();
    res.json({ programs, count: programs.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/programs/sync', async (req: Request, res: Response) => {
  try {
    const { platform = 'hackerone' } = req.body;
    const programs = await bountyPlatform.syncPrograms(platform);
    res.json({ success: true, programs, count: programs.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/programs/:platform/:handle/scope', (req: Request, res: Response) => {
  const { platform, handle } = req.params;
  const { target } = req.query;
  
  if (target) {
    const result = bountyPlatform.checkScope(target as string, `${platform}:${handle}`);
    res.json(result);
  } else {
    const programs = bountyPlatform.getPrograms();
    const program = programs.find(p => p.platform === platform && p.handle === handle);
    res.json({ assets: program?.assets || [] });
  }
});

// ============================================
// Findings
// ============================================

router.get('/findings', (req: Request, res: Response) => {
  const findings = bountyPlatform.getFindings();
  res.json({ findings, count: findings.length });
});

router.post('/findings', async (req: Request, res: Response) => {
  try {
    const finding = await bountyPlatform.registerFinding(req.body);
    res.json({ success: true, finding });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/findings/:id/process', async (req: Request, res: Response) => {
  try {
    const findings = bountyPlatform.getFindings();
    const finding = findings.find(f => f.id === req.params.id);
    if (!finding) {
      return res.status(404).json({ error: 'Finding not found' });
    }
    const result = await bountyPlatform.processFinding(finding);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Drafts
// ============================================

router.get('/drafts', (req: Request, res: Response) => {
  const drafts = bountyPlatform.getDrafts();
  res.json({ drafts, count: drafts.length });
});

router.post('/drafts/generate/:findingId', async (req: Request, res: Response) => {
  try {
    const draft = await bountyPlatform.generateDraft(req.params.findingId);
    res.json({ success: true, draft });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/drafts/:id/submit', async (req: Request, res: Response) => {
  try {
    const report = await bountyPlatform.submitDraft(req.params.id);
    res.json({ success: true, report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Reports
// ============================================

router.get('/reports', async (req: Request, res: Response) => {
  try {
    const reports = await bountyPlatform.syncReports();
    res.json({ reports, count: reports.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Stats
// ============================================

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await bountyPlatform.getStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// Settings
// ============================================

router.post('/settings/auto-submit', (req: Request, res: Response) => {
  const { enabled, minConfidence, severities, requireApproval } = req.body;
  bountyPlatform.configureAutoSubmit({ enabled, minConfidence, severities, requireApproval });
  res.json({ success: true });
});

export default router;
