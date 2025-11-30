# agentHunt - Autonomous Bug Bounty Automation Platform

## 🎯 System Overview

**agentHunt** is a sophisticated multi-agent bug bounty automation platform featuring **42 specialized agents** working in coordination to discover, analyze, exploit, confirm, and report vulnerabilities. The system uses advanced coordination patterns including **Rich Handoffs**, **Shared Memory**, and a **Three-Agent Architecture** to maximize efficiency and accuracy.

### Key Statistics
- **42 Specialized Agents**: 24 core + 18 Phase 2 advanced security agents
- **27 Rich Handoff Workflows**: Universal context-preserving agent coordination
- **3 Meta-Agents**: Planner, Executor, Researcher for swarm coordination
- **1 GOD MODE Manager**: Oversight, healing, and critical decision approval
- **100+ Security Tools**: Integrated for comprehensive testing

### Core Capabilities
- **Autonomous Reconnaissance**: From domain → subdomains → ports → services → technologies
- **Intelligent Vulnerability Detection**: Scanner → Specialized Agents (XSS, SQLi, SSRF, etc.)
- **Multi-Method Confirmation**: Reduce false positives with automated validation
- **LLM-Enhanced Analysis**: Claude AI for triage, PoC generation, and impact assessment
- **Self-Healing DevOps**: Manager agent monitors and fixes silent failures
- **Universal Rich Handoffs**: Full context preservation across all critical workflows

---

## 🏗️ System Architecture

### Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    GOD MODE LAYER                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Manager Agent (Hidden Orchestrator)                  │   │
│  │  - Monitors all agents via BullMQ events             │   │
│  │  - Detects silent failures and errors                │   │
│  │  - Self-healing DevOps capabilities                  │   │
│  │  - Requires approval for critical decisions          │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                 THREE-AGENT META LAYER                       │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │   Planner    │  │   Executor   │  │   Researcher    │   │
│  │  (Strategy)  │  │   (Swarm)    │  │  (Validation)   │   │
│  └──────────────┘  └──────────────┘  └─────────────────┘   │
│         │                  │                   │             │
│         └──────────────────┴───────────────────┘             │
│                   Shared Memory (Redis)                      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│              42 SPECIALIZED AGENT LAYER                      │
│                                                               │
│  Discovery Phase (4 agents):                                 │
│    Subdomain → Bruteforce → Discovery → Fingerprint          │
│                                                               │
│  Scanning Phase (5 agents):                                  │
│    Portscan → Scanner → Crawl → Browser → Jsanalysis         │
│                                                               │
│  Exploitation Phase (7 agents):                              │
│    XSS → SQLi → SSRF → Webvulns → Apifuzz → OSINT →         │
│    Cloudmisconfig                                            │
│                                                               │
│  Validation Phase (3 agents):                                │
│    Confirm → Interact → Triage                               │
│                                                               │
│  Reporting Phase (2 agents):                                 │
│    Intelligent-Triage → Autonomous-Scanner                   │
│                                                               │
│  Phase 2 Advanced Security (18 agents):                      │
│    AuthBypass → GraphQL → TemplateInjection → XXE →         │
│    RaceCondition → Deserialization → CORS → CSRF →          │
│    GRPC → WebSocket → Serverless → ContainerEscape →        │
│    GitLeaks → DarkWebIntel → BrandImpersonation →           │
│    SupplyChain → APIVersioning → PromptInjection            │
│                                                               │
│  Communication: BullMQ Job Queues + Rich Handoffs            │
└─────────────────────────────────────────────────────────────┘
```

---

## 🚀 How The System Works: End-to-End Execution Flow

### Phase 1: Initial Discovery (Entry Point)

**User Input**: `Target: example.com`

```
1. User submits bug bounty program with scope
2. Manager Agent validates scope and creates initial jobs
3. Discovery workflow begins
```

### Phase 2: Subdomain & Asset Discovery

```
┌─────────────┐
│  Subdomain  │ Passive enumeration (subfinder, amass, assetfinder)
│    Agent    │ - Certificate transparency logs
└──────┬──────┘ - DNS datasets (crt.sh, Censys, Shodan)
       │        - Third-party APIs
       │ Discovers: 150 subdomains
       ↓
┌─────────────┐
│ Bruteforce  │ Active DNS bruteforce (shuffledns + massdns)
│    Agent    │ - Wordlist-based bruteforce
└──────┬──────┘ - Permutation generation (alterx)
       │        - High-speed DNS resolution
       │ Discovers: +50 subdomains (total: 200)
       ↓
┌─────────────┐
│  Discovery  │ Asset validation & expansion
│    Agent    │ - HTTP/HTTPS probe (httpx)
└──────┬──────┘ - Screenshot capture
       │        - ASN/IP range mapping
       │ 🎯 RICH HANDOFF → Fingerprint
       │ Context: 200 subdomains, 180 alive URLs
       ↓
┌─────────────┐
│ Fingerprint │ Technology detection (wappalyzer, nuclei)
│    Agent    │ - CMS identification (WordPress, Drupal)
└──────┬──────┘ - Framework detection (React, Django, Rails)
       │        - CDN/WAF detection (Cloudflare, Akamai)
       │        - Version fingerprinting
       │
       ├─→ 🎯 RICH HANDOFF → Scanner (with tech context)
       └─→ 🎯 RICH HANDOFF → Crawl (for endpoint discovery)
```

**Output**:
- 200 subdomains discovered
- 180 alive HTTP/HTTPS URLs
- Technology stack mapped
- Ready for vulnerability scanning

---

### Phase 3: Port Scanning & Service Detection

```
┌─────────────┐
│  Portscan   │ Fast port scanning (naabu, masscan)
│    Agent    │ - Top 1000 ports scan
└──────┬──────┘ - Service version detection
       │        - Banner grabbing
       │ Discovers: 45 open ports across infrastructure
       │
       └─→ 🎯 RICH HANDOFF → Scanner (infrastructure vulns)
```

**Output**:
- Port inventory (22, 80, 443, 3306, 6379, etc.)
- Service versions (Apache 2.4.41, MySQL 5.7, Redis 6.0)
- Potential attack surface expanded

---

### Phase 4: Web Application Scanning

```
┌─────────────┐
│   Scanner   │ Nuclei-based vulnerability scanning
│    Agent    │ - 5000+ vulnerability templates
└──────┬──────┘ - High concurrency (500 threads)
       │        - CVE detection, misconfigurations
       │ Finds: 87 potential vulnerabilities
       │
       ├─→ 🎯 RICH HANDOFF → Triage (general classification)
       ├─→ 🎯 RICH HANDOFF → XSS (reflected/stored XSS)
       ├─→ 🎯 RICH HANDOFF → SQLi (database injections)
       ├─→ 🎯 RICH HANDOFF → SSRF (server-side request forgery)
       └─→ 🎯 RICH HANDOFF → Webvulns (LFI/RCE/IDOR)

Each handoff includes:
  - parentResult: Full scanner findings with categorization
  - reasoning: Why handoff, confidence (0.75-0.95), alternatives
  - objectives: Primary goal, secondary objectives, avoid list
  - successCriteria: Min assets, quality threshold, required fields
  - inherited: Rate limits, timeouts, budgets, retry policies
```

**Output**:
- 87 findings categorized by type
- 23 XSS candidates → XSS Agent
- 12 SQLi candidates → SQLi Agent
- 8 SSRF candidates → SSRF Agent
- 15 LFI/RCE/IDOR → Webvulns Agent

---

### Phase 5: Deep Web Crawling & Analysis

```
┌─────────────┐
│    Crawl    │ Intelligent web crawler (gospider, katana)
│    Agent    │ - JavaScript rendering
└──────┬──────┘ - Form discovery
       │        - Parameter extraction
       │        - Endpoint mapping
       │ Discovers: 2,847 URLs, 156 JS files, 43 API endpoints
       │
       ├─→ 🎯 RICH HANDOFF → Jsanalysis (156 JS files)
       │   Context: JS files categorized (frameworks, analytics, custom)
       │
       ├─→ 🎯 RICH HANDOFF → Apifuzz (43 API endpoints)
       │   Context: REST/GraphQL endpoints with method detection
       │
       └─→ 🎯 RICH HANDOFF → Scanner (2,847 discovered URLs)
           Context: All crawled URLs for vulnerability scanning

┌─────────────┐
│ Jsanalysis  │ JavaScript static analysis
│    Agent    │ - Source map discovery
└──────┬──────┘ - Secret extraction (API keys, tokens)
       │        - Endpoint discovery in JS
       │        - DOM sink detection (innerHTML, eval, location)
       │ Finds: 23 dangerous DOM sinks, 7 API keys, 34 hidden endpoints
       │
       ├─→ 🎯 RICH HANDOFF → XSS (23 DOM sinks for exploitation)
       │   Context: DOM sinks with file location, sink type, confidence
       │
       └─→ 🎯 RICH HANDOFF → Scanner (34 hidden API endpoints)
           Context: Endpoints from JS analysis for validation
```

**Output**:
- Complete site map (2,847 URLs)
- 156 JavaScript files analyzed
- 23 DOM XSS candidates
- 43 API endpoints ready for fuzzing
- 7 leaked credentials/API keys

---

### Phase 6: Specialized Exploitation Agents

#### 6A. XSS Agent

```
┌─────────────┐
│  XSS Agent  │ Multi-context XSS testing
│             │ - Reflected XSS (parameter injection)
└──────┬──────┘ - Stored XSS (persistent payloads)
       │        - DOM-based XSS (client-side sinks)
       │        - Polyglot payload testing
       │        - Context-aware encoding bypass
       │
       │ Tools: dalfox (fuzzing), custom payloads
       │ Techniques: Parameter pollution, encoding bypass, WAF evasion
       │
       │ Finds: 8 confirmed XSS vulnerabilities
       │   - 3 stored XSS (high severity)
       │   - 2 reflected XSS (medium severity)
       │   - 3 DOM-based XSS (medium severity)
       │
       └─→ 🎯 RICH HANDOFF → Confirm (8 high-confidence XSS)
           Context: XSS type, payload, context, confidence
           Objectives: Multi-browser validation, PoC generation
```

#### 6B. SQLi Agent

```
┌─────────────┐
│ SQLi Agent  │ SQL injection testing
│             │ - Error-based SQLi
└──────┬──────┘ - Boolean-based blind SQLi
       │        - Time-based blind SQLi
       │        - UNION-based SQLi
       │        - Stacked queries
       │
       │ Tools: sqlmap (exploitation)
       │ Techniques: DBMS fingerprinting, data extraction, privilege escalation
       │
       │ Finds: 5 SQL injection vulnerabilities
       │   - 2 UNION-based (data extraction)
       │   - 2 Boolean-based blind (authentication bypass)
       │   - 1 Time-based blind (slow but confirmed)
       │
       └─→ 🎯 RICH HANDOFF → Confirm (5 high-confidence SQLi)
           Context: SQLi technique, DBMS type, data extracted
           Objectives: Database enumeration, safe data proof
```

#### 6C. SSRF Agent

```
┌─────────────┐
│ SSRF Agent  │ Server-Side Request Forgery testing
│             │ - Internal IP scanning (169.254.x.x, 10.x.x.x)
└──────┬──────┘ - Cloud metadata endpoints (AWS, GCP, Azure)
       │        - Out-of-band callbacks (Burp Collaborator)
       │        - Protocol smuggling (file://, gopher://, dict://)
       │
       │ Tools: ssrfmap, custom payloads, Burp Collaborator
       │ Techniques: URL parser bypass, CRLF injection, DNS rebinding
       │
       │ Finds: 3 SSRF vulnerabilities
       │   - 1 AWS metadata access (critical)
       │   - 1 internal network access (high)
       │   - 1 DNS exfiltration (medium)
       │
       └─→ 🎯 RICH HANDOFF → Confirm (3 OOB-confirmed SSRF)
           Context: SSRF type, internal IPs accessed, metadata exposed
           Objectives: Multi-protocol validation, cloud service enumeration
```

#### 6D. Webvulns Agent

```
┌─────────────┐
│  Webvulns   │ OWASP Top 10 vulnerability testing
│    Agent    │ - Local File Inclusion (LFI)
└──────┬──────┘ - Remote Code Execution (RCE)
       │        - Insecure Direct Object Reference (IDOR)
       │        - Open Redirect
       │        - XXE (XML External Entity)
       │
       │ Tools: nuclei (OWASP templates), custom exploits
       │ Techniques: Path traversal, command injection, object manipulation
       │
       │ Finds: 11 high-impact vulnerabilities
       │   - 4 LFI (file read: /etc/passwd, config files)
       │   - 2 RCE (command execution confirmed)
       │   - 3 IDOR (access control bypass)
       │   - 2 Open Redirect (phishing potential)
       │
       └─→ 🎯 RICH HANDOFF → Confirm (11 high-impact vulns)
           Context: Vuln type, file accessed, exploit proof
           Objectives: Safe exploitation, impact demonstration
```

#### 6E. Apifuzz Agent

```
┌─────────────┐
│  Apifuzz    │ REST/GraphQL API security testing
│    Agent    │ - Authentication bypass
└──────┬──────┘ - IDOR/BOLA (Broken Object Level Authorization)
       │        - GraphQL introspection
       │        - Mass assignment
       │        - Rate limiting bypass
       │
       │ Tools: nuclei (API templates), ffuf (fuzzing)
       │ Techniques: JWT manipulation, parameter pollution, schema abuse
       │
       │ Finds: 6 API vulnerabilities
       │   - 2 authentication bypass (critical)
       │   - 3 IDOR/BOLA (high severity)
       │   - 1 GraphQL introspection enabled (info disclosure)
       │
       └─→ 🎯 RICH HANDOFF → Confirm (6 high-severity API vulns)
           Context: API type (REST/GraphQL), auth state, exploit method
           Objectives: Multi-method confirmation, PoC generation (curl/Postman)
```

---

### Phase 7: Supplementary Intelligence Gathering

#### 7A. OSINT Agent

```
┌─────────────┐
│ OSINT Agent │ Open-Source Intelligence gathering
│             │ - Email leak searches (h8mail, dehashed)
└─────────────┘ - Credential breaches
                - Microsoft 365/Azure tenant mapping
                - GitHub secret scanning
                - Google dorking
                - Metadata extraction from documents

Output:
  - 47 employee emails discovered
  - 12 leaked credentials found in breaches
  - 3 API keys in public GitHub repos
  - Azure tenant ID mapped
  - Sensitive document metadata extracted
```

#### 7B. Cloudmisconfig Agent

```
┌─────────────┐
│Cloudmisconfig| Cloud storage misconfiguration testing
│    Agent    │ - S3 bucket enumeration (AWS)
└─────────────┘ - Azure Blob storage
                - GCP buckets
                - DigitalOcean Spaces
                - Public access testing
                - ACL misconfiguration

Output:
  - 8 S3 buckets discovered
  - 3 publicly accessible (critical)
  - 1 writable bucket (critical)
  - Backup files, customer data exposed
```

#### 7C. Browser Agent

```
┌─────────────┐
│   Browser   │ Headless browser automation (Playwright)
│    Agent    │ - XSS confirmation with real browser
└─────────────┘ - CSRF token validation
                - Authentication flow testing
                - Video recording for PoC
                - Screenshot capture

Output:
  - Browser-based XSS confirmation
  - CSRF vulnerabilities validated
  - Video PoC generated
```

#### 7D. Interact Agent

```
┌─────────────┐
│  Interact   │ Out-of-Band interaction monitoring
│    Agent    │ - Blind SSRF detection
└─────────────┘ - Blind RCE detection
                - DNS/HTTP callbacks (Interactsh/Burp Collaborator)
                - XXE OOB exploitation

Output:
  - OOB callbacks received
  - Blind vulnerabilities confirmed
  - Interaction logs with timestamps
```

---

### Phase 8: Multi-Method Confirmation

```
┌─────────────┐
│   Confirm   │ Multi-method vulnerability validation
│    Agent    │ - Reduces false positives
└──────┬──────┘ - Multiple confirmation techniques per vuln type
       │        - Retry with variations
       │        - Cross-validation
       │        - Exploit proof generation
       │
       │ Confirmation Methods by Type:
       │ - XSS: Multi-browser, multiple payloads, context validation
       │ - SQLi: Multi-technique (error, boolean, time-based)
       │ - SSRF: Multi-protocol (HTTP, DNS, FTP), metadata access
       │ - LFI: Multiple files (/etc/passwd, /etc/hosts, app configs)
       │ - RCE: Safe commands (whoami, id, hostname)
       │ - IDOR: Object reference manipulation (user IDs, doc IDs)
       │ - API: Auth state testing, parameter manipulation
       │
       │ Input: 46 potential vulnerabilities
       │ Confirmation Rate: 65% (30 confirmed, 16 false positives)
       │
       │ Confirmed: 30 validated vulnerabilities
       │   - 8 XSS (7/8 confirmed = 87.5%)
       │   - 5 SQLi (5/5 confirmed = 100%)
       │   - 3 SSRF (3/3 confirmed = 100%)
       │   - 11 Webvulns (9/11 confirmed = 82%)
       │   - 6 API vulns (5/6 confirmed = 83%)
       │
       └─→ 🎯 RICH HANDOFF → Intelligent-Triage (30 confirmed vulns)
           Context: Confirmation results, exploit proofs, multi-method validation
           Objectives: PoC generation, CVSS scoring, bug bounty report creation
```

---

### Phase 9: Intelligent Triage & Reporting

```
┌─────────────┐
│ Intelligent │ LLM-enhanced vulnerability analysis
│   Triage    │ - Claude AI for deep analysis
└──────┬──────┘ - Exploitability assessment
       │        - Business impact analysis
       │        - CVSS v3.1 scoring
       │        - Professional PoC generation
       │        - Bug bounty report creation
       │
       │ For Each Confirmed Vulnerability:
       │
       │ 1. LLM Analysis:
       │    - True positive validation
       │    - Real-world exploitability
       │    - Attack scenario generation
       │    - Impact assessment (data breach, account takeover, etc.)
       │
       │ 2. PoC Generation:
       │    - Multiple formats (curl, Python, Burp Suite)
       │    - Step-by-step reproduction
       │    - Video evidence (if available from Browser Agent)
       │    - Screenshots with annotations
       │
       │ 3. CVSS Scoring:
       │    - Attack Vector (Network/Adjacent/Local/Physical)
       │    - Attack Complexity (Low/High)
       │    - Privileges Required (None/Low/High)
       │    - User Interaction (None/Required)
       │    - Scope (Unchanged/Changed)
       │    - Impact (Confidentiality/Integrity/Availability)
       │
       │ 4. Bug Bounty Report:
       │    - Executive summary
       │    - Vulnerability details
       │    - Reproduction steps
       │    - PoC code/video
       │    - Impact analysis
       │    - CVSS score + severity
       │    - Remediation recommendations
       │    - References (CWE, OWASP, CVE)
       │
       │ Output: 30 Professional Bug Bounty Reports
       │   - 3 Critical (CVSS 9.0-10.0)
       │   - 12 High (CVSS 7.0-8.9)
       │   - 11 Medium (CVSS 4.0-6.9)
       │   - 4 Low (CVSS 0.1-3.9)
```

**Final Deliverables**:
- 30 validated vulnerabilities with proof
- 30 professional bug bounty reports
- PoC code in multiple formats
- Video evidence for critical findings
- Estimated bounty value: $25,000 - $75,000

---

### Phase 10: Legacy Triage (Fallback)

```
┌─────────────┐
│   Triage    │ Legacy AI-powered triage
│    Agent    │ - Claude AI analysis
└─────────────┘ - Finding normalization
                - Severity assignment
                - False positive filtering
                - PoC draft generation

Used for: Findings that bypass Intelligent-Triage or require quick classification
```

---

## 📊 Communication Patterns

### 1. BullMQ Job Queues (Primary Communication)

**Architecture**: Redis-backed job queue system

```typescript
// Job Creation
await queue.add('xss', {
  programId: 'prog_123',
  options: {
    urls: ['https://example.com'],
    payloads: ['<script>alert(1)</script>']
  }
});

// Job Processing
class XSSAgent extends BaseAgent {
  async process(job: Job) {
    const { programId, options } = job.data;
    // Execute XSS testing
    return { vulnerabilities: [...] };
  }
}
```

**Features**:
- Job priorities (1-10)
- Retry policies (exponential backoff)
- Job concurrency limits
- Job progress tracking
- Job result storage
- Dead letter queues for failed jobs

**Queue Names** (24 queues, one per agent):
- `discovery`, `subdomain`, `bruteforce`, `fingerprint`
- `portscan`, `scanner`, `crawl`, `browser`, `jsanalysis`
- `xss`, `sqli`, `ssrf`, `webvulns`, `apifuzz`
- `osint`, `cloudmisconfig`, `interact`, `bruteforce`
- `confirm`, `triage`, `intelligent-triage`
- `planner`, `executor`, `researcher`, `manager`

---

### 2. Rich Handoffs (Context-Preserving Coordination)

**Purpose**: Preserve full attack context when one agent hands off work to another

**Structure**:
```typescript
interface RichHandoff {
  parentResult: {
    // Complete findings from parent agent
    agentType: string;
    summary: object;
    findings: any[];
    categorization: object;
    // Agent-specific context
  };

  reasoning: {
    trigger: string;              // Why this handoff
    confidence: number;           // 0.0-1.0
    alternatives: string[];       // Other options considered
    decisionFactors: string[];    // Why this decision
  };

  objectives: {
    primary: string;              // Main goal
    secondary: string[];          // Additional objectives
    avoid: string[];              // What NOT to do
  };

  successCriteria: {
    minAssets: number;            // Min findings required
    maxDuration: number;          // Time budget (seconds)
    requiredFields: string[];     // Required data fields
    qualityThreshold: number;     // Min quality score
    customCriteria: object;       // Agent-specific criteria
  };

  inherited: {
    programId: string;
    rateLimit: number;            // Requests/second
    timeout: number;              // Per-request timeout
    safetyChecks: boolean;        // Enable safety validations
    budget: {
      maxRequests: number;
      maxTime: number;
    };
    retryPolicy: {
      maxRetries: number;
      backoff: 'linear' | 'exponential';
    };
  };
}
```

**Example: Scanner → XSS Rich Handoff**

```typescript
// Scanner finds XSS candidates and hands off to XSS agent
await this.createRichHandoff(scannerJobId, programId, 'xss', {
  parentResult: {
    agentType: 'scanner',
    totalFindings: 87,
    xssFindings: 23,
    vulnerabilities: [...], // 23 XSS candidates
    byType: {
      reflected: 15,
      stored: 5,
      dom: 3
    },
    detectionMethod: 'nuclei-xss-templates'
  },

  reasoning: {
    trigger: 'Found 23 XSS candidates across 15 endpoints',
    confidence: 0.85,
    alternatives: [
      'Skip specialized testing (high false-positive risk)',
      'Manual validation (slower)',
      'Automated deep XSS testing (recommended)'
    ],
    decisionFactors: [
      '15 reflected XSS patterns detected',
      '5 stored XSS contexts found',
      '3 DOM sinks identified',
      'User input reflection confirmed in responses'
    ]
  },

  objectives: {
    primary: 'Validate XSS vulnerabilities with multi-context payload testing',
    secondary: [
      'Test polyglot payloads for encoding bypass',
      'Identify WAF rules and bypass techniques',
      'Generate context-specific payloads',
      'Confirm stored XSS persistence',
      'Extract DOM sink exploitation paths'
    ],
    avoid: [
      'Do not trigger destructive payloads',
      'Avoid excessive requests causing rate limiting',
      'Skip payloads that may corrupt application state'
    ]
  },

  successCriteria: {
    minAssets: 23,                    // Test all candidates
    maxDuration: 900,                 // 15 minutes
    requiredFields: ['url', 'payload', 'context', 'type', 'confidence'],
    qualityThreshold: 0.7,            // 70% must be high confidence
    customCriteria: {
      confirmationRate: 0.6,          // 60%+ should confirm
      multiPayloadValidation: true,   // Test 3+ payloads per candidate
      contextAwareness: true          // Adapt payloads to context
    }
  },

  inherited: {
    programId: 'prog_123',
    rateLimit: 50,                    // 50 req/sec
    timeout: 30,                      // 30 sec per request
    safetyChecks: true,
    budget: {
      maxRequests: 500,               // Total budget
      maxTime: 900                    // 15 minutes
    },
    retryPolicy: {
      maxRetries: 2,
      backoff: 'exponential'
    }
  }
});
```

**19 Rich Handoff Workflows**:

1. **Discovery → Fingerprint**: Asset validation → technology detection
2. **Fingerprint → Scanner**: Technology-aware vulnerability scanning
3. **Fingerprint → Crawl**: Endpoint discovery and mapping
4. **Scanner → Triage**: General vulnerability classification
5. **Scanner → XSS**: Reflected/stored XSS deep testing
6. **Scanner → SQLi**: Database injection exploitation
7. **Scanner → SSRF**: Server-side request forgery validation
8. **Scanner → Webvulns**: LFI/RCE/IDOR/XXE testing
9. **Crawl → Jsanalysis**: JavaScript static analysis
10. **Crawl → Apifuzz**: REST/GraphQL API security testing
11. **Crawl → Scanner**: Discovered URLs vulnerability scanning
12. **Jsanalysis → XSS**: DOM sink exploitation
13. **Jsanalysis → Scanner**: Hidden endpoint validation
14. **XSS → Confirm**: Multi-method XSS confirmation
15. **SQLi → Confirm**: Database exploitation validation
16. **SSRF → Confirm**: Multi-protocol SSRF confirmation
17. **Webvulns → Confirm**: High-impact vulnerability validation
18. **Apifuzz → Confirm**: API vulnerability confirmation
19. **Confirm → Intelligent-Triage**: PoC generation and reporting

---

### 3. Shared Memory (Three-Agent Swarm Coordination)

**Purpose**: Real-time finding sharing and technique coordination across swarm

**Architecture**: Redis Pub/Sub + Hash storage

```typescript
// Agent publishes finding to shared memory
await sharedMemory.storeFindings(swarmId, [
  {
    id: 'vuln_456',
    type: 'xss-reflected',
    severity: 'high',
    url: 'https://example.com/search?q=',
    evidence: '<script>alert(1)</script>',
    confidence: 0.9,
    timestamp: new Date(),
    discoveredBy: 'xss-job-789',
    metadata: {
      context: 'search_parameter',
      payload: '<script>alert(1)</script>',
      wafBypassed: true
    }
  }
]);

// Agent shares successful technique
await sharedMemory.shareSuccess(swarmId, {
  id: 'technique_123',
  name: 'waf-bypass-polyglot',
  description: 'Polyglot payload bypassed Cloudflare WAF',
  successRate: 0.85,
  metadata: {
    payload: '<svg/onload=alert(1)>',
    waf: 'cloudflare',
    context: 'html-attribute'
  }
});

// Other agents subscribe and learn
const findings = await sharedMemory.getFindings(swarmId);
const techniques = await sharedMemory.getSuccessfulTechniques(swarmId);
```

**Shared Data Types**:
- **Findings**: Vulnerabilities discovered by any agent
- **Techniques**: Successful exploitation methods
- **Failed Attempts**: Avoid repeating failed approaches
- **Progress Metrics**: Real-time swarm progress tracking

**Three-Agent Architecture**:

```
┌──────────────┐
│   Planner    │ Strategy and high-level decision making
│    Agent     │ - Analyzes target scope
└──────┬───────┘ - Creates attack plan
       │         - Prioritizes agent deployment
       │         - Adapts strategy based on findings
       ↓
┌──────────────┐
│   Executor   │ Swarm deployment and orchestration
│    Agent     │ - Deploys 24 specialized agents
└──────┬───────┘ - Monitors progress via Shared Memory
       │         - Dynamic resource allocation
       │         - Parallel execution coordination
       ↓
┌──────────────┐
│  Researcher  │ Finding validation and research
│    Agent     │ - Validates findings from swarm
└──────────────┘ - Cross-references vulnerabilities
                 - Researches exploitation techniques
                 - Provides feedback to Planner
```

**Communication Flow**:
```
Planner → Executor: Deploy XSS, SQLi, SSRF agents
Executor → Shared Memory: Store agent jobs
Agent 1 (XSS) → Shared Memory: Found XSS on /search
Agent 2 (SQLi) → Shared Memory: Read XSS finding, test /search for SQLi
Agent 3 (SSRF) → Shared Memory: Share WAF bypass technique
Researcher → Shared Memory: Validate all findings
Researcher → Planner: 87% findings valid, recommend IDOR testing
```

---

### 4. Manager Agent (GOD MODE Oversight)

**Purpose**: Omniscient orchestrator with self-healing capabilities

**Capabilities**:

1. **Monitoring**:
   - Listens to ALL BullMQ events (job:created, job:completed, job:failed)
   - Tracks agent health and performance
   - Detects silent failures (jobs stuck, no progress)
   - Monitors resource usage (CPU, memory, queue depth)

2. **Self-Healing**:
   - Restarts failed jobs with adjusted parameters
   - Kills stuck agents and redeploys
   - Adjusts rate limits if rate-limited
   - Reallocates resources to bottlenecked agents
   - Fixes configuration errors automatically

3. **Decision Approval**:
   - Critical decisions require user approval:
     - Deploying destructive tests
     - Accessing production databases
     - Spending budget beyond threshold
     - Changing program scope
   - Non-critical decisions are autonomous

4. **Analytics**:
   - Real-time dashboard metrics
   - Agent utilization tracking
   - Success rate per agent
   - Cost per finding
   - Time to first finding

**Example: Manager Detects & Heals Silent Failure**

```typescript
// Manager detects SQLi agent stuck for 10 minutes
manager.onJobStuck((job) => {
  logger.warn(`Job ${job.id} stuck on agent ${job.agentType}`);

  // Analyze why stuck
  const diagnosis = await manager.diagnoseStuckJob(job);
  // Diagnosis: Rate limited by WAF (429 responses)

  // Self-healing: Retry with lower rate limit
  await manager.retryJobWithFix(job, {
    rateLimit: 10,  // Reduced from 50
    timeout: 60,    // Increased from 30
    retryCount: 1
  });

  logger.info(`Self-healed stuck job ${job.id} with adjusted parameters`);
});

// Manager detects critical decision needed
manager.onCriticalDecision(async (decision) => {
  // decision: "Deploy RCE exploit on production server?"

  if (decision.severity === 'critical') {
    // Require user approval
    await manager.requestUserApproval(decision);
  } else {
    // Auto-approve low-risk decisions
    await manager.approveDecision(decision);
  }
});
```

---

## 🤖 Complete Agent Reference

### Agent Categories

1. **Discovery Agents** (4): Find assets and map attack surface
2. **Scanning Agents** (5): Detect vulnerabilities across attack surface
3. **Exploitation Agents** (7): Deep testing of specific vulnerability types
4. **Validation Agents** (3): Confirm and reduce false positives
5. **Reporting Agents** (2): Generate professional reports and PoCs
6. **Meta Agents** (3): High-level coordination and swarm intelligence

---

### 1. DISCOVERY AGENTS

#### 1.1 Subdomain Agent

**Purpose**: Passive subdomain enumeration using public data sources

**Tools**:
- **subfinder**: Multi-source subdomain discovery (crt.sh, Censys, Shodan, VirusTotal)
- **amass**: OWASP subdomain enumeration with graph database
- **assetfinder**: Fast subdomain discovery from multiple sources

**Process**:
1. Load target domains from program scope
2. Run subfinder with all sources enabled
3. Run amass for additional coverage
4. Deduplicate and merge results
5. Store discovered subdomains in database

**Input**: `['example.com', 'api.example.com']`

**Output**:
```json
{
  "subdomains": [
    "www.example.com",
    "api.example.com",
    "admin.example.com",
    "staging.example.com",
    "dev.example.com",
    "mail.example.com"
  ],
  "sources": {
    "crt.sh": 45,
    "censys": 23,
    "shodan": 12,
    "virustotal": 8
  },
  "total": 150
}
```

**Handoffs**: None (standalone discovery)

**Communication**:
- **BullMQ**: Receives `subdomain` job, publishes results to database
- **Shared Memory**: Publishes discovered subdomains for swarm visibility

**Rate Limits**: API-dependent (respects source rate limits)

**Typical Duration**: 2-5 minutes for 100-500 subdomains

---

#### 1.2 Bruteforce Agent

**Purpose**: Active DNS bruteforce using wordlists and permutations

**Tools**:
- **shuffledns**: Fast DNS bruteforce with wildcard detection
- **massdns**: High-performance DNS resolver (10,000+ queries/sec)
- **alterx**: Subdomain permutation generation

**Process**:
1. Load base domains
2. Generate permutations with alterx (dev-, staging-, -api, -prod, etc.)
3. Load wordlists (SecLists, custom)
4. Run shuffledns + massdns for high-speed resolution
5. Filter wildcards and validate results
6. Store newly discovered subdomains

**Input**: `['example.com']` + wordlist (`~/wordlists/subdomains.txt`)

**Output**:
```json
{
  "newSubdomains": [
    "internal.example.com",
    "vpn.example.com",
    "dev-api.example.com",
    "staging-admin.example.com"
  ],
  "total": 50,
  "wildcardDomains": ["*.cdn.example.com"],
  "permutationsGenerated": 5000,
  "resolved": 50
}
```

**Handoffs**: None (standalone discovery)

**Communication**:
- **BullMQ**: Receives `bruteforce` job
- **Shared Memory**: Publishes brute-forced subdomains

**Rate Limits**: DNS server dependent (10,000 queries/sec with massdns)

**Typical Duration**: 5-15 minutes for 10,000 permutations

---

#### 1.3 Discovery Agent

**Purpose**: Asset validation, HTTP probing, and expansion

**Tools**:
- **httpx**: Fast HTTP/HTTPS probing with tech detection
- **gowitness**: Screenshot capture for all alive URLs
- **mapcidr**: ASN/CIDR expansion for IP range mapping

**Process**:
1. Load subdomains from database
2. HTTP/HTTPS probe all subdomains (httpx)
3. Identify alive URLs with status codes
4. Capture screenshots (gowitness)
5. Map ASN/CIDR ranges for infrastructure mapping
6. Rich handoff to Fingerprint agent with alive URLs

**Input**: 200 subdomains

**Output**:
```json
{
  "aliveURLs": 180,
  "deadURLs": 20,
  "screenshots": "/tmp/screenshots/*.png",
  "httpServices": 150,
  "httpsServices": 30,
  "statusCodes": {
    "200": 120,
    "301": 30,
    "403": 20,
    "404": 10
  },
  "asn": ["AS13335", "AS15169"],
  "ipRanges": ["104.16.0.0/12", "172.217.0.0/16"]
}
```

**Rich Handoff**:
- **→ Fingerprint**: Hands off 180 alive URLs for technology detection

**Communication**:
- **BullMQ**: Receives `discovery` job
- **Rich Handoff**: Creates fingerprint job with full context
- **Shared Memory**: Publishes alive URLs and screenshots

**Rate Limits**: 100 concurrent HTTP probes

**Typical Duration**: 3-10 minutes for 200 subdomains

---

#### 1.4 Fingerprint Agent

**Purpose**: Technology stack detection and framework identification

**Tools**:
- **wappalyzer**: Technology fingerprinting (1,400+ technologies)
- **nuclei**: Fingerprinting templates (CMS, frameworks, versions)
- **httpx**: Header analysis and tech detection

**Process**:
1. Load alive URLs from Discovery agent
2. Run wappalyzer for tech stack identification
3. Run nuclei fingerprinting templates
4. Analyze HTTP headers (Server, X-Powered-By, etc.)
5. Categorize by technology (WordPress, React, Django, etc.)
6. Rich handoff to Scanner (technology-aware scanning)
7. Rich handoff to Crawl (endpoint discovery)

**Input**: 180 alive URLs

**Output**:
```json
{
  "technologies": {
    "cms": ["WordPress 6.2", "Drupal 9.5"],
    "frameworks": ["React 18.2", "Django 4.1", "Ruby on Rails 7.0"],
    "servers": ["nginx 1.21", "Apache 2.4.41"],
    "cdn": ["Cloudflare", "Akamai"],
    "waf": ["Cloudflare WAF"],
    "analytics": ["Google Analytics", "Hotjar"],
    "databases": ["MySQL", "PostgreSQL"]
  },
  "urlsByTech": {
    "WordPress": ["https://blog.example.com"],
    "React": ["https://app.example.com"],
    "Django": ["https://api.example.com"]
  },
  "total": 180
}
```

**Rich Handoffs**:
1. **→ Scanner**: Technology-aware vulnerability scanning
   - Context: WordPress sites → WP-specific CVEs
   - Context: Django sites → Django-specific misconfigs
2. **→ Crawl**: Endpoint discovery on alive URLs

**Communication**:
- **BullMQ**: Receives `fingerprint` job
- **Rich Handoff**: Creates scanner + crawl jobs with tech context
- **Shared Memory**: Publishes technology stack map

**Rate Limits**: 50 req/sec

**Typical Duration**: 5-10 minutes for 180 URLs

---

### 2. SCANNING AGENTS

#### 2.1 Portscan Agent

**Purpose**: Fast port scanning and service detection

**Tools**:
- **naabu**: High-speed port scanner (Go-based)
- **masscan**: Ultra-fast port scanner (1M packets/sec)
- **nmap**: Service version detection and banner grabbing

**Process**:
1. Load IP ranges/hosts from scope
2. Run naabu for top 1000 ports (fast initial scan)
3. Run masscan for full port range (if deep scan enabled)
4. Use nmap for service version detection on open ports
5. Banner grabbing and fingerprinting
6. Store port inventory in database

**Input**: 50 hosts

**Output**:
```json
{
  "totalHosts": 50,
  "openPorts": 234,
  "services": {
    "22": {"service": "ssh", "version": "OpenSSH 8.2"},
    "80": {"service": "http", "version": "nginx 1.21"},
    "443": {"service": "https", "version": "nginx 1.21"},
    "3306": {"service": "mysql", "version": "MySQL 5.7.33"},
    "6379": {"service": "redis", "version": "Redis 6.0.9"},
    "8080": {"service": "http", "version": "Apache Tomcat 9.0"}
  },
  "vulnerableServices": [
    {"port": 6379, "service": "redis", "issue": "No authentication"}
  ]
}
```

**Handoffs**:
- **→ Scanner**: Infrastructure vulnerability scanning

**Communication**:
- **BullMQ**: Receives `portscan` job
- **Shared Memory**: Publishes open ports and services

**Rate Limits**: Configurable (100-10,000 packets/sec)

**Typical Duration**: 1-5 minutes for top 1000 ports, 10-30 min for full range

---

#### 2.2 Scanner Agent

**Purpose**: Comprehensive vulnerability scanning with Nuclei

**Tools**:
- **nuclei**: Template-based vulnerability scanner (5,000+ templates)

**Templates**:
- CVE templates (2,500+)
- Misconfiguration templates
- Exposed panels (admin, debug, phpMyAdmin)
- Default credentials
- Information disclosure
- Custom vulnerability templates

**Process**:
1. Load targets from Fingerprint agent (with tech context)
2. Select appropriate nuclei templates based on technologies
   - WordPress sites → wordpress/ templates
   - Apache → apache/ templates
   - Generic → all templates
3. Run nuclei with high concurrency (500 threads)
4. Parse findings and categorize by severity
5. Group findings by type (XSS, SQLi, SSRF, LFI, etc.)
6. Rich handoff to specialized agents for deep testing
7. Rich handoff to Triage for classification

**Input**: 180 URLs + technology context

**Output**:
```json
{
  "totalFindings": 87,
  "bySeverity": {
    "critical": 3,
    "high": 12,
    "medium": 35,
    "low": 28,
    "info": 9
  },
  "byType": {
    "xss": 23,
    "sqli": 12,
    "ssrf": 8,
    "lfi": 7,
    "rce": 2,
    "idor": 8,
    "misconfiguration": 15,
    "info-disclosure": 12
  },
  "findings": [...]
}
```

**Rich Handoffs** (5 total):
1. **→ Triage**: General vulnerability classification
2. **→ XSS**: 23 XSS candidates for deep testing
3. **→ SQLi**: 12 SQLi candidates for exploitation
4. **→ SSRF**: 8 SSRF candidates for validation
5. **→ Webvulns**: 15 LFI/RCE/IDOR for exploitation

**Communication**:
- **BullMQ**: Receives `scanner` job
- **Rich Handoff**: Creates 5 specialized jobs with categorized findings
- **Shared Memory**: Publishes all findings for swarm visibility

**Rate Limits**: 500 concurrent requests (configurable)

**Typical Duration**: 10-30 minutes for 180 URLs with 5,000 templates

---

#### 2.3 Crawl Agent

**Purpose**: Web application crawling and endpoint discovery

**Tools**:
- **gospider**: Fast web spider with JavaScript rendering
- **katana**: Next-gen crawler with headless support
- **hakrawler**: Simple fast crawler

**Process**:
1. Load seed URLs from Fingerprint
2. Configure crawler (depth, scope, JS rendering)
3. Run gospider + katana for comprehensive coverage
4. Extract discovered URLs, forms, parameters
5. Categorize findings:
   - JavaScript files (.js)
   - API endpoints (/api/, /v1/, /graphql)
   - Forms with inputs
   - Parameters (GET/POST)
6. Rich handoff to Jsanalysis (JS files)
7. Rich handoff to Apifuzz (API endpoints)
8. Rich handoff to Scanner (all discovered URLs)

**Input**: 180 seed URLs

**Output**:
```json
{
  "totalURLs": 2847,
  "forms": 156,
  "parameters": 423,
  "javascriptFiles": 156,
  "apiEndpoints": 43,
  "categorized": {
    "static": 1200,
    "dynamic": 1647,
    "api": 43,
    "forms": 156
  },
  "depth": 5,
  "scope": "*.example.com"
}
```

**Rich Handoffs** (3 total):
1. **→ Jsanalysis**: 156 JavaScript files for static analysis
2. **→ Apifuzz**: 43 API endpoints (REST/GraphQL)
3. **→ Scanner**: 2,847 discovered URLs for vulnerability scanning

**Communication**:
- **BullMQ**: Receives `crawl` job
- **Rich Handoff**: Creates 3 jobs with categorized assets
- **Shared Memory**: Publishes discovered endpoints

**Rate Limits**: 100 concurrent requests

**Typical Duration**: 15-45 minutes depending on site size

---

#### 2.4 Browser Agent

**Purpose**: Headless browser automation for JavaScript-heavy testing

**Tools**:
- **Playwright**: Browser automation (Chromium, Firefox, WebKit)

**Capabilities**:
- XSS confirmation with real browser (alert detection)
- CSRF token validation
- Authentication flow testing
- Video recording for PoC
- Screenshot capture
- Network traffic monitoring
- Cookie/localStorage inspection

**Process**:
1. Load test targets (XSS candidates, auth endpoints)
2. Launch headless browser (Chromium)
3. Enable video recording
4. Navigate to target URL
5. Execute test:
   - XSS: Inject payload, wait for alert()
   - CSRF: Submit form, check token presence
   - Auth: Login flow, check session
6. Capture evidence (screenshot, video, network logs)
7. Return confirmation results

**Input**: 8 XSS candidates from XSS agent

**Output**:
```json
{
  "confirmed": 6,
  "falsePositives": 2,
  "results": [
    {
      "url": "https://example.com/search?q=",
      "testType": "xss",
      "vulnerable": true,
      "payload": "<script>alert(1)</script>",
      "screenshot": "/videos/xss-proof-1.png",
      "video": "/videos/xss-proof-1.webm",
      "alertDetected": true
    }
  ]
}
```

**Handoffs**: None (confirmation agent)

**Communication**:
- **BullMQ**: Receives `browser` job
- **Shared Memory**: Publishes browser-confirmed findings

**Rate Limits**: 5 concurrent browser instances (resource-intensive)

**Typical Duration**: 1-2 minutes per test

---

#### 2.5 Jsanalysis Agent

**Purpose**: JavaScript static analysis for secrets and vulnerabilities

**Tools**:
- **JSParser**: Custom JS parser for structure analysis
- **Regex patterns**: Secret detection (API keys, tokens, passwords)
- **LinkFinder**: Extract endpoints from JavaScript

**Process**:
1. Load JavaScript files from Crawl agent
2. Download and parse each JS file
3. Extract:
   - API endpoints (fetch(), axios(), $.ajax())
   - DOM sinks (innerHTML, eval, location, document.write)
   - Secrets (API keys, tokens, credentials)
   - Comments (may contain sensitive info)
   - Source maps (if available)
4. Categorize dangerous patterns
5. Rich handoff to XSS (DOM sinks)
6. Rich handoff to Scanner (hidden endpoints)

**Input**: 156 JavaScript files

**Output**:
```json
{
  "totalFiles": 156,
  "secretsFound": 7,
  "secrets": [
    {"type": "aws-key", "value": "AKIA...", "file": "app.js:234"},
    {"type": "github-token", "value": "ghp_...", "file": "config.js:12"}
  ],
  "domSinks": [
    {"sink": "innerHTML", "file": "main.js:456", "context": "user input"},
    {"sink": "eval", "file": "analytics.js:89", "context": "dynamic code"}
  ],
  "hiddenEndpoints": [
    "/api/internal/users",
    "/api/admin/reports",
    "/debug/config"
  ],
  "comments": 234,
  "sourceMaps": 12
}
```

**Rich Handoffs** (2 total):
1. **→ XSS**: 23 DOM sinks for exploitation
2. **→ Scanner**: 34 hidden endpoints for validation

**Communication**:
- **BullMQ**: Receives `jsanalysis` job
- **Rich Handoff**: Creates XSS + Scanner jobs
- **Shared Memory**: Publishes secrets and endpoints

**Rate Limits**: 50 file downloads/sec

**Typical Duration**: 5-15 minutes for 156 files

---

### 3. EXPLOITATION AGENTS

#### 3.1 XSS Agent

**Purpose**: Cross-Site Scripting exploitation and validation

**Tools**:
- **dalfox**: Advanced XSS fuzzer with WAF bypass
- **Custom payloads**: Context-aware XSS payloads

**Techniques**:
- Reflected XSS (parameter injection)
- Stored XSS (persistent payloads)
- DOM-based XSS (client-side exploitation)
- Polyglot payloads (multi-context)
- Encoding bypass (HTML entities, Unicode, URL encoding)
- WAF bypass (case variation, tag breaking, event handlers)

**Process**:
1. Load XSS candidates from Scanner/Jsanalysis
2. For each candidate:
   - Identify injection context (HTML, attribute, script, etc.)
   - Select context-appropriate payloads
   - Fuzz with dalfox (50-100 payloads per parameter)
   - Detect XSS confirmation (payload reflection, execution)
3. Categorize by type and severity
4. Rich handoff to Confirm (high-confidence XSS)

**Input**: 23 XSS candidates

**Output**:
```json
{
  "totalCandidates": 23,
  "confirmed": 8,
  "vulnerabilities": [
    {
      "url": "https://example.com/search",
      "parameter": "q",
      "type": "reflected",
      "context": "html",
      "payload": "<script>alert(1)</script>",
      "confidence": 0.95,
      "severity": "high"
    },
    {
      "url": "https://example.com/comment",
      "parameter": "content",
      "type": "stored",
      "context": "html",
      "payload": "<img src=x onerror=alert(1)>",
      "confidence": 0.9,
      "severity": "high",
      "persistence": true
    }
  ]
}
```

**Rich Handoff**:
- **→ Confirm**: 8 high-confidence XSS for multi-method validation

**Communication**:
- **BullMQ**: Receives `xss` job
- **Rich Handoff**: Creates confirm job with XSS findings
- **Shared Memory**: Publishes XSS exploits and WAF bypass techniques

**Rate Limits**: 50 req/sec (WAF-aware, adaptive)

**Typical Duration**: 10-20 minutes for 23 candidates

---

#### 3.2 SQLi Agent

**Purpose**: SQL injection detection and exploitation

**Tools**:
- **sqlmap**: Automated SQL injection exploitation

**Techniques**:
- Error-based SQLi (database errors in response)
- Boolean-based blind SQLi (true/false logic)
- Time-based blind SQLi (sleep/benchmark)
- UNION-based SQLi (data extraction)
- Stacked queries (multi-statement execution)

**Process**:
1. Load SQLi candidates from Scanner
2. For each candidate:
   - Run sqlmap with level 3, risk 2
   - Detect DBMS type (MySQL, PostgreSQL, MSSQL, Oracle)
   - Confirm injection with multiple techniques
   - Extract database information (if confirmed)
3. Categorize by technique and DBMS
4. Rich handoff to Confirm (high-confidence SQLi)

**Input**: 12 SQLi candidates

**Output**:
```json
{
  "totalCandidates": 12,
  "confirmed": 5,
  "vulnerabilities": [
    {
      "url": "https://example.com/product",
      "parameter": "id",
      "technique": "union-based",
      "dbms": "MySQL 5.7.33",
      "confidence": 1.0,
      "severity": "critical",
      "databaseInfo": {
        "currentDB": "shop_db",
        "currentUser": "shop_user@localhost",
        "databases": ["shop_db", "information_schema"],
        "tables": ["users", "orders", "products"]
      },
      "dataExtracted": true
    }
  ]
}
```

**Rich Handoff**:
- **→ Confirm**: 5 high-confidence SQLi for validation

**Communication**:
- **BullMQ**: Receives `sqli` job
- **Rich Handoff**: Creates confirm job with SQLi findings
- **Shared Memory**: Publishes SQLi exploits and database info

**Rate Limits**: 30 req/sec (conservative for database safety)

**Typical Duration**: 20-60 minutes for 12 candidates (sqlmap is thorough)

---

#### 3.3 SSRF Agent

**Purpose**: Server-Side Request Forgery detection and exploitation

**Tools**:
- **ssrfmap**: SSRF exploitation framework
- **Burp Collaborator**: Out-of-band callback detection
- **Custom payloads**: Cloud metadata, internal network probing

**Techniques**:
- Internal IP scanning (10.x.x.x, 192.168.x.x, 169.254.169.254)
- Cloud metadata endpoints (AWS, GCP, Azure)
- Out-of-band callbacks (DNS, HTTP)
- Protocol smuggling (file://, gopher://, dict://)
- URL parser bypass (CRLF injection, @ symbol tricks)

**Process**:
1. Load SSRF candidates from Scanner
2. For each candidate:
   - Test internal IP ranges (169.254.169.254 for AWS metadata)
   - Test cloud metadata endpoints
   - Inject Burp Collaborator URLs for OOB
   - Test protocol smuggling (file://, gopher://)
   - Monitor for callbacks
3. Confirm with OOB interactions
4. Rich handoff to Confirm (OOB-confirmed SSRF)

**Input**: 8 SSRF candidates

**Output**:
```json
{
  "totalCandidates": 8,
  "confirmed": 3,
  "vulnerabilities": [
    {
      "url": "https://example.com/fetch",
      "parameter": "url",
      "type": "ssrf-aws-metadata",
      "confidence": 1.0,
      "severity": "critical",
      "metadataAccessed": {
        "endpoint": "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
        "role": "ec2-admin-role",
        "credentials": "Partial IAM credentials exposed"
      },
      "internalIPsAccessed": ["10.0.1.5", "10.0.1.23"],
      "oobCallback": {
        "dns": "ssrf-test.burpcollaborator.net",
        "http": "https://ssrf-test.burpcollaborator.net",
        "received": true
      }
    }
  ]
}
```

**Rich Handoff**:
- **→ Confirm**: 3 OOB-confirmed SSRF for multi-protocol validation

**Communication**:
- **BullMQ**: Receives `ssrf` job
- **Rich Handoff**: Creates confirm job with SSRF findings
- **Shared Memory**: Publishes SSRF exploits and internal network info

**Rate Limits**: 15 req/sec (conservative for internal network safety)

**Typical Duration**: 15-30 minutes for 8 candidates

---

#### 3.4 Webvulns Agent

**Purpose**: OWASP Top 10 vulnerability testing (LFI, RCE, IDOR, XXE, etc.)

**Tools**:
- **nuclei**: OWASP templates (LFI, RCE, IDOR, XXE)
- **Custom exploits**: Context-specific exploitation

**Vulnerability Types**:
- Local File Inclusion (LFI): /etc/passwd, /etc/hosts, application configs
- Remote Code Execution (RCE): Command injection, code evaluation
- Insecure Direct Object Reference (IDOR): User ID manipulation, file access
- Open Redirect: Phishing vector testing
- XXE (XML External Entity): XML parser exploitation

**Process**:
1. Load candidates from Scanner
2. For each vulnerability type:
   - LFI: Test path traversal (../../../etc/passwd)
   - RCE: Safe command injection (whoami, id, hostname)
   - IDOR: Object ID manipulation (user/1 → user/2)
   - Open Redirect: Test redirect parameters
   - XXE: XML entity injection
3. Confirm exploitation with evidence
4. Rich handoff to Confirm (high-impact vulns)

**Input**: 15 candidates

**Output**:
```json
{
  "totalCandidates": 15,
  "confirmed": 11,
  "vulnerabilities": [
    {
      "type": "lfi",
      "url": "https://example.com/download",
      "parameter": "file",
      "payload": "../../../../etc/passwd",
      "fileRead": "root:x:0:0:root:/root:/bin/bash\n...",
      "confidence": 1.0,
      "severity": "high"
    },
    {
      "type": "rce",
      "url": "https://example.com/ping",
      "parameter": "host",
      "payload": "127.0.0.1; whoami",
      "commandOutput": "www-data",
      "confidence": 1.0,
      "severity": "critical"
    },
    {
      "type": "idor",
      "url": "https://example.com/api/user/123/profile",
      "idManipulated": "124",
      "accessControlBypassed": true,
      "unauthorizedDataAccessed": {"email": "victim@example.com"},
      "confidence": 0.95,
      "severity": "high"
    }
  ]
}
```

**Rich Handoff**:
- **→ Confirm**: 11 high-impact vulnerabilities for validation

**Communication**:
- **BullMQ**: Receives `webvulns` job
- **Rich Handoff**: Creates confirm job with categorized findings
- **Shared Memory**: Publishes exploitation techniques

**Rate Limits**: 30 req/sec

**Typical Duration**: 10-25 minutes for 15 candidates

---

#### 3.5 Apifuzz Agent

**Purpose**: REST/GraphQL API security testing

**Tools**:
- **nuclei**: API fuzzing templates
- **ffuf**: Fast web fuzzer for parameter discovery

**Vulnerability Types**:
- Authentication bypass (JWT manipulation, broken auth)
- IDOR/BOLA (Broken Object Level Authorization)
- GraphQL introspection (schema disclosure)
- Mass assignment (parameter pollution)
- Rate limiting bypass
- API versioning issues (/v1/ vs /v2/)

**Process**:
1. Load API endpoints from Crawl
2. Identify API type (REST vs GraphQL)
3. For REST APIs:
   - Fuzz parameters with nuclei
   - Test authentication bypass
   - Test IDOR on object IDs
   - Test rate limiting
4. For GraphQL:
   - Introspection query
   - Mutation abuse testing
   - Nested query limits
5. Rich handoff to Confirm (high-severity API vulns)

**Input**: 43 API endpoints (REST + GraphQL)

**Output**:
```json
{
  "totalEndpoints": 43,
  "apiType": {
    "rest": 38,
    "graphql": 5
  },
  "vulnerabilities": [
    {
      "endpoint": "https://api.example.com/v1/users/{id}",
      "type": "idor",
      "method": "GET",
      "authBypass": false,
      "idorConfirmed": true,
      "evidence": "User ID 123 → 124 access control bypassed",
      "confidence": 0.9,
      "severity": "high"
    },
    {
      "endpoint": "https://api.example.com/graphql",
      "type": "graphql-introspection",
      "introspectionEnabled": true,
      "schemaExposed": true,
      "mutations": ["createUser", "deleteUser", "updatePassword"],
      "confidence": 1.0,
      "severity": "medium"
    }
  ]
}
```

**Rich Handoff**:
- **→ Confirm**: 6 high-severity API vulnerabilities

**Communication**:
- **BullMQ**: Receives `apifuzz` job
- **Rich Handoff**: Creates confirm job with API findings
- **Shared Memory**: Publishes API vulnerabilities and bypass techniques

**Rate Limits**: 30 req/sec (adaptive for auth bypass testing)

**Typical Duration**: 15-30 minutes for 43 endpoints

---

#### 3.6 OSINT Agent

**Purpose**: Open-Source Intelligence gathering

**Tools**:
- **h8mail**: Email leak searches (Dehashed, Hunter.io, HIBP)
- **github-search**: GitHub secret scanning
- **theHarvester**: Email and subdomain gathering
- **metafinder**: Document metadata extraction
- **spoofcheck**: Email spoofing validation

**Process**:
1. Load target domain
2. Email leak searches (h8mail with Dehashed)
3. GitHub repository and secret scanning
4. Google dorking for sensitive files
5. Microsoft 365/Azure tenant mapping
6. Document metadata extraction (PDF, DOCX)
7. Email spoofing check (SPF, DMARC, DKIM)

**Input**: `example.com`

**Output**:
```json
{
  "emails": [
    {"email": "admin@example.com", "source": "hunter.io"},
    {"email": "dev@example.com", "source": "github"}
  ],
  "credentials": [
    {
      "email": "admin@example.com",
      "password": "hashed_password",
      "breach": "Collection #1",
      "source": "dehashed"
    }
  ],
  "githubRepos": ["example/internal-tools", "example/api-client"],
  "githubSecrets": [
    {
      "repo": "example/api-client",
      "file": "config.js",
      "type": "aws-key",
      "match": "AKIA..."
    }
  ],
  "metadata": [
    {
      "file": "financial-report-2023.pdf",
      "author": "John Doe",
      "creator": "Microsoft Word",
      "keywords": ["confidential", "internal"]
    }
  ],
  "microsoft": {
    "tenant": "example.onmicrosoft.com",
    "domains": ["example.com"],
    "services": ["Exchange Online", "SharePoint"]
  },
  "spoofable": {
    "canSpoof": true,
    "details": "SPF record allows all IPs (v=spf1 +all)"
  }
}
```

**Handoffs**: None (intelligence gathering)

**Communication**:
- **BullMQ**: Receives `osint` job
- **Shared Memory**: Publishes OSINT findings

**Rate Limits**: API-dependent

**Typical Duration**: 10-20 minutes

---

#### 3.7 Cloudmisconfig Agent

**Purpose**: Cloud storage misconfiguration detection

**Tools**:
- **Cloud_enum**: S3/Azure/GCP bucket enumeration
- **s3scanner**: S3 bucket permission testing
- **Custom scripts**: Multi-cloud testing

**Cloud Providers**:
- AWS S3
- Azure Blob Storage
- Google Cloud Storage (GCP)
- DigitalOcean Spaces
- Cloudflare R2

**Process**:
1. Generate bucket name permutations (company name, keywords)
2. Enumerate buckets across cloud providers
3. Test bucket permissions:
   - Public read (list files)
   - Public write (upload test file)
   - Versioning enabled
   - Encryption status
4. Download sample files from public buckets
5. Report misconfigurations

**Input**: `example` + keywords `['prod', 'backup', 'data']`

**Output**:
```json
{
  "s3Buckets": [
    {
      "name": "example-prod-backups",
      "url": "https://example-prod-backups.s3.amazonaws.com",
      "region": "us-east-1",
      "exists": true,
      "publicRead": true,
      "publicWrite": false,
      "listable": true,
      "files": 234,
      "sampleFiles": ["database-backup-2023.sql", "customer-data.csv"],
      "severity": "critical"
    }
  ],
  "azureBlobs": [],
  "gcpBuckets": [],
  "statistics": {
    "totalBucketsFound": 8,
    "publicBuckets": 3,
    "writableBuckets": 1
  }
}
```

**Handoffs**: None (misconfiguration detection)

**Communication**:
- **BullMQ**: Receives `cloudmisconfig` job
- **Shared Memory**: Publishes cloud misconfigurations

**Rate Limits**: Cloud provider dependent

**Typical Duration**: 5-15 minutes for 100 permutations

---

### 4. VALIDATION AGENTS

#### 4.1 Confirm Agent

**Purpose**: Multi-method vulnerability confirmation to reduce false positives

**Confirmation Methods by Vulnerability Type**:

**XSS Confirmation**:
- Test 3+ different payloads
- Validate in multiple browsers (if Browser agent available)
- Check context (HTML, attribute, script)
- Verify encoding bypass
- Test persistence (for stored XSS)

**SQLi Confirmation**:
- Test with multiple techniques (error, boolean, time, union)
- Validate DBMS fingerprint
- Attempt safe data extraction (database name, version)
- Cross-validate with different SQL syntax

**SSRF Confirmation**:
- Multi-protocol testing (HTTP, DNS, FTP)
- Cloud metadata endpoint access
- Internal IP range validation
- OOB callback confirmation

**LFI Confirmation**:
- Read multiple files (/etc/passwd, /etc/hosts, /proc/self/environ)
- Validate file contents
- Test path traversal depth

**RCE Confirmation**:
- Safe command execution (whoami, id, hostname)
- Output validation
- Multiple command injection techniques

**IDOR Confirmation**:
- Test multiple object IDs
- Validate unauthorized access
- Check access control enforcement

**API Confirmation**:
- Authentication state testing
- Multiple endpoint validation
- PoC generation (curl, Postman, Python)

**Process**:
1. Load findings from specialized agents (XSS, SQLi, SSRF, etc.)
2. For each finding:
   - Select appropriate confirmation methods
   - Execute multi-method validation
   - Calculate confirmation score (0.0-1.0)
   - Gather exploit proof
3. Mark as confirmed or false positive
4. Rich handoff to Intelligent-Triage (confirmed findings)

**Input**: 46 potential vulnerabilities

**Output**:
```json
{
  "totalFindings": 46,
  "confirmed": 30,
  "falsePositives": 16,
  "confirmationRate": 0.65,
  "results": [
    {
      "vulnerabilityId": "xss-123",
      "type": "xss-reflected",
      "confirmed": true,
      "confirmationMethods": ["retry", "multi-payload", "context-validation"],
      "passes": 3,
      "requiredPasses": 2,
      "exploitProof": {
        "payload": "<script>alert(1)</script>",
        "response": "HTTP 200 with payload in HTML",
        "screenshot": "/evidence/xss-123.png"
      },
      "confidence": 0.95
    }
  ]
}
```

**Rich Handoff**:
- **→ Intelligent-Triage**: 30 confirmed vulnerabilities for PoC generation and reporting

**Communication**:
- **BullMQ**: Receives `confirm` job
- **Rich Handoff**: Creates intelligent-triage job
- **Shared Memory**: Publishes confirmation results

**Rate Limits**: Varies by vulnerability type (10-50 req/sec)

**Typical Duration**: 20-40 minutes for 46 findings

---

#### 4.2 Interact Agent

**Purpose**: Out-of-band interaction monitoring for blind vulnerabilities

**Tools**:
- **Interactsh**: OOB interaction server (self-hosted or cloud)
- **Burp Collaborator**: Alternative OOB service

**Use Cases**:
- Blind SSRF detection (no direct response)
- Blind RCE detection (command execution with no output)
- Blind XXE exploitation
- DNS exfiltration
- Time-based validation

**Process**:
1. Generate unique OOB URLs (DNS + HTTP)
2. Inject payloads with OOB URLs into test targets
3. Poll Interactsh server for interactions
4. Match interactions to original payloads
5. Confirm blind vulnerabilities

**Input**: Blind vulnerability candidates

**Output**:
```json
{
  "interactions": [
    {
      "id": "abc123",
      "protocol": "dns",
      "uniqueId": "vuln-test-123",
      "fullId": "vuln-test-123.interactsh.com",
      "remoteAddress": "203.0.113.45",
      "timestamp": "2023-06-15T10:30:45Z",
      "rawRequest": "DNS query for vuln-test-123.interactsh.com",
      "vulnerabilityConfirmed": true
    }
  ]
}
```

**Handoffs**: None (validation agent)

**Communication**:
- **BullMQ**: Receives `interact` job
- **Shared Memory**: Publishes OOB confirmations

**Rate Limits**: N/A (passive monitoring)

**Typical Duration**: Configurable (5-30 minutes polling)

---

#### 4.3 Triage Agent (Legacy)

**Purpose**: AI-powered vulnerability classification and false positive filtering

**LLM**: Claude AI (Anthropic)

**Process**:
1. Load raw findings from Scanner
2. For each finding:
   - Send to Claude AI for analysis
   - Prompt: "Is this a true positive? Assess severity. Generate PoC."
   - Parse AI response
3. Normalize to Finding schema
4. Assign severity (critical, high, medium, low)
5. Calculate confidence score
6. Generate PoC draft
7. Suggest confirmation steps

**Input**: 87 scanner findings

**Output**:
```json
{
  "findings": [
    {
      "id": "finding-123",
      "type": "xss-reflected",
      "url": "https://example.com/search",
      "severity": "high",
      "confidence": 0.85,
      "truePositive": true,
      "aiAnalysis": "Reflected XSS confirmed in search parameter. User input is reflected without sanitization in HTML context.",
      "pocDraft": "curl 'https://example.com/search?q=<script>alert(1)</script>'",
      "confirmationSteps": [
        "Test with multiple XSS payloads",
        "Validate in browser",
        "Check WAF bypass techniques"
      ]
    }
  ]
}
```

**Handoffs**: None (classification only)

**Communication**:
- **BullMQ**: Receives `triage` job
- **Shared Memory**: Publishes triaged findings

**Rate Limits**: LLM API limits (10-50 req/min)

**Typical Duration**: 10-30 minutes for 87 findings

---

### 5. REPORTING AGENTS

#### 5.1 Intelligent-Triage Agent

**Purpose**: LLM-enhanced PoC generation and professional bug bounty reporting

**LLM**: Claude AI (Anthropic) with enhanced capabilities

**Process**:
1. Load confirmed findings from Confirm agent
2. For each confirmed vulnerability:
   - **LLM Analysis**:
     - Deep exploitability assessment
     - Real-world attack scenario generation
     - Business impact analysis (data breach, account takeover, financial loss)
   - **CVSS v3.1 Scoring**:
     - Calculate all CVSS metrics
     - Generate severity rating
   - **PoC Generation**:
     - Multiple formats (curl, Python, Burp Suite, Postman)
     - Step-by-step reproduction instructions
     - Video evidence integration (if available)
   - **Bug Bounty Report Creation**:
     - Executive summary
     - Technical details
     - Reproduction steps
     - Impact analysis
     - Remediation recommendations
     - References (CWE, OWASP, CVE)

**Input**: 30 confirmed vulnerabilities

**Output**:
```json
{
  "reports": [
    {
      "id": "report-123",
      "vulnerability": {
        "type": "sql-injection",
        "url": "https://example.com/product?id=1",
        "severity": "critical",
        "cvss": {
          "score": 9.8,
          "vector": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H",
          "breakdown": {
            "attackVector": "Network",
            "attackComplexity": "Low",
            "privilegesRequired": "None",
            "userInteraction": "None",
            "scope": "Unchanged",
            "confidentialityImpact": "High",
            "integrityImpact": "High",
            "availabilityImpact": "High"
          }
        }
      },
      "executiveSummary": "A critical SQL injection vulnerability allows unauthenticated attackers to extract the entire database, including 50,000 customer records with PII.",
      "technicalDetails": "The 'id' parameter in /product is vulnerable to UNION-based SQL injection. The application uses MySQL 5.7.33 and the database user has excessive privileges.",
      "poc": {
        "curl": "curl 'https://example.com/product?id=1%27%20UNION%20SELECT%201,2,3,4,5,6,7,8--'",
        "python": "import requests\nr = requests.get('https://example.com/product', params={'id': \"1' UNION SELECT 1,2,3,4,5,6,7,8--\"})\nprint(r.text)",
        "burp": "GET /product?id=1' UNION SELECT 1,2,3,4,5,6,7,8-- HTTP/1.1\nHost: example.com\n..."
      },
      "reproductionSteps": [
        "1. Navigate to https://example.com/product?id=1",
        "2. Inject payload: ?id=1' UNION SELECT 1,2,3,4,5,6,7,8--",
        "3. Observe database column count (8 columns)",
        "4. Extract data: ?id=1' UNION SELECT 1,username,password,email,5,6,7,8 FROM users--",
        "5. Verify database extraction in response"
      ],
      "impact": "An attacker can extract the entire database, including:\n- 50,000 customer records with PII\n- Admin credentials\n- Payment information\n- Internal business data\n\nThis could result in:\n- GDPR violations ($20M+ fine)\n- Customer data breach lawsuits\n- Reputational damage\n- Account takeover of all users",
      "remediation": [
        "Use parameterized queries (prepared statements)",
        "Implement input validation and sanitization",
        "Apply principle of least privilege to database user",
        "Enable WAF with SQL injection rules",
        "Implement database activity monitoring"
      ],
      "references": [
        "CWE-89: SQL Injection",
        "OWASP Top 10 2021: A03 Injection",
        "OWASP SQL Injection Prevention Cheat Sheet"
      ],
      "estimatedBounty": "$5,000 - $15,000"
    }
  ]
}
```

**Handoffs**: None (final reporting stage)

**Communication**:
- **BullMQ**: Receives `intelligent-triage` job
- **Database**: Stores professional reports
- **Events**: Publishes report completion

**Rate Limits**: LLM API limits

**Typical Duration**: 30-60 minutes for 30 vulnerabilities

---

#### 5.2 Autonomous-Scanner Agent

**Purpose**: Self-contained autonomous scanning workflow (legacy/experimental)

**Capabilities**:
- Combines discovery + scanning + triage in one agent
- Useful for quick scans
- Less sophisticated than full pipeline

**Process**:
1. Subdomain discovery
2. HTTP probing
3. Nuclei scanning
4. AI triage
5. Report generation

**Handoffs**: None (autonomous workflow)

---

### 6. PHASE 2 ADVANCED SECURITY AGENTS

Phase 2 introduces 18 specialized agents targeting modern web technologies, cloud platforms, and emerging attack vectors.

#### 6.1 Prompt Injection Agent ⚡ NEW

**Purpose**: AI/LLM security testing - prompt injection, jailbreaking, and data exfiltration

**Attack Categories** (35 payloads across 8 categories):
- **Direct Injection**: Instruction ignore, delimiter confusion, role reversal
- **System Prompt Extraction**: Direct requests, encoding tricks, summarization
- **Jailbreaking**: DAN, developer mode, refusal suppression, adversarial suffixes
- **Data Exfiltration**: Training data, PII, API keys, RAG content
- **Indirect Injection**: Document-based, email context, multi-turn hijacking
- **Advanced Techniques**: Unicode obfuscation, Base64/ROT13 encoding
- **Context Poisoning**: Fake system tags, conversation reset
- **Tool Abuse**: Plugin/function exploitation

**LLM Endpoint Discovery**:
- Tests 16+ common API paths (`/api/chat`, `/v1/chat/completions`, `/assistant`)
- Crawls for AI-powered forms and features
- Detects WebSocket real-time chat connections

**Model Fingerprinting**:
- Identifies: GPT-4, GPT-3.5, Claude, Gemini, LLaMA
- Detects system prompt presence, RAG capabilities, tool usage

**Intelligent Analysis**:
- Category-specific success detection
- Evidence collection (prompt leaked, jailbreak successful, data exfiltrated)
- CVSS scoring (5.2 - 10.0)
- Comprehensive remediation guidance

**Process**:
1. Discover LLM endpoints via path testing and crawling
2. Fingerprint AI model and detect capabilities
3. Test 35 injection payloads across 8 categories
4. Analyze responses with AI-powered detection
5. Rich handoff to Triage (critical findings)

**Targets**: ChatGPT integrations, Claude applications, RAG systems, AI chatbots, code generation tools

**Rate Limits**: 30 req/sec (API-aware)

**Typical Duration**: 15-30 minutes per endpoint

---

#### 6.2 GraphQL Agent

**Purpose**: GraphQL API exploitation - introspection, batching attacks, authorization bypass

**Techniques**:
- Schema introspection and enumeration
- Field suggestion attacks
- Query batching and aliasing
- Circular query DoS
- Authorization bypass via field-level access
- Subscription hijacking

**Process**:
1. Detect GraphQL endpoints (`/graphql`, `/api/graphql`, `/v1/graphql`)
2. Attempt introspection query
3. Enumerate queries, mutations, subscriptions
4. Test authorization on all fields
5. Batch attack testing (100+ aliases)
6. Rich handoff to Confirm (high-confidence findings)

---

#### 6.3 Other Phase 2 Agents

**Authentication & Authorization**:
- **AuthBypass Agent**: JWT manipulation, OAuth flows, session fixation, MFA bypass
- **CORS Agent**: Misconfiguration detection, credential exposure
- **CSRF Agent**: Token prediction, bypass techniques

**API & Modern Web**:
- **GRPC Agent**: Reflection abuse, metadata injection, streaming attacks
- **WebSocket Agent**: CSWSH, message injection, origin bypass
- **APIVersioning Agent**: Deprecated version enumeration, version-specific exploits

**Injection & Code Execution**:
- **TemplateInjection Agent**: SSTI/CSTI across 8 template engines (Jinja2, Twig, Handlebars)
- **XXE Agent**: XML External Entity with OOB exfiltration
- **Deserialization Agent**: Java, Python, PHP, .NET, Node.js gadget chains

**Infrastructure & Cloud**:
- **Serverless Agent**: Lambda/Azure/GCP function exploits, event injection
- **ContainerEscape Agent**: Docker/K8s breakout techniques
- **RaceCondition Agent**: TOCTOU, parallel racing, rate limit bypass

**Intelligence & Supply Chain**:
- **GitLeaks Agent**: 20+ secret patterns across Git history
- **DarkWebIntel Agent**: Breach monitoring, pastebin scanning
- **BrandImpersonation Agent**: Typosquatting (30+ techniques), phishing detection
- **SupplyChain Agent**: Dependency scanning across 8 ecosystems, CVE matching

**Total Phase 2 Coverage**: 18 specialized agents, 500+ attack techniques, modern security landscape

---

### 7. META AGENTS (Three-Agent Architecture)

#### 7.1 Planner Agent

**Purpose**: Strategic planning and attack orchestration

**Capabilities**:
- Analyze target scope and profile
- Create comprehensive attack plan
- Prioritize agent deployment
- Adapt strategy based on findings
- Resource allocation optimization

**Process**:
1. Receive target from user (domain, IP range, etc.)
2. Analyze target profile:
   - Scope size (subdomains, IP ranges)
   - Technologies detected (if available)
   - Budget and time constraints
3. Create attack plan:
   - Phase 1: Discovery (subdomain, bruteforce, discovery, fingerprint)
   - Phase 2: Scanning (portscan, scanner, crawl)
   - Phase 3: Exploitation (XSS, SQLi, SSRF, etc.)
   - Phase 4: Validation (confirm)
   - Phase 5: Reporting (intelligent-triage)
4. Send plan to Executor for deployment
5. Monitor progress and adapt strategy

**Input**: Target scope + constraints

**Output**:
```json
{
  "plan": {
    "target": "example.com",
    "phases": [
      {
        "name": "Discovery",
        "agents": ["subdomain", "bruteforce", "discovery", "fingerprint"],
        "parallelism": 4,
        "estimatedDuration": "15 minutes"
      },
      {
        "name": "Scanning",
        "agents": ["portscan", "scanner", "crawl"],
        "parallelism": 3,
        "estimatedDuration": "30 minutes"
      }
    ],
    "totalEstimatedDuration": "120 minutes",
    "estimatedCost": "$50"
  }
}
```

**Communication**:
- **BullMQ**: Receives `planner` job
- **Shared Memory**: Publishes attack plan
- **Executor**: Sends deployment instructions

---

#### 7.2 Executor Agent

**Purpose**: Swarm deployment and parallel execution

**Capabilities**:
- Deploy multiple agents in parallel
- Monitor agent progress via Shared Memory
- Dynamic resource allocation
- Handle agent failures and retries
- Coordinate handoffs between agents

**Process**:
1. Receive attack plan from Planner
2. Deploy agents according to plan:
   - Phase 1: Deploy discovery agents in parallel
   - Wait for phase completion
   - Phase 2: Deploy scanning agents with phase 1 results
3. Monitor Shared Memory for:
   - Agent progress
   - Findings published
   - Successful techniques
   - Failures
4. Dynamically adjust:
   - Allocate more resources to productive agents
   - Kill unproductive agents
   - Retry failed jobs
5. Send progress updates to Researcher

**Input**: Attack plan from Planner

**Output**:
```json
{
  "swarmId": "swarm-123",
  "agentsDeployed": 18,
  "agentsActive": 12,
  "agentsCompleted": 6,
  "agentsFailed": 0,
  "findingsCollected": 87,
  "progress": "65%"
}
```

**Communication**:
- **BullMQ**: Deploys jobs to all agent queues
- **Shared Memory**: Reads/writes swarm state
- **Researcher**: Sends findings for validation

---

#### 7.3 Researcher Agent

**Purpose**: Finding validation and exploitation research

**Capabilities**:
- Validate findings from swarm
- Cross-reference vulnerabilities
- Research exploitation techniques
- CVE/CWE mapping
- Exploit-DB searches
- Provide feedback to Planner

**Process**:
1. Monitor Shared Memory for new findings
2. For each finding:
   - Validate authenticity
   - Cross-reference with CVE database
   - Search Exploit-DB for known exploits
   - Assess real-world exploitability
3. Provide research back to swarm:
   - "This SQLi is CVE-2023-1234, public exploit available"
   - "XSS in this CMS has known bypass techniques"
4. Send validation report to Planner for strategy adjustment

**Input**: Findings from Shared Memory

**Output**:
```json
{
  "validatedFindings": 75,
  "invalidFindings": 12,
  "cveMatches": [
    {
      "findingId": "vuln-123",
      "cve": "CVE-2023-1234",
      "cvss": 9.8,
      "exploitAvailable": true,
      "exploitDbId": "EDB-51234"
    }
  ],
  "recommendations": [
    "Prioritize SQLi on /admin - known RCE chain available",
    "XSS on main site - similar bypass used in other bug bounties"
  ]
}
```

**Communication**:
- **Shared Memory**: Reads findings
- **External APIs**: CVE database, Exploit-DB
- **Planner**: Sends validation results and recommendations

---

### 7. GOD MODE AGENT

#### 7.1 Manager Agent (Hidden Orchestrator)

**Purpose**: Omniscient oversight, self-healing, and critical decision approval

**Visibility**: Hidden from UI (background orchestrator)

**Monitoring Capabilities**:
- **BullMQ Events**: Listens to ALL queue events
  - `job:created`: Track new jobs
  - `job:active`: Monitor job execution
  - `job:progress`: Track progress updates
  - `job:completed`: Log successes
  - `job:failed`: Detect failures
  - `job:stalled`: Detect stuck jobs
- **Agent Health**: CPU, memory, queue depth per agent
- **Performance Metrics**: Time to completion, success rate, cost per finding
- **Silent Failures**: Jobs with no progress for N minutes

**Self-Healing Capabilities**:

1. **Stuck Job Detection**:
   ```typescript
   // Detect job stuck for 10 minutes
   if (job.lastProgressUpdate < now - 10 minutes) {
     logger.warn(`Job ${job.id} stuck on ${job.agentType}`);

     // Diagnose issue
     const diagnosis = await manager.diagnoseStuckJob(job);
     // Possible diagnoses:
     // - Rate limited (429 responses)
     // - Timeout too short
     // - Memory exhausted
     // - Network connectivity issue

     // Apply fix and retry
     await manager.retryJobWithFix(job, fixes);
   }
   ```

2. **Rate Limit Detection**:
   ```typescript
   // Detect 429 responses
   if (job.errors.includes('429')) {
     logger.warn(`Job ${job.id} rate limited`);

     // Reduce rate limit and retry
     await manager.retryJobWithFix(job, {
       rateLimit: job.rateLimit / 2,
       timeout: job.timeout * 2
     });
   }
   ```

3. **Memory Exhaustion**:
   ```typescript
   // Detect OOM errors
   if (job.errors.includes('out of memory')) {
     logger.error(`Job ${job.id} OOM`);

     // Kill job, increase memory, retry
     await manager.killAndRestart(job, {
       memory: '4GB',  // Increased from 2GB
       concurrency: 50  // Reduced from 100
     });
   }
   ```

4. **Configuration Errors**:
   ```typescript
   // Detect config errors
   if (job.errors.includes('config')) {
     logger.error(`Job ${job.id} config error`);

     // Auto-fix common config issues
     const fixedConfig = await manager.autoFixConfig(job.config);
     await manager.retryJobWithFix(job, { config: fixedConfig });
   }
   ```

**Critical Decision Approval**:

```typescript
// Manager requests user approval for critical decisions
const criticalDecisions = [
  'Deploy RCE exploit on production',
  'Access production database',
  'Spend >$100 on cloud resources',
  'Brute-force authentication (>1000 attempts)',
  'Upload files to target server'
];

manager.onDecision(async (decision) => {
  if (decision.severity === 'critical') {
    // Pause execution, request approval
    const approved = await manager.requestUserApproval({
      title: decision.title,
      description: decision.description,
      risks: decision.risks,
      benefits: decision.benefits,
      estimatedCost: decision.cost
    });

    if (approved) {
      await manager.executeDecision(decision);
    } else {
      await manager.rejectDecision(decision);
    }
  } else {
    // Auto-approve low-risk decisions
    await manager.executeDecision(decision);
  }
});
```

**Analytics & Dashboard**:
```json
{
  "agents": {
    "total": 24,
    "active": 12,
    "idle": 10,
    "failed": 2
  },
  "utilization": {
    "scanner": 0.85,
    "xss": 0.72,
    "sqli": 0.68,
    "crawl": 0.55
  },
  "findings": {
    "total": 87,
    "confirmed": 30,
    "falsePositives": 16,
    "pending": 41
  },
  "performance": {
    "avgTimeToFirstFinding": "12 minutes",
    "costPerFinding": "$1.20",
    "successRate": 0.65
  },
  "health": {
    "stuckJobs": 0,
    "failedJobs": 3,
    "queueDepth": 15,
    "cpuUsage": "45%",
    "memoryUsage": "6.2 GB / 16 GB"
  }
}
```

**Communication**:
- **BullMQ Events**: Listens to all queues
- **Database**: Stores analytics and metrics
- **UI**: Publishes dashboard updates
- **User**: Requests critical decision approval

---

## 🔧 Technology Stack

### Security Tools (100+)

**Subdomain Discovery**:
- subfinder, amass, assetfinder, findomain

**DNS Tools**:
- shuffledns, massdns, puredns, dnsx

**HTTP Tools**:
- httpx, gospider, katana, hakrawler, gowitness

**Vulnerability Scanners**:
- nuclei (5,000+ templates)
- sqlmap (SQL injection)
- dalfox (XSS fuzzing)
- ssrfmap (SSRF exploitation)

**Port Scanners**:
- naabu, masscan, nmap

**Fuzzing**:
- ffuf, wfuzz, gobuster

**JavaScript Analysis**:
- LinkFinder, JSParser, retire.js

**OSINT**:
- h8mail, theHarvester, github-search, shodan

**Cloud Tools**:
- cloud_enum, s3scanner, CloudBrute

**Browser Automation**:
- Playwright (Chromium, Firefox, WebKit)

**OOB Tools**:
- Interactsh, Burp Collaborator

### Backend Technologies

**Runtime**: Node.js + TypeScript

**Job Queue**: BullMQ (Redis-backed)

**Database**: PostgreSQL (findings, programs, jobs)

**Cache**: Redis (shared memory, job queue)

**Storage**: AWS S3 (screenshots, videos, evidence)

**AI/LLM**: Claude AI (Anthropic) via API

**Observability**: OpenTelemetry (tracing, metrics)

**Logging**: Winston (structured logging)

---

## 🎯 Complete Workflow Example

Let's trace a complete end-to-end workflow for `example.com`:

### User Input
```bash
Target: example.com
Scope: *.example.com
Budget: $100
Duration: 4 hours
```

### Manager Agent: Initial Setup
```
1. Validates scope: *.example.com
2. Creates bug bounty program in database (programId: prog_123)
3. Initializes monitoring dashboards
4. Creates initial discovery job
```

### Phase 1: Discovery (0-15 min)

**Subdomain Agent** (0-3 min):
```
- Input: example.com
- Tools: subfinder, amass
- Output: 150 subdomains discovered
- Shared Memory: Published subdomains
```

**Bruteforce Agent** (3-8 min):
```
- Input: example.com + wordlist
- Tools: shuffledns + massdns
- Output: +50 subdomains (total: 200)
- Shared Memory: Published brute-forced subdomains
```

**Discovery Agent** (8-12 min):
```
- Input: 200 subdomains
- Tools: httpx, gowitness
- Output: 180 alive URLs, screenshots
- Rich Handoff → Fingerprint: 180 URLs
```

**Fingerprint Agent** (12-18 min):
```
- Input: 180 URLs (from Discovery)
- Tools: wappalyzer, nuclei fingerprinting
- Output: Technology map (WordPress, React, Django, etc.)
- Rich Handoff → Scanner: 180 URLs + tech context
- Rich Handoff → Crawl: 180 URLs for endpoint discovery
```

### Phase 2: Scanning (15-45 min)

**Portscan Agent** (15-20 min, parallel):
```
- Input: 50 hosts
- Tools: naabu
- Output: 234 open ports
```

**Scanner Agent** (18-35 min):
```
- Input: 180 URLs + tech context (from Fingerprint)
- Tools: nuclei (5,000 templates)
- Output: 87 findings
  - 23 XSS candidates
  - 12 SQLi candidates
  - 8 SSRF candidates
  - 15 LFI/RCE/IDOR candidates
  - 29 misconfigs/info disclosure
- Rich Handoff → XSS: 23 candidates
- Rich Handoff → SQLi: 12 candidates
- Rich Handoff → SSRF: 8 candidates
- Rich Handoff → Webvulns: 15 candidates
- Rich Handoff → Triage: 87 findings for classification
```

**Crawl Agent** (18-50 min, parallel):
```
- Input: 180 URLs (from Fingerprint)
- Tools: gospider, katana
- Output: 2,847 URLs, 156 JS files, 43 API endpoints
- Rich Handoff → Jsanalysis: 156 JS files
- Rich Handoff → Apifuzz: 43 API endpoints
- Rich Handoff → Scanner: 2,847 discovered URLs
```

### Phase 3: Deep Analysis (30-90 min)

**Jsanalysis Agent** (30-45 min):
```
- Input: 156 JS files (from Crawl)
- Tools: JSParser, regex
- Output:
  - 23 DOM sinks
  - 7 leaked API keys
  - 34 hidden endpoints
- Rich Handoff → XSS: 23 DOM sinks
- Rich Handoff → Scanner: 34 hidden endpoints
- Shared Memory: Published 7 leaked credentials (CRITICAL)
```

**Manager Alert**:
```
🚨 CRITICAL: 7 API keys leaked in JavaScript!
- AWS key: AKIA... (Severity: CRITICAL)
- GitHub token: ghp_... (Severity: HIGH)
- Requesting user approval to test these credentials...
```

### Phase 4: Exploitation (45-120 min, parallel)

**XSS Agent** (35-55 min):
```
- Input: 23 candidates from Scanner + 23 DOM sinks from Jsanalysis (46 total)
- Tools: dalfox
- Output: 8 confirmed XSS
  - 3 stored XSS (high)
  - 2 reflected XSS (medium)
  - 3 DOM-based XSS (medium)
- Rich Handoff → Confirm: 8 high-confidence XSS
- Shared Memory: Published XSS exploits + WAF bypass techniques
```

**SQLi Agent** (35-75 min):
```
- Input: 12 candidates (from Scanner)
- Tools: sqlmap
- Output: 5 confirmed SQLi
  - 2 UNION-based (critical)
  - 2 Boolean-based blind (high)
  - 1 Time-based blind (medium)
- Rich Handoff → Confirm: 5 high-confidence SQLi
- Shared Memory: Published database info (MySQL 5.7, databases enumerated)
```

**SSRF Agent** (35-60 min):
```
- Input: 8 candidates (from Scanner)
- Tools: ssrfmap, Burp Collaborator
- Output: 3 confirmed SSRF
  - 1 AWS metadata access (critical)
  - 1 internal network access (high)
  - 1 DNS exfiltration (medium)
- Rich Handoff → Confirm: 3 OOB-confirmed SSRF
```

**Webvulns Agent** (35-60 min):
```
- Input: 15 candidates (from Scanner)
- Tools: nuclei OWASP templates
- Output: 11 confirmed vulnerabilities
  - 4 LFI (high)
  - 2 RCE (critical)
  - 3 IDOR (high)
  - 2 Open Redirect (medium)
- Rich Handoff → Confirm: 11 high-impact vulns
```

**Apifuzz Agent** (50-80 min):
```
- Input: 43 API endpoints (from Crawl)
- Tools: nuclei API templates, ffuf
- Output: 6 API vulnerabilities
  - 2 authentication bypass (critical)
  - 3 IDOR/BOLA (high)
  - 1 GraphQL introspection (medium)
- Rich Handoff → Confirm: 6 high-severity API vulns
```

**OSINT Agent** (45-65 min, parallel):
```
- Input: example.com
- Tools: h8mail, github-search, theHarvester
- Output:
  - 47 employee emails
  - 12 leaked credentials from breaches
  - 3 API keys in GitHub (already found by Jsanalysis)
  - Azure tenant mapped
```

**Cloudmisconfig Agent** (45-60 min, parallel):
```
- Input: example + keywords
- Tools: cloud_enum, s3scanner
- Output: 8 S3 buckets found
  - 3 publicly accessible (critical)
  - 1 writable (critical)
  - Contains: backup files, customer data
```

### Phase 5: Confirmation (75-140 min)

**Confirm Agent** (75-115 min):
```
- Input: 33 findings from specialized agents
  - 8 XSS
  - 5 SQLi
  - 3 SSRF
  - 11 Webvulns
  - 6 API vulns
- Multi-method validation per vulnerability type
- Output: 30 confirmed (65% confirmation rate)
  - 16 rejected as false positives
- Rich Handoff → Intelligent-Triage: 30 confirmed vulns
```

### Phase 6: Reporting (115-180 min)

**Intelligent-Triage Agent** (115-175 min):
```
- Input: 30 confirmed vulnerabilities (from Confirm)
- LLM: Claude AI
- Processing per vulnerability:
  1. Exploitability assessment
  2. CVSS v3.1 scoring
  3. PoC generation (curl, Python, Burp)
  4. Bug bounty report creation
  5. Remediation recommendations

- Output: 30 professional bug bounty reports
  - 3 Critical (CVSS 9.0-10.0): AWS metadata SSRF, RCE x2
  - 12 High (CVSS 7.0-8.9): SQLi x2, IDOR x3, LFI x4, Auth bypass x2, Stored XSS x1
  - 11 Medium (CVSS 4.0-6.9): XSS x5, SSRF x1, API vulns x3, Open Redirect x2
  - 4 Low (CVSS 0.1-3.9): Info disclosure x4

- Estimated Total Bounty: $35,000 - $85,000
  - Critical findings: $15,000 - $50,000
  - High findings: $15,000 - $30,000
  - Medium findings: $3,000 - $5,000
  - Low findings: $500 - $1,000
```

### Manager Agent: Final Summary

```
🎉 SCAN COMPLETE (Total: 3 hours 45 minutes)

📊 Statistics:
- Agents Deployed: 18
- Jobs Executed: 156
- Findings Discovered: 87
- Confirmed Vulnerabilities: 30
- False Positives: 16
- Confirmation Rate: 65%

🔥 Critical Findings (3):
1. AWS Metadata SSRF (CVSS 9.8) - Estimated bounty: $10,000-$20,000
2. RCE via Command Injection (CVSS 9.6) - Estimated bounty: $8,000-$15,000
3. SQL Injection with Database Access (CVSS 9.3) - Estimated bounty: $5,000-$12,000

⚠️ High Findings (12):
- SQL Injection x2
- IDOR x3
- LFI x4
- Auth Bypass x2
- Stored XSS x1

📝 Reports: 30 professional bug bounty reports generated
💰 Estimated Total Bounty: $35,000 - $85,000
💵 Cost: $47.32 (under budget)
⏱️ Duration: 3h 45m (under 4h limit)

🎯 Next Steps:
1. Review 30 reports in dashboard
2. Submit to bug bounty program
3. Track bounty payouts
```

---

## 🔐 Security & Safety

### Built-in Safety Mechanisms

1. **Rate Limiting**: All agents respect configurable rate limits
2. **Scope Validation**: Never test outside defined scope
3. **Safe Exploitation**: RCE uses safe commands only (whoami, id)
4. **Approval Workflow**: Critical decisions require user approval
5. **Budget Limits**: Stop execution when budget exhausted
6. **Time Limits**: Respect duration constraints
7. **Sandboxing**: Tool execution in isolated environments

### Ethical Considerations

- **Authorization Required**: Only test authorized targets
- **No Destructive Actions**: Avoid data deletion, corruption
- **Responsible Disclosure**: Follow bug bounty program rules
- **Privacy Protection**: Handle leaked credentials responsibly
- **Legal Compliance**: Comply with Computer Fraud and Abuse Act

---

## 📈 Performance & Scalability

### Concurrency

- **BullMQ**: Up to 1,000 concurrent jobs across all queues
- **Agent-Specific**:
  - Scanner: 500 concurrent nuclei threads
  - Crawl: 100 concurrent requests
  - XSS: 50 concurrent dalfox tests
  - SQLi: 30 concurrent sqlmap instances
  - Browser: 5 concurrent browser instances

### Resource Requirements

**Minimum**:
- CPU: 4 cores
- RAM: 8 GB
- Storage: 50 GB
- Network: 100 Mbps

**Recommended** (for 24 agents):
- CPU: 16 cores
- RAM: 32 GB
- Storage: 500 GB SSD
- Network: 1 Gbps

### Horizontal Scaling

- BullMQ supports multiple workers per queue
- Add more workers to scale specific agents
- Redis cluster for shared memory scaling
- PostgreSQL read replicas for database scaling

---

## 🎓 Conclusion

agentHunt is a comprehensive, production-ready bug bounty automation platform with 24 specialized agents working in perfect coordination through Rich Handoffs, Shared Memory, and a Three-Agent Meta Architecture, all overseen by a GOD MODE Manager with self-healing capabilities.

**Key Differentiators**:
1. **Universal Rich Handoffs**: 27 context-preserving workflows
2. **LLM Enhancement**: Claude AI for triage and PoC generation
3. **Self-Healing**: Manager agent detects and fixes failures
4. **Complete Coverage**: From subdomain → PoC → bug bounty report
5. **Professional Output**: Bug bounty reports ready for submission

---

## 🧪 Testing & Validation

### Comprehensive Test Suite

agentHunt includes extensive diagnostic scripts to validate all 27 rich handoff workflows using real test domains.

#### Quick Test (8 Key Handoffs - ~5 minutes)

Fast validation of core handoff workflows:

```bash
cd backend
./test-rich-handoffs-quick.sh
```

**Coverage**:
- Subdomain → Discovery
- Bruteforce → Discovery
- Discovery → Fingerprint/Crawl
- Portscan → Scanner
- OSINT/Cloudmisconfig → Triage

#### Comprehensive Test (All 27 Handoffs - ~30 minutes)

Full validation of all rich handoff workflows:

```bash
cd backend
npx ts-node test-rich-handoffs-comprehensive.ts
```

**Test Domains**: `example.com`, `bugcrowd.com`

**What It Tests**:
1. ✅ **Discovery Phase** (3 handoffs)
2. ✅ **Asset Mapping** (4 handoffs)
3. ✅ **Intelligence Gathering** (2 handoffs)
4. ✅ **Vulnerability Scanning** (9 handoffs)
5. ✅ **Advanced Exploitation** (3 handoffs)
6. ✅ **Validation & Reporting** (6 handoffs)

Each test:
- Creates realistic jobs with test data
- Verifies handoff triggers correctly
- Validates handoff data structure
- Checks job queue for handoff jobs
- Confirms context preservation

#### Full E2E Test

Complete system test including three-agent orchestration:

```bash
cd backend
npx ts-node test-full-workflow.ts
```

### Test Output Example

```
========================================================================
  Test 1: Subdomain → Discovery
========================================================================

ℹ️  Testing: subdomain → discovery
ℹ️  Description: Passive subdomain enumeration → HTTP/HTTPS probing
ℹ️  Job created: abc-123-def
✅ Job completed
✅ Handoff to discovery created! ✨

📊 TEST SUMMARY
ℹ️  Total tests: 27
✅ Passed: 22 (81.5%)
⚠️  Failed/Skipped: 5 (18.5%)
```

### Interpreting Results

**Pass Rate Guidelines**:
- **90-100%**: ✅ Excellent - All handoffs working
- **70-89%**: 🟡 Good - Some agents finding 0 results (expected)
- **50-69%**: 🟠 Fair - Check configurations
- **< 50%**: 🔴 Poor - Investigate backend issues

**Common Reasons for Skipped Handoffs**:
1. Source agent found 0 results (expected with test domains)
2. Handoff trigger thresholds not met
3. Backend running in mock/stub mode

For detailed testing documentation, see [TESTING.md](backend/TESTING.md).

---

**Repository**: https://github.com/catchmeifyoucaan/agentHunt
**License**: MIT
**Author**: agentHunt Team
