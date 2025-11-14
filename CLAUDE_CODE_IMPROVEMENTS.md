# Claude Code-Inspired Multi-Agent Improvements

This document explains the comprehensive improvements made to AgentHunt based on Claude Code's multi-agent architecture patterns.

## Table of Contents

1. [Overview](#overview)
2. [Core Design Patterns](#core-design-patterns)
3. [New Services](#new-services)
4. [Database Schema](#database-schema)
5. [Integration Guide](#integration-guide)
6. [Usage Examples](#usage-examples)
7. [Best Practices](#best-practices)

---

## Overview

We've implemented a comprehensive multi-agent collaboration system inspired by Claude Code's architecture, focusing on:

- **Safety First**: Pre-validation, read-before-write patterns, rollback capabilities
- **Observable Execution**: Real-time progress tracking like TodoWrite
- **Agent Collaboration**: Direct agent-to-agent messaging and queries
- **Self-Healing**: Automatic issue detection and remediation
- **Declarative Workflows**: Reusable multi-step agent orchestrations

---

## Core Design Patterns

### 1. Safety by Design

**Inspired by**: Claude Code's `<tool_use_error>File has not been read yet</tool_use_error>` pattern

**Implementation**:
- Command pre-validation before execution
- Checkpoint system for rollback capability
- Result validation against expected contracts

**Example**:
```typescript
// Before executing any command, validate it
const validation = await commandValidator.validateCommand(
  jobId,
  'fingerprint',
  'httpx -l targets.txt -json'
);

if (!validation.safe) {
  throw new Error(`Unsafe command: ${validation.reasons.join(', ')}`);
}

// Execute with rollback capability
await checkpoint.executeWithRollback(jobId, async () => {
  return await agent.execute(command);
});
```

### 2. Observable Execution

**Inspired by**: Claude Code's TodoWrite pattern for progress tracking

**Implementation**:
- Real-time job progress with step-by-step visibility
- WebSocket pub/sub for live updates
- Progress estimation and completion tracking

**Example**:
```typescript
// Initialize progress for a job
await progressTracker.initializeProgress(jobId, 'fingerprint', [
  { name: 'Load targets', metadata: {} },
  { name: 'DNS resolution', metadata: {} },
  { name: 'HTTP fingerprinting', metadata: {} },
  { name: 'Store results', metadata: {} }
]);

// Update as work progresses
await progressTracker.startStep(jobId, 0);
const targets = await loadTargets();
await progressTracker.completeStep(jobId, 0, { count: targets.length });

await progressTracker.startStep(jobId, 1);
// ... DNS resolution ...
await progressTracker.updateStepProgress(jobId, 1, 50); // 50% complete
```

### 3. Rich Context Handoffs

**Inspired by**: Claude Code's complete context preservation when spawning Task agents

**Implementation**:
- Full context package with reasoning, objectives, and success criteria
- Validation of agent capabilities before handoff
- Output contract verification

**Example**:
```typescript
// Create rich handoff with complete context
const handoffId = await richHandoffs.createHandoff(
  {
    type: 'discovery',
    instanceId: process.pid.toString(),
    jobId: currentJob.id,
    programId: program.id
  },
  'fingerprint', // Target agent
  {
    parentResult: {
      type: 'discovery',
      data: { subdomains: discoveredSubdomains },
      metrics: { duration: 60000, itemsFound: 500 },
      timestamp: new Date()
    },
    reasoning: {
      trigger: 'High subdomain count detected',
      confidence: 0.95,
      alternatives: ['portscan', 'crawler'],
      decisionFactors: {
        subdomainCount: 500,
        timeElapsed: 60,
        programPriority: 'high'
      }
    },
    objectives: {
      primary: 'Fingerprint all 500 subdomains for technologies and WAFs',
      secondary: ['Detect CMS versions', 'Identify API endpoints'],
      avoid: ['Scanning internal hosts', 'Exceeding rate limits']
    },
    successCriteria: {
      minAssets: 450, // At least 90% should respond
      maxDuration: 600000, // 10 minutes
      requiredFields: ['statusCode', 'technologies', 'server'],
      qualityThreshold: 0.9
    },
    inherited: {
      programId: program.id,
      rateLimit: 300,
      timeout: 10,
      safetyChecks: ['scope-validation', 'rate-limiting'],
      budget: {
        maxCost: 100,
        maxTime: 600,
        maxResources: 2000
      }
    }
  },
  {
    format: 'structured',
    requiredFields: ['assets', 'technologies', 'statusCodes'],
    shouldTriggerNextHandoff: true,
    expectedVolume: { min: 450, max: 500 }
  }
);
```

### 4. Agent-to-Agent Communication

**Inspired by**: Claude Code's ability to spawn and query sub-agents

**Implementation**:
- Message passing protocol for agents
- Query/response pattern for information exchange
- Approval requests for sensitive operations

**Example**:
```typescript
// Query another agent for context
const discoveryContext = await agentCoordination.queryAgent(
  {
    type: 'fingerprint',
    instanceId: process.pid.toString(),
    capabilities: ['http-fingerprinting'],
    currentLoad: 0,
    version: '1.0'
  },
  'discovery',
  'What discovery method was used for this program?'
);

// Notify another agent
await agentCoordination.notifyAgent(
  myIdentity,
  'triage',
  {
    title: 'High-severity finding detected',
    message: 'Found RCE vulnerability in WordPress plugin',
    data: { findingId, severity: 'critical' }
  }
);

// Request approval for sensitive action
const approval = await agentCoordination.requestApproval(
  myIdentity,
  'confirm',
  {
    action: 'Exploit RCE vulnerability',
    reason: 'Need to confirm exploitability',
    data: { target: 'example.com', vulnerability: 'CVE-2024-1234' }
  }
);

if (approval.approved) {
  // Proceed with exploitation
}
```

### 5. Health Monitoring & Self-Healing

**Inspired by**: Claude Code's robust error handling and recovery

**Implementation**:
- Continuous health monitoring with metrics
- Automatic issue detection (memory, CPU, error rate)
- Self-healing actions (GC, alerts, backoff)

**Example**:
```typescript
// Start health monitoring for an agent
await agentHealth.startMonitoring(
  'fingerprint',
  process.pid.toString(),
  30000 // Check every 30 seconds
);

// Health checks happen automatically, but you can manually check too
const health = await agentHealth.getHealth('fingerprint', process.pid.toString());

if (health.status === 'degraded') {
  logger.warn({ issues: health.issues }, 'Agent degraded, reducing load');
  // Reduce concurrency, pause new jobs, etc.
}

// Self-healing happens automatically:
// - High memory? Trigger garbage collection
// - Queue backup? Alert ops
// - High error rate? Notify and potentially pause
```

### 6. Declarative Workflows

**Inspired by**: Claude Code's structured task orchestration

**Implementation**:
- Define multi-step workflows as reusable templates
- Support parallel and sequential execution
- Dependency management and error handling

**Example**:
```typescript
// Define a workflow
const subdomainEnumerationWorkflow: AgentWorkflow = {
  name: 'subdomain-enumeration',
  version: '1.0.0',
  description: 'Complete subdomain enumeration pipeline',
  trigger: {
    on: 'job:complete',
    when: (ctx) => ctx.agentType === 'discovery' && ctx.domains.length > 0,
    filters: {}
  },
  steps: [
    {
      id: 'passive-subdomain',
      name: 'Passive subdomain discovery',
      agent: 'subdomain',
      input: (ctx) => ({ domains: ctx.discovery.domains, method: 'passive' }),
      output: 'passiveSubdomains',
      parallel: false
    },
    {
      id: 'dns-resolution',
      name: 'Resolve subdomains',
      agent: 'bruteforce',
      input: (ctx) => ({ subdomains: ctx.passiveSubdomains }),
      output: 'resolvedSubdomains',
      parallel: false,
      dependencies: ['passive-subdomain']
    },
    {
      id: 'parallel-recon',
      name: 'Parallel reconnaissance',
      agent: 'multi',
      input: (ctx) => ({
        jobs: [
          { type: 'fingerprint', input: { targets: ctx.resolvedSubdomains } },
          { type: 'portscan', input: { targets: ctx.resolvedSubdomains } }
        ]
      }),
      output: 'reconResults',
      parallel: true,
      dependencies: ['dns-resolution']
    }
  ],
  errorHandling: {
    onStepFailure: 'continue',
    onCriticalFailure: 'rollback',
    notifyOn: ['critical-failure']
  }
};

// Register the workflow
await workflowEngine.registerWorkflow(subdomainEnumerationWorkflow);

// Execute it
const executionId = await workflowEngine.executeWorkflow(
  'subdomain-enumeration',
  {
    programId: program.id,
    discovery: { domains: ['example.com', 'test.com'] }
  }
);

// Monitor execution
const status = await workflowEngine.getExecutionStatus(executionId);
```

---

## New Services

### 1. Progress Tracker (`services/progress-tracker.ts`)

**Purpose**: Real-time job progress tracking like Claude Code's TodoWrite

**Key Methods**:
- `initializeProgress(jobId, phase, steps)` - Set up progress tracking
- `startStep(jobId, stepIndex)` - Mark step as running
- `completeStep(jobId, stepIndex, metadata)` - Mark step complete
- `failStep(jobId, stepIndex, error)` - Mark step failed
- `updateStepProgress(jobId, stepIndex, progress)` - Update 0-100 progress
- `getProgress(jobId)` - Get current progress state

**Use Case**: Show users real-time progress of long-running jobs

### 2. Command Validator (`services/command-validator.ts`)

**Purpose**: Pre-execution validation to prevent errors

**Key Methods**:
- `validateCommand(jobId, agentType, command)` - Validate before execution
- `recordActualResources(jobId, command, actualResources)` - Track actual usage
- `getValidationHistory(agentType, limit)` - Analyze validation patterns

**Use Case**: Catch errors before wasting time on doomed-to-fail commands

### 3. Checkpoint Service (`services/checkpoint.ts`)

**Purpose**: Rollback capability for failed operations

**Key Methods**:
- `createCheckpoint(jobId)` - Snapshot current state
- `commitCheckpoint(checkpointId)` - Mark as successful
- `rollbackCheckpoint(checkpointId, reason)` - Undo changes
- `executeWithRollback(jobId, operation, validation)` - Auto-rollback wrapper

**Use Case**: Safely try risky operations with ability to undo

### 4. Agent Coordination (`services/agent-coordination.ts`)

**Purpose**: Enable agent-to-agent communication

**Key Methods**:
- `sendMessage(message)` - Send message to another agent
- `queryAgent(from, toType, query, timeout)` - Ask and wait for response
- `receiveMessages(agentType, limit)` - Get unread messages
- `notifyAgent(from, toType, notification)` - Send notification
- `requestApproval(from, toType, request, timeout)` - Request approval

**Use Case**: Agents collaborate and share context

### 5. Rich Handoffs (`services/rich-handoffs.ts`)

**Purpose**: Enhanced handoffs with complete context

**Key Methods**:
- `createHandoff(fromAgent, toAgentType, context, outputContract)` - Create handoff
- `acceptHandoff(handoffId, toAgentInstance, toJobId)` - Accept handoff
- `rejectHandoff(handoffId, reason)` - Reject with reason
- `completeHandoff(handoffId, result)` - Complete with result
- `getPendingHandoffs(agentType, limit)` - Get pending handoffs

**Use Case**: Pass rich context between agents, not just raw data

### 6. Agent Health (`services/agent-health.ts`)

**Purpose**: Monitor and self-heal agents

**Key Methods**:
- `startMonitoring(agentType, instanceId, intervalMs)` - Start continuous monitoring
- `recordHeartbeat(agentType, instanceId, metrics)` - Record health metrics
- `checkHealth(agentType, instanceId)` - Check for issues
- `getHealth(agentType, instanceId)` - Get current health
- `getHealthSummary()` - Overall health across all agents

**Use Case**: Detect and fix issues before they cause failures

### 7. Workflow Engine (`services/workflow-engine.ts`)

**Purpose**: Execute declarative multi-step workflows

**Key Methods**:
- `registerWorkflow(workflow)` - Register workflow template
- `executeWorkflow(workflowName, triggerContext)` - Start execution
- `getExecutionStatus(executionId)` - Monitor progress
- `listWorkflows()` - Get all registered workflows
- `setWorkflowEnabled(name, enabled)` - Enable/disable workflow

**Use Case**: Define common patterns once, reuse everywhere

---

## Database Schema

### Progress Tracking
- `job_progress` - Overall job progress (phase, current step, % complete)
- `progress_steps` - Individual step details (status, progress, timing, errors)

### Agent Messaging
- `agent_messages` - Message queue for agent-to-agent communication
- `rich_handoffs` - Enhanced handoffs with full context

### Safety & Rollback
- `checkpoints` - State snapshots for rollback
- `command_validations` - Pre-execution validation history

### Health Monitoring
- `agent_health` - Current health metrics per agent instance
- `agent_health_issues` - Detected issues and self-healing attempts

### Workflows
- `workflows` - Workflow template definitions
- `workflow_steps` - Step definitions for each workflow
- `workflow_executions` - Running/completed workflow instances
- `workflow_step_executions` - Step execution tracking

---

## Integration Guide

### Step 1: Run Migrations

```bash
cd backend
npm run migrate
```

This creates all new tables, indexes, and views.

### Step 2: Update BaseAgent

The new services should be integrated into `BaseAgent` to make them available to all agents:

```typescript
// backend/src/agents/base.ts
import progressTracker from '../services/progress-tracker';
import commandValidator from '../services/command-validator';
import checkpoint from '../services/checkpoint';
import agentCoordination from '../services/agent-coordination';
import agentHealth from '../services/agent-health';

export abstract class BaseAgent {
  // Add service references
  protected progressTracker = progressTracker;
  protected commandValidator = commandValidator;
  protected checkpoint = checkpoint;
  protected coordination = agentCoordination;
  protected health = agentHealth;

  // Override processWithTracing to add progress tracking
  async processWithTracing(job: Job): Promise<any> {
    // Initialize progress
    await this.progressTracker.initializeProgress(
      job.id,
      this.getAgentType(),
      this.getSteps()
    );

    // Create checkpoint
    const checkpointId = await this.checkpoint.createCheckpoint(job.id);

    try {
      const result = await this.process(job);

      // Validate result
      if (!this.validateResult(result)) {
        throw new Error('Result validation failed');
      }

      await this.checkpoint.commitCheckpoint(checkpointId);
      return result;
    } catch (error) {
      await this.checkpoint.rollbackCheckpoint(checkpointId, error.message);
      throw error;
    }
  }

  // Abstract method for agents to define their steps
  protected abstract getSteps(): Array<{ name: string; metadata?: any }>;

  // Helper to execute commands with validation
  protected async executeCommandSafe(
    command: string,
    jobId: string
  ): Promise<any> {
    // Pre-validate
    const validation = await this.commandValidator.validateCommand(
      jobId,
      this.getAgentType(),
      command
    );

    if (!validation.safe) {
      throw new Error(`Command validation failed: ${validation.reasons.join(', ')}`);
    }

    // Log warnings
    if (validation.warnings && validation.warnings.length > 0) {
      logger.warn({ warnings: validation.warnings }, 'Command validation warnings');
    }

    // Execute
    const startTime = Date.now();
    const result = await this.executeCommand(command);
    const duration = Date.now() - startTime;

    // Record actual resources
    await this.commandValidator.recordActualResources(
      jobId,
      command,
      {
        memory: process.memoryUsage().heapUsed / 1024 / 1024,
        cpu: 0, // Would need OS-level metrics
        duration: duration,
        networkIO: 0, // Would need to track
        diskIO: 0
      }
    );

    return result;
  }
}
```

### Step 3: Update Individual Agents

Example: FingerprintAgent with progress tracking

```typescript
// backend/src/agents/fingerprint.ts
export class FingerprintAgent extends BaseAgent {
  protected getSteps() {
    return [
      { name: 'Load targets from database', metadata: {} },
      { name: 'DNS resolution with dnsx', metadata: {} },
      { name: 'HTTP fingerprinting with httpx', metadata: {} },
      { name: 'Store results in database', metadata: {} }
    ];
  }

  async process(job: Job): Promise<Result> {
    const jobId = job.id!;

    // Step 0: Load targets
    await this.progressTracker.startStep(jobId, 0);
    const targets = await this.loadTargets(job);
    await this.progressTracker.completeStep(jobId, 0, { count: targets.length });

    // Step 1: DNS resolution
    await this.progressTracker.startStep(jobId, 1);
    const resolved = await this.runDnsx(targets, jobId);
    await this.progressTracker.completeStep(jobId, 1, { resolved: resolved.length });

    // Step 2: HTTP fingerprinting
    await this.progressTracker.startStep(jobId, 2);
    const assets = await this.runHttpx(resolved, jobId);
    await this.progressTracker.completeStep(jobId, 2, { assets: assets.length });

    // Step 3: Store results
    await this.progressTracker.startStep(jobId, 3);
    await this.storeAssets(assets, job.programId);
    await this.progressTracker.completeStep(jobId, 3);

    return { assets, count: assets.length };
  }

  private async runHttpx(targets: string[], jobId: string): Promise<any[]> {
    // Use safe command execution
    const command = this.buildHttpxCommand(targets);
    const result = await this.executeCommandSafe(command, jobId);

    // Update progress during execution (if command supports it)
    // await this.progressTracker.updateStepProgress(jobId, 2, 50);

    return result;
  }
}
```

### Step 4: Start Health Monitoring

In `workers/index.ts`:

```typescript
import agentHealth from '../services/agent-health';

async function startWorkers() {
  // ... existing worker setup ...

  // Start health monitoring for each agent type
  for (const [agentType, agentConfig] of agentMap) {
    if (agentConfig.instance) {
      await agentHealth.startMonitoring(
        agentType,
        process.pid.toString(),
        30000 // Every 30 seconds
      );
    }
  }
}
```

### Step 5: Register Workflows

Create a workflow registration file:

```typescript
// backend/src/workflows/index.ts
import workflowEngine from '../services/workflow-engine';
import { AgentWorkflow } from '../../../shared/agent-collaboration.types';

// Define workflows
import { subdomainEnumerationWorkflow } from './subdomain-enumeration';
import { vulnerabilityScanningWorkflow } from './vulnerability-scanning';

export async function registerAllWorkflows() {
  await workflowEngine.registerWorkflow(subdomainEnumerationWorkflow);
  await workflowEngine.registerWorkflow(vulnerabilityScanningWorkflow);
  // ... register more workflows
}
```

Then call it during startup:

```typescript
// backend/src/index.ts
import { registerAllWorkflows } from './workflows';

async function startServer() {
  // ... existing setup ...

  // Register workflows
  await registerAllWorkflows();

  logger.info('All workflows registered');
}
```

---

## Usage Examples

### Example 1: Observable Job Execution

```typescript
// Frontend subscribes to progress updates via WebSocket
const ws = new WebSocket('ws://localhost:3000/ws');
ws.send(JSON.stringify({ type: 'subscribe', jobId: '123' }));

ws.onmessage = (event) => {
  const progress = JSON.parse(event.data);
  console.log(`Job ${progress.jobId}: ${progress.overallProgress}% complete`);
  console.log(`Current step: ${progress.steps[progress.currentStep].name}`);
};

// Backend publishes updates automatically via progressTracker
```

### Example 2: Agent Queries Another Agent

```typescript
// Fingerprint agent queries discovery agent for context
class FingerprintAgent extends BaseAgent {
  async process(job: Job) {
    // Query discovery agent for how targets were found
    const discoveryMethod = await this.coordination.queryAgent(
      this.getIdentity(),
      'discovery',
      `How were targets discovered for program ${job.programId}?`
    );

    if (discoveryMethod.source === 'chaos') {
      // Chaos-sourced targets are usually high quality
      return this.aggressiveScan(job);
    } else {
      // User-supplied targets may need more careful handling
      return this.conservativeScan(job);
    }
  }
}
```

### Example 3: Workflow Execution

```typescript
// Trigger workflow automatically after discovery
class OrchestrationService {
  async onJobComplete(job: Job, result: any) {
    if (job.type === 'discovery' && result.domains.length > 0) {
      // Execute subdomain enumeration workflow
      const executionId = await workflowEngine.executeWorkflow(
        'subdomain-enumeration',
        {
          programId: job.programId,
          discovery: result
        }
      );

      logger.info({ executionId }, 'Started subdomain enumeration workflow');
    }
  }
}
```

---

## Best Practices

### 1. Always Validate Before Executing

```typescript
// ❌ Bad: Execute blindly
await this.executeCommand(`httpx -l ${file}`);

// ✅ Good: Validate first
const validation = await this.commandValidator.validateCommand(
  jobId,
  'fingerprint',
  `httpx -l ${file}`
);

if (!validation.safe) {
  throw new Error(`Validation failed: ${validation.reasons.join(', ')}`);
}

await this.executeCommandSafe(`httpx -l ${file}`, jobId);
```

### 2. Use Checkpoints for Risky Operations

```typescript
// ❌ Bad: No rollback capability
const result = await this.scanForVulnerabilities(targets);
await this.storeFindings(result.findings);

// ✅ Good: Can rollback if something goes wrong
await this.checkpoint.executeWithRollback(
  jobId,
  async () => {
    const result = await this.scanForVulnerabilities(targets);
    await this.storeFindings(result.findings);
    return result;
  },
  (result) => result.findings.length > 0 // Validation
);
```

### 3. Provide Rich Context in Handoffs

```typescript
// ❌ Bad: Minimal context
await this.scheduleJob('fingerprint', {
  targets: subdomains
});

// ✅ Good: Rich context with reasoning
await richHandoffs.createHandoff(
  fromAgent,
  'fingerprint',
  {
    parentResult: { /* full result */ },
    reasoning: {
      trigger: 'Large subdomain set requires fingerprinting',
      confidence: 0.95,
      alternatives: ['portscan'],
      decisionFactors: { count: 500, time: 60 }
    },
    objectives: {
      primary: 'Fingerprint all 500 subdomains',
      secondary: ['Detect WAFs', 'Identify technologies'],
      avoid: ['Scanning out-of-scope']
    },
    successCriteria: {
      minAssets: 450,
      requiredFields: ['statusCode', 'server']
    },
    inherited: { /* constraints */ }
  },
  outputContract
);
```

### 4. Track Progress for Long Operations

```typescript
// ❌ Bad: No visibility
const results = await this.scanAllTargets(targets);

// ✅ Good: Step-by-step visibility
await this.progressTracker.initializeProgress(jobId, 'scanning', [
  { name: 'Load templates' },
  { name: 'Scan targets' },
  { name: 'Triage results' }
]);

await this.progressTracker.startStep(jobId, 0);
const templates = await this.loadTemplates();
await this.progressTracker.completeStep(jobId, 0);

await this.progressTracker.startStep(jobId, 1);
for (let i = 0; i < targets.length; i++) {
  await this.scanTarget(targets[i]);
  await this.progressTracker.updateStepProgress(
    jobId,
    1,
    Math.floor((i / targets.length) * 100)
  );
}
await this.progressTracker.completeStep(jobId, 1);
```

### 5. Use Workflows for Common Patterns

```typescript
// ❌ Bad: Imperative orchestration scattered across codebase
if (result.type === 'discovery') {
  await scheduleSubdomain(result);
  const subdomains = await waitForSubdomain();
  await Promise.all([
    scheduleFingerprint(subdomains),
    schedulePortscan(subdomains)
  ]);
}

// ✅ Good: Declarative workflow
const workflow = {
  name: 'standard-recon',
  steps: [
    { id: 'subdomain', agent: 'subdomain', ... },
    { id: 'parallel-recon', agent: 'multi', parallel: true, ... }
  ]
};

await workflowEngine.registerWorkflow(workflow);
await workflowEngine.executeWorkflow('standard-recon', context);
```

---

## Conclusion

These improvements transform AgentHunt from a simple job queue system into a robust, observable, self-healing multi-agent platform inspired by Claude Code's architecture.

**Key Benefits**:
- **Observability**: Real-time visibility into all agent operations
- **Safety**: Pre-validation and rollback prevent catastrophic failures
- **Collaboration**: Agents can query each other and share context
- **Maintainability**: Declarative workflows are easier to understand and modify
- **Reliability**: Self-healing reduces manual intervention

**Next Steps**:
1. Integrate services into BaseAgent
2. Update existing agents to use progress tracking
3. Create common workflows for your use cases
4. Set up WebSocket endpoint for real-time UI updates
5. Monitor agent health and optimize based on metrics
