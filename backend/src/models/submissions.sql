-- Submission Approval Workflow (Human-in-the-Loop)

CREATE TABLE IF NOT EXISTS submission_approvals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    finding_id UUID NOT NULL REFERENCES findings(id) ON DELETE CASCADE,
    requested_by VARCHAR(255) NOT NULL,
    approved_by VARCHAR(255),
    status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    notes TEXT,
    comments TEXT,
    auto_submit BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    approved_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_submission_approvals_finding ON submission_approvals(finding_id);
CREATE INDEX idx_submission_approvals_status ON submission_approvals(status);
CREATE INDEX idx_submission_approvals_requested_by ON submission_approvals(requested_by);

-- Scheduling Logs
CREATE TABLE IF NOT EXISTS scheduling_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type VARCHAR(50) NOT NULL,
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    priority_score INTEGER NOT NULL,
    factors JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_scheduling_logs_program ON scheduling_logs(program_id);
CREATE INDEX idx_scheduling_logs_created ON scheduling_logs(created_at DESC);
CREATE INDEX idx_scheduling_logs_type ON scheduling_logs(job_type);

-- Export Logs
CREATE TABLE IF NOT EXISTS export_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    program_id UUID REFERENCES programs(id) ON DELETE CASCADE,
    export_type VARCHAR(50) NOT NULL,
    format VARCHAR(10) NOT NULL,
    file_url TEXT NOT NULL,
    exported_by VARCHAR(255),
    record_count INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_export_logs_program ON export_logs(program_id);
CREATE INDEX idx_export_logs_created ON export_logs(created_at DESC);
