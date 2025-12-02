-- Migration 007: Add source_agent_type and template_id to findings
-- Adds columns to the findings table to track which agent reported the finding and, if applicable, which template was used.
-- This is crucial for the feedback loop, allowing agents to adapt their behavior based on false positives.

ALTER TABLE findings
ADD COLUMN IF NOT EXISTS source_agent_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS template_id TEXT;

CREATE INDEX IF NOT EXISTS idx_findings_source_agent_type ON findings(source_agent_type);
CREATE INDEX IF NOT EXISTS idx_findings_template_id ON findings(template_id);
