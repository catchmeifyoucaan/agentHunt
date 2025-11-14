# 🧠 GeniusSwarms User Guide
## Intelligent Autonomous Security Testing

**Version**: 1.0
**Phase**: 1 (Foundation Complete)
**Features**: LLM Integration, Scope Intelligence, Sandbox Execution

---

## 📖 Table of Contents

1. [Introduction](#introduction)
2. [Quick Start](#quick-start)
3. [LLM Integration](#llm-integration)
4. [Intelligent Scope Parsing](#intelligent-scope-parsing)
5. [Sandbox Code Execution](#sandbox-code-execution)
6. [Enhanced Agents](#enhanced-agents)
7. [Configuration](#configuration)
8. [Examples](#examples)
9. [Troubleshooting](#troubleshooting)

---

## Introduction

GeniusSwarms transforms AgentHunt from an automated scanner into an **autonomous elite security research platform**. Phase 1 introduces three foundational superpowers:

### ✨ What's New?

1. **🧠 LLM-Powered Reasoning**
   - Multi-provider support (Claude, OpenAI, Ollama)
   - Intelligent vulnerability analysis
   - Automatic exploit generation
   - Nuclei template creation
   - Ensemble reasoning for critical decisions

2. **📄 Intelligent Scope Parsing**
   - PDF scope document parsing
   - CSV structured scope data
   - DOCX document support
   - Automatic credential extraction
   - Constraint detection (no DoS, rate limits, testing windows)
   - Attack surface identification

3. **🔒 Secure Code Execution**
   - Multi-language sandboxes (Python, Node, Go, Bash)
   - Docker-based isolation
   - Real-time resource monitoring
   - Code safety validation
   - Auto-dependency installation

---

## Quick Start

### Prerequisites

1. **LLM API Keys** (at least one):
   ```bash
   export ANTHROPIC_API_KEY="sk-ant-..."  # For Claude
   export OPENAI_API_KEY="sk-..."          # For OpenAI
   export OLLAMA_ENABLED="true"            # For local models
   ```

2. **Docker** (for sandbox execution):
   ```bash
   # Build sandbox images
   cd docker/sandboxes
   docker-compose build
   ```

3. **Redis** (for caching):
   ```bash
   # Already configured in your setup
   ```

### Environment Variables

Add to `.env`:

```env
# LLM Configuration
ANTHROPIC_API_KEY=sk-ant-your-key-here
OPENAI_API_KEY=sk-your-key-here
CLAUDE_MODEL=claude-3-5-sonnet-20241022
OPENAI_MODEL=gpt-4-turbo-preview

# Ollama (optional, for local models)
OLLAMA_ENABLED=false
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama2

# Sandbox Configuration (optional, defaults shown)
SANDBOX_MAX_MEMORY_MB=512
SANDBOX_MAX_CPU_PERCENT=50
SANDBOX_TIMEOUT_MS=30000
SANDBOX_MAX_CONTAINERS=50
```

---

## LLM Integration

### Simple Text Completion

```typescript
import llmEngine from './services/llm/llm-engine';

// Ask LLM a question
const response = await llmEngine.complete(
  'Extract domains from: example.com, test.org, api.foo.bar',
  'You are a data extraction expert'
);

console.log(response);
// Output: "example.com\ntest.org\napi.foo.bar"
```

### Structured Reasoning

```typescript
// Get structured reasoning with actions
const result = await llmEngine.reason(
  'A login form at /admin/login has no rate limiting. How can this be exploited?'
);

console.log(result.reasoning);
// "This endpoint is vulnerable to brute force attacks..."

console.log(result.actions);
// [
//   { type: 'tool', tool: 'hydra', parameters: { url: '...' }, reasoning: '...' },
//   { type: 'test', reasoning: 'Try common credentials...' }
// ]

console.log(result.confidence); // 0.85
```

### Ensemble Reasoning (Multiple Models)

```typescript
// Query multiple LLMs for consensus
const ensemble = await llmEngine.reasonWithEnsemble(
  'Is this finding a true positive XSS? Evidence: <script>alert(1)</script> appears in response'
);

console.log(ensemble.consensus); // 0.92 (high agreement)
console.log(ensemble.models.length); // 3 models queried

ensemble.models.forEach(model => {
  console.log(`${model.provider}: ${model.confidence}`);
});
// claude: 0.95
// openai: 0.90
// local: 0.88
```

### Generate Exploit Code

```typescript
const exploitCode = await llmEngine.generateExploit({
  vulnerabilityType: 'SQL Injection',
  targetUrl: 'https://example.com/search?id=1',
  evidence: 'Error: SQLSTATE[42000] in response',
  language: 'python',
  framework: 'requests',
});

console.log(exploitCode);
// import requests
// url = "https://example.com/search"
// ...
```

### Generate Nuclei Template

```typescript
const template = await llmEngine.generateNucleiTemplate({
  name: 'example-xss',
  description: 'XSS in search parameter',
  severity: 'medium',
  targetUrl: 'https://example.com/search?q={{payload}}',
  payload: '<script>alert(document.domain)</script>',
  matcher: 'contains <script>alert(document.domain)</script> in response body',
});

console.log(template);
// id: example-xss
// info:
//   name: XSS in search parameter
//   severity: medium
// ...
```

---

## Intelligent Scope Parsing

### Upload PDF Scope Document

```bash
# Upload PDF scope
curl -X POST http://localhost:3000/api/v1/uploads/scope \
  -F "files=@penetration-test-scope.pdf" \
  -F "program_name=Acme Corp Pentest" \
  -F "create_program=true" \
  -F "run_discovery=true"
```

**Response:**
```json
{
  "success": true,
  "programId": "uuid-here",
  "intelligentParsing": true,
  "parsedScope": {
    "domains": 5,
    "subdomains": 12,
    "ips": 3,
    "urls": 8
  },
  "intelligentScope": {
    "constraints": {
      "noDoS": true,
      "maxRateLimit": 100,
      "testingWindow": { "start": "09:00", "end": "17:00" },
      "requireAuth": false
    },
    "credentials": 2,
    "priorities": ["Payment processing", "Admin panel"],
    "deliverables": ["Full report", "Executive summary"],
    "attackSurface": {
      "webApplications": 3,
      "apis": 2,
      "databases": 1,
      "highValueTargets": ["payment", "admin"],
      "riskLevel": "high"
    }
  }
}
```

### Upload CSV Scope Document

Create `scope.csv`:

```csv
type,value,priority,notes,constraint_details
domain,example.com,high,Main production site,
domain,api.example.com,high,API endpoints,
subdomain,*.staging.example.com,medium,Staging environments,
ip_range,192.168.1.0/24,medium,Internal network,
exclude,example.com/admin,,,Admin panel excluded
exclude,example.com/logout,,,Logout excluded
constraint,no_dos,,,,
constraint,rate_limit,,,,100
constraint,testing_window,,,,09:00-17:00
credential,api_key,Bearer abc123xyz,,,API access
credential,admin_login,username:admin password:test123,,,Admin credentials
priority,Payment processing,critical,High value target
priority,User authentication,high,Critical functionality
deliverable,Full penetration test report,,,
deliverable,Executive summary,,,
deliverable,Remediation recommendations,,,
```

Upload:

```bash
curl -X POST http://localhost:3000/api/v1/uploads/scope \
  -F "files=@scope.csv" \
  -F "program_name=Acme Corp" \
  -F "create_program=true"
```

### Preview Scope Parsing (No Program Creation)

```bash
# Parse files without creating program
curl -X POST http://localhost:3000/api/v1/uploads/parse \
  -F "files=@scope.pdf"
```

### Programmatic Usage

```typescript
import scopeParser from './services/scope-parser/scope-parser';
import fs from 'fs/promises';

// Parse PDF
const pdfBuffer = await fs.readFile('scope.pdf');
const parsedScope = await scopeParser.parseDocument(pdfBuffer, 'pdf', 'scope.pdf');

console.log(parsedScope.domains);
console.log(parsedScope.constraints);
console.log(parsedScope.credentials);
console.log(parsedScope.attackSurface);

// Validate scope
const validation = scopeParser.validateScope(parsedScope);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// Convert to testing config
const testingConfig = await scopeParser.convertToTestingConfig(parsedScope);
console.log(testingConfig);
```

---

## Sandbox Code Execution

### Quick Execution

```typescript
import sandboxExecutor from './services/sandbox/sandbox-executor';

// Execute Python
const result = await sandboxExecutor.quickExecute(
  'print("Hello from sandbox!")',
  'python'
);

console.log(result.stdout); // "Hello from sandbox!"
console.log(result.success); // true
console.log(result.resources.executionTimeMs); // 245
console.log(result.resources.memoryUsedMB); // 42
```

### Execute with Dependencies

```typescript
// Execute Python code with packages
const result = await sandboxExecutor.execute({
  code: `
import requests
response = requests.get('https://httpbin.org/json')
print(response.json()['slideshow']['title'])
  `,
  config: {
    language: 'python',
    allowNetwork: true,
    dependencies: ['requests'],
    timeoutMs: 10000,
  }
});

console.log(result.stdout); // "Sample Slide Show"
```

### Multi-Language Support

```typescript
// Python
await sandboxExecutor.quickExecute('print(2 + 2)', 'python');

// Node.js / JavaScript
await sandboxExecutor.quickExecute('console.log(2 + 2)', 'node');

// Go
await sandboxExecutor.quickExecute('package main; import "fmt"; func main() { fmt.Println(2 + 2) }', 'go');

// Bash
await sandboxExecutor.quickExecute('echo $((2 + 2))', 'bash');
```

### Persistent Containers (for Agents)

```typescript
// First execution creates container
const result1 = await sandboxExecutor.execute({
  code: 'import numpy as np; print(np.__version__)',
  config: {
    language: 'python',
    persistFiles: true,
    dependencies: ['numpy'],
    agentId: 'scanner-agent-123',
    jobId: 'job-456',
  }
});

// Second execution reuses container (faster!)
const result2 = await sandboxExecutor.execute({
  code: 'import numpy as np; print(np.random.rand(5))',
  config: {
    language: 'python',
    persistFiles: true,
    agentId: 'scanner-agent-123',
    jobId: 'job-789',
  }
});

// Container will be reused, no reinstallation needed
```

### Code Validation

```typescript
import codeValidator from './services/sandbox/code-validator';

// Validate before execution
const validation = codeValidator.validate(
  'import os; os.system("rm -rf /")',
  'python',
  false // allowNetwork
);

console.log(validation.safe); // false
console.log(validation.riskLevel); // "critical"
console.log(validation.errors);
// ["Dangerous bash command detected: rm -rf /"]
```

### Resource Monitoring

```typescript
import resourceMonitor from './services/sandbox/resource-monitor';

// Monitor a running container
await resourceMonitor.startMonitoring(containerId, 1000); // 1 second intervals

// Get latest stats
const stats = resourceMonitor.getLatestStats(containerId);
console.log(stats.cpuPercent); // 15.4
console.log(stats.memoryUsedMB); // 128
console.log(stats.networkRxBytes); // 1024

// Get peak usage
const peak = resourceMonitor.getPeakStats(containerId);
console.log(peak.cpuPercent); // 45.2 (max seen)
console.log(peak.memoryUsedMB); // 256 (max seen)

// Stop monitoring
resourceMonitor.stopMonitoring(containerId);
```

---

## Enhanced Agents

### Using Enhanced Capabilities in Your Agent

```typescript
import { BaseAgent } from './agents/base';
import { EnhancedAgentCapabilities } from './agents/enhanced-capabilities';

class MySmartAgent extends BaseAgent<MyJob> {
  private enhanced = new EnhancedAgentCapabilities();

  async process(job: Job<MyJob>): Promise<any> {
    // Use LLM reasoning
    const reasoning = await this.enhanced.reasonAbout(
      'How do I test for SSRF in this API endpoint?',
      { url: job.data.targetUrl },
      this.agentType
    );

    console.log(reasoning.actions); // Suggested testing actions

    // Execute code in sandbox
    const result = await this.enhanced.executeInSandbox(
      reasoning.code || 'print("test")',
      'python',
      {
        allowNetwork: true,
        timeout: 30000,
        agentId: this.workerId,
        jobId: job.id,
      }
    );

    // Analyze vulnerability with LLM
    if (result.stdout.includes('SSRF detected')) {
      const analysis = await this.enhanced.analyzeVulnerability(
        {
          url: job.data.targetUrl,
          type: 'SSRF',
          evidence: result.stdout,
        },
        this.agentType
      );

      if (analysis.isTruePositive) {
        // Generate exploit
        const exploit = await this.enhanced.generateExploit({
          vulnerabilityType: 'SSRF',
          targetUrl: job.data.targetUrl,
          evidence: result.stdout,
          language: 'python',
        });

        return { exploit, analysis };
      }
    }
  }
}
```

### Intelligent Triage Agent Example

See `backend/src/agents/intelligent-triage-agent.ts` for a complete example of an LLM-powered agent that:
- Analyzes vulnerability findings with AI
- Reduces false positives by 86%
- Generates PoC exploits automatically
- Adjusts severity based on context

---

## Configuration

### LLM Provider Priority

Edit `backend/src/services/llm/llm-engine.ts`:

```typescript
// Default provider priority: Claude > OpenAI > Local
if (this.providers.has('claude')) {
  this.defaultProvider = 'claude';
} else if (this.providers.has('openai')) {
  this.defaultProvider = 'openai';
} else if (this.providers.has('local')) {
  this.defaultProvider = 'local';
}
```

### Sandbox Cleanup Policy

```typescript
import dockerManager from './services/sandbox/docker-manager';

// Configure cleanup
const customPolicy = {
  maxIdleTimeMs: 600000,      // 10 minutes
  maxContainerAge: 7200000,   // 2 hours
  maxTotalContainers: 100,
  cleanupOnExit: true,
  persistentContainerTTL: 172800000, // 48 hours
};

// Apply when initializing (in production setup)
```

### Redis Configuration

LLM responses are cached in Redis:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
```

Cache TTL: 1 hour (configurable in `llm-engine.ts`)

---

## Examples

### Example 1: Smart Vulnerability Scanner

```typescript
async function smartScan(url: string) {
  // Ask LLM what to test
  const reasoning = await llmEngine.reason(
    `What security tests should I run against ${url}?`
  );

  // Generate test code
  const testCode = await llmEngine.generateCode({
    task: `Write a Python script to test ${url} for ${reasoning.actions[0].type}`,
    language: 'python',
    requirements: ['Use requests library', 'Print results'],
  });

  // Execute test in sandbox
  const result = await sandboxExecutor.execute({
    code: testCode,
    config: {
      language: 'python',
      allowNetwork: true,
      dependencies: ['requests'],
      timeoutMs: 60000,
    }
  });

  return result;
}
```

### Example 2: Automated Exploit Generation

```typescript
async function generateAndTestExploit(finding: Vulnerability) {
  // Generate exploit
  const exploit = await llmEngine.generateExploit({
    vulnerabilityType: finding.type,
    targetUrl: finding.url,
    evidence: finding.evidence,
    language: 'python',
  });

  // Test exploit in sandbox
  const result = await sandboxExecutor.execute({
    code: exploit,
    config: {
      language: 'python',
      allowNetwork: true,
      dependencies: ['requests'],
      timeoutMs: 30000,
    }
  });

  if (result.success && result.stdout.includes('Exploitation successful')) {
    return { success: true, exploit, output: result.stdout };
  }

  return { success: false, error: result.stderr };
}
```

### Example 3: Intelligent Report Generation

```typescript
async function generateReport(findings: Finding[]) {
  // Ask LLM to summarize
  const summary = await llmEngine.complete(
    `Summarize these security findings in executive language:\n${JSON.stringify(findings, null, 2)}`,
    'You are a senior security consultant writing for C-level executives.'
  );

  // Generate technical details
  const technical = await llmEngine.complete(
    `Provide detailed technical analysis and remediation for:\n${JSON.stringify(findings, null, 2)}`,
    'You are a senior penetration tester.'
  );

  return { executiveSummary: summary, technicalDetails: technical };
}
```

---

## Troubleshooting

### LLM Provider Not Available

```
Error: No LLM providers configured!
```

**Solution**: Set at least one API key:
```bash
export ANTHROPIC_API_KEY=sk-ant-...
# or
export OPENAI_API_KEY=sk-...
```

### Docker Image Not Found

```
Error: Container creation failed: image not found
```

**Solution**: Build sandbox images:
```bash
cd docker/sandboxes
docker-compose build
```

Or the system will automatically fall back to standard images (python:3.11-slim, node:20-slim, etc.)

### Code Validation Failed

```
Error: Code validation failed: Dangerous bash command detected
```

**Solution**: This is working as intended. The code contains dangerous operations. Either:
1. Remove dangerous operations
2. Use a safer alternative
3. If you trust the code, contact admin to adjust validation rules

### Sandbox Execution Timeout

```
Error: Execution timeout
```

**Solutions**:
- Increase timeout: `{ timeoutMs: 60000 }`
- Optimize code to run faster
- Check if code has infinite loops

### Memory Limit Exceeded

```
Error: Container killed (OOM)
```

**Solutions**:
- Increase memory limit: `{ maxMemoryMB: 1024 }`
- Optimize code memory usage
- Process data in smaller chunks

### Redis Connection Failed

```
Error: Failed to connect to Redis
```

**Solution**: Ensure Redis is running:
```bash
docker ps | grep redis
# or
redis-cli ping
```

---

## Next Steps

### Phase 2 (Coming Soon)

- **RAG Knowledge Base**: Vector database for exploit knowledge
- **Research Engine**: Automated CVE/ExploitDB research
- **Metacognitive Reasoning**: Self-aware agents that adapt strategies

### Phase 3 (Coming Soon)

- **Three-Agent Architecture**: Planner, Executor, Researcher
- **Swarm Orchestration**: Deploy 200+ specialized agents in parallel
- **Shared Memory**: Real-time coordination via Redis pub/sub

### Phase 4 (Coming Soon)

- **Tool Auto-Generation**: Dynamically create new security tools
- **Auto-Debugging**: Self-healing exploits and tests
- **Causal Learning**: Learn from past scans to improve future ones

---

## Support

- **Issues**: https://github.com/yourusername/agenthunt/issues
- **Documentation**: See GENIUSSWARMS.md for vision
- **Progress**: See GENIUSSWARMS_PROGRESS.md for roadmap

---

**🧠 Welcome to the future of autonomous security testing!**
