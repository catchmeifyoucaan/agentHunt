# 🚀 Digital Ocean Deployment Guide

Complete guide to deploy AgentHunt on Digital Ocean for **autonomous 24/7** bug bounty hunting with web and Telegram interfaces.

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Cost Estimate](#cost-estimate)
3. [Prerequisites](#prerequisites)
4. [Step 1: Create Digital Ocean Resources](#step-1-create-digital-ocean-resources)
5. [Step 2: Setup Backend (API + Workers)](#step-2-setup-backend-api--workers)
6. [Step 3: Setup Frontend (Web Dashboard)](#step-3-setup-frontend-web-dashboard)
7. [Step 4: Configure Domain & SSL](#step-4-configure-domain--ssl)
8. [Step 5: Start Services](#step-5-start-services)
9. [Step 6: Setup Telegram Bot](#step-6-setup-telegram-bot)
10. [Monitoring & Maintenance](#monitoring--maintenance)
11. [Troubleshooting](#troubleshooting)

---

## Overview

**Architecture on Digital Ocean:**

```
┌─────────────────────────────────────────────────────────┐
│                    DIGITAL OCEAN                        │
│                                                           │
│  ┌─────────────────┐      ┌──────────────────┐          │
│  │  Droplet (8GB)  │      │ Droplet (4GB)    │          │
│  │  Backend + API  │◄────►│   Frontend UI    │          │
│  │  + Workers      │      │   (Next.js)      │          │
│  └────────┬────────┘      └──────────────────┘          │
│           │                                               │
│  ┌────────┴────────┬────────────┬──────────────┐        │
│  ▼                 ▼            ▼              ▼         │
│  Managed         Managed     Spaces S3      Load         │
│  PostgreSQL      Redis       Storage        Balancer     │
│  (4GB RAM)       (1GB RAM)   (250GB)        (Optional)   │
└─────────────────────────────────────────────────────────┘
         │
         ▼
   Telegram Bot ──► Notifications
```

---

## Cost Estimate

| Service | Plan | Monthly Cost |
|---------|------|--------------|
| **Backend Droplet** | 8GB RAM, 4 vCPUs, 160GB SSD | $48/month |
| **Frontend Droplet** | 4GB RAM, 2 vCPUs, 80GB SSD | $24/month |
| **Managed PostgreSQL** | 4GB RAM, 2 vCPUs, 115GB Disk | $60/month |
| **Managed Redis** | 1GB RAM | $15/month |
| **Spaces Storage** | 250GB + CDN | $5/month |
| **Load Balancer** (Optional) | | $10/month |
| **Domain + SSL** | Free (Let's Encrypt) | $0/month |
| **Backups** | Weekly snapshots | ~$5/month |
| **TOTAL** | | **~$152-167/month** |

> **Note**: You can start smaller and scale up. Minimum viable: $80/month (single 8GB droplet, smaller DB, no frontend droplet)

---

## Prerequisites

### 1. Digital Ocean Account
- Sign up at https://www.digitalocean.com/
- Add payment method
- Generate Personal Access Token: Account > API > Tokens/Keys

### 2. Required API Keys
You need these keys **before deployment**:

| Service | How to Get | Required? |
|---------|-----------|-----------|
| **Anthropic Claude** | https://console.anthropic.com/settings/keys | ✅ YES |
| **Chaos DB** | https://chaos.projectdiscovery.io/ | ✅ YES |
| **Telegram Bot** | @BotFather on Telegram | ⚠️ Highly Recommended |
| **HackerOne API** | HackerOne Settings > API Tokens | ❌ Optional |
| **Bugcrowd API** | Bugcrowd Settings > API Access | ❌ Optional |

### 3. Domain Name
- Purchase a domain (Namecheap, GoDaddy, Cloudflare, etc.)
- You'll point it to Digital Ocean nameservers

### 4. Local Tools
```bash
# Install doctl (Digital Ocean CLI)
brew install doctl  # macOS
# or
snap install doctl  # Linux

# Authenticate
doctl auth init
```

---

## Step 1: Create Digital Ocean Resources

### 1.1 Create Managed PostgreSQL Database

```bash
# Via CLI
doctl databases create agenthunt-db \
  --engine pg \
  --version 16 \
  --size db-s-4vcpu-8gb \
  --region nyc3

# Or via Web UI:
# Databases > Create Database > PostgreSQL 16
# Select: 4GB RAM, 2 vCPUs ($60/month)
# Region: New York 3 (nyc3)
```

**After creation:**
```bash
# Get connection details
doctl databases get <database-id>

# Note down:
# - Hostname
# - Port
# - Username
# - Password
# - Database name
```

### 1.2 Create Managed Redis

```bash
# Via CLI
doctl databases create agenthunt-redis \
  --engine redis \
  --version 7 \
  --size db-s-1vcpu-1gb \
  --region nyc3

# Or via Web UI:
# Databases > Create Database > Redis 7
# Select: 1GB RAM ($15/month)
# Region: New York 3 (nyc3)
```

### 1.3 Create Spaces (S3 Storage)

```bash
# Via Web UI:
# Spaces > Create Space
# Region: New York 3 (nyc3)
# Name: agenthunt-artifacts
# Enable CDN: Yes
# Restrict File Listing: Yes
```

**Generate Spaces Keys:**
```bash
# API > Spaces Keys > Generate New Key
# Name: agenthunt-backend
# Note down Access Key and Secret Key
```

### 1.4 Create Backend Droplet

```bash
# Via CLI
doctl compute droplet create agenthunt-backend \
  --image docker-20-04 \
  --size s-4vcpu-8gb-intel \
  --region nyc3 \
  --enable-monitoring \
  --enable-private-networking \
  --ssh-keys <your-ssh-key-id>

# Or via Web UI:
# Droplets > Create Droplet
# Image: Marketplace > Docker on Ubuntu 22.04
# Plan: 8GB RAM, 4 vCPUs ($48/month)
# Region: New York 3 (same as databases!)
# Add SSH key
# Enable monitoring
```

### 1.5 Create Frontend Droplet

```bash
# Via CLI
doctl compute droplet create agenthunt-frontend \
  --image ubuntu-22-04-x64 \
  --size s-2vcpu-4gb-intel \
  --region nyc3 \
  --enable-monitoring \
  --ssh-keys <your-ssh-key-id>

# Or via Web UI:
# Droplets > Create Droplet
# Image: Ubuntu 22.04
# Plan: 4GB RAM, 2 vCPUs ($24/month)
# Region: New York 3
```

---

## Step 2: Setup Backend (API + Workers)

### 2.1 SSH into Backend Droplet

```bash
# Get droplet IP
doctl compute droplet list

# SSH in
ssh root@<backend-droplet-ip>
```

### 2.2 Initial Server Setup

```bash
# Update system
apt update && apt upgrade -y

# Install dependencies
apt install -y git curl wget unzip build-essential

# Install Docker (if not already installed)
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Install Node.js (for tools)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Create app directory
mkdir -p /opt/agenthunt
cd /opt/agenthunt
```

### 2.3 Clone Repository

```bash
# Clone your repo
git clone https://github.com/yourusername/agentHunt.git .

# Or upload via SCP if private
# scp -r /path/to/agentHunt root@<droplet-ip>:/opt/agenthunt
```

### 2.4 Configure Environment

```bash
# Copy production template
cp .env.production.example .env

# Edit with your values
nano .env
```

**Fill in these critical values:**

```bash
# Database (from Step 1.1)
POSTGRES_HOST=agenthunt-db-do-user-123456-0.b.db.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=<your-db-password>
POSTGRES_DB=agenthunt
POSTGRES_SSL=true

# Redis (from Step 1.2)
REDIS_HOST=agenthunt-redis-do-user-123456-0.b.db.ondigitalocean.com
REDIS_PORT=25061
REDIS_PASSWORD=<your-redis-password>
REDIS_TLS=true

# Spaces (from Step 1.3)
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_ACCESS_KEY=<your-spaces-key>
S3_SECRET_KEY=<your-spaces-secret>
S3_BUCKET=agenthunt-artifacts
S3_REGION=nyc3

# API Keys
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
CHAOS_API_KEY=xxxxx

# Telegram
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
TELEGRAM_CRITICAL_CHANNEL=-1001234567890
TELEGRAM_HIGH_CHANNEL=-1001234567891

# Security
JWT_SECRET=$(openssl rand -base64 32)

# Frontend URL (your domain)
CORS_ORIGIN=https://agenthunt.yourdomain.com
FRONTEND_URL=https://agenthunt.yourdomain.com
```

### 2.5 Build and Start Backend

```bash
# Navigate to backend
cd backend

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run database migrations
npm run migrate

# Start with Docker Compose
cd ../infrastructure/docker
docker-compose -f docker-compose.prod.yml up -d

# Or run directly with PM2
npm install -g pm2
pm2 start dist/index.js --name agenthunt-api
pm2 start dist/workers.js --name agenthunt-workers -i 4
pm2 save
pm2 startup
```

### 2.6 Verify Backend

```bash
# Check health
curl http://localhost:3000/health

# Expected response:
# {"status":"healthy","timestamp":"..."}

# Check logs
docker-compose logs -f
# or
pm2 logs
```

---

## Step 3: Setup Frontend (Web Dashboard)

### 3.1 SSH into Frontend Droplet

```bash
ssh root@<frontend-droplet-ip>
```

### 3.2 Initial Setup

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2
npm install -g pm2

# Clone repository
mkdir -p /opt/agenthunt-frontend
cd /opt/agenthunt-frontend
git clone https://github.com/yourusername/agentHunt.git .
cd frontend
```

### 3.3 Configure Frontend Environment

```bash
# Create production .env
cp .env.example .env.production.local

# Edit
nano .env.production.local
```

**Set your backend API URL:**
```bash
# Point to your backend droplet or domain
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
# or
NEXT_PUBLIC_API_URL=http://<backend-droplet-ip>:3000

NODE_ENV=production
```

### 3.4 Build and Start Frontend

```bash
# Install dependencies
npm install

# Build production bundle
npm run build

# Start with PM2
pm2 start npm --name agenthunt-frontend -- start
pm2 save
pm2 startup

# Frontend runs on port 3000 by default
```

### 3.5 Setup Nginx Reverse Proxy (Recommended)

```bash
# Install Nginx
apt install -y nginx

# Create config
nano /etc/nginx/sites-available/agenthunt
```

**Nginx config:**
```nginx
server {
    listen 80;
    server_name agenthunt.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/agenthunt /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

---

## Step 4: Configure Domain & SSL

### 4.1 Point Domain to Digital Ocean

**At your domain registrar:**
```
Nameservers:
ns1.digitalocean.com
ns2.digitalocean.com
ns3.digitalocean.com
```

### 4.2 Create DNS Records in Digital Ocean

```bash
# Via Web UI: Networking > Domains > Add Domain

# Add A records:
# agenthunt.yourdomain.com → <frontend-droplet-ip>
# api.yourdomain.com → <backend-droplet-ip>

# Or via CLI:
doctl compute domain create yourdomain.com
doctl compute domain records create yourdomain.com \
  --record-type A \
  --record-name agenthunt \
  --record-data <frontend-ip>

doctl compute domain records create yourdomain.com \
  --record-type A \
  --record-name api \
  --record-data <backend-ip>
```

### 4.3 Install SSL Certificate (Let's Encrypt)

**On Frontend Droplet:**
```bash
# Install Certbot
apt install -y certbot python3-certbot-nginx

# Get certificate
certbot --nginx -d agenthunt.yourdomain.com

# Auto-renewal
certbot renew --dry-run
```

**On Backend Droplet:**
```bash
certbot --nginx -d api.yourdomain.com
```

---

## Step 5: Start Services

### 5.1 Start Backend Services

```bash
# On backend droplet
cd /opt/agenthunt/infrastructure/docker
docker-compose up -d

# Or with PM2
pm2 restart all

# Check status
pm2 status
docker-compose ps
```

### 5.2 Start Frontend

```bash
# On frontend droplet
pm2 restart agenthunt-frontend
pm2 status
```

### 5.3 Verify Everything Works

```bash
# Check backend health
curl https://api.yourdomain.com/health

# Check frontend
curl https://agenthunt.yourdomain.com

# Open in browser
# https://agenthunt.yourdomain.com
```

---

## Step 6: Setup Telegram Bot

### 6.1 Create Bot with @BotFather

1. Open Telegram, search for **@BotFather**
2. Send `/newbot`
3. Choose name: **AgentHunt Bot**
4. Choose username: **agenthunt_yourname_bot**
5. Copy the **token** (e.g., `123456789:ABCdefGHI...`)

### 6.2 Create Notification Channels

```bash
# Create 3 private channels:
1. AgentHunt Critical Findings
2. AgentHunt High Findings
3. AgentHunt Operations

# For each channel:
# - Make it private
# - Add your bot as admin
# - Get channel ID using @userinfobot (forward a message)
```

### 6.3 Update Backend .env

```bash
# On backend droplet
nano /opt/agenthunt/.env

# Add:
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHI...
TELEGRAM_CRITICAL_CHANNEL=-1001234567890
TELEGRAM_HIGH_CHANNEL=-1001234567891
TELEGRAM_OPS_CHANNEL=-1001234567892

# Restart backend
pm2 restart agenthunt-api agenthunt-workers
# or
docker-compose restart
```

### 6.4 Test Notifications

```bash
# Trigger a test notification via API
curl -X POST https://api.yourdomain.com/api/v1/test/notification \
  -H "Content-Type: application/json" \
  -d '{"message": "AgentHunt is live! 🎯"}'

# Check your Telegram channels
```

---

## Monitoring & Maintenance

### Daily Monitoring

```bash
# Check service status
pm2 status

# Check logs
pm2 logs agenthunt-api --lines 100
pm2 logs agenthunt-workers --lines 100

# Check disk space
df -h

# Check resource usage
htop
docker stats
```

### Automated Monitoring

**Setup monitoring alerts:**
```bash
# Digital Ocean Monitoring (built-in)
# Droplets > Your Droplet > Monitoring
# Set alerts for:
# - CPU > 80%
# - Memory > 90%
# - Disk > 85%
```

### Backups

```bash
# Database backups (automatic with Managed DB)
# Databases > Your DB > Backups
# Daily backups are automatic, keep for 7 days

# Droplet snapshots
doctl compute droplet-action snapshot <droplet-id> --snapshot-name "agenthunt-backup-$(date +%F)"

# Schedule weekly with cron
crontab -e
# Add:
0 2 * * 0 doctl compute droplet-action snapshot <backend-id> --snapshot-name "backend-$(date +\%F)"
0 2 * * 0 doctl compute droplet-action snapshot <frontend-id> --snapshot-name "frontend-$(date +\%F)"
```

### Updates

```bash
# Pull latest code
cd /opt/agenthunt
git pull origin main

# Backend updates
cd backend
npm install
npm run build
pm2 restart agenthunt-api agenthunt-workers

# Frontend updates
cd ../frontend
npm install
npm run build
pm2 restart agenthunt-frontend
```

---

## Troubleshooting

### Backend not connecting to database

```bash
# Test database connection
cd /opt/agenthunt/backend
node -e "const { Pool } = require('pg'); const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); pool.query('SELECT NOW()', (err, res) => { console.log(err || res.rows); pool.end(); });"

# Check firewall rules in Digital Ocean
# Databases > Your DB > Trusted Sources
# Add backend droplet IP
```

### Frontend not loading

```bash
# Check if Next.js is running
pm2 logs agenthunt-frontend

# Check Nginx
nginx -t
systemctl status nginx

# Check if port 3000 is open
netstat -tulpn | grep 3000
```

### Workers not processing jobs

```bash
# Check Redis connection
redis-cli -h <redis-host> -p 25061 -a <password> --tls ping

# Check BullMQ queue
cd /opt/agenthunt/backend
node -e "const { Queue } = require('bullmq'); const queue = new Queue('agenthunt', { connection: { host: process.env.REDIS_HOST, port: process.env.REDIS_PORT, password: process.env.REDIS_PASSWORD, tls: {} } }); queue.count().then(console.log);"

# Restart workers
pm2 restart agenthunt-workers
```

### High CPU/Memory usage

```bash
# Check processes
htop

# Scale workers down
pm2 scale agenthunt-workers 2

# Adjust concurrency in .env
MAX_CONCURRENT_JOBS=10
WORKER_CONCURRENCY=5
```

---

## 🎯 Next Steps

Once deployed, you can:

1. **Access Web Dashboard**: `https://agenthunt.yourdomain.com`
2. **Create first program**: Programs > New Program
3. **Start discovery**: "Start passive discovery for example.com"
4. **Receive findings**: Via Web UI + Telegram notifications
5. **Review and approve**: Human-in-the-loop submissions

---

## 🔒 Security Checklist

- [ ] Changed all default passwords
- [ ] JWT secret is random (32+ characters)
- [ ] SSL certificates installed
- [ ] Firewall configured (UFW or Digital Ocean Firewall)
- [ ] Database connections use SSL
- [ ] Redis connections use TLS
- [ ] Spaces bucket is private
- [ ] Rate limiting enabled
- [ ] Monitoring alerts configured
- [ ] Backups scheduled

---

## 📞 Support

If you encounter issues:
1. Check logs: `pm2 logs`
2. Check Digital Ocean status page
3. Review this guide's troubleshooting section
4. Check GitHub issues: https://github.com/yourusername/agentHunt/issues

---

**🎉 Congratulations! AgentHunt is now running 24/7 on Digital Ocean!**
