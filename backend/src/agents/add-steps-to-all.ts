/**
 * Script to add getSteps() implementation to all agents
 * Run this once to update all agent files
 */

import fs from 'fs/promises';
import path from 'path';

const agentSteps: Record<string, Array<{ name: string; metadata?: any }>> = {
  discovery: [
    { name: 'Load domains and scope', metadata: {} },
    { name: 'Discover subdomains with Chaos', metadata: {} },
    { name: 'Validate discovered assets', metadata: {} },
    { name: 'Store results in database', metadata: {} }
  ],
  subdomain: [
    { name: 'Load domains from scope', metadata: {} },
    { name: 'Passive subdomain enumeration', metadata: {} },
    { name: 'DNS resolution and validation', metadata: {} },
    { name: 'Store discovered subdomains', metadata: {} }
  ],
  bruteforce: [
    { name: 'Load domains and wordlists', metadata: {} },
    { name: 'DNS bruteforce (massdns/shuffledns)', metadata: {} },
    { name: 'Validate discovered subdomains', metadata: {} },
    { name: 'Store results in database', metadata: {} }
  ],
  portscan: [
    { name: 'Load targets for port scanning', metadata: {} },
    { name: 'Run port scan (masscan or naabu)', metadata: {} },
    { name: 'Parse and analyze results', metadata: {} },
    { name: 'Store open ports in database', metadata: {} }
  ],
  scanner: [
    { name: 'Load targets and templates', metadata: {} },
    { name: 'Run Nuclei vulnerability scan', metadata: {} },
    { name: 'Parse and triage findings', metadata: {} },
    { name: 'Store vulnerabilities in database', metadata: {} }
  ],
  crawl: [
    { name: 'Load URLs to crawl', metadata: {} },
    { name: 'Crawl websites with Katana', metadata: {} },
    { name: 'Extract endpoints and parameters', metadata: {} },
    { name: 'Store discovered endpoints', metadata: {} }
  ],
  triage: [
    { name: 'Load findings for triage', metadata: {} },
    { name: 'AI-powered analysis and classification', metadata: {} },
    { name: 'Assess severity and confidence', metadata: {} },
    { name: 'Update finding status', metadata: {} }
  ],
  confirm: [
    { name: 'Load findings to confirm', metadata: {} },
    { name: 'Re-test and validate vulnerabilities', metadata: {} },
    { name: 'Generate proof-of-concept', metadata: {} },
    { name: 'Mark findings as confirmed', metadata: {} }
  ],
  osint: [
    { name: 'Load targets for OSINT', metadata: {} },
    { name: 'Gather intelligence from public sources', metadata: {} },
    { name: 'Analyze and correlate findings', metadata: {} },
    { name: 'Store OSINT data', metadata: {} }
  ],
  xss: [
    { name: 'Load endpoints for XSS testing', metadata: {} },
    { name: 'Run XSS scanner (dalfox)', metadata: {} },
    { name: 'Validate XSS vulnerabilities', metadata: {} },
    { name: 'Store XSS findings', metadata: {} }
  ],
  sqli: [
    { name: 'Load endpoints for SQLi testing', metadata: {} },
    { name: 'Run SQLi scanner (sqlmap/ghauri)', metadata: {} },
    { name: 'Validate SQL injection', metadata: {} },
    { name: 'Store SQLi findings', metadata: {} }
  ],
  webvulns: [
    { name: 'Load targets for web vulnerability scan', metadata: {} },
    { name: 'Run specialized web scanners', metadata: {} },
    { name: 'Analyze and classify vulnerabilities', metadata: {} },
    { name: 'Store web vulnerability findings', metadata: {} }
  ],
  jsanalysis: [
    { name: 'Load JavaScript files for analysis', metadata: {} },
    { name: 'Extract endpoints and secrets', metadata: {} },
    { name: 'Analyze for vulnerabilities', metadata: {} },
    { name: 'Store JS analysis results', metadata: {} }
  ],
  cloudmisconfig: [
    { name: 'Load cloud targets', metadata: {} },
    { name: 'Scan for misconfigurations', metadata: {} },
    { name: 'Validate findings', metadata: {} },
    { name: 'Store cloud security issues', metadata: {} }
  ],
  interact: [
    { name: 'Load OOB testing targets', metadata: {} },
    { name: 'Generate interaction payloads', metadata: {} },
    { name: 'Monitor for interactions', metadata: {} },
    { name: 'Store OOB findings', metadata: {} }
  ]
};

const getStepsTemplate = (steps: Array<{ name: string; metadata?: any }>) => `
  protected getSteps() {
    return ${JSON.stringify(steps, null, 6).replace(/"([^"]+)":/g, '$1:')};
  }
`;

async function addGetStepsToAgent(agentName: string, steps: Array<{ name: string; metadata?: any }>) {
  const filePath = path.join(__dirname, `${agentName}.ts`);

  try {
    let content = await fs.readFile(filePath, 'utf-8');

    // Check if getSteps already exists
    if (content.includes('protected getSteps()')) {
      console.log(`✓ ${agentName}: getSteps() already exists`);
      return;
    }

    // Find the constructor and add getSteps after it
    const constructorRegex = /(constructor\(\) \{[\s\S]*?\n  \})/;
    const match = content.match(constructorRegex);

    if (match) {
      const replacement = match[0] + getStepsTemplate(steps);
      content = content.replace(constructorRegex, replacement);

      await fs.writeFile(filePath, content);
      console.log(`✓ ${agentName}: Added getSteps()`);
    } else {
      console.log(`✗ ${agentName}: Could not find constructor`);
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.log(`✗ ${agentName}: File not found`);
    } else {
      console.error(`✗ ${agentName}: Error -`, error.message);
    }
  }
}

async function main() {
  console.log('Adding getSteps() to all agents...\n');

  for (const [agentName, steps] of Object.entries(agentSteps)) {
    await addGetStepsToAgent(agentName, steps);
  }

  console.log('\nDone!');
}

main();
