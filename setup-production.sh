#!/bin/bash
set -e

echo "🚀 AgentHunt Production Setup Script"
echo "===================================="
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "❌ Please run as root (use sudo)"
  exit 1
fi

# Check if .env exists
if [ ! -f ".env" ]; then
  echo "❌ .env file not found!"
  echo "Please create .env file with your API keys first."
  echo "See .env.example for template."
  exit 1
fi

echo "✅ Found .env file"
echo ""

# Install Redis if not installed
if ! command -v redis-server &> /dev/null; then
  echo "📦 Installing Redis..."
  apt update
  apt install -y redis-server
  systemctl start redis-server
  systemctl enable redis-server
  echo "✅ Redis installed"
else
  echo "✅ Redis already installed"
  systemctl start redis-server || true
fi

# Test Redis
if redis-cli ping &> /dev/null; then
  echo "✅ Redis is running"
else
  echo "❌ Redis is not responding"
  exit 1
fi

echo ""
echo "📦 Installing backend dependencies..."
cd backend
npm install

echo ""
echo "🔨 Building backend..."
npm run build

# Check if build succeeded
if [ ! -f "dist/index.js" ]; then
  echo "❌ Build failed - dist/index.js not found"
  exit 1
fi

echo "✅ Build successful"
echo ""

echo "🗄️ Running database migrations..."
./node_modules/.bin/tsx src/migrate.ts || echo "⚠️  Migration failed or already done"

cd ..

echo ""
echo "📁 Creating logs directory..."
mkdir -p logs

echo ""
echo "📦 Installing PM2..."
npm install -g pm2

echo ""
echo "🛑 Stopping old processes..."
pm2 delete all || true

echo ""
echo "🚀 Starting services with PM2 ecosystem..."
pm2 start ecosystem.config.js

echo ""
echo "💾 Saving PM2 configuration..."
pm2 save

echo ""
echo "🔄 Setting up auto-start..."
pm2 startup systemd -u root --hp /root

echo ""
echo "📊 Current status:"
pm2 status

echo ""
echo "🧪 Testing health endpoint..."
sleep 5
if curl -s http://localhost:3000/health | grep -q "healthy"; then
  echo "✅ Health check passed!"
else
  echo "⚠️  Health check pending... Check logs with: pm2 logs"
fi

echo ""
echo "======================================"
echo "✅ Setup Complete!"
echo "======================================"
echo ""
echo "📊 View status: pm2 status"
echo "📝 View logs: pm2 logs"
echo "📝 View API logs: pm2 logs agenthunt-api"
echo "📝 View worker logs: pm2 logs agenthunt-workers"
echo "🔄 Restart: pm2 restart all"
echo "🛑 Stop: pm2 stop all"
echo ""
echo "🌐 API URL: http://YOUR_DROPLET_IP:3000"
echo "🔍 Health: http://YOUR_DROPLET_IP:3000/health"
echo ""
echo "Happy hunting! 🎯"
