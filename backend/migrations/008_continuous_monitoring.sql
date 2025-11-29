-- Continuous Monitoring Tables
-- Tracks monitoring configurations and change history for programs

-- Monitoring configurations table
CREATE TABLE IF NOT EXISTS monitoring_configs (
  id SERIAL PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  config JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(program_id)
);

CREATE INDEX idx_monitoring_configs_program_id ON monitoring_configs(program_id);
CREATE INDEX idx_monitoring_configs_enabled ON monitoring_configs((config->>'enabled')) WHERE config->>'enabled' = 'true';

-- Change history table
CREATE TABLE IF NOT EXISTS change_history (
  id SERIAL PRIMARY KEY,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  change_type VARCHAR(50) NOT NULL,
  changes JSONB NOT NULL,
  significance VARCHAR(20) NOT NULL CHECK (significance IN ('low', 'medium', 'high', 'critical')),
  auto_scan_triggered BOOLEAN DEFAULT FALSE,
  scan_job_id VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_change_history_program_id ON change_history(program_id);
CREATE INDEX idx_change_history_timestamp ON change_history(timestamp DESC);
CREATE INDEX idx_change_history_significance ON change_history(significance);
CREATE INDEX idx_change_history_scan_job_id ON change_history(scan_job_id) WHERE scan_job_id IS NOT NULL;

-- Add comment descriptions
COMMENT ON TABLE monitoring_configs IS 'Stores continuous monitoring configurations for bug bounty programs';
COMMENT ON TABLE change_history IS 'Tracks detected changes in program assets over time (new subdomains, URLs, tech stack changes, etc.)';

COMMENT ON COLUMN monitoring_configs.config IS 'JSONB config: { frequency, enabled, targets: { domains, monitorSubdomains, monitorUrls, monitorTech, monitorPorts }, alertOn: {...}, autoScan }';
COMMENT ON COLUMN change_history.changes IS 'JSONB changes: { added: [...], removed: [...], modified: [...] }';
COMMENT ON COLUMN change_history.significance IS 'Calculated significance based on number and type of changes: low (<5), medium (<20), high (<50), critical (50+)';
