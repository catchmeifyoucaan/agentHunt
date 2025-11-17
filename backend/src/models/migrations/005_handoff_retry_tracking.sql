-- Migration: Add retry_count column and circuit breaker status to rich_handoffs table
-- Adds retry tracking and circuit breaker functionality for rich handoff processing

-- Add retry_count column to rich_handoffs table
ALTER TABLE rich_handoffs ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Update the pending_handoffs view to include retry count
CREATE OR REPLACE VIEW pending_handoffs AS
SELECT
    rh.id,
    rh.from_agent_type,
    rh.to_agent_type,
    rh.program_id,
    rh.reasoning->>'trigger' as trigger,
    (rh.reasoning->>'confidence')::numeric as confidence,
    rh.objectives->>'primary' as primary_objective,
    rh.status,
    rh.retry_count,
    rh.created_at,
    j.type as from_job_type,
    j.status as from_job_status
FROM rich_handoffs rh
LEFT JOIN jobs j ON rh.from_job_id = j.id
WHERE rh.status = 'pending'
ORDER BY rh.created_at DESC;