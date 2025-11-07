#!/bin/bash
set -e

echo "🗄️ PostgreSQL Database Setup"
echo "===================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (use sudo)"
  exit 1
fi

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
  echo "📦 Installing PostgreSQL..."
  apt update
  apt install -y postgresql postgresql-contrib
  systemctl start postgresql
  systemctl enable postgresql
  echo "✅ PostgreSQL installed"
else
  echo "✅ PostgreSQL already installed"
  systemctl start postgresql || true
fi

echo ""
echo "🔧 Configuring database..."

# Read database credentials from .env file
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
else
  echo "❌ .env file not found!"
  exit 1
fi

# Set default values if not in .env
DB_USER=${POSTGRES_USER:-agenthunt}
DB_PASSWORD=${POSTGRES_PASSWORD:-changeme}
DB_NAME=${POSTGRES_DB:-agenthunt}

# Create database and user
sudo -u postgres psql <<EOF
-- Create user if not exists
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_user WHERE usename = '$DB_USER') THEN
    CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
  END IF;
END
\$\$;

-- Create database if not exists
SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;

-- Connect to database and grant schema privileges
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
EOF

echo ""
echo "✅ Database configured successfully!"
echo ""
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Host: localhost"
echo "Port: 5432"
echo ""
echo "To test connection:"
echo "  psql -U $DB_USER -d $DB_NAME -h localhost"
echo ""
