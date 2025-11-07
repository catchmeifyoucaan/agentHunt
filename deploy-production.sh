#!/bin/bash

# AgentHunt Production Deployment Script
# This script deploys the latest code to the production server

set -e  # Exit on error

echo "🚀 Starting AgentHunt Production Deployment..."

# Configuration
PROD_DIR="/opt/agenthunt"
BRANCH="${1:-main}"  # Default to main branch, or use first argument

echo "📦 Deploying branch: $BRANCH"

# Navigate to production directory
cd $PROD_DIR

# Pull latest changes
echo "📥 Pulling latest code from git..."
git fetch origin
git checkout $BRANCH
git pull origin $BRANCH

# Install dependencies if needed
echo "📚 Installing backend dependencies..."
cd backend
npm install --production

# Build backend
echo "🔨 Building backend..."
npm run build

# Restart PM2 processes
echo "🔄 Restarting PM2 processes..."
cd ..
pm2 restart ecosystem.config.js --update-env

# Check status
echo "✅ Deployment complete! Checking status..."
pm2 status

echo ""
echo "🎉 Deployment successful!"
echo "📊 View logs with: pm2 logs"
echo "📈 Check status with: pm2 status"
