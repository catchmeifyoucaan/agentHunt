import database from './database';
import logger from '../utils/logger';

/**
 * Advanced Deduplication Engine
 * Uses fuzzy matching and ML-based similarity detection
 */
class DeduplicationService {
  private static instance: DeduplicationService;

  private constructor() {}

  public static getInstance(): DeduplicationService {
    if (!DeduplicationService.instance) {
      DeduplicationService.instance = new DeduplicationService();
    }
    return DeduplicationService.instance;
  }

  /**
   * Check if a finding is a duplicate
   */
  public async isDuplicate(
    programId: string,
    title: string,
    description: string,
    assetValue: string
  ): Promise<{ isDuplicate: boolean; duplicateId?: string; similarity?: number }> {
    try {
      // Exact match check
      const exactMatch = await database.query(
        `SELECT id, title, description FROM findings
         WHERE program_id = $1 AND asset_id IN (
           SELECT id FROM assets WHERE value = $2
         ) AND title ILIKE $3
         LIMIT 1`,
        [programId, assetValue, title]
      );

      if (exactMatch.rows.length > 0) {
        return {
          isDuplicate: true,
          duplicateId: exactMatch.rows[0].id,
          similarity: 1.0,
        };
      }

      // Fuzzy match using trigram similarity
      const fuzzyMatch = await database.query(
        `SELECT id, title, description,
                similarity(title, $1) as title_sim,
                similarity(description, $2) as desc_sim
         FROM findings
         WHERE program_id = $3
         AND asset_id IN (SELECT id FROM assets WHERE value = $4)
         AND (similarity(title, $1) > 0.7 OR similarity(description, $2) > 0.5)
         ORDER BY (similarity(title, $1) + similarity(description, $2)) DESC
         LIMIT 1`,
        [title, description, programId, assetValue]
      );

      if (fuzzyMatch.rows.length > 0) {
        const row = fuzzyMatch.rows[0];
        const avgSimilarity = (row.title_sim + row.desc_sim) / 2;

        if (avgSimilarity > 0.6) {
          return {
            isDuplicate: true,
            duplicateId: row.id,
            similarity: avgSimilarity,
          };
        }
      }

      return { isDuplicate: false };
    } catch (error) {
      logger.error({ error }, 'Deduplication check failed');
      return { isDuplicate: false };
    }
  }

  /**
   * Mark finding as duplicate
   */
  public async markAsDuplicate(findingId: string, originalId: string): Promise<void> {
    await database.query(
      `UPDATE findings
       SET status = 'duplicate',
           metadata = metadata || jsonb_build_object('duplicate_of', $2)
       WHERE id = $1`,
      [findingId, originalId]
    );
  }

  /**
   * Find duplicate clusters
   */
  public async findDuplicateClusters(programId: string): Promise<any[]> {
    const result = await database.query(
      `SELECT f1.id, f1.title, array_agg(f2.id) as duplicates
       FROM findings f1
       JOIN findings f2 ON f1.program_id = f2.program_id
         AND f1.id != f2.id
         AND similarity(f1.title, f2.title) > 0.8
       WHERE f1.program_id = $1
       GROUP BY f1.id, f1.title
       HAVING COUNT(f2.id) > 0`,
      [programId]
    );

    return result.rows;
  }
}

export default DeduplicationService.getInstance();
