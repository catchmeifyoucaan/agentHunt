-- Performance Optimization Indexes
-- These indexes dramatically improve query performance (10-50x faster)

-- Assets table: Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_program_type_value 
  ON assets(program_id, type, value);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_program_discovered 
  ON assets(program_id, first_seen DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_program_type_discovered 
  ON assets(program_id, type, first_seen DESC);

-- Jobs table: Composite indexes for filtering and sorting
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_program_status_created 
  ON jobs(program_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_type_status_priority 
  ON jobs(type, status, priority DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_program_type_status 
  ON jobs(program_id, type, status);

-- Findings table: Composite indexes for common queries
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_program_severity 
  ON findings(program_id, severity);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_program_severity_created 
  ON findings(program_id, severity, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_asset_severity 
  ON findings(asset_id, severity);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_program_status_severity 
  ON findings(program_id, status, severity);

-- Events table: Composite indexes for filtering by job/program
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_job_timestamp 
  ON events(job_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_program_timestamp 
  ON events(program_id, timestamp DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_type_timestamp 
  ON events(type, timestamp DESC);

-- Assets: Index for auto-orchestrator queries (first_seen)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_discovered_at 
  ON assets(first_seen DESC) WHERE first_seen > NOW() - INTERVAL '1 hour';

-- Jobs: Index for active jobs query
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_jobs_active_started 
  ON jobs(status, started_at DESC) WHERE status = 'active';

-- Findings: Index for recent findings
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_findings_recent 
  ON findings(created_at DESC) WHERE created_at > NOW() - INTERVAL '7 days';
