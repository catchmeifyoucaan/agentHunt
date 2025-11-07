import database from './services/database';
import logger from './utils/logger';

/**
 * Database Migration Script
 * Creates all necessary tables for AgentHunt
 */

const migrations = [
  // Programs table
  `CREATE TABLE IF NOT EXISTS programs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    platform VARCHAR(50) NOT NULL,
    scope JSONB NOT NULL DEFAULT '{}',
    policy JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Assets table
  `CREATE TABLE IF NOT EXISTS assets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    value TEXT NOT NULL,
    source VARCHAR(100),
    metadata JSONB DEFAULT '{}',
    discovered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_scanned TIMESTAMP,
    UNIQUE(program_id, type, value)
  )`,

  // Jobs table
  `CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 5,
    status VARCHAR(50) DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    worker_id VARCHAR(255),
    options JSONB DEFAULT '{}',
    result JSONB,
    error TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
  )`,

  // Findings table
  `CREATE TABLE IF NOT EXISTS findings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    severity VARCHAR(20) NOT NULL,
    confidence DECIMAL(3,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'new',
    asset_id UUID REFERENCES assets(id) ON DELETE SET NULL,
    evidence JSONB DEFAULT '[]',
    poc JSONB,
    triage_result JSONB,
    confirmations JSONB DEFAULT '[]',
    tags TEXT[],
    cvss_score DECIMAL(3,1),
    cwe TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    submitted_at TIMESTAMP
  )`,

  // Notifications table
  `CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL,
    severity VARCHAR(20) NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    sent BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Workers table
  `CREATE TABLE IF NOT EXISTS workers (
    id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'idle',
    current_job_id UUID,
    region VARCHAR(100),
    ip VARCHAR(45),
    capacity INTEGER DEFAULT 1,
    jobs_completed INTEGER DEFAULT 0,
    last_heartbeat TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
  )`,

  // Audit logs table
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    worker_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(45),
    user_agent TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Tool outputs table (for storing raw tool outputs)
  `CREATE TABLE IF NOT EXISTS tool_outputs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    tool VARCHAR(100) NOT NULL,
    output_type VARCHAR(50),
    s3_key TEXT,
    file_size BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,

  // Create indexes for performance
  `CREATE INDEX IF NOT EXISTS idx_assets_program_id ON assets(program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_program_id ON jobs(program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_program_id ON findings(program_id)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity)`,
  `CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_finding_id ON notifications(finding_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_sent ON notifications(sent)`,
  `CREATE INDEX IF NOT EXISTS idx_workers_status ON workers(status)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)`,
];

async function runMigrations() {
  logger.info('Starting database migrations...');

  try {
    // Test connection
    const healthy = await database.healthCheck();
    if (!healthy) {
      throw new Error('Database connection failed');
    }

    logger.info('Database connection successful');

    // Run each migration
    for (let i = 0; i < migrations.length; i++) {
      const migration = migrations[i];
      try {
        await database.query(migration);
        logger.info(`Migration ${i + 1}/${migrations.length} completed`);
      } catch (error: any) {
        logger.error({ error, migration: i + 1 }, 'Migration failed');
        throw error;
      }
    }

    logger.info('All migrations completed successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Migration script failed');
    process.exit(1);
  }
}

runMigrations();
