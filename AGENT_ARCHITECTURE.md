# AgentHunt - Complete Agent Architecture Documentation

## 🏗️ System Overview

AgentHunt is a fully autonomous bug bounty hunting platform with **85+ specialized agents** that work together through a **Dynamic Handoff Router** to discover, analyze, and report security vulnerabilities.

---

## 📊 Agent Hierarchy

```
┌─────────────────────────────────────────────────────────────────────┐
│                        GOD MODE AGENT                                │
│                   (Full Autonomous Orchestrator)                     │
└─────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MANAGER AGENT                                   │
│              (Human-in-the-loop Coordinator)                         │
└─────────────────────────────────────────────────────────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   DISCOVERY     │    │    SCANNING     │    │   EXPLOITATION  │
│   LAYER         │    │    LAYER        │    │   LAYER         │
└─────────────────┘    └─────────────────┘    └─────────────────┘
           │                       │                       │
           ▼                       ▼                       ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    DYNAMIC HANDOFF ROUTER                            │
│         (Intelligent Signal-Based Multi-Agent Routing)               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Dynamic Handoff Router

The **brain** of the system. Every agent publishes signals, and the router automatically determines which agents should receive them.

### Signal Types (30+)
| Signal | Description | Target Agents |
|--------|-------------|---------------|
| `url_discovered` | New URL found | crawl, fingerprint, scanner, parameter-discovery |
| `parameter_found` | URL parameter detected | xss, sqli, ssrf, templateinjection, intelligent-fuzz |
| `endpoint_found` | API/web endpoint | scanner, webvulns, apifuzz, idor, authbypass |
| `js_file_found` | JavaScript file | jsanalysis, secrethunter, xss |
| `form_found` | HTML form | xss, csrf, sqli, authbypass |
| `api_endpoint` | REST/GraphQL API | apifuzz, idor, authbypass, sqli, ssrf |
| `graphql_endpoint` | GraphQL endpoint | graphql, sqli, idor |
| `websocket_endpoint` | WebSocket | websocket, xss |
| `auth_endpoint` | Login/auth page | authbypass, oauth, jwt-attack, bruteforce |
| `file_upload` | Upload functionality | webvulns, scanner |
| `redirect_found` | URL redirect | xss, ssrf, oauth |
| `dom_sink_found` | DOM XSS sink | xss, browser |
| `reflection_found` | Input reflection | xss, templateinjection, sqli |
| `error_message` | Error disclosure | sqli, templateinjection, lfi |
| `database_error` | SQL error | sqli, scanner |
| `jwt_token` | JWT detected | jwt-attack, authbypass |
| `oauth_flow` | OAuth detected | oauth, authbypass, xss |
| `ssrf_potential` | SSRF indicator | ssrf, scanner |
| `waf_detected` | WAF presence | waf-bypass, payload-engine |
| `subdomain_found` | New subdomain | fingerprint, portscan, subdomain-takeover |

---

## 🎯 Agent Categories

### 1. RECONNAISSANCE AGENTS

#### Discovery Agent (`discovery.ts`)
**Purpose**: Initial attack surface enumeration

**What it does**:
- Runs ChaosDB for known subdomains
- Executes Subfinder for passive subdomain discovery
- Uses Uncover for Shodan/Censys/Fofa integration
- Runs Cloudlist for cloud asset discovery
- Executes Amass for comprehensive enumeration
- Integrates with crt.sh for Certificate Transparency

**Signals Published**:
- `subdomain_found` → fingerprint, portscan, subdomain-takeover
- `url_discovered` → crawl, scanner

**Handoffs To**:
- `fingerprint` (always) - To identify technologies
- `portscan` (if enabled) - To find open ports

**Called By**:
- Manager Agent (initial scan)
- God Mode Agent (autonomous mode)
- Monitoring Agent (continuous monitoring)

---

#### Subdomain Agent (`subdomain.ts`)
**Purpose**: Deep subdomain enumeration

**What it does**:
- Passive DNS resolution
- Subdomain brute-forcing with custom wordlists
- Permutation generation
- DNS record analysis

**Signals Published**:
- `subdomain_found` → fingerprint, portscan

**Handoffs To**:
- `fingerprint` - Technology detection
- `bruteforce` - DNS brute-forcing

---

#### Bruteforce Agent (`bruteforce.ts`)
**Purpose**: DNS subdomain brute-forcing

**What it does**:
- MassDNS for high-speed resolution
- ShuffleDNS for wordlist-based discovery
- Custom wordlist generation
- Wildcard detection

**Signals Published**:
- `subdomain_found` → fingerprint

**Handoffs To**:
- `fingerprint` - For new subdomains

---

#### Fingerprint Agent (`fingerprint.ts`)
**Purpose**: Technology and service detection

**What it does**:
- HTTP fingerprinting with httpx
- Technology detection (Wappalyzer-style)
- WAF detection
- CMS identification
- Server version detection
- SSL/TLS analysis

**Signals Published**:
- `technology_detected` → scanner, templateinjection, deserialization
- `waf_detected` → waf-bypass, payload-engine
- `url_discovered` → crawl

**Handoffs To**:
- `crawl` - For discovered web assets
- `scanner` - For vulnerability scanning
- `waf-bypass` - If WAF detected

---

#### Portscan Agent (`portscan.ts`)
**Purpose**: Network port scanning

**What it does**:
- Nmap TCP/UDP scanning
- Service version detection
- Script scanning
- OS fingerprinting

**Signals Published**:
- `port_open` → scanner, fingerprint
- `service_detected` → webvulns, scanner

**Handoffs To**:
- `scanner` - For web services
- `fingerprint` - For HTTP services

---

#### Crawl Agent (`crawl.ts`)
**Purpose**: Web content discovery

**What it does**:
- Katana for modern JS crawling
- Gospider for traditional crawling
- Hakrawler for endpoint extraction
- Form discovery
- JavaScript file extraction
- API endpoint detection

**Signals Published**:
- `url_discovered` → scanner, parameter-discovery
- `js_file_found` → jsanalysis, secrethunter
- `form_found` → xss, csrf, sqli
- `api_endpoint` → apifuzz, idor
- `parameter_found` → xss, sqli, ssrf

**Handoffs To**:
- `jsanalysis` - For JS files
- `scanner` - For discovered endpoints
- `parameter-discovery` - For URL parameters

---

### 2. SCANNING AGENTS

#### Scanner Agent (`scanner.ts`)
**Purpose**: Core vulnerability scanning with Nuclei

**What it does**:
- Runs Nuclei with 10,000+ templates
- Template tier management (tier0-tier3)
- Concurrent scanning
- Result deduplication
- Severity-based prioritization

**IMPORTANT: Smart Handoff Logic**
Nuclei findings are **CONFIRMED vulnerabilities** - they don't need re-testing!

| Finding Type | Severity | Handoff To | Why |
|--------------|----------|------------|-----|
| Confirmed XSS | critical/high/medium | `triage` | Already confirmed, needs prioritization |
| Confirmed SQLi | critical/high/medium | `triage` | Already confirmed, needs prioritization |
| Reflection detected | info | `xss` | Needs payload testing to confirm XSS |
| DB error message | info | `sqli` | Needs injection testing to confirm SQLi |
| URL parameter | info | `ssrf` | Needs SSRF payload testing |
| Technology detected | info | Dynamic Router | Route to tech-specific agents |

**Signals Published**:
- `vulnerability_potential` → triage (for confirmed vulns)
- `reflection_found` → xss (INFO-level only)
- `error_message` → sqli (INFO-level only)

**Handoffs To**:
- `triage` - For ALL confirmed vulnerabilities (critical/high/medium/low)
- `xss` - Only for INFO-level reflection indicators
- `sqli` - Only for INFO-level database error indicators
- `ssrf` - Only for INFO-level redirect/URL parameter indicators

**Called By**:
- Discovery → Fingerprint → Scanner (standard flow)
- God Mode (autonomous)
- Any agent via Dynamic Router

---

#### WebVulns Agent (`webvulns.ts`)
**Purpose**: Web-specific vulnerability detection

**What it does**:
- File upload testing
- Path traversal
- Information disclosure
- Security header analysis
- Cookie security testing

**Signals Published**:
- `vulnerability_potential` → confirm
- `file_upload` → scanner
- `lfi_potential` → webvulns

**Handoffs To**:
- `confirm` - For verified vulnerabilities
- `triage` - For analysis

---

### 3. INJECTION AGENTS

#### XSS Agent (`xss.ts`)
**Purpose**: Cross-Site Scripting detection

**What it does**:
- Reflected XSS testing
- Stored XSS detection
- DOM XSS analysis
- Context-aware payload generation
- WAF bypass techniques
- Browser-based verification

**Signals Published**:
- `vulnerability_potential` → confirm, triage

**Receives Signals From**:
- `dom_sink_found` (from jsanalysis)
- `reflection_found` (from scanner, crawl)
- `form_found` (from crawl)
- `parameter_found` (from crawl, parameter-discovery)

**Handoffs To**:
- `confirm` - For browser verification
- `browser` - For DOM XSS
- `waf-bypass` - If blocked

---

#### SQLi Agent (`sqli.ts`)
**Purpose**: SQL Injection detection

**What it does**:
- Error-based SQLi
- Blind SQLi (boolean/time-based)
- Union-based SQLi
- SQLMap integration
- Database fingerprinting

**Signals Published**:
- `vulnerability_potential` → confirm
- `database_error` → scanner

**Receives Signals From**:
- `parameter_found`
- `form_found`
- `error_message` (containing SQL keywords)
- `database_error`

**Handoffs To**:
- `confirm` - For exploitation verification
- `triage` - For severity assessment

---

#### SSRF Agent (`SSRFAgent.ts`)
**Purpose**: Server-Side Request Forgery

**What it does**:
- Internal network probing
- Cloud metadata access (169.254.169.254)
- Protocol smuggling (gopher, dict)
- DNS rebinding
- Blind SSRF with Interactsh

**Signals Published**:
- `vulnerability_potential` → confirm
- `cloud_resource` → cloudmisconfig

**Receives Signals From**:
- `ssrf_potential`
- `redirect_found`
- `parameter_found` (with URL values)

**Handoffs To**:
- `confirm` - For verification
- `interactsh` - For OOB detection

---

#### Template Injection Agent (`template-injection.ts`)
**Purpose**: Server-Side Template Injection

**What it does**:
- Jinja2, Twig, Freemarker detection
- Velocity, Thymeleaf testing
- Sandbox escape attempts
- RCE payload generation

**Signals Published**:
- `vulnerability_potential` → confirm
- `rce_potential` → scanner

**Receives Signals From**:
- `template_syntax` ({{, ${, <%, etc.)
- `reflection_found`
- `technology_detected` (template engines)

**Handoffs To**:
- `confirm` - For RCE verification

---

#### XXE Agent (`xxe.ts`)
**Purpose**: XML External Entity Injection

**What it does**:
- File disclosure via XXE
- SSRF via XXE
- Blind XXE with OOB
- Parameter entity attacks

**Signals Published**:
- `vulnerability_potential` → confirm
- `ssrf_potential` → ssrf

**Receives Signals From**:
- `serialized_data` (format: xml)

**Handoffs To**:
- `confirm` - For verification
- `interactsh` - For OOB

---

#### Deserialization Agent (`deserialization.ts`)
**Purpose**: Insecure Deserialization

**What it does**:
- Java deserialization (ysoserial)
- PHP object injection
- Python pickle
- .NET deserialization

**Signals Published**:
- `vulnerability_potential` → confirm
- `rce_potential` → scanner

**Receives Signals From**:
- `serialized_data`
- `technology_detected` (Java, PHP, Python)

**Handoffs To**:
- `confirm` - For RCE verification

---

### 4. AUTHENTICATION AGENTS

#### AuthBypass Agent (`auth-bypass.ts`)
**Purpose**: Authentication bypass testing

**What it does**:
- Default credentials
- Password reset flaws
- Session fixation
- Privilege escalation
- 2FA bypass

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `auth_endpoint`
- `form_found` (with password fields)

**Handoffs To**:
- `confirm` - For verification
- `business-logic` - For logic flaws

---

#### OAuth Agent (`oauth.ts`)
**Purpose**: OAuth/OIDC vulnerability testing

**What it does**:
- redirect_uri manipulation
- State parameter bypass
- Token theft
- Scope escalation
- PKCE bypass

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `oauth_flow`
- `auth_endpoint`
- `redirect_found`

**Handoffs To**:
- `confirm` - For verification
- `xss` - For token theft via XSS

---

#### JWT Attack Agent (`jwt-attack.ts`)
**Purpose**: JWT implementation flaws

**What it does**:
- Algorithm confusion (none, HS256 vs RS256)
- Weak secret brute-force
- Signature stripping
- Claim tampering
- Key confusion attacks

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `jwt_token`
- `auth_endpoint`

**Handoffs To**:
- `confirm` - For verification
- `authbypass` - For account takeover

---

#### IDOR Agent (`idor.ts`)
**Purpose**: Insecure Direct Object Reference

**What it does**:
- Numeric ID enumeration
- UUID prediction
- Horizontal privilege escalation
- Vertical privilege escalation
- Mass assignment testing

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `idor_potential`
- `api_endpoint`
- `parameter_found` (with ID-like values)

**Handoffs To**:
- `confirm` - For verification
- `business-logic` - For logic flaws

---

### 5. FUZZING AGENTS

#### Advanced Fuzzer Agent (`advanced-fuzzer.ts`)
**Purpose**: Intelligent directory/parameter fuzzing with ffuf

**What it does**:
- Technology-aware wordlist selection
- Recursive directory discovery
- Response analysis and pattern detection
- WAF evasion
- Multi-mode fuzzing (dir, param, vhost, api)

**Signals Published**:
- `endpoint_found` → scanner, webvulns
- `auth_endpoint` → authbypass, oauth
- `api_endpoint` → apifuzz, idor
- `sensitive_file` → secrethunter
- `file_upload` → webvulns

**Receives Signals From**:
- `url_discovered`
- `technology_detected`

**Handoffs To**:
- `scanner` - For discovered endpoints
- `jsanalysis` - For JS files
- `secrethunter` - For sensitive files

---

#### Intelligent Fuzz Agent (`intelligent-fuzz.ts`)
**Purpose**: Context-aware parameter fuzzing

**What it does**:
- Target fingerprinting
- Technology-specific wordlists
- Intelligent mutation
- Response diffing
- Anomaly detection

**Signals Published**:
- `parameter_found` → xss, sqli
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `parameter_found`
- `technology_detected`

**Handoffs To**:
- `xss` - For reflection
- `sqli` - For errors
- `confirm` - For anomalies

---

#### API Fuzz Agent (`apifuzz.ts`)
**Purpose**: REST/GraphQL API fuzzing

**What it does**:
- Nuclei API fuzzing templates
- GraphQL introspection
- Parameter pollution
- Mass assignment
- Rate limit testing

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `api_endpoint`
- `graphql_endpoint`

**Handoffs To**:
- `confirm` - For verification
- `idor` - For authorization issues

---

### 6. ADVANCED ATTACK AGENTS

#### Request Smuggling Agent (`request-smuggling.ts`)
**Purpose**: HTTP Request Smuggling

**What it does**:
- CL.TE attacks
- TE.CL attacks
- TE.TE attacks
- HTTP/2 smuggling
- Cache poisoning via smuggling

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `header_found` (Transfer-Encoding)

**Handoffs To**:
- `confirm` - For verification
- `cache-poisoning` - For cache attacks

---

#### Cache Poisoning Agent (`cache-poisoning.ts`)
**Purpose**: Web Cache Poisoning

**What it does**:
- Unkeyed header injection
- Web cache deception
- Parameter cloaking
- Fat GET requests
- Response splitting

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `cache_header`
- `header_found`

**Handoffs To**:
- `confirm` - For verification
- `xss` - For XSS via cache

---

#### Prototype Pollution Agent (`prototype-pollution.ts`)
**Purpose**: JavaScript Prototype Pollution

**What it does**:
- __proto__ injection
- constructor.prototype injection
- Query parameter pollution
- JSON pollution
- RCE via pollution

**Signals Published**:
- `vulnerability_potential` → confirm
- `rce_potential` → scanner

**Receives Signals From**:
- `technology_detected` (Node.js, Express)
- `parameter_found`

**Handoffs To**:
- `confirm` - For verification

---

#### WAF Bypass Agent (`waf-bypass.ts`)
**Purpose**: Web Application Firewall Evasion

**What it does**:
- Encoding bypass (URL, Unicode, HTML)
- Case variation
- Comment injection
- HTTP parameter pollution
- Chunked encoding

**Signals Published**:
- `vulnerability_potential` → original agent

**Receives Signals From**:
- `waf_detected`

**Handoffs To**:
- Original requesting agent with bypass payloads

---

#### Payload Engine Agent (`payload-engine.ts`)
**Purpose**: Self-learning payload generation

**What it does**:
- Learn from successful exploits
- Mutate blocked payloads
- Context-aware generation
- Effectiveness tracking
- Genetic algorithm evolution

**Signals Published**:
- Payloads to requesting agents

**Receives Signals From**:
- `waf_detected`
- Any agent needing payloads

**Handoffs To**:
- Requesting agent with generated payloads

---

### 7. BUSINESS LOGIC AGENTS

#### Business Logic Agent (`business-logic.ts`)
**Purpose**: Business logic flaw detection

**What it does**:
- Payment manipulation
- Race conditions
- Workflow bypass
- Referral abuse
- Coupon stacking

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `rate_limit`
- `auth_endpoint`

**Handoffs To**:
- `confirm` - For verification
- `race-condition` - For timing attacks

---

#### Race Condition Agent (`race-condition.ts`)
**Purpose**: Race condition exploitation

**What it does**:
- Time-of-check to time-of-use (TOCTOU)
- Double-spending
- Limit bypass
- Concurrent request attacks

**Signals Published**:
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `rate_limit`
- From business-logic agent

**Handoffs To**:
- `confirm` - For verification

---

### 8. ANALYSIS AGENTS

#### JS Analysis Agent (`jsanalysis.ts`)
**Purpose**: JavaScript security analysis

**What it does**:
- DOM sink detection
- Source-sink analysis
- Endpoint extraction
- Secret detection
- Prototype pollution detection
- postMessage analysis

**Signals Published**:
- `dom_sink_found` → xss, browser
- `endpoint_found` → scanner, apifuzz
- `secret_found` → secrethunter
- `vulnerability_potential` → confirm

**Receives Signals From**:
- `js_file_found`

**Handoffs To**:
- `xss` - For DOM XSS
- `browser` - For verification
- `secrethunter` - For secrets

---

#### Triage Agent (`triage.ts`)
**Purpose**: AI-powered finding analysis

**What it does**:
- False positive detection
- Severity assessment
- Duplicate detection
- Priority scoring
- Exploit feasibility

**Signals Published**:
- Triaged findings to confirm/report

**Receives Signals From**:
- `vulnerability_potential` (from all agents)

**Handoffs To**:
- `confirm` - For high-confidence findings
- `report-generator` - For verified findings
- `manager` - For human review

---

#### Intelligent Triage Agent (`intelligent-triage-agent.ts`)
**Purpose**: ML-enhanced triage

**What it does**:
- Machine learning classification
- Historical pattern matching
- Confidence scoring
- Auto-discard low confidence

**Handoffs To**:
- `confirm` - For verification
- `manager` - For review

---

#### Confirm Agent (`confirm.ts`)
**Purpose**: Vulnerability verification

**What it does**:
- Exploit reproduction
- PoC generation
- Impact assessment
- Screenshot capture
- Evidence collection

**Signals Published**:
- Confirmed findings to report-generator

**Receives Signals From**:
- `vulnerability_potential` (high confidence)

**Handoffs To**:
- `report-generator` - For confirmed vulns
- `exploit-chain` - For chaining
- `bounty-platform` - For submission

---

### 9. REPORTING AGENTS

#### Report Generator Agent (`report-generator.ts`)
**Purpose**: Professional report generation

**What it does**:
- AI-powered title generation
- Technical details writing
- CVSS calculation
- Reproduction steps
- PoC formatting
- Multi-platform export (HackerOne, Bugcrowd, Markdown)

**Receives From**:
- `confirm` - Verified findings
- `triage` - Triaged findings

**Handoffs To**:
- `bounty-platform` - For submission

---

#### Bounty Platform Agent (`bounty-platform.ts`)
**Purpose**: Bug bounty platform integration

**What it does**:
- HackerOne API integration
- Bugcrowd API integration
- Intigriti API integration
- YesWeHack API integration
- Duplicate checking
- Auto-submission
- Status tracking
- Payment syncing

**Receives From**:
- `report-generator` - Formatted reports

---

#### Bounty Predictor Agent (`bounty-predictor.ts`)
**Purpose**: ML bounty value prediction

**What it does**:
- Historical data analysis
- Severity correlation
- Program generosity scoring
- Priority queue by value
- Prediction accuracy tracking

**Receives From**:
- `triage` - For prioritization

---

### 10. MONITORING AGENTS

#### Monitoring Agent (`monitoring.ts`)
**Purpose**: Continuous attack surface monitoring

**What it does**:
- Certificate transparency monitoring
- Subdomain monitoring
- Port scan monitoring
- GitHub monitoring
- Cloud storage monitoring
- Shodan alerts
- Slack/Discord notifications

**Signals Published**:
- `subdomain_found` → discovery
- `url_discovered` → scanner

**Handoffs To**:
- `discovery` - For new assets
- `scanner` - For new endpoints

---

#### Visual Regression Agent (`visual-regression.ts`)
**Purpose**: Screenshot-based change detection

**What it does**:
- Baseline screenshot creation
- Periodic re-screenshots
- Image diffing
- Change detection
- New endpoint alerts

**Signals Published**:
- `url_discovered` → scanner

**Handoffs To**:
- `scanner` - For new endpoints
- `crawl` - For changed pages

---

### 11. ORCHESTRATION AGENTS

#### God Mode Agent (`god-mode.ts`)
**Purpose**: Fully autonomous bug hunting

**What it does**:
- Reads ALL findings from ALL agents
- Generates custom attack strategies
- Combines vulns into chains
- Predicts high-value bugs
- Auto-prioritizes efforts
- Learns from exploits
- Generates reports
- Submits to platforms

**Controls**:
- ALL other agents
- Dynamic Handoff Router
- Report generation
- Platform submission

---

#### Manager Agent (`manager.ts`)
**Purpose**: Human-in-the-loop coordination

**What it does**:
- Approval workflow for dangerous operations
- Manual review queue
- Escalation handling
- Audit logging
- Team coordination

**Controls**:
- Approval-required operations
- Escalated findings
- Human review items

---

#### Collaboration Agent (`collaboration.ts`)
**Purpose**: Multi-hunter team coordination

**What it does**:
- Shared findings database
- Duplicate prevention
- Task assignment
- Live notifications
- Team dashboard

---

### 12. SPECIALIZED AGENTS

#### Exploit Chain Agent (`exploit-chain.ts`)
**Purpose**: Vulnerability chaining

**What it does**:
- Identifies chainable vulnerabilities
- Generates attack paths
- Validates chains
- Creates combined PoCs
- Calculates chain impact

**Receives From**:
- `confirm` - Verified findings

**Handoffs To**:
- `report-generator` - For chain reports

---

#### Attack Graph Agent (`attack-graph.ts`)
**Purpose**: Visual attack path analysis

**What it does**:
- Builds attack graphs
- Identifies critical paths
- Calculates complexity
- Generates visualizations (DOT, SVG, HTML)

---

#### Nuclei Generator Agent (`nuclei-generator.ts`)
**Purpose**: AI-powered Nuclei template generation

**What it does**:
- Analyzes vulnerability patterns
- Generates custom templates
- Optimizes matchers
- Tests templates
- Reduces false positives

---

### 13. INFRASTRUCTURE AGENTS

#### Cloud Storage Agent (`cloud-storage.ts`)
**Purpose**: Cloud bucket enumeration

**What it does**:
- S3 bucket discovery
- Azure blob enumeration
- GCP bucket scanning
- Permission testing
- Sensitive file detection

**Signals Published**:
- `cloud_resource` → cloudmisconfig
- `sensitive_file` → secrethunter

---

#### Cloud Misconfig Agent (`cloudmisconfig.ts`)
**Purpose**: Cloud misconfiguration detection

**What it does**:
- IAM policy analysis
- Security group review
- Public exposure detection
- Encryption verification

---

#### Container Escape Agent (`container-escape.ts`)
**Purpose**: Container security testing

**What it does**:
- Docker escape techniques
- Kubernetes misconfigs
- Privileged container detection
- Mount abuse

---

#### Serverless Agent (`serverless.ts`)
**Purpose**: Serverless function security

**What it does**:
- Lambda testing
- Azure Functions
- Cloud Functions
- Event injection

---

### 14. OSINT AGENTS

#### OSINT Agent (`osint.ts`)
**Purpose**: Open Source Intelligence

**What it does**:
- Domain WHOIS
- DNS history
- Email harvesting
- Social media discovery
- Breach data checking

---

#### GitHub Secrets Agent (`github-secrets.ts`)
**Purpose**: GitHub secret scanning

**What it does**:
- TruffleHog integration
- GitDorker queries
- Commit history analysis
- Secret pattern matching

**Signals Published**:
- `secret_found` → triage

---

#### GitLeaks Agent (`gitleaks.ts`)
**Purpose**: Git repository secret detection

**What it does**:
- Repository scanning
- Commit history analysis
- Pattern-based detection
- Entropy analysis

---

#### Darkweb Intel Agent (`darkweb-intel.ts`)
**Purpose**: Dark web intelligence

**What it does**:
- Breach monitoring
- Credential leaks
- Threat intelligence
- Brand monitoring

---

---

## 🔗 Signal Flow Examples

### Example 1: Nuclei Confirmed XSS (Direct to Triage)
```
Scanner Agent (Nuclei)
    │ finds CONFIRMED XSS (severity: high)
    │ Nuclei template matched, evidence extracted
    ▼
Triage Agent (NOT XSS Agent!)
    │ AI analysis, false positive check
    │ severity assessment, priority scoring
    ▼
Confirm Agent
    │ generates PoC, screenshots
    │ evidence collection
    ▼
Report Generator
    │ creates HackerOne report
    ▼
Bounty Platform Agent
    │ submits to HackerOne
```

### Example 2: Reflection Found (INFO-level → XSS Agent)
```
Scanner Agent (Nuclei)
    │ finds reflection (severity: info)
    │ Input reflected but NOT confirmed as XSS
    ▼
XSS Agent (needs to test payloads)
    │ tests XSS payloads against reflection
    │ tries WAF bypass, context escaping
    ▼
IF XSS confirmed:
    ▼
Triage Agent
    │ AI analysis
    ▼
Confirm Agent → Report Generator → Bounty Platform
```

### Example 3: Crawl → Form → XSS Testing
```
Crawl Agent
    │ finds form with input field
    │ publishSignal('form_found', {url, action, method})
    ▼
Dynamic Handoff Router
    │ Rule: form_found → [xss, csrf, sqli]
    ▼
XSS Agent
    │ tests for XSS (form wasn't scanned by Nuclei yet)
    │ confirms XSS
    ▼
Triage Agent
    │ AI analysis
    ▼
Confirm Agent → Report Generator → Bounty Platform
```

### Example 2: JS Analysis → DOM XSS Flow
```
Crawl Agent
    │ finds script.js
    │ publishSignal('js_file_found', {url, content})
    ▼
Dynamic Handoff Router
    │ Rule: js_file_found → [jsanalysis, secrethunter]
    ▼
JS Analysis Agent
    │ finds innerHTML sink with location.hash source
    │ publishSignal('dom_sink_found', {sink, source, code})
    ▼
Dynamic Handoff Router
    │ Rule: dom_sink_found → [xss, browser]
    ▼
XSS Agent
    │ crafts DOM XSS payload
    │ handoff to Browser Agent
    ▼
Browser Agent
    │ executes in headless browser
    │ confirms DOM XSS
    │ handoff to Confirm Agent
    ▼
...continues to reporting
```

### Example 3: Technology Detection → Specialized Attack
```
Fingerprint Agent
    │ detects Node.js + Express
    │ publishSignal('technology_detected', {tech: 'express'})
    ▼
Dynamic Handoff Router
    │ Rule: technology_detected + express → [prototype-pollution]
    ▼
Prototype Pollution Agent
    │ tests __proto__ injection
    │ finds pollution
    │ publishSignal('vulnerability_potential', {...})
    ▼
...continues to triage/confirm
```

---

## 📊 Agent Statistics

| Category | Count | Key Agents |
|----------|-------|------------|
| Reconnaissance | 6 | discovery, subdomain, bruteforce, fingerprint, portscan, crawl |
| Scanning | 2 | scanner, webvulns |
| Injection | 6 | xss, sqli, ssrf, templateinjection, xxe, deserialization |
| Authentication | 4 | authbypass, oauth, jwt-attack, idor |
| Fuzzing | 3 | advanced-fuzzer, intelligent-fuzz, apifuzz |
| Advanced Attacks | 5 | request-smuggling, cache-poisoning, prototype-pollution, waf-bypass, payload-engine |
| Business Logic | 2 | business-logic, race-condition |
| Analysis | 4 | jsanalysis, triage, intelligent-triage, confirm |
| Reporting | 3 | report-generator, bounty-platform, bounty-predictor |
| Monitoring | 2 | monitoring, visual-regression |
| Orchestration | 3 | god-mode, manager, collaboration |
| Specialized | 3 | exploit-chain, attack-graph, nuclei-generator |
| Infrastructure | 4 | cloud-storage, cloudmisconfig, container-escape, serverless |
| OSINT | 4 | osint, github-secrets, gitleaks, darkweb-intel |
| Protocol | 3 | graphql, grpc, websocket |
| Other | 10+ | cors, csrf, subdomain-takeover, interactsh, browser, etc. |

**Total: 85+ Agents**

---

## 🎛️ Configuration

All agents inherit from `BaseAgent` which provides:
- `publishSignal()` - Publish to Dynamic Router
- `handoff()` - Direct handoff to specific agent
- `createRichHandoff()` - Context-preserving handoff
- `executeCommand()` - Shell command execution
- `updateJobProgress()` - Progress tracking
- `recordHandoffFeedback()` - Learning feedback

---

## 🚀 Running the System

```bash
# Install dependencies
cd backend && npm install

# Start workers
npm run workers

# Start API
npm run api

# Start God Mode (full autonomous)
curl -X POST http://localhost:3000/api/god-mode/start \
  -H "Content-Type: application/json" \
  -d '{"programId": "xxx", "mode": "full-auto", "targetDomains": ["example.com"]}'
```

---

## 📝 Notes

1. **All lint errors** are due to missing `node_modules`. Run `npm install` to resolve.
2. **Dynamic Router** is the brain - agents should use `publishSignal()` for discovery sharing.
3. **God Mode** controls everything in autonomous mode.
4. **Manager Agent** provides human-in-the-loop for sensitive operations.
5. **Feedback loop** - Use `recordHandoffFeedback()` to improve routing over time.
