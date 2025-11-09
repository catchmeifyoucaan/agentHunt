# Fix: Database Error and Live Terminal Issues

## Issues Identified

### 1. Missing `manager_commands` Table
**Error:** `relation "manager_commands" does not exist`

**Cause:** The database schema defined in `backend/src/models/database.sql` has not been applied to your DigitalOcean PostgreSQL database.

### 2. Live Terminal Shows No Logs
**Issue:** Terminal displays "No logs yet. Start a job to see real-time output." despite active jobs running.

**Causes:**
- Database connection failure prevents events from being persisted and retrieved
- Backend may not have been running (now fixed)
- WebSocket connection issues

## Current Status

✅ **Fixed:**
- Redis server is running
- Backend server is running with WebSocket support
- Workers are running (4 instances)

❌ **Needs Network Access:**
- Database initialization requires connection to DigitalOcean PostgreSQL

## Solutions

### Step 1: Initialize Database Schema

You have two options to initialize the database:

#### Option A: Using Node.js Script (Recommended)

From an environment with network access to DigitalOcean:

```bash
# Run the database initialization script
node scripts/init-db.js
```

This script will:
- Test database connection
- Apply the main schema from `backend/src/models/database.sql`
- Apply submissions schema if it exists
- Verify the `manager_commands` table was created
- List all tables in the database

#### Option B: Using psql Directly

If you have `psql` installed:

```bash
# Run the shell script
chmod +x init-database.sh
./init-database.sh
```

Or manually:

```bash
# Set connection string from .env
export DB_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=require"

# Apply main schema
psql "$DB_URL" -f backend/src/models/database.sql

# Apply submissions schema (if exists)
psql "$DB_URL" -f backend/src/models/submissions.sql

# Verify manager_commands table
psql "$DB_URL" -c "\d manager_commands"
```

### Step 2: Verify Services Are Running

```bash
# Check PM2 processes
pm2 list

# Should show:
# - agenthunt-backend: online
# - agenthunt-workers: online (4 instances)

# Check backend health
curl http://localhost:3000/health

# Should show:
# - database: "healthy" (after Step 1)
# - redis: "healthy"
# - queues: "healthy"
```

### Step 3: Restart Services After Database Init

Once the database schema is applied, restart all services to clear any cached connection errors:

```bash
pm2 restart all
```

### Step 4: Test the Manager Chat

Try sending a command through the UI:

```
"Start recovery for failed jobs"
```

This should now work without the `manager_commands` error.

### Step 5: Verify Live Terminal

1. Open the Live Terminal page in the UI
2. Trigger a new job (e.g., start a discovery scan)
3. You should now see real-time logs appearing in the terminal

The terminal displays events with `type: 'log'` that are emitted by workers and stored in the `events` table.

## How It Works

### Event Flow for Live Terminal

1. **Workers emit logs:**
   ```javascript
   events.emitLog({
     level: 'info',
     tool: 'subfinder',
     message: 'Found 10 subdomains',
     programId: '...',
     jobId: '...',
   });
   ```

2. **Events service:**
   - Saves log to `events` table in database
   - Broadcasts to WebSocket clients
   - Filters events by type

3. **Frontend terminal:**
   - Connects to WebSocket at `ws://localhost:3000/events`
   - Filters for `type === 'log'`
   - Displays in real-time terminal UI

### Manager Commands Flow

1. **User sends command** via chat UI
2. **Manager agent processes** the natural language command
3. **Saves to database:**
   ```sql
   INSERT INTO manager_commands (command, program_id, user_id, parsed_intent, response, executed_actions)
   ```
4. **Returns response** to user

## Troubleshooting

### Database Still Showing as Unhealthy

```bash
# Check database connection (using credentials from .env)
source .env
psql "postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=require" -c "SELECT 1"

# If connection fails, check:
# 1. Network connectivity
# 2. DigitalOcean firewall rules
# 3. Database credentials in .env
```

### Live Terminal Still Not Showing Logs

```bash
# 1. Check WebSocket connection in browser console
# Should see: "WebSocket connected"

# 2. Check if events are being emitted
psql "$DB_URL" -c "SELECT COUNT(*) FROM events WHERE type = 'log'"

# 3. Check backend logs
pm2 logs agenthunt-backend --lines 50

# 4. Restart frontend
cd frontend
npm run dev
```

### Workers Not Processing Jobs

```bash
# Check worker logs
pm2 logs agenthunt-workers --lines 100

# Check queue status
curl http://localhost:3000/health | jq '.services.queues'

# Requeue stuck jobs
curl -X POST http://localhost:3000/api/v1/jobs/requeue-stuck
```

## Files Created/Modified

- ✅ `scripts/init-db.js` - Database initialization script
- ✅ `init-database.sh` - Shell script for database setup
- ✅ Services started via PM2

## Next Steps

1. **Run database initialization** when you have network access
2. **Restart services** with `pm2 restart all`
3. **Test manager chat** with a simple command
4. **Verify live terminal** shows real-time logs
5. **Check active jobs** complete successfully

## Reference

- Database schema: `backend/src/models/database.sql:198-212` (manager_commands table)
- Events service: `backend/src/services/events.ts:107-132` (emitLog function)
- Manager agent: `backend/src/agents/manager.ts:105-117` (saves commands to DB)
- Terminal UI: `frontend/app/terminal/page.tsx:28-30` (filters log events)
- WebSocket hook: `frontend/hooks/useWebSocket.ts:80-105` (event streaming)

## Support

If issues persist after following these steps:
1. Check `pm2 logs` for detailed error messages
2. Verify database schema with `\dt` in psql
3. Test WebSocket connection in browser DevTools
4. Check firewall rules for DigitalOcean database
