# 🧪 Testing Guide - Rich Handoff Workflows

This document describes the testing infrastructure for validating all **27 universal rich handoff workflows** in agentHunt.

## 📊 Test Coverage

### Rich Handoff Workflows (27 Total)

```
DISCOVERY PHASE (3 handoffs)
├── Subdomain → Discovery (passive enumeration → alive validation)
├── Bruteforce → Discovery (active DNS bruteforce → alive validation)
└── Portscan → Scanner (open ports → infrastructure vulnerability scan)

ASSET MAPPING (4 handoffs)
├── Discovery → Fingerprint (alive assets → technology identification)
├── Discovery → Crawl (web services → URL discovery)
├── Fingerprint → Scanner (tech stack → targeted vulnerability scan)
└── Crawl → XSS (discovered URLs → XSS vulnerability scan)

INTELLIGENCE GATHERING (2 handoffs)
├── OSINT → Triage (leaked credentials/secrets → AI triage)
└── Cloudmisconfig → Triage (exposed cloud storage → risk assessment)

VULNERABILITY SCANNING (9 handoffs)
├── Scanner → XSS (general scan → XSS-focused scan)
├── Scanner → SQLi (database detection → SQL injection scan)
├── Scanner → SSRF (external interaction → SSRF exploitation)
├── Scanner → Webvulns (web app → comprehensive web vulns)
├── Crawl → SQLi (database forms → SQL injection testing)
├── Crawl → SSRF (URL parameters → SSRF testing)
├── Crawl → Apifuzz (API endpoints → API fuzzing)
├── XSS → Confirm (XSS findings → multi-method confirmation)
└── SQLi → Confirm (SQLi findings → database exploitation validation)

ADVANCED EXPLOITATION (3 handoffs)
├── SSRF → Confirm (SSRF findings → OOB confirmation)
├── Webvulns → Confirm (web vulnerabilities → exploit validation)
└── Apifuzz → Confirm (API vulnerabilities → auth/authz bypass testing)

VALIDATION & REPORTING (5 handoffs)
├── Browser → Intelligent-Triage (XSS/CSRF with video → PoC generation)
├── Interact → Intelligent-Triage (OOB-confirmed blind vulns → exploit chain)
├── Triage → Confirm (high-confidence findings → final validation)
├── Confirm → Browser (confirmed XSS → browser video proof)
└── Intelligent-Triage → Confirm (AI-triaged findings → final confirmation)
```

## 🚀 Quick Start

### Prerequisites

```bash
# Ensure backend is running
npm run dev

# In another terminal, verify server health
curl http://localhost:3000/health
```

### Running Tests

#### Option 1: Quick Test (8 Key Handoffs - ~5 minutes)

Fast validation of core rich handoff workflows:

```bash
cd backend
./test-rich-handoffs-quick.sh
```

**Coverage:**
- Subdomain → Discovery
- Bruteforce → Discovery
- Discovery → Fingerprint
- Discovery → Crawl
- Crawl → XSS
- Portscan → Scanner
- OSINT → Triage
- Cloudmisconfig → Triage

#### Option 2: Comprehensive Test (All 27 Handoffs - ~30 minutes)

Full validation of all rich handoff workflows:

```bash
cd backend
npx ts-node test-rich-handoffs-comprehensive.ts
```

**Test Domains:**
- `example.com` (stable, reliable test target)
- `bugcrowd.com` (real bug bounty platform)

#### Option 3: Full E2E Test (Legacy)

Comprehensive end-to-end system test:

```bash
cd backend
npx ts-node test-full-workflow.ts
```

## 📝 Test Output Examples

### Successful Handoff

```
========================================================================
  Test 1: Subdomain → Discovery
========================================================================

ℹ️  Testing: subdomain → discovery
ℹ️  Description: Passive subdomain enumeration → HTTP/HTTPS probing
ℹ️  Job created: abc-123-def
✅ Job completed
✅ Handoff to discovery created! ✨
```

### Skipped Handoff (Expected)

```
⚠️  No handoff to discovery detected (may be 0 results)
```

This is expected when:
- Source agent found 0 results (e.g., no subdomains discovered)
- Handoff trigger conditions not met (e.g., confidence threshold)
- Backend running in stub/mock mode

## 🎯 Interpreting Results

### Test Summary

```
📊 TEST SUMMARY
ℹ️  Total tests: 27
✅ Passed: 22 (81.5%)
⚠️  Failed/Skipped: 5 (18.5%)
```

### Pass Rate Guidelines

| Pass Rate | Status | Action Required |
|-----------|--------|-----------------|
| **90-100%** | ✅ Excellent | All handoffs working correctly |
| **70-89%** | 🟡 Good | Some agents finding 0 results (expected with test domains) |
| **50-69%** | 🟠 Fair | Check agent configurations and handoff trigger conditions |
| **< 50%** | 🔴 Poor | Investigate backend issues, BullMQ queues, or agent implementations |

### Common Reasons for Skipped Handoffs

1. **0 Results**: Source agent found nothing to hand off
   - Example: Subdomain enumeration found 0 subdomains
   - Example: XSS scanner found 0 vulnerabilities on example.com

2. **Threshold Not Met**: Handoff trigger conditions not satisfied
   - Example: Findings have < 0.8 confidence score
   - Example: Less than minimum required assets

3. **Mock Mode**: Backend running with stubbed agents
   - All jobs complete instantly with mock data
   - No real tool execution

## 🔍 Debugging Handoffs

### Check Job Queue

```bash
# View all jobs for a program
curl http://localhost:3000/api/v1/jobs?programId=<program-id>

# View specific job details
curl http://localhost:3000/api/v1/jobs/<job-id>

# Check for handoff jobs created by parent
curl http://localhost:3000/api/v1/jobs?parentJobId=<parent-job-id>
```

### Check BullMQ Queues

```bash
# Connect to Redis
redis-cli

# View pending jobs in queue
LRANGE bull:subdomain:wait 0 -1
LRANGE bull:discovery:wait 0 -1

# View active jobs
LRANGE bull:subdomain:active 0 -1

# View completed jobs
LRANGE bull:subdomain:completed 0 -1
```

### Check Agent Logs

```bash
# View logs for specific agent
tail -f backend/logs/subdomain.log
tail -f backend/logs/discovery.log

# Search for handoff creation
grep "🔗.*initiated rich handoff" backend/logs/*.log
grep "handoffToDiscovery" backend/logs/subdomain.log
```

## 🛠️ Writing Custom Handoff Tests

### Basic Template

```typescript
registerHandoffTest({
  name: 'SourceAgent → TargetAgent',
  phase: 'PHASE_NAME',
  sourceAgent: 'source-agent',
  targetAgent: 'target-agent',
  description: 'What this handoff does',
  testFn: async (programId: string) => {
    // 1. Create source agent job
    const sourceJob = await apiCall('POST', '/jobs', {
      type: 'source-agent',
      programId,
      options: {
        // Agent-specific options
      },
    });

    // 2. Wait for completion
    const result = await waitForJob(sourceJob.data.id);

    // 3. Check for handoff creation
    const handoff = await checkHandoffCreated(
      sourceJob.data.id,
      'target-agent'
    );

    return handoff.created;
  },
});
```

## 📈 Improving Test Coverage

### Use Real Targets

For better test coverage, use targets with known characteristics:

```bash
# Example: Test with targets known to have vulnerabilities
export TEST_DOMAINS="testphp.vulnweb.com,xss-game.appspot.com"
./test-rich-handoffs-comprehensive.ts
```

### Increase Timeout

For slower networks or comprehensive scans:

```typescript
// In test script
const config = {
  timeout: 900000, // 15 minutes
  pollInterval: 5000,
};
```

### Run Subsets

Test specific phases:

```bash
# Edit test script to filter by phase
const phasesToTest = ['DISCOVERY', 'ASSET_MAPPING'];
const filteredTests = handoffTests.filter(t => phasesToTest.includes(t.phase));
```

## 🐛 Troubleshooting

### Issue: All Tests Fail

**Possible Causes:**
- Backend not running
- PostgreSQL not running
- Redis not running
- BullMQ workers not started

**Solution:**
```bash
# Check all services
docker-compose ps
npm run dev

# Verify connections
curl http://localhost:3000/health
redis-cli ping
psql -h localhost -U postgres -d agenthunt -c "SELECT 1"
```

### Issue: Jobs Timeout

**Possible Causes:**
- BullMQ workers not processing jobs
- Agent execution taking too long
- Network issues (external API calls)

**Solution:**
```bash
# Check worker logs
tail -f backend/logs/worker.log

# Check BullMQ queue status
redis-cli LLEN bull:subdomain:wait
redis-cli LLEN bull:subdomain:active

# Increase timeout in test
```

### Issue: Handoffs Not Created

**Possible Causes:**
- Handoff trigger conditions not met
- Source agent returned 0 results
- TypeScript errors in handoff implementation

**Solution:**
```bash
# Check agent implementation
grep -A 50 "handoffTo" backend/src/agents/subdomain.ts

# Check handoff creation logs
grep "createRichHandoff" backend/logs/*.log

# Verify job results
curl http://localhost:3000/api/v1/jobs/<job-id>/results
```

## 📚 References

- [README.md](../README.md) - Main project documentation
- [Architecture](../docs/ARCHITECTURE.md) - System architecture overview
- [Rich Handoff Implementation](../backend/src/agents/base.ts) - BaseAgent.createRichHandoff()
- [Agent Coordination](../backend/src/services/agent-coordination.ts) - Handoff processing

## 🎉 Success Criteria

A successful test run should demonstrate:

1. ✅ **Server Health**: Backend responsive
2. ✅ **Program Creation**: Test program created successfully
3. ✅ **Job Execution**: All source agent jobs complete
4. ✅ **Handoff Trigger**: Handoffs created when conditions met
5. ✅ **Context Preservation**: Handoff jobs contain parent context
6. ✅ **Queue Processing**: BullMQ processing handoff jobs
7. ✅ **Pass Rate**: ≥70% handoffs successfully triggered

---

**Last Updated**: 2025-11-16
**Test Suite Version**: 1.0.0
**Total Handoffs**: 27
