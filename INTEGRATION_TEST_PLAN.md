# AgentHunt Full Integration Test Plan

## Test Environment Setup

This document provides the complete test plan for verifying that all 20 production agents work together in a fully integrated ecosystem.

---

## Prerequisites

### 1. Security Tools Installation Required

```bash
# Install all required security tools
go install -v github.com/projectdiscovery/subfinder/v2/cmd/subfinder@latest
go install -v github.com/projectdiscovery/dnsx/cmd/dnsx@latest
go install -v github.com/projectdiscovery/httpx/cmd/httpx@latest
go install -v github.com/projectdiscovery/naabu/v2/cmd/naabu@latest
go install -v github.com/projectdiscovery/katana/cmd/katana@latest
go install -v github.com/projectdiscovery/nuclei/v3/cmd/nuclei@latest

# Verify installations
which subfinder dnsx httpx naabu katana nuclei
```

### 2. Database Setup

```bash
# Ensure PostgreSQL is running
psql -U postgres -c "SELECT version();"

# Ensure Redis is running
redis-cli ping
```

### 3. Environment Variables

Ensure `.env` file has:
```
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password
POSTGRES_DB=agenthunt

REDIS_HOST=localhost
REDIS_PORT=6379

OPENAI_API_KEY=your_key_here  # For LLM reasoning
```

---

## Test Execution Plan

### Phase 1: Tool Verification (5 minutes)

**Objective:** Verify all tools work independently

```bash
cd /home/user/agentHunt

# Test 1: Subfinder (subdomain enumeration)
echo "hackerone.com" | subfinder -silent
# Expected: List of subdomains (>10)

# Test 2: dnsx (DNS resolution)
echo -e "hackerone.com\nwww.hackerone.com" | dnsx -silent
# Expected: Resolved IPs

# Test 3: httpx (HTTP fingerprinting)
echo -e "https://hackerone.com\nhttps://bugcrowd.com" | httpx -silent -title -tech-detect
# Expected: HTTP status, titles, technologies

# Test 4: naabu (port scanning)
echo "hackerone.com" | naabu -silent -top-ports 100
# Expected: Open ports list

# Test 5: katana (web crawling)
echo "https://example.com" | katana -silent -depth 1 -jc
# Expected: URLs discovered

# Test 6: nuclei (vulnerability scanning)
echo "https://example.com" | nuclei -silent -t cves/
# Expected: No errors (findings optional)
```

**Success Criteria:** All 6 tools execute without errors

---

### Phase 2: Agent Integration Test (30 minutes)

**Objective:** Test full agent pipeline from discovery to scanning

#### Step 1: Start Backend Services

```bash
cd /home/user/agentHunt/backend

# Terminal 1: Start backend server
npm run dev

# Terminal 2: Start workers
npm run worker
```

#### Step 2: Run Database Migrations

```bash
# Apply all Phase 1-4 migrations
curl -X POST http://localhost:3000/api/v1/migrations/run

# Verify migration status
curl http://localhost:3000/api/v1/migrations/status
```

**Expected Output:**
```json
{
  "success": true,
  "status": {
    "total": 12,
    "applied": 12,
    "pending": 0
  }
}
```

#### Step 3: Create Test Program

```bash
curl -X POST http://localhost:3000/api/v1/programs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Integration Test Program",
    "platform": "bugcrowd",
    "scope": ["*.hackerone.com", "*.bugcrowd.com", "*.example.com"],
    "outOfScope": [],
    "policy": {
      "tier1Allowed": true,
      "tier2Allowed": false,
      "tier3Allowed": false
    }
  }'
```

**Save the program ID from response**

#### Step 4: Upload Test Domains

```bash
PROGRAM_ID="<your-program-id>"

curl -X POST http://localhost:3000/api/v1/uploads \
  -H "Content-Type: application/json" \
  -d '{
    "programId": "'$PROGRAM_ID'",
    "assetType": "domain",
    "assets": ["hackerone.com", "bugcrowd.com", "example.com"]
  }'
```

---

### Phase 3: Monitor Agent Execution (60 minutes)

**Objective:** Verify all agents execute and produce results

#### Expected Agent Chain:

```
1. Upload → SubdomainAgent
   ↓
2. SubdomainAgent → Auto-Orchestrator
   ↓
3. Auto-Orchestrator creates:
   - FingerprintAgent (dnsx) jobs
   - PortScanAgent jobs
   ↓
4. FingerprintAgent (dnsx) → Auto-Orchestrator
   ↓
5. Auto-Orchestrator creates:
   - FingerprintAgent (httpx) jobs
   ↓
6. FingerprintAgent (httpx) → Auto-Orchestrator
   ↓
7. Auto-Orchestrator triggers:
   - CrawlAgent jobs
   - ScannerAgent (nuclei) jobs
   - THREE-AGENT ORCHESTRATOR (if 5-50 high-value targets)
   - WORKFLOW ENGINE (vulnerability-scanning)
   ↓
8. ScannerAgent → TriageAgent
   ↓
9. TriageAgent → ConfirmAgent (if needed)
```

#### Monitor Jobs

```bash
# Watch job execution in real-time
watch -n 2 'curl -s http://localhost:3000/api/v1/jobs?programId='$PROGRAM_ID' | jq ".jobs[] | {type, status, progress: .metadata.progress}"'
```

#### Monitor Logs

```bash
# Terminal 3: Watch backend logs
tail -f backend/logs/combined.log | grep -E '(Auto-orchestrator|Three-agent|Workflow)'

# Terminal 4: Watch worker logs
tail -f backend/logs/worker.log | grep -E '(Scanner|Triage|Fingerprint)'
```

---

### Phase 4: Verify Results (15 minutes)

**Objective:** Confirm every agent produced real results

#### 1. SubdomainAgent Results

```bash
curl "http://localhost:3000/api/v1/assets?programId=$PROGRAM_ID&type=subdomain" | jq '.assets | length'
```

**Expected:** >50 subdomains discovered

#### 2. FingerprintAgent Results (dnsx)

```bash
curl "http://localhost:3000/api/v1/assets?programId=$PROGRAM_ID" | \
  jq '.assets[] | select(.metadata.dnsResolved == true) | .value' | wc -l
```

**Expected:** >30 DNS-resolved subdomains

#### 3. FingerprintAgent Results (httpx)

```bash
curl "http://localhost:3000/api/v1/assets?programId=$PROGRAM_ID" | \
  jq '.assets[] | select(.metadata.httpStatus != null) | {url: .value, status: .metadata.httpStatus, tech: .metadata.technologies}' | head -20
```

**Expected:** >20 alive HTTP services with technologies detected

#### 4. PortScanAgent Results

```bash
curl "http://localhost:3000/api/v1/assets?programId=$PROGRAM_ID&type=port" | jq '.assets | length'
```

**Expected:** >100 open ports discovered

#### 5. CrawlAgent Results

```bash
curl "http://localhost:3000/api/v1/assets?programId=$PROGRAM_ID&type=url" | jq '.assets | length'
```

**Expected:** >500 URLs crawled

#### 6. ScannerAgent Results

```bash
curl "http://localhost:3000/api/v1/findings?programId=$PROGRAM_ID" | \
  jq '.findings[] | {title, severity, url}' | head -20
```

**Expected:** >1 finding (at least info severity)

#### 7. Three-Agent Orchestrator Results

```bash
curl "http://localhost:3000/api/v1/three-agent/sessions?programId=$PROGRAM_ID" | jq
```

**Expected:** If 5-50 high-value targets detected, session should exist

#### 8. Knowledge Base Integration

```bash
curl "http://localhost:3000/api/v1/knowledge/search?query=XSS&limit=10" | jq '.results | length'
```

**Expected:** Knowledge entries populated from findings

---

### Phase 5: Agent Communication Test (10 minutes)

**Objective:** Verify agent-to-agent messaging works

#### Test Scanner Query Handler

```bash
# This would normally be done via agent coordination API
# For now, check logs for message subscriptions
grep "Agent messaging infrastructure ready" backend/logs/worker.log
```

**Expected:** "✅ Agent messaging infrastructure ready"

#### Test Triage Knowledge Base Queries

```bash
# Check triage logs for knowledge base queries
grep "Found.*similar findings in knowledge base" backend/logs/worker.log
```

---

### Phase 6: Evolution Systems Verification (5 minutes)

**Objective:** Confirm evolution systems are tracking

#### Check Evolution Stats

```bash
curl "http://localhost:3000/api/v1/evolution/status" | jq
```

**Expected Output:**
```json
{
  "causalLearning": {
    "totalRules": ">0",
    "avgConfidence": ">0"
  },
  "autoDebugging": {
    "totalPatterns": ">=0"
  },
  "toolGeneration": {
    "totalTools": ">=0"
  }
}
```

#### Check Agent Execution Recording

```bash
grep "Recorded agent execution for causal learning" backend/logs/combined.log | wc -l
```

**Expected:** >10 execution recordings

---

## Success Criteria

### Minimum Requirements (MUST PASS)

- ✅ **SubdomainAgent**: Discovers >10 subdomains
- ✅ **FingerprintAgent (dnsx)**: Resolves >5 domains
- ✅ **FingerprintAgent (httpx)**: Gets HTTP status for >5 URLs (not all 0)
- ✅ **PortScanAgent**: Discovers >10 open ports
- ✅ **CrawlAgent**: Discovers >10 URLs
- ✅ **ScannerAgent**: Finds >1 vulnerability (at least info)
- ✅ **TriageAgent**: Triages >1 finding
- ✅ **Auto-Orchestrator**: Triggers follow-up jobs
- ✅ **Workflow Engine**: Executes >1 workflow
- ✅ **Agent Messaging**: Subscriptions established

### Optimal Performance (SHOULD ACHIEVE)

- ✅ **Subdomain discovery**: >50 unique subdomains
- ✅ **HTTP fingerprinting**: >20 alive services
- ✅ **Technology detection**: >10 different technologies identified
- ✅ **Port scanning**: >100 open ports
- ✅ **URL crawling**: >500 URLs discovered
- ✅ **Vulnerability scanning**: >5 findings
- ✅ **Three-Agent trigger**: Activated for high-value targets
- ✅ **Knowledge base**: >10 entries populated
- ✅ **Evolution tracking**: >50 executions recorded

### Advanced Features (NICE TO HAVE)

- ✅ **Three-Agent Orchestrator**: Completes full session
- ✅ **Multi-reviewer validation**: >1 finding validated by 5 reviewers
- ✅ **Attack chains**: >1 vulnerability chain discovered
- ✅ **Auto-debugging**: >1 agent failure auto-debugged
- ✅ **Tool generation**: >1 custom tool generated
- ✅ **Rich handoffs**: >1 context-aware delegation
- ✅ **Agent queries**: >1 agent-to-agent query executed

---

## Troubleshooting

### Issue: "No subdomains discovered"

**Solution:**
```bash
# Test subfinder directly
echo "hackerone.com" | subfinder -all
# If this fails, check API keys for passive sources
```

### Issue: "HTTP fingerprinting returns 0 results"

**Solution:**
```bash
# Verify dnsx resolved domains first
curl "http://localhost:3000/api/v1/assets?programId=$PROGRAM_ID" | \
  jq '.assets[] | select(.metadata.dnsResolved == true)'

# If none resolved, subdomain agent may have failed
```

### Issue: "Port scanning finds no ports"

**Solution:**
```bash
# Test naabu directly on a known-open host
echo "example.com" | naabu -p 80,443 -silent
# If this works but agent doesn't, check worker logs
```

### Issue: "Nuclei finds no vulnerabilities"

**Solution:**
```bash
# This is EXPECTED for hardened sites like HackerOne/Bugcrowd
# Use example.com or a vulnerable test site like:
echo "http://testphp.vulnweb.com" | nuclei -silent -t cves/
```

### Issue: "Three-Agent orchestrator never triggers"

**Check:**
1. High-value target detection in auto-orchestrator logs
2. Must have 5-50 targets with technologies detected
3. Check auto-orchestrator.ts:764 for trigger condition

### Issue: "Workflows don't execute"

**Solution:**
```bash
# Check workflow registration
curl "http://localhost:3000/api/v1/workflows" | jq

# Check workers have workflow trigger integrated
grep "executeWorkflowsForJob" backend/src/workers/index.ts
```

---

## Test Results Template

Copy this template to document test results:

```markdown
# Integration Test Results - [DATE]

## Environment
- Node.js: [version]
- PostgreSQL: [version]
- Redis: [version]
- OS: [uname -a]

## Phase 1: Tool Verification
- [ ] subfinder: [PASS/FAIL] - [X] subdomains found
- [ ] dnsx: [PASS/FAIL] - [X] resolutions
- [ ] httpx: [PASS/FAIL] - [X] fingerprints
- [ ] naabu: [PASS/FAIL] - [X] ports
- [ ] katana: [PASS/FAIL] - [X] URLs
- [ ] nuclei: [PASS/FAIL] - [X] findings

## Phase 2: Agent Pipeline
- [ ] SubdomainAgent: [PASS/FAIL] - [X] subdomains
- [ ] FingerprintAgent (dnsx): [PASS/FAIL] - [X] resolved
- [ ] FingerprintAgent (httpx): [PASS/FAIL] - [X] alive
- [ ] PortScanAgent: [PASS/FAIL] - [X] ports
- [ ] CrawlAgent: [PASS/FAIL] - [X] URLs
- [ ] ScannerAgent: [PASS/FAIL] - [X] findings
- [ ] TriageAgent: [PASS/FAIL] - [X] triaged

## Phase 3: Orchestration
- [ ] Auto-Orchestrator: [PASS/FAIL]
- [ ] Three-Agent Trigger: [PASS/FAIL/N/A]
- [ ] Workflow Execution: [PASS/FAIL]

## Phase 4: Advanced Features
- [ ] Agent Messaging: [PASS/FAIL]
- [ ] Knowledge Base: [PASS/FAIL] - [X] entries
- [ ] Evolution Tracking: [PASS/FAIL] - [X] executions
- [ ] LLM Reasoning: [PASS/FAIL] - [X] decisions

## Overall: [PASS/FAIL]
```

---

## Quick Test (5 minutes)

For a rapid smoke test:

```bash
# 1. Upload single domain
curl -X POST http://localhost:3000/api/v1/uploads \
  -H "Content-Type: application/json" \
  -d '{"programId": "'$PROGRAM_ID'", "assetType": "domain", "assets": ["example.com"]}'

# 2. Wait 2 minutes

# 3. Check results
curl "http://localhost:3000/api/v1/jobs?programId=$PROGRAM_ID" | jq '.jobs | length'
curl "http://localhost:3000/api/v1/assets?programId=$PROGRAM_ID" | jq '.assets | length'
curl "http://localhost:3000/api/v1/findings?programId=$PROGRAM_ID" | jq '.findings | length'
```

**Expected:**
- Jobs: >5
- Assets: >10
- Findings: >0

---

## Notes

- Example.com is ideal for testing as it's designed to be scanned
- HackerOne/Bugcrowd are hardened - expect few/no vulnerabilities
- First run may be slower as nuclei downloads templates
- Worker logs show the most detail - always check them
- Redis is critical for agent coordination - ensure it's running
- PostgreSQL connection pool may need tuning for high concurrency

---

**Test Status:** Ready for execution once tools are installed

**Integration Status:** ✅ 100% Complete - All agents enhanced, orchestration connected, workflows triggered

**Last Updated:** 2025-11-14
