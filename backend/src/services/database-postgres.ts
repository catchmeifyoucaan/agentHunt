import { Pool, PoolClient, QueryResult } from 'pg';
import config from '../config';
import logger from '../utils/logger';

class Database {
  private pool: Pool;
  private readPool: Pool | null = null; // New read replica pool
  private useReadReplica: boolean = false;
  private static instance: Database;

  private constructor() {
    this.pool = new Pool({
      host: config.database.host,
      port: config.database.port,
      user: config.database.user,
      password: config.database.password,
      database: config.database.database,
      max: parseInt(process.env.DB_POOL_MAX || '100', 10),
      min: parseInt(process.env.DB_POOL_MIN || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    });

    this.pool.on('error', (err: Error) => {
      logger.error({ err }, 'Unexpected database error on primary pool');
    });

    this.pool.on('connect', () => {
      logger.debug('New primary database connection established');
    });

    // Initialize read replica pool if configured
    if (config.database.readHost && config.database.readUser && config.database.readDatabase) {
      this.useReadReplica = true;
      this.readPool = new Pool({
        host: config.database.readHost,
        port: config.database.readPort,
        user: config.database.readUser,
        password: config.database.readPassword,
        database: config.database.readDatabase,
        max: parseInt(process.env.DB_READ_POOL_MAX || '50', 10),
        min: parseInt(process.env.DB_READ_POOL_MIN || '5', 10),
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 2000,
        ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
      });

      this.readPool.on('error', (err: Error) => {
        logger.error({ err }, 'Unexpected database error on read replica pool');
      });

      this.readPool.on('connect', () => {
        logger.debug('New read replica database connection established');
      });
      logger.info('Read replica pool initialized');
    } else {
      logger.info('Read replica not configured, all queries will use primary database');
    }
  }

  public static getInstance(): Database {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }

  public async query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
    const start = Date.now();
    const isReadQuery = text.trim().toUpperCase().startsWith('SELECT');
    let targetPool = this.pool;

    if (this.useReadReplica && isReadQuery && this.readPool) {
      targetPool = this.readPool;
      logger.debug({ text, target: 'read_replica' }, 'Routing query to read replica');
    } else {
      logger.debug({ text, target: 'primary' }, 'Routing query to primary database');
    }

    try {
      const result = await targetPool.query<T>(text, params);
      const duration = Date.now() - start;
      logger.debug({ text, duration, rows: result.rowCount }, 'Query executed');
      return result;
    } catch (error) {
      logger.error(
        { error, text, params, target: targetPool === this.pool ? 'primary' : 'read_replica' },
        'Database query error'
      );
      throw error;
    }
  }

  public async getClient(): Promise<PoolClient> {
    return await this.pool.connect(); // Transactions must always use the primary pool
  }

  public async transaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.getClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error({ error }, 'Transaction rolled back');
      throw error;
    } finally {
      client.release();
    }
  }

  public async healthCheck(): Promise<boolean> {
    let primaryHealthy = false;
    let replicaHealthy = true; // Assume healthy if not configured

    try {
      await this.pool.query('SELECT 1');
      primaryHealthy = true;
    } catch (error) {
      logger.error({ error }, 'Primary database health check failed');
    }

    if (this.useReadReplica && this.readPool) {
      try {
        await this.readPool.query('SELECT 1');
        replicaHealthy = true;
      } catch (error) {
        logger.error({ error }, 'Read replica database health check failed');
        replicaHealthy = false;
      }
    }

    return primaryHealthy && replicaHealthy;
  }

  public getPoolStats() {
    const primaryStats = {
      total: this.pool.totalCount,
      idle: this.pool.idleCount,
      waiting: this.pool.waitingCount,
    };

    const readReplicaStats = this.readPool
      ? {
          total: this.readPool.totalCount,
          idle: this.readPool.idleCount,
          waiting: this.readPool.waitingCount,
        }
      : undefined;

    return { primary: primaryStats, readReplica: readReplicaStats };
  }

  public async close(): Promise<void> {
    await this.pool.end();
    logger.info('Primary database pool closed');

    if (this.readPool) {
      await this.readPool.end();
      logger.info('Read replica database pool closed');
    }
  }
}

export default Database.getInstance();
