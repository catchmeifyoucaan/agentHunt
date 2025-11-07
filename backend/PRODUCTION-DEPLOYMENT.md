# Production Deployment Fix Guide

## Current Issues

Your production server at `/opt/agenthunt/backend` is experiencing:

1. **Missing Dependencies**: The `bullmq` module and other dependencies are not installed
2. **Database Authentication Error**: PostgreSQL connection failing with error code 28000 (authentication failed)

## Root Cause

When you pulled the latest changes, the code was updated but:
- Dependencies were not installed (`npm install` was not run)
- Environment variables may not be correctly configured for Digital Ocean managed databases

## Quick Fix

Run these commands on your production server at `/opt/agenthunt/backend`:

```bash
# 1. Navigate to backend directory
cd /opt/agenthunt/backend

# 2. Pull latest changes (you already did this)
git pull origin claude/agent-orchestration-full-spec-011CUrbUhn2v28Amnbs5b8Qu

# 3. Run the fix script
bash fix-production.sh

# 4. If successful, restart PM2
pm2 restart all

# 5. Check logs
pm2 logs --lines 50
```

## Manual Fix (if script fails)

### Step 1: Install Dependencies

```bash
cd /opt/agenthunt/backend
npm install
```

### Step 2: Verify .env Configuration

Ensure your `.env` file has these critical settings:

```bash
# Database - Digital Ocean Managed PostgreSQL
POSTGRES_HOST=your-actual-db-host.db.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=your-actual-password
POSTGRES_DB=agenthunt
POSTGRES_SSL=true

# Redis - Digital Ocean Managed Redis
REDIS_HOST=your-actual-redis-host.db.ondigitalocean.com
REDIS_PORT=25061
REDIS_PASSWORD=your-actual-redis-password
REDIS_TLS=true
```

**Important**: Replace placeholder values with your actual credentials!

### Step 3: Test Database Connection

```bash
npx tsx -e "
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB,
  ssl: { rejectUnauthorized: false }
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Failed:', err.message);
    process.exit(1);
  }
  console.log('Success! Connected at:', res.rows[0].now);
  pool.end();
});
"
```

### Step 4: Rebuild Application

```bash
npm run build
```

### Step 5: Run Migrations (if needed)

```bash
npx tsx src/migrate.ts
```

### Step 6: Restart Services

```bash
pm2 restart all
pm2 logs --lines 50
```

## Common Errors and Solutions

### Error: "getaddrinfo ENOTFOUND your-redis-host-from-step-3.ondigitalocean.com"

This means you still have placeholder values in your `.env` file. Update:
```bash
REDIS_HOST=your-actual-redis-host.db.ondigitalocean.com
```

### Error: Database authentication failed (code 28000)

Check these in your `.env`:
- `POSTGRES_USER` should be `doadmin` for Digital Ocean managed databases
- `POSTGRES_PASSWORD` should be your actual database password
- `POSTGRES_SSL` must be set to `true` for managed databases
- `POSTGRES_PORT` is typically `25060` for DO managed PostgreSQL

### Error: "Cannot find module 'bullmq'"

Run:
```bash
cd /opt/agenthunt/backend
npm install
```

### Redis version warning (6.0.16, recommended 6.2.0)

This is just a warning. Digital Ocean's managed Redis 6.0.16 will work, but consider upgrading your Redis cluster in Digital Ocean control panel if you encounter issues.

## Verification

After fixing, you should see:

```bash
pm2 list
```

All processes should show `status: online` without constant restarts.

```bash
pm2 logs --lines 20
```

Should show no errors like:
- ✅ "Database connection successful"
- ✅ "Storage service initialized"
- ✅ "AIService initialized"
- ✅ "Queue created" (for all queues)

## Getting Your Database Credentials

If you don't have your Digital Ocean database credentials:

1. Log into Digital Ocean dashboard
2. Go to "Databases"
3. Click on your PostgreSQL cluster
4. Click "Connection Details"
5. Select "Connection Parameters" view
6. Copy the values for host, port, username, password

Do the same for your Redis cluster.

## Need Help?

Check the logs for specific errors:
```bash
pm2 logs api-error --lines 50
pm2 logs workers-error --lines 50
```

The errors will tell you exactly which environment variable or connection is misconfigured.
