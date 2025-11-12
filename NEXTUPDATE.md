# 🚀 NEXTUPDATE: Advanced Features Roadmap

## Executive Summary

This document outlines the next major update to AgentHunt, adding **7 advanced features** that will transform the platform from a bug bounty tool into an **enterprise-grade multi-agent security orchestration system**.

**Timeline**: 12-16 weeks (3-4 months)
**Expected Impact**: 150-200% improvement in capabilities
**Current Completion**: 80% → **95%+ after this update**

---

## 📋 Features Overview

| # | Feature | Impact | Effort | Priority | Timeline |
|---|---------|--------|--------|----------|----------|
| 1 | **OpenTelemetry + Phoenix Observability** | ⚡ VERY HIGH | MEDIUM | **P0** | Week 1-2 |
| 2 | **Handoffs System** | ⚡ HIGH | MEDIUM | **P0** | Week 3-4 |
| 3 | **Turns and Interactions Model** | 🟡 MEDIUM | MEDIUM | **P1** | Week 5-6 |
| 4 | **Enhanced Tool Suite** | ⚡ HIGH | HIGH | **P1** | Week 7-10 |
| 5 | **Formal Patterns System** | 🟡 MEDIUM | HIGH | **P2** | Week 11-12 |
| 6 | **Live Certificate Streams** | 🟡 MEDIUM | MEDIUM | **P2** | Week 13-14 |
| 7 | **Graph of Agents** | ⚡ VERY HIGH | VERY HIGH | **P3** | Week 15-18 |

---

## 🎯 Phase 1: Observability & Coordination (Week 1-4)

### Feature 1: OpenTelemetry + Phoenix Observability ⚡

**Goal**: Add comprehensive distributed tracing to debug complex multi-agent workflows

#### Current State
- Basic logging (Winston)
- WebSocket events (job_status, findings, logs)
- Progress tracking (percentage complete)
- **Problem**: Can't trace complex chains like Discovery → Fingerprint → Scanner → Triage

#### Proposed Solution
Implement OpenTelemetry standard with Phoenix backend for real-time observability.

#### Architecture
```
┌─────────────────────────────────────────────────────────┐
│                 Phoenix Dashboard                        │
│  - Trace visualization (waterfall charts)               │
│  - Span analysis (which tool is slow?)                  │
│  - Agent interaction graphs                             │
│  - LLM decision tracking (why did AI choose "high"?)    │
└────────────────────┬────────────────────────────────────┘
                     │ (OpenTelemetry Protocol)
                     ▼
┌─────────────────────────────────────────────────────────┐
│           OpenTelemetry Collector                        │
│  - Receives spans from all agents                       │
│  - Batches and forwards to Phoenix                      │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┬─────────────┐
        ▼            ▼            ▼             ▼
    Discovery    Fingerprint   Scanner      Triage
    (traces)     (traces)      (traces)     (traces)
```

#### Implementation Steps

**Step 1: Install Dependencies** (Day 1)
```bash
npm install @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node
npm install @opentelemetry/exporter-trace-otlp-http
npm install arize-phoenix-otel  # Phoenix integration
```

**Step 2: Add Tracing Middleware** (Day 2-3)
```typescript
// /backend/src/services/tracing.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.PHOENIX_ENDPOINT || 'http://localhost:6006/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
  serviceName: 'agenthunt',
});

sdk.start();
export default sdk;
```

**Step 3: Instrument Agents** (Day 4-5)
```typescript
// /backend/src/agents/base.ts
import { trace, SpanStatusCode } from '@opentelemetry/api';

export abstract class BaseAgent<T extends BaseJob> {
  protected tracer = trace.getTracer('agenthunt-agent');

  async process(job: Job<T>): Promise<any> {
    const span = this.tracer.startSpan(`${this.agentType}.process`, {
      attributes: {
        'agent.type': this.agentType,
        'job.id': job.id,
        'job.type': job.data.type,
        'program.id': job.data.programId,
      },
    });

    try {
      const result = await this._processInternal(job);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  }

  protected async executeCommand(command: string): Promise<any> {
    const span = this.tracer.startSpan('tool.execute', {
      attributes: {
        'tool.command': command.split(' ')[0], // e.g., "nuclei"
        'agent.type': this.agentType,
      },
    });

    try {
      const result = await this._executeCommandInternal(command);
      span.setAttribute('tool.duration_ms', result.duration);
      span.setAttribute('tool.exit_code', result.exitCode);
      return result;
    } finally {
      span.end();
    }
  }
}
```

**Step 4: Instrument AI Calls** (Day 6-7)
```typescript
// /backend/src/services/ai.ts
import { trace } from '@opentelemetry/api';

class AIService {
  private tracer = trace.getTracer('agenthunt-ai');

  async parseAndTriageFinding(rawOutput: any): Promise<any> {
    const span = this.tracer.startSpan('ai.triage', {
      attributes: {
        'ai.provider': 'gemini', // or claude, openai
        'finding.template': rawOutput.template_id,
      },
    });

    try {
      const response = await aiProvider.chat([...], { temperature: 0.0 });

      span.setAttributes({
        'ai.provider_used': response.provider,
        'ai.model': response.model,
        'ai.tokens': response.tokensUsed,
        'ai.cost_usd': this.calculateCost(response),
      });

      return JSON.parse(response.content);
    } finally {
      span.end();
    }
  }
}
```

**Step 5: Deploy Phoenix** (Day 8)
```yaml
# docker-compose.yml
services:
  phoenix:
    image: arizephoenix/phoenix:latest
    ports:
      - "6006:6006"  # Phoenix UI
      - "4317:4317"  # OTLP gRPC
    environment:
      - PHOENIX_SQL_DATABASE_URL=postgresql://user:pass@postgres/phoenix
```

**Step 6: Create Dashboards** (Day 9-10)
- Set up Phoenix UI at http://localhost:6006
- Create custom dashboards:
  - Job execution timeline (waterfall chart)
  - Agent performance metrics (avg duration per agent)
  - Tool usage statistics (which tools are slowest?)
  - AI decision tracking (triage severity distribution)
  - Error rate by agent type

#### Success Metrics
- ✅ All agents emit traces
- ✅ Can visualize complete job chains (Discovery → Triage)
- ✅ Identify bottlenecks (e.g., "HTTPx takes 60% of job time")
- ✅ Track AI decisions (why severity=high?)
- ✅ Replay failed jobs with full context

#### Impact
- **Debuggability**: 80% faster issue resolution
- **Performance**: Identify bottlenecks instantly
- **AI Transparency**: Understand AI decisions
- **Production Readiness**: Enterprise-grade observability

---

### Feature 2: Handoffs System ⚡

**Goal**: Enable formal agent-to-agent delegation with validation chains

#### Current State
- Agents trigger jobs via BullMQ queue
- No formal handoff protocol
- No validation chains
- **Problem**: Can't do "Scanner finds SQLi → hand to SQLi Specialist → hand to Validator"

#### Proposed Solution
Implement formal handoff system with validation chains and specialist routing.

#### Architecture
```
┌──────────────────────────────────────────────────────┐
│              Primary Agent (Scanner)                  │
│  - Runs Nuclei scan                                  │
│  - Finds potential SQLi                              │
│  - Decision: "Need specialist validation"            │
└────────────────────┬─────────────────────────────────┘
                     │ HANDOFF (with context)
                     ▼
┌──────────────────────────────────────────────────────┐
│          Specialist Agent (SQLi Expert)               │
│  - Receives: finding + context                       │
│  - Runs: SQLMap, Ghauri                              │
│  - Decision: "Confirmed SQLi, need final validation" │
└────────────────────┬─────────────────────────────────┘
                     │ HANDOFF (with proof)
                     ▼
┌──────────────────────────────────────────────────────┐
│          Validator Agent (Confirm)                    │
│  - Multi-method confirmation                         │
│  - Returns: Confirmed or False Positive              │
└──────────────────────────────────────────────────────┘
```

#### Implementation Steps

**Step 1: Define Handoff Interface** (Day 1-2)
```typescript
// /backend/src/agents/handoffs.ts

export interface HandoffContext {
  fromAgent: string;
  toAgent: string;
  reason: string;
  data: Record<string, any>;
  priority: number;
  metadata: {
    programId: string;
    parentJobId: string;
    findingId?: string;
  };
}

export interface HandoffResult {
  accepted: boolean;
  reason?: string;
  nextHandoff?: {
    toAgent: string;
    reason: string;
  };
  result?: any;
}

export abstract class HandoffCapableAgent<T extends BaseJob> extends BaseAgent<T> {
  protected handoffTargets: Map<string, Agent> = new Map();

  registerHandoff(targetAgent: Agent, condition?: (data: any) => boolean): void {
    this.handoffTargets.set(targetAgent.name, targetAgent);
  }

  async handoff(toAgent: string, context: HandoffContext): Promise<HandoffResult> {
    const span = this.tracer.startSpan('agent.handoff', {
      attributes: {
        'handoff.from': context.fromAgent,
        'handoff.to': toAgent,
        'handoff.reason': context.reason,
      },
    });

    try {
      const targetAgent = this.handoffTargets.get(toAgent);
      if (!targetAgent) {
        throw new Error(`Handoff target ${toAgent} not found`);
      }

      // Create specialized job for target agent
      const handoffJobId = uuidv4();
      await queue.addJob(toAgent, {
        id: handoffJobId,
        type: toAgent,
        programId: context.metadata.programId,
        priority: context.priority,
        options: context.data,
        metadata: {
          handoffFrom: context.fromAgent,
          parentJobId: context.metadata.parentJobId,
        },
      });

      span.setAttribute('handoff.job_id', handoffJobId);
      return { accepted: true };
    } finally {
      span.end();
    }
  }
}
```

**Step 2: Create Specialist Agents** (Day 3-5)
```typescript
// /backend/src/agents/specialists/sqli-specialist.ts

export class SQLiSpecialistAgent extends HandoffCapableAgent<any> {
  constructor() {
    super('sqli_specialist');
  }

  async process(job: Job): Promise<any> {
    const { finding, context } = job.data.options;

    // Run SQLMap with specific tests
    const sqlmapResult = await this.runSQLMap(finding.url, finding.parameter);

    // Run Ghauri as backup
    const ghauriResult = await this.runGhauri(finding.url, finding.parameter);

    const confirmed = sqlmapResult.vulnerable || ghauriResult.vulnerable;

    if (confirmed) {
      // Hand off to validator for final confirmation
      return await this.handoff('confirm', {
        fromAgent: this.agentType,
        toAgent: 'confirm',
        reason: 'SQLi confirmed by specialist, need multi-method validation',
        data: {
          finding,
          sqlmapResult,
          ghauriResult,
        },
        priority: 9,
        metadata: job.data.metadata,
      });
    }

    return { vulnerable: false, reason: 'Not exploitable' };
  }
}
```

**Step 3: Update Scanner Agent** (Day 6-7)
```typescript
// /backend/src/agents/scanner.ts

export class ScannerAgent extends HandoffCapableAgent<ScannerJob> {
  constructor() {
    super('scanner');

    // Register handoff targets
    this.registerHandoff(new SQLiSpecialistAgent());
    this.registerHandoff(new XSSSpecialistAgent());
    this.registerHandoff(new SSRFSpecialistAgent());
  }

  async process(job: Job<ScannerJob>): Promise<any> {
    // Run Nuclei scan
    const findings = await this.runNuclei(job.data.options);

    // Process findings and hand off to specialists
    for (const finding of findings) {
      if (this.needsSpecialist(finding)) {
        await this.handToSpecialist(finding, job);
      } else {
        // Regular triage flow
        await this.triggerTriage(finding);
      }
    }

    return { findings: findings.length };
  }

  private needsSpecialist(finding: any): boolean {
    // Logic to determine if specialist needed
    const specialistMap = {
      'sql-injection': 'sqli_specialist',
      'xss': 'xss_specialist',
      'ssrf': 'ssrf_specialist',
    };

    return finding.template_id in specialistMap;
  }

  private async handToSpecialist(finding: any, job: Job): Promise<void> {
    const specialistType = this.getSpecialistType(finding);

    await this.handoff(specialistType, {
      fromAgent: 'scanner',
      toAgent: specialistType,
      reason: `Found potential ${finding.info.severity} ${finding.template_id}`,
      data: { finding },
      priority: this.getPriority(finding.info.severity),
      metadata: {
        programId: job.data.programId,
        parentJobId: job.id!,
        findingId: uuidv4(),
      },
    });
  }
}
```

**Step 4: Create Handoff Visualizer** (Day 8-10)
```typescript
// /backend/src/services/handoff-tracker.ts

export class HandoffTracker {
  async logHandoff(context: HandoffContext): Promise<void> {
    await database.query(
      `INSERT INTO handoffs (from_agent, to_agent, reason, job_id, created_at)
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
      [context.fromAgent, context.toAgent, context.reason, context.metadata.parentJobId]
    );

    // Emit WebSocket event for UI
    await events.emitHandoff({
      type: 'handoff',
      from: context.fromAgent,
      to: context.toAgent,
      reason: context.reason,
      timestamp: new Date(),
    });
  }

  async getHandoffChain(jobId: string): Promise<any[]> {
    const result = await database.query(
      `WITH RECURSIVE handoff_chain AS (
         SELECT * FROM handoffs WHERE job_id = $1
         UNION ALL
         SELECT h.* FROM handoffs h
         INNER JOIN handoff_chain hc ON h.job_id = hc.next_job_id
       )
       SELECT * FROM handoff_chain ORDER BY created_at`,
      [jobId]
    );
    return result.rows;
  }
}
```

#### Database Schema
```sql
-- Add handoffs table
CREATE TABLE handoffs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_agent VARCHAR(100) NOT NULL,
  to_agent VARCHAR(100) NOT NULL,
  reason TEXT,
  job_id UUID REFERENCES jobs(id),
  next_job_id UUID,
  context JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_handoffs_job_id ON handoffs(job_id);
CREATE INDEX idx_handoffs_chain ON handoffs(next_job_id);
```

#### Success Metrics
- ✅ Agents can delegate to specialists
- ✅ Validation chains work (Scanner → Specialist → Validator)
- ✅ Handoff history is tracked and visualizable
- ✅ 20-30% improvement in finding accuracy

#### Impact
- **Accuracy**: 20-30% fewer false positives
- **Specialization**: Expert agents for each vuln type
- **Auditability**: Full handoff chains for compliance
- **Collaboration**: Agents work together intelligently

---

## 🎯 Phase 2: State Management & Enhanced Tools (Week 5-10)

### Feature 3: Turns and Interactions Model 🟡

**Goal**: Formalize agent execution cycles for better state management

#### Current State
- Jobs execute linearly (start → run → complete)
- No concept of "turns" or "interactions"
- **Problem**: Can't pause mid-execution, no granular state tracking

#### Proposed Solution
Implement formal turns/interactions model based on ReACT pattern.

#### Architecture
```
TURN 1
├─ Interaction 1: Reasoning (LLM: "I need to find subdomains")
│  └─ Action: Call Subfinder tool
├─ Interaction 2: Reasoning (LLM: "Found 1000 subdomains, need DNS check")
│  └─ Action: Call DNSx tool
├─ Interaction 3: Reasoning (LLM: "500 resolved, ready for HTTPx")
│  └─ Action: Return None (turn complete)

TURN 2 (triggered by orchestrator)
├─ Interaction 1: Reasoning (LLM: "Got 500 targets, probe with HTTPx")
│  └─ Action: Call HTTPx tool
├─ Interaction 2: Reasoning (LLM: "300 alive hosts, scan with Nuclei")
│  └─ Action: Return None (turn complete)
```

#### Implementation Steps

**Step 1: Define Turn/Interaction Models** (Day 1-2)
```typescript
// /backend/src/agents/models.ts

export interface Interaction {
  id: string;
  turn_id: string;
  sequence: number;
  reasoning: {
    prompt: string;
    response: string;
    model: string;
    tokens: number;
  };
  actions: Action[];
  state: 'pending' | 'reasoning' | 'acting' | 'completed';
  created_at: Date;
  completed_at?: Date;
}

export interface Action {
  id: string;
  interaction_id: string;
  tool: string;
  input: Record<string, any>;
  output?: Record<string, any>;
  duration_ms?: number;
  error?: string;
}

export interface Turn {
  id: string;
  job_id: string;
  sequence: number;
  interactions: Interaction[];
  state: 'active' | 'completed' | 'failed';
  trigger: 'initial' | 'orchestrator' | 'handoff';
  created_at: Date;
  completed_at?: Date;
}
```

**Step 2: Implement Turn Manager** (Day 3-5)
```typescript
// /backend/src/services/turn-manager.ts

export class TurnManager {
  async startTurn(jobId: string, trigger: string): Promise<Turn> {
    const turn: Turn = {
      id: uuidv4(),
      job_id: jobId,
      sequence: await this.getNextTurnSequence(jobId),
      interactions: [],
      state: 'active',
      trigger,
      created_at: new Date(),
    };

    await this.saveTurn(turn);
    return turn;
  }

  async processInteraction(turnId: string, agent: Agent): Promise<Interaction> {
    const interaction: Interaction = {
      id: uuidv4(),
      turn_id: turnId,
      sequence: await this.getNextInteractionSequence(turnId),
      reasoning: null, // Filled by LLM
      actions: [],
      state: 'pending',
      created_at: new Date(),
    };

    // 1. Reasoning step
    interaction.state = 'reasoning';
    interaction.reasoning = await agent.reason();

    // 2. Acting step
    interaction.state = 'acting';
    interaction.actions = await agent.act(interaction.reasoning);

    // 3. Complete
    interaction.state = 'completed';
    interaction.completed_at = new Date();

    await this.saveInteraction(interaction);
    return interaction;
  }

  async completeTurn(turnId: string): Promise<void> {
    await database.query(
      `UPDATE turns SET state = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [turnId]
    );
  }
}
```

**Step 3: Update Base Agent** (Day 6-8)
```typescript
// /backend/src/agents/base.ts

export abstract class BaseAgent<T extends BaseJob> {
  protected turnManager = new TurnManager();

  async process(job: Job<T>): Promise<any> {
    const turn = await this.turnManager.startTurn(job.id!, 'initial');

    let shouldContinue = true;
    while (shouldContinue) {
      const interaction = await this.turnManager.processInteraction(turn.id, this);

      // If agent returns null actions, turn is complete
      shouldContinue = interaction.actions.length > 0;
    }

    await this.turnManager.completeTurn(turn.id);
    return { turn_id: turn.id };
  }

  // Abstract methods for ReACT pattern
  abstract async reason(): Promise<{ prompt: string; response: string; model: string; tokens: number }>;
  abstract async act(reasoning: any): Promise<Action[]>;
}
```

**Step 4: Database Schema** (Day 9)
```sql
CREATE TABLE turns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_id UUID REFERENCES jobs(id),
  sequence INTEGER NOT NULL,
  state VARCHAR(50),
  trigger VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE interactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  turn_id UUID REFERENCES turns(id),
  sequence INTEGER NOT NULL,
  reasoning JSONB,
  state VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP
);

CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  interaction_id UUID REFERENCES interactions(id),
  tool VARCHAR(100),
  input JSONB,
  output JSONB,
  duration_ms INTEGER,
  error TEXT
);
```

**Step 5: Visualize in UI** (Day 10)
```typescript
// Show turn-by-turn breakdown in frontend
<Timeline>
  <Turn id={1}>
    <Interaction id={1}>
      <Reasoning>Need to discover subdomains</Reasoning>
      <Action tool="subfinder">Found 1000</Action>
    </Interaction>
    <Interaction id={2}>
      <Reasoning>Validate with DNS</Reasoning>
      <Action tool="dnsx">500 resolved</Action>
    </Interaction>
  </Turn>
  <Turn id={2}>
    <Interaction id={1}>
      <Reasoning>Probe alive hosts</Reasoning>
      <Action tool="httpx">300 alive</Action>
    </Interaction>
  </Turn>
</Timeline>
```

#### Success Metrics
- ✅ All agent executions tracked as turns/interactions
- ✅ Can pause/resume at turn boundaries
- ✅ UI shows granular execution flow
- ✅ Better debugging ("failed at Turn 2, Interaction 3")

#### Impact
- **State Management**: 50% better control over execution
- **Debugging**: Pinpoint exact failure points
- **UX**: Users see detailed progress
- **Replay**: Can replay specific turns

---

### Feature 4: Enhanced Tool Suite ⚡

**Goal**: Add browser automation, HTTP proxy, and Python runtime (skip Burp Suite)

#### Current State
- CLI tools only (Nuclei, HTTPx, Nmap, etc.)
- No browser testing (can't test XSS in real browser)
- No HTTP interception (can't modify requests)
- No custom exploit execution
- **Gap**: Missing 60-70% of advanced vulnerability types

#### Proposed Solution
Add 3 major tool categories:
1. **Browser Automation** (Playwright)
2. **HTTP Proxy** (custom middleware)
3. **Python Runtime** (isolated sandbox)

#### Architecture
```
┌─────────────────────────────────────────────────────────┐
│              Enhanced Tool Suite                         │
│                                                          │
│  ┌────────────────┐  ┌───────────────┐  ┌────────────┐ │
│  │ Browser        │  │ HTTP Proxy    │  │  Python    │ │
│  │ Automation     │  │ (Intercept)   │  │  Runtime   │ │
│  │ (Playwright)   │  │               │  │ (Sandbox)  │ │
│  └────────────────┘  └───────────────┘  └────────────┘ │
│         │                    │                  │       │
│         ▼                    ▼                  ▼       │
│  Test XSS in real   Intercept API calls  Run custom    │
│  browser context    Modify requests      exploits      │
└─────────────────────────────────────────────────────────┘
```

#### Implementation Steps

**Part A: Browser Automation Agent** (Day 1-7)

**Step 1: Install Playwright** (Day 1)
```bash
npm install playwright
npx playwright install chromium
```

**Step 2: Create Browser Agent** (Day 2-4)
```typescript
// /backend/src/agents/browser.ts

import { chromium, Browser, Page } from 'playwright';

export class BrowserAgent extends BaseAgent<any> {
  private browser: Browser | null = null;
  private contexts: Map<string, BrowserContext> = new Map();

  async initialize(): Promise<void> {
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }

  async testXSS(url: string, payload: string, location: string): Promise<any> {
    const context = await this.browser!.newContext({
      recordVideo: { dir: '/tmp/videos' }, // Record for PoC
    });

    const page = await context.newPage();

    // Set up alert listener for XSS detection
    let xssTriggered = false;
    page.on('dialog', async dialog => {
      xssTriggered = true;
      await dialog.dismiss();
    });

    try {
      // Inject payload based on location
      if (location === 'url_param') {
        await page.goto(`${url}?q=${encodeURIComponent(payload)}`);
      } else if (location === 'form_input') {
        await page.goto(url);
        await page.fill('input[type="text"]', payload);
        await page.click('button[type="submit"]');
      }

      // Wait for potential XSS execution
      await page.waitForTimeout(2000);

      return {
        vulnerable: xssTriggered,
        screenshot: await page.screenshot({ fullPage: true }),
        video: xssTriggered ? this.getVideoPath(context) : null,
      };
    } finally {
      await context.close();
    }
  }

  async testAuthFlow(url: string, credentials: any): Promise<any> {
    const context = await this.browser!.newContext();
    const page = await context.newPage();

    // Test auth bypass
    await page.goto(url);

    // Try direct navigation without auth
    const bypassAttempt = await page.goto(`${url}/admin`);
    const bypassed = bypassAttempt?.status() === 200;

    // Test credential stuffing
    await page.goto(`${url}/login`);
    await page.fill('input[name="username"]', credentials.username);
    await page.fill('input[name="password"]', credentials.password);
    await page.click('button[type="submit"]');

    const authSuccess = page.url().includes('dashboard') || page.url().includes('profile');

    await context.close();

    return {
      auth_bypass: bypassed,
      credential_valid: authSuccess,
    };
  }

  async testCSRF(url: string): Promise<any> {
    const context = await this.browser!.newContext();
    const page = await context.newPage();

    await page.goto(url);

    // Extract CSRF token
    const csrfToken = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="csrf-token"]');
      return meta?.getAttribute('content') || null;
    });

    // Test if CSRF protected
    const response = await page.evaluate(async (targetUrl) => {
      return await fetch(targetUrl, {
        method: 'POST',
        body: JSON.stringify({ action: 'delete' }),
        headers: { 'Content-Type': 'application/json' },
      });
    }, url);

    await context.close();

    return {
      csrf_token_present: !!csrfToken,
      csrf_vulnerable: !csrfToken && response.ok,
    };
  }
}
```

**Step 3: Integrate with XSS Agent** (Day 5-7)
```typescript
// /backend/src/agents/xss.ts

export class XSSAgent extends BaseAgent<any> {
  private browserAgent = new BrowserAgent();

  async process(job: Job): Promise<any> {
    await this.browserAgent.initialize();

    const { urls, payloads } = job.data.options;

    for (const url of urls) {
      // 1. Static detection with Dalfox
      const dalfoxResult = await this.runDalfox(url);

      // 2. Browser confirmation for potential XSS
      if (dalfoxResult.potential_xss) {
        const browserResult = await this.browserAgent.testXSS(
          url,
          dalfoxResult.payload,
          dalfoxResult.location
        );

        if (browserResult.vulnerable) {
          await this.saveConfirmedXSS({
            url,
            payload: dalfoxResult.payload,
            screenshot: browserResult.screenshot,
            video: browserResult.video,
          });
        }
      }
    }

    await this.browserAgent.cleanup();
  }
}
```

**Part B: HTTP Proxy Agent** (Day 8-14)

**Step 1: Create HTTP Proxy Server** (Day 8-10)
```typescript
// /backend/src/services/proxy.ts

import http from 'http';
import httpProxy from 'http-proxy';

export class HTTPProxyService {
  private proxy: httpProxy;
  private interceptors: Map<string, Function> = new Map();

  constructor() {
    this.proxy = httpProxy.createProxyServer({});
    this.setupInterceptors();
  }

  registerInterceptor(id: string, handler: (req: any, res: any) => Promise<void>): void {
    this.interceptors.set(id, handler);
  }

  async intercept(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Capture request
    const requestData = await this.captureRequest(req);

    // Apply interceptors
    for (const [id, handler] of this.interceptors) {
      await handler(requestData, res);
    }

    // Forward modified request
    this.proxy.web(req, res, { target: requestData.target });
  }

  private async captureRequest(req: http.IncomingMessage): Promise<any> {
    return {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: await this.readBody(req),
      target: `${req.headers.host}`,
    };
  }

  // Modify request headers (e.g., for auth bypass)
  modifyHeaders(req: any, newHeaders: Record<string, string>): void {
    Object.assign(req.headers, newHeaders);
  }

  // Inject payloads into request
  injectPayload(req: any, location: string, payload: string): void {
    if (location === 'body') {
      req.body = payload;
    } else if (location === 'header') {
      req.headers['X-Injected'] = payload;
    }
  }
}
```

**Step 2: Create Proxy Agent** (Day 11-14)
```typescript
// /backend/src/agents/proxy.ts

export class ProxyAgent extends BaseAgent<any> {
  private proxy = new HTTPProxyService();

  async testAuthBypass(url: string): Promise<any> {
    const results = [];

    // Test 1: Remove auth headers
    this.proxy.registerInterceptor('remove_auth', async (req, res) => {
      delete req.headers['authorization'];
      delete req.headers['cookie'];
    });

    const noAuthResponse = await this.makeRequest(url);
    results.push({
      test: 'remove_auth',
      bypassed: noAuthResponse.status === 200,
    });

    // Test 2: Header injection
    this.proxy.registerInterceptor('header_injection', async (req, res) => {
      req.headers['X-Original-URL'] = '/admin';
      req.headers['X-Forwarded-For'] = '127.0.0.1';
    });

    const headerBypassResponse = await this.makeRequest(url);
    results.push({
      test: 'header_injection',
      bypassed: headerBypassResponse.status === 200,
    });

    return { tests: results, vulnerable: results.some(r => r.bypassed) };
  }

  async testRaceCondition(url: string): Promise<any> {
    // Send 10 parallel requests to test for race conditions
    const requests = Array(10).fill(null).map(() =>
      this.proxy.intercept(url, { method: 'POST', body: { action: 'withdraw', amount: 100 } })
    );

    const responses = await Promise.all(requests);

    // Check if multiple succeeded (race condition)
    const successCount = responses.filter(r => r.status === 200).length;

    return {
      vulnerable: successCount > 1,
      successful_requests: successCount,
    };
  }
}
```

**Part C: Python Runtime Sandbox** (Day 15-21)

**Step 1: Create Python Sandbox** (Day 15-17)
```typescript
// /backend/src/services/python-sandbox.ts

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

export class PythonSandbox {
  private sandboxDir = '/tmp/python-sandbox';

  async executeCode(code: string, timeout: number = 30000): Promise<any> {
    // Create isolated directory
    const execId = uuidv4();
    const execDir = path.join(this.sandboxDir, execId);
    await fs.mkdir(execDir, { recursive: true });

    // Write code to file
    const scriptPath = path.join(execDir, 'exploit.py');
    await fs.writeFile(scriptPath, code);

    try {
      // Execute in sandboxed environment
      const result = await this.runSandboxed(scriptPath, timeout);
      return result;
    } finally {
      // Cleanup
      await fs.rm(execDir, { recursive: true, force: true });
    }
  }

  private async runSandboxed(scriptPath: string, timeout: number): Promise<any> {
    return new Promise((resolve, reject) => {
      // Run with Docker for isolation
      const docker = spawn('docker', [
        'run',
        '--rm',
        '--network', 'none', // No network access
        '--cpus', '0.5',     // Limit CPU
        '--memory', '256m',  // Limit RAM
        '-v', `${path.dirname(scriptPath)}:/sandbox:ro`,
        'python:3.11-slim',
        'python', '/sandbox/exploit.py',
      ]);

      let stdout = '';
      let stderr = '';

      docker.stdout.on('data', data => stdout += data);
      docker.stderr.on('data', data => stderr += data);

      docker.on('close', code => {
        resolve({ stdout, stderr, exitCode: code });
      });

      setTimeout(() => {
        docker.kill();
        reject(new Error('Python execution timeout'));
      }, timeout);
    });
  }
}
```

**Step 2: Create Code Execution Agent** (Day 18-21)
```typescript
// /backend/src/agents/code-executor.ts

export class CodeExecutorAgent extends BaseAgent<any> {
  private sandbox = new PythonSandbox();

  async process(job: Job): Promise<any> {
    const { code, target, metadata } = job.data.options;

    const span = this.tracer.startSpan('code_executor.execute');

    try {
      // Execute custom exploit code
      const result = await this.sandbox.executeCode(code);

      // Parse output
      const exploitSuccess = result.stdout.includes('SUCCESS') || result.exitCode === 0;

      if (exploitSuccess) {
        await this.saveFinding({
          title: 'Custom Exploit Successful',
          description: `Custom Python exploit executed successfully against ${target}`,
          severity: 'high',
          evidence: {
            code,
            output: result.stdout,
          },
        });
      }

      return { success: exploitSuccess, output: result };
    } finally {
      span.end();
    }
  }

  // Helper: Generate exploit template
  generateExploitTemplate(vulnType: string): string {
    const templates = {
      'sqli': `
import requests

url = "TARGET_URL"
payload = "' OR 1=1--"

response = requests.post(url, data={"username": payload, "password": "test"})
if "admin" in response.text:
    print("SUCCESS: SQL Injection confirmed")
`,
      'ssrf': `
import requests

url = "TARGET_URL"
ssrf_payload = "http://169.254.169.254/latest/meta-data/"

response = requests.post(url, data={"url": ssrf_payload})
if "ami-id" in response.text:
    print("SUCCESS: SSRF confirmed")
`,
    };

    return templates[vulnType] || templates['sqli'];
  }
}
```

#### Success Metrics
- ✅ Browser agent can test XSS/CSRF in real browser
- ✅ Proxy agent can intercept/modify HTTP requests
- ✅ Python sandbox can execute custom exploits safely
- ✅ +60-70% more vulnerability types discovered

#### Impact
- **Coverage**: +60-70% vulnerability types (XSS, auth bypass, race conditions)
- **Accuracy**: Browser confirmation = 95%+ confidence
- **Flexibility**: Custom exploits for unique vulnerabilities
- **Innovation**: Test complex auth flows, SPAs, WebSocket

---

## 🎯 Phase 3: Patterns & Discovery (Week 11-14)

### Feature 5: Formal Patterns System 🟡

**Goal**: Create reusable workflow templates for different scan types

#### Current State
- Implicit orchestration (hardcoded Discovery → Fingerprint → Scanner)
- No user-selectable patterns
- **Gap**: Users can't customize workflows easily

#### Proposed Solution
Implement formal pattern system with reusable templates.

#### Architecture
```
Pattern Library:
├─ Full Recon Pattern
│  └─ Discovery → Fingerprint → Crawler → Scanner → Triage
├─ Quick Scan Pattern
│  └─ Fingerprint → Scanner (skip discovery)
├─ Deep Scan Pattern
│  └─ Discovery → Bruteforce → Fingerprint → Crawler → PortScan → Scanner → Triage
├─ WordPress Scan Pattern
│  └─ Discovery → Filter(WordPress only) → WPScan → Scanner(WP templates)
└─ API Scan Pattern
   └─ Discovery → Crawler(API endpoints) → Scanner(API templates) → Fuzzer
```

#### Implementation Steps

**Step 1: Define Pattern Interface** (Day 1-2)
```typescript
// /backend/src/patterns/base.ts

export interface PatternStep {
  agent: string;
  options: Record<string, any>;
  condition?: (previousResults: any) => boolean;
  handoffs?: string[];
}

export interface Pattern {
  name: string;
  description: string;
  tags: string[];
  steps: PatternStep[];
  estimated_duration: string;
  estimated_cost: string;
}

export abstract class BasePattern {
  abstract getDefinition(): Pattern;

  async execute(programId: string, initialOptions: any): Promise<any> {
    const pattern = this.getDefinition();
    const results = [];

    for (const step of pattern.steps) {
      // Check if step should run
      if (step.condition && !step.condition(results)) {
        continue;
      }

      // Execute step
      const jobId = await this.executeStep(programId, step, results);
      results.push({ step: step.agent, jobId });
    }

    return { pattern: pattern.name, jobs: results };
  }

  private async executeStep(programId: string, step: PatternStep, previousResults: any[]): Promise<string> {
    const jobId = uuidv4();

    await queue.addJob(step.agent, {
      id: jobId,
      type: step.agent,
      programId,
      options: this.mergeOptions(step.options, previousResults),
      metadata: {
        pattern: this.getDefinition().name,
        step: step.agent,
      },
    });

    return jobId;
  }

  private mergeOptions(stepOptions: any, previousResults: any[]): any {
    // Merge step options with results from previous steps
    // e.g., Fingerprint step gets assets from Discovery step
    return { ...stepOptions, previousResults };
  }
}
```

**Step 2: Implement Specific Patterns** (Day 3-6)
```typescript
// /backend/src/patterns/full-recon.ts

export class FullReconPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Full Reconnaissance',
      description: 'Comprehensive discovery, fingerprinting, crawling, and vulnerability scanning',
      tags: ['reconnaissance', 'comprehensive', 'slow'],
      estimated_duration: '20-30 minutes',
      estimated_cost: '$0.00 (Gemini free tier)',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['chaosdb', 'subfinder', 'uncover'],
            maxAssets: 100000,
          },
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['dnsx', 'httpx', 'tlsx'],
            concurrency: 500,
          },
        },
        {
          agent: 'crawl',
          options: {
            depth: 2,
            maxUrls: 10000,
          },
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'fast',
            tier: 'tier1',
          },
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
          },
        },
      ],
    };
  }
}

// /backend/src/patterns/quick-scan.ts

export class QuickScanPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Quick Scan',
      description: 'Fast vulnerability scan on known assets (skip discovery)',
      tags: ['quick', 'fast', 'targeted'],
      estimated_duration: '5-10 minutes',
      estimated_cost: '$0.00',
      steps: [
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
          },
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'fast',
            tier: 'tier1',
            concurrency: 500,
          },
        },
      ],
    };
  }
}

// /backend/src/patterns/wordpress-scan.ts

export class WordPressScanPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'WordPress Specialized Scan',
      description: 'Scan for WordPress-specific vulnerabilities',
      tags: ['wordpress', 'cms', 'specialized'],
      estimated_duration: '10-15 minutes',
      estimated_cost: '$0.00',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['subfinder'],
          },
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            fingerprintConditions: {
              technologies: ['WordPress'],
            },
          },
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'comprehensive',
            templates: ['/app/tools/templates/wordpress'],
            fingerprintConditions: {
              technologies: ['WordPress'],
            },
          },
        },
      ],
    };
  }
}
```

**Step 3: Create Pattern Manager** (Day 7-9)
```typescript
// /backend/src/services/pattern-manager.ts

export class PatternManager {
  private patterns: Map<string, BasePattern> = new Map();

  constructor() {
    this.registerPatterns();
  }

  private registerPatterns(): void {
    this.patterns.set('full-recon', new FullReconPattern());
    this.patterns.set('quick-scan', new QuickScanPattern());
    this.patterns.set('wordpress-scan', new WordPressScanPattern());
    this.patterns.set('deep-scan', new DeepScanPattern());
    this.patterns.set('api-scan', new APIScanPattern());
  }

  listPatterns(): Pattern[] {
    return Array.from(this.patterns.values()).map(p => p.getDefinition());
  }

  async executePattern(patternName: string, programId: string, options: any): Promise<any> {
    const pattern = this.patterns.get(patternName);
    if (!pattern) {
      throw new Error(`Pattern ${patternName} not found`);
    }

    return await pattern.execute(programId, options);
  }
}
```

**Step 4: Add API Endpoints** (Day 10)
```typescript
// /backend/src/routes/patterns.ts

router.get('/patterns', async (req, res) => {
  const patternManager = new PatternManager();
  const patterns = patternManager.listPatterns();
  res.json({ patterns });
});

router.post('/patterns/:name/execute', async (req, res) => {
  const { name } = req.params;
  const { programId, options } = req.body;

  const patternManager = new PatternManager();
  const result = await patternManager.executePattern(name, programId, options);

  res.json(result);
});
```

#### Success Metrics
- ✅ 5+ reusable patterns available
- ✅ Users can select pattern via API/UI
- ✅ Patterns execute workflows correctly
- ✅ +40-50% better UX (clearer workflow selection)

#### Impact
- **UX**: Users understand workflow options
- **Flexibility**: Easy to add custom patterns
- **Documentation**: Patterns serve as workflow documentation
- **Consistency**: Standardized scan approaches

---

### Feature 6: Live Certificate Streams 🟡

**Goal**: Continuous subdomain discovery via certificate transparency logs

#### Current State
- Static discovery (Chaos DB, Subfinder)
- No real-time monitoring
- **Gap**: Miss newly issued certificates

#### Proposed Solution
Monitor certificate transparency logs (crt.sh, Censys) for new subdomains.

#### Architecture
```
┌──────────────────────────────────────────────────────┐
│         Certificate Monitor Service                   │
│  - Polls crt.sh stream every 5 minutes               │
│  - Filters by program domains                        │
│  - Triggers fingerprint for new subdomains           │
└────────────────────┬─────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────┐
│              New subdomain detected                   │
│  *.newservice.example.com (issued 2 min ago)         │
│  → Trigger Fingerprint → Scanner                     │
└──────────────────────────────────────────────────────┘
```

#### Implementation Steps

**Step 1: Create Certificate Monitor** (Day 1-3)
```typescript
// /backend/src/services/cert-monitor.ts

import axios from 'axios';

export class CertificateMonitor {
  private monitoredDomains: Set<string> = new Set();
  private lastCheck: Map<string, Date> = new Map();

  async start(): Promise<void> {
    // Run every 5 minutes
    setInterval(async () => {
      await this.checkNewCertificates();
    }, 5 * 60 * 1000);
  }

  addDomain(domain: string): void {
    this.monitoredDomains.add(domain);
    this.lastCheck.set(domain, new Date());
  }

  private async checkNewCertificates(): Promise<void> {
    for (const domain of this.monitoredDomains) {
      const lastCheck = this.lastCheck.get(domain)!;
      const newCerts = await this.fetchNewCerts(domain, lastCheck);

      if (newCerts.length > 0) {
        await this.handleNewCertificates(domain, newCerts);
      }

      this.lastCheck.set(domain, new Date());
    }
  }

  private async fetchNewCerts(domain: string, since: Date): Promise<any[]> {
    try {
      // Query crt.sh
      const response = await axios.get(`https://crt.sh/?q=%.${domain}&output=json`);
      const certs = response.data;

      // Filter to only new certs
      return certs.filter((cert: any) => {
        const certDate = new Date(cert.entry_timestamp);
        return certDate > since;
      });
    } catch (error) {
      logger.error({ error, domain }, 'Failed to fetch certificates');
      return [];
    }
  }

  private async handleNewCertificates(domain: string, certs: any[]): Promise<void> {
    // Extract unique subdomains
    const subdomains = new Set<string>();
    for (const cert of certs) {
      const names = cert.name_value.split('\n');
      names.forEach((name: string) => {
        if (name.endsWith(`.${domain}`)) {
          subdomains.add(name);
        }
      });
    }

    if (subdomains.size === 0) return;

    // Get program ID
    const programResult = await database.query(
      `SELECT id FROM programs WHERE $1 = ANY(scope->'domains')`,
      [domain]
    );

    if (programResult.rows.length === 0) return;

    const programId = programResult.rows[0].id;

    // Save new subdomains
    const { batchInsertAssets } = require('../utils/batch-insert');
    await batchInsertAssets(
      Array.from(subdomains).map(subdomain => ({
        programId,
        type: 'subdomain',
        value: subdomain,
        source: 'cert-monitor',
        metadata: { discovered_via: 'certificate_transparency' },
      }))
    );

    // Trigger fingerprint
    await queue.addJob('fingerprint', {
      id: uuidv4(),
      type: 'fingerprint',
      programId,
      options: {
        assets: Array.from(subdomains),
        tools: ['dnsx', 'httpx'],
      },
      metadata: {
        trigger: 'cert-monitor',
      },
    });

    // Send notification
    await events.emitLog({
      level: 'info',
      tool: 'cert-monitor',
      message: `Discovered ${subdomains.size} new subdomains via certificate monitoring`,
    });
  }
}
```

**Step 2: Integrate with Program Lifecycle** (Day 4-5)
```typescript
// /backend/src/routes/programs.ts

router.post('/programs', async (req, res) => {
  const program = await createProgram(req.body);

  // Enable cert monitoring if requested
  if (program.monitoring?.cert_transparency) {
    const certMonitor = CertificateMonitor.getInstance();
    program.scope.domains.forEach(domain => {
      certMonitor.addDomain(domain);
    });
  }

  res.json(program);
});
```

**Step 3: Add Dashboard** (Day 6-7)
```typescript
// Show live cert stream in UI
<CertificateStream>
  {newCerts.map(cert => (
    <CertificateEvent>
      <Subdomain>{cert.name}</Subdomain>
      <IssuedAt>{cert.timestamp}</IssuedAt>
      <Status>{cert.fingerprintStatus}</Status>
    </CertificateEvent>
  ))}
</CertificateStream>
```

#### Success Metrics
- ✅ Monitor cert transparency logs
- ✅ Detect new subdomains within 5-10 minutes
- ✅ Auto-trigger fingerprint + scan
- ✅ +30-40% more subdomains over time

#### Impact
- **Discovery**: +30-40% subdomains over time
- **Speed**: Find new assets before competitors
- **Monitoring**: Continuous asset tracking
- **Intelligence**: Track infrastructure changes

---

## 🎯 Phase 4: Multi-Agent Distribution (Week 15-18)

### Feature 7: Graph of Agents ⚡

**Goal**: Distributed parallel execution with shared state and dynamic coordination

#### Current State
- Sequential orchestration via job queue
- Limited parallelism (only at worker level)
- No agent coordination
- **Gap**: Can't distribute work across specialized agents intelligently

#### Proposed Solution
Implement graph-based multi-agent system with shared state and coordination.

#### Architecture
```
┌─────────────────────────────────────────────────────────┐
│               Agent Coordinator                          │
│  - Assigns targets to specialized agents                │
│  - Manages shared state (discoveries, findings)         │
│  - Handles agent communication                          │
└────────────────────┬────────────────────────────────────┘
                     │
        ┌────────────┼────────────┬────────────┐
        ▼            ▼            ▼            ▼
   WordPress    Joomla Agent  API Agent   Generic
     Agent      (500 sites)   (2K APIs)   Agent
   (3K sites)                              (rest)
        │            │            │            │
        └────────────┴────────────┴────────────┘
                     │
                     ▼
              Shared Knowledge Base
         (discoveries, findings, strategies)
```

#### Implementation Steps

**Step 1: Define Agent Graph** (Day 1-3)
```typescript
// /backend/src/graph/agent-graph.ts

export interface AgentNode {
  id: string;
  agent: BaseAgent;
  specialization: string[];
  capacity: number;
  current_load: number;
}

export interface AgentEdge {
  from: string;
  to: string;
  type: 'handoff' | 'coordination' | 'shared_state';
  weight: number;
}

export class AgentGraph {
  private nodes: Map<string, AgentNode> = new Map();
  private edges: AgentEdge[] = [];
  private sharedState: SharedKnowledgeBase;

  constructor() {
    this.sharedState = new SharedKnowledgeBase();
  }

  addAgent(agent: BaseAgent, specialization: string[], capacity: number): void {
    this.nodes.set(agent.agentType, {
      id: agent.agentType,
      agent,
      specialization,
      capacity,
      current_load: 0,
    });
  }

  connect(from: string, to: string, type: string, weight: number = 1): void {
    this.edges.push({ from, to, type, weight });
  }

  async distributeWork(targets: any[], programId: string): Promise<void> {
    // Classify targets
    const classified = await this.classifyTargets(targets);

    // Assign to specialized agents
    for (const [specialization, targetList] of Object.entries(classified)) {
      const agent = this.findBestAgent(specialization);

      if (agent) {
        await this.assignWork(agent, targetList, programId);
      }
    }
  }

  private async classifyTargets(targets: any[]): Promise<Record<string, any[]>> {
    const classified: Record<string, any[]> = {
      wordpress: [],
      joomla: [],
      drupal: [],
      api: [],
      generic: [],
    };

    for (const target of targets) {
      // Get metadata from shared state
      const metadata = await this.sharedState.getMetadata(target.value);

      if (metadata?.technologies?.includes('WordPress')) {
        classified.wordpress.push(target);
      } else if (metadata?.technologies?.includes('Joomla')) {
        classified.joomla.push(target);
      } else if (target.value.includes('/api/')) {
        classified.api.push(target);
      } else {
        classified.generic.push(target);
      }
    }

    return classified;
  }

  private findBestAgent(specialization: string): AgentNode | null {
    // Find agent with matching specialization and lowest load
    const candidates = Array.from(this.nodes.values())
      .filter(node => node.specialization.includes(specialization))
      .sort((a, b) => a.current_load - b.current_load);

    return candidates[0] || null;
  }

  private async assignWork(agent: AgentNode, targets: any[], programId: string): Promise<void> {
    const jobId = uuidv4();

    await queue.addJob(agent.id, {
      id: jobId,
      type: agent.id,
      programId,
      options: { targets },
      metadata: {
        graph_assignment: true,
        specialization: agent.specialization.join(','),
      },
    });

    agent.current_load += targets.length;
  }
}
```

**Step 2: Implement Shared Knowledge Base** (Day 4-7)
```typescript
// /backend/src/graph/knowledge-base.ts

export class SharedKnowledgeBase {
  private discoveries: Map<string, any> = new Map();
  private strategies: Map<string, any> = new Map();

  async shareDiscovery(agentId: string, discovery: any): Promise<void> {
    const key = `${discovery.target}:${discovery.type}`;

    // Store discovery
    this.discoveries.set(key, {
      ...discovery,
      discoveredBy: agentId,
      timestamp: new Date(),
    });

    // Notify other agents
    await this.notifyAgents(agentId, discovery);
  }

  async getMetadata(target: string): Promise<any> {
    return this.discoveries.get(target);
  }

  async shareStrategy(agentId: string, strategy: any): Promise<void> {
    // Agent shares successful attack strategy
    this.strategies.set(strategy.type, {
      ...strategy,
      sharedBy: agentId,
      successRate: strategy.successCount / strategy.attemptCount,
    });
  }

  async getBestStrategy(vulnType: string): Promise<any> {
    // Find most successful strategy for this vuln type
    const strategies = Array.from(this.strategies.values())
      .filter(s => s.type === vulnType)
      .sort((a, b) => b.successRate - a.successRate);

    return strategies[0] || null;
  }

  private async notifyAgents(sourceAgent: string, discovery: any): Promise<void> {
    // Emit event to all agents
    await events.emitAgentDiscovery({
      type: 'agent_discovery',
      sourceAgent,
      discovery,
    });
  }
}
```

**Step 3: Create Specialized Agents** (Day 8-12)
```typescript
// /backend/src/agents/specialists/wordpress-agent.ts

export class WordPressSpecialistAgent extends BaseAgent<any> {
  constructor(private graph: AgentGraph) {
    super('wordpress_specialist');
  }

  async process(job: Job): Promise<any> {
    const { targets } = job.data.options;

    for (const target of targets) {
      // 1. Check shared knowledge base
      const knownVulns = await this.graph.sharedState.getMetadata(target.value);

      // 2. Run WordPress-specific scans
      const wpScanResult = await this.runWPScan(target.value);

      // 3. Share discoveries with other agents
      if (wpScanResult.vulnerable) {
        await this.graph.sharedState.shareDiscovery(this.agentType, {
          target: target.value,
          type: 'wordpress_vuln',
          details: wpScanResult,
        });
      }

      // 4. Check if other agents found related vulns
      const relatedFindings = await this.checkRelatedFindings(target.value);

      // 5. Coordinate with other agents if needed
      if (relatedFindings.length > 0) {
        await this.coordinateWithAgents(relatedFindings);
      }
    }

    return { scanned: targets.length };
  }

  private async checkRelatedFindings(target: string): Promise<any[]> {
    // Check what other agents found for this target
    return await this.graph.sharedState.getMetadata(target);
  }

  private async coordinateWithAgents(findings: any[]): Promise<void> {
    // If another agent found SQLi, WordPress agent can try WP-specific SQLi
    for (const finding of findings) {
      if (finding.type === 'sql_injection' && finding.discoveredBy !== this.agentType) {
        // Try WordPress-specific SQLi techniques
        await this.tryWPSpecificSQLi(finding.target);
      }
    }
  }
}
```

**Step 4: Implement Coordinator** (Day 13-15)
```typescript
// /backend/src/services/agent-coordinator.ts

export class AgentCoordinator {
  private graph: AgentGraph;

  constructor() {
    this.graph = new AgentGraph();
    this.initializeGraph();
  }

  private initializeGraph(): void {
    // Add specialized agents
    this.graph.addAgent(new WordPressSpecialistAgent(this.graph), ['wordpress'], 100);
    this.graph.addAgent(new JoomlaSpecialistAgent(this.graph), ['joomla'], 50);
    this.graph.addAgent(new APISpecialistAgent(this.graph), ['api', 'rest', 'graphql'], 200);
    this.graph.addAgent(new GenericScannerAgent(this.graph), ['*'], 500);

    // Connect agents for coordination
    this.graph.connect('wordpress_specialist', 'sqli_specialist', 'handoff');
    this.graph.connect('api_specialist', 'scanner', 'coordination');
  }

  async orchestrateScan(programId: string): Promise<void> {
    // 1. Get all assets
    const assets = await this.getAssets(programId);

    // 2. Distribute work across specialized agents
    await this.graph.distributeWork(assets, programId);

    // 3. Monitor progress and coordinate
    await this.monitorAndCoordinate(programId);
  }

  private async monitorAndCoordinate(programId: string): Promise<void> {
    // Listen for agent discoveries and coordinate responses
    events.on('agent_discovery', async (event) => {
      if (event.discovery.type === 'high_value_target') {
        // Alert all agents about high-value target
        await this.broadcastToAgents(event.discovery);
      }
    });
  }
}
```

**Step 5: Deploy & Scale** (Day 16-18)
```typescript
// Update docker-compose for distributed agents
services:
  wordpress-agent:
    image: agenthunt-worker
    environment:
      - AGENT_SPECIALIZATION=wordpress
    replicas: 3

  api-agent:
    image: agenthunt-worker
    environment:
      - AGENT_SPECIALIZATION=api
    replicas: 5

  generic-agent:
    image: agenthunt-worker
    environment:
      - AGENT_SPECIALIZATION=generic
    replicas: 10
```

#### Success Metrics
- ✅ Agents distributed across specializations
- ✅ Shared knowledge base working
- ✅ Agent coordination successful
- ✅ 4-10x better scalability

#### Impact
- **Scalability**: 4-10x throughput (parallel specialists)
- **Intelligence**: Agents learn from each other
- **Efficiency**: Work distributed optimally
- **Collaboration**: Agents coordinate on complex attacks

---

## 📊 SUMMARY: IMPACT & TIMELINE

### Overall Impact

| Metric | Before | After NEXTUPDATE | Improvement |
|--------|--------|------------------|-------------|
| **Debuggability** | Basic logs | Full distributed tracing | **80%** better |
| **Agent Coordination** | Queue-based | Formal handoffs + graph | **60%** better |
| **State Management** | Job-level | Turn/interaction-level | **50%** better |
| **Tool Coverage** | CLI only | Browser + Proxy + Python | **70%** more vulns |
| **Workflow Flexibility** | Hardcoded | Pattern templates | **50%** better UX |
| **Discovery** | Static | Continuous (cert monitoring) | **40%** more assets |
| **Scalability** | Sequential | Parallel specialists | **4-10x** faster |

### Timeline & Effort

| Phase | Weeks | Features | Effort | Impact |
|-------|-------|----------|--------|--------|
| **Phase 1** | 1-4 | Observability + Handoffs | MEDIUM | ⚡ VERY HIGH |
| **Phase 2** | 5-10 | Turns + Enhanced Tools | HIGH | ⚡ HIGH |
| **Phase 3** | 11-14 | Patterns + Cert Monitoring | MEDIUM | 🟡 MEDIUM |
| **Phase 4** | 15-18 | Graph of Agents | VERY HIGH | ⚡ VERY HIGH |
| **TOTAL** | **12-18 weeks** | **7 features** | **HIGH** | **150-200%** |

### Cost Analysis

**Development Cost**:
- 7 features × 2-3 weeks avg = **12-18 weeks** (3-4.5 months)
- 1 senior engineer: ~$15-20K/month × 4 months = **$60-80K**

**Operational Cost**:
- OpenTelemetry + Phoenix: $0 (self-hosted)
- Enhanced tools: $0 (all open-source)
- Additional workers: ~$100-200/month (AWS)
- **Total**: ~$100-200/month operational

**ROI**:
- Improved platform capabilities: **150-200%**
- Reduced debugging time: **80%** (saves dev hours)
- Better security coverage: **70%** more vuln types
- **Break-even**: 2-3 months

---

## 🚀 GETTING STARTED

### Prerequisites

**Infrastructure**:
- Docker + Docker Compose
- Kubernetes (optional, for Graph of Agents)
- 16GB RAM (for full feature set)
- 10+ CPU cores (for distributed agents)

**Dependencies**:
```bash
# Phase 1
npm install @opentelemetry/api @opentelemetry/sdk-node arize-phoenix-otel

# Phase 2
npm install playwright

# Phase 3
npm install axios  # cert monitoring
```

### Deployment Plan

**Week 0: Preparation**
- [ ] Review NEXTUPDATE.md
- [ ] Set up Phoenix server
- [ ] Prepare infrastructure (16GB RAM, 10 cores)

**Week 1-4: Phase 1**
- [ ] Implement OpenTelemetry + Phoenix
- [ ] Implement Handoffs System
- [ ] Test observability and handoff chains

**Week 5-10: Phase 2**
- [ ] Implement Turns & Interactions
- [ ] Implement Enhanced Tool Suite
- [ ] Test browser/proxy/python agents

**Week 11-14: Phase 3**
- [ ] Implement Patterns System
- [ ] Implement Cert Monitoring
- [ ] Test pattern execution

**Week 15-18: Phase 4**
- [ ] Implement Graph of Agents
- [ ] Deploy distributed agents
- [ ] Test coordination and scaling

---

## 📞 SUPPORT & NEXT STEPS

**Questions?**
- Review this document carefully
- Check implementation steps for each feature
- Refer to success metrics for validation

**Ready to Start?**
1. ✅ Approve NEXTUPDATE.md
2. ✅ Allocate resources (dev time, infrastructure)
3. ✅ Begin Phase 1 (OpenTelemetry + Handoffs)
4. ✅ Track progress weekly

**This is the future of AgentHunt** - let's build it! 🚀

---

**Document Version**: 1.0
**Last Updated**: 2025-11-12
**Status**: Ready for Implementation
