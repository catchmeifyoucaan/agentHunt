# Quick Wins - Implementation Guide

## 🚀 Top 5 Critical Fixes (30 minutes each)

### 1. Fix Database Connection Pool (5 minutes)

**File**: `backend/src/services/database.ts`

```typescript
// Line 16 - Change from:
max: 20,

// To:
max: parseInt(process.env.DB_POOL_MAX || '100', 10),
min: parseInt(process.env.DB_POOL_MIN || '10', 10),
```

**Add to `.env`:**
```bash
DB_POOL_MAX=100
DB_POOL_MIN=10
```

---

### 2. Fix Individual Inserts in Fingerprint Agent (15 minutes)

**File**: `backend/src/agents/fingerprint.ts`

**Replace lines 180-192:**
```typescript
// OLD CODE:
for (const asset of resolved) {
  try {
    await database.query(
      `INSERT INTO assets (program_id, value, type, discovered_at, metadata)
       VALUES ($1, $2, 'subdomain', CURRENT_TIMESTAMP, jsonb_build_object('dnsResolved', true))
       ON CONFLICT (program_id, value, type) 
       DO UPDATE SET metadata = assets.metadata || jsonb_build_object('dnsResolved', true)`,
      [programId, asset]
    );
  } catch (error) {
    logger.error({ error, asset }, 'Failed to save DNS-resolved asset');
  }
}
```

**With:**
```typescript
// NEW CODE: Batch insert
if (resolved.length > 0) {
  try {
    const { batchInsertAssets } = require('../utils/batch-insert');
    const assetsToInsert = resolved.map((asset) => ({
      programId,
      type: 'subdomain',
      value: asset,
      source: 'dnsx',
      metadata: { dnsResolved: true },
    }));
    await batchInsertAssets(assetsToInsert);
  } catch (error) {
    logger.error({ error, count: resolved.length }, 'Failed to batch save DNS-resolved assets');
  }
}
```

---

### 3. Fix Individual Updates in Fingerprint Agent (20 minutes)

**File**: `backend/src/agents/fingerprint.ts`

**Replace lines 88-133 (the loop with individual UPDATEs):**
```typescript
// OLD CODE:
for (const asset of options.assets) {
  const metadata: AssetMetadata = {};
  // ... build metadata ...
  try {
    await database.query(
      `UPDATE assets
       SET metadata = metadata || $1::jsonb,
           last_scanned = CURRENT_TIMESTAMP
       WHERE program_id = $2 AND value = $3`,
      [JSON.stringify(metadata), programId, asset]
    );
  } catch (error) {
    logger.error({ error, asset }, 'Failed to update asset metadata');
  }
}
```

**With:**
```typescript
// NEW CODE: Batch update using temporary table
if (options.assets.length > 0) {
  try {
    await database.transaction(async (client) => {
      // Create temp table
      await client.query(`
        CREATE TEMP TABLE asset_metadata_updates (
          value TEXT PRIMARY KEY,
          metadata JSONB
        ) ON COMMIT DROP
      `);

      // Prepare batch data
      const metadataMap = new Map<string, AssetMetadata>();
      for (const asset of options.assets) {
        const metadata: AssetMetadata = {};
        const httpxResult = Array.isArray(results.httpx) && results.httpx.length
          ? results.httpx.find((r: any) => r.host === asset || r.url?.includes(asset))
          : null;

        if (httpxResult) {
          if (typeof httpxResult.status_code === 'number') {
            metadata.httpStatus = httpxResult.status_code;
          }
          if (httpxResult.title) metadata.title = httpxResult.title;
          const serverValue = Array.isArray(httpxResult.server)
            ? httpxResult.server[0]
            : httpxResult.server;
          if (serverValue) metadata.server = serverValue;
          const technologies = httpxResult.tech || httpxResult.technologies || [];
          if (Array.isArray(technologies) && technologies.length) {
            metadata.technologies = technologies;
          }
          if (httpxResult.cdn) {
            metadata.cdn = httpxResult.cdn;
            results.cdn++;
          }
        }
        metadataMap.set(asset, metadata);
      }

      // Bulk insert into temp table
      const values: any[] = [];
      const placeholders: string[] = [];
      let paramIndex = 1;
      
      for (const [asset, metadata] of metadataMap.entries()) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}::jsonb)`);
        values.push(asset, JSON.stringify(metadata));
        paramIndex += 2;
      }

      if (values.length > 0) {
        await client.query(
          `INSERT INTO asset_metadata_updates (value, metadata) VALUES ${placeholders.join(', ')}`,
          values
        );

        // Update assets from temp table
        await client.query(`
          UPDATE assets
          SET metadata = assets.metadata || a.metadata,
              last_scanned = CURRENT_TIMESTAMP
          FROM asset_metadata_updates a
          WHERE assets.program_id = $1
            AND assets.value = a.value
        `, [programId]);
      }
    });

    // Count results
    for (const asset of options.assets) {
      const metadata = metadataMap.get(asset);
      if ((metadata?.technologies?.length || 0) > 0 || metadata?.server || metadata?.title) {
        results.withTech++;
      }
    }
  } catch (error) {
    logger.error({ error, count: options.assets.length }, 'Failed to batch update asset metadata');
  }
}
```

---

### 4. Parallelize Auto-Orchestrator Queries (10 minutes)

**File**: `backend/src/services/auto-orchestrator.ts`

**In `handleSubdomainDiscovery` method, replace lines 146-156:**
```typescript
// OLD CODE:
const tagPromises = allSubdomains.map(async (subdomain: string) => {
  const isInternal = isInternalInfrastructure(subdomain);
  await database.query(
    `UPDATE assets
     SET metadata = metadata || jsonb_build_object('isInternal', $1::boolean)
     WHERE program_id = $2 AND value = $3 AND type = 'subdomain'`,
    [isInternal, programId, subdomain]
  );
});
await Promise.all(tagPromises);
```

**With:**
```typescript
// NEW CODE: Batch update
const internalSubdomains = allSubdomains.filter((s: string) => isInternalInfrastructure(s));
const externalSubdomains = allSubdomains.filter((s: string) => !isInternalInfrastructure(s));

await Promise.all([
  internalSubdomains.length > 0 ? database.query(
    `UPDATE assets
     SET metadata = metadata || '{"isInternal": true}'::jsonb
     WHERE program_id = $1 AND value = ANY($2::text[]) AND type = 'subdomain'`,
    [programId, internalSubdomains]
  ) : Promise.resolve(),
  externalSubdomains.length > 0 ? database.query(
    `UPDATE assets
     SET metadata = metadata || '{"isInternal": false}'::jsonb
     WHERE program_id = $1 AND value = ANY($2::text[]) AND type = 'subdomain'`,
    [programId, externalSubdomains]
  ) : Promise.resolve(),
]);
```

---

### 5. Reduce Stuck Job Cleanup Interval (2 minutes)

**File**: `backend/src/index.ts`

**Replace line 252:**
```typescript
// OLD: }, 15 * 60 * 1000); // Every 15 minutes

// NEW:
}, 5 * 60 * 1000); // Every 5 minutes
```

**And update the timeout in the query (line 230):**
```typescript
// OLD: AND started_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'

// NEW:
AND started_at < CURRENT_TIMESTAMP - INTERVAL '30 minutes'
```

---

## 🧪 Testing After Changes

1. **Test Database Pool:**
```bash
# Monitor connections
watch -n 1 "psql -U agenthunt -d agenthunt -c 'SELECT count(*) FROM pg_stat_activity;'"
```

2. **Test Batch Inserts:**
```bash
# Create a test job with 1000 assets
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "fingerprint",
    "program_id": "YOUR_PROGRAM_ID",
    "options": {
      "assets": ["test1.example.com", "test2.example.com", ...] # 1000 items
    }
  }'
```

3. **Monitor Performance:**
```bash
# Check query times in logs
grep "Query executed" logs/backend-out.log | tail -20
```

---

## 📊 Expected Results

After implementing these 5 fixes:
- **Database inserts**: 100-1000x faster for bulk operations
- **Connection pool**: 5x more capacity
- **Auto-orchestrator**: 2-3x faster
- **Stuck jobs**: Cleaned up 3x faster

**Total time to implement**: ~1 hour
**Performance improvement**: 10-100x for bulk operations

---

## ⚠️ Important Notes

1. **Backup database** before running migrations
2. **Test in staging** first
3. **Monitor logs** after deployment
4. **Gradually increase** worker concurrency after verifying stability
5. **Set up alerts** for database pool exhaustion

---

## 🔄 Rollback Plan

If issues occur:

1. **Revert database pool** to 20
2. **Revert batch inserts** to individual (keep as fallback)
3. **Increase cleanup interval** back to 15 minutes
4. **Check logs** for specific errors

---

**Next Steps**: After these quick wins, implement Phase 2 optimizations from CODE_REVIEW_AND_IMPROVEMENTS.md
