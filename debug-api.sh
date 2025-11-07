#!/bin/bash

echo "======================================"
echo "AgentHunt API Debugging Script"
echo "======================================"
echo ""

# Check backend health
echo "1. Testing backend health..."
HEALTH=$(curl -s http://165.227.108.120:3000/health)
echo "Response: $HEALTH"
echo ""

# Check if backend is accepting connections
echo "2. Testing settings GET endpoint..."
SETTINGS_GET=$(curl -s http://165.227.108.120:3000/api/v1/settings)
echo "Response: $SETTINGS_GET"
echo ""

# Test saving settings
echo "3. Testing settings PUT endpoint..."
SETTINGS_PUT=$(curl -X PUT http://165.227.108.120:3000/api/v1/settings \
  -H "Content-Type: application/json" \
  -d '{
    "settings": {
      "notifications": {
        "email": true,
        "slack": false,
        "discord": false
      },
      "security": {
        "autoApprove": false,
        "requireHumanApproval": true,
        "maxConcurrentJobs": 10
      },
      "integrations": {
        "hackerOneApiKey": "",
        "bugcrowdApiKey": "",
        "chaosApiKey": "",
        "chaosDbEnabled": true
      },
      "performance": {
        "queueConcurrency": 5,
        "retryAttempts": 3,
        "timeout": 300
      }
    }
  }' \
  -s -w "\nHTTP Status: %{http_code}\n")
echo "Response: $SETTINGS_PUT"
echo ""

# Check if database is accessible
echo "4. Checking PostgreSQL connection..."
if command -v psql &> /dev/null; then
    PGPASSWORD=agenthunt_local_pass psql -h localhost -U agenthunt -d agenthunt -c "SELECT version();" 2>&1 | head -2
else
    echo "psql not installed, skipping direct DB test"
fi
echo ""

# Check backend logs if available
echo "5. Checking backend logs (last 20 lines)..."
if [ -f /opt/agenthunt/backend/logs/app.log ]; then
    tail -20 /opt/agenthunt/backend/logs/app.log
elif [ -f /var/log/agenthunt/backend.log ]; then
    tail -20 /var/log/agenthunt/backend.log
else
    echo "No log files found at expected locations"
    echo "Try: journalctl -u agenthunt-backend -n 20"
    echo "Or: pm2 logs backend --lines 20"
fi
echo ""

echo "======================================"
echo "Debug complete!"
echo "======================================"
