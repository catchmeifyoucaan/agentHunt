import database from './database';

export class DashboardService {
  async getHandoffStats() {
    try {
      // Query rich_handoffs table which has proper status tracking
      const totalResult = await database.query('SELECT COUNT(*) FROM rich_handoffs');
      const successfulResult = await database.query(
        "SELECT COUNT(*) FROM rich_handoffs WHERE status IN ('completed', 'accepted')"
      );
      const failedResult = await database.query(
        "SELECT COUNT(*) FROM rich_handoffs WHERE status IN ('failed', 'rejected', 'circuit_breaker_open')"
      );
      const inProgressResult = await database.query(
        "SELECT COUNT(*) FROM rich_handoffs WHERE status IN ('pending', 'accepted')"
      );

      // Handoffs by from_agent (source)
      const fromAgentTypeResult = await database.query(`
        SELECT from_agent_type, COUNT(*) as count,
               COUNT(*) FILTER (WHERE status IN ('completed', 'accepted')) as completed_count,
               COUNT(*) FILTER (WHERE status IN ('failed', 'rejected', 'circuit_breaker_open')) as failed_count,
               AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
        FROM rich_handoffs
        GROUP BY from_agent_type
        ORDER BY count DESC
      `);

      // Handoffs by to_agent (destination)
      const toAgentTypeResult = await database.query(`
        SELECT to_agent_type, COUNT(*) as count,
               COUNT(*) FILTER (WHERE status IN ('completed', 'accepted')) as completed_count,
               COUNT(*) FILTER (WHERE status IN ('failed', 'rejected', 'circuit_breaker_open')) as failed_count,
               AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
        FROM rich_handoffs
        GROUP BY to_agent_type
        ORDER BY count DESC
      `);

      // Overall average duration
      const overallAvgDurationResult = await database.query(`
        SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
        FROM rich_handoffs
        WHERE completed_at IS NOT NULL
      `);

      return {
        total: parseInt(totalResult.rows[0]?.count || '0'),
        successful: parseInt(successfulResult.rows[0]?.count || '0'),
        failed: parseInt(failedResult.rows[0]?.count || '0'),
        inProgress: parseInt(inProgressResult.rows[0]?.count || '0'),
        overallAvgDurationSeconds: parseFloat(
          overallAvgDurationResult.rows[0]?.avg_duration_seconds || '0'
        ),
        byFromAgentType: fromAgentTypeResult.rows.map((row) => ({
          agentType: row.from_agent_type,
          count: parseInt(row.count),
          completed: parseInt(row.completed_count || '0'),
          failed: parseInt(row.failed_count || '0'),
          successRate:
            parseInt(row.count) > 0
              ? parseInt(row.completed_count || '0') / parseInt(row.count)
              : 0,
          avgDurationSeconds: parseFloat(row.avg_duration_seconds || '0'),
        })),
        byToAgentType: toAgentTypeResult.rows.map((row) => ({
          agentType: row.to_agent_type,
          count: parseInt(row.count),
          completed: parseInt(row.completed_count || '0'),
          failed: parseInt(row.failed_count || '0'),
          successRate:
            parseInt(row.count) > 0
              ? parseInt(row.completed_count || '0') / parseInt(row.count)
              : 0,
          avgDurationSeconds: parseFloat(row.avg_duration_seconds || '0'),
        })),
      };
    } catch (error) {
      console.error('Error getting handoff stats:', error);
      // Fallback to basic handoffs table if rich_handoffs query fails
      const totalResult = await database.query('SELECT COUNT(*) FROM handoffs');
      const successfulResult = await database.query('SELECT COUNT(*) FROM handoffs WHERE 1=1'); // All handoffs are successful in basic table
      const failedResult = await database.query('SELECT COUNT(*) FROM handoffs WHERE 1=0'); // No failed status
      const inProgressResult = await database.query(
        'SELECT COUNT(*) FROM handoffs WHERE next_job_id IS NULL'
      ); // pending handoffs

      // Handoffs by from_agent (source)
      const fromAgentTypeResult = await database.query(`
        SELECT from_agent as from_agent_type, COUNT(*) as count,
               COUNT(*) as completed_count,
               0 as failed_count,
               0 as avg_duration_seconds
        FROM handoffs
        GROUP BY from_agent
        ORDER BY count DESC
      `);

      // Handoffs by to_agent (destination)
      const toAgentTypeResult = await database.query(`
        SELECT to_agent as to_agent_type, COUNT(*) as count,
               COUNT(*) as completed_count,
               0 as failed_count,
               0 as avg_duration_seconds
        FROM handoffs
        GROUP BY to_agent
        ORDER BY count DESC
      `);

      // Overall average duration (not tracked in basic handoffs table)
      const overallAvgDurationResult = await database.query(`
        SELECT 0 as avg_duration_seconds
      `);

      return {
        total: parseInt(totalResult.rows[0].count),
        successful: parseInt(successfulResult.rows[0].count),
        failed: parseInt(failedResult.rows[0].count),
        inProgress: parseInt(inProgressResult.rows[0].count),
        overallAvgDurationSeconds: parseFloat(
          overallAvgDurationResult.rows[0].avg_duration_seconds || '0'
        ),
        byFromAgentType: fromAgentTypeResult.rows.map((row) => ({
          agentType: row.from_agent_type,
          count: parseInt(row.count),
          completed: parseInt(row.completed_count),
          failed: parseInt(row.failed_count),
          successRate:
            parseInt(row.count) > 0 ? parseInt(row.completed_count) / parseInt(row.count) : 0,
          avgDurationSeconds: parseFloat(row.avg_duration_seconds || '0'),
        })),
        byToAgentType: toAgentTypeResult.rows.map((row) => ({
          agentType: row.to_agent_type,
          count: parseInt(row.count),
          completed: parseInt(row.completed_count),
          failed: parseInt(row.failed_count),
          successRate:
            parseInt(row.count) > 0 ? parseInt(row.completed_count) / parseInt(row.count) : 0,
          avgDurationSeconds: parseFloat(row.avg_duration_seconds || '0'),
        })),
      };
    }
  }

  async getRecentHandoffs(limit = 10) {
    try {
      // Query rich_handoffs table which has proper status tracking
      const result = await database.query(
        `
        SELECT
          id,
          from_agent_type as from_agent_type,
          to_agent_type as to_agent_type,
          status,
          created_at,
          completed_at,
          rejection_reason,
          to_job_id,
          reasoning,
          objectives,
          output_contract,
          parent_result as parentResult
        FROM rich_handoffs
        ORDER BY created_at DESC
        LIMIT $1
      `,
        [limit]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting recent handoffs:', error);
      // Fallback to basic handoffs table if rich_handoffs query fails
      const result = await database.query(
        `
        SELECT
          id,
          from_agent as from_agent_type,
          to_agent as to_agent_type,
          'completed' as status,
          created_at,
          created_at as completed_at,
          NULL as rejection_reason,
          next_job_id as to_job_id,
          jsonb_build_object('trigger', reason, 'confidence', 1.0, 'decisionFactors', ARRAY[reason]) as reasoning,
          jsonb_build_object('primary', reason, 'secondary', ARRAY[]::text[]) as objectives,
          jsonb_build_object('format', 'json', 'requiredFields', ARRAY[]::text[], 'shouldTriggerNextHandoff', true) as outputContract,
          context as parentResult
        FROM handoffs
        ORDER BY created_at DESC
        LIMIT $1
      `,
        [limit]
      );
      return result.rows;
    }
  }
}
