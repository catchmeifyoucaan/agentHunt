#!/bin/bash

# Fix Production Deployment Script
# This script fixes missing dependencies and verifies database configuration

set -e

echo "=========================================="
echo "AgentHunt Production Fix Script"
echo "=========================================="

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}Error: package.json not found. Please run this script from /opt/agenthunt/backend${NC}"
    exit 1
fi

echo ""
echo "Step 1: Installing npm dependencies..."
echo "=========================================="
npm install

echo ""
echo -e "${GREEN}✓ Dependencies installed successfully${NC}"

echo ""
echo "Step 2: Checking .env file..."
echo "=========================================="

if [ ! -f ".env" ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Creating .env template..."

    cat > .env << 'EOF'
# Node Environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# PostgreSQL Configuration (Digital Ocean Managed Database)
POSTGRES_HOST=your-db-cluster.db.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=your-database-password
POSTGRES_DB=agenthunt
POSTGRES_SSL=true

# Redis Configuration (Digital Ocean Managed Redis)
REDIS_HOST=your-redis-cluster.db.ondigitalocean.com
REDIS_PORT=25061
REDIS_PASSWORD=your-redis-password
REDIS_TLS=true

# S3/Spaces Configuration
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_ACCESS_KEY=your-spaces-key
S3_SECRET_KEY=your-spaces-secret
S3_BUCKET=agenthunt-artifacts
S3_REGION=nyc3

# AI API Keys
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
GEMINI_API_KEY=your-gemini-key
PERPLEXITY_API_KEY=your-perplexity-key

# Security
JWT_SECRET=your-secure-jwt-secret-here

# Optional: Telegram Notifications
TELEGRAM_BOT_TOKEN=
TELEGRAM_CRITICAL_CHANNEL=
TELEGRAM_HIGH_CHANNEL=
TELEGRAM_OPS_CHANNEL=

# Optional: Project Discovery Chaos
CHAOS_API_KEY=

# Features
ENABLE_AI_TRIAGE=true
ENABLE_FUZZING=true
ENABLE_AUTO_CONFIRM=false
ENABLE_BRUTEFORCE=false
ENABLE_PORT_SCANNING=false
EOF

    echo -e "${YELLOW}⚠ .env file created with template values${NC}"
    echo -e "${YELLOW}⚠ Please edit .env with your actual credentials before continuing${NC}"
    echo ""
    echo "Required values to update:"
    echo "  - POSTGRES_HOST, POSTGRES_PASSWORD"
    echo "  - REDIS_HOST, REDIS_PASSWORD"
    echo "  - S3_ACCESS_KEY, S3_SECRET_KEY"
    echo "  - ANTHROPIC_API_KEY (or other AI provider keys)"
    echo "  - JWT_SECRET (generate a random string)"
    echo ""
    exit 1
fi

echo -e "${GREEN}✓ .env file exists${NC}"

# Source the .env file to check key variables
set -a
source .env
set +a

echo ""
echo "Step 3: Validating environment variables..."
echo "=========================================="

MISSING_VARS=()

# Check critical variables
[ -z "$POSTGRES_HOST" ] && MISSING_VARS+=("POSTGRES_HOST")
[ -z "$POSTGRES_PASSWORD" ] && MISSING_VARS+=("POSTGRES_PASSWORD")
[ -z "$REDIS_HOST" ] && MISSING_VARS+=("REDIS_HOST")
[ -z "$JWT_SECRET" ] || [ "$JWT_SECRET" = "change-me-in-production" ] && MISSING_VARS+=("JWT_SECRET")

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo -e "${RED}Error: Missing or invalid required environment variables:${NC}"
    printf '  - %s\n' "${MISSING_VARS[@]}"
    echo ""
    echo "Please update your .env file with the correct values"
    exit 1
fi

echo -e "${GREEN}✓ Required environment variables are set${NC}"

echo ""
echo "Step 4: Testing database connection..."
echo "=========================================="

# Test database connection
npx tsx -e "
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'agenthunt',
  password: process.env.POSTGRES_PASSWORD,
  database: process.env.POSTGRES_DB || 'agenthunt',
  ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection failed:', err.message);
    process.exit(1);
  }
  console.log('Database connected successfully at:', res.rows[0].now);
  pool.end();
  process.exit(0);
});
"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Database connection successful${NC}"
else
    echo -e "${RED}✗ Database connection failed${NC}"
    echo ""
    echo "Please check your database credentials in .env:"
    echo "  - POSTGRES_HOST"
    echo "  - POSTGRES_PORT"
    echo "  - POSTGRES_USER"
    echo "  - POSTGRES_PASSWORD"
    echo "  - POSTGRES_DB"
    echo "  - POSTGRES_SSL"
    exit 1
fi

echo ""
echo "Step 5: Testing Redis connection..."
echo "=========================================="

npx tsx -e "
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD,
  tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
});

redis.ping((err, result) => {
  if (err) {
    console.error('Redis connection failed:', err.message);
    redis.disconnect();
    process.exit(1);
  }
  console.log('Redis connected successfully. PING response:', result);
  redis.disconnect();
  process.exit(0);
});
"

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Redis connection successful${NC}"
else
    echo -e "${YELLOW}⚠ Redis connection failed (non-critical, workers may be affected)${NC}"
fi

echo ""
echo "Step 6: Rebuilding application..."
echo "=========================================="

npm run build

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✓ Build successful${NC}"
else
    echo -e "${RED}✗ Build failed${NC}"
    exit 1
fi

echo ""
echo "=========================================="
echo -e "${GREEN}✓ Production fix completed successfully!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Run migrations: npx tsx src/migrate.ts"
echo "  2. Restart PM2: pm2 restart all"
echo "  3. Check logs: pm2 logs"
echo ""
