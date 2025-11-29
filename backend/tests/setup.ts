/**
 * Jest Test Setup
 * Runs before each test suite
 */

import { config } from 'dotenv';
import path from 'path';

// Load test environment variables
config({ path: path.join(__dirname, '../.env.test') });

// Set test environment
process.env.NODE_ENV = 'test';

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection in tests:', reason);
  throw reason;
});
