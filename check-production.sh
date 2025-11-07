#!/bin/bash

# AgentHunt Production Health Check Script

echo "🔍 Checking AgentHunt Production Server..."
echo ""

# Check PM2 processes
echo "📊 PM2 Process Status:"
pm2 status
echo ""

# Check which branch is deployed
echo "🌿 Current Git Branch:"
cd /opt/agenthunt && git branch --show-current
echo ""

# Check last commit
echo "📝 Last Commit:"
cd /opt/agenthunt && git log -1 --oneline
echo ""

# Check if settings route exists in dist
echo "📁 Settings Route File:"
if [ -f "/opt/agenthunt/backend/dist/backend/src/api/routes/settings.js" ]; then
    echo "✅ settings.js exists in dist"
    ls -lh /opt/agenthunt/backend/dist/backend/src/api/routes/settings.js
else
    echo "❌ settings.js NOT found in dist"
fi
echo ""

# Test the API endpoint
echo "🧪 Testing /api/v1/settings endpoint:"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://localhost:3000/api/v1/settings || echo "❌ Failed to connect"
echo ""

# Check recent logs
echo "📋 Recent API Logs (last 20 lines):"
pm2 logs agenthunt-api --nostream --lines 20 2>/dev/null || echo "No logs available"
