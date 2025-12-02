-- Migration 003: Add Handoffs and Turns/Interactions tables
-- Phase 1.2: Handoffs System
-- Phase 2.3: Turns and Interactions Model

-- Enable UUID extension (skip if already exists)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PHASE 1.2: HANDOFFS SYSTEM
-- ============================================================================

-- Handoffs table: Track agent-to-agent delegations
CREATE TABLE IF NOT EXISTS handoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_agent VARCHAR(100) NOT NULL,
  to_agent VARCHAR(100) NOT NULL,
  reason TEXT NOT NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
  next_job_id UUID,
  context JSONB, -- Contains: data, metadata, chain
  priority INTEGER DEFAULT 5,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_handoffs_job_id ON handoffs(job_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_next_job_id ON handoffs(next_job_id);
CREATE INDEX IF NOT EXISTS idx_handoffs_from_agent ON handoffs(from_agent);
CREATE INDEX IF NOT EXISTS idx_handoffs_to_agent ON handoffs(to_agent);
CREATE INDEX IF NOT EXISTS idx_handoffs_created_at ON handoffs(created_at DESC);

-- ============================================================================
-- PHASE 2.3: TURNS AND INTERACTIONS MODEL (ReACT Pattern)
-- ============================================================================

-- Turns table: High-level execution cycles
CREATE TABLE IF NOT EXISTS turns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, -- Turn number (1, 2, 3, ...)
  state VARCHAR(50) NOT NULL DEFAULT 'active', -- active, completed, failed
  trigger VARCHAR(50), -- initial, orchestrator, handoff
  metadata JSONB, -- Additional context
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  UNIQUE(job_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_turns_job_id ON turns(job_id);
CREATE INDEX IF NOT EXISTS idx_turns_state ON turns(state);
CREATE INDEX IF NOT EXISTS idx_turns_created_at ON turns(created_at DESC);

-- Interactions table: Individual reasoning-action cycles within a turn
CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turn_id UUID NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL, -- Interaction number within turn (1, 2, 3, ...)
  reasoning JSONB, -- LLM reasoning: { prompt, response, model, tokens }
  state VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, reasoning, acting, completed, failed
  metadata JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP,
  UNIQUE(turn_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_interactions_turn_id ON interactions(turn_id);
CREATE INDEX IF NOT EXISTS idx_interactions_state ON interactions(state);
CREATE INDEX IF NOT EXISTS idx_interactions_created_at ON interactions(created_at DESC);

-- Actions table: Tool executions within an interaction
CREATE TABLE IF NOT EXISTS actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interaction_id UUID NOT NULL REFERENCES interactions(id) ON DELETE CASCADE,
  tool VARCHAR(100) NOT NULL, -- Tool name (nuclei, httpx, dnsx, etc.)
  input JSONB NOT NULL, -- Tool input parameters
  output JSONB, -- Tool output
  duration_ms INTEGER, -- Execution time
  error TEXT, -- Error message if failed
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_actions_interaction_id ON actions(interaction_id);
CREATE INDEX IF NOT EXISTS idx_actions_tool ON actions(tool);
CREATE INDEX IF NOT EXISTS idx_actions_created_at ON actions(created_at DESC);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Function to get handoff chain for a job (recursive)
CREATE OR REPLACE FUNCTION get_handoff_chain(p_job_id UUID)
RETURNS TABLE (
  handoff_id UUID,
  from_agent VARCHAR,
  to_agent VARCHAR,
  reason TEXT,
  job_id UUID,
  next_job_id UUID,
  priority INTEGER,
  created_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE handoff_chain AS (
    SELECT
      h.id,
      h.from_agent,
      h.to_agent,
      h.reason,
      h.job_id,
      h.next_job_id,
      h.priority,
      h.created_at
    FROM handoffs h
    WHERE h.job_id = p_job_id

    UNION ALL

    SELECT
      h.id,
      h.from_agent,
      h.to_agent,
      h.reason,
      h.job_id,
      h.next_job_id,
      h.priority,
      h.created_at
    FROM handoffs h
    INNER JOIN handoff_chain hc ON h.job_id = hc.next_job_id
  )
  SELECT * FROM handoff_chain ORDER BY created_at;
END;
$$ LANGUAGE plpgsql;

-- Function to get turn summary for a job
CREATE OR REPLACE FUNCTION get_turn_summary(p_job_id UUID)
RETURNS TABLE (
  turn_sequence INTEGER,
  turn_state VARCHAR,
  interaction_count BIGINT,
  action_count BIGINT,
  total_duration_ms BIGINT,
  created_at TIMESTAMP,
  completed_at TIMESTAMP
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    t.sequence,
    t.state,
    COUNT(DISTINCT i.id) as interaction_count,
    COUNT(DISTINCT a.id) as action_count,
    SUM(a.duration_ms) as total_duration_ms,
    t.created_at,
    t.completed_at
  FROM turns t
  LEFT JOIN interactions i ON i.turn_id = t.id
  LEFT JOIN actions a ON a.interaction_id = i.id
  WHERE t.job_id = p_job_id
  GROUP BY t.id, t.sequence, t.state, t.created_at, t.completed_at
  ORDER BY t.sequence;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE handoffs IS 'Agent-to-agent delegation tracking (Phase 1.2)';
COMMENT ON TABLE turns IS 'High-level execution cycles for agents (Phase 2.3)';
COMMENT ON TABLE interactions IS 'Reasoning-action cycles within turns (Phase 2.3)';
COMMENT ON TABLE actions IS 'Tool executions within interactions (Phase 2.3)';

COMMENT ON COLUMN handoffs.context IS 'Contains: { data: {...}, metadata: { programId, chain: [] } }';
COMMENT ON COLUMN turns.trigger IS 'What triggered this turn: initial, orchestrator, handoff';
COMMENT ON COLUMN interactions.reasoning IS 'LLM reasoning: { prompt: string, response: string, model: string, tokens: number }';
COMMENT ON COLUMN actions.input IS 'Tool input parameters as JSON';
COMMENT ON COLUMN actions.output IS 'Tool output as JSON (can be large, consider compression)';
