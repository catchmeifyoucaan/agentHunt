#!/bin/bash
# Setup Redis without authentication for AgentHunt

set -e

echo "🔧 Setting up Redis for AgentHunt (No Authentication)..."

# Stop Redis if running
echo "⏹️  Stopping Redis..."
service redis-server stop 2>/dev/null || true
pkill redis-server 2>/dev/null || true
sleep 2

# Copy Redis config
echo "📝 Installing Redis config..."
cp redis.conf /etc/redis/redis.conf
chmod 644 /etc/redis/redis.conf

# Create required directories
mkdir -p /var/log/redis /var/lib/redis
chown redis:redis /var/log/redis /var/lib/redis 2>/dev/null || true

# Start Redis
echo "🚀 Starting Redis..."
service redis-server start || redis-server /etc/redis/redis.conf

# Wait for Redis to start
sleep 2

# Test Redis connection
echo "🧪 Testing Redis connection..."
if redis-cli ping | grep -q PONG; then
    echo "✅ Redis is running without authentication"
else
    echo "❌ Redis failed to start"
    exit 1
fi

# Restart PM2 processes
echo "🔄 Restarting PM2 processes..."
cd /opt/agenthunt
pm2 delete all 2>/dev/null || true
pm2 start ecosystem.config.js

echo ""
echo "✅ Setup complete!"
echo ""
echo "Check status with:"
echo "  pm2 list"
echo "  pm2 logs"
