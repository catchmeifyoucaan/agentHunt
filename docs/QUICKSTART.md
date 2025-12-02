# AgentHunt Quick Start Guide

Get AgentHunt up and running in 5 minutes!

## Step 1: Prerequisites

Ensure you have:
- **Docker**: 24.x or higher
- **Docker Compose**: 2.x or higher
- **Anthropic API Key**: Get one at https://console.anthropic.com/
- **Chaos API Key**: (Optional) Get one at https://chaos.projectdiscovery.io/

## Step 2: Clone and Configure

```bash
# Clone repository
git clone https://github.com/yourusername/agentHunt.git
cd agentHunt

# Create environment file
cp .env.example .env

# Edit .env and add your API keys
nano .env
```

**Required variables:**
```bash
ANTHROPIC_API_KEY=sk-ant-your-key-here
CHAOS_API_KEY=your-chaos-key-here  # Optional but recommended
```

## Step 3: Start Services

```bash
cd infrastructure/docker
docker-compose up -d
```

This starts:
- PostgreSQL (database)
- Redis (job queue)
- MinIO (S3 storage)
- API Server (port 3000)
- Workers (2 replicas)

Wait ~30 seconds for all services to initialize.

## Step 4: Verify Installation

```bash
curl http://localhost:3000/health
```

Expected output:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-06T12:00:00.000Z",
  "version": "v1"
}
```

## Step 5: Create Your First Program

```bash
curl -X POST http://localhost:3000/api/v1/programs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Program",
    "slug": "test",
    "platform": "other",
    "scope": {
      "domains": ["example.com"],
      "wildcardDomains": ["*.example.com"],
      "excludedDomains": [],
      "maxAssets": 10000
    },
    "policy": {
      "allowedActions": {
        "passiveDiscovery": true,
        "crawling": true,
        "fuzzing": false
      },
      "allowedTemplates": {
        "tier0": true,
        "tier1": true,
        "tier2": false,
        "tier3": false
      }
    }
  }'
```

Save the returned `id` - you'll need it!

## Step 6: Run Discovery

Replace `PROGRAM_ID` with the ID from step 5:

```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "discovery",
    "program_id": "PROGRAM_ID",
    "options": {
      "sources": ["subfinder"],
      "maxAssets": 1000
    }
  }'
```

## Step 7: Monitor Progress

### Option A: Check Job Status (REST API)

```bash
curl http://localhost:3000/api/v1/jobs?program_id=PROGRAM_ID
```

### Option B: Watch Real-Time Events (WebSocket)

Create `watch.html`:
```html
<!DOCTYPE html>
<html>
<body>
  <h1>AgentHunt Live Feed</h1>
  <pre id="output"></pre>
  <script>
    const ws = new WebSocket('ws://localhost:3000/events');
    const output = document.getElementById('output');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      output.textContent += JSON.stringify(data, null, 2) + '\n\n';
    };
  </script>
</body>
</html>
```

Open in browser: `file:///path/to/watch.html`

## Step 8: View Results

```bash
# View discovered assets
curl "http://localhost:3000/api/v1/programs/PROGRAM_ID/assets?limit=10"

# View findings (if scanner jobs were run)
curl "http://localhost:3000/api/v1/programs/PROGRAM_ID/findings?limit=10"
```

## Step 9: Use Manager AI (Optional)

```bash
curl -X POST http://localhost:3000/api/v1/manager/command \
  -H "Content-Type: application/json" \
  -d '{
    "command": "Show me the status of my program",
    "program_id": "PROGRAM_ID",
    "user_id": "me"
  }'
```

Manager AI will respond with a natural language summary!

## Next Steps

### Run a Full Recon Pipeline

```bash
# 1. Discovery
curl -X POST http://localhost:3000/api/v1/jobs -H "Content-Type: application/json" -d '{"type":"discovery","program_id":"PROGRAM_ID","options":{"sources":["subfinder"],"maxAssets":5000}}'

# Wait for discovery to complete, then:

# 2. Fingerprint (get list of subdomains from assets endpoint first)
curl -X POST http://localhost:3000/api/v1/jobs -H "Content-Type: application/json" -d '{"type":"fingerprint","program_id":"PROGRAM_ID","options":{"assets":["sub1.example.com","sub2.example.com"],"tools":["httpx"],"concurrency":100,"followRedirects":true}}'

# 3. Scanner (create URLs file in S3 or use Manager AI)
# Use Manager AI for easier workflow:
curl -X POST http://localhost:3000/api/v1/manager/command -H "Content-Type: application/json" -d '{"command":"Run fast nuclei scan on all alive hosts for program test","program_id":"PROGRAM_ID","user_id":"me"}'
```

### Configure Telegram Notifications

1. Create a Telegram bot via [@BotFather](https://t.me/BotFather)
2. Get your bot token
3. Create a private channel and add your bot as admin
4. Get the channel ID (use [@userinfobot](https://t.me/userinfobot))
5. Update `.env`:
   ```bash
   TELEGRAM_BOT_TOKEN=your_bot_token
   TELEGRAM_CRITICAL_CHANNEL=-1001234567890
   TELEGRAM_HIGH_CHANNEL=-1001234567891
   ```
6. Restart services:
   ```bash
   docker-compose restart api workers
   ```

### Explore the Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [API Reference](docs/API.md)
- [Full README](README.md)

## Common Issues

### "Database connection failed"

**Solution**: Wait 30 seconds for PostgreSQL to fully initialize, then restart API:
```bash
docker-compose restart api
```

### "Nuclei templates not found"

**Solution**: Templates are downloaded during Docker build. If missing:
```bash
docker-compose exec workers nuclei -update-templates
```

### "Rate limit exceeded"

**Solution**: Wait 15 minutes or increase limit in `.env`:
```bash
RATE_LIMIT_MAX_REQUESTS=200
```

## Stopping Services

```bash
cd infrastructure/docker
docker-compose down

# To also remove volumes (WARNING: deletes all data):
docker-compose down -v
```

## Getting Help

- **Issues**: https://github.com/yourusername/agentHunt/issues
- **Discord**: https://discord.gg/agenthunt
- **Docs**: https://docs.agenthunt.io

Happy hunting! 🎯
