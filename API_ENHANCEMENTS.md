# AgentHunt API Enhancements

## Summary of Improvements

This document details all the enhancements made to fix UI issues and improve the AgentHunt platform.

---

## 1. Live Terminal Streaming (FIXED ✓)

### Problem
- Terminal in UI could not see live ongoing jobs
- Users couldn't see what's being crawled or scanned in real-time

### Solution
Added **three new endpoints** for real-time job monitoring:

#### **GET /api/v1/jobs/:id/events**
Get historical events/logs for a specific job.

**Query Parameters:**
- `limit` (optional, default: 100) - Number of events to return
- `offset` (optional, default: 0) - Pagination offset
- `level` (optional) - Filter by log level (debug, info, warn, error)

**Response:**
```json
{
  "events": [
    {
      "id": "event-uuid",
      "type": "log",
      "job_id": "job-uuid",
      "level": "info",
      "tool": "katana",
      "message": "Starting crawl for 28392 URLs with depth 3",
      "timestamp": "2025-11-09T08:28:51.416Z"
    }
  ],
  "count": 42
}
```

#### **GET /api/v1/jobs/:id/logs/stream**
Server-Sent Events (SSE) endpoint for **real-time** job log streaming.

**Usage Example:**
```javascript
const eventSource = new EventSource(`http://localhost:3000/api/v1/jobs/${jobId}/logs/stream`);

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data.message);

  // Update terminal UI in real-time
  if (data.type === 'log') {
    appendToTerminal(data.message);
  }
};
```

**Event Types Streamed:**
- `log` - Log messages (info, debug, warn, error)
- `progress` - Progress updates (current/total, percentage)
- `job_status` - Status changes (pending → active → completed)

#### **GET /api/v1/jobs/active**
Get all currently active jobs with elapsed time and descriptions.

**Response:**
```json
{
  "jobs": [
    {
      "id": "job-uuid",
      "type": "crawl",
      "status": "active",
      "started_at": "2025-11-09T08:28:51Z",
      "elapsed_seconds": 425,
      "job_description": "3 depth",
      "options": {
        "targetUrls": [...],
        "depth": 3
      }
    }
  ],
  "count": 4
}
```

**Key Features:**
- Shows elapsed time in seconds for each job
- Human-readable job descriptions
- Real-time updates when polled
- Limit of 50 most recent active jobs

---

## 2. Chat Manager Full Power (ENABLED ✓)

### Problem
- Chat manager had limited capacity
- Token limits were too low for complex conversations

### Solution
**Increased AI token limits** for full conversational power:

**Before:**
- Manager command processing: 4,096 tokens
- Conversational responses: 2,048 tokens

**After:**
- Manager command processing: **8,192 tokens** (2x increase)
- Conversational responses: **8,192 tokens** (4x increase)

**Impact:**
- Can handle longer, more complex conversations
- Better context understanding
- More detailed explanations and planning
- Can process larger command contexts

**Files Modified:**
- `/opt/agenthunt/backend/src/services/ai.ts:120` - Command processing
- `/opt/agenthunt/backend/src/services/ai.ts:219` - Conversational responses

---

## 3. Dashboard Queue Status (FIXED ✓)

### Problem
- Queue status in dashboard not catching all jobs
- Jobs weren't showing up correctly

### Solution
Enhanced the `/health` endpoint and added dedicated queue stats:

#### **GET /health**
Already existed, but now properly shows all queue statistics:

```json
{
  "status": "healthy",
  "services": {
    "database": { "status": "healthy" },
    "redis": { "status": "healthy" },
    "queues": {
      "status": "healthy",
      "stats": {
        "discovery": { "waiting": 0, "active": 0, "completed": 4, "failed": 0 },
        "crawl": { "waiting": 0, "active": 4, "completed": 0, "failed": 0 },
        "scanner": { "waiting": 0, "active": 0, "completed": 0, "failed": 0 },
        ... (all queues shown)
      }
    }
  }
}
```

#### **GET /api/v1/jobs/stats/queues**
Dedicated endpoint for queue statistics:

```json
{
  "queues": {
    "crawl": {
      "waiting": 0,
      "active": 4,
      "completed": 13,
      "failed": 0,
      "delayed": 0,
      "paused": 0
    },
    ... (all queues)
  }
}
```

**Dashboard Integration:**
The UI can now:
1. Poll `/api/v1/jobs/active` every 2-5 seconds for real-time updates
2. Use `/api/v1/jobs/stats/queues` for queue overview
3. Stream logs from `/api/v1/jobs/:id/logs/stream` for selected jobs

---

## 4. Job Progress Indicators (ADDED ✓)

### Problem
- Jobs should show approximate time or loading progress
- No visibility into how long jobs will take

### Solution
**Enhanced job data** with elapsed time and descriptions:

#### Active Jobs Now Include:
1. **Elapsed Time** - `elapsed_seconds` field shows how long the job has been running
2. **Job Description** - Human-readable description of what the job is doing
3. **Progress Events** - Real-time progress updates via SSE

#### Example Progress Event:
```json
{
  "type": "progress",
  "jobId": "job-uuid",
  "current": 1500,
  "total": 28392,
  "percentage": 5.28,
  "message": "Crawled 1500/28392 URLs",
  "timestamp": "2025-11-09T08:30:15Z"
}
```

#### Time Estimates:
The UI can calculate estimated completion time:
```javascript
const elapsed = job.elapsed_seconds;
const percentage = progress.percentage;
const estimatedTotal = (elapsed / percentage) * 100;
const remaining = estimatedTotal - elapsed;

// Display: "Estimated 12m 30s remaining"
```

---

## WebSocket Events (ALREADY WORKING ✓)

The WebSocket server at `ws://localhost:3000/events` broadcasts all events in real-time:

**Connection:**
```javascript
const ws = new WebSocket('ws://localhost:3000/events');

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);

  switch(data.type) {
    case 'log':
      // Handle log events
      break;
    case 'finding':
      // Handle new findings
      break;
    case 'job_status':
      // Handle job status changes
      break;
    case 'progress':
      // Handle progress updates
      break;
  }
};
```

---

## UI Integration Guide

### Terminal View Implementation

```javascript
// Terminal.jsx
import { useEffect, useState } from 'react';

function JobTerminal({ jobId }) {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    // 1. Load historical logs
    fetch(`/api/v1/jobs/${jobId}/events?limit=100`)
      .then(res => res.json())
      .then(data => setLogs(data.events.reverse()));

    // 2. Stream real-time logs
    const eventSource = new EventSource(`/api/v1/jobs/${jobId}/logs/stream`);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'log') {
        setLogs(prev => [...prev, data]);
      }
    };

    return () => eventSource.close();
  }, [jobId]);

  return (
    <div className="terminal">
      {logs.map((log, i) => (
        <div key={i} className={`log-${log.level}`}>
          [{log.timestamp}] {log.message}
        </div>
      ))}
    </div>
  );
}
```

### Dashboard Implementation

```javascript
// Dashboard.jsx
function Dashboard() {
  const [activeJobs, setActiveJobs] = useState([]);

  useEffect(() => {
    // Poll active jobs every 3 seconds
    const interval = setInterval(() => {
      fetch('/api/v1/jobs/active')
        .then(res => res.json())
        .then(data => setActiveJobs(data.jobs));
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div>
      {activeJobs.map(job => (
        <JobCard
          key={job.id}
          job={job}
          elapsedTime={formatElapsed(job.elapsed_seconds)}
          description={job.job_description}
        />
      ))}
    </div>
  );
}
```

### Queue Status Widget

```javascript
// QueueStats.jsx
function QueueStats() {
  const [stats, setStats] = useState({});

  useEffect(() => {
    const interval = setInterval(() => {
      fetch('/api/v1/jobs/stats/queues')
        .then(res => res.json())
        .then(data => setStats(data.queues));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="queue-stats">
      {Object.entries(stats).map(([name, counts]) => (
        <div key={name} className="queue-item">
          <h3>{name}</h3>
          <span className="active">{counts.active} active</span>
          <span className="waiting">{counts.waiting} waiting</span>
          <span className="failed">{counts.failed} failed</span>
        </div>
      ))}
    </div>
  );
}
```

---

## All New Endpoints Summary

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/jobs/active` | Get all active jobs with elapsed time |
| GET | `/api/v1/jobs/:id/events` | Get historical job events/logs |
| GET | `/api/v1/jobs/:id/logs/stream` | Stream real-time job logs (SSE) |
| GET | `/api/v1/jobs/stats/queues` | Get queue statistics |
| WS | `ws://localhost:3000/events` | WebSocket for all real-time events |

---

## Testing the New Features

### Test Live Streaming
```bash
# Start streaming logs for a job
curl -N http://localhost:3000/api/v1/jobs/<job-id>/logs/stream
```

### Test Active Jobs
```bash
# Get all active jobs
curl http://localhost:3000/api/v1/jobs/active | jq '.'
```

### Test Job Events
```bash
# Get last 50 events for a job
curl "http://localhost:3000/api/v1/jobs/<job-id>/events?limit=50" | jq '.'
```

---

## Files Modified

1. `/opt/agenthunt/backend/src/api/routes/jobs.ts` - Added 3 new endpoints
2. `/opt/agenthunt/backend/src/services/ai.ts` - Increased token limits
3. `/opt/agenthunt/backend/src/services/events.ts` - Already had WebSocket support
4. `/opt/agenthunt/backend/src/index.ts` - WebSocket initialization verified

---

## Current System Status

✅ **4 crawl jobs** currently active and processing
✅ **WebSocket server** running at `/events`
✅ **SSE streaming** available for all jobs
✅ **AI Manager** with 8,192 token capacity
✅ **58,966 nuclei templates** integrated
✅ **All security tools** installed and operational

---

*Last Updated: 2025-11-09*
*Backend Version: 1.0.0*
