-- Enhanced AgentHunt Database Schema
-- Adds support for: Ingestion Layer, Asset Graph, HITL, Policy Engine,
-- Multi-Model AI, Exploit Chains, External Integrations, and more

-- ============================================================================
-- INGESTION LAYER
-- ============================================================================

CREATE TABLE data_sources (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('shodan', 'zoomeye', 'censys', 'github', 'gitlab',
        'archiveorg', 'ctlogs', 'webhook', 'cicd', 'siem', 'manual')),
    name VARCHAR(255) NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    config JSONB NOT NULL,
    last_sync TIMESTAMP WITH TIME ZONE,
    sync_interval INTEGER, -- minutes
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_data_sources_type ON data_sources(type);
CREATE INDEX idx_data_sources_enabled ON data_sources(enabled);

CREATE TABLE ingestion_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    assets_discovered INTEGER DEFAULT 0,
    assets_new INTEGER DEFAULT 0,
    assets_updated INTEGER DEFAULT 0,
    query TEXT,
    filters JSONB,
    error TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ingestion_jobs_source ON ingestion_jobs(source_id);
CREATE INDEX idx_ingestion_jobs_status ON ingestion_jobs(status);
CREATE INDEX idx_ingestion_jobs_created ON ingestion_jobs(created_at DESC);

-- ============================================================================
-- ASSET GRAPH & RELATIONSHIPS
-- ============================================================================

CREATE TABLE asset_relationships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    target_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL CHECK (relationship_type IN (
        'subdomain_of', 'resolves_to', 'cname_to', 'hosts', 'links_to',
        'shares_cert_with', 'same_asn', 'same_org', 'uses_technology',
        'depends_on', 'related_to'
    )),
    confidence FLOAT DEFAULT 1.0 CHECK (confidence >= 0 AND confidence <= 1),
    metadata JSONB DEFAULT '{}',
    discovered_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_asset_id, target_asset_id, relationship_type)
);

CREATE INDEX idx_asset_rel_source ON asset_relationships(source_asset_id);
CREATE INDEX idx_asset_rel_target ON asset_relationships(target_asset_id);
CREATE INDEX idx_asset_rel_type ON asset_relationships(relationship_type);
CREATE INDEX idx_asset_rel_confidence ON asset_relationships(confidence);

CREATE TABLE attack_paths (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    start_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    end_asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    hops JSONB NOT NULL, -- Array of relationship IDs
    findings JSONB NOT NULL, -- Array of finding IDs
    risk_score FLOAT NOT NULL,
    impact TEXT,
    exploitability FLOAT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_attack_paths_program ON attack_paths(program_id);
CREATE INDEX idx_attack_paths_risk ON attack_paths(risk_score DESC);

-- ============================================================================
-- HUMAN-IN-THE-LOOP (HITL)
-- ============================================================================

CREATE TABLE approval_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN ('job_execution', 'finding_submission',
        'policy_override', 'high_risk_action')),
    requested_by VARCHAR(255) NOT NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    finding_id UUID REFERENCES findings(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    reason TEXT NOT NULL,
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
    context JSONB DEFAULT '{}',
    required_approvers INTEGER DEFAULT 1,
    approvers JSONB DEFAULT '[]',
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_approval_requests_status ON approval_requests(status);
CREATE INDEX idx_approval_requests_type ON approval_requests(type);
CREATE INDEX idx_approval_requests_risk ON approval_requests(risk_level);
CREATE INDEX idx_approval_requests_created ON approval_requests(created_at DESC);

-- ============================================================================
-- ENHANCED AUDIT & EVIDENCE STORE
-- ============================================================================

CREATE TABLE evidence_artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID REFERENCES findings(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN ('traffic_capture', 'screenshot',
        'video', 'log', 'poc', 'config', 'scan_output')),
    format VARCHAR(50) NOT NULL,
    s3_key TEXT NOT NULL,
    hash VARCHAR(64) NOT NULL, -- SHA-256
    size BIGINT NOT NULL,
    metadata JSONB DEFAULT '{}',
    encrypted BOOLEAN DEFAULT FALSE,
    retention_policy VARCHAR(50) CHECK (retention_policy IN ('permanent', 'temporary', 'compliance')),
    retention_until TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_evidence_artifacts_finding ON evidence_artifacts(finding_id);
CREATE INDEX idx_evidence_artifacts_job ON evidence_artifacts(job_id);
CREATE INDEX idx_evidence_artifacts_type ON evidence_artifacts(type);
CREATE INDEX idx_evidence_artifacts_hash ON evidence_artifacts(hash);

-- Immutable audit logs (blockchain-style chaining)
CREATE TABLE immutable_audit_logs (
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
    hash VARCHAR(64) NOT NULL, -- Hash of previous entry
    signature TEXT, -- Optional cryptographic signature
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_immutable_audit_user ON immutable_audit_logs(user_id);
CREATE INDEX idx_immutable_audit_resource ON immutable_audit_logs(resource, resource_id);
CREATE INDEX idx_immutable_audit_timestamp ON immutable_audit_logs(timestamp DESC);

-- ============================================================================
-- POLICY & LEGAL ENGINE
-- ============================================================================

CREATE TABLE policy_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    scope VARCHAR(50) NOT NULL CHECK (scope IN ('global', 'program', 'asset', 'target')),
    target_id UUID, -- References programs or assets
    rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN ('consent', 'scope', 'rate_limit',
        'time_window', 'action_whitelist', 'action_blacklist')),
    conditions JSONB NOT NULL,
    actions JSONB NOT NULL,
    enabled BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 100,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_policy_rules_scope ON policy_rules(scope);
CREATE INDEX idx_policy_rules_type ON policy_rules(rule_type);
CREATE INDEX idx_policy_rules_enabled ON policy_rules(enabled);
CREATE INDEX idx_policy_rules_priority ON policy_rules(priority DESC);

CREATE TABLE consent_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    consent_type VARCHAR(50) NOT NULL CHECK (consent_type IN ('explicit', 'implied', 'bug_bounty_terms')),
    scope TEXT[] NOT NULL,
    restrictions TEXT[] DEFAULT '{}',
    granted_by VARCHAR(255) NOT NULL,
    evidence TEXT, -- URL or reference
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE,
    revoked BOOLEAN DEFAULT FALSE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_consent_records_program ON consent_records(program_id);
CREATE INDEX idx_consent_records_asset ON consent_records(asset_id);
CREATE INDEX idx_consent_records_revoked ON consent_records(revoked);

-- ============================================================================
-- MULTI-MODEL AI ENSEMBLE
-- ============================================================================

CREATE TABLE model_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model VARCHAR(50) NOT NULL CHECK (model IN ('claude', 'gemini', 'gpt4', 'gpt5', 'perplexity', 'custom')),
    api_key TEXT NOT NULL,
    base_url TEXT,
    max_tokens INTEGER DEFAULT 4096,
    temperature FLOAT DEFAULT 0.7,
    timeout INTEGER DEFAULT 60, -- seconds
    enabled BOOLEAN DEFAULT TRUE,
    priority INTEGER DEFAULT 100, -- Lower number = higher priority for fallback
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_model_providers_model ON model_providers(model);
CREATE INDEX idx_model_providers_enabled ON model_providers(enabled);
CREATE INDEX idx_model_providers_priority ON model_providers(priority ASC);

CREATE TABLE ensemble_triage_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    model_results JSONB NOT NULL,
    ensemble_score FLOAT NOT NULL CHECK (ensemble_score >= 0 AND ensemble_score <= 1),
    ensemble_severity VARCHAR(20) NOT NULL,
    ensemble_confidence FLOAT NOT NULL CHECK (ensemble_confidence >= 0 AND ensemble_confidence <= 1),
    consensus_level FLOAT NOT NULL CHECK (consensus_level >= 0 AND consensus_level <= 1),
    top_rationales TEXT[],
    recommended_action VARCHAR(50) CHECK (recommended_action IN ('auto_submit', 'human_review', 'dismiss', 'retest')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ensemble_triage_finding ON ensemble_triage_results(finding_id);
CREATE INDEX idx_ensemble_triage_action ON ensemble_triage_results(recommended_action);

-- ============================================================================
-- EXPLOIT CHAIN DISCOVERY
-- ============================================================================

CREATE TABLE exploit_chains (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    findings JSONB NOT NULL, -- Array of finding IDs
    path_id UUID REFERENCES attack_paths(id),
    overall_risk_score FLOAT NOT NULL,
    impact TEXT NOT NULL,
    exploitability FLOAT,
    steps JSONB NOT NULL,
    mitigations TEXT[],
    status VARCHAR(50) DEFAULT 'discovered' CHECK (status IN ('discovered', 'validated', 'submitted', 'patched')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_exploit_chains_program ON exploit_chains(program_id);
CREATE INDEX idx_exploit_chains_status ON exploit_chains(status);
CREATE INDEX idx_exploit_chains_risk ON exploit_chains(overall_risk_score DESC);

-- ============================================================================
-- EXTERNAL INTEGRATIONS
-- ============================================================================

CREATE TABLE shodan_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    asset_id UUID REFERENCES assets(id) ON DELETE CASCADE,
    ip VARCHAR(50) NOT NULL,
    port INTEGER,
    protocol VARCHAR(50),
    banner TEXT,
    hostnames TEXT[],
    org VARCHAR(255),
    asn VARCHAR(50),
    location JSONB,
    vulnerabilities TEXT[],
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_shodan_results_asset ON shodan_results(asset_id);
CREATE INDEX idx_shodan_results_ip ON shodan_results(ip);

CREATE TABLE ct_log_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    domain VARCHAR(255) NOT NULL,
    issuer VARCHAR(255),
    not_before TIMESTAMP WITH TIME ZONE,
    not_after TIMESTAMP WITH TIME ZONE,
    subject_alt_names TEXT[],
    log_source VARCHAR(255),
    discovered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ct_log_entries_program ON ct_log_entries(program_id);
CREATE INDEX idx_ct_log_entries_domain ON ct_log_entries(domain);
CREATE INDEX idx_ct_log_entries_discovered ON ct_log_entries(discovered_at DESC);

CREATE TABLE github_secrets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    repository VARCHAR(500) NOT NULL,
    file_path TEXT NOT NULL,
    line_number INTEGER,
    secret_type VARCHAR(50),
    pattern VARCHAR(255),
    entropy FLOAT,
    redacted_value TEXT,
    commit_hash VARCHAR(40),
    commit_date TIMESTAMP WITH TIME ZONE,
    author VARCHAR(255),
    severity VARCHAR(20),
    verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_github_secrets_program ON github_secrets(program_id);
CREATE INDEX idx_github_secrets_repo ON github_secrets(repository);
CREATE INDEX idx_github_secrets_severity ON github_secrets(severity);
CREATE INDEX idx_github_secrets_verified ON github_secrets(verified);

-- ============================================================================
-- REPORT GENERATION
-- ============================================================================

CREATE TABLE report_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(50) CHECK (platform IN ('hackerone', 'bugcrowd', 'intigriti',
        'yeswehack', 'synack', 'generic')),
    format VARCHAR(50) CHECK (format IN ('markdown', 'html', 'pdf', 'docx')),
    sections JSONB NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_report_templates_platform ON report_templates(platform);
CREATE INDEX idx_report_templates_format ON report_templates(format);

CREATE TABLE generated_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    template_id UUID REFERENCES report_templates(id),
    platform VARCHAR(50),
    content TEXT NOT NULL,
    format VARCHAR(50),
    ai_model VARCHAR(50),
    human_reviewed BOOLEAN DEFAULT FALSE,
    reviewed_by VARCHAR(255),
    review_notes TEXT,
    status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'reviewed', 'submitted', 'accepted', 'rejected')),
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_generated_reports_finding ON generated_reports(finding_id);
CREATE INDEX idx_generated_reports_status ON generated_reports(status);

-- ============================================================================
-- CONTINUOUS MONITORING
-- ============================================================================

CREATE TABLE monitoring_targets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    monitoring_type VARCHAR(50) CHECK (monitoring_type IN ('continuous', 'periodic', 'on_change')),
    interval INTEGER, -- minutes
    checks JSONB NOT NULL,
    alert_threshold VARCHAR(20),
    enabled BOOLEAN DEFAULT TRUE,
    last_check TIMESTAMP WITH TIME ZONE,
    next_check TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_monitoring_targets_program ON monitoring_targets(program_id);
CREATE INDEX idx_monitoring_targets_asset ON monitoring_targets(asset_id);
CREATE INDEX idx_monitoring_targets_enabled ON monitoring_targets(enabled);
CREATE INDEX idx_monitoring_targets_next_check ON monitoring_targets(next_check);

CREATE TABLE monitoring_alerts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    monitoring_target_id UUID NOT NULL REFERENCES monitoring_targets(id) ON DELETE CASCADE,
    asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    alert_type VARCHAR(100),
    severity VARCHAR(20),
    message TEXT NOT NULL,
    changes JSONB,
    action_required BOOLEAN DEFAULT FALSE,
    auto_retest_triggered BOOLEAN DEFAULT FALSE,
    acknowledged BOOLEAN DEFAULT FALSE,
    acknowledged_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_monitoring_alerts_target ON monitoring_alerts(monitoring_target_id);
CREATE INDEX idx_monitoring_alerts_severity ON monitoring_alerts(severity);
CREATE INDEX idx_monitoring_alerts_acknowledged ON monitoring_alerts(acknowledged);

-- ============================================================================
-- VULNERABILITY RESEARCH LAB
-- ============================================================================

CREATE TABLE research_labs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('container', 'vm', 'kubernetes')),
    status VARCHAR(50) DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'running', 'stopped', 'terminated')),
    environment JSONB NOT NULL,
    config JSONB DEFAULT '{}',
    created_by VARCHAR(255) NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_research_labs_status ON research_labs(status);
CREATE INDEX idx_research_labs_created_by ON research_labs(created_by);

CREATE TABLE lab_experiments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lab_id UUID NOT NULL REFERENCES research_labs(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) CHECK (type IN ('poc_testing', 'exploit_dev', 'fuzzing', 'sandbox')),
    target TEXT,
    findings JSONB DEFAULT '[]',
    artifacts TEXT[],
    results JSONB,
    status VARCHAR(50) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_lab_experiments_lab ON lab_experiments(lab_id);
CREATE INDEX idx_lab_experiments_status ON lab_experiments(status);

-- ============================================================================
-- DISTRIBUTED SCANNING
-- ============================================================================

CREATE TABLE scanner_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    region VARCHAR(100) NOT NULL,
    ip_address VARCHAR(50) NOT NULL,
    proxy_type VARCHAR(20) CHECK (proxy_type IN ('socks5', 'http', 'https')),
    status VARCHAR(50) DEFAULT 'idle' CHECK (status IN ('active', 'idle', 'maintenance', 'offline')),
    capacity INTEGER DEFAULT 10,
    current_load INTEGER DEFAULT 0,
    supported_agents TEXT[],
    last_heartbeat TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scanner_nodes_status ON scanner_nodes(status);
CREATE INDEX idx_scanner_nodes_region ON scanner_nodes(region);
CREATE INDEX idx_scanner_nodes_heartbeat ON scanner_nodes(last_heartbeat DESC);

CREATE TABLE distributed_scans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    nodes TEXT[], -- Array of scanner node IDs
    strategy VARCHAR(50) CHECK (strategy IN ('round_robin', 'least_loaded', 'geographic', 'random')),
    ip_rotation BOOLEAN DEFAULT FALSE,
    aggregated_results JSONB,
    status VARCHAR(50) DEFAULT 'distributing' CHECK (status IN ('distributing', 'running', 'aggregating', 'completed', 'failed')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_distributed_scans_job ON distributed_scans(job_id);
CREATE INDEX idx_distributed_scans_status ON distributed_scans(status);

-- ============================================================================
-- SYSTEM CONFIGURATION & METRICS
-- ============================================================================

CREATE TABLE system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key VARCHAR(255) UNIQUE NOT NULL,
    config_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE system_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    jobs JSONB NOT NULL,
    workers JSONB NOT NULL,
    findings JSONB NOT NULL,
    performance JSONB NOT NULL,
    costs JSONB DEFAULT '{}',
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_system_metrics_timestamp ON system_metrics(timestamp DESC);

-- ============================================================================
-- TRIGGERS FOR updated_at
-- ============================================================================

CREATE TRIGGER update_data_sources_updated_at BEFORE UPDATE ON data_sources
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_policy_rules_updated_at BEFORE UPDATE ON policy_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_model_providers_updated_at BEFORE UPDATE ON model_providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_exploit_chains_updated_at BEFORE UPDATE ON exploit_chains
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_report_templates_updated_at BEFORE UPDATE ON report_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_generated_reports_updated_at BEFORE UPDATE ON generated_reports
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- VIEWS FOR ANALYTICS
-- ============================================================================

CREATE VIEW asset_graph_summary AS
SELECT
    p.id as program_id,
    p.name as program_name,
    COUNT(DISTINCT a.id) as total_assets,
    COUNT(DISTINCT ar.id) as total_relationships,
    COUNT(DISTINCT CASE WHEN ar.relationship_type = 'subdomain_of' THEN ar.id END) as subdomains,
    COUNT(DISTINCT CASE WHEN ar.relationship_type = 'resolves_to' THEN ar.id END) as dns_records,
    COUNT(DISTINCT ap.id) as attack_paths,
    MAX(ap.risk_score) as max_risk_score
FROM programs p
LEFT JOIN assets a ON p.id = a.program_id
LEFT JOIN asset_relationships ar ON a.id = ar.source_asset_id
LEFT JOIN attack_paths ap ON p.id = ap.program_id
GROUP BY p.id, p.name;

CREATE VIEW pending_approvals AS
SELECT
    ar.*,
    j.type as job_type,
    f.severity as finding_severity,
    COUNT(jsonb_array_elements(ar.approvers)) as approvals_count
FROM approval_requests ar
LEFT JOIN jobs j ON ar.job_id = j.id
LEFT JOIN findings f ON ar.finding_id = f.id
WHERE ar.status = 'pending'
AND (ar.expires_at IS NULL OR ar.expires_at > CURRENT_TIMESTAMP)
GROUP BY ar.id, j.type, f.severity;

CREATE VIEW triage_consensus AS
SELECT
    etr.finding_id,
    etr.ensemble_severity,
    etr.ensemble_confidence,
    etr.consensus_level,
    etr.recommended_action,
    f.severity as original_severity,
    f.status as finding_status,
    CASE
        WHEN etr.ensemble_severity != f.severity THEN true
        ELSE false
    END as severity_changed
FROM ensemble_triage_results etr
JOIN findings f ON etr.finding_id = f.id;

-- ============================================================================
-- STORED PROCEDURES & FUNCTIONS
-- ============================================================================

-- Function to calculate asset risk score based on relationships and findings
CREATE OR REPLACE FUNCTION calculate_asset_risk_score(asset_uuid UUID)
RETURNS FLOAT AS $$
DECLARE
    risk_score FLOAT := 0.0;
    finding_score FLOAT := 0.0;
    relationship_score FLOAT := 0.0;
BEGIN
    -- Calculate risk from findings
    SELECT COALESCE(SUM(
        CASE severity
            WHEN 'critical' THEN 10.0
            WHEN 'high' THEN 7.0
            WHEN 'medium' THEN 4.0
            WHEN 'low' THEN 2.0
            WHEN 'info' THEN 0.5
        END * confidence
    ), 0.0) INTO finding_score
    FROM findings
    WHERE asset_id = asset_uuid
    AND status NOT IN ('false_positive', 'closed');

    -- Calculate risk from relationships (connectivity = exposure)
    SELECT COALESCE(COUNT(*) * 0.1, 0.0) INTO relationship_score
    FROM asset_relationships
    WHERE source_asset_id = asset_uuid OR target_asset_id = asset_uuid;

    risk_score := finding_score + relationship_score;

    RETURN LEAST(risk_score, 100.0); -- Cap at 100
END;
$$ LANGUAGE plpgsql;

-- Function to chain immutable audit logs
CREATE OR REPLACE FUNCTION chain_audit_log()
RETURNS TRIGGER AS $$
DECLARE
    prev_hash VARCHAR(64);
BEGIN
    -- Get hash of previous log entry
    SELECT hash INTO prev_hash
    FROM immutable_audit_logs
    ORDER BY timestamp DESC
    LIMIT 1;

    -- If no previous entry, use a genesis hash
    IF prev_hash IS NULL THEN
        prev_hash := '0000000000000000000000000000000000000000000000000000000000000000';
    END IF;

    -- Set the hash to chain to previous entry
    NEW.hash := prev_hash;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chain_audit_log_trigger
BEFORE INSERT ON immutable_audit_logs
FOR EACH ROW EXECUTE FUNCTION chain_audit_log();
