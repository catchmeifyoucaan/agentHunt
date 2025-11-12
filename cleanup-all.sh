#!/bin/bash

set -e

echo "🧹 Starting complete cleanup..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 1. Stop all PM2 processes
echo -e "${YELLOW}📦 Stopping all PM2 processes...${NC}"
cd /opt/agenthunt
pm2 stop all || true
pm2 delete all || true
sleep 2

# 2. Kill any remaining node processes
echo -e "${YELLOW}🔪 Killing remaining node processes...${NC}"
pkill -f "node.*workers" || true
pkill -f "node.*backend" || true
pkill -f "node.*frontend" || true
sleep 2

# 3. Clear Redis - All queues and keys
echo -e "${YELLOW}🗑️  Clearing Redis queues and cache...${NC}"
redis-cli FLUSHALL || echo "Redis not available or already clean"

# Clear BullMQ queues specifically
redis-cli --scan --pattern "bull:*" | xargs -L 1 redis-cli DEL || true
redis-cli --scan --pattern "*:meta" | xargs -L 1 redis-cli DEL || true
redis-cli --scan --pattern "*:events" | xargs -L 1 redis-cli DEL || true
redis-cli --scan --pattern "*:id" | xargs -L 1 redis-cli DEL || true

echo -e "${GREEN}✅ Redis cleared${NC}"

# 4. Wipe Database
echo -e "${YELLOW}🗄️  Wiping database...${NC}"

# Get database connection details from environment or config
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-agenthunt}"
DB_PASSWORD="${POSTGRES_PASSWORD}"

# Export password for psql
export PGPASSWORD="$DB_PASSWORD"

# Connect and wipe all tables
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
-- Disable foreign key checks temporarily
SET session_replication_role = 'replica';

-- Delete all data from tables (in correct order to avoid FK violations)
TRUNCATE TABLE findings CASCADE;
TRUNCATE TABLE assets CASCADE;
TRUNCATE TABLE jobs CASCADE;
TRUNCATE TABLE programs CASCADE;
TRUNCATE TABLE uploads CASCADE;
TRUNCATE TABLE logs CASCADE;

-- Reset sequences
ALTER SEQUENCE IF EXISTS jobs_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS programs_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS assets_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS findings_id_seq RESTART WITH 1;
ALTER SEQUENCE IF EXISTS uploads_id_seq RESTART WITH 1;

-- Re-enable foreign key checks
SET session_replication_role = 'origin';

-- Show counts
SELECT 
  'jobs' as table_name, COUNT(*) as count FROM jobs
UNION ALL
SELECT 'assets', COUNT(*) FROM assets
UNION ALL
SELECT 'programs', COUNT(*) FROM programs
UNION ALL
SELECT 'findings', COUNT(*) FROM findings
UNION ALL
SELECT 'uploads', COUNT(*) FROM uploads;
EOF

echo -e "${GREEN}✅ Database wiped${NC}"

# 5. Clear logs
echo -e "${YELLOW}📝 Clearing log files...${NC}"
rm -f /opt/agenthunt/logs/*.log || true
echo -e "${GREEN}✅ Logs cleared${NC}"

# 6. Clear temporary files
echo -e "${YELLOW}🧹 Clearing temporary files...${NC}"
rm -rf /tmp/fingerprint-* /tmp/dns_validate_* /tmp/dns_validated_* /tmp/crawl-* /tmp/portscan-* || true
echo -e "${GREEN}✅ Temp files cleared${NC}"

echo -e "${GREEN}✨ Complete cleanup finished!${NC}"
echo ""
echo "Summary:"
echo "  - All PM2 processes stopped"
echo "  - Redis queues and cache cleared"
echo "  - Database tables truncated"
echo "  - Logs cleared"
echo "  - Temp files removed"
echo ""
echo "Ready for fresh start! 🚀"
