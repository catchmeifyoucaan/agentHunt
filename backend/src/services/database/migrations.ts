/**
 * Database Migration System
 * Ensures all tables for Phase 2, 3, and 4 are created
 */

import logger from '../../utils/logger';
import database from '../database';

interface Migration {
  id: string;
  name: string;
  sql: string;
}

/**
 * All migrations for GeniusSwarms features
 */
const migrations: Migration[] = [
  // Phase 2: Intelligence - Knowledge Base
  {
    id: '001',
    name: 'create_knowledge_entries',
    sql: `
      CREATE TABLE IF NOT EXISTS knowledge_entries (
        id UUID PRIMARY KEY,
        type TEXT NOT NULL,
        source TEXT NOT NULL,
        content JSONB NOT NULL,
        embedding JSONB, -- Changed from VECTOR to JSONB to avoid pgvector dependency
        metadata JSONB,
        similarity_score FLOAT,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_knowledge_type ON knowledge_entries(type);
      CREATE INDEX IF NOT EXISTS idx_knowledge_source ON knowledge_entries(source);
      CREATE INDEX IF NOT EXISTS idx_knowledge_created ON knowledge_entries(created_at);
    `,
  },

  // Phase 2: Intelligence - Research Cache
  {
    id: '002',
    name: 'create_research_cache',
    sql: `
      CREATE TABLE IF NOT EXISTS research_cache (
        id UUID PRIMARY KEY,
        query TEXT NOT NULL,
        type TEXT NOT NULL,
        results JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_research_query ON research_cache(query);
      CREATE INDEX IF NOT EXISTS idx_research_expires ON research_cache(expires_at);
    `,
  },

  // Phase 2: Intelligence - Reasoning History
  {
    id: '003',
    name: 'create_reasoning_history',
    sql: `
      CREATE TABLE IF NOT EXISTS reasoning_history (
        id UUID PRIMARY KEY,
        agent_id TEXT NOT NULL,
        state JSONB NOT NULL,
        reflections TEXT[],
        decisions JSONB[],
        performance_metrics JSONB,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_reasoning_agent ON reasoning_history(agent_id);
      CREATE INDEX IF NOT EXISTS idx_reasoning_created ON reasoning_history(created_at);
    `,
  },

  // Phase 3: Three-Agent - Testing Plans
  {
    id: '004',
    name: 'create_testing_plans',
    sql: `
      CREATE TABLE IF NOT EXISTS testing_plans (
        id UUID PRIMARY KEY,
        program_id UUID NOT NULL,
        phases JSONB NOT NULL,
        total_estimated_duration INTEGER NOT NULL,
        critical_path TEXT[],
        resource_budget JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_plans_program ON testing_plans(program_id);
    `,
  },

  // Phase 3: Three-Agent - Sessions
  {
    id: '005',
    name: 'create_three_agent_sessions',
    sql: `
      CREATE TABLE IF NOT EXISTS three_agent_sessions (
        id UUID PRIMARY KEY,
        program_id UUID NOT NULL,
        plan_id UUID NOT NULL,
        state TEXT NOT NULL,
        planner_state JSONB,
        executor_swarms JSONB[],
        researcher_queue JSONB[],
        validated_findings JSONB[],
        attack_chains JSONB[],
        metadata JSONB,
        started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP WITH TIME ZONE
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_program ON three_agent_sessions(program_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_state ON three_agent_sessions(state);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON three_agent_sessions(started_at);
    `,
  },

  // Phase 3: Three-Agent - Swarm Results
  {
    id: '006',
    name: 'create_swarm_results',
    sql: `
        CREATE TABLE IF NOT EXISTS swarm_results (
        id UUID PRIMARY KEY,
        swarm_id UUID NOT NULL,
        session_id UUID NOT NULL,
        objective_id UUID NOT NULL,
        total_agents INTEGER NOT NULL,
        completed_agents INTEGER NOT NULL,
        failed_agents INTEGER NOT NULL,
        findings JSONB[],
        successful_techniques JSONB[],
        duration INTEGER NOT NULL,
        efficiency FLOAT NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_swarm_session ON swarm_results(session_id);
      CREATE INDEX IF NOT EXISTS idx_swarm_objective ON swarm_results(objective_id);
    `,
  },

  // Phase 3: Three-Agent - Validation Results
  {
    id: '007',
    name: 'create_validation_results',
    sql: `
        CREATE TABLE IF NOT EXISTS validation_results (
        id UUID PRIMARY KEY,
        finding_id UUID NOT NULL,
        session_id UUID NOT NULL,
        valid BOOLEAN NOT NULL,
        confidence FLOAT NOT NULL,
        reviews JSONB[],
        poc TEXT,
        poc_verified BOOLEAN NOT NULL,
        severity TEXT NOT NULL,
        adjusted_severity TEXT,
        exploitability FLOAT NOT NULL,
        impact FLOAT NOT NULL,
        recommendations TEXT[],
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_validation_finding ON validation_results(finding_id);
      CREATE INDEX IF NOT EXISTS idx_validation_session ON validation_results(session_id);
    `,
  },

  // Phase 4: Evolution - Generated Tools
  {
    id: '008',
    name: 'create_generated_tools',
    sql: `
        CREATE TABLE IF NOT EXISTS generated_tools (
        id UUID PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        language TEXT NOT NULL,
        code TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        tested BOOLEAN NOT NULL DEFAULT FALSE,
        success_rate FLOAT NOT NULL DEFAULT 0.0,
        test_results JSONB,
        debug_history JSONB[],
        metadata JSONB,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_tools_name ON generated_tools(name);
      CREATE INDEX IF NOT EXISTS idx_tools_language ON generated_tools(language);
      CREATE INDEX IF NOT EXISTS idx_tools_success_rate ON generated_tools(success_rate);
    `,
  },

  // Phase 4: Evolution - Debug Patterns
  {
    id: '009',
    name: 'create_debug_patterns',
    sql: `
        CREATE TABLE IF NOT EXISTS debug_patterns (
        id UUID PRIMARY KEY,
        error_pattern TEXT NOT NULL,
        language TEXT NOT NULL,
        solution TEXT NOT NULL,
        confidence FLOAT NOT NULL,
        success_count INTEGER NOT NULL DEFAULT 1,
        failure_count INTEGER NOT NULL DEFAULT 0,
        context JSONB,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_debug_pattern ON debug_patterns(error_pattern);
      CREATE INDEX IF NOT EXISTS idx_debug_language ON debug_patterns(language);
      CREATE INDEX IF NOT EXISTS idx_debug_confidence ON debug_patterns(confidence);
    `,
  },

  // Phase 4: Evolution - Causal Rules
  {
    id: '010',
    name: 'create_causal_rules',
    sql: `
        CREATE TABLE IF NOT EXISTS causal_rules (
        id UUID PRIMARY KEY,
        condition TEXT NOT NULL,
        action TEXT NOT NULL,
        effect TEXT NOT NULL,
        confidence FLOAT NOT NULL,
        support_count INTEGER NOT NULL DEFAULT 1,
        contradiction_count INTEGER NOT NULL DEFAULT 0,
        context JSONB,
        priority INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_causal_action ON causal_rules(action);
      CREATE INDEX IF NOT EXISTS idx_causal_confidence ON causal_rules(confidence);
      CREATE INDEX IF NOT EXISTS idx_causal_last_seen ON causal_rules(last_seen_at);
    `,
  },

  // Phase 4: Evolution - Performance Analysis
  {
    id: '011',
    name: 'create_performance_analysis',
    sql: `
        CREATE TABLE IF NOT EXISTS performance_analysis (
        id UUID PRIMARY KEY,
        agent_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        metrics JSONB NOT NULL,
        overall_score FLOAT NOT NULL,
        bottlenecks TEXT[],
        strengths TEXT[],
        weaknesses TEXT[],
        pivot_recommended BOOLEAN NOT NULL,
        pivot_strategy JSONB,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_performance_agent ON performance_analysis(agent_id);
      CREATE INDEX IF NOT EXISTS idx_performance_session ON performance_analysis(session_id);
      CREATE INDEX IF NOT EXISTS idx_performance_created ON performance_analysis(created_at);
    `,
  },

  // Phase 4: Evolution - Pivot History
  {
    id: '012',
    name: 'create_pivot_history',
    sql: `
        CREATE TABLE IF NOT EXISTS pivot_history (
        id UUID PRIMARY KEY,
        agent_id TEXT NOT NULL,
        strategy_id TEXT NOT NULL,
        before_metrics JSONB NOT NULL,
        after_metrics JSONB,
        applied BOOLEAN NOT NULL,
        success BOOLEAN,
        learnings JSONB[],
          created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP WITH TIME ZONE
      );
      CREATE INDEX IF NOT EXISTS idx_pivot_agent ON pivot_history(agent_id);
      CREATE INDEX IF NOT EXISTS idx_pivot_created ON pivot_history(created_at);
    `,
  },

  // Migration tracking table
  {
    id: '000',
    name: 'create_migrations_table',
    sql: `
        CREATE TABLE IF NOT EXISTS database_migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
          applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `,
  },
];

export class MigrationRunner {
  /**
   * Run all pending migrations
   */
  async runMigrations(): Promise<{
    success: boolean;
    applied: string[];
    failed: string[];
    errors: Array<{ migration: string; error: string }>;
  }> {
    const applied: string[] = [];
    const failed: string[] = [];
    const errors: Array<{ migration: string; error: string }> = [];

    try {
      logger.info('Starting database migrations');

      // Sort migrations - migration table first, then by ID
      const sortedMigrations = [...migrations].sort((a, b) => {
        if (a.id === '000') return -1;
        if (b.id === '000') return 1;
        return a.id.localeCompare(b.id);
      });

      // Run each migration
      for (const migration of sortedMigrations) {
        try {
          // Check if migration already applied
          if (migration.id !== '000') {
            const result = await database.query(
              'SELECT id FROM database_migrations WHERE id = $1',
              [migration.id]
            );

            if (result.rows.length > 0) {
              logger.debug({ migration: migration.name }, 'Migration already applied, skipping');
              continue;
            }
          }

          // Run migration
          logger.info({ migration: migration.name }, 'Applying migration');
          await database.query(migration.sql);

          // Record migration (except for the migrations table itself)
          if (migration.id !== '000') {
            await database.query(
              'INSERT INTO database_migrations (id, name, applied_at) VALUES ($1, $2, CURRENT_TIMESTAMP)',
              [migration.id, migration.name]
            );
          }

          applied.push(migration.name);
          logger.info({ migration: migration.name }, 'Migration applied successfully');
        } catch (error: any) {
          logger.error({ error, migration: migration.name }, 'Migration failed');
          failed.push(migration.name);
          errors.push({
            migration: migration.name,
            error: error.message,
          });

          // Continue with other migrations instead of stopping
        }
      }

      const success = failed.length === 0;

      logger.info(
        {
          total: sortedMigrations.length,
          applied: applied.length,
          failed: failed.length,
        },
        'Migration run completed'
      );

      return { success, applied, failed, errors };
    } catch (error: any) {
      logger.error({ error }, 'Migration runner failed');
      return {
        success: false,
        applied,
        failed,
        errors: [{ migration: 'runner', error: error.message }],
      };
    }
  }

  /**
   * Get migration status
   */
  async getStatus(): Promise<{
    total: number;
    applied: number;
    pending: number;
    migrations: Array<{
      id: string;
      name: string;
      status: 'applied' | 'pending';
      appliedAt?: Date;
    }>;
  }> {
    try {
      // Get applied migrations
      const result = await database.query(
        'SELECT id, name, applied_at FROM database_migrations ORDER BY id'
      );

      const appliedIds = new Set(result.rows.map((r: any) => r.id));
      const appliedMap = new Map(result.rows.map((r: any) => [r.id, r.applied_at]));

      const migrationStatus = migrations
        .filter((m) => m.id !== '000') // Exclude migrations table itself
        .map((m) => ({
          id: m.id,
          name: m.name,
          status: appliedIds.has(m.id) ? ('applied' as const) : ('pending' as const),
          appliedAt: appliedMap.get(m.id) as Date | undefined,
        }));

      return {
        total: migrationStatus.length,
        applied: migrationStatus.filter((m) => m.status === 'applied').length,
        pending: migrationStatus.filter((m) => m.status === 'pending').length,
        migrations: migrationStatus,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to get migration status');
      return {
        total: migrations.length - 1,
        applied: 0,
        pending: migrations.length - 1,
        migrations: [],
      };
    }
  }
}

export const migrationRunner = new MigrationRunner();
export default migrationRunner;
