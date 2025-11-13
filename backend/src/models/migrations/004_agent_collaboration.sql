-- Migration 004: Agent Collaboration Features
-- Adds support for:
-- - Job progress tracking (like Claude Code's TodoWrite)
-- - Agent-to-agent messaging
-- - Checkpoints and rollback
-- - Agent health monitoring
-- - Declarative workflows

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- JOB PROGRESS TRACKING
-- =====================================================

CREATE TABLE IF NOT EXISTS job_progress (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    phase VARCHAR(100) NOT NULL,
    current_step INTEGER NOT NULL DEFAULT 0,
    overall_progress INTEGER NOT NULL DEFAULT 0, -- 0-100
    estimated_completion TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS progress_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    progress_id UUID NOT NULL REFERENCES job_progress(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    name VARCHAR(200) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, paused
    progress INTEGER DEFAULT 0, -- 0-100
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    error TEXT,
    metadata JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_job_progress_job_id ON job_progress(job_id);
CREATE INDEX idx_progress_steps_progress_id ON progress_steps(progress_id);
CREATE INDEX idx_progress_steps_status ON progress_steps(status);

-- =====================================================
-- AGENT MESSAGING
-- =====================================================

CREATE TABLE IF NOT EXISTS agent_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL, -- handoff, query, notification, approval_request, response
    from_agent_type VARCHAR(50) NOT NULL,
    from_agent_instance VARCHAR(100) NOT NULL,
    to_agent_type VARCHAR(50) NOT NULL,
    to_agent_instance VARCHAR(100),
    payload JSONB NOT NULL,
    reply_to UUID REFERENCES agent_messages(id),
    expires_at TIMESTAMP,
    read_at TIMESTAMP,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_messages_to_agent ON agent_messages(to_agent_type, to_agent_instance);
CREATE INDEX idx_agent_messages_reply_to ON agent_messages(reply_to);
CREATE INDEX idx_agent_messages_created_at ON agent_messages(created_at DESC);
CREATE INDEX idx_agent_messages_unread ON agent_messages(to_agent_type) WHERE read_at IS NULL;

-- =====================================================
-- RICH HANDOFFS
-- =====================================================

CREATE TABLE IF NOT EXISTS rich_handoffs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    from_agent_type VARCHAR(50) NOT NULL,
    from_agent_instance VARCHAR(100) NOT NULL,
    from_job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    to_agent_type VARCHAR(50) NOT NULL,
    to_agent_instance VARCHAR(100),
    to_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,

    -- Context package
    parent_result JSONB NOT NULL,
    reasoning JSONB NOT NULL, -- trigger, confidence, alternatives, decisionFactors
    objectives JSONB NOT NULL, -- primary, secondary, avoid
    success_criteria JSONB NOT NULL, -- minAssets, maxDuration, requiredFields, qualityThreshold
    inherited_constraints JSONB NOT NULL, -- programId, rateLimit, timeout, safetyChecks, budget
    output_contract JSONB NOT NULL, -- format, requiredFields, shouldTriggerNextHandoff, expectedVolume

    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, accepted, rejected, completed, failed
    rejection_reason TEXT,
    completion_result JSONB,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    accepted_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_rich_handoffs_from_job ON rich_handoffs(from_job_id);
CREATE INDEX idx_rich_handoffs_to_job ON rich_handoffs(to_job_id);
CREATE INDEX idx_rich_handoffs_program ON rich_handoffs(program_id);
CREATE INDEX idx_rich_handoffs_status ON rich_handoffs(status);
CREATE INDEX idx_rich_handoffs_created_at ON rich_handoffs(created_at DESC);

-- =====================================================
-- CHECKPOINTS (Rollback Support)
-- =====================================================

CREATE TABLE IF NOT EXISTS checkpoints (
    id VARCHAR(200) PRIMARY KEY,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    state JSONB NOT NULL, -- jobStatus, assetCount, findingCount, handoffCount, artifacts
    database_snapshot JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    rolled_back_at TIMESTAMP,
    rollback_reason TEXT
);

CREATE INDEX idx_checkpoints_job_id ON checkpoints(job_id);
CREATE INDEX idx_checkpoints_created_at ON checkpoints(created_at DESC);

-- =====================================================
-- AGENT HEALTH MONITORING
-- =====================================================

CREATE TABLE IF NOT EXISTS agent_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_type VARCHAR(50) NOT NULL,
    instance_id VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'healthy', -- healthy, degraded, unhealthy, offline

    -- Metrics
    jobs_processed INTEGER NOT NULL DEFAULT 0,
    jobs_failed INTEGER NOT NULL DEFAULT 0,
    avg_duration INTEGER NOT NULL DEFAULT 0, -- milliseconds
    memory_usage INTEGER NOT NULL DEFAULT 0, -- MB
    cpu_usage INTEGER NOT NULL DEFAULT 0, -- percentage
    queue_depth INTEGER NOT NULL DEFAULT 0,
    error_rate NUMERIC(5,2) NOT NULL DEFAULT 0, -- percentage

    last_heartbeat TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agent_health_issues (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    health_id UUID NOT NULL REFERENCES agent_health(id) ON DELETE CASCADE,
    severity VARCHAR(50) NOT NULL, -- low, medium, high, critical
    type VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    auto_healing_attempted BOOLEAN DEFAULT FALSE,
    auto_healing_successful BOOLEAN,
    auto_healing_action TEXT,
    resolved_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_agent_health_unique ON agent_health(agent_type, instance_id);
CREATE INDEX idx_agent_health_status ON agent_health(status);
CREATE INDEX idx_agent_health_heartbeat ON agent_health(last_heartbeat DESC);
CREATE INDEX idx_agent_health_issues_severity ON agent_health_issues(severity);
CREATE INDEX idx_agent_health_issues_unresolved ON agent_health_issues(health_id) WHERE resolved_at IS NULL;

-- =====================================================
-- DECLARATIVE WORKFLOWS
-- =====================================================

CREATE TABLE IF NOT EXISTS workflows (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(200) NOT NULL UNIQUE,
    version VARCHAR(50) NOT NULL,
    description TEXT,
    trigger_config JSONB NOT NULL, -- on, filters
    error_handling JSONB NOT NULL, -- onStepFailure, onCriticalFailure, notifyOn
    metadata JSONB,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    step_id VARCHAR(100) NOT NULL, -- Unique within workflow
    name VARCHAR(200) NOT NULL,
    agent_type VARCHAR(50) NOT NULL,
    input_template TEXT NOT NULL, -- JavaScript function as string
    output_variable VARCHAR(100) NOT NULL,
    parallel BOOLEAN DEFAULT FALSE,
    retry_strategy JSONB,
    timeout INTEGER, -- seconds
    dependencies JSONB, -- Array of step_ids
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    trigger_event VARCHAR(100) NOT NULL,
    trigger_context JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'running', -- running, completed, failed, paused
    current_step_id UUID REFERENCES workflow_steps(id),
    execution_context JSONB NOT NULL, -- Accumulated variables from steps
    error TEXT,
    started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workflow_step_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    execution_id UUID NOT NULL REFERENCES workflow_executions(id) ON DELETE CASCADE,
    step_id UUID NOT NULL REFERENCES workflow_steps(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, retrying
    attempt INTEGER NOT NULL DEFAULT 1,
    input JSONB,
    output JSONB,
    error TEXT,
    started_at TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX idx_workflows_name ON workflows(name);
CREATE INDEX idx_workflows_enabled ON workflows(enabled);
CREATE INDEX idx_workflow_steps_workflow_id ON workflow_steps(workflow_id, sequence);
CREATE INDEX idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
CREATE INDEX idx_workflow_executions_status ON workflow_executions(status);
CREATE INDEX idx_workflow_step_executions_execution_id ON workflow_step_executions(execution_id);
CREATE INDEX idx_workflow_step_executions_status ON workflow_step_executions(status);

-- =====================================================
-- COMMAND VALIDATION HISTORY
-- =====================================================

CREATE TABLE IF NOT EXISTS command_validations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    agent_type VARCHAR(50) NOT NULL,
    command TEXT NOT NULL,
    validation_result JSONB NOT NULL, -- safe, reasons, estimatedResources, warnings
    executed BOOLEAN DEFAULT FALSE,
    actual_resources JSONB, -- Actual resource usage after execution
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_command_validations_job_id ON command_validations(job_id);
CREATE INDEX idx_command_validations_agent_type ON command_validations(agent_type);
CREATE INDEX idx_command_validations_created_at ON command_validations(created_at DESC);

-- =====================================================
-- PARALLEL JOB SCHEDULING
-- =====================================================

CREATE TABLE IF NOT EXISTS parallel_job_groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    parent_job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    max_concurrency INTEGER,
    wait_for VARCHAR(50) NOT NULL DEFAULT 'all', -- all, any, first
    timeout INTEGER, -- seconds
    status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS parallel_job_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES parallel_job_groups(id) ON DELETE CASCADE,
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sequence INTEGER NOT NULL,
    dependencies JSONB, -- Array of job IDs
    wait_for VARCHAR(50) DEFAULT 'completion', -- completion, start
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_parallel_job_groups_program_id ON parallel_job_groups(program_id);
CREATE INDEX idx_parallel_job_groups_status ON parallel_job_groups(status);
CREATE INDEX idx_parallel_job_members_group_id ON parallel_job_members(group_id);
CREATE INDEX idx_parallel_job_members_job_id ON parallel_job_members(job_id);

-- =====================================================
-- TRIGGERS FOR AUTO-UPDATE
-- =====================================================

-- Auto-update job_progress.updated_at
CREATE OR REPLACE FUNCTION update_job_progress_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_job_progress_timestamp
    BEFORE UPDATE ON job_progress
    FOR EACH ROW
    EXECUTE FUNCTION update_job_progress_timestamp();

-- Auto-update progress_steps.updated_at
CREATE TRIGGER trigger_update_progress_steps_timestamp
    BEFORE UPDATE ON progress_steps
    FOR EACH ROW
    EXECUTE FUNCTION update_job_progress_timestamp();

-- Auto-update agent_health.updated_at
CREATE TRIGGER trigger_update_agent_health_timestamp
    BEFORE UPDATE ON agent_health
    FOR EACH ROW
    EXECUTE FUNCTION update_job_progress_timestamp();

-- Auto-update workflows.updated_at
CREATE TRIGGER trigger_update_workflows_timestamp
    BEFORE UPDATE ON workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_job_progress_timestamp();

-- =====================================================
-- VIEWS FOR COMMON QUERIES
-- =====================================================

-- Active job progress with step details
CREATE OR REPLACE VIEW active_job_progress AS
SELECT
    jp.id,
    jp.job_id,
    jp.phase,
    jp.current_step,
    jp.overall_progress,
    jp.estimated_completion,
    j.program_id,
    j.type as job_type,
    j.status as job_status,
    jsonb_agg(
        jsonb_build_object(
            'sequence', ps.sequence,
            'name', ps.name,
            'status', ps.status,
            'progress', ps.progress,
            'start_time', ps.start_time,
            'end_time', ps.end_time,
            'error', ps.error
        ) ORDER BY ps.sequence
    ) as steps
FROM job_progress jp
JOIN jobs j ON jp.job_id = j.id
LEFT JOIN progress_steps ps ON jp.id = ps.progress_id
WHERE j.status IN ('queued', 'running')
GROUP BY jp.id, jp.job_id, jp.phase, jp.current_step, jp.overall_progress,
         jp.estimated_completion, j.program_id, j.type, j.status;

-- Agent health summary
CREATE OR REPLACE VIEW agent_health_summary AS
SELECT
    ah.agent_type,
    COUNT(DISTINCT ah.instance_id) as instance_count,
    COUNT(CASE WHEN ah.status = 'healthy' THEN 1 END) as healthy_count,
    COUNT(CASE WHEN ah.status = 'degraded' THEN 1 END) as degraded_count,
    COUNT(CASE WHEN ah.status = 'unhealthy' THEN 1 END) as unhealthy_count,
    COUNT(CASE WHEN ah.status = 'offline' THEN 1 END) as offline_count,
    AVG(ah.error_rate) as avg_error_rate,
    AVG(ah.memory_usage) as avg_memory_usage,
    AVG(ah.cpu_usage) as avg_cpu_usage,
    SUM(ah.queue_depth) as total_queue_depth,
    MAX(ah.last_heartbeat) as last_heartbeat
FROM agent_health ah
GROUP BY ah.agent_type;

-- Pending handoffs with full context
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
    rh.created_at,
    j.type as from_job_type,
    j.status as from_job_status
FROM rich_handoffs rh
LEFT JOIN jobs j ON rh.from_job_id = j.id
WHERE rh.status = 'pending'
ORDER BY rh.created_at DESC;

COMMENT ON TABLE job_progress IS 'Real-time job progress tracking inspired by Claude Code TodoWrite pattern';
COMMENT ON TABLE agent_messages IS 'Agent-to-agent messaging protocol for collaboration';
COMMENT ON TABLE rich_handoffs IS 'Enhanced handoffs with complete context preservation';
COMMENT ON TABLE checkpoints IS 'Job state snapshots for rollback capability';
COMMENT ON TABLE agent_health IS 'Agent health monitoring and self-healing';
COMMENT ON TABLE workflows IS 'Declarative workflow definitions';
COMMENT ON TABLE command_validations IS 'Pre-execution validation history for safety';
