-- Migration 010: Ensure manager_commands table compatibility
-- Adds missing columns to existing manager_commands table

-- Add missing columns if they don't exist
ALTER TABLE manager_commands ADD COLUMN IF NOT EXISTS intent JSONB;
ALTER TABLE manager_commands ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'completed';
ALTER TABLE manager_commands ADD COLUMN IF NOT EXISTS error TEXT;
ALTER TABLE manager_commands ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;

-- Rename old response column and create new JSONB one
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name='manager_commands' AND column_name='response' AND data_type='text'
    ) THEN
        ALTER TABLE manager_commands RENAME COLUMN response TO response_text_old;
        ALTER TABLE manager_commands ADD COLUMN response JSONB;
    END IF;
END $$;

-- Ensure indexes exist
CREATE INDEX IF NOT EXISTS idx_manager_commands_user_id ON manager_commands(user_id);
CREATE INDEX IF NOT EXISTS idx_manager_commands_program_id ON manager_commands(program_id);
CREATE INDEX IF NOT EXISTS idx_manager_commands_status ON manager_commands(status);
