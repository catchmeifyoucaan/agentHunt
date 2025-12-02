#!/bin/bash

# AgentHunt Migration Verification Script
# Checks if all required tables exist after migration

set -e

echo "🔍 Verifying AgentHunt Database Migration..."

# Load environment variables (filter out comments, empty lines, and command flags)
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | grep -v '^--' | grep '=' | xargs)
fi

# Tables that should exist after migration
REQUIRED_TABLES=(
  "programs"
  "assets"
  "jobs"
  "findings"
  "notifications"
  "workers"
  "audit_logs"
  "tool_outputs"
  "handoffs"
  "turns"
  "interactions"
  "actions"
  "approval_requests"
  "policy_rules"
  "model_providers"
  "asset_relationships"
  "data_sources"
)

# Check each table
echo "📋 Checking for required tables..."
MISSING_TABLES=()

for table in "${REQUIRED_TABLES[@]}"; do
  # Query PostgreSQL to check if table exists
  EXISTS=$(PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -tAc \
    "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name='$table');" 2>/dev/null || echo "false")

  if [ "$EXISTS" = "t" ]; then
    echo "  ✅ $table"
  else
    echo "  ❌ $table (MISSING)"
    MISSING_TABLES+=("$table")
  fi
done

echo ""

if [ ${#MISSING_TABLES[@]} -eq 0 ]; then
  echo "🎉 All required tables exist!"
  echo ""
  echo "✅ Migration verification successful"
  exit 0
else
  echo "⚠️  Warning: ${#MISSING_TABLES[@]} table(s) missing:"
  for table in "${MISSING_TABLES[@]}"; do
    echo "   - $table"
  done
  echo ""
  echo "❌ Migration may not have completed successfully"
  echo "💡 Try running: npm run migrate"
  exit 1
fi
