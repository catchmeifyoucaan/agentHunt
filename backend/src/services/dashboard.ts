import database from './database';

export class DashboardService {
  async getHandoffStats() {
    const totalResult = await database.query('SELECT COUNT(*) FROM rich_handoffs');
    const successfulResult = await database.query('SELECT COUNT(*) FROM rich_handoffs WHERE status = $1', ['completed']);
    const failedResult = await database.query('SELECT COUNT(*) FROM rich_handoffs WHERE status = $1', ['failed']);
    const inProgressResult = await database.query('SELECT COUNT(*) FROM rich_handoffs WHERE status = $1', ['accepted']); // 'accepted' means in progress

    // Handoffs by from_agent_type
    const fromAgentTypeResult = await database.query(`
      SELECT from_agent_type, COUNT(*) as count,
             COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
             COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
             AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
      FROM rich_handoffs
      GROUP BY from_agent_type
      ORDER BY count DESC
    `);

    // Handoffs by to_agent_type
    const toAgentTypeResult = await database.query(`
      SELECT to_agent_type, COUNT(*) as count,
             COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
             COUNT(*) FILTER (WHERE status = 'failed') as failed_count,
             AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
      FROM rich_handoffs
      GROUP BY to_agent_type
      ORDER BY count DESC
    `);

    // Overall average duration
    const overallAvgDurationResult = await database.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_duration_seconds
      FROM rich_handoffs
      WHERE status IN ('completed', 'failed')
    `);

    return {
      total: parseInt(totalResult.rows[0].count),
      successful: parseInt(successfulResult.rows[0].count),
      failed: parseInt(failedResult.rows[0].count),
      inProgress: parseInt(inProgressResult.rows[0].count),
      overallAvgDurationSeconds: parseFloat(overallAvgDurationResult.rows[0].avg_duration_seconds || '0'),
      byFromAgentType: fromAgentTypeResult.rows.map(row => ({
        agentType: row.from_agent_type,
        count: parseInt(row.count),
        completed: parseInt(row.completed_count),
        failed: parseInt(row.failed_count),
        successRate: parseInt(row.count) > 0 ? parseInt(row.completed_count) / parseInt(row.count) : 0,
        avgDurationSeconds: parseFloat(row.avg_duration_seconds || '0'),
      })),
      byToAgentType: toAgentTypeResult.rows.map(row => ({
        agentType: row.to_agent_type,
        count: parseInt(row.count),
        completed: parseInt(row.completed_count),
        failed: parseInt(row.failed_count),
        successRate: parseInt(row.count) > 0 ? parseInt(row.completed_count) / parseInt(row.count) : 0,
        avgDurationSeconds: parseFloat(row.avg_duration_seconds || '0'),
      })),
    };
  }

  async getRecentHandoffs(limit = 10) {
    const result = await database.query(`
      SELECT
        id,
        from_agent_type,
        to_agent_type,
        status,
        created_at,
        completed_at,
        rejection_reason,
        to_job_id,
        context->'reasoning' as reasoning,
        context->'objectives' as objectives,
        output_contract as outputContract,
        context->'parentResult' as parentResult
      FROM rich_handoffs
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    return result.rows;
  }
}
