import { Router } from 'express';
import { DashboardService } from '../../services/dashboard';

const router = Router();
const dashboardService = new DashboardService();

router.get('/stats', async (req, res) => {
  try {
    const stats = await dashboardService.getHandoffStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/recent-handoffs', async (req, res) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 10;
    const handoffs = await dashboardService.getRecentHandoffs(limit);
    res.json(handoffs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
