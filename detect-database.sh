#!/bin/bash

echo "🔍 Detecting PostgreSQL configuration..."

# Check if we're using Digital Ocean managed PostgreSQL
if [ -n "$DATABASECONFIG" ] || id -u doadmin >/dev/null 2>&1; then
  echo "✅ Detected Digital Ocean Managed PostgreSQL"
  echo ""
  echo "📝 Updating .env with Digital Ocean credentials..."

  # Get actual database credentials from environment or defaults
  ACTUAL_USER=$(sudo -u postgres psql -tAc "SELECT usename FROM pg_user WHERE usename IN ('doadmin', 'agenthunt') LIMIT 1" 2>/dev/null || echo "agenthunt")
  ACTUAL_DB=$(sudo -u postgres psql -tAc "SELECT datname FROM pg_database WHERE datname IN ('defaultdb', 'agenthunt') AND datname != 'template0' AND datname != 'template1' LIMIT 1" 2>/dev/null || echo "agenthunt")

  echo "Found PostgreSQL database:"
  echo "  User: $ACTUAL_USER"
  echo "  Database: $ACTUAL_DB"
  echo ""

  # Update .env file
  if [ -f ".env" ]; then
    # Backup original
    cp .env .env.backup

    # Update credentials
    sed -i "s/^POSTGRES_USER=.*/POSTGRES_USER=$ACTUAL_USER/" .env
    sed -i "s/^POSTGRES_DB=.*/POSTGRES_DB=$ACTUAL_DB/" .env

    echo "✅ Updated .env file (backup saved as .env.backup)"
  fi
else
  echo "✅ Using standard PostgreSQL setup"
fi

echo ""
echo "Current database configuration:"
grep "^POSTGRES_" .env
echo ""
