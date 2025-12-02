-- AgentHunt Database Schema
-- PostgreSQL 15+

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fast text search

-- Programs table
CREATE TABLE programs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    platform VARCHAR(50) NOT NULL,
    scope JSONB NOT NULL,
    policy JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_programs_slug ON programs(slug);
CREATE INDEX idx_programs_platform ON programs(platform);
CREATE INDEX idx_programs_scope ON programs USING GIN(scope);

-- Assets table
CREATE TABLE assets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('domain', 'subdomain', 'ip', 'url', 'port')),
    value TEXT NOT NULL,
    source TEXT[] DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'out_of_scope')),
    metadata JSONB DEFAULT '{}',
    first_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_scanned TIMESTAMP WITH TIME ZONE,
    UNIQUE(program_id, value, type)
);

CREATE INDEX idx_assets_program ON assets(program_id);
CREATE INDEX idx_assets_type ON assets(type);
CREATE INDEX idx_assets_value ON assets USING GIN(value gin_trgm_ops);
CREATE INDEX idx_assets_status ON assets(status);
CREATE INDEX idx_assets_metadata ON assets USING GIN(metadata);

-- Findings table
CREATE TABLE findings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'info')),
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    cvss FLOAT,
    cwe TEXT[] DEFAULT '{}',
    evidence JSONB DEFAULT '[]',
    poc JSONB NOT NULL,
    impact TEXT,
    remediation TEXT,
    status VARCHAR(50) DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'confirmed', 'false_positive', 'duplicate', 'submitted', 'accepted', 'closed')),
    confirmations JSONB DEFAULT '[]',
    triage_result JSONB,
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_findings_program ON findings(program_id);
CREATE INDEX idx_findings_asset ON findings(asset_id);
CREATE INDEX idx_findings_severity ON findings(severity);
CREATE INDEX idx_findings_status ON findings(status);
CREATE INDEX idx_findings_confidence ON findings(confidence);
CREATE INDEX idx_findings_created ON findings(created_at DESC);

-- Jobs table
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('discovery', 'bruteforce', 'fingerprint', 'crawl', 'scanner', 'interact', 'confirm', 'triage', 'manager')),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    priority INTEGER DEFAULT 5 CHECK (priority >= 1 AND priority <= 10),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'completed', 'failed', 'paused', 'cancelled')),
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    worker_id VARCHAR(255),
    options JSONB NOT NULL,
    result JSONB,
    error TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_jobs_type ON jobs(type);
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_priority ON jobs(priority DESC);
CREATE INDEX idx_jobs_program ON jobs(program_id);
CREATE INDEX idx_jobs_worker ON jobs(worker_id);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);

-- Workers table
CREATE TABLE workers (
    id VARCHAR(255) PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'idle' CHECK (status IN ('idle', 'busy', 'error', 'offline')),
    current_job_id UUID REFERENCES jobs(id),
    region VARCHAR(100),
    ip VARCHAR(50),
    capacity INTEGER DEFAULT 1,
    jobs_completed INTEGER DEFAULT 0,
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workers_type ON workers(type);
CREATE INDEX idx_workers_status ON workers(status);
CREATE INDEX idx_workers_heartbeat ON workers(last_heartbeat DESC);

-- Events table (for streaming logs and telemetry)
CREATE TABLE events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(100) NOT NULL,
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    worker_id VARCHAR(255) REFERENCES workers(id) ON DELETE SET NULL,
    level VARCHAR(20),
    tool VARCHAR(100),
    context TEXT,
    message TEXT,
    payload JSONB DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_events_type ON events(type);
CREATE INDEX idx_events_program ON events(program_id);
CREATE INDEX idx_events_job ON events(job_id);
CREATE INDEX idx_events_worker ON events(worker_id);
CREATE INDEX idx_events_timestamp ON events(timestamp DESC);
CREATE INDEX idx_events_level ON events(level);

-- Notifications table
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('telegram', 'email', 'webhook')),
    severity VARCHAR(20) NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    finding_id UUID REFERENCES findings(id) ON DELETE CASCADE,
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    sent BOOLEAN DEFAULT FALSE,
    sent_at TIMESTAMP WITH TIME ZONE,
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_notifications_type ON notifications(type);
CREATE INDEX idx_notifications_sent ON notifications(sent);
CREATE INDEX idx_notifications_severity ON notifications(severity);
CREATE INDEX idx_notifications_program ON notifications(program_id);

-- Safety checks table
CREATE TABLE safety_checks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    check_type VARCHAR(100) NOT NULL,
    passed BOOLEAN NOT NULL,
    reason TEXT,
    blocked_actions TEXT[] DEFAULT '{}',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_safety_checks_job ON safety_checks(job_id);
CREATE INDEX idx_safety_checks_passed ON safety_checks(passed);
CREATE INDEX idx_safety_checks_type ON safety_checks(check_type);

-- Audit logs table
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255),
    worker_id VARCHAR(255),
    action VARCHAR(100) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255) NOT NULL,
    old_value JSONB,
    new_value JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_worker ON audit_logs(worker_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);

-- Manager commands table (conversation history)
CREATE TABLE manager_commands (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    command TEXT NOT NULL,
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    user_id VARCHAR(255) NOT NULL,
    parsed_intent JSONB,
    response TEXT,
    executed_actions JSONB DEFAULT '[]',
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_manager_commands_program ON manager_commands(program_id);
CREATE INDEX idx_manager_commands_user ON manager_commands(user_id);
CREATE INDEX idx_manager_commands_timestamp ON manager_commands(timestamp DESC);

-- Nuclei templates catalog
CREATE TABLE nuclei_templates (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    author TEXT[] DEFAULT '{}',
    severity VARCHAR(20) NOT NULL,
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('tier0', 'tier1', 'tier2', 'tier3')),
    tags TEXT[] DEFAULT '{}',
    description TEXT,
    reference TEXT[] DEFAULT '{}',
    classification JSONB DEFAULT '{}',
    required_fingerprints TEXT[] DEFAULT '{}',
    path TEXT NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_nuclei_templates_severity ON nuclei_templates(severity);
CREATE INDEX idx_nuclei_templates_tier ON nuclei_templates(tier);
CREATE INDEX idx_nuclei_templates_tags ON nuclei_templates USING GIN(tags);
CREATE INDEX idx_nuclei_templates_enabled ON nuclei_templates(enabled);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_programs_updated_at BEFORE UPDATE ON programs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_findings_updated_at BEFORE UPDATE ON findings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_nuclei_templates_updated_at BEFORE UPDATE ON nuclei_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Views for common queries
CREATE VIEW active_programs AS
SELECT p.*,
    COUNT(DISTINCT a.id) as asset_count,
    COUNT(DISTINCT f.id) as finding_count,
    MAX(f.created_at) as last_finding_at
FROM programs p
LEFT JOIN assets a ON p.id = a.program_id AND a.status = 'active'
LEFT JOIN findings f ON p.id = f.program_id
GROUP BY p.id;

CREATE VIEW critical_findings AS
SELECT f.*, p.name as program_name, a.value as asset_value
FROM findings f
JOIN programs p ON f.program_id = p.id
JOIN assets a ON f.asset_id = a.id
WHERE f.severity IN ('critical', 'high')
AND f.status IN ('new', 'triaged', 'confirmed')
ORDER BY f.created_at DESC;

CREATE VIEW worker_stats AS
SELECT
    w.id,
    w.type,
    w.status,
    w.jobs_completed,
    COUNT(DISTINCT j.id) as current_jobs,
    AVG(EXTRACT(EPOCH FROM (j.completed_at - j.started_at))) as avg_job_duration
FROM workers w
LEFT JOIN jobs j ON w.id = j.worker_id AND j.status = 'active'
GROUP BY w.id;
