#!/bin/bash

# AgentHunt Database Migration Script
# Run this on your production server to apply migrations

set -e  # Exit on error

echo "🚀 Starting AgentHunt Database Migration..."

# Load environment variables (filter out comments, empty lines, and command flags)
if [ -f .env ]; then
  echo "📋 Loading environment variables from .env"
  export $(cat .env | grep -v '^#' | grep -v '^--' | grep '=' | xargs)
else
  echo "⚠️  Warning: .env file not found"
fi

# Check database connection
echo "🔍 Checking database connection..."
if [ -z "$DB_HOST" ]; then
  echo "❌ Error: DB_HOST not set in environment"
  exit 1
fi

echo "📊 Database: $DB_HOST:$DB_PORT/$DB_NAME"
echo "👤 User: $DB_USER"

# Run migrations
echo "🔧 Running database migrations..."
npm run migrate

if [ $? -eq 0 ]; then
  echo "✅ Migrations completed successfully!"
  echo ""
  echo "🎉 The following tables should now exist:"
  echo "   - handoffs (agent-to-agent delegations)"
  echo "   - turns (execution cycles)"
  echo "   - interactions (reasoning-action cycles)"
  echo "   - actions (tool executions)"
  echo "   - And 30+ more from enhanced-schema.sql"
  echo ""
  echo "🔄 Next step: Restart your backend server to load new endpoints"
else
  echo "❌ Migration failed! Check the logs above for details"
  exit 1
fi
