# AgentHunt API Documentation

## Base URL

```
http://localhost:3000/api/v1
```

## Authentication

Currently, the API uses rate limiting. JWT authentication is planned for future releases.

## Rate Limits

- **100 requests per 15 minutes** per IP address
- Rate limit headers included in responses:
  - `RateLimit-Limit`: Maximum requests allowed
  - `RateLimit-Remaining`: Requests remaining
  - `RateLimit-Reset`: Timestamp when limit resets

## Common Response Codes

- `200 OK`: Request successful
- `201 Created`: Resource created successfully
- `400 Bad Request`: Invalid request parameters
- `404 Not Found`: Resource not found
- `429 Too Many Requests`: Rate limit exceeded
- `500 Internal Server Error`: Server error

---

## Programs

### List Programs

```http
GET /programs
```

**Response:**
```json
{
  "programs": [
    {
      "id": "uuid",
      "name": "Example Corp Bug Bounty",
      "slug": "examplecorp",
      "platform": "hackerone",
      "scope": { ... },
      "policy": { ... },
      "metadata": { ... },
      "asset_count": 1234,
      "finding_count": 56,
      "last_finding_at": "2025-11-06T12:00:00Z",
      "created_at": "2025-11-01T00:00:00Z",
      "updated_at": "2025-11-06T12:00:00Z"
    }
  ]
}
```

### Get Program

```http
GET /programs/:id
```

**Response:**
```json
{
  "program": {
    "id": "uuid",
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
      },
      "notification": {
        "telegram": true,
        "email": false
      }
    },
    "metadata": {
      "platform_url": "https://hackerone.com/examplecorp",
      "bounty_range": "$100-$10,000",
      "tags": ["web", "api", "mobile"]
    }
  }
}
```

### Create Program

```http
POST /programs
```

**Request Body:**
```json
{
  "name": "Example Corp Bug Bounty",
  "slug": "examplecorp",
  "platform": "hackerone",
  "scope": {
    "domains": ["example.com"],
    "wildcardDomains": ["*.example.com"],
    "excludedDomains": [],
    "maxAssets": 100000
  },
  "policy": {
    "allowedActions": {
      "passiveDiscovery": true,
      "activeDiscovery": false,
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
}
```

**Response:**
```json
{
  "id": "uuid",
  "message": "Program created successfully"
}
```

### Update Program

```http
PUT /programs/:id
```

**Request Body:** (partial updates supported)
```json
{
  "policy": {
    "allowedTemplates": {
      "tier2": true
    }
  }
}
```

### Delete Program

```http
DELETE /programs/:id
```

**Response:**
```json
{
  "message": "Program deleted successfully"
}
```

### Get Program Assets

```http
GET /programs/:id/assets?type=subdomain&status=active&limit=100&offset=0
```

**Query Parameters:**
- `type`: Filter by asset type (subdomain, url, ip, port)
- `status`: Filter by status (active, inactive, out_of_scope)
- `limit`: Max results (default: 100)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "assets": [
    {
      "id": "uuid",
      "program_id": "uuid",
      "type": "subdomain",
      "value": "api.example.com",
      "source": ["chaosdb", "subfinder"],
      "status": "active",
      "metadata": {
        "resolved": true,
        "ipAddresses": ["1.2.3.4"],
        "httpStatus": 200,
        "title": "Example API",
        "server": "nginx",
        "technologies": ["Next.js", "React"],
        "cdn": "cloudflare"
      },
      "first_seen": "2025-11-01T00:00:00Z",
      "last_seen": "2025-11-06T12:00:00Z",
      "last_scanned": "2025-11-06T11:00:00Z"
    }
  ],
  "count": 1
}
```

### Get Program Findings

```http
GET /programs/:id/findings?severity=high&status=new&limit=100&offset=0
```

**Query Parameters:**
- `severity`: Filter by severity (critical, high, medium, low, info)
- `status`: Filter by status (new, triaged, confirmed, false_positive, submitted)
- `limit`: Max results (default: 100)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "findings": [
    {
      "id": "uuid",
      "program_id": "uuid",
      "asset_id": "uuid",
      "severity": "high",
      "confidence": 0.92,
      "title": "SQL Injection in /api/users",
      "description": "The /api/users endpoint is vulnerable to SQL injection...",
      "cvss": 8.5,
      "cwe": ["CWE-89"],
      "evidence": [...],
      "poc": {
        "steps": [
          "1. Navigate to https://api.example.com/users",
          "2. Send request with payload: ' OR '1'='1"
        ],
        "curl": "curl ...",
        "reproductionRate": 0.9
      },
      "impact": "Attackers can read/modify database...",
      "remediation": "Use parameterized queries...",
      "status": "confirmed",
      "confirmations": [
        {
          "id": "uuid",
          "method": "template:sqli-confirm",
          "result": "pass",
          "timestamp": "2025-11-06T12:00:00Z"
        }
      ],
      "created_at": "2025-11-06T10:00:00Z"
    }
  ],
  "count": 1
}
```

---

## Jobs

### List Jobs

```http
GET /jobs?program_id=uuid&type=scanner&status=active&limit=100&offset=0
```

**Query Parameters:**
- `program_id`: Filter by program
- `type`: Filter by job type
- `status`: Filter by status (pending, active, completed, failed, cancelled)
- `limit`: Max results (default: 100)
- `offset`: Pagination offset (default: 0)

**Response:**
```json
{
  "jobs": [
    {
      "id": "uuid",
      "type": "scanner",
      "program_id": "uuid",
      "priority": 8,
      "status": "active",
      "attempts": 1,
      "max_attempts": 3,
      "worker_id": "scanner-abc123",
      "options": {
        "inputUrlsFile": "s3://bucket/urls.txt",
        "templateSet": "fast",
        "concurrency": 50
      },
      "result": null,
      "error": null,
      "metadata": {
        "requestedBy": "api"
      },
      "created_at": "2025-11-06T10:00:00Z",
      "started_at": "2025-11-06T10:01:00Z",
      "completed_at": null
    }
  ],
  "count": 1
}
```

### Get Job

```http
GET /jobs/:id
```

### Create Job

```http
POST /jobs
```

**Request Body - Discovery Job:**
```json
{
  "type": "discovery",
  "program_id": "uuid",
  "priority": 8,
  "options": {
    "sources": ["chaosdb", "subfinder", "uncover"],
    "maxAssets": 50000,
    "timeout": 3600
  },
  "metadata": {
    "tags": ["initial-recon"]
  }
}
```

**Request Body - Fingerprint Job:**
```json
{
  "type": "fingerprint",
  "program_id": "uuid",
  "options": {
    "assets": ["api.example.com", "app.example.com"],
    "tools": ["httpx", "tlsx", "cdncheck"],
    "concurrency": 300,
    "followRedirects": true
  }
}
```

**Request Body - Crawl Job:**
```json
{
  "type": "crawl",
  "program_id": "uuid",
  "options": {
    "targetUrls": ["https://app.example.com"],
    "depth": 3,
    "respectRobots": true,
    "maxUrls": 10000
  }
}
```

**Request Body - Scanner Job:**
```json
{
  "type": "scanner",
  "program_id": "uuid",
  "options": {
    "inputUrlsFile": "s3://bucket/urls_123.txt",
    "templateSet": "fast",
    "tier": "tier1",
    "concurrency": 50,
    "interactshEnabled": true,
    "fingerprintConditions": {
      "server": "nginx|apache",
      "path_exists": "/api/"
    }
  }
}
```

**Request Body - Confirm Job:**
```json
{
  "type": "confirm",
  "program_id": "uuid",
  "options": {
    "findingId": "uuid",
    "methods": ["template:confirm_sqli", "httpx_regex"],
    "requiredPasses": 2,
    "useDifferentWorker": true
  }
}
```

**Response:**
```json
{
  "id": "uuid",
  "message": "Job created and queued successfully"
}
```

### Cancel Job

```http
POST /jobs/:id/cancel
```

### Retry Job

```http
POST /jobs/:id/retry
```

### Queue Statistics

```http
GET /jobs/stats/queues
```

**Response:**
```json
{
  "queues": {
    "discovery": {
      "waiting": 5,
      "active": 2,
      "completed": 1234,
      "failed": 12
    },
    "scanner": {
      "waiting": 15,
      "active": 5,
      "completed": 5678,
      "failed": 34
    }
  }
}
```

---

## Manager AI

### Process Command

```http
POST /manager/command
```

**Request Body:**
```json
{
  "command": "Start discovery for program examplecorp using chaosdb and subfinder",
  "program_id": "uuid",
  "user_id": "researcher-1"
}
```

**Response:**
```json
{
  "id": "uuid",
  "command": "Start discovery for program examplecorp...",
  "program_id": "uuid",
  "user_id": "researcher-1",
  "parsedIntent": {
    "action": "discovery",
    "entities": {
      "program": "examplecorp",
      "tools": ["chaosdb", "subfinder"]
    },
    "confidence": 0.95
  },
  "response": "I've started discovery for Example Corp using Chaos DB and Subfinder. The job has been queued and will begin processing shortly. I'll notify you when results are available.",
  "executedActions": [
    {
      "type": "create_job",
      "params": {
        "job_type": "discovery",
        "options": {
          "sources": ["chaosdb", "subfinder"]
        }
      },
      "result": {
        "jobId": "uuid",
        "status": "queued"
      }
    }
  ],
  "timestamp": "2025-11-06T12:00:00Z"
}
```

**Example Commands:**
- "Start discovery for program Spotify using chaosdb"
- "Run katana crawl depth 4 on top 500 alive hosts"
- "Pause all fuzzing templates for program examplecorp"
- "Confirm finding fid-123 with template confirm_sqli"
- "Show me the status of job job-xyz"
- "Enable tier 2 templates for program examplecorp"

### Get Command History

```http
GET /manager/history?user_id=researcher-1&program_id=uuid&limit=50
```

**Response:**
```json
{
  "commands": [
    {
      "id": "uuid",
      "command": "Start discovery...",
      "program_id": "uuid",
      "user_id": "researcher-1",
      "parsed_intent": {...},
      "response": "...",
      "executed_actions": [...],
      "timestamp": "2025-11-06T12:00:00Z"
    }
  ]
}
```

---

## WebSocket Events

### Connect

```javascript
const ws = new WebSocket('ws://localhost:3000/events');

ws.onopen = () => {
  console.log('Connected to event stream');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  handleEvent(data);
};
```

### Event Types

**Log Event:**
```json
{
  "id": "uuid",
  "type": "log",
  "timestamp": "2025-11-06T12:00:00Z",
  "programId": "uuid",
  "jobId": "uuid",
  "workerId": "scanner-abc123",
  "level": "info",
  "tool": "nuclei",
  "context": "api.example.com",
  "message": "templates:324 findings:12 runtime:45.2s"
}
```

**Finding Event:**
```json
{
  "id": "uuid",
  "type": "finding",
  "timestamp": "2025-11-06T12:00:00Z",
  "programId": "uuid",
  "finding": {
    "id": "uuid",
    "severity": "high",
    "title": "SQL Injection",
    "confidence": 0.92,
    ...
  }
}
```

**Job Status Event:**
```json
{
  "id": "uuid",
  "type": "job_status",
  "timestamp": "2025-11-06T12:00:00Z",
  "programId": "uuid",
  "jobId": "uuid",
  "workerId": "scanner-abc123",
  "job": {
    "id": "uuid",
    "status": "completed",
    ...
  }
}
```

**Progress Event:**
```json
{
  "id": "uuid",
  "type": "progress",
  "timestamp": "2025-11-06T12:00:00Z",
  "programId": "uuid",
  "jobId": "uuid",
  "operation": "nuclei_scan",
  "current": 1250,
  "total": 5000,
  "percentage": 25,
  "eta": 180
}
```

**Human Action Request:**
```json
{
  "id": "uuid",
  "type": "human_action_request",
  "timestamp": "2025-11-06T12:00:00Z",
  "programId": "uuid",
  "action": "enable_tier2_templates",
  "reason": "User requested fuzzing templates but policy does not allow tier2",
  "options": ["approve", "reject"],
  "requiredApproval": true,
  "context": {
    "command": "Run fuzzing templates on example.com",
    "currentPolicy": {...}
  }
}
```

---

## Error Responses

**Validation Error:**
```json
{
  "error": "Missing required field: program_id"
}
```

**Not Found:**
```json
{
  "error": "Program not found"
}
```

**Rate Limit:**
```json
{
  "error": "Too many requests. Please try again in 15 minutes."
}
```

**Server Error:**
```json
{
  "error": "Internal server error"
}
```

---

## SDKs and Client Libraries

### JavaScript/TypeScript

```typescript
import { AgentHuntClient } from '@agenthunt/sdk';

const client = new AgentHuntClient({
  baseUrl: 'http://localhost:3000',
  apiKey: 'your-api-key' // future
});

// Create program
const program = await client.programs.create({
  name: 'Example Corp',
  slug: 'examplecorp',
  scope: {...}
});

// Start discovery
const job = await client.jobs.create({
  type: 'discovery',
  programId: program.id,
  options: {
    sources: ['chaosdb', 'subfinder']
  }
});

// Listen to events
client.events.on('finding', (finding) => {
  console.log('New finding:', finding);
});
```

### Python (Planned)

```python
from agenthunt import AgentHuntClient

client = AgentHuntClient(
    base_url="http://localhost:3000",
    api_key="your-api-key"
)

# Create program
program = client.programs.create(
    name="Example Corp",
    slug="examplecorp",
    scope={...}
)

# Start discovery
job = client.jobs.create(
    type="discovery",
    program_id=program.id,
    options={
        "sources": ["chaosdb", "subfinder"]
    }
)

# Listen to events
@client.events.on("finding")
def handle_finding(finding):
    print(f"New finding: {finding}")
```

---

## Rate Limiting Best Practices

1. **Cache responses**: Cache program/asset data to reduce API calls
2. **Use WebSocket**: Subscribe to events instead of polling
3. **Batch operations**: Create multiple jobs in sequence, not parallel API calls
4. **Implement backoff**: Respect `Retry-After` header on 429 responses
5. **Use Manager AI**: Single command can orchestrate multiple jobs efficiently
