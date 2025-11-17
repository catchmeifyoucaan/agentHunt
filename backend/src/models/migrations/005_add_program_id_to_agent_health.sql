-- Migration 005: Add program_id to agent_health
-- Adds program_id to the agent_health table to allow for program-specific health monitoring and recovery.

ALTER TABLE agent_health
ADD COLUMN IF NOT EXISTS program_id UUID REFERENCES programs(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_agent_health_program_id;
CREATE INDEX idx_agent_health_program_id ON agent_health(program_id);
