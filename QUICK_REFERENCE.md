# Quick Reference: Observability & Terminal Systems

## WebSocket Event Structure
```javascript
{
  id: string;                    // UUID
  type: 'log' | 'finding' | 'job_status' | 'progress' | 'human_action_request' | 'connection';
  timestamp: Date;
  
  // Fields vary by type:
  // Log: level, tool, context, message, jobId, programId, workerId
  // Finding: finding object with severity/title
  // JobStatus: job object with status
  // Progress: current, total, percentage, message, jobId, programId
  // HumanAction: action, reason, jobId, programId
}
```

## Real-Time Data Flow
```
Backend Agents → EventService.emit*() → WebSocket Broadcast → Frontend Listeners
                                     → Database Persistence
```

## Event Emission Points
| Event Type | Emitter | Method | Data Persisted |
|------------|---------|--------|-----------------|
| Log | BaseAgent, Services | emitLog() | Yes |
| Finding | Scanner agents | emitFinding() | Yes |
| JobStatus | Queue service | emitJobStatus() | Yes |
| Progress | BaseAgent | emitProgress() | No (too frequent) |
| HumanAction | HITL service | emitHumanActionRequest() | Yes |

## Components Currently Using WebSocket
- LiveTerminal (`/opt/agenthunt/frontend/components/LiveTerminal.tsx`) ✓
- Terminal Page (`/opt/agenthunt/frontend/app/terminal/page.tsx`) ✓

## Components Still Using 5-Second Polling (Need Update)
- Job Detail Progress Card (real-time progress)
- Job List Page (job status changes)
- Dashboard Queue Status (queue statistics)
- Job Queue Manager (status updates)

## Key Frontend Hook
```typescript
const { events, isConnected, clearEvents } = useEventStream({
  jobId?: string;
  programId?: string;
  type?: string;
});
```

## Key Backend Services
- **EventService**: WebSocket server + event broadcasting
- **QueueService**: Job queue management + event notifications
- **BaseAgent**: Abstract base for all agents + emitProgress()
- **NotificationService**: Telegram alerts on job status changes

## Observable Metrics
- Job progress (current, total, percentage)
- Job status changes (pending → active → completed/failed)
- Tool execution details
- Error tracking & logging
- Finding discovery

## Not Yet Observable
- Turn/Interaction execution details
- Agent handoff events
- Individual tool action execution steps
- LLM interaction telemetry (in Phoenix but not in events)

## Connection Endpoints
- Frontend WebSocket: `ws://localhost:3000/events`
- Backend API: `http://localhost:3001/api/v1`
- Phoenix Observability: `http://165.227.108.120:6006`

## Database Events Table
```sql
CREATE TABLE events (
  id UUID PRIMARY KEY,
  type VARCHAR(50),
  program_id UUID,
  job_id UUID,
  worker_id VARCHAR(255),
  level VARCHAR(50),           -- Log level
  tool VARCHAR(255),           -- Tool name
  context VARCHAR(255),        -- Execution context
  message TEXT,
  payload JSONB,               -- Full event object
  timestamp TIMESTAMP
);
```

## Priority Updates
1. **HIGH**: Replace job list/progress polling with WebSocket
2. **HIGH**: Real-time queue status on dashboard
3. **MEDIUM**: Execution timeline (turns/interactions)
4. **MEDIUM**: Agent handoff events
5. **LOW**: Terminal component polishing

