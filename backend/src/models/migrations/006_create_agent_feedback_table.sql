-- Migration 006: Create agent_feedback table
-- Stores feedback provided by agents to one another for learning and adaptation.

CREATE TABLE IF NOT EXISTS agent_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feedback_type VARCHAR(50) NOT NULL, -- e.g., 'false_positive', 'true_positive', 'performance_issue', 'suggestion'
    from_agent_type VARCHAR(50) NOT NULL,
    to_agent_type VARCHAR(50) NOT NULL,
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    original_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    finding_id UUID REFERENCES findings(id) ON DELETE SET NULL,
    template_id TEXT, -- e.g., for scanner templates
    reason TEXT NOT NULL,
    details JSONB,
    severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP INDEX IF EXISTS idx_agent_feedback_from_agent;
CREATE INDEX idx_agent_feedback_from_agent ON agent_feedback(from_agent_type);
DROP INDEX IF EXISTS idx_agent_feedback_to_agent;
CREATE INDEX idx_agent_feedback_to_agent ON agent_feedback(to_agent_type);
DROP INDEX IF EXISTS idx_agent_feedback_program_id;
CREATE INDEX idx_agent_feedback_program_id ON agent_feedback(program_id);
DROP INDEX IF EXISTS idx_agent_feedback_finding_id;
CREATE INDEX idx_agent_feedback_finding_id ON agent_feedback(finding_id);
DROP INDEX IF EXISTS idx_agent_feedback_template_id;
CREATE INDEX idx_agent_feedback_template_id ON agent_feedback(template_id);
DROP INDEX IF EXISTS idx_agent_feedback_type;
CREATE INDEX idx_agent_feedback_type ON agent_feedback(feedback_type);
