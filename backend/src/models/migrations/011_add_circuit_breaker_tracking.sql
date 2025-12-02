-- Migration 011: Add circuit breaker tracking to agent_health
-- Adds circuit breaker state tracking to persist across restarts

ALTER TABLE agent_health ADD COLUMN IF NOT EXISTS circuit_breaker_state VARCHAR(20) DEFAULT 'closed';
ALTER TABLE agent_health ADD COLUMN IF NOT EXISTS circuit_breaker_failures INTEGER DEFAULT 0;
ALTER TABLE agent_health ADD COLUMN IF NOT EXISTS circuit_breaker_opened_at TIMESTAMP;
ALTER TABLE agent_health ADD COLUMN IF NOT EXISTS circuit_breaker_next_attempt TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_agent_health_circuit_state ON agent_health(circuit_breaker_state);
CREATE INDEX IF NOT EXISTS idx_agent_health_circuit_next_attempt ON agent_health(circuit_breaker_next_attempt);
