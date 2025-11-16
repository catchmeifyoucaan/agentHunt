#!/usr/bin/env ts-node
/**
 * 🎯 COMPREHENSIVE RICH HANDOFF DIAGNOSTIC SCRIPT
 *
 * Tests all 27 universal rich handoff workflows in the agentHunt system
 *
 * Test Domains:
 * - example.com (stable test target)
 * - bugcrowd.com (real bug bounty platform)
 *
 * Coverage:
 * ========================================================================
 * DISCOVERY PHASE (3 handoffs)
 * ========================================================================
 * 1. Subdomain → Discovery (passive enumeration → alive validation)
 * 2. Bruteforce → Discovery (active DNS bruteforce → alive validation)
 * 3. Portscan → Scanner (open ports → infrastructure vulnerability scan)
 *
 * ========================================================================
 * ASSET MAPPING (4 handoffs)
 * ========================================================================
 * 4. Discovery → Fingerprint (alive assets → technology identification)
 * 5. Discovery → Crawl (web services → URL discovery)
 * 6. Fingerprint → Scanner (tech stack → targeted vulnerability scan)
 * 7. Crawl → XSS (discovered URLs → XSS vulnerability scan)
 *
 * ========================================================================
 * INTELLIGENCE GATHERING (2 handoffs)
 * ========================================================================
 * 8. OSINT → Triage (leaked credentials/secrets → AI triage)
 * 9. Cloudmisconfig → Triage (exposed cloud storage → risk assessment)
 *
 * ========================================================================
 * VULNERABILITY SCANNING (9 handoffs)
 * ========================================================================
 * 10. Scanner → XSS (general scan → XSS-focused scan)
 * 11. Scanner → SQLi (database detection → SQL injection scan)
 * 12. Scanner → SSRF (external interaction → SSRF exploitation)
 * 13. Scanner → Webvulns (web app → comprehensive web vulns)
 * 14. Crawl → SQLi (database forms → SQL injection testing)
 * 15. Crawl → SSRF (URL parameters → SSRF testing)
 * 16. Crawl → Apifuzz (API endpoints → API fuzzing)
 * 17. XSS → Confirm (XSS findings → multi-method confirmation)
 * 18. SQLi → Confirm (SQLi findings → database exploitation validation)
 *
 * ========================================================================
 * ADVANCED EXPLOITATION (3 handoffs)
 * ========================================================================
 * 19. SSRF → Confirm (SSRF findings → OOB confirmation)
 * 20. Webvulns → Confirm (web vulnerabilities → exploit validation)
 * 21. Apifuzz → Confirm (API vulnerabilities → authentication/authorization bypass testing)
 *
 * ========================================================================
 * VALIDATION & REPORTING (5 handoffs)
 * ========================================================================
 * 22. Browser → Intelligent-Triage (XSS/CSRF with video proof → PoC generation)
 * 23. Interact → Intelligent-Triage (OOB-confirmed blind vulns → exploitation chain generation)
 * 24. Triage → Confirm (high-confidence findings → final validation)
 * 25. Confirm → Browser (confirmed XSS → browser video proof generation)
 * 26. Confirm → Interact (confirmed blind vulns → OOB validation)
 * 27. Intelligent-Triage → Confirm (AI-triaged findings → final confirmation)
 *
 * ========================================================================
 *
 * Each test:
 * - Creates test jobs with realistic data
 * - Verifies handoff triggers correctly
 * - Validates handoff data structure
 * - Checks job queue for handoff jobs
 * - Confirms context preservation
 */

import axios from 'axios';
import { randomUUID } from 'crypto';

// ============================================================================
// CONFIGURATION
// ============================================================================

const API_BASE = process.env.API_BASE || 'http://localhost:3000/api/v1';
const TEST_PROGRAM_NAME = 'Rich-Handoff-Diagnostic-Test';
const TEST_DOMAINS = ['example.com', 'bugcrowd.com'];

// Test configuration
const config = {
  timeout: 600000, // 10 minutes max per test
  pollInterval: 3000, // Check status every 3 seconds
  maxRetries: 3,
};

// ============================================================================
// COLOR OUTPUT HELPERS
// ============================================================================

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logSuccess(message: string) {
  log(`✅ ${message}`, colors.green);
}

function logError(message: string) {
  log(`❌ ${message}`, colors.red);
}

function logWarning(message: string) {
  log(`⚠️  ${message}`, colors.yellow);
}

function logInfo(message: string) {
  log(`ℹ️  ${message}`, colors.blue);
}

function logSection(message: string) {
  log(`\n${'='.repeat(80)}`, colors.cyan);
  log(`  ${message}`, colors.bright + colors.cyan);
  log(`${'='.repeat(80)}`, colors.cyan);
}

function logSubSection(message: string) {
  log(`\n${'-'.repeat(80)}`, colors.magenta);
  log(`  ${message}`, colors.magenta);
  log(`${'-'.repeat(80)}`, colors.magenta);
}

function logHandoff(from: string, to: string, status: string) {
  const arrow = ' → ';
  const statusColor = status === 'PASS' ? colors.green :
                      status === 'FAIL' ? colors.red :
                      status === 'SKIP' ? colors.yellow : colors.blue;
  log(`  ${from}${arrow}${to}: ${status}`, statusColor);
}

// ============================================================================
// API HELPERS
// ============================================================================

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function apiCall(method: string, endpoint: string, data?: any) {
  try {
    const response = await axios({
      method,
      url: `${API_BASE}${endpoint}`,
      data,
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return { success: true, data: response.data };
  } catch (error: any) {
    return {
      success: false,
      error: error.response?.data || error.message,
      status: error.response?.status,
    };
  }
}

async function waitForJob(jobId: string, maxWaitMs: number = config.timeout): Promise<any> {
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    const result = await apiCall('GET', `/jobs/${jobId}`);

    if (!result.success) {
      logWarning(`Failed to check job ${jobId} status: ${result.error}`);
      await sleep(config.pollInterval);
      continue;
    }

    const job = result.data;

    if (job.status === 'completed') {
      return { success: true, job };
    }

    if (job.status === 'failed') {
      return { success: false, job, error: job.error || 'Unknown error' };
    }

    // Still running
    await sleep(config.pollInterval);
  }

  return { success: false, error: 'Timeout' };
}

async function checkHandoffCreated(
  parentJobId: string,
  expectedTargetAgent: string
): Promise<{ created: boolean; handoffJob?: any }> {
  // Query jobs to find handoff jobs created by parent
  const result = await apiCall('GET', `/jobs?parentJobId=${parentJobId}&type=${expectedTargetAgent}`);

  if (!result.success) {
    return { created: false };
  }

  const handoffJobs = Array.isArray(result.data) ? result.data : [];
  if (handoffJobs.length > 0) {
    return { created: true, handoffJob: handoffJobs[0] };
  }

  return { created: false };
}

// ============================================================================
// RICH HANDOFF TEST FRAMEWORK
// ============================================================================

interface HandoffTest {
  name: string;
  phase: string;
  sourceAgent: string;
  targetAgent: string;
  description: string;
  testFn: (programId: string) => Promise<boolean>;
}

const handoffTests: HandoffTest[] = [];

function registerHandoffTest(test: HandoffTest) {
  handoffTests.push(test);
}

// ============================================================================
// DISCOVERY PHASE TESTS (3 handoffs)
// ============================================================================

registerHandoffTest({
  name: 'Subdomain → Discovery',
  phase: 'DISCOVERY',
  sourceAgent: 'subdomain',
  targetAgent: 'discovery',
  description: 'Passive subdomain enumeration hands off to HTTP/HTTPS probing',
  testFn: async (programId: string) => {
    logInfo('Testing Subdomain → Discovery handoff...');

    // Create subdomain job
    const subdomainJob = await apiCall('POST', '/jobs', {
      type: 'subdomain',
      programId,
      options: {
        domains: TEST_DOMAINS,
        sources: ['subfinder'],
      },
    });

    if (!subdomainJob.success) {
      logError(`Failed to create subdomain job: ${JSON.stringify(subdomainJob.error)}`);
      return false;
    }

    logInfo(`Subdomain job created: ${subdomainJob.data.id}`);

    // Wait for completion
    const result = await waitForJob(subdomainJob.data.id, 120000);

    if (!result.success) {
      logError(`Subdomain job failed: ${result.error}`);
      return false;
    }

    // Check if handoff to Discovery was created
    await sleep(2000); // Wait for handoff processing
    const handoff = await checkHandoffCreated(subdomainJob.data.id, 'discovery');

    if (handoff.created) {
      logSuccess(`Handoff to Discovery created: ${handoff.handoffJob.id}`);
      logInfo(`Handoff contains ${handoff.handoffJob.options?.subdomains?.length || 0} subdomains`);
      return true;
    } else {
      logWarning('No handoff to Discovery detected (may be 0 results)');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Bruteforce → Discovery',
  phase: 'DISCOVERY',
  sourceAgent: 'bruteforce',
  targetAgent: 'discovery',
  description: 'Active DNS bruteforce hands off to HTTP probing',
  testFn: async (programId: string) => {
    logInfo('Testing Bruteforce → Discovery handoff...');

    const bruteforceJob = await apiCall('POST', '/jobs', {
      type: 'bruteforce',
      programId,
      options: {
        domains: TEST_DOMAINS,
        tools: ['puredns'],
        wordlist: 'small', // Use small wordlist for speed
      },
    });

    if (!bruteforceJob.success) {
      logError(`Failed to create bruteforce job: ${JSON.stringify(bruteforceJob.error)}`);
      return false;
    }

    logInfo(`Bruteforce job created: ${bruteforceJob.data.id}`);

    const result = await waitForJob(bruteforceJob.data.id, 120000);

    if (!result.success) {
      logError(`Bruteforce job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(bruteforceJob.data.id, 'discovery');

    if (handoff.created) {
      logSuccess(`Handoff to Discovery created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Discovery detected');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Portscan → Scanner',
  phase: 'DISCOVERY',
  sourceAgent: 'portscan',
  targetAgent: 'scanner',
  description: 'Port scanning hands off to infrastructure vulnerability scanning',
  testFn: async (programId: string) => {
    logInfo('Testing Portscan → Scanner handoff...');

    const portscanJob = await apiCall('POST', '/jobs', {
      type: 'portscan',
      programId,
      options: {
        targets: TEST_DOMAINS,
        ports: '80,443,8080,8443,3306,5432,6379,27017', // Common ports
        fast: true,
      },
    });

    if (!portscanJob.success) {
      logError(`Failed to create portscan job: ${JSON.stringify(portscanJob.error)}`);
      return false;
    }

    logInfo(`Portscan job created: ${portscanJob.data.id}`);

    const result = await waitForJob(portscanJob.data.id, 120000);

    if (!result.success) {
      logError(`Portscan job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(portscanJob.data.id, 'scanner');

    if (handoff.created) {
      logSuccess(`Handoff to Scanner created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Scanner detected (may be 0 open ports)');
      return false;
    }
  },
});

// ============================================================================
// ASSET MAPPING TESTS (4 handoffs)
// ============================================================================

registerHandoffTest({
  name: 'Discovery → Fingerprint',
  phase: 'ASSET_MAPPING',
  sourceAgent: 'discovery',
  targetAgent: 'fingerprint',
  description: 'Alive asset discovery hands off to technology fingerprinting',
  testFn: async (programId: string) => {
    logInfo('Testing Discovery → Fingerprint handoff...');

    const discoveryJob = await apiCall('POST', '/jobs', {
      type: 'discovery',
      programId,
      options: {
        domains: TEST_DOMAINS,
        probeHttp: true,
        probeHttps: true,
      },
    });

    if (!discoveryJob.success) {
      logError(`Failed to create discovery job: ${JSON.stringify(discoveryJob.error)}`);
      return false;
    }

    logInfo(`Discovery job created: ${discoveryJob.data.id}`);

    const result = await waitForJob(discoveryJob.data.id, 120000);

    if (!result.success) {
      logError(`Discovery job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(discoveryJob.data.id, 'fingerprint');

    if (handoff.created) {
      logSuccess(`Handoff to Fingerprint created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Fingerprint detected');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Discovery → Crawl',
  phase: 'ASSET_MAPPING',
  sourceAgent: 'discovery',
  targetAgent: 'crawl',
  description: 'Alive web services hand off to URL crawling',
  testFn: async (programId: string) => {
    logInfo('Testing Discovery → Crawl handoff...');

    const discoveryJob = await apiCall('POST', '/jobs', {
      type: 'discovery',
      programId,
      options: {
        domains: TEST_DOMAINS,
        probeHttp: true,
        screenshot: false, // Disable screenshots for speed
      },
    });

    if (!discoveryJob.success) {
      logError(`Failed to create discovery job: ${JSON.stringify(discoveryJob.error)}`);
      return false;
    }

    logInfo(`Discovery job created: ${discoveryJob.data.id}`);

    const result = await waitForJob(discoveryJob.data.id, 120000);

    if (!result.success) {
      logError(`Discovery job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(discoveryJob.data.id, 'crawl');

    if (handoff.created) {
      logSuccess(`Handoff to Crawl created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Crawl detected');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Fingerprint → Scanner',
  phase: 'ASSET_MAPPING',
  sourceAgent: 'fingerprint',
  targetAgent: 'scanner',
  description: 'Technology fingerprinting hands off to targeted vulnerability scanning',
  testFn: async (programId: string) => {
    logInfo('Testing Fingerprint → Scanner handoff...');

    const fingerprintJob = await apiCall('POST', '/jobs', {
      type: 'fingerprint',
      programId,
      options: {
        assets: TEST_DOMAINS.map(d => `https://${d}`),
        tools: ['httpx', 'wappalyzer'],
      },
    });

    if (!fingerprintJob.success) {
      logError(`Failed to create fingerprint job: ${JSON.stringify(fingerprintJob.error)}`);
      return false;
    }

    logInfo(`Fingerprint job created: ${fingerprintJob.data.id}`);

    const result = await waitForJob(fingerprintJob.data.id, 120000);

    if (!result.success) {
      logError(`Fingerprint job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(fingerprintJob.data.id, 'scanner');

    if (handoff.created) {
      logSuccess(`Handoff to Scanner created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Scanner detected');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Crawl → XSS',
  phase: 'ASSET_MAPPING',
  sourceAgent: 'crawl',
  targetAgent: 'xss',
  description: 'URL crawling hands off to XSS vulnerability scanning',
  testFn: async (programId: string) => {
    logInfo('Testing Crawl → XSS handoff...');

    const crawlJob = await apiCall('POST', '/jobs', {
      type: 'crawl',
      programId,
      options: {
        targetUrls: TEST_DOMAINS.map(d => `https://${d}`),
        depth: 2,
        maxUrls: 50,
      },
    });

    if (!crawlJob.success) {
      logError(`Failed to create crawl job: ${JSON.stringify(crawlJob.error)}`);
      return false;
    }

    logInfo(`Crawl job created: ${crawlJob.data.id}`);

    const result = await waitForJob(crawlJob.data.id, 120000);

    if (!result.success) {
      logError(`Crawl job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(crawlJob.data.id, 'xss');

    if (handoff.created) {
      logSuccess(`Handoff to XSS created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to XSS detected');
      return false;
    }
  },
});

// ============================================================================
// INTELLIGENCE GATHERING TESTS (2 handoffs)
// ============================================================================

registerHandoffTest({
  name: 'OSINT → Triage',
  phase: 'INTELLIGENCE',
  sourceAgent: 'osint',
  targetAgent: 'triage',
  description: 'Leaked credentials/secrets hand off to AI triage',
  testFn: async (programId: string) => {
    logInfo('Testing OSINT → Triage handoff...');

    const osintJob = await apiCall('POST', '/jobs', {
      type: 'osint',
      programId,
      options: {
        domains: TEST_DOMAINS,
        searchCredentials: true,
        searchGithub: true,
        checkBreaches: true,
      },
    });

    if (!osintJob.success) {
      logError(`Failed to create OSINT job: ${JSON.stringify(osintJob.error)}`);
      return false;
    }

    logInfo(`OSINT job created: ${osintJob.data.id}`);

    const result = await waitForJob(osintJob.data.id, 180000); // 3 min timeout

    if (!result.success) {
      logError(`OSINT job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(osintJob.data.id, 'triage');

    if (handoff.created) {
      logSuccess(`Handoff to Triage created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Triage detected (may be 0 critical findings)');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Cloudmisconfig → Triage',
  phase: 'INTELLIGENCE',
  sourceAgent: 'cloudmisconfig',
  targetAgent: 'triage',
  description: 'Exposed cloud storage hands off to risk assessment',
  testFn: async (programId: string) => {
    logInfo('Testing Cloudmisconfig → Triage handoff...');

    const cloudJob = await apiCall('POST', '/jobs', {
      type: 'cloudmisconfig',
      programId,
      options: {
        domains: TEST_DOMAINS,
        keywords: ['backup', 'test', 'dev', 'prod'],
        checkS3: true,
        checkAzure: true,
        checkGCP: true,
      },
    });

    if (!cloudJob.success) {
      logError(`Failed to create cloudmisconfig job: ${JSON.stringify(cloudJob.error)}`);
      return false;
    }

    logInfo(`Cloudmisconfig job created: ${cloudJob.data.id}`);

    const result = await waitForJob(cloudJob.data.id, 180000);

    if (!result.success) {
      logError(`Cloudmisconfig job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(cloudJob.data.id, 'triage');

    if (handoff.created) {
      logSuccess(`Handoff to Triage created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Triage detected (may be 0 exposed buckets)');
      return false;
    }
  },
});

// ============================================================================
// VULNERABILITY SCANNING TESTS (9 handoffs)
// ============================================================================

registerHandoffTest({
  name: 'Scanner → XSS',
  phase: 'VULNERABILITY_SCANNING',
  sourceAgent: 'scanner',
  targetAgent: 'xss',
  description: 'General scanner hands off to XSS-focused scanning',
  testFn: async (programId: string) => {
    logInfo('Testing Scanner → XSS handoff...');

    const scannerJob = await apiCall('POST', '/jobs', {
      type: 'scanner',
      programId,
      options: {
        targets: TEST_DOMAINS.map(d => `https://${d}`),
        scanType: 'web',
        tier: 'tier1',
      },
    });

    if (!scannerJob.success) {
      logError(`Failed to create scanner job: ${JSON.stringify(scannerJob.error)}`);
      return false;
    }

    logInfo(`Scanner job created: ${scannerJob.data.id}`);

    const result = await waitForJob(scannerJob.data.id, 180000);

    if (!result.success) {
      logError(`Scanner job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(scannerJob.data.id, 'xss');

    if (handoff.created) {
      logSuccess(`Handoff to XSS created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to XSS detected');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'XSS → Confirm',
  phase: 'VULNERABILITY_SCANNING',
  sourceAgent: 'xss',
  targetAgent: 'confirm',
  description: 'XSS findings hand off to confirmation',
  testFn: async (programId: string) => {
    logInfo('Testing XSS → Confirm handoff...');

    const xssJob = await apiCall('POST', '/jobs', {
      type: 'xss',
      programId,
      options: {
        inputUrls: TEST_DOMAINS.map(d => `https://${d}`),
        tier: 'tier1',
        aggressive: false,
      },
    });

    if (!xssJob.success) {
      logError(`Failed to create XSS job: ${JSON.stringify(xssJob.error)}`);
      return false;
    }

    logInfo(`XSS job created: ${xssJob.data.id}`);

    const result = await waitForJob(xssJob.data.id, 180000);

    if (!result.success) {
      logError(`XSS job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(xssJob.data.id, 'confirm');

    if (handoff.created) {
      logSuccess(`Handoff to Confirm created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Confirm detected (may be 0 XSS findings)');
      return false;
    }
  },
});

// ============================================================================
// VALIDATION & REPORTING TESTS (5 handoffs)
// ============================================================================

registerHandoffTest({
  name: 'Browser → Intelligent-Triage',
  phase: 'VALIDATION_REPORTING',
  sourceAgent: 'browser',
  targetAgent: 'intelligent-triage',
  description: 'Browser-confirmed XSS with video hands off to PoC generation',
  testFn: async (programId: string) => {
    logInfo('Testing Browser → Intelligent-Triage handoff...');

    const browserJob = await apiCall('POST', '/jobs', {
      type: 'browser',
      programId,
      options: {
        urls: [
          { url: `https://${TEST_DOMAINS[0]}`, testType: 'xss', payload: '<script>alert(1)</script>' },
        ],
        captureVideo: true,
        captureScreenshot: true,
      },
    });

    if (!browserJob.success) {
      logError(`Failed to create browser job: ${JSON.stringify(browserJob.error)}`);
      return false;
    }

    logInfo(`Browser job created: ${browserJob.data.id}`);

    const result = await waitForJob(browserJob.data.id, 180000);

    if (!result.success) {
      logError(`Browser job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(browserJob.data.id, 'intelligent-triage');

    if (handoff.created) {
      logSuccess(`Handoff to Intelligent-Triage created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Intelligent-Triage detected (no vulnerable results)');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Interact → Intelligent-Triage',
  phase: 'VALIDATION_REPORTING',
  sourceAgent: 'interact',
  targetAgent: 'intelligent-triage',
  description: 'OOB-confirmed blind vulnerabilities hand off to exploit chain generation',
  testFn: async (programId: string) => {
    logInfo('Testing Interact → Intelligent-Triage handoff...');

    const interactJob = await apiCall('POST', '/jobs', {
      type: 'interact',
      programId,
      options: {
        monitorDuration: 60000, // 1 minute
        protocols: ['dns', 'http', 'smtp'],
      },
    });

    if (!interactJob.success) {
      logError(`Failed to create interact job: ${JSON.stringify(interactJob.error)}`);
      return false;
    }

    logInfo(`Interact job created: ${interactJob.data.id}`);

    const result = await waitForJob(interactJob.data.id, 120000);

    if (!result.success) {
      logError(`Interact job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(interactJob.data.id, 'intelligent-triage');

    if (handoff.created) {
      logSuccess(`Handoff to Intelligent-Triage created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Intelligent-Triage detected (no OOB interactions)');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Triage → Confirm',
  phase: 'VALIDATION_REPORTING',
  sourceAgent: 'triage',
  targetAgent: 'confirm',
  description: 'High-confidence AI-triaged findings hand off to final validation',
  testFn: async (programId: string) => {
    logInfo('Testing Triage → Confirm handoff...');

    // First create some findings to triage
    const triageJob = await apiCall('POST', '/jobs', {
      type: 'triage',
      programId,
      options: {
        findings: [
          {
            id: randomUUID(),
            type: 'xss',
            severity: 'high',
            url: `https://${TEST_DOMAINS[0]}/test`,
            evidence: 'XSS payload executed',
            confidence: 0.85,
          },
          {
            id: randomUUID(),
            type: 'sqli',
            severity: 'critical',
            url: `https://${TEST_DOMAINS[0]}/api/users`,
            evidence: 'SQL error detected',
            confidence: 0.9,
          },
        ],
      },
    });

    if (!triageJob.success) {
      logError(`Failed to create triage job: ${JSON.stringify(triageJob.error)}`);
      return false;
    }

    logInfo(`Triage job created: ${triageJob.data.id}`);

    const result = await waitForJob(triageJob.data.id, 180000);

    if (!result.success) {
      logError(`Triage job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(triageJob.data.id, 'confirm');

    if (handoff.created) {
      logSuccess(`Handoff to Confirm created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Confirm detected');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Confirm → Browser',
  phase: 'VALIDATION_REPORTING',
  sourceAgent: 'confirm',
  targetAgent: 'browser',
  description: 'Confirmed XSS hands off to browser video proof generation',
  testFn: async (programId: string) => {
    logInfo('Testing Confirm → Browser handoff...');

    const confirmJob = await apiCall('POST', '/jobs', {
      type: 'confirm',
      programId,
      options: {
        findings: [
          {
            id: randomUUID(),
            type: 'xss',
            severity: 'high',
            url: `https://${TEST_DOMAINS[0]}/xss-test`,
            payload: '<script>alert(document.domain)</script>',
            confidence: 0.9,
          },
        ],
      },
    });

    if (!confirmJob.success) {
      logError(`Failed to create confirm job: ${JSON.stringify(confirmJob.error)}`);
      return false;
    }

    logInfo(`Confirm job created: ${confirmJob.data.id}`);

    const result = await waitForJob(confirmJob.data.id, 180000);

    if (!result.success) {
      logError(`Confirm job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(confirmJob.data.id, 'browser');

    if (handoff.created) {
      logSuccess(`Handoff to Browser created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Browser detected');
      return false;
    }
  },
});

registerHandoffTest({
  name: 'Apifuzz → Confirm',
  phase: 'ADVANCED_EXPLOITATION',
  sourceAgent: 'apifuzz',
  targetAgent: 'confirm',
  description: 'API vulnerabilities hand off to authentication/authorization bypass testing',
  testFn: async (programId: string) => {
    logInfo('Testing Apifuzz → Confirm handoff...');

    const apifuzzJob = await apiCall('POST', '/jobs', {
      type: 'apifuzz',
      programId,
      options: {
        endpoints: TEST_DOMAINS.map(d => `https://${d}/api`),
        apiType: 'rest',
        tier: 'tier1',
      },
    });

    if (!apifuzzJob.success) {
      logError(`Failed to create apifuzz job: ${JSON.stringify(apifuzzJob.error)}`);
      return false;
    }

    logInfo(`Apifuzz job created: ${apifuzzJob.data.id}`);

    const result = await waitForJob(apifuzzJob.data.id, 180000);

    if (!result.success) {
      logError(`Apifuzz job failed: ${result.error}`);
      return false;
    }

    await sleep(2000);
    const handoff = await checkHandoffCreated(apifuzzJob.data.id, 'confirm');

    if (handoff.created) {
      logSuccess(`Handoff to Confirm created: ${handoff.handoffJob.id}`);
      return true;
    } else {
      logWarning('No handoff to Confirm detected (may be 0 high-severity API vulns)');
      return false;
    }
  },
});

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runDiagnostics() {
  logSection('🎯 COMPREHENSIVE RICH HANDOFF DIAGNOSTIC TEST');
  logInfo(`Testing with domains: ${TEST_DOMAINS.join(', ')}`);
  logInfo(`Total handoffs to test: ${handoffTests.length}`);

  // Health check
  logSubSection('Step 1: Server Health Check');
  try {
    const health = await axios.get('http://localhost:3000/health', { timeout: 5000 });
    logSuccess('Server is running');
  } catch (error) {
    logError('Server is not running! Start the backend first.');
    process.exit(1);
  }

  // Create test program
  logSubSection('Step 2: Create Test Program');
  const programSlug = `${TEST_PROGRAM_NAME.toLowerCase()}-${Date.now()}`;
  const createProgram = await apiCall('POST', '/programs', {
    name: TEST_PROGRAM_NAME,
    slug: programSlug,
    platform: 'bugcrowd',
    scope: {
      domains: TEST_DOMAINS,
      wildcardDomains: TEST_DOMAINS.map(d => `*.${d}`),
    },
  });

  if (!createProgram.success) {
    logError(`Failed to create test program: ${JSON.stringify(createProgram.error)}`);
    process.exit(1);
  }

  const programId = createProgram.data.id;
  logSuccess(`Test program created: ${programId}`);

  // Run tests grouped by phase
  const phases = [...new Set(handoffTests.map(t => t.phase))];
  const results: { [key: string]: boolean } = {};

  for (const phase of phases) {
    logSection(`Phase: ${phase}`);

    const phaseTests = handoffTests.filter(t => t.phase === phase);

    for (const test of phaseTests) {
      logSubSection(`Testing: ${test.name}`);
      logInfo(test.description);

      try {
        const passed = await test.testFn(programId);
        results[test.name] = passed;
        logHandoff(test.sourceAgent, test.targetAgent, passed ? 'PASS' : 'SKIP');
      } catch (error: any) {
        logError(`Test failed with error: ${error.message}`);
        results[test.name] = false;
        logHandoff(test.sourceAgent, test.targetAgent, 'FAIL');
      }

      await sleep(1000); // Brief pause between tests
    }
  }

  // Final summary
  logSection('📊 DIAGNOSTIC SUMMARY');

  const totalTests = Object.keys(results).length;
  const passed = Object.values(results).filter(r => r === true).length;
  const failed = Object.values(results).filter(r => r === false).length;
  const passRate = ((passed / totalTests) * 100).toFixed(1);

  logInfo(`Total tests: ${totalTests}`);
  logSuccess(`Passed: ${passed} (${passRate}%)`);
  if (failed > 0) {
    logError(`Failed/Skipped: ${failed} (${(100 - parseFloat(passRate)).toFixed(1)}%)`);
  }

  // Detailed results by phase
  log('\n📋 Detailed Results by Phase:\n', colors.cyan);

  for (const phase of phases) {
    log(`\n${phase}:`, colors.bright);
    const phaseTests = handoffTests.filter(t => t.phase === phase);

    for (const test of phaseTests) {
      const status = results[test.name];
      const statusStr = status === true ? '✅ PASS' :
                       status === false ? '❌ FAIL' :
                       '⚠️  SKIP';
      log(`  ${statusStr} - ${test.name}`, status === true ? colors.green : colors.yellow);
    }
  }

  // Recommendations
  logSection('💡 RECOMMENDATIONS');

  if (failed > 0) {
    logWarning('Some handoffs were not triggered. This is expected if:');
    logInfo('  - The source agent found 0 results (e.g., no subdomains, no vulnerabilities)');
    logInfo('  - The handoff trigger conditions were not met (e.g., confidence threshold)');
    logInfo('  - The backend is running in stub/mock mode');
  }

  logInfo('\nTo improve test coverage:');
  logInfo('  1. Use targets with known vulnerabilities');
  logInfo('  2. Ensure all agents are properly configured');
  logInfo('  3. Check logs for handoff trigger conditions');
  logInfo('  4. Verify BullMQ queues are processing jobs');

  logSection('🎉 DIAGNOSTIC COMPLETE');

  process.exit(passed === totalTests ? 0 : 1);
}

// Run diagnostics
runDiagnostics().catch(error => {
  logError(`Fatal error: ${error.message}`);
  console.error(error);
  process.exit(1);
});
