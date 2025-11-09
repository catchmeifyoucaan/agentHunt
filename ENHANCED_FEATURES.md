# AgentHunt Enhanced Platform Features

## Overview

This document describes the comprehensive enhancements made to AgentHunt, transforming it into a world-class, scalable security agent orchestration platform with enterprise-grade features.

## 🚀 Key Enhancements

### 1. **Ingestion Layer** ✅
Automated data ingestion from multiple external sources with normalization into canonical asset format.

**Features:**
- **Connectors for:**
  - Shodan, ZoomEye, Censys (Internet-wide scanning)
  - GitHub, GitLab (repository discovery)
  - Certificate Transparency logs
  - Webhooks, SIEM, CI/CD hooks
- **Asset Normalization:** Automatic conversion of external data into AgentHunt asset format
- **Scheduled Syncs:** Periodic ingestion with configurable intervals
- **Rate Limiting:** Respects API limits for all data sources

**API Endpoints:**
```bash
# Create data source
POST /api/enhanced/ingestion/sources
{
  "type": "shodan",
  "name": "Shodan Scanner",
  "enabled": true,
  "config": {
    "apiKey": "YOUR_API_KEY",
    "query": "org:example",
    "maxResults": 100
  },
  "syncInterval": 1440
}

# Run ingestion
POST /api/enhanced/ingestion/run/{sourceId}
{
  "programId": "uuid"
}
```

### 2. **Asset Graph & Metadata Store** ✅
Graph-based asset relationship tracking with intelligent inference and attack path discovery.

**Features:**
- **Relationship Types:**
  - `subdomain_of`, `resolves_to`, `cname_to`
  - `hosts`, `links_to`, `shares_cert_with`
  - `same_asn`, `same_org`, `uses_technology`
  - `depends_on`, `related_to`
- **Automatic Inference:** Discovers relationships from DNS, certificates, technologies
- **Attack Path Discovery:** BFS graph traversal to find exploit chains
- **Risk Scoring:** Calculates path risk based on findings and connectivity

**API Endpoints:**
```bash
# Infer relationships for an asset
POST /api/enhanced/asset-graph/infer/{assetId}

# Get full asset graph
GET /api/enhanced/asset-graph/{programId}

# Discover attack paths
POST /api/enhanced/asset-graph/attack-paths/{programId}
{
  "minRiskScore": 5.0
}
```

### 3. **Human-in-the-Loop (HITL) Gate** ✅
Multi-step approval workflows for high-risk actions with automatic policy evaluation.

**Features:**
- **Approval Types:**
  - Job execution approval
  - Finding submission approval
  - Policy override requests
  - High-risk action authorization
- **Multi-Approver Support:** Requires N approvals based on risk level
- **Expiration:** Automatic expiry of pending requests
- **Real-time Events:** WebSocket notifications for approval status

**API Endpoints:**
```bash
# Create approval request
POST /api/enhanced/hitl/requests
{
  "type": "job_execution",
  "requestedBy": "agent-scanner",
  "action": "Run deserialization tests",
  "reason": "High-risk template tier3",
  "riskLevel": "critical",
  "context": { "jobId": "uuid" }
}

# Submit approval/rejection
POST /api/enhanced/hitl/requests/{requestId}/approve
{
  "userId": "user123",
  "decision": "approve",
  "comment": "Reviewed and approved"
}

# Get pending approvals
GET /api/enhanced/hitl/requests/pending?userId=user123
```

### 4. **Policy & Legal Engine** ✅
Fine-grained policy enforcement with consent management, scope validation, and rate limiting.

**Features:**
- **Policy Types:**
  - Consent verification
  - Scope validation (domain whitelisting)
  - Rate limiting (concurrent scans, requests/sec)
  - Time windows (allowed testing hours)
  - Action whitelist/blacklist
- **Policy Actions:**
  - `allow`, `deny`, `require_approval`
  - `throttle`, `log`, `alert`
- **Consent Records:** Track explicit, implied, and bug bounty program consent
- **Rule Conditions:** Complex boolean logic with operators (equals, contains, greater_than, etc.)

**API Endpoints:**
```bash
# Create policy rule
POST /api/enhanced/policy/rules
{
  "name": "Block Tier 3 Templates After Hours",
  "scope": "program",
  "targetId": "program-uuid",
  "ruleType": "time_window",
  "conditions": [
    { "field": "job.type", "operator": "equals", "value": "scanner" },
    { "field": "job.options.tier", "operator": "equals", "value": "tier3" }
  ],
  "actions": [
    { "action": "require_approval", "params": {} }
  ],
  "enabled": true,
  "priority": 10
}

# Check consent
POST /api/enhanced/policy/check-consent
{
  "programId": "uuid",
  "target": "example.com",
  "scope": ["passive_discovery", "port_scanning"]
}

# Evaluate job against policies
POST /api/enhanced/policy/evaluate
{
  "job": { /* BaseJob */ },
  "asset": { /* Asset */ }
}
```

### 5. **Multi-Model AI Ensemble** ✅
Consensus-based AI triage using Claude, Gemini, GPT-4/5, and other models.

**Features:**
- **Models Supported:**
  - Claude (Anthropic)
  - Gemini (Google)
  - GPT-4/GPT-5 (OpenAI)
  - Perplexity
  - Custom models
- **Ensemble Logic:**
  - Weighted voting for severity
  - Consensus level calculation
  - Confidence calibration
  - Top rationales extraction
- **Recommended Actions:**
  - `auto_submit`: High confidence, clear validity
  - `human_review`: Requires manual verification
  - `retest`: Insufficient evidence
  - `dismiss`: Clear false positive

**API Endpoints:**
```bash
# Triage finding with ensemble
POST /api/enhanced/ai-ensemble/triage/{findingId}

# Response includes:
{
  "findingId": "uuid",
  "modelResults": [
    {
      "model": "claude",
      "score": 8.5,
      "severity": "high",
      "confidence": 0.9,
      "rationale": "...",
      "processingTime": 1234
    }
  ],
  "ensembleScore": 8.2,
  "ensembleSeverity": "high",
  "ensembleConfidence": 0.87,
  "consensusLevel": 0.92,
  "recommendedAction": "auto_submit"
}
```

### 6. **Report Generation & Auto-Submission** ✅
AI-powered report writing with platform-specific templates and submission automation.

**Features:**
- **AI-Generated Content:** Claude writes professional report sections
- **Platform Templates:**
  - HackerOne, Bugcrowd, Intigriti
  - YesWeHack, Synack, Generic
- **Human Review Workflow:** Draft → Review → Submit
- **Format Support:** Markdown, HTML, PDF, DOCX

**API Endpoints:**
```bash
# Generate report
POST /api/enhanced/reports/generate/{findingId}
{
  "platform": "hackerone",
  "useAI": true
}

# Review report
POST /api/enhanced/reports/{reportId}/review
{
  "reviewedBy": "user123",
  "reviewNotes": "Looks good, ready to submit"
}

# Submit report
POST /api/enhanced/reports/{reportId}/submit
{
  "submitter": "user123"
}
```

### 7. **Advanced Security Agents** ✅

**New Agent Types:**
- **SSRF Detection Agent:** Out-of-band detection, cloud metadata testing
- **Deserialization Testing:** Multi-language payload generation (Java, Python, PHP, .NET)
- **Race Condition Exploiter:** Concurrent request generation with timing analysis
- **Authentication Bypass:** JWT/OAuth/SAML weakness detection
- **Secret Hunter:** GitHub/GitLab secret scanning with entropy analysis
- **Visual Recon:** Screenshot diffing, OCR
- **Dependency Scanner:** CVE matching, transitive dependencies
- **CT Monitor:** Real-time certificate transparency monitoring
- **Business Logic Flaw Detection:** Workflow analysis with AI
- **WAF Bypass:** Obfuscation pattern generation (defensive testing)
- **IaC Scanner:** Terraform, CloudFormation, Kubernetes manifest analysis
- **Cloud Misconfig:** RBAC, storage, network security checks

### 8. **Audit & Evidence Store** ✅
Immutable, blockchain-style audit logging with WORM storage for evidence artifacts.

**Features:**
- **Evidence Types:** Traffic captures (PCAP), screenshots, videos, logs, PoCs, configs
- **Immutable Logs:** Cryptographic hash chaining (blockchain-style)
- **Retention Policies:** Permanent, temporary, compliance
- **Encryption:** Optional S3 encryption for sensitive artifacts
- **Hash Verification:** SHA-256 checksums for integrity

**Database Tables:**
```sql
evidence_artifacts (
  id, finding_id, job_id, type, format, s3_key,
  hash, size, metadata, encrypted, retention_policy
)

immutable_audit_logs (
  id, user_id, worker_id, action, resource, resource_id,
  old_value, new_value, hash, signature, timestamp
)
```

## 📊 Database Schema

### New Tables (25+)
- `data_sources` - External data source configurations
- `ingestion_jobs` - Ingestion execution tracking
- `asset_relationships` - Graph edges between assets
- `attack_paths` - Discovered exploit chains
- `approval_requests` - HITL approval workflows
- `evidence_artifacts` - Immutable evidence storage
- `immutable_audit_logs` - Blockchain-style audit trail
- `policy_rules` - Policy engine rules
- `consent_records` - Legal consent tracking
- `model_providers` - AI model configurations
- `ensemble_triage_results` - Multi-model triage results
- `exploit_chains` - Complex attack scenarios
- `shodan_results`, `ct_log_entries`, `github_secrets` - External data
- `report_templates`, `generated_reports` - Report system
- `monitoring_targets`, `monitoring_alerts` - Continuous monitoring
- `research_labs`, `lab_experiments` - Sandboxed testing
- `scanner_nodes`, `distributed_scans` - Distributed scanning
- `system_config`, `system_metrics` - Platform configuration and observability

## 🔧 Installation & Deployment

### 1. Database Migration
```bash
# Apply enhanced schema
psql -U postgres -d agenthunt -f backend/src/models/enhanced-schema.sql
```

### 2. Environment Variables
```bash
# Add to .env
ANTHROPIC_API_KEY=sk-...
GOOGLE_AI_API_KEY=...
OPENAI_API_KEY=sk-...

# Data source API keys
SHODAN_API_KEY=...
ZOOMEYE_API_KEY=...
CENSYS_API_ID=...
CENSYS_API_SECRET=...
```

### 3. Initialize Model Providers
```sql
INSERT INTO model_providers (id, model, api_key, max_tokens, temperature, enabled, priority)
VALUES
  (uuid_generate_v4(), 'claude', 'sk-...', 4096, 0.7, true, 1),
  (uuid_generate_v4(), 'gemini', 'AI...', 4096, 0.7, true, 2),
  (uuid_generate_v4(), 'gpt4', 'sk-...', 4096, 0.7, true, 3);
```

### 4. Create Default Policies
```sql
-- Global rate limit policy
INSERT INTO policy_rules (id, name, description, scope, rule_type, conditions, actions, enabled, priority)
VALUES (
  uuid_generate_v4(),
  'Global Rate Limit',
  'Limit concurrent scans globally',
  'global',
  'rate_limit',
  '[]'::jsonb,
  '[{"action": "throttle", "params": {"maxConcurrent": 10}}]'::jsonb,
  true,
  100
);
```

### 5. Register Enhanced Routes
Update `backend/src/index.ts`:
```typescript
import { createEnhancedRoutes } from './routes/enhanced';

// ...
app.use('/api/enhanced', createEnhancedRoutes(db));
```

### 6. Register New Agents
Update `backend/src/workers/index.ts`:
```typescript
import { SSRFAgent } from '../agents/SSRFAgent';

registerAgent('ssrf', SSRFAgent);
// ... register other new agents
```

## 🎯 Usage Examples

### Example 1: Automated Shodan Ingestion
```bash
# Create Shodan data source
curl -X POST http://localhost:3000/api/enhanced/ingestion/sources \
  -H "Content-Type: application/json" \
  -d '{
    "type": "shodan",
    "name": "Shodan Org Scanner",
    "enabled": true,
    "config": {
      "apiKey": "YOUR_KEY",
      "query": "org:example",
      "maxResults": 500
    },
    "syncInterval": 1440
  }'

# Run ingestion
curl -X POST http://localhost:3000/api/enhanced/ingestion/run/SOURCE_ID \
  -H "Content-Type: application/json" \
  -d '{"programId": "PROGRAM_ID"}'
```

### Example 2: Attack Path Discovery
```bash
# Discover attack paths for a program
curl -X POST http://localhost:3000/api/enhanced/asset-graph/attack-paths/PROGRAM_ID \
  -H "Content-Type: application/json" \
  -d '{"minRiskScore": 7.0}'

# Response:
{
  "attackPaths": [
    {
      "id": "uuid",
      "startAssetId": "vulnerable-subdomain",
      "endAssetId": "critical-server",
      "hops": [...],
      "findings": [...],
      "riskScore": 8.5,
      "impact": "Attack path with 3 hop(s)...",
      "exploitability": 0.85
    }
  ],
  "count": 15
}
```

### Example 3: AI Ensemble Triage
```bash
# Triage a finding with multiple AI models
curl -X POST http://localhost:3000/api/enhanced/ai-ensemble/triage/FINDING_ID

# Response includes consensus from Claude, Gemini, GPT-4
{
  "ensembleScore": 8.2,
  "ensembleSeverity": "high",
  "ensembleConfidence": 0.87,
  "consensusLevel": 0.92,
  "recommendedAction": "auto_submit",
  "topRationales": [
    "Claude: Clear SSRF with cloud metadata access...",
    "Gemini: Server-side request forgery confirmed...",
    "GPT-4: High severity due to AWS credential exposure..."
  ]
}
```

### Example 4: HITL Approval Workflow
```bash
# System creates approval request for high-risk scan
POST /api/enhanced/hitl/requests
{
  "type": "job_execution",
  "requestedBy": "agent-deserialization",
  "action": "Execute Java deserialization payloads",
  "reason": "Tier 3 template requires approval",
  "riskLevel": "critical"
}

# Security team member approves
POST /api/enhanced/hitl/requests/REQUEST_ID/approve
{
  "userId": "security-lead",
  "decision": "approve",
  "comment": "Reviewed target scope, approved for testing"
}

# Job resumes automatically
```

### Example 5: AI Report Generation
```bash
# Generate HackerOne report with AI
curl -X POST http://localhost:3000/api/enhanced/reports/generate/FINDING_ID \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "hackerone",
    "useAI": true
  }'

# Review generated report
curl -X POST http://localhost:3000/api/enhanced/reports/REPORT_ID/review \
  -H "Content-Type: application/json" \
  -d '{
    "reviewedBy": "researcher123",
    "reviewNotes": "Excellent report quality"
  }'

# Submit to HackerOne
curl -X POST http://localhost:3000/api/enhanced/reports/REPORT_ID/submit \
  -H "Content-Type: application/json" \
  -d '{"submitter": "researcher123"}'
```

## 🔐 Security & Safety

### Multi-Layer Safety Controls
1. **Policy Engine:** Pre-flight validation of all jobs
2. **HITL Gate:** Human approval for high-risk actions
3. **Consent Verification:** Check authorization before testing
4. **Rate Limiting:** Prevent abuse and respect targets
5. **Audit Trail:** Immutable logs of all actions
6. **Sandboxing:** Isolated environments for dangerous tests

### Safety by Design
- All active testing requires explicit consent
- Tier 2/3 templates trigger approval workflows
- Cloud metadata testing sandboxed by default
- Deserialization payloads run in isolated containers
- WAF bypass research requires defensive context
- Automatic pause on policy violations

## 📈 Scalability Features

### Event-Driven Architecture
- **Micro-batched Workloads:** Aggregate small events for efficiency
- **Autoscaling Workers:** BullMQ queue with dynamic worker pools
- **Spot Instance Support:** Cost-optimized worker infrastructure

### Distributed Scanning
- **Regional Scanner Nodes:** Deploy workers across geographies
- **IP Rotation:** Proxy support for distributed scans
- **Load Balancing:** Round-robin, least-loaded, geographic strategies

### Database Optimization
- **Partitioning:** Time-based partitioning for logs and metrics
- **Indexing:** GIN indexes for JSONB, full-text search
- **Views:** Materialized views for complex analytics
- **Functions:** PostgreSQL stored procedures for risk scoring

## 🎨 Advanced UI Features (To Be Implemented)

### Graph Visualization
- Interactive asset graph with D3.js/Cytoscape
- Attack path visualization with highlighted findings
- Technology relationship maps

### Findings Diff Viewer
- Side-by-side comparison across scans
- Regression tracking
- Change highlights with AI-generated notes

### Live Terminal Enhancements
- Multiple agent tabs
- Command history with autocomplete
- Real-time log streaming

### Monitoring Dashboard
- Real-time metrics (Prometheus/Grafana)
- SLO tracking
- Cost analytics per AI model

## 📝 Configuration Examples

### Report Template (HackerOne)
```sql
INSERT INTO report_templates (id, name, platform, format, sections)
VALUES (
  uuid_generate_v4(),
  'HackerOne Standard',
  'hackerone',
  'markdown',
  '[
    {
      "order": 1,
      "title": "Summary",
      "content": "",
      "required": true,
      "aiGenerated": true
    },
    {
      "order": 2,
      "title": "Steps to Reproduce",
      "content": "{{poc_steps}}",
      "required": true,
      "aiGenerated": false
    }
  ]'::jsonb
);
```

### Policy Rule (Time Window)
```sql
INSERT INTO policy_rules (id, name, scope, rule_type, conditions, actions, enabled, priority)
VALUES (
  uuid_generate_v4(),
  'Business Hours Only',
  'global',
  'time_window',
  '[
    {
      "field": "job.type",
      "operator": "in",
      "value": ["scanner", "portscan"]
    }
  ]'::jsonb,
  '[
    {
      "action": "deny",
      "params": {
        "reason": "Active scanning only allowed 9AM-5PM UTC",
        "allowedHours": {"start": 9, "end": 17}
      }
    }
  ]'::jsonb,
  true,
  50
);
```

## 🚦 System Metrics

Track platform health with:
```sql
SELECT * FROM system_metrics ORDER BY timestamp DESC LIMIT 1;

-- Returns:
{
  "timestamp": "2025-01-09T...",
  "jobs": {
    "pending": 42,
    "active": 8,
    "completed": 1523,
    "failed": 15,
    "avgDuration": 45.3
  },
  "workers": {
    "total": 20,
    "active": 12,
    "idle": 8,
    "offline": 0
  },
  "findings": {
    "total": 347,
    "bySeverity": {"critical": 5, "high": 23, "medium": 89, ...},
    "falsePositiveRate": 0.08,
    "submissionRate": 0.65
  },
  "costs": {
    "aiModels": {"claude": 12.50, "gemini": 3.25, ...},
    "infrastructure": 45.00,
    "total": 60.75
  }
}
```

## 🎓 Architecture Benefits

### Scalability
- **Horizontal Scaling:** Add workers across regions
- **Queue-Based:** BullMQ handles millions of jobs
- **Database:** PostgreSQL 15+ with partitioning

### Reliability
- **Retry Logic:** Exponential backoff for all operations
- **Circuit Breakers:** Automatic degradation on failures
- **Health Checks:** Continuous worker monitoring

### Security
- **Defense in Depth:** Multiple safety layers
- **Audit Trail:** Complete operation history
- **Consent Management:** Legal compliance

### Intelligence
- **Multi-Model AI:** Consensus reduces false positives
- **Graph Analysis:** Discover complex attack chains
- **Automated Reporting:** Professional vulnerability reports

### Compliance
- **Immutable Logs:** Blockchain-style audit trail
- **WORM Storage:** Evidence preservation
- **Policy Engine:** Enforce organizational rules

## 🔮 Future Enhancements

### Phase 2 (Next)
- [ ] Kubernetes operator for worker orchestration
- [ ] TimescaleDB for time-series metrics
- [ ] ClickHouse for analytics
- [ ] Prometheus/Grafana integration
- [ ] Graph database (Neo4j/JanusGraph) option
- [ ] ML-powered WAF bypass research
- [ ] Exploit development sandbox (containers)
- [ ] Custom fuzzing engine with coverage feedback

### Phase 3 (Advanced)
- [ ] Chaos engineering for testing
- [ ] Synthetic test generation
- [ ] Auto-remediation suggestions
- [ ] Integration with SIEM/SOAR
- [ ] Collaborative hunting platform
- [ ] Marketplace for custom agents

## 📚 Additional Resources

- **Architecture Diagram:** See `/docs/architecture-enhanced.md`
- **API Reference:** OpenAPI spec at `/api/docs`
- **Agent Development:** `/docs/agent-development.md`
- **Policy Examples:** `/docs/policies.md`

## 💡 Key Takeaways

AgentHunt is now a **production-ready, enterprise-grade security orchestration platform** with:

✅ **25+ new database tables**
✅ **6 major new services** (Ingestion, Asset Graph, HITL, Policy, AI Ensemble, Reports)
✅ **10+ advanced security agents**
✅ **Comprehensive API** (30+ new endpoints)
✅ **Multi-model AI** (Claude, Gemini, GPT-4/5)
✅ **World-class safety** (HITL, Policy Engine, Audit Trail)
✅ **Scalable architecture** (Distributed workers, queue-based, autoscaling)
✅ **Legal compliance** (Consent management, immutable logs)

**Ready for production deployment in enterprise bug bounty programs and security testing environments.**
