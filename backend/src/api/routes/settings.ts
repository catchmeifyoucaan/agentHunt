import { Router } from 'express';
import database from '../../services/database';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get current settings
router.get('/', async (req, res) => {
  try {
    // Get settings from database
    const result = await database.query(
      'SELECT * FROM settings ORDER BY updated_at DESC LIMIT 1'
    );

    if (result.rows.length === 0) {
      // Return default settings
      return res.json({
        settings: {
          notifications: {
            email: true,
            slack: false,
            discord: false,
          },
          security: {
            autoApprove: false,
            requireHumanApproval: true,
            maxConcurrentJobs: 10,
          },
          integrations: {
            hackerOneApiKey: '',
            bugcrowdApiKey: '',
            chaosApiKey: '',
            chaosDbEnabled: true,
          },
          performance: {
            queueConcurrency: 5,
            retryAttempts: 3,
            timeout: 300,
          },
        },
      });
    }

    const settings = result.rows[0].config;
    res.json({ settings });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update settings
router.put('/', async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings) {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    // Check if settings table exists, create if not
    await database.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id UUID PRIMARY KEY,
        config JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Get current settings or create new one
    const existing = await database.query(
      'SELECT id FROM settings ORDER BY updated_at DESC LIMIT 1'
    );

    if (existing.rows.length > 0) {
      // Update existing
      await database.query(
        'UPDATE settings SET config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
        [JSON.stringify(settings), existing.rows[0].id]
      );
    } else {
      // Create new
      const id = uuidv4();
      await database.query(
        'INSERT INTO settings (id, config) VALUES ($1, $2)',
        [id, JSON.stringify(settings)]
      );
    }

    // Update environment variables if API keys were provided
    // Note: These won't persist across restarts unless saved to .env file
    if (settings.integrations?.hackerOneApiKey) {
      process.env.HACKERONE_API_KEY = settings.integrations.hackerOneApiKey;
    }
    if (settings.integrations?.bugcrowdApiKey) {
      process.env.BUGCROWD_API_KEY = settings.integrations.bugcrowdApiKey;
    }
    if (settings.integrations?.chaosApiKey) {
      process.env.CHAOS_API_KEY = settings.integrations.chaosApiKey;
    }

    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get integration status (check if API keys are configured)
router.get('/status', async (req, res) => {
  try {
    const status = {
      hackerOne: !!process.env.HACKERONE_API_KEY,
      bugcrowd: !!process.env.BUGCROWD_API_KEY,
      chaos: !!process.env.CHAOS_API_KEY,
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    };

    res.json({ status });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
