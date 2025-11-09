# AgentHunt Enhanced Platform - Migration Guide

## Quick Start

This guide helps you migrate from the base AgentHunt platform to the enhanced version with all new features.

## Prerequisites

- PostgreSQL 15+
- Redis 7+
- Node.js 18+
- Docker (optional, for containerized deployment)

## Step-by-Step Migration

### 1. Backup Your Database

```bash
# Backup existing database
pg_dump -U postgres agenthunt > backup_$(date +%Y%m%d).sql
```

### 2. Apply Enhanced Schema

```bash
# Apply new tables and functions
psql -U postgres -d agenthunt -f backend/src/models/enhanced-schema.sql
```

This creates:
- 25+ new tables for enhanced features
- Stored procedures for risk scoring
- Blockchain-style audit log triggers
- Materialized views for analytics

### 3. Install Dependencies

No new npm packages required! All dependencies are already in `package.json`:
- `@anthropic-ai/sdk` - Claude AI
- `@google/generative-ai` - Gemini
- `openai` - GPT-4/5
- `axios` - HTTP requests for connectors

### 4. Configure Environment Variables

Add to `.env`:

```bash
# AI Model API Keys
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_AI_API_KEY=AIza...
OPENAI_API_KEY=sk-...
PERPLEXITY_API_KEY=pplx-...

# External Data Sources (Optional)
SHODAN_API_KEY=...
ZOOMEYE_API_KEY=...
CENSYS_API_ID=...
CENSYS_API_SECRET=...
GITHUB_TOKEN=ghp_...
GITLAB_TOKEN=glpat-...

# Out-of-Band Server (Optional)
OOB_SERVER=https://interact.sh
```

### 5. Initialize Model Providers

```bash
# Run initialization script
psql -U postgres -d agenthunt << EOF
-- Insert Claude provider
INSERT INTO model_providers (id, model, api_key, max_tokens, temperature, enabled, priority, created_at, updated_at)
VALUES (
  uuid_generate_v4(),
  'claude',
  '${ANTHROPIC_API_KEY}',
  4096,
  0.7,
  true,
  1,
  NOW(),
  NOW()
);

-- Insert Gemini provider
INSERT INTO model_providers (id, model, api_key, max_tokens, temperature, enabled, priority, created_at, updated_at)
VALUES (
  uuid_generate_v4(),
  'gemini',
  '${GOOGLE_AI_API_KEY}',
  4096,
  0.7,
  true,
  2,
  NOW(),
  NOW()
);

-- Insert GPT-4 provider
INSERT INTO model_providers (id, model, api_key, max_tokens, temperature, enabled, priority, created_at, updated_at)
VALUES (
  uuid_generate_v4(),
  'gpt4',
  '${OPENAI_API_KEY}',
  4096,
  0.7,
  true,
  3,
  NOW(),
  NOW()
);
EOF
```

### 6. Update Application Code

#### A. Register Enhanced Routes

Update `backend/src/index.ts`:

```typescript
import { createEnhancedRoutes } from './routes/enhanced';

// After existing routes
app.use('/api/enhanced', createEnhancedRoutes(db));
```

#### B. Register New Agents

Update `backend/src/workers/index.ts`:

```typescript
import { SSRFAgent } from './agents/SSRFAgent';
// Import other new agents as you add them

// Register new agents
registerAgent('ssrf', SSRFAgent);
// registerAgent('deserialization', DeserializationAgent);
// registerAgent('racecondition', RaceConditionAgent);
// etc.
```

#### C. Import Types

The shared types are already extended in `shared/types/index.ts`. No changes needed!

### 7. Create Default Policies (Optional but Recommended)

```sql
-- Global rate limiting policy
INSERT INTO policy_rules (id, name, description, scope, rule_type, conditions, actions, enabled, priority, metadata, created_at, updated_at)
VALUES (
  uuid_generate_v4(),
  'Global Rate Limit',
  'Prevent excessive concurrent scans',
  'global',
  'rate_limit',
  '[]'::jsonb,
  '[
    {
      "action": "throttle",
      "params": {
        "maxConcurrentScans": 10,
        "maxRequestsPerSecond": 100
      }
    }
  ]'::jsonb,
  true,
  100,
  '{}'::jsonb,
  NOW(),
  NOW()
);

-- Require approval for high-risk actions
INSERT INTO policy_rules (id, name, description, scope, rule_type, conditions, actions, enabled, priority, metadata, created_at, updated_at)
VALUES (
  uuid_generate_v4(),
  'Approve Tier 3 Templates',
  'Require human approval for aggressive templates',
  'global',
  'action_whitelist',
  '[
    {
      "field": "job.options.tier",
      "operator": "equals",
      "value": "tier3"
    }
  ]'::jsonb,
  '[
    {
      "action": "require_approval",
      "params": {
        "reason": "Tier 3 templates require approval"
      }
    }
  ]'::jsonb,
  true,
  10,
  '{}'::jsonb,
  NOW(),
  NOW()
);
```

### 8. Rebuild and Restart

```bash
# Backend
cd backend
npm run build
npm start

# Workers
npm run workers

# Frontend (in separate terminal)
cd ../frontend
npm run dev
```

### 9. Verify Installation

```bash
# Health check
curl http://localhost:3000/api/enhanced/health

# Expected response:
{
  "status": "healthy",
  "services": {
    "ingestion": true,
    "assetGraph": true,
    "hitl": true,
    "policyEngine": true,
    "aiEnsemble": true,
    "reportGenerator": true
  },
  "timestamp": "2025-01-09T..."
}
```

## Feature Activation Checklist

### Core Infrastructure
- [x] Database schema migrated
- [x] Model providers configured
- [x] Enhanced routes registered
- [x] Environment variables set

### Optional Components
- [ ] Shodan connector (requires API key)
- [ ] ZoomEye connector (requires API key)
- [ ] GitHub secret hunter (requires token)
- [ ] CT log monitoring
- [ ] Report templates created
- [ ] Default policies configured

### Advanced Features
- [ ] Distributed scanner nodes deployed
- [ ] Research lab environments provisioned
- [ ] Monitoring dashboards (Prometheus/Grafana)
- [ ] Custom agents developed

## Testing the Migration

### 1. Test Asset Graph

```bash
# Create some test assets manually or via ingestion
# Then infer relationships
curl -X POST http://localhost:3000/api/enhanced/asset-graph/infer/ASSET_ID

# Discover attack paths
curl -X POST http://localhost:3000/api/enhanced/asset-graph/attack-paths/PROGRAM_ID \
  -H "Content-Type: application/json" \
  -d '{"minRiskScore": 1.0}'
```

### 2. Test AI Ensemble

```bash
# Triage a finding (create a test finding first)
curl -X POST http://localhost:3000/api/enhanced/ai-ensemble/triage/FINDING_ID
```

### 3. Test Report Generation

```bash
# Generate a report
curl -X POST http://localhost:3000/api/enhanced/reports/generate/FINDING_ID \
  -H "Content-Type: application/json" \
  -d '{"platform": "generic", "useAI": true}'
```

### 4. Test HITL

```bash
# Create an approval request
curl -X POST http://localhost:3000/api/enhanced/hitl/requests \
  -H "Content-Type: application/json" \
  -d '{
    "type": "job_execution",
    "requestedBy": "test-user",
    "action": "Test high-risk scan",
    "reason": "Testing HITL system",
    "riskLevel": "high",
    "context": {}
  }'

# List pending approvals
curl http://localhost:3000/api/enhanced/hitl/requests/pending
```

## Rollback Procedure

If you encounter issues and need to rollback:

```bash
# 1. Stop services
pkill -f "node.*index.ts"

# 2. Restore database backup
psql -U postgres -d agenthunt < backup_YYYYMMDD.sql

# 3. Checkout previous git commit
git log --oneline  # Find pre-migration commit
git checkout COMMIT_HASH

# 4. Rebuild and restart
npm run build
npm start
```

## Common Issues

### Issue: "Module not found" errors

**Solution:** Rebuild TypeScript
```bash
cd backend
rm -rf dist
npm run build
```

### Issue: Database connection errors

**Solution:** Check PostgreSQL is running and credentials are correct
```bash
psql -U postgres -d agenthunt -c "SELECT 1;"
```

### Issue: AI model API errors

**Solution:** Verify API keys are correct and have credits
```bash
# Test Claude
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'
```

### Issue: Worker registration errors

**Solution:** Ensure agent files are properly imported
```bash
# Check TypeScript compilation
cd backend
npx tsc --noEmit
```

## Performance Optimization

### Database Indexes

The enhanced schema includes optimized indexes. For large deployments, consider:

```sql
-- Add additional indexes for your query patterns
CREATE INDEX CONCURRENTLY idx_custom_query ON table_name(column);

-- Analyze tables for query planner
ANALYZE;
```

### Worker Scaling

```bash
# Scale workers based on queue depth
# Monitor with:
redis-cli LLEN "bull:scanner:wait"

# Add more workers as needed
npm run workers  # In multiple terminals or processes
```

## Production Deployment

### Docker Deployment

```yaml
# docker-compose.override.yml
version: '3.8'
services:
  backend:
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - GOOGLE_AI_API_KEY=${GOOGLE_AI_API_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    volumes:
      - ./backend/src:/app/backend/src

  workers:
    build:
      context: .
      dockerfile: Dockerfile
    command: npm run workers
    depends_on:
      - postgres
      - redis
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=${REDIS_URL}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
```

### Kubernetes Deployment

See `k8s/` directory for example manifests (to be created).

## Support

For issues or questions:
1. Check the [Enhanced Features Documentation](./ENHANCED_FEATURES.md)
2. Review [Architecture Documentation](./docs/ARCHITECTURE.md)
3. Open an issue on GitHub

## Next Steps

After successful migration:
1. Review the [Enhanced Features Guide](./ENHANCED_FEATURES.md)
2. Configure data source connectors for your use case
3. Create program-specific policies
4. Set up report templates for your bug bounty platforms
5. Train your team on new HITL approval workflows
6. Monitor system metrics and adjust worker scaling

## Migration Checklist

- [ ] Database backup created
- [ ] Enhanced schema applied
- [ ] Environment variables configured
- [ ] Model providers initialized
- [ ] Enhanced routes registered
- [ ] New agents registered (at least SSRF)
- [ ] Default policies created
- [ ] Application rebuilt
- [ ] Services restarted
- [ ] Health check passed
- [ ] Test API endpoints verified
- [ ] Team trained on new features

**Congratulations! You're now running AgentHunt Enhanced Platform!** 🎉
