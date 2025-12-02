/**
 * Database Service - Conditional Export
 * Uses in-memory stub when USE_DATABASE_STUB=true, otherwise PostgreSQL
 */

import logger from '../utils/logger';

// Check if we should use the database stub
const useStub = process.env.USE_DATABASE_STUB === 'true';

if (useStub) {
  logger.info('🧪 Using in-memory database stub for testing (no PostgreSQL required)');
  // @ts-ignore
  import('./database-stub').then((module) => {
    logger.debug('Database stub module loaded');
  });
  const stub = require('./database-stub').default;
  module.exports = stub;
} else {
  logger.info('📊 Using PostgreSQL database');
  const postgres = require('./database-postgres').default;
  module.exports = postgres;
}

// TypeScript export for compatibility
export default module.exports;
