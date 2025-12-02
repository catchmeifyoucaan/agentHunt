-- Migration: Production Bug Bounty Features
-- Adds tables for credentials, snapshots, and enhanced scope validation

-- ============================================
-- Credentials Table (for authenticated testing)
-- ============================================
CREATE TABLE IF NOT EXISTS credentials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('basic', 'bearer', 'api_key', 'oauth2', 'cookie', 'custom')),
    encrypted_data TEXT NOT NULL,
    scope JSONB DEFAULT '[]',
    expires_at TIMESTAMP WITH TIME ZONE,
    last_used TIMESTAMP WITH TIME ZONE,
    is_valid BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_credentials_program ON credentials(program_id);
CREATE INDEX idx_credentials_type ON credentials(type);
CREATE INDEX idx_credentials_valid ON credentials(is_valid) WHERE is_valid = true;

-- ============================================
-- Snapshots Table (for historical comparison)
-- ============================================
CREATE TABLE IF NOT EXISTS snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('assets', 'findings', 'full')),
    data JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_snapshots_program ON snapshots(program_id);
CREATE INDEX idx_snapshots_created ON snapshots(created_at DESC);
CREATE INDEX idx_snapshots_program_created ON snapshots(program_id, created_at DESC);

-- ============================================
-- Snapshot Schedules Table
-- ============================================
CREATE TABLE IF NOT EXISTS snapshot_schedules (
    program_id UUID PRIMARY KEY REFERENCES programs(id) ON DELETE CASCADE,
    interval_hours INTEGER NOT NULL DEFAULT 24,
    next_run TIMESTAMP WITH TIME ZONE NOT NULL,
    last_run TIMESTAMP WITH TIME ZONE,
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Stealth Sessions Table
-- ============================================
CREATE TABLE IF NOT EXISTS stealth_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    profile_name VARCHAR(50) NOT NULL,
    proxy_config JSONB DEFAULT '[]',
    waf_evasion_config JSONB DEFAULT '{}',
    request_count INTEGER DEFAULT 0,
    start_time TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    end_time TIMESTAMP WITH TIME ZONE,
    is_active BOOLEAN DEFAULT true,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_stealth_sessions_program ON stealth_sessions(program_id);
CREATE INDEX idx_stealth_sessions_active ON stealth_sessions(is_active) WHERE is_active = true;

-- ============================================
-- Proxy Pool Table
-- ============================================
CREATE TABLE IF NOT EXISTS proxy_pool (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL CHECK (type IN ('http', 'https', 'socks4', 'socks5', 'tor')),
    host VARCHAR(255) NOT NULL,
    port INTEGER NOT NULL,
    username VARCHAR(255),
    password_encrypted TEXT,
    country VARCHAR(10),
    last_used TIMESTAMP WITH TIME ZONE,
    failure_count INTEGER DEFAULT 0,
    avg_latency FLOAT DEFAULT 0,
    is_healthy BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(host, port)
);

CREATE INDEX idx_proxy_pool_healthy ON proxy_pool(is_healthy) WHERE is_healthy = true;
CREATE INDEX idx_proxy_pool_type ON proxy_pool(type);
CREATE INDEX idx_proxy_pool_country ON proxy_pool(country);

-- ============================================
-- Scope Validation Log Table
-- ============================================
CREATE TABLE IF NOT EXISTS scope_validation_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    target VARCHAR(500) NOT NULL,
    in_scope BOOLEAN NOT NULL,
    reason TEXT,
    matched_rule VARCHAR(100),
    risk_level VARCHAR(20),
    validated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_scope_log_program ON scope_validation_log(program_id);
CREATE INDEX idx_scope_log_target ON scope_validation_log(target);
CREATE INDEX idx_scope_log_out_of_scope ON scope_validation_log(program_id, in_scope) WHERE in_scope = false;

-- ============================================
-- PoC Artifacts Table
-- ============================================
CREATE TABLE IF NOT EXISTS poc_artifacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    finding_id UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    language VARCHAR(50),
    storage_key VARCHAR(500),
    code TEXT,
    description TEXT,
    instructions JSONB DEFAULT '[]',
    requirements JSONB DEFAULT '[]',
    warnings JSONB DEFAULT '[]',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_poc_finding ON poc_artifacts(finding_id);
CREATE INDEX idx_poc_program ON poc_artifacts(program_id);
CREATE INDEX idx_poc_type ON poc_artifacts(type);

-- ============================================
-- Duplicate Detection Cache Table
-- ============================================
CREATE TABLE IF NOT EXISTS duplicate_cache (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    finding_hash VARCHAR(64) NOT NULL,
    original_finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    title_normalized TEXT,
    asset_value VARCHAR(500),
    similarity_score FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(program_id, finding_hash)
);

CREATE INDEX idx_duplicate_cache_program ON duplicate_cache(program_id);
CREATE INDEX idx_duplicate_cache_hash ON duplicate_cache(finding_hash);

-- ============================================
-- Change History Table (for tracking significant changes)
-- ============================================
CREATE TABLE IF NOT EXISTS change_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    change_type VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    old_value JSONB,
    new_value JSONB,
    changed_by VARCHAR(255),
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_change_history_program ON change_history(program_id);
CREATE INDEX idx_change_history_type ON change_history(change_type);
CREATE INDEX idx_change_history_entity ON change_history(entity_type, entity_id);
CREATE INDEX idx_change_history_time ON change_history(changed_at DESC);

-- ============================================
-- Add pg_trgm extension for fuzzy matching (if not exists)
-- ============================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================
-- Add indexes for fuzzy duplicate detection
-- ============================================
CREATE INDEX IF NOT EXISTS idx_findings_title_trgm ON findings USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_findings_description_trgm ON findings USING gin (description gin_trgm_ops);

-- ============================================
-- Update programs table with enhanced scope fields
-- ============================================
DO $$
BEGIN
    -- Add excluded_paths to scope if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'programs' AND column_name = 'scope'
    ) THEN
        -- scope column should already exist, just ensure it's JSONB
        NULL;
    END IF;
END $$;

-- ============================================
-- Function to auto-update updated_at timestamp
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to new tables
DROP TRIGGER IF EXISTS update_credentials_updated_at ON credentials;
CREATE TRIGGER update_credentials_updated_at
    BEFORE UPDATE ON credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_snapshot_schedules_updated_at ON snapshot_schedules;
CREATE TRIGGER update_snapshot_schedules_updated_at
    BEFORE UPDATE ON snapshot_schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_proxy_pool_updated_at ON proxy_pool;
CREATE TRIGGER update_proxy_pool_updated_at
    BEFORE UPDATE ON proxy_pool
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Comments for documentation
-- ============================================
COMMENT ON TABLE credentials IS 'Stores encrypted credentials for authenticated testing';
COMMENT ON TABLE snapshots IS 'Point-in-time snapshots of program assets and findings for historical comparison';
COMMENT ON TABLE snapshot_schedules IS 'Scheduling configuration for automatic snapshots';
COMMENT ON TABLE stealth_sessions IS 'Active stealth scanning sessions with rate limiting and proxy configuration';
COMMENT ON TABLE proxy_pool IS 'Pool of proxy servers for IP rotation and stealth scanning';
COMMENT ON TABLE scope_validation_log IS 'Audit log of scope validation checks';
COMMENT ON TABLE poc_artifacts IS 'Generated proof-of-concept scripts and exploit code';
COMMENT ON TABLE duplicate_cache IS 'Cache for fast duplicate detection using content hashing';
COMMENT ON TABLE change_history IS 'Audit trail of significant changes to program data';
