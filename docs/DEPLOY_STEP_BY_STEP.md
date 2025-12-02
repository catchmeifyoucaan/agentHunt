# 🚀 AgentHunt - Step-by-Step Digital Ocean Deployment

Complete beginner-friendly guide to deploy AgentHunt on Digital Ocean for 24/7 operation.

---

## 📊 **What You'll Create**

```
Digital Ocean Account
    ↓
1. Managed PostgreSQL Database ($60/month)
2. Managed Redis ($15/month)
3. Spaces Storage ($5/month)
4. Backend Droplet ($48/month)
5. Frontend Droplet ($24/month) - OPTIONAL
    ↓
Total: ~$152/month (or $128 without frontend droplet)
```

---

## ⏱️ **Time Required**

- **Phase 1** (Setup DO resources): 30 minutes
- **Phase 2** (Deploy backend): 45 minutes
- **Phase 3** (Deploy frontend): 30 minutes - OPTIONAL
- **Phase 4** (Configure domain & SSL): 20 minutes - OPTIONAL

**Total**: 1-2 hours for full production setup
**Minimum**: 1 hour for backend-only setup

---

# PHASE 1: Create Digital Ocean Resources

## Step 1.1: Sign Up & Add Payment Method

1. Go to https://www.digitalocean.com/
2. Click **Sign Up**
3. Use this referral link for **$200 free credit** (60 days):
   https://m.do.co/c/your-referral-code
4. Verify email
5. **Add payment method** (credit card)
6. Complete account setup

---

## Step 1.2: Create PostgreSQL Database

1. **Log in** to Digital Ocean
2. Click **Create** (top-right) → **Databases**
3. **Settings**:
   ```
   Database Engine: PostgreSQL
   Version: 16
   Data Center: New York 3 (nyc3)
   Cluster Configuration: Basic nodes
   Plan: 4GB RAM / 2 vCPUs / 115GB Disk ($60/month)
   Database Name: agenthunt-db
   ```
4. Click **Create Database Cluster**
5. **Wait 3-5 minutes** for provisioning

### After Creation:

6. Click on **agenthunt-db** database
7. Go to **Connection Details** tab
8. **Copy and save** these values:
   ```
   Host: agenthunt-db-do-user-XXXXXX-0.b.db.ondigitalocean.com
   Port: 25060
   Username: doadmin
   Password: [click to reveal and copy]
   Database: defaultdb
   ```

9. Go to **Settings** tab → **Trusted Sources**
10. Click **Allow All** (we'll secure later) OR wait until you have droplet IP

---

## Step 1.3: Create Redis

1. Click **Create** → **Databases**
2. **Settings**:
   ```
   Database Engine: Redis
   Version: 7
   Data Center: New York 3 (nyc3) - MUST BE SAME AS POSTGRES
   Plan: 1GB RAM ($15/month)
   Name: agenthunt-redis
   ```
3. Click **Create Database Cluster**
4. **Wait 3-5 minutes**

### After Creation:

5. Click **agenthunt-redis**
6. Go to **Connection Details**
7. **Copy and save**:
   ```
   Host: agenthunt-redis-do-user-XXXXXX-0.b.db.ondigitalocean.com
   Port: 25061
   Password: [copy this]
   ```

---

## Step 1.4: Create Spaces (S3 Storage)

1. Click **Create** → **Spaces**
2. **Settings**:
   ```
   Region: New York 3 (nyc3) - MUST BE SAME
   Enable CDN: Yes
   Space Name: agenthunt-artifacts
   Restrict File Listing: Yes
   ```
3. Click **Create Space**

### Create Access Keys:

4. Go to **API** (left sidebar)
5. Click **Spaces Keys** tab
6. Click **Generate New Key**
7. **Name**: agenthunt-backend
8. **Copy and save immediately** (shown only once):
   ```
   Access Key: DO00XXXXXXXXXXXXXXXXXXXX
   Secret Key: XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```

---

## Step 1.5: Create Backend Droplet

1. Click **Create** → **Droplets**
2. **Choose an image**:
   - Click **Marketplace**
   - Search for **"Docker on Ubuntu"**
   - Select **Docker 24 on Ubuntu 22.04**

3. **Choose Size**:
   - Click **Regular**
   - Select **8 GB / 4 CPUs / 160 GB SSD** ($48/month)

4. **Choose Region**:
   - **New York 3** (same as databases!)

5. **Authentication**:
   - **Option A (Recommended)**: SSH Key
     - Click **New SSH Key**
     - On your computer, run:
       ```bash
       # If you don't have SSH key
       ssh-keygen -t rsa -b 4096 -C "your-email@example.com"

       # Copy public key
       cat ~/.ssh/id_rsa.pub
       ```
     - Paste the public key
     - Name it: "my-laptop"

   - **Option B (Easier)**: Password
     - Choose a strong password (16+ characters)

6. **Hostname**: `agenthunt-backend`

7. **Enable Monitoring**: ✅ Check this box (free)

8. Click **Create Droplet**

9. **Wait 1-2 minutes** for provisioning

### After Creation:

10. **Copy the droplet's IP address**:
    ```
    Example: 64.23.145.89
    ```

---

## Step 1.6: Create Frontend Droplet (OPTIONAL)

**Skip this if you only want backend API + Telegram notifications.**

1. Click **Create** → **Droplets**
2. **Image**: Ubuntu 22.04 LTS
3. **Size**: 4 GB / 2 CPUs / 80 GB SSD ($24/month)
4. **Region**: New York 3
5. **Authentication**: Same as backend (SSH key or password)
6. **Hostname**: `agenthunt-frontend`
7. **Enable Monitoring**: ✅
8. Click **Create Droplet**
9. **Copy frontend IP address**

---

## ✅ Phase 1 Complete!

You should now have:
- ✅ PostgreSQL database with connection details
- ✅ Redis with connection details
- ✅ Spaces bucket with access keys
- ✅ Backend droplet with IP address
- ✅ (Optional) Frontend droplet with IP address

**Save all these details in a text file - you'll need them next!**

---

# PHASE 2: Deploy Backend (Core System)

## Step 2.1: SSH Into Backend Droplet

Open your terminal:

```bash
# Replace with YOUR droplet IP
ssh root@64.23.145.89

# If using SSH key (first time):
# Type "yes" to trust the host

# If using password:
# Enter the password you set
```

You should now see:
```
root@agenthunt-backend:~#
```

---

## Step 2.2: Initial Server Setup

Run these commands **one by one**:

```bash
# Update system packages
apt update && apt upgrade -y

# Install essential tools
apt install -y git curl wget unzip build-essential

# Verify Docker is installed (should show version)
docker --version

# Install Docker Compose (if not present)
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
docker-compose --version

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify Node.js
node --version  # Should show v20.x.x
npm --version

# Create app directory
mkdir -p /opt/agenthunt
cd /opt/agenthunt
```

---

## Step 2.3: Clone Your Repository

```bash
# Option A: If your repo is PUBLIC
git clone https://github.com/catchmeifyoucaan/agentHunt.git .

# Option B: If your repo is PRIVATE
# You need to create a Personal Access Token first:
# 1. Go to GitHub.com → Settings → Developer Settings → Personal Access Tokens
# 2. Generate new token (classic)
# 3. Check "repo" scope
# 4. Copy the token
# Then:
git clone https://YOUR_TOKEN@github.com/catchmeifyoucaan/agentHunt.git .

# Option C: Upload files manually (if no GitHub)
# On your local computer:
scp -r /path/to/agentHunt root@64.23.145.89:/opt/agenthunt/
```

Verify files are there:
```bash
ls -la
# Should see: backend/, frontend/, docs/, etc.
```

---

## Step 2.4: Configure Environment Variables

This is the **MOST IMPORTANT** step!

```bash
# Navigate to project root
cd /opt/agenthunt

# Create .env file from your saved credentials
nano .env
```

**Copy this template and FILL IN your actual values:**

```bash
# ====================================
# SERVER
# ====================================
NODE_ENV=production
PORT=3000
API_VERSION=v1
LOG_LEVEL=info

# ====================================
# DATABASE (FROM STEP 1.2)
# ====================================
POSTGRES_HOST=agenthunt-db-do-user-XXXXXX-0.b.db.ondigitalocean.com
POSTGRES_PORT=25060
POSTGRES_USER=doadmin
POSTGRES_PASSWORD=YOUR_POSTGRES_PASSWORD_HERE
POSTGRES_DB=defaultdb
POSTGRES_SSL=true

# ====================================
# REDIS (FROM STEP 1.3)
# ====================================
REDIS_HOST=agenthunt-redis-do-user-XXXXXX-0.b.db.ondigitalocean.com
REDIS_PORT=25061
REDIS_PASSWORD=YOUR_REDIS_PASSWORD_HERE
REDIS_TLS=true

# ====================================
# SPACES (FROM STEP 1.4)
# ====================================
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_ACCESS_KEY=DO00XXXXXXXXXXXXXXXXXXXX
S3_SECRET_KEY=XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
S3_BUCKET=agenthunt-artifacts
S3_REGION=nyc3
S3_FORCE_PATH_STYLE=true

# ====================================
# AI PROVIDERS (FILL IN YOUR KEYS)
# ====================================
PERPLEXITY_API_KEY=pplx-YOUR_KEY_HERE
PERPLEXITY_MODEL=llama-3.1-sonar-huge-128k-online
ENABLE_PERPLEXITY=true

GEMINI_API_KEY=AIzaSy_YOUR_KEY_HERE
GEMINI_MODEL=gemini-1.5-pro
ENABLE_GEMINI=true

OPENAI_API_KEY=sk-proj-YOUR_KEY_HERE
OPENAI_MODEL=gpt-4o
ENABLE_OPENAI=true

ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
ENABLE_ANTHROPIC=false

TRIAGE_TEMPERATURE=0.0
MANAGER_TEMPERATURE=0.3

# ====================================
# CHAOS DB (FILL IN YOUR KEY)
# ====================================
CHAOS_API_KEY=your_chaos_key_here
CHAOS_API_URL=https://chaos.projectdiscovery.io

# ====================================
# TELEGRAM (FILL IN YOUR BOT TOKEN AND CHAT ID)
# ====================================
TELEGRAM_BOT_TOKEN=123456789:ABC_YOUR_BOT_TOKEN_HERE
TELEGRAM_CRITICAL_CHANNEL=YOUR_CHAT_ID_HERE
TELEGRAM_HIGH_CHANNEL=YOUR_CHAT_ID_HERE
TELEGRAM_OPS_CHANNEL=YOUR_CHAT_ID_HERE

# ====================================
# SECURITY
# ====================================
JWT_SECRET=YOUR_RANDOM_SECRET_HERE_USE_COMMAND_BELOW
JWT_EXPIRES_IN=24h
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# ====================================
# WORKER CONFIG
# ====================================
MAX_CONCURRENT_JOBS=20
WORKER_CONCURRENCY=10
JOB_TIMEOUT_MS=3600000
JOB_RETRY_ATTEMPTS=3

# ====================================
# TOOL PATHS
# ====================================
CHAOS_CLIENT_PATH=/usr/local/bin/chaos-client
SUBFINDER_PATH=/usr/local/bin/subfinder
NUCLEI_PATH=/usr/local/bin/nuclei
HTTPX_PATH=/usr/local/bin/httpx
KATANA_PATH=/usr/local/bin/katana
NAABU_PATH=/usr/local/bin/naabu
DNSX_PATH=/usr/local/bin/dnsx
TLSX_PATH=/usr/local/bin/tlsx
SHUFFLEDNS_PATH=/usr/local/bin/shuffledns
MASSDNS_PATH=/usr/local/bin/massdns

NUCLEI_TEMPLATES_PATH=/app/tools/templates/nuclei
WORDLIST_PATH=/app/tools/wordlists

# ====================================
# SAFETY
# ====================================
ENABLE_TIER_3_TEMPLATES=false
REQUIRE_HUMAN_APPROVAL_HIGH=true
REQUIRE_HUMAN_APPROVAL_CRITICAL=true
MAX_FUZZING_CONCURRENCY=30

# ====================================
# INTERACTSH
# ====================================
INTERACTSH_SERVER=oast.pro
INTERACTSH_TOKEN=

# ====================================
# FEATURES
# ====================================
ENABLE_BRUTEFORCE=false
ENABLE_PORT_SCANNING=false
ENABLE_FUZZING=true
ENABLE_AI_TRIAGE=true
ENABLE_AUTO_CONFIRM=true

# ====================================
# HACKERONE (Optional)
# ====================================
HACKERONE_API_TOKEN=your_hackerone_token_here
HACKERONE_API_USERNAME=your_username_here

# ====================================
# CORS (if using frontend)
# ====================================
CORS_ORIGIN=*
FRONTEND_URL=http://64.23.145.89:3001
```

**Generate JWT Secret:**
```bash
# Exit nano (Ctrl+X)
# Generate random secret
openssl rand -base64 32

# Copy the output
# Example: K7mL9pQ2rS5tU8vW0xY3zA6bC9dE2fG5hJ8kL1mN4oP7

# Edit .env again
nano .env

# Replace JWT_SECRET=YOUR_RANDOM_SECRET_HERE_USE_COMMAND_BELOW
# With: JWT_SECRET=K7mL9pQ2rS5tU8vW0xY3zA6bC9dE2fG5hJ8kL1mN4oP7
```

**Save the file:**
- Press `Ctrl + X`
- Press `Y` (yes to save)
- Press `Enter` (confirm filename)

---

## Step 2.5: Install Dependencies

```bash
# Navigate to backend
cd /opt/agenthunt/backend

# Install Node.js packages
npm install

# This will take 2-3 minutes
# You'll see progress bars installing packages
```

---

## Step 2.6: Build the Application

```bash
# Still in /opt/agenthunt/backend

# Build TypeScript to JavaScript
npm run build

# Should show:
# "Successfully compiled X files"
```

---

## Step 2.7: Setup Database

```bash
# Run database migrations
npm run migrate

# You should see:
# "Migration successful" or "Database initialized"
```

**If you get connection errors:**
1. Check your PostgreSQL credentials in `.env`
2. Make sure Trusted Sources allows your droplet IP
3. Go to DO > Databases > agenthunt-db > Settings > Trusted Sources
4. Add your droplet IP: `64.23.145.89`

---

## Step 2.8: Install PM2 (Process Manager)

```bash
# Install PM2 globally
npm install -g pm2

# Verify
pm2 --version
```

---

## Step 2.9: Start the Backend

```bash
# Still in /opt/agenthunt/backend

# Start API server
pm2 start dist/index.js --name agenthunt-api

# Start workers (4 instances for parallel processing)
pm2 start dist/workers.js --name agenthunt-workers -i 4

# View status
pm2 status

# Should show:
# ┌────┬─────────────────────┬──────────┬──────┐
# │ id │ name                │ status   │ cpu  │
# ├────┼─────────────────────┼──────────┼──────┤
# │ 0  │ agenthunt-api       │ online   │ 0%   │
# │ 1  │ agenthunt-workers   │ online   │ 0%   │
# └────┴─────────────────────┴──────────┴──────┘

# View logs
pm2 logs

# Check for errors
# Should see: "Server listening on port 3000"
```

---

## Step 2.10: Configure PM2 Auto-Start

```bash
# Save PM2 process list
pm2 save

# Generate startup script (auto-start on reboot)
pm2 startup

# Copy and run the command it outputs
# Example: sudo env PATH=$PATH:/usr/bin pm2 startup...
```

---

## Step 2.11: Test the Backend

```bash
# Test health endpoint
curl http://localhost:3000/health

# Should return:
# {"status":"healthy","timestamp":"...","aiProviders":["perplexity","gemini","openai"]}

# Test from your local computer (replace with YOUR droplet IP)
curl http://64.23.145.89:3000/health
```

**If curl fails:**
```bash
# Open firewall port
ufw allow 3000
ufw status
```

---

## ✅ Phase 2 Complete!

Your backend is now running 24/7 on Digital Ocean! 🎉

**Test it:**
```bash
# View logs
pm2 logs agenthunt-api --lines 50

# View worker logs
pm2 logs agenthunt-workers --lines 50

# Restart if needed
pm2 restart all

# Stop if needed
pm2 stop all
```

---

# PHASE 3: Deploy Frontend (OPTIONAL)

**Skip this if you only want API + Telegram.**

## Step 3.1: SSH Into Frontend Droplet

```bash
# On your local computer
ssh root@YOUR_FRONTEND_IP

# Example:
ssh root@64.23.145.90
```

---

## Step 3.2: Setup Frontend Server

```bash
# Update system
apt update && apt upgrade -y

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs git

# Verify
node --version

# Create directory
mkdir -p /opt/agenthunt-frontend
cd /opt/agenthunt-frontend
```

---

## Step 3.3: Clone Repository

```bash
# Clone (same methods as backend)
git clone https://github.com/catchmeifyoucaan/agentHunt.git .

# Navigate to frontend
cd frontend
```

---

## Step 3.4: Configure Frontend Environment

```bash
# Create production env file
nano .env.production.local
```

**Add this:**
```bash
# Point to your BACKEND droplet IP
NEXT_PUBLIC_API_URL=http://64.23.145.89:3000

NODE_ENV=production
```

Save: `Ctrl+X`, `Y`, `Enter`

---

## Step 3.5: Build and Start Frontend

```bash
# Install dependencies
npm install

# Build for production
npm run build

# This takes 3-5 minutes

# Install PM2
npm install -g pm2

# Start frontend
pm2 start npm --name agenthunt-frontend -- start

# Save
pm2 save
pm2 startup
# Run the command it outputs

# Check status
pm2 status

# Frontend runs on port 3000 by default
```

---

## Step 3.6: Test Frontend

```bash
# Local test
curl http://localhost:3000

# From your computer (replace with YOUR frontend IP)
# Open browser: http://64.23.145.90:3000
```

---

## ✅ Phase 3 Complete!

Frontend is now live! Access it at: `http://YOUR_FRONTEND_IP:3000`

---

# PHASE 4: Configure Domain & SSL (OPTIONAL)

Skip this if you're okay with IP addresses.

## Step 4.1: Point Domain to Digital Ocean

**At your domain registrar** (Namecheap, GoDaddy, etc.):

1. Go to domain settings
2. Change nameservers to:
   ```
   ns1.digitalocean.com
   ns2.digitalocean.com
   ns3.digitalocean.com
   ```
3. Save (takes 24-48 hours to propagate)

---

## Step 4.2: Add Domain in Digital Ocean

1. Digital Ocean dashboard → **Networking** → **Domains**
2. Click **Add Domain**
3. Enter your domain: `example.com`
4. Click **Add Domain**

---

## Step 4.3: Create DNS Records

Add these records:

```
Type: A
Hostname: api
Value: 64.23.145.89 (your BACKEND IP)
TTL: 3600

Type: A
Hostname: app (or www)
Value: 64.23.145.90 (your FRONTEND IP)
TTL: 3600
```

---

## Step 4.4: Install SSL Certificates

**On Backend Droplet:**

```bash
# SSH into backend
ssh root@64.23.145.89

# Install Certbot
apt install -y certbot python3-certbot-nginx

# Install Nginx
apt install -y nginx

# Configure Nginx for API
nano /etc/nginx/sites-available/agenthunt-api
```

Add:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

```bash
# Enable site
ln -s /etc/nginx/sites-available/agenthunt-api /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx

# Get SSL certificate
certbot --nginx -d api.yourdomain.com

# Follow prompts, choose redirect HTTP to HTTPS
```

**Repeat for Frontend Droplet** with `app.yourdomain.com`

---

## ✅ Phase 4 Complete!

You now have:
- ✅ https://api.yourdomain.com
- ✅ https://app.yourdomain.com

---

# 🎯 **QUICK START AFTER DEPLOYMENT**

## 1. Create Your First Program

```bash
curl -X POST http://64.23.145.89:3000/api/v1/programs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Program",
    "slug": "my-first",
    "platform": "hackerone",
    "scope": {
      "domains": ["example.com"],
      "wildcardDomains": ["*.example.com"]
    },
    "policy": {
      "allowedActions": {
        "passiveDiscovery": true,
        "activeDiscovery": false,
        "crawling": true,
        "fuzzing": true
      },
      "allowedSources": ["chaosdb", "subfinder"],
      "allowedTemplates": {
        "tier0": true,
        "tier1": true,
        "tier2": true
      }
    }
  }'
```

Copy the `"id"` from response.

---

## 2. Start Discovery Job

```bash
# Replace PROGRAM_ID with the ID from step 1
curl -X POST http://64.23.145.89:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "discovery",
    "program_id": "PROGRAM_ID",
    "priority": 8,
    "options": {
      "sources": ["chaosdb", "subfinder"],
      "maxAssets": 50000
    }
  }'
```

---

## 3. Watch Telegram for Findings!

You'll start receiving notifications in your Telegram chat (`7816748513`) as findings are discovered and triaged.

---

# 🔧 **TROUBLESHOOTING**

## Backend won't start

```bash
# Check logs
pm2 logs agenthunt-api --lines 100

# Common issues:
# 1. Database connection failed → Check POSTGRES_* in .env
# 2. Redis connection failed → Check REDIS_* in .env
# 3. Port already in use → pm2 delete all && pm2 start...
```

## Can't connect to droplet

```bash
# Check firewall
ufw status

# Allow SSH
ufw allow ssh
ufw allow 3000
ufw enable

# Check if services are running
pm2 status
```

## Database migration fails

```bash
# Check if database is accessible
cd /opt/agenthunt/backend
node -e "const { Client } = require('pg'); const client = new Client({ connectionString: 'postgresql://doadmin:PASSWORD@HOST:25060/defaultdb?sslmode=require' }); client.connect().then(() => console.log('Connected!')).catch(console.error);"

# If fails, add droplet IP to Trusted Sources in DO dashboard
```

## Out of memory

```bash
# Check memory usage
free -h

# If low, resize droplet:
# DO Dashboard → Droplets → agenthunt-backend → Resize
# Choose larger plan

# Or reduce workers:
pm2 delete agenthunt-workers
pm2 start dist/workers.js --name agenthunt-workers -i 2
pm2 save
```

---

# 📊 **MONITORING**

## Check System Status

```bash
# SSH into droplet
ssh root@64.23.145.89

# Check services
pm2 status

# Check logs
pm2 logs

# Check memory/CPU
htop

# Check disk space
df -h

# Check network
netstat -tulpn | grep 3000
```

## Digital Ocean Monitoring

1. DO Dashboard → Droplets → agenthunt-backend
2. Click **Graphs** tab
3. View:
   - CPU usage
   - Memory usage
   - Disk I/O
   - Network bandwidth

Set up alerts:
1. Click **Alerts**
2. Add alert rules:
   - CPU > 80% for 5 minutes
   - Memory > 90% for 5 minutes
   - Disk > 85%

---

# 🔐 **SECURITY CHECKLIST**

After deployment:

```bash
# 1. Setup firewall
ufw enable
ufw allow ssh
ufw allow 3000
ufw status

# 2. Disable root login (optional but recommended)
adduser agenthunt
usermod -aG sudo agenthunt
# Edit SSH config
nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
systemctl restart sshd

# 3. Setup automatic updates
apt install unattended-upgrades
dpkg-reconfigure --priority=low unattended-upgrades

# 4. Setup fail2ban (prevent brute force)
apt install fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

---

# 💾 **BACKUP STRATEGY**

## Automated Backups

Digital Ocean automatically backs up:
- ✅ PostgreSQL database (daily, 7-day retention)
- ✅ Redis database (daily, 7-day retention)

For droplets:

```bash
# Create snapshot
# DO Dashboard → Droplets → agenthunt-backend → Snapshots
# Click "Take Snapshot"

# Or via CLI
doctl compute droplet-action snapshot <droplet-id> --snapshot-name "backup-$(date +%F)"
```

Schedule weekly snapshots with cron:
```bash
crontab -e

# Add this line (runs every Sunday at 2 AM)
0 2 * * 0 doctl compute droplet-action snapshot 12345678 --snapshot-name "weekly-$(date +\%F)"
```

---

# 📝 **MAINTENANCE**

## Weekly Tasks

```bash
# SSH into droplet
ssh root@64.23.145.89

# Update system packages
apt update && apt upgrade -y

# Check disk space
df -h

# Check logs for errors
pm2 logs --lines 100 --err

# Restart if needed
pm2 restart all
```

## Monthly Tasks

- Review Digital Ocean billing
- Check for security updates
- Review backup snapshots
- Clean up old logs:
  ```bash
  pm2 flush  # Clear PM2 logs
  ```

---

# 🎉 **DEPLOYMENT COMPLETE!**

You now have AgentHunt running 24/7 on Digital Ocean!

## What's Running:

- ✅ **API Server**: `http://64.23.145.89:3000`
- ✅ **Workers**: 4 parallel instances processing jobs
- ✅ **PostgreSQL**: Managed database with automatic backups
- ✅ **Redis**: Job queue and caching
- ✅ **Spaces**: File storage for artifacts
- ✅ **Telegram**: Real-time notifications
- ✅ **Multi-AI**: Perplexity → Gemini → OpenAI fallback

## Costs:

- Backend Droplet: $48/month
- PostgreSQL: $60/month
- Redis: $15/month
- Spaces: $5/month
- **Total: $128/month**

## Next Steps:

1. Create your first bug bounty program
2. Start discovery jobs
3. Receive findings via Telegram
4. Review and export findings
5. Submit to bug bounty platforms

---

**Need help?** Check logs with `pm2 logs` or review the troubleshooting section above.
