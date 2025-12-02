import database from '../services/database';
import logger from '../utils/logger';

/**
 * Batch Insert Utility
 * Optimizes database inserts by batching multiple rows into single queries
 * Performance: 100-1000x faster than individual INSERTs
 */

interface AssetInsert {
  programId: string;
  type: string;
  value: string;
  source?: string; // source is string in DB schema, not array
  status?: string;
  metadata?: any;
}

/**
 * Batch insert assets (100-1000x faster than individual inserts)
 */
export async function batchInsertAssets(assets: AssetInsert[], batchSize = 1000): Promise<number> {
  if (assets.length === 0) return 0;

  let totalInserted = 0;
  const client = await database.getClient();

  try {
    // Set statement timeout to prevent hanging (30 seconds)
    await client.query('SET statement_timeout = 30000');
    await client.query('BEGIN');

    // Process in batches to avoid query size limits
    for (let i = 0; i < assets.length; i += batchSize) {
      const batch = assets.slice(i, i + batchSize);

      // Build VALUES clause
      const values: any[] = [];
      const placeholders: string[] = [];

      batch.forEach((asset, idx) => {
        const baseIdx = idx * 5;
        placeholders.push(
          `($${baseIdx + 1}, $${baseIdx + 2}, $${baseIdx + 3}, $${baseIdx + 4}, $${baseIdx + 5})`
        );
        values.push(
          asset.programId,
          asset.type,
          asset.value,
          asset.source || 'unknown',
          JSON.stringify(asset.metadata || {})
        );
      });

      const query = `
        INSERT INTO assets (program_id, type, value, source, metadata)
        VALUES ${placeholders.join(', ')}
        ON CONFLICT (program_id, type, value_hash) DO UPDATE
        SET last_scanned = CURRENT_TIMESTAMP,
            metadata = assets.metadata || EXCLUDED.metadata
      `;

      const result = await client.query(query, values);
      totalInserted += result.rowCount || 0;
    }

    await client.query('COMMIT');
    logger.debug({ count: totalInserted, total: assets.length }, 'Batch inserted assets');
    return totalInserted;
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ error, count: assets.length }, 'Batch insert failed');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Batch insert using PostgreSQL COPY (fastest method, 10-50x faster than INSERT)
 * Use for very large batches (>10k rows)
 * Note: COPY requires pg-copy-streams package, using batch INSERT for now
 */
export async function bulkCopyAssets(assets: AssetInsert[]): Promise<number> {
  // For now, use batch insert for simplicity
  // Can be enhanced with pg-copy-streams later if needed
  return batchInsertAssets(assets, 5000);
}
