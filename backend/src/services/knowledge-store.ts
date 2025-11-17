import database from './database';
import logger from '../utils/logger';
import { AgentFeedback, AgentType } from '../../../shared/agent-collaboration.types';
import { v4 as uuidv4 } from 'uuid';
import agentEvolution from './agent-evolution-integration';

class KnowledgeStoreService {
  /**
   * Stores agent feedback in the database.
   */
  async storeFeedback(feedback: AgentFeedback): Promise<void> {
    try {
      await database.query(
        `INSERT INTO agent_feedback (
          id, feedback_type, from_agent_type, to_agent_type, program_id,
          original_job_id, finding_id, template_id, reason, details, severity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          uuidv4(),
          feedback.feedbackType,
          feedback.from.type,
          feedback.to.type,
          feedback.payload.programId || null, // Assuming programId can be in payload
          feedback.payload.originalJobId || null,
          feedback.payload.findingId || null,
          feedback.payload.templateId || null,
          feedback.payload.reason,
          feedback.payload.details || {},
          feedback.severity,
        ]
      );
      logger.info({ feedbackId: feedback.id, feedbackType: feedback.feedbackType }, 'Agent feedback stored');

      // Pass feedback to agent evolution for learning
      await agentEvolution.processAgentFeedback(feedback);
    } catch (error: any) {
      logger.error({ error, feedback }, 'Failed to store agent feedback');
      throw error;
    }
  }

  /**
   * Retrieves feedback for a specific agent type.
   */
  async getFeedbackForAgent(
    agentType: AgentType,
    options?: {
      feedbackType?: string;
      programId?: string;
      limit?: number;
    }
  ): Promise<AgentFeedback[]> {
    try {
      let query = `SELECT * FROM agent_feedback WHERE to_agent_type = $1`;
      const values: any[] = [agentType];
      let paramIndex = 2;

      if (options?.feedbackType) {
        query += ` AND feedback_type = $${paramIndex++}`;
        values.push(options.feedbackType);
      }
      if (options?.programId) {
        query += ` AND program_id = $${paramIndex++}`;
        values.push(options.programId);
      }
      query += ` ORDER BY created_at DESC LIMIT $${paramIndex++}`;
      values.push(options?.limit || 100);

      const result = await database.query(query, values);

      return result.rows.map((row: any) => ({
        id: row.id,
        type: 'feedback', // Hardcoded as it's a feedback message
        from: { type: row.from_agent_type, instanceId: 'unknown', capabilities: [], currentLoad: 0, version: '1.0.0' }, // Placeholder
        to: { type: row.to_agent_type, instanceId: 'unknown', capabilities: [], currentLoad: 0, version: '1.0.0' }, // Placeholder
        payload: {
          programId: row.program_id,
          originalJobId: row.original_job_id,
          findingId: row.finding_id,
          templateId: row.template_id,
          reason: row.reason,
          details: row.details,
        },
        severity: row.severity,
        createdAt: row.created_at,
        feedbackType: row.feedback_type,
        targetAgentType: row.to_agent_type,
      }));
    } catch (error: any) {
      logger.error({ error, agentType }, 'Failed to retrieve feedback for agent');
      throw error;
    }
  }

  /**
   * Retrieves feedback related to a specific finding.
   */
  async getFeedbackForFinding(findingId: string): Promise<AgentFeedback[]> {
    try {
      const result = await database.query(
        `SELECT * FROM agent_feedback WHERE finding_id = $1 ORDER BY created_at DESC`,
        [findingId]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        type: 'feedback',
        from: { type: row.from_agent_type, instanceId: 'unknown', capabilities: [], currentLoad: 0, version: '1.0.0' },
        to: { type: row.to_agent_type, instanceId: 'unknown', capabilities: [], currentLoad: 0, version: '1.0.0' },
        payload: {
          programId: row.program_id,
          originalJobId: row.original_job_id,
          findingId: row.finding_id,
          templateId: row.template_id,
          reason: row.reason,
          details: row.details,
        },
        severity: row.severity,
        createdAt: row.created_at,
        feedbackType: row.feedback_type,
        targetAgentType: row.to_agent_type,
      }));
    } catch (error: any) {
      logger.error({ error, findingId }, 'Failed to retrieve feedback for finding');
      throw error;
    }
  }
}

export default new KnowledgeStoreService();