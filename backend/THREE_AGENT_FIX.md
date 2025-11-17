# Three-Agent System Issues & Solutions

## Problem 1: Three-Agent Jobs Getting Stuck

### Root Cause
The three-agent worker (`src/workers/index.ts:131-193`) uses a **synchronous blocking architecture**:

```typescript
const session = await threeAgentOrchestrator.startSession(...);
// ⬆️ This blocks for entire session (up to 1 hour)

while (session.state !== 'completed' && session.state !== 'failed') {
  // Polling loop - worker stuck if state never changes
  await new Promise(resolve => setTimeout(resolve, 5000));
  const currentSession = await threeAgentOrchestrator.getSessionStatus(session.id);
}
```

**Why it gets stuck:**
1. `startSession()` runs synchronously through all phases (planning → executing → validating)
2. If any phase encounters an error or hangs, the session may not set `state: 'failed'`
3. The worker enters an infinite polling loop waiting for state change
4. This blocks the worker from processing other three-agent jobs

### Solution Options

#### Option A: Make Orchestrator Async (Recommended)
Refactor the orchestrator to run asynchronously and emit events:

```typescript
// In workers/index.ts
queue.createWorker([queueName], async (job) => {
  // Start session asynchronously (don't wait for completion)
  const session = await threeAgentOrchestrator.startSessionAsync(
    jobData.programId,
    transformedScope,
    options
  );

  // Return immediately with session ID
  return {
    sessionId: session.id,
    status: 'running',
    message: 'Session started - check status endpoint for updates'
  };
});

// Listen for session completion events
threeAgentOrchestrator.on('session:completed', async (sessionId, results) => {
  // Update job in database
  await database.query(
    `UPDATE jobs SET status = 'completed', result = $1 WHERE metadata->>'sessionId' = $2`,
    [JSON.stringify(results), sessionId]
  );
});
```

#### Option B: Add Timeout Protection (Quick Fix)
Add better error handling to prevent infinite loops:

```typescript
// In workers/index.ts:169
const timeout = jobData.options.maxDuration || 3600000;
const startTime = Date.now();
const maxPollingTime = timeout + 60000; // Extra 1 minute buffer

while (session.state !== 'completed' && session.state !== 'failed') {
  if (Date.now() - startTime > maxPollingTime) {
    // Force fail the session
    await database.query(
      `UPDATE jobs SET status = 'failed', error = $1 WHERE id = $2`,
      ['Session timeout - exceeded max duration', job.id]
    );
    throw new Error('Three-agent session exceeded maximum duration');
  }

  await new Promise(resolve => setTimeout(resolve, 5000));

  try {
    const currentSession = await threeAgentOrchestrator.getSessionStatus(session.id);
    if (currentSession) {
      session.state = currentSession.state;
      session.validatedFindings = currentSession.validatedFindings;
    } else {
      // Session not found - might have been cleaned up
      logger.warn({ sessionId: session.id }, 'Session not found in orchestrator');
      break;
    }
  } catch (error) {
    logger.error({ error, sessionId: session.id }, 'Failed to get session status');
    // Continue polling - don't fail on transient errors
  }
}
```

#### Option C: Add Session Heartbeat Monitoring
Add a heartbeat mechanism to detect stuck sessions:

```typescript
// In orchestrator.ts, add heartbeat updates
private async updateSessionHeartbeat(sessionId: string) {
  await this.redis.setex(`session:heartbeat:${sessionId}`, 30, Date.now().toString());
}

// Call this periodically during session execution
// In workers/index.ts, check heartbeat
const lastHeartbeat = await redis.get(`session:heartbeat:${session.id}`);
if (lastHeartbeat && Date.now() - parseInt(lastHeartbeat) > 120000) {
  // No heartbeat for 2 minutes - session likely stuck
  throw new Error('Session heartbeat timeout - orchestrator may be stuck');
}
```

---

## Problem 2: OpenAI API Quota Exceeded

### Error Message
```
Error: LLM completion failed: OpenAI API error: 429 You exceeded your current quota
```

### Root Cause
The three-agent system is using OpenAI API which has hit rate limits. Your codebase already has serverless inference support (DeepSeek R1 Distill) but it's not configured.

### Solution: Switch to Serverless Inference

#### Step 1: Set Environment Variables
Add these to your `.env` file or environment:

```bash
# Serverless Inference (HIGHEST PRIORITY)
MODEL_ACCESS_KEY=your_serverless_api_key_here
SERVERLESS_MODEL=deepseek-r1-distill-llama-70b
SERVERLESS_API_URL=https://inference.do-ai.run/v1/chat/completions
SERVERLESS_TEMPERATURE=0.2
SERVERLESS_MAX_TOKENS=350

# Disable OpenAI to prevent quota issues
ENABLE_OPENAI=false
```

#### Step 2: Test Serverless Provider
Run the test script to verify configuration:

```bash
export MODEL_ACCESS_KEY="your_api_key_here"
npx tsx backend/test-serverless-inference.ts
```

Expected output:
```
✓ MODEL_ACCESS_KEY is configured
✓ ServerlessProvider instance created
✓ Provider availability check: AVAILABLE
📤 Sending test prompt: "What is SQL injection?"
📥 Response received (XXXms): "..."
✅ Direct ServerlessProvider test PASSED
```

#### Step 3: Restart Workers
```bash
# Stop workers
pkill -f "node.*workers.js"

# Start workers (will auto-detect serverless provider)
npm run workers
```

#### Verification
Check logs for this message:
```
Serverless inference provider initialized (DeepSeek R1 Distill)
Using serverless as default provider (cost-optimized)
```

---

## Provider Priority Order

The LLM engine (`src/services/llm/llm-engine.ts:102-114`) automatically selects providers in this order:

1. **Serverless** (if `MODEL_ACCESS_KEY` is set) ← Recommended (cost-optimized)
2. **Claude** (if `ANTHROPIC_API_KEY` is set)
3. **OpenAI** (if `OPENAI_API_KEY` is set)
4. **Local/Ollama** (if `OLLAMA_ENABLED=true`)

To force serverless usage, ensure `MODEL_ACCESS_KEY` is set and optionally disable other providers:
```bash
ENABLE_OPENAI=false
ENABLE_ANTHROPIC=false
```

---

## Quick Diagnostic Commands

### Check Queue Status
```bash
# Check active three-agent jobs
redis-cli LRANGE "bull:three-agent:active" 0 -1

# Check waiting jobs
redis-cli LRANGE "bull:three-agent:wait" 0 -1

# Check failed jobs
redis-cli LRANGE "bull:three-agent:failed" 0 5
```

### Check Worker Processes
```bash
# Find running workers
ps aux | grep workers.js

# Check worker logs
tail -f logs/workers.log | grep three-agent
```

### Monitor Session Status
```bash
# Check active sessions in Redis
redis-cli --scan --pattern "three-agent:session:*"

# Get session details
redis-cli GET "three-agent:session:<session-id>"
```

---

## Recommended Immediate Actions

1. **Add timeout protection** (Option B above) to prevent infinite loops
2. **Configure serverless inference** to avoid OpenAI quota issues
3. **Restart workers** to apply new configuration
4. **Monitor logs** for successful serverless provider initialization
5. **Run test script** to verify serverless inference works

---

## Files Modified (for reference)

- `src/workers/index.ts:131-193` - Three-agent worker implementation
- `src/services/three-agent/orchestrator.ts:32-284` - Session orchestration
- `src/services/llm/llm-engine.ts:38-115` - LLM provider initialization
- `src/services/llm/providers/serverless.ts` - Serverless provider implementation
