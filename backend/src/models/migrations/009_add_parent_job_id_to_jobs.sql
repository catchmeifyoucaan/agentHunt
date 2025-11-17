-- Migration: Add parent_job_id column to jobs table and workflow tracing views
-- Enables parent-child job relationship tracking for handoff chains

-- Add parent_job_id column to jobs table to track handoff relationships
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS parent_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL;

-- Add index for better query performance on parent_job_id
CREATE INDEX IF NOT EXISTS idx_jobs_parent_job_id ON jobs(parent_job_id);

-- Add index combining parent_job_id and program_id for efficient querying
CREATE INDEX IF NOT EXISTS idx_jobs_parent_program ON jobs(parent_job_id, program_id);

-- Add index for querying job chains efficiently
CREATE INDEX IF NOT EXISTS idx_jobs_created_parent ON jobs(created_at DESC, parent_job_id);

-- View: Job execution chains (hierarchical view of job relationships)
CREATE OR REPLACE VIEW job_execution_chains AS
WITH RECURSIVE job_chain AS (
  -- Base case: root jobs (no parent)
  SELECT
    id,
    type,
    program_id,
    status,
    created_at,
    completed_at,
    parent_job_id,
    0 as depth,
    ARRAY[id] as path,
    id as root_job_id
  FROM jobs
  WHERE parent_job_id IS NULL

  UNION ALL

  -- Recursive case: child jobs
  SELECT
    j.id,
    j.type,
    j.program_id,
    j.status,
    j.created_at,
    j.completed_at,
    j.parent_job_id,
    jc.depth + 1,
    jc.path || j.id,
    jc.root_job_id
  FROM jobs j
  INNER JOIN job_chain jc ON j.parent_job_id = jc.id
  WHERE jc.depth < 10  -- Prevent infinite recursion
)
SELECT
  root_job_id,
  id as job_id,
  type,
  program_id,
  status,
  created_at,
  completed_at,
  parent_job_id,
  depth,
  path,
  -- Calculate relative position in chain
  depth as chain_position
FROM job_chain
ORDER BY root_job_id, path;

-- View: Active workflow summary with statistics
CREATE OR REPLACE VIEW active_workflows AS
SELECT
  root_job_id,
  j.program_id,
  j.type as root_job_type,
  j.status as root_job_status,
  j.created_at as started_at,
  j.completed_at as completed_at,
  COUNT(jec.job_id) as total_jobs_in_chain,
  COUNT(CASE WHEN jec.status = 'completed' THEN 1 END) as completed_jobs,
  COUNT(CASE WHEN jec.status = 'failed' THEN 1 END) as failed_jobs,
  COUNT(CASE WHEN jec.status IN ('pending', 'active') THEN 1 END) as active_jobs,
  MAX(jec.depth) as max_chain_depth
FROM job_execution_chains jec
JOIN jobs j ON jec.root_job_id = j.id
GROUP BY root_job_id, j.program_id, j.type, j.status, j.created_at, j.completed_at
ORDER BY j.created_at DESC;

-- Function: Get job lineage (ancestors and descendants)
CREATE OR REPLACE FUNCTION get_job_lineage(job_id_param UUID)
RETURNS TABLE(
  id UUID,
  type VARCHAR(50),
  status VARCHAR(50),
  parent_job_id UUID,
  depth INTEGER,
  direction VARCHAR(10)  -- 'ancestor' or 'descendant'
) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE lineage AS (
    -- Ancestors (jobs that led to this job)
    SELECT
      id, type, status, parent_job_id, 0 as depth, 'ancestor' as direction
    FROM jobs
    WHERE id = job_id_param

    UNION ALL

    SELECT
      j.id, j.type, j.status, j.parent_job_id, l.depth - 1, 'ancestor'
    FROM jobs j
    INNER JOIN lineage l ON j.id = l.parent_job_id
    WHERE l.depth > -10  -- Limit search depth

    UNION ALL

    -- Descendants (jobs created from this job)
    SELECT
      j.id, j.type, j.status, j.parent_job_id, l.depth + 1, 'descendant'
    FROM jobs j
    INNER JOIN lineage l ON j.parent_job_id = l.id
    WHERE l.direction = 'ancestor' AND l.depth < 10  -- Limit search depth
  )
  SELECT id, type, status, parent_job_id, depth, direction
  FROM lineage
  ORDER BY direction, depth;
END;
$$ LANGUAGE plpgsql;