-- Migration 005: Approval Workflow and Audit Logging
-- Adds support for:
-- - Approval requests for critical/destructive operations
-- - Audit logging for security and compliance
-- - Turn-based execution tracking tables

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- APPROVAL REQUESTS
-- =====================================================

CREATE TABLE IF NOT EXISTS approval_requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    action VARCHAR(100) NOT NULL,
    reason TEXT NOT NULL,
    requested_by VARCHAR(100) NOT NULL,
    requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, approved, rejected, expired
    approved_by VARCHAR(100),
    approved_at TIMESTAMP,
    rejection_reason TEXT,
    expires_at TIMESTAMP NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    danger_level VARCHAR(50) NOT NULL DEFAULT 'critical', -- safe, elevated, critical, destructive
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP INDEX IF EXISTS idx_approval_requests_status;
CREATE INDEX idx_approval_requests_status ON approval_requests(status);
DROP INDEX IF EXISTS idx_approval_requests_expires;
CREATE INDEX idx_approval_requests_expires ON approval_requests(expires_at) WHERE status = 'pending';
DROP INDEX IF EXISTS idx_approval_requests_requested_by;
CREATE INDEX idx_approval_requests_requested_by ON approval_requests(requested_by);
DROP INDEX IF EXISTS idx_approval_requests_danger_level;
CREATE INDEX idx_approval_requests_danger_level ON approval_requests(danger_level);

-- =====================================================
-- AUDIT LOGS
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP INDEX IF EXISTS idx_audit_logs_event_type;
CREATE INDEX idx_audit_logs_event_type ON audit_logs(event_type);
DROP INDEX IF EXISTS idx_audit_logs_created_at;
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- =====================================================
-- TURNS (for TurnManager)
-- =====================================================

CREATE TABLE IF NOT EXISTS turns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    state VARCHAR(50) NOT NULL DEFAULT 'active', -- active, completed, failed
    trigger VARCHAR(50) NOT NULL, -- initial, orchestrator, handoff
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

DROP INDEX IF EXISTS idx_turns_job_id;
CREATE INDEX idx_turns_job_id ON turns(job_id);
DROP INDEX IF EXISTS idx_turns_state;
CREATE INDEX idx_turns_state ON turns(state);

-- =====================================================
-- INTERACTIONS (for TurnManager)
-- =====================================================

CREATE TABLE IF NOT EXISTS interactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    turn_id UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    reasoning JSONB, -- prompt, response, model, tokens
    state VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, reasoning, acting, completed, failed
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

DROP INDEX IF EXISTS idx_interactions_turn_id;
CREATE INDEX idx_interactions_turn_id ON interactions(turn_id);
DROP INDEX IF EXISTS idx_interactions_state;
CREATE INDEX idx_interactions_state ON interactions(state);

-- =====================================================
-- ACTIONS (for TurnManager)
-- =====================================================

CREATE TABLE IF NOT EXISTS actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
    tool VARCHAR(100) NOT NULL,
    input JSONB NOT NULL,
    output JSONB,
    duration_ms INTEGER,
    error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

DROP INDEX IF EXISTS idx_actions_interaction_id;
CREATE INDEX idx_actions_interaction_id ON actions(interaction_id);
DROP INDEX IF EXISTS idx_actions_tool;
CREATE INDEX idx_actions_tool ON actions(tool);

-- =====================================================
-- HELPER FUNCTION: Get turn summary for a job
-- =====================================================

CREATE OR REPLACE FUNCTION get_turn_summary(p_job_id UUID)
RETURNS TABLE (
    turn_id UUID,
    turn_sequence INTEGER,
    turn_state VARCHAR(50),
    interaction_count BIGINT,
    action_count BIGINT,
    total_duration_ms BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id as turn_id,
        t.sequence as turn_sequence,
        t.state as turn_state,
        COUNT(DISTINCT i.id) as interaction_count,
        COUNT(DISTINCT a.id) as action_count,
        COALESCE(SUM(a.duration_ms), 0) as total_duration_ms
    FROM turns t
    LEFT JOIN interactions i ON i.turn_id = t.id
    LEFT JOIN actions a ON a.interaction_id = i.id
    WHERE t.job_id = p_job_id
    GROUP BY t.id, t.sequence, t.state
    ORDER BY t.sequence;
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- COMMENTS
-- =====================================================

COMMENT ON TABLE approval_requests IS 'Approval workflow for critical/destructive operations';
COMMENT ON TABLE audit_logs IS 'Security and compliance audit trail';
COMMENT ON TABLE turns IS 'Turn-based execution tracking (ReACT pattern)';
COMMENT ON TABLE interactions IS 'Reasoning + Action cycles within turns';
COMMENT ON TABLE actions IS 'Individual tool executions within interactions';
