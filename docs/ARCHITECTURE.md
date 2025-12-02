# AgentHunt Architecture

## Overview

AgentHunt is built as a distributed, event-driven microservices architecture optimized for scalability, reliability, and safety in automated security testing.

## Core Components

### 1. API Server (Express + WebSocket)

**Responsibilities:**
- REST API for program/job management
- WebSocket server for real-time event streaming
- Manager AI conversational interface
- Authentication and authorization
- Rate limiting and request validation

**Technology Stack:**
- Express.js with TypeScript
- WebSocket (ws library)
- Helmet for security headers
- Rate limiting middleware

**Key Endpoints:**
- `/api/v1/programs` - Program CRUD
- `/api/v1/jobs` - Job management
- `/api/v1/manager/command` - AI orchestration
- `/events` (WebSocket) - Real-time event stream

### 2. Worker Processes

**Responsibilities:**
- Process jobs from BullMQ queues
- Execute security tools (Nuclei, HTTPx, etc.)
- Report progress and findings
- Handle retries and failures
- Maintain worker health heartbeats

**Agent Types:**
Each agent is a specialized worker with domain expertise:

- **Discovery Agent**: Subdomain enumeration
- **Fingerprint Agent**: Technology detection
- **Crawl Agent**: Web application crawling
- **Scanner Agent**: Vulnerability scanning
- **Confirm Agent**: Multi-method validation
- **Triage Agent**: AI-powered finding analysis

**Scaling:**
- Horizontal scaling via Docker replicas
- Independent concurrency per agent type
- CPU/memory limits configurable per worker
- Regional deployment for geo-distributed scanning

### 3. Job Queue (BullMQ + Redis)

**Responsibilities:**
- Reliable job persistence
- Priority-based scheduling
- Automatic retry with exponential backoff
- Job progress tracking
- Queue pause/resume control

**Queue Architecture:**
```
┌─────────────────┐
│  API Server     │
│  (Job Creator)  │
└────────┬────────┘
         │ enqueue
         ▼
┌──────────────────────────┐
│    Redis (BullMQ)        │
│  ┌────────────────────┐  │
│  │ discovery queue    │  │
│  │ scanner queue      │  │
│  │ triage queue       │  │
│  │ ...                │  │
│  └────────────────────┘  │
└────────┬─────────────────┘
         │ dequeue
         ▼
┌──────────────────────────┐
│  Worker Processes        │
│  (Job Processors)        │
└──────────────────────────┘
```

**Job Lifecycle:**
1. **Pending**: Queued, waiting for worker
2. **Active**: Currently being processed
3. **Completed**: Successfully finished
4. **Failed**: Error occurred (retryable)
5. **Cancelled**: Manually stopped
6. **Paused**: Queue temporarily suspended

### 4. Database (PostgreSQL)

**Schema Design:**

**Core Tables:**
- `programs`: Bug bounty programs with scope and policies
- `assets`: Discovered subdomains, URLs, IPs
- `findings`: Vulnerability findings with evidence
- `jobs`: Job queue state and results
- `workers`: Worker health and capacity
- `events`: Event stream for real-time updates
- `notifications`: Outbound notification queue
- `safety_checks`: Policy enforcement audit log
- `audit_logs`: Complete action audit trail

**Indexes:**
- B-tree indexes on foreign keys and timestamps
- GIN indexes on JSONB columns for metadata queries
- Full-text search indexes on findings
- Composite indexes for common query patterns

**Performance Optimization:**
- Connection pooling (20 connections)
- Prepared statements for frequent queries
- Materialized views for complex aggregations
- Partitioning on `events` table by timestamp

### 5. Object Storage (S3 / MinIO)

**Stored Artifacts:**
- Raw tool outputs (JSON/text)
- HTTP request/response captures
- Screenshots from headless browser
- PoC scripts and payloads
- Nuclei template results

**Bucket Structure:**
```
agenthunt-artifacts/
├── {program-id}/
│   ├── discovery/
│   │   └── {timestamp}_{tool}.json
│   ├── nuclei/
│   │   └── {job-id}.jsonl
│   ├── katana/
│   │   └── {job-id}.txt
│   └── screenshots/
│       └── {finding-id}.png
```

**Access Patterns:**
- Presigned URLs for temporary access (1 hour TTL)
- Lifecycle policies for artifact retention (90 days)
- Versioning enabled for critical artifacts

### 6. Event Streaming (WebSocket + EventEmitter)

**Event Types:**
- `log`: Structured log messages from tools
- `finding`: New vulnerability discovered
- `job_status`: Job state changes
- `progress`: Operation progress updates
- `human_action_request`: Approval required

**Event Flow:**
```
Worker → EventEmitter → Database → WebSocket → UI
                       ↓
                  Telegram Bot
```

**Subscription Model:**
- Clients can filter by program_id, job_id, event type
- Server-side filtering to reduce bandwidth
- Automatic reconnection with exponential backoff

## Data Flow

### Example: Full Scan Pipeline

```
1. User creates program via API
   └→ Stored in programs table

2. User submits discovery job
   └→ Job added to discovery queue
   └→ Discovery worker picks up job
   └→ Runs chaos-client, subfinder
   └→ Saves assets to database
   └→ Uploads raw output to S3
   └→ Emits progress events

3. System auto-triggers fingerprint job
   └→ Reads assets from database
   └→ Runs httpx, tlsx
   └→ Updates asset metadata
   └→ Uploads results to S3

4. System auto-triggers crawl job
   └→ Runs katana on alive hosts
   └→ Discovers URLs and parameters
   └→ Stores URLs as assets

5. System auto-triggers scanner job
   └→ Runs Nuclei with tier1 templates
   └→ Applies fingerprint-based filtering
   └→ Uploads raw findings to S3

6. Triage Agent processes findings
   └→ Claude AI parses Nuclei output
   └→ Assigns severity/confidence
   └→ Generates PoC draft
   └→ Creates finding records
   └→ Emits finding events

7. Confirm Agent validates findings
   └→ Re-runs with different template
   └→ Validates with httpx regex
   └→ Updates finding confirmations

8. Notification Service sends alerts
   └→ Telegram message to channel
   └→ Email to researcher (optional)
   └→ Webhook to external system
```

## Safety & Compliance

### Template Gating

**Tier 0 (Fingerprint)**
- Always allowed
- Read-only operations
- Examples: tech-detect, version-enum

**Tier 1 (Detection)**
- Allowed by default
- Non-invasive checks
- Examples: XSS detection, info disclosure

**Tier 2 (Fuzzing)**
- Requires program opt-in
- State-changing inputs
- Examples: parameter fuzzing, header injection
- Enforced by: `policy.allowedTemplates.tier2`

**Tier 3 (Exploitation)**
- Disabled by default
- Requires written consent
- Human approval per execution
- Examples: RCE, privilege escalation
- Enforced by: `config.safety.enableTier3Templates` AND `policy.allowedTemplates.tier3`

### Safety Checks

Before executing any job:
1. **Scope Validation**: Verify target is in program scope
2. **Policy Check**: Confirm action is allowed by program policy
3. **Rate Limit**: Check current request rate vs. limits
4. **Tier Gate**: Validate template tier is permitted
5. **Approval Check**: For high-impact actions, verify human approval

Failed safety checks:
- Job is marked as `failed` with safety violation error
- `HumanActionRequest` event emitted
- Audit log entry created
- No tool execution occurs

### Audit Logging

Every action is logged with:
- **Who**: user_id or worker_id
- **What**: action type (create_job, update_policy, etc.)
- **When**: timestamp (UTC)
- **Where**: resource type and ID
- **Why**: context (API request, manager command, etc.)
- **Result**: success/failure with details

Audit logs are:
- Immutable (insert-only table)
- Indexed for fast queries
- Retained indefinitely
- Exportable for compliance

## Scalability

### Horizontal Scaling

**API Server:**
- Stateless design (no in-memory session)
- Load balancer with sticky sessions for WebSocket
- Scale based on request rate metrics

**Workers:**
- Scale each agent type independently
- Autoscaling based on queue depth
- Example: `docker-compose up -d --scale workers=10`

**Database:**
- Read replicas for reporting queries
- Connection pooling to handle concurrent workers
- Partitioning on high-volume tables

**Redis:**
- Cluster mode for > 100k jobs/hour
- Sentinel for automatic failover
- Separate instances for queue vs. cache

### Performance Targets

- **API Response Time**: p95 < 200ms
- **Job Throughput**: 1000+ jobs/hour per worker
- **WebSocket Latency**: < 100ms event delivery
- **Database Queries**: p95 < 50ms
- **S3 Upload**: Async, non-blocking

## Monitoring & Observability

### Metrics (Planned)

- Job queue depth per agent type
- Worker CPU/memory usage
- Tool execution duration
- Finding rate by severity
- False positive rate
- API request rate and errors
- Database connection pool utilization

### Logging

**Structured Logs (JSON):**
```json
{
  "level": "info",
  "timestamp": "2025-11-06T12:00:00Z",
  "service": "worker-scanner",
  "workerId": "scanner-abc123",
  "jobId": "job-xyz789",
  "tool": "nuclei",
  "message": "Scan complete: 324 templates, 12 findings",
  "duration": 45200,
  "context": {
    "programId": "program-123",
    "targetCount": 150
  }
}
```

**Log Levels:**
- `debug`: Tool output details
- `info`: Normal operations
- `warn`: Recoverable errors, policy violations
- `error`: Failures requiring attention

### Alerting (Planned)

- Worker offline > 5 minutes
- Queue depth > 1000 for > 10 minutes
- Database connection pool exhausted
- High error rate (> 10% of jobs failing)
- Critical findings discovered

## Security Considerations

### API Security

- Rate limiting: 100 requests / 15 minutes per IP
- Helmet middleware for security headers
- Input validation with express-validator
- JWT tokens for authentication (planned)
- CORS whitelist for allowed origins

### Worker Security

- Non-root user in Docker containers
- Read-only filesystem where possible
- Network policies to isolate workers
- Secrets injected via environment variables
- No hardcoded credentials

### Database Security

- Encrypted connections (TLS)
- Least-privilege user accounts
- Parameterized queries (SQL injection prevention)
- Regular backups with encryption at rest

### Tool Safety

- Sandboxed execution (Docker containers)
- Resource limits (CPU, memory, disk)
- Timeout enforcement on all tool executions
- Stderr/stdout capture for debugging
- Automatic cleanup of temporary files

## Disaster Recovery

### Backup Strategy

- **Database**: Automated daily backups to S3, 30-day retention
- **S3 Artifacts**: Cross-region replication
- **Redis**: AOF persistence enabled, snapshot every 6 hours
- **Configuration**: Version controlled in Git

### Failure Scenarios

**Worker Crash:**
- BullMQ automatically retries job on different worker
- Max 3 attempts with exponential backoff
- Job marked as failed if all attempts exhausted

**Database Failure:**
- Read replicas for read operations
- Connection pool retries with backoff
- Manual failover to standby (< 5 min RTO)

**Redis Failure:**
- Redis Sentinel for automatic failover
- Jobs persisted to disk (AOF)
- Workers pause until Redis recovers

**API Server Failure:**
- Load balancer redirects to healthy instances
- WebSocket clients auto-reconnect
- Stateless design ensures no data loss

## Future Enhancements

- [ ] Kubernetes Helm charts for production deployment
- [ ] Distributed tracing with OpenTelemetry
- [ ] Prometheus + Grafana dashboards
- [ ] Advanced ML-based false positive detection
- [ ] Multi-region worker pools for geo-distributed scanning
- [ ] GraphQL API alongside REST
- [ ] Webhook-based integrations with bug bounty platforms
- [ ] Real-time collaboration features (shared terminal)
