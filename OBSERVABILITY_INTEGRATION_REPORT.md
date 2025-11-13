# Comprehensive Observability Integration Report
## Terminal Implementations, Data Sources & Progress Tracking

---

## SECTION 1: TERMINAL IMPLEMENTATIONS

### 1.1 LiveTerminal Component
**File:** `/opt/agenthunt/frontend/components/LiveTerminal.tsx`

**Type:** React Client Component

**Features:**
- Real-time event streaming via WebSocket
- Filtering by jobId or programId
- Auto-scroll, pause/resume, clear, and download functionality
- Event type display with color coding and icons
- Displays: logs, job_status, findings, progress, human_action_requests, connections

**Current Data Source:**
- WebSocket hook: `useEventStream()` (filtering by jobId/programId)
- Receives WebSocketEvent objects
- Keeps last 1000 events in memory

**Props:**
```typescript
jobId?: string;
programId?: string;
title?: string;
height?: string;
showControls?: boolean;
```

---

### 1.2 Terminal Page
**File:** `/opt/agenthunt/frontend/app/terminal/page.tsx`

**Type:** Next.js App Router Page (Full Page Terminal)

**Features:**
- Global terminal with program/level filtering
- Export logs as text file
- Auto-scroll toggle
- Event statistics (total, errors, warnings)
- Logs terminal styling

**Current Data Source:**
- `useEventStream()` hook with optional programId filter
- React Query: `programsApi.list()` for program list

**Data Displayed:**
- Log events with: timestamp, level, tool, message, context
- Stats: Total events, error count, warning count

---

### 1.3 Job Details Page with Terminal
**File:** `/opt/agenthunt/frontend/app/jobs/[id]/page.tsx` (Lines 880-885)

**Features:**
- Embedded LiveTerminal component filtered by jobId
- Shows job-specific logs

**Current Data Source:**
- `LiveTerminal` component with `jobId={job.id}`
- `jobsApi.get(jobId)` for job details (5-second refetch)

---

## SECTION 2: DATA SOURCES & REAL-TIME CONNECTIONS

### 2.1 WebSocket Hook Implementation
**File:** `/opt/agenthunt/frontend/hooks/useWebSocket.ts`

**Connection Details:**
- URL: `ws://localhost:3000/events` (configurable via `NEXT_PUBLIC_WS_URL`)
- Auto-reconnect: 3-second retry on disconnect
- Message Parsing: JSON parse with error handling

**Event Filtering:**
```typescript
{
  programId?: string;
  jobId?: string;
  type?: string;
}
```

**State Management:**
- `events[]`: Last 1000 events maintained in state
- `isConnected`: Connection status
- `send()`: Send data to server
- `clearEvents()`: Clear local event buffer

---

### 2.2 Backend Event Service
**File:** `/opt/agenthunt/backend/src/services/events.ts`

**Architecture:**
- Class: `EventService` (Singleton)
- Extends: `EventEmitter` (Node.js)
- WebSocket Server: Uses 'ws' library on path `/events`

**Event Types Emitted:**
1. **Log Event** (`emitLog()`)
   - Fields: id, type, timestamp, programId, jobId, workerId, level, tool, context, message
   - Persisted to database
   - Broadcast to all clients

2. **Finding Event** (`emitFinding()`)
   - Fields: id, type, timestamp, programId, finding
   - Full finding object included
   - Broadcast + database persistence

3. **Job Status Event** (`emitJobStatus()`)
   - Fields: id, type, timestamp, programId, jobId, workerId, job
   - Full job object included
   - Broadcast + database persistence

4. **Progress Event** (`emitProgress()`)
   - Fields: id, type, timestamp, jobId, programId, current, total, percentage, message
   - **NOT persisted** (too frequent)
   - Only broadcast to clients

5. **Human Action Request** (`emitHumanActionRequest()`)
   - Fields: id, type, timestamp, action, reason, jobId, programId
   - Broadcast + database persistence

**Internal Listeners:**
- Self-emitted via `.emit()` for internal event handlers

---

### 2.3 Queue Service Event Emissions
**File:** `/opt/agenthunt/backend/src/services/queue.ts`

**Queue Events Emitted:**
1. **Job Completed** (Line 102-120)
   - Triggers: Notification service
   - Status: 'active' → 'completed'
   - Calls: `notification.notifyJobStatusChange()`

2. **Job Failed** (Line 122-141)
   - Triggers: Notification service
   - Status: 'active' → 'failed'
   - Includes: failedReason

3. **Job Creation** (Line 179-181)
   - Calls: `notification.notifyJobCreated()`
   - Parameters: queueName, jobId, programId, priority

4. **Job Status Changes** (Line 211-217)
   - When job becomes 'active'
   - Status: 'pending' → 'active'

---

## SECTION 3: DASHBOARD QUEUE STATUS COMPONENT

### 3.1 JobQueueManager Component
**File:** `/opt/agenthunt/frontend/components/JobQueueManager.tsx`

**Type:** React Client Component

**Current Data Sources:**
- React Query: `jobsApi.list({ limit: 100 })`
- Refetch Interval: **5 seconds**

**Data Displayed:**
```
Stats Bar (4 cards):
- Pending Jobs
- Active Jobs  
- Completed Jobs
- Failed Jobs

Per-Agent Queue Breakdown:
- Total jobs per agent type
- Status breakdown (pending, active, completed, failed)

Job List Table:
- Status, Type, Program, Priority, Created, Updated
- Retry/Cancel actions
```

**Current Data Limitations:**
- Polls every 5 seconds (not real-time)
- No WebSocket integration
- No per-job progress tracking

---

### 3.2 Dashboard Queue Status Section
**File:** `/opt/agenthunt/frontend/app/dashboard/page.tsx` (Lines 427-444)

**Type:** Dashboard Section

**Current Data Source:**
- React Query: `jobsApi.getQueueStats()`
- Refetch Interval: **5 seconds**

**Data Displayed:**
```
Queue Status Grid:
- Shows queue names from API response
- Waiting jobs count
- Active jobs count
```

---

## SECTION 4: PROGRESS & JOB DETAILS DISPLAY

### 4.1 Job Progress Card
**File:** `/opt/agenthunt/frontend/app/jobs/[id]/page.tsx` (Lines 454-541)

**Type:** Conditional Card (displays if `job.progress` exists)

**Current Data Source:**
- React Query: `jobsApi.get(jobId)` - refetch every 5 seconds
- Job data structure includes `progress` object

**Progress Data Structure:**
```typescript
job.progress: {
  currentTool?: string;
  current: number;
  total: number;
  percentage: number;
  message?: string;
  toolStatus: 'running' | 'completed' | 'completed_empty' | 'failed';
  details?: Record<string, any>;
}
```

**Features:**
- Progress bar with color indicators
- Current/Total count display
- Tool status badge
- Details grid (multi-column layout)

### 4.2 Job Execution Timeline (Mock Turns/Interactions)
**File:** `/opt/agenthunt/frontend/app/jobs/[id]/page.tsx` (Lines 605-783)

**Type:** Mock Data Implementation

**Current Data Source:**
- **MOCK DATA** (Lines 231-327)
- Not connected to actual execution data
- Hardcoded turn/interaction/action examples

**Features:**
- Turn-based execution timeline
- Interaction with LLM reasoning
- Action-level tool execution details
- Expandable sections

---

## SECTION 5: OBSERVABILITY SYSTEM ENDPOINTS & EVENT EMITTERS

### 5.1 Observability API Routes
**File:** `/opt/agenthunt/backend/src/api/routes/observability.ts`

**Endpoints:**

1. **GET /api/v1/observability/traces**
   - Query Params: timeRange (15m, 1h, 6h, 24h, 7d), limit, status, agentType
   - Source: Phoenix API at `/v1/traces`
   - Returns: traces[], count, timeRange

2. **GET /api/v1/observability/traces/:traceId**
   - Get specific trace details
   - Source: Phoenix API

3. **GET /api/v1/observability/metrics**
   - Query Params: timeRange
   - Source: Phoenix API at `/v1/metrics`
   - Returns: totalTraces, avgDuration, errorRate, totalCost, tokensUsed, etc.

4. **GET /api/v1/observability/health**
   - Check Phoenix connectivity
   - Returns: phoenixAvailable, phoenixUrl

**Data Transformation:**
- Queries Phoenix (OpenTelemetry data)
- No direct event emission
- Read-only proxy to Phoenix

---

### 5.2 Observability Frontend Page
**File:** `/opt/agenthunt/frontend/app/observability/page.tsx`

**Data Sources:**
- `observabilityApi.getTraces()` - 10-second refresh
- `observabilityApi.getMetrics()` - 10-second refresh
- `observabilityApi.getHealth()` - On mount

**Metrics Displayed:**
- Total Traces
- Average Duration
- Error Rate
- Total Cost (with token count)
- Trace list with filtering
- Trace details with spans
- Status indicators

---

### 5.3 Event Emitters in Backend Agents
**File:** `/opt/agenthunt/backend/src/agents/base.ts`

**Event Emission Methods:**
```typescript
protected async emitProgress(
  current: number,
  total: number,
  message?: string,
  details?: Record<string, any>
): Promise<void>

// Emits: {
//   id, type: 'progress', timestamp,
//   jobId, programId, current, total,
//   percentage, message, details
// }
```

**Event System Integration:**
- All agents extend BaseAgent
- Access to shared `events` service
- Automatic progress tracking during tool execution

---

## SECTION 6: CURRENT GAPS & INTEGRATION NEEDS

### 6.1 Terminal/UI Components Not Using Real-Time Progress
| Component | Current Method | Needed Update |
|-----------|-----------------|---------------|
| Job Detail Progress Card | 5s polling via React Query | Subscribe to progress events via WebSocket |
| Job List Page | 5s polling via React Query | Real-time job status via WebSocket |
| Execution Timeline | Mock data hardcoded | Connect to actual turn/interaction data |
| Dashboard Queue Status | 5s polling via React Query | Real-time queue updates via WebSocket |
| LiveTerminal | ✓ WebSocket ready | Ready for use |

### 6.2 Data Sources Not Yet Emitting Events
| Data | Current Location | Needs Event Emission |
|------|-------------------|----------------------|
| Turn/Interaction data | Hardcoded mocks | Backend agents must emit structured turn events |
| Handoff events | Hardcoded mocks | Agent coordinator should emit handoff events |
| Individual tool executions | Not exposed | Base agent should emit action start/completion |
| Progress details | In job.progress | Already emitted by BaseAgent |

### 6.3 Observability Integration Status
| Component | Status | Notes |
|-----------|--------|-------|
| Phoenix API routes | ✓ Implemented | Read-only proxy working |
| Observability UI | ✓ Implemented | Shows traces and metrics |
| Event tracing (OpenTelemetry) | ✓ Initialized | In `/services/tracing.ts` |
| Trace persistence to job details | ✗ Mock data | Job detail page needs trace ID lookup |

---

## SECTION 7: FILE PATHS REFERENCE

### Frontend Components
- **LiveTerminal:** `/opt/agenthunt/frontend/components/LiveTerminal.tsx`
- **JobQueueManager:** `/opt/agenthunt/frontend/components/JobQueueManager.tsx`
- **JobCommandViewer:** `/opt/agenthunt/frontend/components/JobCommandViewer.tsx`

### Frontend Pages
- **Terminal Page:** `/opt/agenthunt/frontend/app/terminal/page.tsx`
- **Job Detail Page:** `/opt/agenthunt/frontend/app/jobs/[id]/page.tsx`
- **Jobs List Page:** `/opt/agenthunt/frontend/app/jobs/page.tsx`
- **Dashboard:** `/opt/agenthunt/frontend/app/dashboard/page.tsx`
- **Observability:** `/opt/agenthunt/frontend/app/observability/page.tsx`

### Frontend Hooks
- **useWebSocket & useEventStream:** `/opt/agenthunt/frontend/hooks/useWebSocket.ts`

### Frontend API Client
- **API definitions:** `/opt/agenthunt/frontend/lib/api.ts`

### Backend Services
- **Event Service (WebSocket/EventEmitter):** `/opt/agenthunt/backend/src/services/events.ts`
- **Queue Service (Job Events):** `/opt/agenthunt/backend/src/services/queue.ts`
- **Base Agent (Event emission):** `/opt/agenthunt/backend/src/agents/base.ts`

### Backend Routes
- **Observability API:** `/opt/agenthunt/backend/src/api/routes/observability.ts`
- **Jobs API:** `/opt/agenthunt/backend/src/api/routes/jobs.ts`

### Backend Initialization
- **Main Server:** `/opt/agenthunt/backend/src/index.ts`
- **Tracing (OpenTelemetry):** `/opt/agenthunt/backend/src/services/tracing.ts`

---

## SECTION 8: MIGRATION STRATEGY

### Phase 1: Real-Time Job Status (Immediate)
**Goal:** Replace 5-second polling with real-time WebSocket updates

**Files to Update:**
1. `/opt/agenthunt/frontend/app/jobs/page.tsx`
   - Replace React Query polling with WebSocket listener
   - Update job list in real-time

2. `/opt/agenthunt/frontend/app/dashboard/page.tsx`
   - Replace queue stats polling with WebSocket
   - Real-time queue updates

3. `/opt/agenthunt/backend/src/services/queue.ts`
   - Already has event emissions
   - Ensure all status changes call events.emitJobStatus()

### Phase 2: Progress Events (High Priority)
**Goal:** Live progress bars and tool execution details

**Files to Update:**
1. `/opt/agenthunt/frontend/app/jobs/[id]/page.tsx`
   - Subscribe to progress events for live updates
   - Remove polling for job.progress

2. `/opt/agenthunt/backend/src/agents/base.ts`
   - Verify `emitProgress()` is called during execution
   - Include tool details in progress event

### Phase 3: Execution Timeline (Medium Priority)
**Goal:** Replace mock turn/interaction data with real events

**Files to Create/Update:**
1. New event types in shared types:
   - TurnStarted, TurnCompleted
   - InteractionStarted, InteractionCompleted
   - ActionStarted, ActionCompleted

2. Backend emission points:
   - Agent coordinator when turns occur
   - LLM interaction completion
   - Tool execution lifecycle

3. Frontend listeners:
   - Listen for turn events
   - Build timeline dynamically
   - Replace mock data

### Phase 4: Handoffs & Patterns (Lower Priority)
**Goal:** Real-time agent coordination visibility

**Files to Update:**
1. Backend event emission in:
   - `/opt/agenthunt/backend/src/services/handoffs.ts`
   - `/opt/agenthunt/backend/src/services/pattern-manager.ts`

2. Frontend listener in:
   - `/opt/agenthunt/frontend/app/jobs/[id]/page.tsx`

---

## SECTION 9: SUMMARY TABLE

| Component | Type | Current Source | Needs Update | Priority |
|-----------|------|-----------------|--------------|----------|
| LiveTerminal | Component | WebSocket ✓ | Minor polish | Low |
| Terminal Page | Page | WebSocket ✓ | Minor polish | Low |
| Job Progress Card | Card | 5s polling | Real-time WebSocket | HIGH |
| Execution Timeline | Card | Mock data | Real event listeners | HIGH |
| Job List | Page | 5s polling | Real-time WebSocket | HIGH |
| Queue Status | Section | 5s polling | Real-time WebSocket | HIGH |
| Observability Page | Page | Phoenix proxy | Trace-to-job linking | MEDIUM |
| Handoffs Display | Card | Mock data | Real events | MEDIUM |

---

**Report Generated:** 2025-11-13
**System:** AgentHunt Observability Integration Analysis
