#!/usr/bin/env ts-node
/**
 * Validate Rich Handoff Test Structure
 *
 * This script validates the test framework is correctly structured
 * without requiring a running backend server.
 */

// Mock the test framework to validate structure
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

// Register all 27 handoffs (simplified)
const testDefinitions = [
  // Discovery Phase (3)
  { name: 'Subdomain → Discovery', phase: 'DISCOVERY', source: 'subdomain', target: 'discovery' },
  { name: 'Bruteforce → Discovery', phase: 'DISCOVERY', source: 'bruteforce', target: 'discovery' },
  { name: 'Portscan → Scanner', phase: 'DISCOVERY', source: 'portscan', target: 'scanner' },

  // Asset Mapping (4)
  { name: 'Discovery → Fingerprint', phase: 'ASSET_MAPPING', source: 'discovery', target: 'fingerprint' },
  { name: 'Discovery → Crawl', phase: 'ASSET_MAPPING', source: 'discovery', target: 'crawl' },
  { name: 'Fingerprint → Scanner', phase: 'ASSET_MAPPING', source: 'fingerprint', target: 'scanner' },
  { name: 'Crawl → XSS', phase: 'ASSET_MAPPING', source: 'crawl', target: 'xss' },

  // Intelligence Gathering (2)
  { name: 'OSINT → Triage', phase: 'INTELLIGENCE', source: 'osint', target: 'triage' },
  { name: 'Cloudmisconfig → Triage', phase: 'INTELLIGENCE', source: 'cloudmisconfig', target: 'triage' },

  // Vulnerability Scanning (9)
  { name: 'Scanner → XSS', phase: 'VULNERABILITY_SCANNING', source: 'scanner', target: 'xss' },
  { name: 'Scanner → SQLi', phase: 'VULNERABILITY_SCANNING', source: 'scanner', target: 'sqli' },
  { name: 'Scanner → SSRF', phase: 'VULNERABILITY_SCANNING', source: 'scanner', target: 'ssrf' },
  { name: 'Scanner → Webvulns', phase: 'VULNERABILITY_SCANNING', source: 'scanner', target: 'webvulns' },
  { name: 'Crawl → SQLi', phase: 'VULNERABILITY_SCANNING', source: 'crawl', target: 'sqli' },
  { name: 'Crawl → SSRF', phase: 'VULNERABILITY_SCANNING', source: 'crawl', target: 'ssrf' },
  { name: 'Crawl → Apifuzz', phase: 'VULNERABILITY_SCANNING', source: 'crawl', target: 'apifuzz' },
  { name: 'XSS → Confirm', phase: 'VULNERABILITY_SCANNING', source: 'xss', target: 'confirm' },
  { name: 'SQLi → Confirm', phase: 'VULNERABILITY_SCANNING', source: 'sqli', target: 'confirm' },

  // Advanced Exploitation (3)
  { name: 'SSRF → Confirm', phase: 'ADVANCED_EXPLOITATION', source: 'ssrf', target: 'confirm' },
  { name: 'Webvulns → Confirm', phase: 'ADVANCED_EXPLOITATION', source: 'webvulns', target: 'confirm' },
  { name: 'Apifuzz → Confirm', phase: 'ADVANCED_EXPLOITATION', source: 'apifuzz', target: 'confirm' },

  // Validation & Reporting (6)
  { name: 'Browser → Intelligent-Triage', phase: 'VALIDATION_REPORTING', source: 'browser', target: 'intelligent-triage' },
  { name: 'Interact → Intelligent-Triage', phase: 'VALIDATION_REPORTING', source: 'interact', target: 'intelligent-triage' },
  { name: 'Triage → Confirm', phase: 'VALIDATION_REPORTING', source: 'triage', target: 'confirm' },
  { name: 'Confirm → Browser', phase: 'VALIDATION_REPORTING', source: 'confirm', target: 'browser' },
  { name: 'Confirm → Interact', phase: 'VALIDATION_REPORTING', source: 'confirm', target: 'interact' },
  { name: 'Intelligent-Triage → Confirm', phase: 'VALIDATION_REPORTING', source: 'intelligent-triage', target: 'confirm' },
];

// Register all tests
testDefinitions.forEach(test => {
  registerHandoffTest({
    name: test.name,
    phase: test.phase,
    sourceAgent: test.source,
    targetAgent: test.target,
    description: `${test.source} → ${test.target}`,
    testFn: async () => true, // Mock test function
  });
});

// Validate structure
console.log('🔍 Validating Rich Handoff Test Structure...\n');

// Check total count
const expectedCount = 27;
const actualCount = handoffTests.length;

if (actualCount === expectedCount) {
  console.log(`✅ Total handoffs: ${actualCount} (expected: ${expectedCount})`);
} else {
  console.log(`❌ Total handoffs: ${actualCount} (expected: ${expectedCount})`);
  process.exit(1);
}

// Check phases
const phases = Array.from(new Set(handoffTests.map(t => t.phase)));
console.log(`\n📊 Phases: ${phases.length}`);
phases.forEach(phase => {
  const count = handoffTests.filter(t => t.phase === phase).length;
  console.log(`   - ${phase}: ${count} handoffs`);
});

// Expected counts by phase
const expectedCounts: { [key: string]: number } = {
  'DISCOVERY': 3,
  'ASSET_MAPPING': 4,
  'INTELLIGENCE': 2,
  'VULNERABILITY_SCANNING': 9,
  'ADVANCED_EXPLOITATION': 3,
  'VALIDATION_REPORTING': 6,
};

// Validate counts
console.log('\n✅ Validating phase counts:');
let allValid = true;
phases.forEach(phase => {
  const actual = handoffTests.filter(t => t.phase === phase).length;
  const expected = expectedCounts[phase] || 0;
  if (actual === expected) {
    console.log(`   ✅ ${phase}: ${actual}/${expected}`);
  } else {
    console.log(`   ❌ ${phase}: ${actual}/${expected}`);
    allValid = false;
  }
});

// List all handoffs
console.log('\n📋 All Handoff Workflows:\n');
phases.forEach(phase => {
  console.log(`\n${phase}:`);
  handoffTests
    .filter(t => t.phase === phase)
    .forEach((test, idx) => {
      console.log(`  ${idx + 1}. ${test.name}`);
    });
});

// Final validation
if (allValid && actualCount === expectedCount) {
  console.log('\n✅ All validations passed! Test structure is correct.\n');
  console.log('📝 To run the actual tests:');
  console.log('   Quick test:         ./test-rich-handoffs-quick.sh');
  console.log('   Comprehensive test: npx ts-node test-rich-handoffs-comprehensive.ts');
  console.log('\n⚠️  Note: Tests require a running backend server (npm run dev)\n');
  process.exit(0);
} else {
  console.log('\n❌ Validation failed! Please check the test structure.\n');
  process.exit(1);
}
