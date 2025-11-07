import { Router } from 'express';
import HackerOneIntegration from '../../services/integrations/hackerone';
import BugcrowdIntegration from '../../services/integrations/bugcrowd';
import ChaosIntegration from '../../services/integrations/chaos';
import database from '../../services/database';
import { v4 as uuidv4 } from 'uuid';

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

// Chaos Integration
router.get('/chaos/programs', async (req, res) => {
  try {
    const apiKey = process.env.CHAOS_API_KEY || '';
    if (!apiKey) {
      return res.status(400).json({ error: 'Chaos API key not configured' });
    }

    const chaos = new ChaosIntegration(apiKey);
    const programs = await chaos.getPrograms();
    res.json({ programs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/chaos/import/:programName', async (req, res) => {
  try {
    const { programName } = req.params;
    const apiKey = process.env.CHAOS_API_KEY || '';

    if (!apiKey) {
      return res.status(400).json({ error: 'Chaos API key not configured' });
    }

    const chaos = new ChaosIntegration(apiKey);

    // Get assets from Chaos
    const assets = await chaos.getProgramAssets(programName);

    // Create program in database
    const programId = uuidv4();
    await database.query(
      `INSERT INTO programs (id, name, slug, platform, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        programId,
        programName,
        programName.toLowerCase().replace(/\s+/g, '-'),
        'chaos',
        JSON.stringify({ chaos_name: programName }),
      ]
    );

    // Import assets
    let importedCount = 0;
    for (const asset of assets) {
      try {
        const assetId = uuidv4();
        await database.query(
          `INSERT INTO assets (id, program_id, type, value, source)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (program_id, type, value) DO NOTHING`,
          [assetId, programId, 'domain', asset, 'chaos']
        );
        importedCount++;
      } catch (err) {
        // Skip duplicates
      }
    }

    res.json({
      success: true,
      programId,
      assetsImported: importedCount,
      totalAssets: assets.length,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
