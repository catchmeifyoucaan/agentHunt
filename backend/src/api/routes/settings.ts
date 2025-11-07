import { Router } from 'express';
import database from '../../services/database';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';

const router = Router();

// File-based storage fallback when database is unavailable
const SETTINGS_FILE = path.join(process.cwd(), 'data', 'settings.json');

// Ensure data directory exists
function ensureDataDir() {
  const dataDir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

// Load settings from file
function loadSettingsFromFile() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading settings from file:', error);
  }
  return null;
}

// Save settings to file
function saveSettingsToFile(settings: any) {
  try {
    ensureDataDir();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('Error saving settings to file:', error);
    return false;
  }
}

// Get current settings
router.get('/', async (req, res) => {
  try {
    let settings = null;

    // Try database first
    try {
      const result = await database.query(
        'SELECT * FROM settings ORDER BY updated_at DESC LIMIT 1'
      );
      if (result.rows.length > 0) {
        settings = result.rows[0].config;
      }
    } catch (dbError) {
      console.log('Database unavailable, using file storage');
    }

    // Fallback to file storage
    if (!settings) {
      settings = loadSettingsFromFile();
    }

    // Return default settings if nothing found
    if (!settings) {
      settings = {
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
          hackerOneUsername: '',
          hackerOneToken: '',
          bugcrowdApiKey: '',
          chaosApiKey: '',
          chaosDbEnabled: true,
        },
        performance: {
          queueConcurrency: 5,
          retryAttempts: 3,
          timeout: 300,
        },
      };
    }

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

    let savedToDb = false;

    // Try to save to database first
    try {
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
      savedToDb = true;
    } catch (dbError) {
      console.log('Database unavailable, using file storage fallback');
    }

    // Fallback to file storage if database failed
    if (!savedToDb) {
      const success = saveSettingsToFile(settings);
      if (!success) {
        return res.status(500).json({ error: 'Failed to save settings' });
      }
    }

    // Update environment variables if API keys were provided
    // Note: These won't persist across restarts unless saved to .env file
    if (settings.integrations?.hackerOneUsername) {
      process.env.HACKERONE_API_USERNAME = settings.integrations.hackerOneUsername;
    }
    if (settings.integrations?.hackerOneToken) {
      process.env.HACKERONE_API_TOKEN = settings.integrations.hackerOneToken;
    }
    if (settings.integrations?.bugcrowdApiKey) {
      process.env.BUGCROWD_API_KEY = settings.integrations.bugcrowdApiKey;
    }
    if (settings.integrations?.chaosApiKey) {
      process.env.CHAOS_API_KEY = settings.integrations.chaosApiKey;
    }

    res.json({
      success: true,
      message: 'Settings saved successfully',
      storage: savedToDb ? 'database' : 'file'
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get integration status (check if API keys are configured)
router.get('/status', async (req, res) => {
  try {
    const status = {
      hackerOne: !!(process.env.HACKERONE_API_USERNAME && process.env.HACKERONE_API_TOKEN),
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
