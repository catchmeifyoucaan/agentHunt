# Observability & Terminal Systems Documentation Index

Generated: 2025-11-13  
Scope: Comprehensive analysis of terminal implementations, data sources, progress tracking, and observability integration

---

## Documents in This Package

### 1. **OBSERVABILITY_INTEGRATION_REPORT.md** (14 KB)
**Comprehensive technical reference**

Complete inventory of all terminal implementations, data sources, and observability components. Includes:
- 3 terminal implementations (LiveTerminal, Terminal Page, Job Details)
- WebSocket architecture and event flow
- Queue management and status components
- Progress tracking systems
- Observable metrics and KPIs
- Current gaps and integration needs
- Migration strategy (4 phases)
- File path reference guide

**Use this for:** Deep technical understanding, implementation planning, architecture review

---

### 2. **FINDINGS_SUMMARY.txt** (8.8 KB)
**Executive summary and action items**

High-level overview with clear statistics and actionable findings:
- 3 terminal implementations found
- 2 WebSocket-enabled, 4 polling-based (needs update)
- 5 event types available
- 3 mock data sections identified
- Clear prioritization (HIGH/MEDIUM/LOW)
- Database schema reference
- Recommended next steps

**Use this for:** Quick overview, stakeholder communication, task prioritization

---

### 3. **QUICK_REFERENCE.md** (3.2 KB)
**One-page developer cheat sheet**

Quick lookup for developers integrating new features:
- WebSocket event structure
- Event emission points and methods
- Components status (✓ done, polling, mock)
- Key backend services
- Connection endpoints
- Database schema snippet
- Priority updates checklist

**Use this for:** Development reference, code lookup, quick decisions

---

## Quick Navigation

### I need to...

**Understand the current system:**
→ Start with FINDINGS_SUMMARY.txt (quick overview)  
→ Then OBSERVABILITY_INTEGRATION_REPORT.md (deep dive)

**Implement real-time job updates:**
→ QUICK_REFERENCE.md (WebSocket structure)  
→ OBSERVABILITY_INTEGRATION_REPORT.md Section 6 (gaps & needs)

**Add new event types:**
→ QUICK_REFERENCE.md (event emission table)  
→ OBSERVABILITY_INTEGRATION_REPORT.md Section 5 (emitters)

**Replace polling with WebSocket:**
→ FINDINGS_SUMMARY.txt (HIGH PRIORITY items)  
→ OBSERVABILITY_INTEGRATION_REPORT.md Section 8 (migration)

**Check what's already working:**
→ FINDINGS_SUMMARY.txt (Key Findings #2)

---

## Key Statistics at a Glance

| Metric | Value |
|--------|-------|
| Terminal Implementations | 3 |
| WebSocket-Enabled | 2 (ready) |
| Polling-Based | 4 (needs update) |
| Event Types Available | 5 |
| Mock Data Sections | 3 |
| Backend Event Emitters | 4+ services |
| Database Event Persistence | Yes (except progress) |
| Phoenix Integration | Read-only (working) |
| Real-time Infrastructure | Ready |

---

## File Locations (Absolute Paths)

### Frontend
- LiveTerminal: `/opt/agenthunt/frontend/components/LiveTerminal.tsx`
- Terminal Page: `/opt/agenthunt/frontend/app/terminal/page.tsx`
- Job Detail: `/opt/agenthunt/frontend/app/jobs/[id]/page.tsx`
- WebSocket Hook: `/opt/agenthunt/frontend/hooks/useWebSocket.ts`

### Backend
- Event Service: `/opt/agenthunt/backend/src/services/events.ts`
- Queue Service: `/opt/agenthunt/backend/src/services/queue.ts`
- Observability Routes: `/opt/agenthunt/backend/src/api/routes/observability.ts`

---

## Priority Implementation Roadmap

### Phase 1: Real-time Job Status (2-3 hours)
Replace 5-second polling with WebSocket
- Job List Page
- Dashboard Queue Stats
- Job Queue Manager

### Phase 2: Real-time Progress (1-2 hours)
Live progress bars and tool details
- Job Detail Progress Card
- Progress event listeners

### Phase 3: Execution Timeline (4-6 hours)
Replace mock data with real events
- Turn/Interaction/Action events
- Timeline builder
- Mock data removal

### Phase 4: Coordination Visibility (3-4 hours)
Agent handoffs and pattern execution
- Handoff events
- Pattern context events

---

## Data Connections Reference

### Currently Real-Time (WebSocket)
✓ LiveTerminal  
✓ Terminal Page  

### Currently Polling (5s interval)
• Job List  
• Job Progress  
• Queue Stats  
• Job Queue Manager  

### Event Types Broadcasting
1. **Log** - System/tool logs (persisted)
2. **Finding** - Security discoveries (persisted)
3. **JobStatus** - Job lifecycle (persisted)
4. **Progress** - Real-time progress (NOT persisted)
5. **HumanAction** - HITL operations (persisted)

---

## WebSocket Connection Details

**Endpoint:** `ws://localhost:3000/events`  
**Auto-reconnect:** 3-second retry  
**Message Format:** JSON  
**Max Events Buffered:** 1000  
**Filtering Options:** programId, jobId, type

---

## Observable Metrics

### Currently Available
- Job progress (current/total/percentage)
- Job status (pending → active → completed/failed)
- Tool execution details
- Error tracking
- Finding discovery events
- LLM interaction cost (via Phoenix)
- Execution duration

### Not Yet Observable
- Turn/Interaction structure
- Agent handoff events
- Individual action execution
- Complete LLM telemetry (in Phoenix, not in events)

---

## Quick Command Reference

### View WebSocket events
```bash
# See if events are being emitted
tail -f backend/logs/app.log | grep "event"
```

### Check event database
```sql
SELECT type, COUNT(*) FROM events 
GROUP BY type 
ORDER BY COUNT(*) DESC;
```

### Test WebSocket connection
```javascript
const ws = new WebSocket('ws://localhost:3000/events');
ws.onmessage = (e) => console.log(JSON.parse(e.data));
```

---

## Troubleshooting Guide

**Events not appearing?**
1. Check EventService is initialized (backend/src/index.ts line 219)
2. Verify agents are calling emitProgress/emitLog
3. Check WebSocket connection in browser DevTools

**Progress not updating?**
1. Progress events are NOT persisted to database (by design)
2. Must use WebSocket real-time connection
3. Check job.progress field in database

**Polling vs Real-time confusion?**
1. LiveTerminal = Real-time (WebSocket) ✓
2. Job List = Polling (needs update)
3. Progress Card = Polling (needs update)
4. Queue Stats = Polling (needs update)

---

## Document Structure Summary

```
OBSERVABILITY_INTEGRATION_REPORT.md
├── Section 1: Terminal Implementations (3 found)
├── Section 2: Data Sources & Connections (WebSocket + Polling)
├── Section 3: Dashboard Queue Component
├── Section 4: Progress & Job Details Display
├── Section 5: Observability Endpoints & Event Emitters
├── Section 6: Current Gaps & Integration Needs
├── Section 7: File Paths Reference
├── Section 8: Migration Strategy (4 phases)
└── Section 9: Summary Table

FINDINGS_SUMMARY.txt
├── Key Findings (6 main points)
├── Component Inventory
├── Data Flow Architecture
├── Gaps & Needed Updates (HIGH/MEDIUM/LOW)
├── Files to Update
├── Database Schema
├── Observability Endpoints
├── Event Filtering Capabilities
├── Migration Roadmap
├── Summary Statistics
└── Recommended Next Steps

QUICK_REFERENCE.md
├── WebSocket Event Structure
├── Real-Time Data Flow
├── Event Emission Points (table)
├── Components Using WebSocket
├── Components Using Polling
├── Key Frontend Hook
├── Key Backend Services
├── Observable Metrics
├── Connection Endpoints
├── Database Schema
└── Priority Updates
```

---

## Contact Points for Implementation

### For Real-Time Conversion
File: `/opt/agenthunt/frontend/hooks/useWebSocket.ts`
Export: `useEventStream()` hook - already fully implemented and ready to use

### For Event Emission
Files: 
- `/opt/agenthunt/backend/src/services/events.ts` - emit methods
- `/opt/agenthunt/backend/src/agents/base.ts` - emitProgress method

### For Database Persistence
Table: `events` with columns:
- id, type, program_id, job_id, worker_id
- level, tool, context, message, payload, timestamp

---

## Final Checklist for Implementation

- [ ] Read FINDINGS_SUMMARY.txt (5 min)
- [ ] Review OBSERVABILITY_INTEGRATION_REPORT.md Section 6 (10 min)
- [ ] Check QUICK_REFERENCE.md for details (5 min)
- [ ] Locate component files (absolute paths provided)
- [ ] Plan Phase 1 implementation (real-time job status)
- [ ] Test WebSocket connectivity
- [ ] Implement job list real-time updates
- [ ] Verify event flow end-to-end
- [ ] Move to Phase 2 (progress tracking)
- [ ] Continue with Phase 3 & 4

---

**Total Documentation:** 26 KB (3 files)  
**Implementation Time Estimate:** 10-15 hours (all 4 phases)  
**Complexity:** Medium (infrastructure ready, frontend integration needed)  
**Risk Level:** Low (existing patterns, no breaking changes)

Happy implementing! 

