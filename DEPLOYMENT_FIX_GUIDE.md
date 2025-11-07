# Deployment Fix Guide

This guide will help you fix the errors found in the error log and get your AgentHunt deployment running correctly.

## Summary of Fixes Made

1. ✅ Fixed PM2 script paths to match compiled TypeScript output structure
2. ✅ Added Redis TLS support for Digital Ocean managed Redis
3. ✅ Added .env file loading to PM2 configuration
4. ✅ Fixed module path issues in the build output

## What You Need to Do on Your Server

### Step 1: Update Your Server's .env File

SSH into your server and edit the .env file:

```bash
ssh root@your-server-ip
cd /opt/agenthunt
nano .env
```

**Critical: Fix these values in your .env file:**

```bash
# Redis Configuration (REQUIRED - Replace placeholder!)
# Get these from: Digital Ocean > Databases > Your Redis Cluster > Connection Details
REDIS_HOST=your-actual-redis-host.ondigitalocean.com  # NOT "your-redis-host-from-step-3"!
REDIS_PORT=25061  # Digital Ocean Redis default port
REDIS_PASSWORD=your_actual_redis_password
REDIS_TLS=true    # NEW: Enable TLS for managed Redis

# Database Configuration (Verify these are correct)
POSTGRES_HOST=your-db-cluster.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=your_actual_postgres_password
POSTGRES_DB=defaultdb
POSTGRES_SSL=true
```

**To find your Redis connection details:**
1. Go to Digital Ocean Dashboard
2. Click "Databases" → Your Redis cluster
3. Click "Connection Details"
4. Copy the host, port, and password

Save the file (Ctrl+X, then Y, then Enter in nano)

### Step 2: Upload Updated Configuration Files

From your local machine, upload the updated files to your server:

```bash
# Upload the updated ecosystem.config.js
scp ecosystem.config.js root@your-server-ip:/opt/agenthunt/

# Upload the updated backend code
cd backend
tar -czf backend-update.tar.gz src/
scp backend-update.tar.gz root@your-server-ip:/opt/agenthunt/backend/
```

### Step 3: Rebuild the Backend on the Server

SSH into your server and rebuild:

```bash
ssh root@your-server-ip
cd /opt/agenthunt/backend

# Extract updated source files
tar -xzf backend-update.tar.gz
rm backend-update.tar.gz

# Rebuild TypeScript
npm run build

# Verify the build created the correct directory structure
ls -la dist/backend/src/  # Should show index.js and other files
```

### Step 4: Restart PM2 with Updated Configuration

```bash
cd /opt/agenthunt

# Stop all PM2 processes
pm2 stop all

# Delete old PM2 processes
pm2 delete all

# Start with the updated configuration
pm2 start ecosystem.config.js

# Save PM2 configuration
pm2 save

# Check status
pm2 status

# Monitor logs for any errors
pm2 logs --lines 50
```

### Step 5: Verify Everything is Working

Check that all services are running without errors:

```bash
# Check PM2 status
pm2 status

# Should show:
# agenthunt-api: online (no restarts)
# agenthunt-workers: online (4 instances, no restarts)

# Check recent logs
pm2 logs --lines 20

# You should see:
# - "Database connection successful"
# - "Queue created" for various queues
# - "AIService initialized"
# - NO errors about "Cannot find module" or "ENOTFOUND"

# Test database connection
cd /opt/agenthunt/backend
npx tsx src/migrate.ts  # Should complete without errors

# Check API health
curl http://localhost:3000/health  # Should return 200 OK
```

## Quick Fix Script (Alternative)

Instead of doing the above steps manually, you can use this script:

```bash
#!/bin/bash
# save this as fix-deployment.sh on your server

cd /opt/agenthunt

echo "Stopping PM2 services..."
pm2 stop all
pm2 delete all

echo "Rebuilding backend..."
cd backend
npm run build

echo "Starting services with updated config..."
cd /opt/agenthunt
pm2 start ecosystem.config.js
pm2 save

echo "Checking status..."
pm2 status

echo "Done! Check logs with: pm2 logs"
```

Run it with:
```bash
chmod +x fix-deployment.sh
./fix-deployment.sh
```

## Troubleshooting

### If you still see "Cannot find module" errors:

```bash
cd /opt/agenthunt/backend
rm -rf dist/
npm run build
pm2 restart all
```

### If you see Redis connection errors:

1. Verify Redis is running on Digital Ocean
2. Check firewall rules allow your server's IP
3. Verify REDIS_HOST, REDIS_PORT, REDIS_PASSWORD are correct in .env
4. Make sure REDIS_TLS=true is set

### If you see Database authentication errors:

1. Verify PostgreSQL is running on Digital Ocean
2. Check firewall rules (Trusted Sources) include your server's IP
3. Verify database credentials in .env are correct
4. Try connecting manually:
   ```bash
   psql "postgresql://doadmin:YOUR_PASSWORD@your-db-cluster.ondigitalocean.com:25060/defaultdb?sslmode=require"
   ```

## What Was Fixed in the Code

### 1. PM2 Configuration (ecosystem.config.js)
- ✅ Updated script paths from `dist/index.js` to `dist/backend/src/index.js`
- ✅ Updated workers path from `dist/workers/index.js` to `dist/backend/src/workers/index.js`
- ✅ Added `env_file: '/opt/agenthunt/.env'` to ensure environment variables are loaded

### 2. Redis TLS Support
- ✅ Added `tls?: boolean` to Redis config interface (backend/src/config/index.ts)
- ✅ Added TLS configuration to Redis connection (backend/src/services/queue.ts)
- ✅ Updated .env.example and .env.production.example with REDIS_TLS option

### 3. Build Output Structure
The TypeScript compiler creates a nested structure:
- `dist/backend/src/` (contains your source files)
- `dist/shared/` (contains shared types)

This is why the PM2 paths needed to be updated.

## Need Help?

If you're still experiencing issues after following this guide:

1. Check the full error logs: `pm2 logs --lines 100 > debug.log`
2. Verify all environment variables are set correctly: `cat /opt/agenthunt/.env`
3. Check Digital Ocean firewall rules for both Redis and PostgreSQL
4. Ensure your server's IP is in the "Trusted Sources" for both databases
