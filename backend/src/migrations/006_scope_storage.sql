--
-- Scope Storage Migration
-- Stores parsed scope information from intelligent scope parsers (PDF, CSV, DOCX)
--

-- Main parsed scopes table
CREATE TABLE IF NOT EXISTS parsed_scopes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  upload_id UUID, -- Reference to original upload if applicable

  -- Source information
  source_type VARCHAR(50) NOT NULL, -- 'pdf', 'csv', 'docx', 'manual'
  source_filename VARCHAR(255),
  parsed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Parsed content (full structured data)
  parsed_data JSONB NOT NULL,

  -- Parser metadata
  parser_version VARCHAR(50),
  confidence DECIMAL(3, 2), -- 0.0-1.0, parser's confidence in accuracy
  parsing_method VARCHAR(50), -- 'llm', 'structured', 'hybrid'

  -- Status
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'archived', 'replaced'
  is_primary BOOLEAN DEFAULT true, -- Is this the primary scope for the program?

  -- Summary statistics
  total_domains INTEGER DEFAULT 0,
  total_ips INTEGER DEFAULT 0,
  total_exclusions INTEGER DEFAULT 0,
  has_credentials BOOLEAN DEFAULT false,
  has_constraints BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP,

  -- Indexes
  CONSTRAINT parsed_scopes_confidence_check CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1))
);

-- Index for fast program lookups
CREATE INDEX idx_parsed_scopes_program_id ON parsed_scopes(program_id);
CREATE INDEX idx_parsed_scopes_status ON parsed_scopes(status);
CREATE INDEX idx_parsed_scopes_is_primary ON parsed_scopes(is_primary) WHERE is_primary = true;
CREATE INDEX idx_parsed_scopes_created_at ON parsed_scopes(created_at DESC);

-- Scope targets table (normalized for easy querying)
CREATE TABLE IF NOT EXISTS scope_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_scope_id UUID NOT NULL REFERENCES parsed_scopes(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,

  -- Target information
  target_type VARCHAR(50) NOT NULL, -- 'domain', 'ip', 'ip_range', 'wildcard_domain', 'url'
  target_value TEXT NOT NULL, -- e.g., 'example.com', '192.168.1.0/24', '*.example.com'

  -- Metadata
  priority VARCHAR(20), -- 'low', 'medium', 'high', 'critical'
  notes TEXT,
  tags TEXT[], -- Array of tags

  -- Status
  is_excluded BOOLEAN DEFAULT false, -- Is this an exclusion rather than inclusion?
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for scope targets
CREATE INDEX idx_scope_targets_parsed_scope_id ON scope_targets(parsed_scope_id);
CREATE INDEX idx_scope_targets_program_id ON scope_targets(program_id);
CREATE INDEX idx_scope_targets_target_type ON scope_targets(target_type);
CREATE INDEX idx_scope_targets_target_value ON scope_targets(target_value);
CREATE INDEX idx_scope_targets_is_excluded ON scope_targets(is_excluded);
CREATE INDEX idx_scope_targets_is_active ON scope_targets(is_active) WHERE is_active = true;
CREATE INDEX idx_scope_targets_priority ON scope_targets(priority);
CREATE INDEX idx_scope_targets_tags ON scope_targets USING GIN (tags);

-- Unique constraint to prevent duplicate targets
CREATE UNIQUE INDEX idx_scope_targets_unique ON scope_targets(parsed_scope_id, target_type, target_value, is_excluded);

-- Scope constraints table
CREATE TABLE IF NOT EXISTS scope_constraints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_scope_id UUID NOT NULL REFERENCES parsed_scopes(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,

  -- Constraint type
  constraint_type VARCHAR(100) NOT NULL, -- 'no_dos', 'rate_limit', 'testing_window', 'no_brute_force', etc.

  -- Constraint details (flexible JSONB)
  constraint_details JSONB,

  -- Human-readable description
  description TEXT,

  -- Severity/priority
  severity VARCHAR(20), -- 'info', 'warning', 'critical'
  is_mandatory BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for scope constraints
CREATE INDEX idx_scope_constraints_parsed_scope_id ON scope_constraints(parsed_scope_id);
CREATE INDEX idx_scope_constraints_program_id ON scope_constraints(program_id);
CREATE INDEX idx_scope_constraints_constraint_type ON scope_constraints(constraint_type);
CREATE INDEX idx_scope_constraints_severity ON scope_constraints(severity);
CREATE INDEX idx_scope_constraints_is_mandatory ON scope_constraints(is_mandatory) WHERE is_mandatory = true;

-- Scope credentials table
CREATE TABLE IF NOT EXISTS scope_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parsed_scope_id UUID NOT NULL REFERENCES parsed_scopes(id) ON DELETE CASCADE,
  program_id UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,

  -- Credential information
  credential_name VARCHAR(255) NOT NULL, -- e.g., 'admin_login', 'api_key', 'test_account'
  credential_type VARCHAR(50) NOT NULL, -- 'bearer', 'basic', 'login', 'api_key', 'oauth', 'custom'

  -- Credential data (encrypted in production)
  credential_value TEXT, -- The actual credential (should be encrypted)
  username TEXT,
  password TEXT,

  -- Additional metadata
  description TEXT,
  scope_description TEXT, -- Where/how to use this credential
  notes TEXT,

  -- Security
  is_encrypted BOOLEAN DEFAULT false,
  expires_at TIMESTAMP,

  -- Usage tracking
  last_used_at TIMESTAMP,
  usage_count INTEGER DEFAULT 0,

  -- Status
  is_active BOOLEAN DEFAULT true,
  is_expired BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for scope credentials
CREATE INDEX idx_scope_credentials_parsed_scope_id ON scope_credentials(parsed_scope_id);
CREATE INDEX idx_scope_credentials_program_id ON scope_credentials(program_id);
CREATE INDEX idx_scope_credentials_credential_type ON scope_credentials(credential_type);
CREATE INDEX idx_scope_credentials_credential_name ON scope_credentials(credential_name);
CREATE INDEX idx_scope_credentials_is_active ON scope_credentials(is_active) WHERE is_active = true;
CREATE INDEX idx_scope_credentials_is_expired ON scope_credentials(is_expired);
CREATE INDEX idx_scope_credentials_expires_at ON scope_credentials(expires_at) WHERE expires_at IS NOT NULL;

-- Update timestamp triggers
CREATE OR REPLACE FUNCTION update_scope_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_parsed_scopes_updated_at
  BEFORE UPDATE ON parsed_scopes
  FOR EACH ROW
  EXECUTE FUNCTION update_scope_updated_at();

CREATE TRIGGER update_scope_targets_updated_at
  BEFORE UPDATE ON scope_targets
  FOR EACH ROW
  EXECUTE FUNCTION update_scope_updated_at();

CREATE TRIGGER update_scope_constraints_updated_at
  BEFORE UPDATE ON scope_constraints
  FOR EACH ROW
  EXECUTE FUNCTION update_scope_updated_at();

CREATE TRIGGER update_scope_credentials_updated_at
  BEFORE UPDATE ON scope_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_scope_updated_at();

-- Comments for documentation
COMMENT ON TABLE parsed_scopes IS 'Stores parsed scope documents from PDF, CSV, DOCX, or manual entry';
COMMENT ON TABLE scope_targets IS 'Individual targets (domains, IPs, URLs) extracted from scope documents';
COMMENT ON TABLE scope_constraints IS 'Testing constraints and rules (no DoS, rate limits, testing windows, etc.)';
COMMENT ON TABLE scope_credentials IS 'Credentials provided for authorized testing';

COMMENT ON COLUMN parsed_scopes.confidence IS 'Parser confidence in accuracy (0.0-1.0)';
COMMENT ON COLUMN parsed_scopes.parsing_method IS 'Method used: llm (AI-powered), structured (CSV/table), or hybrid';
COMMENT ON COLUMN parsed_scopes.is_primary IS 'Whether this is the current active scope for the program';
COMMENT ON COLUMN scope_targets.is_excluded IS 'If true, this target is explicitly OUT of scope';
COMMENT ON COLUMN scope_credentials.is_encrypted IS 'Whether credential_value is encrypted (should always be true in production)';
