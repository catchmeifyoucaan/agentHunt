# 🔑 API Keys Setup Guide

This guide shows you how to obtain all API keys needed for AgentHunt deployment.

---

## ✅ Required API Keys

### 1. Anthropic Claude API Key (REQUIRED)

**Purpose**: AI-powered triage and Manager orchestration

**How to get:**
1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to **Settings** > **API Keys**
4. Click **Create Key**
5. Name it "AgentHunt Production"
6. Copy the key (starts with `sk-ant-api03-`)

**In your .env:**
```bash
ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ANTHROPIC_MODEL=claude-sonnet-4-5-20250929
```

**Cost**: Pay-as-you-go (~$0.003 per finding triaged)

---

### 2. Chaos DB API Key (REQUIRED)

**Purpose**: Subdomain discovery from Chaos dataset

**How to get:**
1. Go to https://chaos.projectdiscovery.io/
2. Sign up with GitHub
3. Navigate to **API Keys**
4. Click **Generate New Key**
5. Copy the key

**In your .env:**
```bash
CHAOS_API_KEY=your_chaos_api_key_here
CHAOS_API_URL=https://chaos.projectdiscovery.io
```

**Cost**: Free tier available, paid plans for commercial use

---

### 3. Telegram Bot Token (HIGHLY RECOMMENDED)

**Purpose**: Real-time notifications for findings

**How to get:**
1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow prompts:
   - Bot name: **AgentHunt Bot**
   - Username: **agenthunt_yourname_bot**
4. Copy the token (format: `123456789:ABCdefGHI...`)

**Create Notification Channels:**
1. Create 3 private channels:
   - "AgentHunt Critical" (for critical findings)
   - "AgentHunt High" (for high severity)
   - "AgentHunt Ops" (for operational alerts)

2. Add your bot as admin to each channel

3. Get channel IDs:
   - Forward a message from each channel to **@userinfobot**
   - Copy the channel ID (format: `-1001234567890`)

**In your .env:**
```bash
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz1234567890
TELEGRAM_CRITICAL_CHANNEL=-1001234567890
TELEGRAM_HIGH_CHANNEL=-1001234567891
TELEGRAM_OPS_CHANNEL=-1001234567892
```

**Cost**: Free

---

### 4. Digital Ocean Spaces Keys (REQUIRED for Production)

**Purpose**: S3-compatible storage for artifacts

**How to get:**
1. Log in to Digital Ocean
2. Go to **API** > **Spaces Keys**
3. Click **Generate New Key**
4. Name it "agenthunt-backend"
5. Copy **Access Key** and **Secret Key**

**Create Space:**
1. Go to **Spaces** > **Create Space**
2. Select region (e.g., NYC3)
3. Name: `agenthunt-artifacts`
4. Enable CDN: Yes
5. Restrict file listing: Yes

**In your .env:**
```bash
S3_ENDPOINT=https://nyc3.digitaloceanspaces.com
S3_ACCESS_KEY=your_spaces_access_key
S3_SECRET_KEY=your_spaces_secret_key
S3_BUCKET=agenthunt-artifacts
S3_REGION=nyc3
S3_FORCE_PATH_STYLE=true
```

**Cost**: $5/month for 250GB + CDN

---

## ❌ Optional API Keys

### 5. HackerOne API (Optional)

**Purpose**: Auto-sync programs and submit reports

**How to get:**
1. Log in to HackerOne
2. Go to **Settings** > **API Tokens**
3. Click **Create API Token**
4. Select permissions:
   - Read programs
   - Submit reports
5. Copy **Identifier** (username) and **Token**

**In your .env:**
```bash
HACKERONE_API_USERNAME=your_api_identifier
HACKERONE_API_TOKEN=your_api_token
```

**Cost**: Free (requires HackerOne account)

---

### 6. Bugcrowd API (Optional)

**Purpose**: Auto-sync programs and submit vulnerabilities

**How to get:**
1. Log in to Bugcrowd
2. Go to **Settings** > **API Access**
3. Click **Generate API Credentials**
4. Copy **API Key** and **API Secret**

**In your .env:**
```bash
BUGCROWD_API_KEY=your_api_key
BUGCROWD_API_SECRET=your_api_secret
```

**Cost**: Free (requires Bugcrowd researcher account)

---

### 7. Interactsh Token (Optional)

**Purpose**: Custom Interactsh server for OOB testing

**Default**: Uses `oast.pro` (public server) if not set

**How to get:**
1. Deploy your own Interactsh server
2. Generate token from server

**In your .env:**
```bash
INTERACTSH_SERVER=oast.pro
INTERACTSH_TOKEN=
```

**Cost**: Free (public server), self-hosted if custom

---

## 🔐 Security Best Practices

### Generate Strong JWT Secret

```bash
# Generate random secret
openssl rand -base64 32

# Add to .env
JWT_SECRET=<generated_secret>
```

### Store Secrets Securely

**❌ DON'T:**
- Commit `.env` file to Git
- Share API keys in public channels
- Use same keys for dev and production

**✅ DO:**
- Use `.env.example` for templates
- Store production keys in secure vault
- Rotate keys regularly
- Use different keys per environment

### Environment Variables Checklist

```bash
# Verify all required keys are set
cd /opt/agenthunt/backend
node -e "
const required = [
  'ANTHROPIC_API_KEY',
  'CHAOS_API_KEY',
  'POSTGRES_HOST',
  'POSTGRES_PASSWORD',
  'REDIS_HOST',
  'REDIS_PASSWORD',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'JWT_SECRET'
];

require('dotenv').config();
const missing = required.filter(k => !process.env[k]);
if (missing.length) {
  console.error('❌ Missing keys:', missing.join(', '));
  process.exit(1);
} else {
  console.log('✅ All required keys present');
}
"
```

---

## 💰 Cost Summary

| Service | Tier | Monthly Cost |
|---------|------|--------------|
| **Anthropic Claude** | Pay-per-use | ~$5-20/month |
| **Chaos DB** | Free | $0/month |
| **Telegram Bot** | Free | $0/month |
| **DO Spaces** | 250GB + CDN | $5/month |
| **HackerOne API** | Free | $0/month |
| **Bugcrowd API** | Free | $0/month |
| **Total APIs** | | **~$10-25/month** |

> Add infrastructure costs: ~$150/month (see DIGITAL_OCEAN_DEPLOYMENT.md)

---

## 🧪 Test Your Setup

After adding all keys:

```bash
# Test Anthropic API
curl https://api.anthropic.com/v1/messages \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "content-type: application/json" \
  -d '{"model":"claude-sonnet-4-5-20250929","max_tokens":10,"messages":[{"role":"user","content":"Hi"}]}'

# Test Chaos API
curl -H "Authorization: $CHAOS_API_KEY" \
  https://chaos.projectdiscovery.io/api/v1/programs

# Test Telegram Bot
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -d "chat_id=$TELEGRAM_OPS_CHANNEL" \
  -d "text=AgentHunt is online! 🎯"

# Test Spaces (requires AWS CLI)
aws s3 ls --endpoint-url $S3_ENDPOINT \
  --no-verify-ssl \
  s3://$S3_BUCKET/
```

---

## ❓ FAQ

**Q: Do I need all API keys before deploying?**
A: Only Anthropic and Chaos are required. Telegram is highly recommended.

**Q: Can I use AWS S3 instead of Spaces?**
A: Yes! Just update `S3_ENDPOINT` to AWS endpoint.

**Q: What if I hit rate limits?**
A: Adjust `RATE_LIMIT_*` settings in .env or upgrade API tiers.

**Q: Are keys stored encrypted?**
A: Keys are read from `.env` at runtime, not stored in database.

---

**✅ Once all keys are configured, proceed to deployment!**

See: `docs/DIGITAL_OCEAN_DEPLOYMENT.md`
