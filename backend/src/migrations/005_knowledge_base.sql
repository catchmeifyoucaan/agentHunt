-- Migration: Knowledge Base for RAG System
-- Phase 2 - Intelligence
-- Creates tables for storing security knowledge with vector embeddings

-- Knowledge Base Table
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY,
    type VARCHAR(50) NOT NULL CHECK (type IN ('vulnerability', 'exploit', 'technique', 'finding', 'template', 'tool')),

    -- Content
    title VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    content TEXT NOT NULL,

    -- Metadata
    severity VARCHAR(20) CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
    cve_id VARCHAR(50),
    cwe_id VARCHAR(50),
    tags JSONB NOT NULL DEFAULT '[]',

    -- Source
    source VARCHAR(50) NOT NULL CHECK (source IN ('internal', 'cve', 'exploitdb', 'github', 'nuclei', 'manual')),
    source_url TEXT,
    author VARCHAR(200),

    -- Embeddings for semantic search
    embedding JSONB NOT NULL, -- Vector embedding as JSON array
    embedding_model VARCHAR(100) NOT NULL,

    -- Usage tracking
    times_used INTEGER NOT NULL DEFAULT 0,
    success_rate DECIMAL(3,2) NOT NULL DEFAULT 0.50 CHECK (success_rate >= 0 AND success_rate <= 1),
    last_used TIMESTAMP,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- Indexes
    CONSTRAINT knowledge_base_cve_unique UNIQUE (cve_id)
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_base_type ON knowledge_base(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_source ON knowledge_base(source);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_severity ON knowledge_base(severity);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_tags ON knowledge_base USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_success_rate ON knowledge_base(success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_times_used ON knowledge_base(times_used DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_created_at ON knowledge_base(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_cve_id ON knowledge_base(cve_id) WHERE cve_id IS NOT NULL;

-- Vulnerability-specific metadata (extends knowledge_base)
CREATE TABLE IF NOT EXISTS vulnerability_metadata (
    knowledge_id UUID PRIMARY KEY REFERENCES knowledge_base(id) ON DELETE CASCADE,

    -- Vulnerability details
    affected_software JSONB DEFAULT '[]',
    affected_versions JSONB DEFAULT '[]',
    cvss DECIMAL(3,1),

    -- Exploitation
    exploit_available BOOLEAN DEFAULT FALSE,
    exploit_difficulty VARCHAR(20) CHECK (exploit_difficulty IN ('easy', 'medium', 'hard')),
    requires_auth BOOLEAN DEFAULT FALSE,

    -- Detection
    detection_signatures JSONB DEFAULT '[]',
    nuclei_template_id VARCHAR(200),

    -- Remediation
    remediation TEXT,
    patches JSONB DEFAULT '[]',

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Exploit-specific metadata (extends knowledge_base)
CREATE TABLE IF NOT EXISTS exploit_metadata (
    knowledge_id UUID PRIMARY KEY REFERENCES knowledge_base(id) ON DELETE CASCADE,

    -- Exploit details
    target_vulnerability VARCHAR(200), -- CVE ID or description
    language VARCHAR(50) NOT NULL CHECK (language IN ('python', 'bash', 'ruby', 'javascript', 'go', 'other')),
    framework VARCHAR(100),

    -- Code
    exploit_code TEXT NOT NULL,
    dependencies JSONB DEFAULT '[]',

    -- Effectiveness
    average_execution_time INTEGER, -- milliseconds
    requires_interaction BOOLEAN DEFAULT FALSE,

    -- Constraints
    requires_network BOOLEAN DEFAULT TRUE,
    requires_auth BOOLEAN DEFAULT FALSE,
    requires_privileges VARCHAR(100),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Technique-specific metadata (extends knowledge_base)
CREATE TABLE IF NOT EXISTS technique_metadata (
    knowledge_id UUID PRIMARY KEY REFERENCES knowledge_base(id) ON DELETE CASCADE,

    -- Technique details
    category VARCHAR(50) NOT NULL CHECK (category IN ('reconnaissance', 'exploitation', 'post-exploitation', 'evasion', 'other')),
    mitre_attack_id VARCHAR(50), -- MITRE ATT&CK technique ID

    -- Steps
    steps JSONB NOT NULL DEFAULT '[]',
    prerequisites JSONB DEFAULT '[]',

    -- Tools
    required_tools JSONB DEFAULT '[]',
    optional_tools JSONB DEFAULT '[]',

    -- Indicators
    indicators JSONB DEFAULT '[]', -- IoCs that might be generated

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Agent learning history
CREATE TABLE IF NOT EXISTS agent_learning_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Agent info
    agent_type VARCHAR(50) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,

    -- Learning event
    knowledge_id UUID REFERENCES knowledge_base(id) ON DELETE CASCADE,
    action_taken TEXT NOT NULL,
    result_success BOOLEAN NOT NULL,
    result_data JSONB,

    -- Reflection
    insights JSONB DEFAULT '[]',
    mistakes JSONB DEFAULT '[]',
    improvements JSONB DEFAULT '[]',

    -- Context
    target_url TEXT,
    program_id UUID,
    job_id UUID,

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_agent_learning_agent_type ON agent_learning_history(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_learning_knowledge_id ON agent_learning_history(knowledge_id);
CREATE INDEX IF NOT EXISTS idx_agent_learning_created_at ON agent_learning_history(created_at DESC);

-- Strategy adaptations tracking
CREATE TABLE IF NOT EXISTS strategy_adaptations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Agent info
    agent_type VARCHAR(50) NOT NULL,
    agent_id VARCHAR(100) NOT NULL,

    -- Strategy
    original_strategy TEXT NOT NULL,
    adapted_strategy TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    expected_improvement DECIMAL(3,2) NOT NULL CHECK (expected_improvement >= 0 AND expected_improvement <= 1),
    risk_level VARCHAR(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high')),

    -- Results
    actual_improvement DECIMAL(3,2), -- Filled in after testing
    was_successful BOOLEAN,

    -- Context
    trigger_reason TEXT,
    success_rate_before DECIMAL(3,2),
    success_rate_after DECIMAL(3,2),

    -- Timestamps
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    tested_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_strategy_adaptations_agent_type ON strategy_adaptations(agent_type);
CREATE INDEX IF NOT EXISTS idx_strategy_adaptations_created_at ON strategy_adaptations(created_at DESC);

-- Comments
COMMENT ON TABLE knowledge_base IS 'RAG knowledge base for storing security knowledge with vector embeddings';
COMMENT ON COLUMN knowledge_base.embedding IS 'Vector embedding as JSON array for semantic search';
COMMENT ON COLUMN knowledge_base.success_rate IS 'Success rate based on actual usage (0.0-1.0)';
COMMENT ON TABLE agent_learning_history IS 'Tracks agent learning events and reflections';
COMMENT ON TABLE strategy_adaptations IS 'Tracks strategy adaptations by metacognitive reasoning';
