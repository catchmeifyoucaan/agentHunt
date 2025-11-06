# 🎯 AgentHunt

**Advanced AI-Driven Security Orchestration Platform with Multi-Agent Architecture**

AgentHunt is a next-generation bug bounty and security testing platform that uses AI-driven agents to orchestrate comprehensive security assessments. It combines the power of industry-leading security tools with Claude AI for intelligent triage and conversational command orchestration.

## 🚀 Features

### Multi-Agent Architecture
- **Discovery Agent**: Passive subdomain enumeration (Chaos DB, Subfinder, Uncover, Cloudlist)
- **Bruteforce Agent**: Active DNS resolution with wordlists (Shuffledns, Massdns, Alterx)
- **Fingerprint Agent**: Technology detection and asset profiling (HTTPx, TLSx, Wappalyzer, CDN detection)
- **Crawl Agent**: Deep web application crawling (Katana)
- **Scanner Agent**: Vulnerability scanning with tiered template gating (Nuclei)
- **Interact Agent**: Out-of-band interaction detection (Interactsh)
- **Confirm Agent**: Multi-method vulnerability confirmation
- **Triage Agent**: AI-powered finding analysis and PoC generation (Claude)
- **Manager Agent**: Conversational orchestration and policy enforcement

### AI-Powered Capabilities
- **Intelligent Triage**: Claude AI parses scanner outputs, assigns severity/confidence, and generates PoCs
- **Conversational Commands**: Natural language interface for orchestrating scans
- **Auto-Confirmation**: Automatic validation of findings with multi-method verification
- **False Positive Reduction**: ML-based confidence scoring and duplicate detection

### Safety & Compliance
- **Template Tiering**: 4-tier system (Tier 0-3) with policy-based gating
- **Human Approval Workflow**: Required approvals for high-impact actions
- **Scope Management**: Automatic scope enforcement and rate limiting
- **Audit Logging**: Complete audit trail of all actions and decisions

### Real-Time Monitoring
- **Live Event Streaming**: WebSocket-based terminal output
- **Progress Tracking**: Real-time job status and finding notifications
- **Telegram Integration**: Instant notifications for critical/high findings
- **Queue Management**: Dynamic concurrency control and job prioritization

### Enterprise-Ready
- **Scalable Architecture**: Horizontal worker scaling with BullMQ
- **S3-Compatible Storage**: All artifacts stored in MinIO/S3
- **PostgreSQL Database**: Robust data persistence with full-text search
- **Docker Compose**: Single-command deployment
- **Kubernetes Ready**: Production-grade orchestration support

## 📋 Architecture

```
┌─────────────────┐
│  Frontend UI    │
│  (Chat/Terminal)│
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Express API + WebSocket          │
│  - REST endpoints                        │
│  - Real-time events                      │
│  - Manager AI interface                  │
└──────────┬──────────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────┐
│         BullMQ Job Queue (Redis)         │
│  - Job scheduling                        │
│  - Priority queues                       │
│  - Retry logic                           │
└──────────┬───────────────────────────────┘
           │
           ▼
┌────────────────────────────────────────────────┐
│              Worker Processes                   │
│  ┌──────────────┬──────────────┬─────────────┐ │
│  │  Discovery   │ Fingerprint  │   Crawl     │ │
│  │  Scanner     │   Confirm    │   Triage    │ │
│  └──────────────┴──────────────┴─────────────┘ │
└────────────┬───────────────────────────────────┘
             │
    ┌────────┼────────┬────────────┐
    ▼        ▼        ▼            ▼
┌────────┐ ┌────┐ ┌─────┐ ┌──────────────┐
│Postgres│ │ S3 │ │Redis│ │  Claude API  │
│  DB    │ │    │ │     │ │   (Triage)   │
└────────┘ └────┘ └─────┘ └──────────────┘
```

## 🛠️ Prerequisites

- **Node.js**: 20.x or higher
- **Docker**: 24.x or higher
- **Docker Compose**: 2.x or higher
- **Anthropic API Key**: For AI triage and Manager AI
- **Chaos API Key**: For Chaos DB asset discovery
- **Telegram Bot Token**: (Optional) For notifications

## 🚀 Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/yourusername/agentHunt.git
cd agentHunt
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your API keys
```

Required environment variables:
```bash
ANTHROPIC_API_KEY=your_anthropic_key
CHAOS_API_KEY=your_chaos_key
TELEGRAM_BOT_TOKEN=your_telegram_token  # Optional
TELEGRAM_CRITICAL_CHANNEL=-1001234567890  # Optional
```

### 3. Start services

```bash
cd infrastructure/docker
docker-compose up -d
```

This will start:
- PostgreSQL database
- Redis queue
- MinIO S3 storage
- API server (port 3000)
- Worker processes (2 replicas)

### 4. Verify installation

```bash
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "healthy",
  "timestamp": "2025-11-06T12:00:00.000Z",
  "version": "v1"
}
```

### 5. Create your first program

```bash
curl -X POST http://localhost:3000/api/v1/programs \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Example Corp Bug Bounty",
    "slug": "examplecorp",
    "platform": "hackerone",
    "scope": {
      "domains": ["example.com"],
      "wildcardDomains": ["*.example.com"],
      "excludedDomains": ["admin.example.com"],
      "maxAssets": 100000
    },
    "policy": {
      "allowedActions": {
        "passiveDiscovery": true,
        "activeDiscovery": false,
        "bruteforce": false,
        "portScanning": false,
        "crawling": true,
        "fuzzing": true,
        "oobTesting": true
      },
      "allowedSources": ["chaosdb", "subfinder"],
      "allowedTemplates": {
        "tier0": true,
        "tier1": true,
        "tier2": true,
        "tier3": false
      },
      "requireHumanApproval": {
        "tier2": false,
        "tier3": true,
        "highSeverity": true,
        "criticalSeverity": true
      },
      "rateLimit": {
        "maxConcurrentScans": 10,
        "maxRequestsPerSecond": 100,
        "respectRateLimit": true
      }
    }
  }'
```

### 6. Start a discovery job

```bash
curl -X POST http://localhost:3000/api/v1/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "discovery",
    "program_id": "YOUR_PROGRAM_ID",
    "priority": 8,
    "options": {
      "sources": ["chaosdb", "subfinder"],
      "maxAssets": 50000,
      "timeout": 3600
    }
  }'
```

### 7. Use Manager AI (Conversational Interface)

```bash
curl -X POST http://localhost:3000/api/v1/manager/command \
  -H "Content-Type: application/json" \
  -d '{
    "command": "Start discovery for program examplecorp using chaosdb and subfinder, then run httpx on all alive hosts",
    "program_id": "YOUR_PROGRAM_ID",
    "user_id": "researcher-1"
  }'
```

Manager AI will:
1. Parse your natural language command
2. Create appropriate jobs
3. Execute them in the correct order
4. Provide conversational updates

## 📚 Agent Workflows

### Full Recon → Scan → Triage Pipeline

```bash
# 1. Discovery (passive)
POST /api/v1/jobs
{
  "type": "discovery",
  "program_id": "...",
  "options": {
    "sources": ["chaosdb", "subfinder", "uncover"],
    "maxAssets": 100000
  }
}

# 2. Fingerprint alive hosts
POST /api/v1/jobs
{
  "type": "fingerprint",
  "program_id": "...",
  "options": {
    "assets": ["subdomain1.example.com", "subdomain2.example.com"],
    "tools": ["httpx", "tlsx", "cdncheck"],
    "concurrency": 300,
    "followRedirects": true
  }
}

# 3. Crawl for endpoints
POST /api/v1/jobs
{
  "type": "crawl",
  "program_id": "...",
  "options": {
    "targetUrls": ["https://app.example.com"],
    "depth": 3,
    "respectRobots": true,
    "maxUrls": 10000
  }
}

# 4. Scan with Nuclei (fast templates)
POST /api/v1/jobs
{
  "type": "scanner",
  "program_id": "...",
  "options": {
    "inputUrlsFile": "s3://bucket/urls_123.txt",
    "templateSet": "fast",
    "tier": "tier1",
    "concurrency": 50,
    "interactshEnabled": true
  }
}

# Triage Agent automatically processes findings
# Confirm Agent automatically validates high-confidence findings
# Telegram notifications sent for critical/high findings
```

## 🎯 Template Tiering System

| Tier | Description | Examples | Requires Approval |
|------|-------------|----------|-------------------|
| **Tier 0** | Fingerprinting only | Tech detection, version enumeration | No |
| **Tier 1** | Detection templates (read-only) | XSS detection, SQLi detection, misconfigurations | No |
| **Tier 2** | Fuzzing templates (state-changing inputs) | Parameter fuzzing, header injection | Program opt-in |
| **Tier 3** | Active exploitation | Privilege escalation, RCE | Written consent + human approval |

### Safety Rules

1. **Tier 3 templates are DISABLED by default** and require:
   - Written authorization uploaded to platform
   - Human approval for each execution
   - Separate worker pool isolation

2. **Tier 2 templates require program opt-in**:
   - `policy.allowedTemplates.tier2 = true`
   - Optional human approval per program policy

3. **All scans respect program scope**:
   - Automatic filtering of out-of-scope assets
   - Rate limiting enforcement
   - Scope violation alerts

## 📊 Monitoring & Telemetry

### Real-Time Events (WebSocket)

Connect to `ws://localhost:3000/events` to receive:

```javascript
// Job status updates
{
  "type": "job_status",
  "jobId": "...",
  "status": "active",
  "timestamp": "2025-11-06T12:00:00Z"
}

// Finding events
{
  "type": "finding",
  "finding": {
    "id": "...",
    "severity": "high",
    "title": "SQL Injection in /api/users",
    "confidence": 0.92
  }
}

// Live logs
{
  "type": "log",
  "level": "info",
  "tool": "nuclei",
  "context": "api.example.com",
  "message": "templates:324 findings:12 runtime:45.2s"
}

// Progress tracking
{
  "type": "progress",
  "operation": "nuclei_scan",
  "current": 1250,
  "total": 5000,
  "percentage": 25,
  "eta": 180
}

// Human action requests
{
  "type": "human_action_request",
  "action": "enable_tier2_templates",
  "reason": "User requested fuzzing templates",
  "requiredApproval": true,
  "options": ["approve", "reject"]
}
```

### Telegram Notifications

Configure Telegram channels for instant notifications:

```bash
# .env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_CRITICAL_CHANNEL=-1001234567890  # Critical findings
TELEGRAM_HIGH_CHANNEL=-1001234567891      # High findings
TELEGRAM_OPS_CHANNEL=-1001234567892       # Operational alerts
```

Example notification:
```
🔴 New CRITICAL Finding

Program: Example Corp
Asset: api.example.com
Title: Remote Code Execution via Template Injection

Confidence: 95%
CVSS: 9.8
CWE: CWE-94

Description:
Server-side template injection allows arbitrary code execution...

Status: confirmed
Confirmations: 2/2 passed
Finding ID: fid-abc123
```

## 🧪 Testing & CI

### Local Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start dev server
npm run dev

# Lint
npm run lint
```

### CI/CD Pipeline

GitHub Actions workflow included:
- ✅ Linting and type checking
- ✅ Unit tests
- ✅ Integration tests against testbed (DVWA, Juice Shop)
- ✅ Docker image builds
- ✅ Security scanning

### Testbed

```bash
cd tests/testbed
docker-compose up -d

# Starts:
# - OWASP Juice Shop (port 3100)
# - Damn Vulnerable Web App (port 3101)
# - Custom SSRF target (port 3102)
# - Mock S3 endpoint (port 3103)
```

Run regression tests:
```bash
npm run test:regression
```

## 🔒 Security Best Practices

1. **API Keys**: Store in environment variables, never commit to Git
2. **Rate Limiting**: Respect target rate limits, use `-rate-limit` flags
3. **Scope Validation**: Always verify scope before scanning
4. **Template Review**: Audit custom Nuclei templates before use
5. **Access Control**: Use JWT tokens for API authentication
6. **Network Isolation**: Run workers in isolated network segments
7. **Audit Logs**: Monitor `audit_logs` table for suspicious activity

## 📖 API Documentation

### Core Endpoints

#### Programs
- `GET /api/v1/programs` - List all programs
- `POST /api/v1/programs` - Create program
- `GET /api/v1/programs/:id` - Get program details
- `PUT /api/v1/programs/:id` - Update program
- `DELETE /api/v1/programs/:id` - Delete program
- `GET /api/v1/programs/:id/assets` - List program assets
- `GET /api/v1/programs/:id/findings` - List program findings

#### Jobs
- `GET /api/v1/jobs` - List jobs (with filters)
- `POST /api/v1/jobs` - Create job
- `GET /api/v1/jobs/:id` - Get job status
- `POST /api/v1/jobs/:id/cancel` - Cancel job
- `POST /api/v1/jobs/:id/retry` - Retry failed job
- `GET /api/v1/jobs/stats/queues` - Queue statistics

#### Manager AI
- `POST /api/v1/manager/command` - Send conversational command
- `GET /api/v1/manager/history` - Get command history

#### Events (WebSocket)
- `ws://localhost:3000/events` - Subscribe to real-time events

## 🛠️ Advanced Configuration

### Worker Scaling

Scale worker replicas:
```bash
docker-compose up -d --scale workers=5
```

### Custom Nuclei Templates

Mount custom templates:
```yaml
# docker-compose.yml
services:
  workers:
    volumes:
      - ./custom-templates:/app/tools/templates/custom
```

Use in scans:
```json
{
  "type": "scanner",
  "options": {
    "templates": ["/app/tools/templates/custom/my-template.yaml"]
  }
}
```

### Database Migrations

```bash
# Run migrations
docker exec -it agenthunt-api npm run migrate

# Create new migration
docker exec -it agenthunt-api npm run migrate:create add_new_column
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Setup

```bash
git clone https://github.com/yourusername/agentHunt.git
cd agentHunt
npm install
cp .env.example .env
# Configure .env
docker-compose -f infrastructure/docker/docker-compose.yml up -d postgres redis minio
npm run dev
```

## 📄 License

MIT License - see [LICENSE](LICENSE) for details

## 🙏 Acknowledgments

Built with industry-leading open-source security tools:
- [ProjectDiscovery](https://projectdiscovery.io/) - Nuclei, HTTPx, Katana, Subfinder, and more
- [Anthropic Claude](https://anthropic.com/) - AI-powered triage and orchestration
- [BullMQ](https://bullmq.io/) - Job queue management
- [PostgreSQL](https://postgresql.org/) - Database
- [MinIO](https://min.io/) - S3-compatible object storage

## 📞 Support

- **Documentation**: [docs/](docs/)
- **Issues**: [GitHub Issues](https://github.com/yourusername/agentHunt/issues)
- **Discord**: [Join our community](https://discord.gg/agenthunt)
- **Email**: support@agenthunt.io

## 🗺️ Roadmap

- [ ] Web UI dashboard
- [ ] Multi-tenancy support
- [ ] Advanced deduplication engine
- [ ] Integration with bug bounty platforms (HackerOne, Bugcrowd APIs)
- [ ] Custom LLM fine-tuning for triage
- [ ] Distributed scanning across regions
- [ ] Plugin system for custom agents
- [ ] Real-time collaboration features

---

**⚠️ Disclaimer**: AgentHunt is designed for authorized security testing only. Always obtain proper authorization before scanning any target. The developers are not responsible for misuse of this tool.
