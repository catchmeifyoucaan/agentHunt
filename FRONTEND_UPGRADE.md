# Frontend Upgrade Plan - Phase 1-4 Features

## ✅ Completed

### 1. Observability Dashboard (`/observability`)
**Features:**
- Real-time metrics cards (Total Traces, Avg Duration, Error Rate, Total Cost)
- Additional metrics (Agent Executions, Tool Executions, LLM Calls, Tokens Used)
- Trace Explorer with search and filtering
- Span Timeline visualization
- Phoenix integration (opens http://localhost:6006)
- Beautiful gradient colors and hover effects
- Auto-refresh every 10 seconds

**Key Components:**
- Trace cards with status indicators (CheckCircle/XCircle)
- Span timeline with line connectors
- Attribute display (tool, AI provider, tokens, cost)
- Time range selector (5m, 1h, 24h, 7d)

### 2. Patterns Management (`/patterns`)
**Features:**
- Pattern library grid view with cards
- Execute patterns with program selection
- Pattern statistics (Total, Executions, Success Rate, Avg Duration)
- Execution history with status tracking
- Smart recommendations tab
- Workflow visualization (Agent steps with arrows)
- Color-coded tags (reconnaissance, fast, slow, wordpress, api, etc.)

**Key Components:**
- Pattern cards with metadata (duration, cost, steps, use case)
- Execution button with loading state
- History timeline
- Tag badges with custom colors

## 🚧 In Progress

### 3. Agent Graph Visualization (`/agent-graph`)
**Planned Features:**
- Interactive graph visualization with nodes and edges
- Agent nodes (WordPress, API, Joomla, Drupal, Generic specialists)
- Edge types (handoff, coordination, shared_state, fallback)
- Load balancing visualization (current load / capacity)
- Real-time updates
- Agent statistics panel
- Knowledge base integration

**Technical:**
- Use React Flow or D3.js for graph visualization
- Color-code nodes by specialization
- Edge thickness by weight
- Node size by capacity

### 4. Knowledge Base Browser (`/knowledge`)
**Planned Features:**
- Discoveries browser (filter by target, type, agent)
- Strategies browser (filter by vuln type, success rate)
- Metadata viewer (technologies, WAF, CDN)
- Timeline view of discoveries
- Success rate charts
- Agent contribution statistics

### 5. Enhanced Job Details (`/jobs/[id]`)
**Planned Features:**
- Turn/Interaction/Action hierarchy display
- Collapsible sections for each turn
- Reasoning display (LLM prompts and responses)
- Action timeline with duration bars
- Handoff visualization
- OpenTelemetry trace link
- Pattern execution context (if job is part of pattern)
- Enhanced metadata display

**Layout:**
```
Job Details
├─ Header (Status, Duration, Agent Type)
├─ Turns Section
│  ├─ Turn 1 (Active/Completed/Failed)
│  │  ├─ Interaction 1
│  │  │  ├─ Reasoning (LLM prompt/response)
│  │  │  └─ Actions
│  │  │     ├─ Action 1: nuclei (duration, exit code)
│  │  │     └─ Action 2: httpx (duration, exit code)
│  │  └─ Interaction 2
│  └─ Turn 2
├─ Handoffs Section (if any)
└─ Trace Link (OpenTelemetry)
```

### 6. Certificate Monitor Dashboard (`/cert-monitor`)
**Planned Features:**
- Monitored domains list
- Live certificate stream
- Discovery timeline
- New subdomains alerts
- Auto-triggered jobs display
- Statistics (total discoveries, domains monitored, avg discovery time)

## 🎨 UI/UX Improvements

### Global Improvements
1. **Color Palette:**
   - Primary: Purple-Pink gradient (patterns, main actions)
   - Blue: Observability, traces, info
   - Green: Success, completed, health
   - Red: Errors, failed, alerts
   - Orange: Warnings, in-progress
   - Indigo/Cyan: Specialized agents

2. **Typography:**
   - Headers: Bold, gradient text
   - Body: Gray-600 for secondary text
   - Monospace: For IDs, traces, code

3. **Spacing:**
   - Container: max-w-7xl with proper padding
   - Cards: Consistent padding (pt-6 for content)
   - Gaps: space-y-8 for main sections, space-y-4 for cards

4. **Animations:**
   - Hover: shadow-lg transitions
   - Loading: Spinning border animation
   - Cards: transition-all for smooth effects

5. **Icons:**
   - Lucide React icons throughout
   - Consistent sizing (w-4 h-4 for inline, w-8 h-8 for cards)
   - Color-matched to context

### Sidebar Updates
Add new navigation links:
- 🔍 Observability (Activity icon)
- 📋 Patterns (GitBranch icon)
- 🕸️ Agent Graph (Network icon)
- 🧠 Knowledge Base (Brain icon)
- 🔐 Cert Monitor (Shield icon)

Group into sections:
- **Overview:** Dashboard, Programs, Jobs
- **Advanced:** Observability, Patterns, Agent Graph, Knowledge Base
- **Tools:** Findings, Terminal, Cert Monitor
- **Settings:** Settings, Profile

## 🚀 Performance Optimizations

### Implemented
1. **Auto-refresh:** Configurable intervals (10s for observability)
2. **Pagination:** Limit results display
3. **Lazy Loading:** Load data on demand
4. **Debounced Search:** Prevent excessive API calls
5. **Memoization:** React.useMemo for expensive computations

### Planned
1. **Virtual Scrolling:** For large lists (traces, executions)
2. **Code Splitting:** Lazy load heavy visualizations
3. **Service Worker:** Cache static assets
4. **Optimistic Updates:** Update UI before API response
5. **WebSocket:** Real-time updates for live data

## 📱 Responsive Design

### Breakpoints
- Mobile: < 768px (1 column)
- Tablet: 768px - 1024px (2 columns)
- Desktop: > 1024px (3-4 columns)

### Grid Layouts
- Metrics cards: 1/2/4 columns (mobile/tablet/desktop)
- Pattern cards: 1/2 columns
- Job details: Full width with collapsible sections

## 🎯 Next Steps

1. **Complete Agent Graph page** with interactive visualization
2. **Complete Knowledge Base page** with discoveries/strategies browser
3. **Enhance Job Details page** with Turn/Interaction/Action hierarchy
4. **Update Sidebar** with new navigation
5. **Add Certificate Monitor page**
6. **Improve existing pages:**
   - Dashboard: Add quick links to new features
   - Programs: Add pattern recommendations
   - Jobs: Add trace viewer link
7. **SEO Optimization:**
   - Add meta tags to all pages
   - Add Open Graph tags
   - Add structured data
8. **Testing:**
   - E2E tests for critical flows
   - Performance testing
   - Accessibility testing

## 🎨 Component Library

### New Reusable Components Needed
1. **TraceTimeline:** Visual timeline for spans
2. **AgentGraph:** Interactive graph visualization
3. **MetricCard:** Gradient border with icon
4. **StatusBadge:** Color-coded status indicators
5. **ActionCard:** Tool execution display
6. **ReasoningDisplay:** LLM prompt/response viewer
7. **DiscoveryCard:** Knowledge base discovery
8. **StrategyCard:** Attack strategy display

### Existing Components to Update
1. **Sidebar:** Add new sections and links
2. **Header:** Add breadcrumbs
3. **JobCard:** Add pattern context
4. **FindingCard:** Add discovery link

## 💾 API Integration

### New Endpoints to Connect
1. `/api/agent-graph/statistics` - Graph metrics
2. `/api/agent-graph/export` - Graph visualization data
3. `/api/agent-graph/discoveries` - Knowledge base
4. `/api/agent-graph/strategies` - Attack strategies
5. `/api/patterns` - List patterns
6. `/api/patterns/:name/execute` - Execute pattern
7. `/api/patterns/executions/history` - Execution history
8. `/api/cert-monitor/domains` - Monitored domains
9. `/api/cert-monitor/statistics` - Cert monitor stats

### Phoenix Integration
- Direct link to http://localhost:6006 for full traces
- Fetch trace data via Phoenix API (if available)
- Display key metrics in dashboard

## 🔧 Configuration

### Environment Variables
```env
NEXT_PUBLIC_API_URL=http://localhost:3000/api
NEXT_PUBLIC_PHOENIX_URL=http://localhost:6006
NEXT_PUBLIC_WS_URL=ws://localhost:3000
```

### Feature Flags
```typescript
export const features = {
  observability: true,
  patterns: true,
  agentGraph: true,
  knowledgeBase: true,
  certMonitor: true,
  // Future features
  angelAgent: false,
  guardianAgent: false,
};
```

## 📊 Success Metrics

### Performance
- Page load: < 1s
- Time to interactive: < 2s
- API response: < 500ms
- WebSocket latency: < 100ms

### UX
- Click to action: < 2 clicks for any feature
- Search results: < 0.5s
- Error recovery: Automatic retry with feedback

### Accessibility
- Lighthouse score: > 90
- WCAG 2.1 AA compliance
- Keyboard navigation: Full support
- Screen reader: Proper ARIA labels
