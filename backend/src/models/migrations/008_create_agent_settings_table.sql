-- Migration 008: Create agent_settings table
-- Stores agent-specific configurations, allowing for granular control and dynamic updates.

CREATE TABLE IF NOT EXISTS agent_settings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_type VARCHAR(50) NOT NULL UNIQUE, -- e.g., 'scanner', 'confirm'
    settings JSONB NOT NULL DEFAULT '{}', -- JSON object for agent-specific settings
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_settings_agent_type ON agent_settings(agent_type);
