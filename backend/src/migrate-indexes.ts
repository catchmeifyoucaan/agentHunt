import database from './services/database';
import logger from './utils/logger';
import fs from 'fs/promises';
import path from 'path';

/**
 * Apply performance indexes migration
 * Run: npm run migrate:indexes
 */

async function applyIndexes() {
  logger.info('Applying performance indexes...');

  try {
    const sqlFile = path.join(__dirname, 'migrations', 'add-performance-indexes.sql');
    const sql = await fs.readFile(sqlFile, 'utf-8');

    // Split by semicolon and execute each statement
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        await database.query(statement);
        logger.info({ statement: statement.substring(0, 100) }, 'Index created');
      } catch (error: any) {
        // Ignore "already exists" errors
        if (error.message.includes('already exists') || error.message.includes('duplicate')) {
          logger.debug(
            { statement: statement.substring(0, 100) },
            'Index already exists, skipping'
          );
        } else {
          logger.error({ error, statement: statement.substring(0, 100) }, 'Failed to create index');
        }
      }
    }

    logger.info('✅ Performance indexes applied successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to apply indexes');
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  applyIndexes()
    .then(() => {
      logger.info('Migration complete');
      process.exit(0);
    })
    .catch((error) => {
      logger.error({ error }, 'Migration failed');
      process.exit(1);
    });
}

export default applyIndexes;
