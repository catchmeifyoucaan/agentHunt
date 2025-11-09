#!/bin/bash
set -e

echo "🗄️ AgentHunt Database Initialization"
echo "===================================="
echo ""

# Read database credentials from .env file
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
else
  echo "❌ .env file not found!"
  exit 1
fi

# Build connection string based on environment
if [ "$POSTGRES_SSL" = "true" ]; then
  CONN_STRING="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=require"
else
  CONN_STRING="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}"
fi

echo "📋 Database Info:"
echo "  Host: ${POSTGRES_HOST}"
echo "  Port: ${POSTGRES_PORT}"
echo "  Database: ${POSTGRES_DB}"
echo "  User: ${POSTGRES_USER}"
echo "  SSL: ${POSTGRES_SSL}"
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
  echo "❌ psql is not installed. Installing..."
  apt update
  apt install -y postgresql-client
fi

echo "🔄 Testing database connection..."
if psql "$CONN_STRING" -c "SELECT 1;" > /dev/null 2>&1; then
  echo "✅ Database connection successful"
else
  echo "❌ Failed to connect to database"
  echo "   Please check your credentials and network connection"
  exit 1
fi

echo ""
echo "📝 Applying database schema..."

# Apply main schema
if psql "$CONN_STRING" -f backend/src/models/database.sql; then
  echo "✅ Main schema applied successfully"
else
  echo "⚠️  Some tables may already exist (this is okay)"
fi

# Apply submissions schema if it exists
if [ -f "backend/src/models/submissions.sql" ]; then
  echo ""
  echo "📝 Applying submissions schema..."
  if psql "$CONN_STRING" -f backend/src/models/submissions.sql; then
    echo "✅ Submissions schema applied successfully"
  else
    echo "⚠️  Some tables may already exist (this is okay)"
  fi
fi

echo ""
echo "🔍 Verifying tables..."
psql "$CONN_STRING" -c "\dt" | head -20

echo ""
echo "✅ Database initialization complete!"
echo ""
echo "To verify manager_commands table:"
echo "  psql \"$CONN_STRING\" -c \"\\d manager_commands\""
echo ""
