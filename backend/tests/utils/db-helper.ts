/**
 * Database Test Utilities
 * Provides helpers for database testing with PostgreSQL
 */

import { Pool, PoolClient } from 'pg';

let testPool: Pool | null = null;

export class DatabaseTestHelper {
  private pool: Pool;
  private client: PoolClient | null = null;

  constructor() {
    this.pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432'),
      database: process.env.POSTGRES_DB || 'agenthunt_test',
      user: process.env.POSTGRES_USER || 'user',
      password: process.env.POSTGRES_PASSWORD || 'password',
    });
    testPool = this.pool;
  }

  /**
   * Connect to the database
   */
  async connect(): Promise<void> {
    try {
      this.client = await this.pool.connect();
    } catch (error) {
      console.error('Failed to connect to test database:', error);
      throw error;
    }
  }

  /**
   * Disconnect from the database
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.release();
      this.client = null;
    }
  }

  /**
   * Close the pool
   */
  async close(): Promise<void> {
    await this.pool.end();
    testPool = null;
  }

  /**
   * Run a query
   */
  async query(sql: string, params?: any[]): Promise<any> {
    if (!this.client) {
      await this.connect();
    }
    return this.client!.query(sql, params);
  }

  /**
   * Clear all tables
   */
  async clearAllTables(): Promise<void> {
    const tables = [
      'findings',
      'assets',
      'scan_results',
      'scans',
      'programs',
      'users',
      'monitoring_configs',
      'change_history',
    ];

    for (const table of tables) {
      try {
        await this.query(`TRUNCATE TABLE ${table} CASCADE`);
      } catch (error) {
        // Table might not exist, ignore
      }
    }
  }

  /**
   * Seed test data
   */
  async seedTestData(): Promise<{
    userId: string;
    programId: string;
    scanId: string;
  }> {
    // Create test user
    const userResult = await this.query(
      `INSERT INTO users (email, password, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      ['test@example.com', 'hashedpassword', 'Test User']
    );
    const userId = userResult.rows[0].id;

    // Create test program
    const programResult = await this.query(
      `INSERT INTO programs (name, user_id, domains, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      ['Test Program', userId, ['example.com']]
    );
    const programId = programResult.rows[0].id;

    // Create test scan
    const scanResult = await this.query(
      `INSERT INTO scans (program_id, status, created_at)
       VALUES ($1, $2, NOW())
       RETURNING id`,
      [programId, 'pending']
    );
    const scanId = scanResult.rows[0].id;

    return { userId, programId, scanId };
  }

  /**
   * Begin a transaction
   */
  async beginTransaction(): Promise<void> {
    await this.query('BEGIN');
  }

  /**
   * Rollback a transaction
   */
  async rollback(): Promise<void> {
    await this.query('ROLLBACK');
  }

  /**
   * Commit a transaction
   */
  async commit(): Promise<void> {
    await this.query('COMMIT');
  }
}

/**
 * Get or create the test database helper
 */
export function getTestDb(): DatabaseTestHelper {
  return new DatabaseTestHelper();
}

/**
 * Mock database for unit tests (no actual DB connection)
 */
export function mockDatabase() {
  return {
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
  };
}
