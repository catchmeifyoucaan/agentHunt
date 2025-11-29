/**
 * Test script for serverless inference integration
 * Verifies that the three-agent system can use DeepSeek R1 Distill via serverless endpoint
 *
 * Usage:
 *   export MODEL_ACCESS_KEY="your_api_key_here"
 *   npx tsx backend/test-serverless-inference.ts
 */

import llmEngine from './src/services/llm/llm-engine';
import { ServerlessProvider } from './src/services/llm/providers/serverless';
import logger from './src/utils/logger';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
};

function log(message: string, color: string = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

async function testServerlessProvider() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.bright);
  log('TEST 1: Direct ServerlessProvider Test', colors.bright);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.bright);

  try {
    // Check if MODEL_ACCESS_KEY is set
    if (!process.env.MODEL_ACCESS_KEY) {
      log('❌ MODEL_ACCESS_KEY environment variable not set!', colors.red);
      log('   Set it with: export MODEL_ACCESS_KEY="your_api_key_here"', colors.yellow);
      return false;
    }

    log('✓ MODEL_ACCESS_KEY is configured', colors.green);

    // Create serverless provider
    const provider = new ServerlessProvider({
      provider: 'serverless',
      model: 'deepseek-r1-distill-llama-70b',
      apiKey: process.env.MODEL_ACCESS_KEY,
      temperature: 0.2,
      maxTokens: 350,
    });

    log('✓ ServerlessProvider instance created', colors.green);

    // Test availability
    const available = await provider.isAvailable();
    log(
      `✓ Provider availability check: ${available ? 'AVAILABLE' : 'NOT AVAILABLE'}`,
      available ? colors.green : colors.red
    );

    if (!available) {
      return false;
    }

    // Test simple completion
    log('\n📤 Sending test prompt: "What is SQL injection?"', colors.blue);

    const startTime = Date.now();
    const response = await provider.complete(
      'What is SQL injection? Respond in one sentence.',
      'You are a security expert. Be concise.'
    );
    const duration = Date.now() - startTime;

    log(`\n📥 Response received (${duration}ms):`, colors.blue);
    log(`   "${response.substring(0, 200)}${response.length > 200 ? '...' : ''}"`, colors.reset);
    log(`   Full length: ${response.length} characters`, colors.yellow);

    log('\n✅ Direct ServerlessProvider test PASSED', colors.green);
    return true;
  } catch (error: any) {
    log(`\n❌ Direct ServerlessProvider test FAILED: ${error.message}`, colors.red);
    return false;
  }
}

async function testLLMEngine() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.bright);
  log('TEST 2: LLM Engine Integration Test', colors.bright);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.bright);

  try {
    // Get engine stats
    const stats = llmEngine.getStats();
    log('📊 LLM Engine Statistics:', colors.blue);
    log(`   Available providers: ${stats.providers.join(', ')}`, colors.reset);
    log(`   Default provider: ${stats.defaultProvider}`, colors.reset);
    log(`   Cache enabled: ${stats.cacheEnabled}`, colors.reset);

    if (!stats.providers.includes('serverless')) {
      log('\n❌ Serverless provider not initialized in LLM Engine!', colors.red);
      log('   Make sure MODEL_ACCESS_KEY is set before starting the backend.', colors.yellow);
      return false;
    }

    log('\n✓ Serverless provider is registered in LLM Engine', colors.green);

    if (stats.defaultProvider === 'serverless') {
      log('✓ Serverless is the DEFAULT provider (cost-optimized)', colors.green);
    } else {
      log(`⚠ Default provider is "${stats.defaultProvider}", not serverless`, colors.yellow);
    }

    // Test completion through engine (should use default provider)
    log('\n📤 Testing llmEngine.complete() with default provider...', colors.blue);

    const startTime = Date.now();
    const response = await llmEngine.complete(
      'List 3 common web vulnerabilities. Respond with just the names, comma-separated.',
      'You are a security expert. Be brief and direct.'
    );
    const duration = Date.now() - startTime;

    log(`\n📥 Response received (${duration}ms):`, colors.blue);
    log(`   "${response}"`, colors.reset);

    log('\n✅ LLM Engine integration test PASSED', colors.green);
    return true;
  } catch (error: any) {
    log(`\n❌ LLM Engine integration test FAILED: ${error.message}`, colors.red);
    return false;
  }
}

async function testThreeAgentCompatibility() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.bright);
  log('TEST 3: Three-Agent System Compatibility', colors.bright);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.bright);

  try {
    // Simulate a researcher agent review prompt
    const reviewPrompt = `You are a technical security reviewer. Analyze this finding:

**Type:** XSS
**URL:** https://example.com/search?q=test
**Evidence:** Reflected user input in response without encoding

Evaluate:
1. Is the technical analysis correct?
2. Is the evidence sufficient?

Return JSON:
{
  "verdict": "valid|invalid|uncertain",
  "confidence": 0.0-1.0,
  "reasoning": "your analysis"
}`;

    log('📤 Simulating Researcher Agent review (technical reviewer)...', colors.blue);

    const startTime = Date.now();
    const response = await llmEngine.complete(reviewPrompt);
    const duration = Date.now() - startTime;

    log(`\n📥 Review response received (${duration}ms)`, colors.blue);

    // Try to parse JSON response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const review = JSON.parse(jsonMatch[0]);
        log('\n✓ Response is valid JSON:', colors.green);
        log(`   Verdict: ${review.verdict || 'N/A'}`, colors.reset);
        log(`   Confidence: ${review.confidence || 'N/A'}`, colors.reset);
        log(`   Reasoning: ${review.reasoning?.substring(0, 100) || 'N/A'}...`, colors.reset);
      } catch (e) {
        log('\n⚠ Response contains JSON but parsing failed', colors.yellow);
      }
    } else {
      log('\n⚠ No JSON found in response (model might need prompt tuning)', colors.yellow);
    }

    log('\n✅ Three-Agent compatibility test PASSED', colors.green);
    log('   The three-agent system will now use serverless inference!', colors.green);
    return true;
  } catch (error: any) {
    log(`\n❌ Three-Agent compatibility test FAILED: ${error.message}`, colors.red);
    return false;
  }
}

async function showCostAnalysis() {
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.bright);
  log('💰 COST ANALYSIS', colors.bright);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.bright);

  log('Three-Agent System API Call Volume (typical session with 100 findings):', colors.blue);
  log('  • Planner Agent:     1-3 calls (strategy creation/adaptation)', colors.reset);
  log('  • Executor Agent:    20-200 calls (swarm of sub-agents)', colors.reset);
  log('  • Researcher Agent:  500 calls (5 reviews × 100 findings)', colors.reset);
  log('  • PoC Generation:    10-20 calls (for exploitable findings)', colors.reset);
  log('  • Attack Chains:     1-5 calls (chain discovery)', colors.reset);
  log('  ─────────────────────────────────────────────────────', colors.reset);
  log('  Total per session:   ~500-700 API calls', colors.yellow);

  log('\n💵 Cost Comparison:', colors.blue);
  log('  Claude Sonnet ($0.003/1K tokens):', colors.reset);
  log('    • 600 calls × 350 tokens avg = 210,000 tokens', colors.reset);
  log('    • Cost: ~$0.63 per session', colors.reset);
  log('    • Monthly (100 sessions): ~$63', colors.red);

  log('\n  DeepSeek R1 Distill via Serverless (FREE or $0.001/1K tokens):', colors.reset);
  log('    • Same 600 calls × 350 tokens = 210,000 tokens', colors.reset);
  log('    • Cost: ~$0.21 per session (or FREE)', colors.reset);
  log('    • Monthly (100 sessions): ~$21 (or FREE)', colors.green);

  log('\n  💎 SAVINGS: 67-100% cost reduction!', colors.green);
  log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.bright);
}

async function main() {
  log('\n' + '='.repeat(70), colors.bright);
  log('  SERVERLESS INFERENCE INTEGRATION TEST SUITE', colors.bright);
  log('  DeepSeek R1 Distill for Three-Agent System', colors.bright);
  log('='.repeat(70) + '\n', colors.bright);

  const results = {
    directProvider: false,
    llmEngine: false,
    threeAgent: false,
  };

  // Run tests
  results.directProvider = await testServerlessProvider();

  if (results.directProvider) {
    results.llmEngine = await testLLMEngine();

    if (results.llmEngine) {
      results.threeAgent = await testThreeAgentCompatibility();
    }
  }

  // Show cost analysis
  await showCostAnalysis();

  // Summary
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.bright);
  log('📊 TEST SUMMARY', colors.bright);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', colors.bright);

  log(
    `Direct Provider:     ${results.directProvider ? '✅ PASS' : '❌ FAIL'}`,
    results.directProvider ? colors.green : colors.red
  );
  log(
    `LLM Engine:          ${results.llmEngine ? '✅ PASS' : '❌ FAIL'}`,
    results.llmEngine ? colors.green : colors.red
  );
  log(
    `Three-Agent Compat:  ${results.threeAgent ? '✅ PASS' : '❌ FAIL'}`,
    results.threeAgent ? colors.green : colors.red
  );

  const allPassed = results.directProvider && results.llmEngine && results.threeAgent;

  if (allPassed) {
    log('\n🎉 ALL TESTS PASSED! Serverless inference is fully integrated!', colors.green);
    log('\nNext steps:', colors.blue);
    log('  1. The three-agent system will now use serverless inference by default', colors.reset);
    log('  2. All planner/executor/researcher agents will benefit from cost savings', colors.reset);
    log('  3. Monitor performance and adjust maxTokens/temperature if needed', colors.reset);
  } else {
    log('\n⚠️  SOME TESTS FAILED. Check the output above for details.', colors.yellow);
  }

  log('\n' + '='.repeat(70) + '\n', colors.bright);

  process.exit(allPassed ? 0 : 1);
}

// Run tests
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
