# AgentHunt Database Migration Script
# Run this on your production server to apply migrations

set -e  # Exit on error

echo "🚀 Starting AgentHunt Database Migration..."

# Check database connection
echo "🔍 Checking database connection..."
if [ -z "$POSTGRES_HOST" ]; then
  echo "❌ Error: POSTGRES_HOST not set in environment. Ensure .env file is present or variables are exported."
  exit 1
fi

echo "📊 Database: $POSTGRES_HOST:$POSTGRES_PORT/$POSTGRES_DB"
echo "👤 User: $POSTGRES_USER"

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
