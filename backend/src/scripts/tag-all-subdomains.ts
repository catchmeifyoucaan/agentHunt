import database from '../services/database';
import logger from '../utils/logger';

/**
 * One-time script to tag all existing untagged subdomains as internal or external
 */

// Helper function to determine if subdomain is internal infrastructure
const isInternalInfrastructure = (subdomain: string): boolean => {
  const lower = subdomain.toLowerCase();

  // Internal .net domains (infrastructure)
  if (lower.endsWith('.spotify.net') || lower.endsWith('.soundtrap.net')) {
    return true;
  }

  // Cloud provider patterns (.oath.cloud, .vespa.oath.cloud, etc.)
  if (lower.includes('.oath.cloud') || lower.includes('.vespa.oath.cloud')) {
    return true;
  }

  // CDN patterns
  if (lower.includes('.cdn.') || lower.includes('.yimg.com')) {
    return true;
  }

  // Datacenter patterns (ash1, sjc1, lon3, sto3, guc, etc.)
  if (/\b(ash|sjc|lon|sto|guc|iad|dfw|atl|ord|sea)\d+[-.]/.test(lower)) {
    return true;
  }

  // Database/infrastructure services
  if (
    /(cassandra|redis|mongo|postgres|mysql|kafka|zookeeper|elasticsearch|memcache|rabbitmq|ldap|storage)/.test(
      lower
    )
  ) {
    return true;
  }

  // Internal test/dev environments
  if (
    /(\.dev\.soundtrap\.|alumni\.dev\.|www-test\.|antivirus-|antivirus\.|_dmarc\.|_domainkey\.)/.test(
      lower
    )
  ) {
    return true;
  }

  // Infrastructure/internal patterns
  if (
    /(linkap|vmdtranscoding|silocassandra|pushntfy|prexcass|-origin\.|staging\.|stage\.|accesspoint|bigkafka)/.test(
      lower
    )
  ) {
    return true;
  }

  // Rivals.com, compuserve.com (old/dead domains)
  if (lower.includes('rivals.com') || lower.includes('compuserve.com')) {
    return true;
  }

  return false;
};

async function tagAllSubdomains() {
  try {
    logger.info('Starting subdomain tagging migration...');

    // Get all untagged subdomains
    const result = await database.query(
      `SELECT id, value FROM assets
       WHERE type = 'subdomain'
       AND (metadata->>'isInternal' IS NULL OR metadata IS NULL)`
    );

    const untaggedCount = result.rows.length;
    logger.info({ untaggedCount }, `Found ${untaggedCount} untagged subdomains`);

    if (untaggedCount === 0) {
      logger.info('No untagged subdomains found');
      return;
    }

    // Tag in batches of 1000
    const BATCH_SIZE = 1000;
    let internalCount = 0;
    let externalCount = 0;

    for (let i = 0; i < result.rows.length; i += BATCH_SIZE) {
      const batch = result.rows.slice(i, i + BATCH_SIZE);

      logger.info(
        {
          batch: Math.floor(i / BATCH_SIZE) + 1,
          total: Math.ceil(result.rows.length / BATCH_SIZE),
          progress: `${i}/${result.rows.length}`,
        },
        `Processing batch...`
      );

      // Tag each subdomain in this batch
      const updates = batch.map(async (row: any) => {
        const isInternal = isInternalInfrastructure(row.value);

        if (isInternal) internalCount++;
        else externalCount++;

        await database.query(
          `UPDATE assets
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('isInternal', $1::boolean)
           WHERE id = $2`,
          [isInternal, row.id]
        );
      });

      await Promise.all(updates);
    }

    logger.info(
      {
        total: untaggedCount,
        internal: internalCount,
        external: externalCount,
        internalPercent: Math.round((internalCount / untaggedCount) * 100),
        externalPercent: Math.round((externalCount / untaggedCount) * 100),
      },
      `✓ Tagging complete: ${internalCount} internal, ${externalCount} external`
    );

    // Verify the results
    const verifyResult = await database.query(
      `SELECT
         COUNT(*) as total,
         COUNT(CASE WHEN metadata->>'isInternal' = 'true' THEN 1 END) as internal,
         COUNT(CASE WHEN metadata->>'isInternal' = 'false' THEN 1 END) as external,
         COUNT(CASE WHEN metadata->>'isInternal' IS NULL THEN 1 END) as untagged
       FROM assets
       WHERE type = 'subdomain'`
    );

    logger.info({ stats: verifyResult.rows[0] }, 'Final subdomain statistics');
  } catch (err) {
    logger.error({ err }, 'Failed to tag subdomains');
    throw err;
  }
}

// Run if executed directly
if (require.main === module) {
  tagAllSubdomains()
    .then(() => {
      logger.info('Migration complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration failed');
      process.exit(1);
    });
}

export default tagAllSubdomains;
