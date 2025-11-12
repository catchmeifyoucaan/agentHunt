# AgentHunt Job Orchestration Flow

## Overview

This document demonstrates how AgentHunt's automatic orchestration works after a single manual trigger.

## Files Created

1. **sample-program.json** - Test program configuration
2. **sample-discovery-job.json** - Discovery job trigger payload
3. **test-job-workflow.sh** - Automated test script

## Complete Workflow

### Phase 1: Manual Setup (ONE TIME ONLY)

#### Step 1: Create Program
```bash
curl -X POST http://localhost:3000/api/v1/programs \
  -H "Content-Type: application/json" \
  -d @sample-program.json
```

**Response:**
```json
{
  "id": "prog-abc123",
  "name": "Test Program - Example.com",
  "slug": "test-example",
  "status": "active"
}
```

#### Step 2: Trigger Discovery Job (MANUAL - LAST MANUAL STEP!)
```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "discovery",
    "program_id": "prog-abc123",
    "priority": 8,
    "options": {
      "sources": ["chaosdb", "subfinder"],
      "maxAssets": 10000
    }
  }'
```

**Response:**
```json
{
  "id": "job-discovery-001",
  "type": "discovery",
  "status": "pending",
  "position": 1,
  "queueName": "discovery"
}
```

---

### Phase 2: Automatic Orchestration (NO USER INTERVENTION!)

#### Job 1: Discovery Agent (3 minutes)
**Status:** Active → Processing
**What it does:**
- Queries Chaos DB for subdomains
- Runs Subfinder for subdomain enumeration
- Both sources run in PARALLEL

**Output Example:**
```
Discovered subdomains:
- api.example.com
- blog.example.com
- shop.example.com
- dev.example.com
- staging.example.com
... (1,000 subdomains total)
```

**Database Actions:**
- Inserts 1,000 subdomains into `assets` table (batch insert)
- Updates job status to "completed"

**Auto-Orchestrator Triggered:**
```javascript
// backend/src/services/auto-orchestrator.ts:46-51
switch (job.type) {
  case 'discovery':
    await this.handleSubdomainDiscovery(job.program_id, jobId);
    break;
}
```

#### Job 2: DNS Check (Auto-triggered) - 32 seconds
**Status:** Auto-created by Discovery Agent
**What it does:**
- DNSx validates all 1,000 subdomains
- Filters to only resolved domains

**Output Example:**
```
Resolved: 750 subdomains
Unresolved: 250 subdomains (removed)
```

**Database Actions:**
- Updates 750 assets with resolved IPs
- Marks 250 assets as inactive

**Auto-Orchestrator Triggered:**
```javascript
// Creates fingerprint job for all resolved subdomains
await this.triggerFingerprintJob(programId, resolvedSubdomains);
```

#### Job 3: Fingerprint Agent (Auto-triggered) - 90 seconds
**Status:** Auto-created by DNS Check
**What it does:**
- HTTPx probes all 750 resolved subdomains
- Checks for alive HTTP/HTTPS services
- Extracts technologies, status codes, titles

**Tools Running in PARALLEL:**
- DNSx (already done in previous step)
- HTTPx (150 req/s, 200 threads)
- TLSx (certificate info)

**Output Example:**
```
Alive hosts: 350/750
Technologies detected:
  - WordPress: 45 sites
  - Nginx: 120 sites
  - Apache: 85 sites
  - CloudFlare: 200 sites
```

**Database Actions:**
- Updates 350 assets with HTTP data
- Stores technology fingerprints in JSONB column
- Saves raw HTTPx output to S3

**Auto-Orchestrator Triggered (TWO JOBS IN PARALLEL):**
```javascript
// backend/src/services/auto-orchestrator.ts:127-168
await Promise.all([
  this.triggerScannerJob(programId, aliveHosts, fpJobId),
  this.triggerCrawlJob(programId, topUrls, fpJobId)
]);
```

#### Job 4a: Scanner Agent (Auto-triggered) - 10 minutes
**Status:** Auto-created by Fingerprint
**What it does:**
- Nuclei scans 350 alive hosts
- Uses tier0 + tier1 templates (~500 templates)
- 500 concurrency, 150 req/s rate limit

**Output Example:**
```
Findings discovered:
  [CRITICAL] SQL Injection in api.example.com/users
  [HIGH] XSS in blog.example.com/search
  [HIGH] Open redirect in shop.example.com/checkout
  [MEDIUM] CORS misconfiguration in api.example.com
  ... (50 total findings)
```

**Database Actions:**
- Inserts 50 findings into `findings` table
- Stores Nuclei JSON report in S3
- Each finding has status="new", needs_triage=true

**Auto-Orchestrator Triggered (50 JOBS - ONE PER FINDING):**
```javascript
// backend/src/services/auto-orchestrator.ts:280-316
for (const finding of findings) {
  await this.triggerTriageJob(finding.id);
}
```

#### Job 4b: Crawler Agent (Auto-triggered, PARALLEL) - 5 minutes
**Status:** Auto-created by Fingerprint (runs parallel with Scanner)
**What it does:**
- Katana crawls top 100 URLs
- Depth 2-3, extracts endpoints
- JS rendering enabled

**Output Example:**
```
URLs discovered: 2,500
  - /api/v1/users
  - /api/v1/products
  - /admin/dashboard
  - /api/internal/debug
  ... (2,500 total)
```

**Database Actions:**
- Inserts 2,500 crawled URLs into `crawled_urls` table

**Auto-Orchestrator Triggered:**
```javascript
// Triggers ANOTHER scanner job for newly discovered URLs
await this.triggerScannerJob(programId, newUrls, crawlJobId);
```

#### Jobs 5a-5az: Triage Agent (Auto-triggered, 50 PARALLEL JOBS) - 5 seconds each
**Status:** Auto-created by Scanner (one job per finding)
**What it does:**
- AI analyzes each finding
- Assigns severity + confidence score
- Generates PoC with steps
- Calculates CVSS score

**Example Triage for Finding #1:**
```json
{
  "finding_id": "find-001",
  "severity": "critical",
  "confidence": 0.95,
  "cvss": 9.8,
  "cwe": ["CWE-89"],
  "poc": {
    "title": "SQL Injection in User Search",
    "steps": [
      "1. Navigate to https://api.example.com/users?search=test",
      "2. Replace 'test' with: test' OR '1'='1",
      "3. Observe: All users returned (authentication bypass)"
    ],
    "proof": "Response contains admin user data"
  },
  "ai_provider": "gemini",
  "tokens_used": 1250,
  "cost": 0.0
}
```

**Database Actions:**
- Updates finding with AI analysis
- Sets status="triaged"
- Adds confidence score

**Auto-Orchestrator Triggered (for high-confidence findings):**
```javascript
// backend/src/services/auto-orchestrator.ts:335-365
if (confidence >= 0.85) {
  await this.triggerConfirmJob(findingId);
}
```

#### Jobs 6a-6m: Confirm Agent (Auto-triggered, 15 PARALLEL JOBS) - 1 minute each
**Status:** Auto-created by Triage (only for high-confidence findings)
**What it does:**
- Multi-method validation (2-3 techniques)
- Replay attack with modifications
- Verifies finding is exploitable

**Example Confirmation:**
```json
{
  "finding_id": "find-001",
  "methods_tested": ["direct_replay", "modified_payload", "blind_sqli"],
  "results": {
    "direct_replay": "success",
    "modified_payload": "success",
    "blind_sqli": "success"
  },
  "confirmed": true,
  "confidence": 0.98
}
```

**Database Actions:**
- Updates finding status="confirmed"
- Increments confirmation count
- Final confidence: 0.98

**Telegram Notification Triggered:**
```
🔴 New CRITICAL Finding

Program: Test Program - Example.com
Asset: api.example.com
Title: SQL Injection in User Search

Confidence: 98%
CVSS: 9.8
Status: confirmed
Confirmations: 3/3 passed

View: http://165.227.108.120:3001/findings/find-001
```

#### Job 7: Scanner Agent Round 2 (Auto-triggered) - 8 minutes
**Status:** Auto-created by Crawler (for newly discovered URLs)
**What it does:**
- Scans 2,500 crawled URLs
- May discover 20-30 more findings

**The cycle repeats: Scanner → Triage → Confirm**

---

## Final Results Summary

### Total Time: ~18-20 minutes

### Manual Triggers: **1** (Discovery job only)

### Auto-Triggered Jobs: **~150+**
- 1x DNS Check
- 1x Fingerprint
- 2x Scanner (initial + post-crawl)
- 1x Crawler
- 50x Triage (one per finding)
- 15x Confirm (high-confidence only)

### Findings: **50 vulnerabilities discovered**
- Critical: 2 (both confirmed)
- High: 13 (10 confirmed, 3 low confidence)
- Medium: 25 (15 triaged)
- Low: 10 (informational)

### False Positive Rate: <15%
- AI triage filters out most false positives
- Confirmation agent validates high-risk findings

### Cost: **$0.00**
- Gemini free tier (1,500 req/day)
- 50 findings × 1,250 tokens = 62,500 tokens
- Well under daily quota

---

## Key Insights

### 1. **Zero Manual Intervention After Initial Trigger**
Once you trigger the discovery job, the system:
- ✅ Automatically chains all subsequent jobs
- ✅ Intelligently prioritizes based on results
- ✅ Scales concurrency dynamically
- ✅ Self-heals on failures (retry logic)

### 2. **Intelligent Work Distribution**
The auto-orchestrator:
- Batches subdomains (1,000 per DNS job)
- Creates parallel triage jobs (50 concurrent)
- Triggers specialized agents based on tech fingerprints
- Chains scanner → crawler → scanner for deep coverage

### 3. **Real-Time Feedback**
WebSocket events keep you informed:
- Job status changes
- Live finding discoveries
- Progress tracking per tool
- Human approval requests (tier2/tier3)

### 4. **Safety Built-In**
- Respects program scope (excludedDomains)
- Enforces rate limits (150 req/s)
- Requires approval for tier2/tier3 templates
- Audit logs all actions

---

## Running the Test

### Option 1: Against Local API
```bash
# Start services
cd infrastructure/docker
docker-compose up -d

# Wait for services to be ready
sleep 10

# Run test script
cd ../..
chmod +x test-job-workflow.sh
./test-job-workflow.sh
```

### Option 2: Against Production API
```bash
# Edit test-job-workflow.sh
# Change: API_URL="http://165.227.108.120:3000"

chmod +x test-job-workflow.sh
./test-job-workflow.sh
```

### Option 3: Manual cURL Commands
```bash
# 1. Create program
PROGRAM_ID=$(curl -s -X POST http://localhost:3000/api/v1/programs \
  -H "Content-Type: application/json" \
  -d @sample-program.json | jq -r '.id')

echo "Program ID: $PROGRAM_ID"

# 2. Trigger discovery
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"discovery\",
    \"program_id\": \"$PROGRAM_ID\",
    \"priority\": 8,
    \"options\": {
      \"sources\": [\"chaosdb\", \"subfinder\"],
      \"maxAssets\": 10000
    }
  }"

# 3. Monitor all jobs
watch -n 5 "curl -s http://localhost:3000/api/v1/jobs?program_id=$PROGRAM_ID | jq '.jobs[] | {type, status}'"

# 4. Check findings
curl -s http://localhost:3000/api/v1/programs/$PROGRAM_ID/findings | jq '.findings[] | {severity, title, confidence}'
```

---

## Troubleshooting

### No Auto-Triggered Jobs?
**Check auto-orchestrator logs:**
```bash
docker logs agenthunt-workers-1 | grep "auto-orchestrator"
```

### Jobs Stuck in Pending?
**Check worker status:**
```bash
curl http://localhost:3000/api/v1/jobs/stats/queues
```

### Findings Not Being Triaged?
**Check AI provider status:**
```bash
curl http://localhost:3000/health | jq '.ai_providers'
```

---

## Conclusion

AgentHunt's auto-orchestration system demonstrates true **"fire and forget"** automation:

1. **Trigger once** (discovery job)
2. **Walk away** (system handles everything)
3. **Return to findings** (18-20 minutes later)

The system intelligently chains ~150+ jobs with **zero manual intervention**, discovering and triaging 50+ vulnerabilities fully automatically.

**This is how AgentHunt is supposed to work.** 🎯
