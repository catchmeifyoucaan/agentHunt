# Production Server Fix Instructions

## Current Issues
1. Database authentication failures (error 28000)
2. Missing logger module in compiled code
3. Old build with incorrect dist structure

## Fix Steps (Run on production server at `/opt/agenthunt`)

### Step 1: Pull Latest Code
```bash
cd /opt/agenthunt
git fetch origin
git checkout claude/agent-orchestration-full-spec-011CUrbUhn2v28Amnbs5b8Qu
git pull origin claude/agent-orchestration-full-spec-011CUrbUhn2v28Amnbs5b8Qu
```

### Step 2: Rebuild Application
```bash
cd /opt/agenthunt/backend
rm -rf dist
npm run build
```

### Step 3: Fix Database Credentials

The workers are failing with error code 28000 (authentication failure). Check the `.env` file:

```bash
cd /opt/agenthunt
cat .env | grep POSTGRES
```

**Likely Issue:** The `.env` file at `/opt/agenthunt/.env` has incorrect database credentials for the workers.

**To fix:**
```bash
nano /opt/agenthunt/.env
```

Update the database settings to match the production database. Based on previous commits, it should be:
```env
POSTGRES_HOST=<your-managed-postgres-host>
POSTGRES_PORT=25060
POSTGRES_USER=<your-db-user>
POSTGRES_PASSWORD=<your-db-password>
POSTGRES_DB=agenthunt
POSTGRES_SSL=true
```

### Step 4: Run Migrations
```bash
cd /opt/agenthunt/backend
npx tsx src/migrate.ts
```

### Step 5: Restart PM2
```bash
cd /opt/agenthunt
pm2 delete all
pm2 start ecosystem.config.js
pm2 save
```

### Step 6: Check Logs
```bash
pm2 logs --lines 50
```

## Expected Result
- No "Cannot find module" errors
- No error code 28000 (database authentication)
- All workers and API running successfully

## If Still Failing

1. **Verify database credentials are correct:**
   ```bash
   cd /opt/agenthunt/backend
   node -e "require('dotenv').config({path:'../.env'}); console.log('DB:', process.env.POSTGRES_HOST, process.env.POSTGRES_USER)"
   ```

2. **Test database connection manually:**
   ```bash
   cd /opt/agenthunt/backend
   npx tsx -e "
   import pg from 'pg';
   import dotenv from 'dotenv';
   dotenv.config({path:'../.env'});
   const client = new pg.Client({
     host: process.env.POSTGRES_HOST,
     port: Number(process.env.POSTGRES_PORT),
     user: process.env.POSTGRES_USER,
     password: process.env.POSTGRES_PASSWORD,
     database: process.env.POSTGRES_DB,
     ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
   });
   client.connect().then(() => {
     console.log('✅ Connected successfully');
     client.end();
   }).catch(err => {
     console.error('❌ Connection failed:', err.message);
   });
   "
   ```

3. **Check if dist structure is correct:**
   ```bash
   ls -la /opt/agenthunt/backend/dist/backend/src/
   ls -la /opt/agenthunt/backend/dist/backend/src/utils/logger.js
   ```

## Notes
- The tsconfig.json fix changes `rootDir: ".."` to compile both backend/src and shared correctly
- The ecosystem.config.js paths should point to `./backend/dist/backend/src/index.js`
- Both changes are already committed to the branch
