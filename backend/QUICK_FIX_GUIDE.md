# Quick Fix Guide for Three-Agent Issues

## 🚨 Issues Fixed

### 1. ✅ Three-Agent Worker Stuck (FIXED)
- **File Modified**: `src/workers/index.ts:165-222`
- **Fix**: Added better timeout protection and error handling to prevent infinite polling loops
- **Changes**:
  - Added 1-minute buffer to timeout
  - Added consecutive error tracking (fails after 5 errors)
  - Added detailed logging for timeout and errors
  - Handle cases where session is not found

### 2. ⚠️ OpenAI API Quota Exceeded (NEEDS CONFIGURATION)
- **Solution**: Switch to serverless inference (already supported in codebase)
- **Action Required**: Configure environment variables (see below)

---

## 🎯 Immediate Actions Required

### Step 1: Configure Serverless Inference

**Option A: Set environment variables directly**
```bash
export MODEL_ACCESS_KEY="your_serverless_api_key_here"
export SERVERLESS_MODEL="deepseek-r1-distill-llama-70b"
export SERVERLESS_API_URL="https://inference.do-ai.run/v1/chat/completions"
export ENABLE_OPENAI="false"
```

**Option B: Create/update .env file**
```bash
# Add these lines to backend/.env
MODEL_ACCESS_KEY=your_serverless_api_key_here
SERVERLESS_MODEL=deepseek-r1-distill-llama-70b
SERVERLESS_API_URL=https://inference.do-ai.run/v1/chat/completions
SERVERLESS_TEMPERATURE=0.2
SERVERLESS_MAX_TOKENS=350

# Disable OpenAI to prevent quota issues
ENABLE_OPENAI=false
# Or remove/comment out:
# OPENAI_API_KEY=
```

### Step 2: Restart Workers

```bash
# Kill existing workers
pkill -f "workers.js"

# Rebuild (already done, but run again to be safe)
npm run build

# Start workers with new configuration
npm run workers
```

### Step 3: Verify Configuration

**Check logs for successful initialization:**
```bash
# Should see these messages in logs:
# ✓ Serverless inference provider initialized (DeepSeek R1 Distill)
# ✓ Using serverless as default provider (cost-optimized)

# Check running workers
ps aux | grep workers.js
```

**Test serverless provider directly:**
```bash
export MODEL_ACCESS_KEY="your_api_key"
npx tsx backend/test-serverless-inference.ts
```

Expected output:
```
✓ MODEL_ACCESS_KEY is configured
✓ ServerlessProvider instance created
✓ Provider availability check: AVAILABLE
✅ Direct ServerlessProvider test PASSED
```

---

## 🔍 Verification

### Check Three-Agent Jobs Are Processing

```bash
# Monitor Redis queue
redis-cli LRANGE "bull:three-agent:active" 0 -1
redis-cli LRANGE "bull:three-agent:wait" 0 -1

# Check worker logs for three-agent processing
tail -f logs/workers.log | grep -i "three-agent\|serverless"
```

### Expected Behavior After Fix

1. **No more infinite loops** - Jobs will fail after maxDuration + 60s
2. **Better error messages** - Clear timeout and error logging
3. **No OpenAI quota errors** - Serverless provider used instead
4. **Session resilience** - Can recover from transient errors (up to 5 consecutive failures)

---

## 📊 Understanding the Fix

### Before (Problem)
```
Job → startSession() → BLOCKS for 1 hour
                    → If state never changes to 'completed'
                    → while loop runs FOREVER
                    → Worker stuck, can't process other jobs
```

### After (Fixed)
```
Job → startSession() → BLOCKS for 1 hour
                    → Poll status every 5s with error handling
                    → Track consecutive errors (max 5)
                    → Timeout after maxDuration + 60s
                    → Fail gracefully with detailed logs
                    → Worker released to process other jobs
```

### Timeout Protection Improvements

| Check | Before | After |
|-------|--------|-------|
| Basic timeout | ✅ Yes | ✅ Yes (with buffer) |
| Handle null session | ❌ No | ✅ Yes (with counter) |
| Handle status errors | ❌ No | ✅ Yes (try/catch) |
| Consecutive error limit | ❌ No | ✅ Yes (max 5) |
| Detailed logging | ⚠️ Basic | ✅ Comprehensive |
| Graceful failure | ❌ No | ✅ Yes |

---

## 🐛 Debugging

### If jobs still get stuck

1. **Check session state in orchestrator**
   ```bash
   redis-cli --scan --pattern "three-agent:session:*"
   redis-cli GET "three-agent:session:<session-id>"
   ```

2. **Check logs for timeout messages**
   ```bash
   grep "Three-agent session exceeded maximum duration" logs/workers.log
   grep "Failed to get session status" logs/workers.log
   ```

3. **Manually fail stuck jobs**
   ```bash
   redis-cli LRANGE "bull:three-agent:active" 0 -1
   # Copy job ID, then:
   redis-cli LREM "bull:three-agent:active" 1 "<job-id>"
   redis-cli LPUSH "bull:three-agent:failed" "<job-id>"
   ```

### If serverless inference fails

1. **Verify API key**
   ```bash
   echo $MODEL_ACCESS_KEY
   # Should not be empty
   ```

2. **Test endpoint directly**
   ```bash
   curl -X POST https://inference.do-ai.run/v1/chat/completions \
     -H "Authorization: Bearer $MODEL_ACCESS_KEY" \
     -H "Content-Type: application/json" \
     -d '{
       "model": "deepseek-r1-distill-llama-70b",
       "messages": [{"role": "user", "content": "test"}],
       "max_tokens": 10
     }'
   ```

3. **Check provider initialization logs**
   ```bash
   grep -i "serverless\|llm.*provider" logs/backend.log
   ```

---

## 📝 Summary of Changes

### Files Modified
- ✅ `src/workers/index.ts` - Better timeout and error handling
- ✅ Build verified (no TypeScript errors)
- 📄 `THREE_AGENT_FIX.md` - Detailed technical documentation
- 📄 `QUICK_FIX_GUIDE.md` - This file (step-by-step instructions)

### Environment Variables Needed
```bash
MODEL_ACCESS_KEY=your_serverless_api_key_here  # REQUIRED
ENABLE_OPENAI=false                             # RECOMMENDED
```

### Next Steps
1. ✅ Code fix applied
2. ⏳ Configure serverless inference (YOU ARE HERE)
3. ⏳ Restart workers
4. ⏳ Verify logs
5. ⏳ Test three-agent jobs

---

## 🆘 Need Help?

**Check detailed technical docs**: See `THREE_AGENT_FIX.md` for:
- In-depth analysis of the stuck issue
- Alternative solution options
- Advanced debugging techniques
- Session heartbeat monitoring approach

**Common Issues**:
- ❓ "Where do I get MODEL_ACCESS_KEY?" - Contact your serverless inference provider
- ❓ "Still seeing OpenAI errors" - Ensure `ENABLE_OPENAI=false` is set
- ❓ "Jobs failing after 1 hour" - This is expected if sessions take too long. Increase `maxDuration` in job options
- ❓ "Consecutive error limit hit" - Check orchestrator logs for why `getSessionStatus()` is failing
