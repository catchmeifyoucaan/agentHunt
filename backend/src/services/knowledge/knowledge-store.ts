/**
 * Knowledge Store - RAG Knowledge Base
 * Stores and retrieves security knowledge using vector embeddings
 */

import {
  KnowledgeEntry,
  VulnerabilityKnowledge,
  ExploitKnowledge,
  TechniqueKnowledge,
  SearchQuery,
  SearchResult,
  KnowledgeStats,
  LearningResult,
  KnowledgeRecommendation,
} from './types';
import embeddingService from './embedding-service';
import database from '../database';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { AgentFeedback, AgentType } from '../../../../shared/agent-collaboration.types';
import agentEvolution from '../agent-evolution-integration';

class KnowledgeStore {
  /**
   * Add knowledge entry to the store
   */
  async addEntry(entry: Omit<KnowledgeEntry, 'id' | 'createdAt' | 'updatedAt' | 'timesUsed' | 'successRate'>): Promise<string> {
    const id = uuidv4();

    logger.info({ type: entry.type, title: entry.title }, 'Adding knowledge entry');

    // Create embedding for the entry
    const embeddingText = `${entry.title}\n${entry.description}\n${entry.content}\n${entry.tags.join(' ')}`;
    const embeddingResult = await embeddingService.createEmbedding({ text: embeddingText });

    // Store in database
    await database.query(
      `INSERT INTO knowledge_base (
        id, type, title, description, content, severity, cve_id, cwe_id, tags,
        source, source_url, author, embedding, embedding_model,
        times_used, success_rate, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        entry.type,
        entry.title,
        entry.description,
        entry.content,
        entry.severity || null,
        entry.cveId || null,
        entry.cweId || null,
        JSON.stringify(entry.tags),
        entry.source,
        entry.sourceUrl || null,
        entry.author || null,
        JSON.stringify(embeddingResult.embedding),
        embeddingResult.model,
        0, // times_used
        0.5, // initial success_rate
      ]
    );

    logger.info({ id, type: entry.type }, 'Knowledge entry added');

    return id;
  }

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
          feedback.payload.programId || null,
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

  /**
   * Search knowledge base using semantic search
   */
  async search(query: SearchQuery): Promise<SearchResult[]> {
    logger.info(
      {
        query: query.query.substring(0, 100),
        type: query.type,
        limit: query.limit || 10,
      },
      'Searching knowledge base'
    );

    // Create embedding for query
    const queryEmbedding = await embeddingService.createEmbedding({ text: query.query });

    // Build SQL query
    let sql = `SELECT * FROM knowledge_base WHERE 1=1`;
    const params: any[] = [];
    let paramIndex = 1;

    // Type filter
    if (query.type) {
      sql += ` AND type = $${paramIndex}`;
      params.push(query.type);
      paramIndex++;
    }

    // Filters
    if (query.filters) {
      if (query.filters.severity && query.filters.severity.length > 0) {
        sql += ` AND severity = ANY($${paramIndex})`;
        params.push(query.filters.severity);
        paramIndex++;
      }

      if (query.filters.source && query.filters.source.length > 0) {
        sql += ` AND source = ANY($${paramIndex})`;
        params.push(query.filters.source);
        paramIndex++;
      }

      if (query.filters.requiresAuth !== undefined) {
        sql += ` AND metadata->>'requiresAuth' = $${paramIndex}`;
        params.push(query.filters.requiresAuth.toString());
        paramIndex++;
      }
    }

    sql += ` LIMIT 100`; // Fetch more than needed for similarity filtering

    // Execute query
    const result = await database.query(sql, params);

    // Calculate similarity scores
    const results: SearchResult[] = result.rows
      .map(row => {
        const embedding = JSON.parse(row.embedding);
        const score = embeddingService.cosineSimilarity(queryEmbedding.embedding, embedding);

        return {
          entry: this.rowToEntry(row),
          score,
          relevance: this.generateRelevance(query.query, row, score),
        };
      })
      .filter(r => r.score >= (query.minSimilarity || 0.5)) // Filter by minimum similarity
      .sort((a, b) => b.score - a.score) // Sort by score descending
      .slice(0, query.limit || 10); // Limit results

    logger.info(
      {
        resultsFound: results.length,
        topScore: results[0]?.score,
      },
      'Knowledge search completed'
    );

    return results;
  }

  /**
   * Get entry by ID
   */
  async getEntry(id: string): Promise<KnowledgeEntry | null> {
    const result = await database.query(
      'SELECT * FROM knowledge_base WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.rowToEntry(result.rows[0]);
  }

  /**
   * Update entry success rate based on usage
   */
  async recordUsage(id: string, success: boolean): Promise<LearningResult> {
    const entry = await this.getEntry(id);
    if (!entry) {
      throw new Error(`Entry ${id} not found`);
    }

    const previousSuccessRate = entry.successRate;
    const timesUsed = entry.timesUsed + 1;

    // Update success rate using exponential moving average
    const alpha = 0.2; // Weight for new data
    const newSuccessRate = success
      ? previousSuccessRate + alpha * (1 - previousSuccessRate)
      : previousSuccessRate + alpha * (0 - previousSuccessRate);

    await database.query(
      `UPDATE knowledge_base
       SET times_used = $1, success_rate = $2, last_used = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [timesUsed, newSuccessRate, id]
    );

    // Generate insights
    const insights: string[] = [];
    if (newSuccessRate > 0.8) {
      insights.push('High success rate - reliable knowledge');
    } else if (newSuccessRate < 0.3) {
      insights.push('Low success rate - may need review or removal');
    }

    if (timesUsed >= 10 && newSuccessRate > previousSuccessRate) {
      insights.push('Improving over time - keep using');
    }

    logger.info(
      {
        id,
        success,
        previousSuccessRate,
        newSuccessRate,
        timesUsed,
      },
      'Recorded knowledge usage'
    );

    return {
      success,
      entryId: id,
      previousSuccessRate,
      newSuccessRate,
      confidence: Math.min(timesUsed / 10, 1.0), // Confidence increases with usage
      insights,
    };
  }

  /**
   * Get recommendations based on context
   */
  async getRecommendations(context: {
    targetUrl?: string;
    vulnerabilityType?: string;
    previousAttempts?: string[];
    tags?: string[];
  }): Promise<KnowledgeRecommendation[]> {
    logger.info({ context }, 'Getting knowledge recommendations');

    // Build query from context
    const queryParts: string[] = [];
    if (context.vulnerabilityType) queryParts.push(context.vulnerabilityType);
    if (context.targetUrl) queryParts.push(`target: ${context.targetUrl}`);
    if (context.tags) queryParts.push(...context.tags);

    const query = queryParts.join(' ');

    // Search knowledge base
    const searchResults = await this.search({
      query,
      limit: 5,
      minSimilarity: 0.6,
    });

    // Filter out previously attempted entries
    const filtered = searchResults.filter(
      r => !context.previousAttempts?.includes(r.entry.id)
    );

    // Convert to recommendations
    const recommendations: KnowledgeRecommendation[] = filtered.map((result, index) => ({
      entry: result.entry,
      reasoning: result.relevance,
      confidence: result.score * result.entry.successRate, // Combine similarity and success rate
      alternatives: index === 0 ? filtered.slice(1, 3).map(r => r.entry) : undefined,
    }));

    logger.info(
      {
        recommendationsCount: recommendations.length,
        topConfidence: recommendations[0]?.confidence,
      },
      'Generated recommendations'
    );

    return recommendations;
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<KnowledgeStats> {
    const totalResult = await database.query('SELECT COUNT(*) as count FROM knowledge_base');
    const total = parseInt(totalResult.rows[0].count);

    const byTypeResult = await database.query(
      'SELECT type, COUNT(*) as count FROM knowledge_base GROUP BY type'
    );
    const byType: any = {};
    byTypeResult.rows.forEach(row => {
      byType[row.type] = parseInt(row.count);
    });

    const bySourceResult = await database.query(
      'SELECT source, COUNT(*) as count FROM knowledge_base GROUP BY source'
    );
    const bySource: any = {};
    bySourceResult.rows.forEach(row => {
      bySource[row.source] = parseInt(row.count);
    });

    const avgSuccessResult = await database.query(
      'SELECT AVG(success_rate) as avg FROM knowledge_base'
    );
    const averageSuccessRate = parseFloat(avgSuccessResult.rows[0].avg) || 0;

    const mostUsedResult = await database.query(
      'SELECT id, title, times_used FROM knowledge_base ORDER BY times_used DESC LIMIT 10'
    );
    const mostUsedEntries = mostUsedResult.rows.map(row => ({
      id: row.id,
      title: row.title,
      timesUsed: row.times_used,
    }));

    const recentResult = await database.query(
      `SELECT COUNT(*) as count FROM knowledge_base
       WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`
    );
    const recentlyAdded = parseInt(recentResult.rows[0].count);

    return {
      totalEntries: total,
      byType,
      bySource,
      averageSuccessRate,
      mostUsedEntries,
      recentlyAdded,
    };
  }

  /**
   * Import vulnerabilities from CVE data
   */
  async importVulnerability(cveData: {
    cveId: string;
    description: string;
    severity: string;
    cvss: number;
    affectedSoftware: string[];
    published: Date;
  }): Promise<string> {
    return this.addEntry({
      type: 'vulnerability',
      title: cveData.cveId,
      description: cveData.description,
      content: `CVE: ${cveData.cveId}\nSeverity: ${cveData.severity}\nCVSS: ${cveData.cvss}\n\nAffected Software:\n${cveData.affectedSoftware.join('\n')}`,
      severity: cveData.severity as any,
      cveId: cveData.cveId,
      tags: ['cve', cveData.severity, ...cveData.affectedSoftware.map(s => s.toLowerCase())],
      source: 'cve',
      sourceUrl: `https://cve.mitre.org/cgi-bin/cvename.cgi?name=${cveData.cveId}`,
    });
  }

  /**
   * Import exploit from ExploitDB
   */
  async importExploit(exploitData: {
    title: string;
    description: string;
    code: string;
    author: string;
    platform: string;
    type: string;
    exploitDbId: string;
  }): Promise<string> {
    return this.addEntry({
      type: 'exploit',
      title: exploitData.title,
      description: exploitData.description,
      content: exploitData.code,
      tags: [exploitData.platform, exploitData.type, 'exploitdb'],
      source: 'exploitdb',
      sourceUrl: `https://www.exploit-db.com/exploits/${exploitData.exploitDbId}`,
      author: exploitData.author,
    });
  }

  /**
   * Convert database row to knowledge entry
   */
  private rowToEntry(row: any): KnowledgeEntry {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      description: row.description,
      content: row.content,
      severity: row.severity,
      cveId: row.cve_id,
      cweId: row.cwe_id,
      tags: JSON.parse(row.tags || '[]'),
      source: row.source,
      sourceUrl: row.source_url,
      author: row.author,
      embedding: JSON.parse(row.embedding),
      embeddingModel: row.embedding_model,
      timesUsed: row.times_used,
      successRate: row.success_rate,
      lastUsed: row.last_used,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Generate relevance explanation
   */
  private generateRelevance(query: string, row: any, score: number): string {
    const reasons: string[] = [];

    if (score > 0.9) {
      reasons.push('Very high semantic similarity');
    } else if (score > 0.7) {
      reasons.push('High semantic similarity');
    } else {
      reasons.push('Moderate semantic similarity');
    }

    if (row.success_rate > 0.8) {
      reasons.push(`high success rate (${(row.success_rate * 100).toFixed(0)}%)`);
    }

    if (row.times_used > 10) {
      reasons.push(`frequently used (${row.times_used} times)`);
    }

    const tags = JSON.parse(row.tags || '[]');
    const matchingTags = tags.filter((tag: string) =>
      query.toLowerCase().includes(tag.toLowerCase())
    );
    if (matchingTags.length > 0) {
      reasons.push(`matches tags: ${matchingTags.join(', ')}`);
    }

    return reasons.join('; ');
  }

  /**
   * Store a discovery (creates a knowledge entry)
   */
  async storeDiscovery(discovery: any): Promise<string> {
    return await this.addEntry({
      type: 'vulnerability',
      title: discovery.title || 'Discovery',
      description: discovery.description || '',
      content: typeof discovery === 'string' ? discovery : JSON.stringify(discovery),
      source: 'internal',
      tags: discovery.tags || ['discovery']
    });
  }

  /**
   * Find similar entries based on query
   */
  async findSimilar(query: string, options?: { limit?: number; minSimilarity?: number }): Promise<any[]> {
    return await this.search({
      query,
      limit: options?.limit || 10,
      minSimilarity: options?.minSimilarity || 0.7
    });
  }
}

export default new KnowledgeStore();
