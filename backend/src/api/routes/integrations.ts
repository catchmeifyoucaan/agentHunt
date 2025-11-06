import { Router } from 'express';
import HackerOneIntegration from '../../services/integrations/hackerone';
import BugcrowdIntegration from '../../services/integrations/bugcrowd';
import database from '../../services/database';

const router = Router();

// HackerOne Integration
router.get('/hackerone/programs', async (req, res) => {
  try {
    const apiKey = process.env.HACKERONE_API_KEY || '';
    const h1 = new HackerOneIntegration(apiKey);
    const programs = await h1.getPrograms();
    res.json({ programs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/hackerone/sync/:programId', async (req, res) => {
  try {
    const { programId } = req.params;
    const apiKey = process.env.HACKERONE_API_KEY || '';
    const h1 = new HackerOneIntegration(apiKey);

    // Get program details
    const program = await database.query('SELECT * FROM programs WHERE id = $1', [programId]);
    if (program.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    const handle = program.rows[0].metadata?.h1_handle;
    if (!handle) {
      return res.status(400).json({ error: 'HackerOne handle not configured' });
    }

    // Sync scope
    const scope = await h1.getProgramScope(handle);

    res.json({ synced: true, scope });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Bugcrowd Integration
router.get('/bugcrowd/programs', async (req, res) => {
  try {
    const apiKey = process.env.BUGCROWD_API_KEY || '';
    const bc = new BugcrowdIntegration(apiKey);
    const programs = await bc.getPrograms();
    res.json({ programs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/bugcrowd/sync/:programId', async (req, res) => {
  try {
    const { programId } = req.params;
    const apiKey = process.env.BUGCROWD_API_KEY || '';
    const bc = new BugcrowdIntegration(apiKey);

    const program = await database.query('SELECT * FROM programs WHERE id = $1', [programId]);
    if (program.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    const code = program.rows[0].metadata?.bugcrowd_code;
    if (!code) {
      return res.status(400).json({ error: 'Bugcrowd code not configured' });
    }

    // Sync targets
    const targets = await bc.getProgramTargets(code);

    res.json({ synced: true, targets });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
