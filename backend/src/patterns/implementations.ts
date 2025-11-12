/**
 * Pattern Implementations - Phase 3.5: Formal Patterns
 *
 * Collection of pre-built workflow patterns:
 * 1. FullReconPattern - Comprehensive discovery and scanning
 * 2. QuickScanPattern - Fast targeted vulnerability scanning
 * 3. DeepScanPattern - Exhaustive scanning with bruteforce
 * 4. WordPressScanPattern - Specialized WordPress testing
 * 5. APIScanPattern - API endpoint discovery and fuzzing
 */

import { BasePattern, Pattern, PatternStep } from './base';

/**
 * Full Reconnaissance Pattern
 * Complete workflow: Discovery → Fingerprint → Crawl → Scanner → Triage
 *
 * Use case: First-time comprehensive assessment of a bug bounty program
 * Duration: 20-30 minutes
 * Cost: $0.00 (uses Gemini free tier)
 */
export class FullReconPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Full Reconnaissance',
      description: 'Comprehensive discovery, fingerprinting, crawling, and vulnerability scanning with AI triage',
      tags: ['reconnaissance', 'comprehensive', 'slow', 'complete'],
      estimatedDuration: '20-30 minutes',
      estimatedCost: '$0.00 (Gemini free tier)',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['chaosdb', 'subfinder', 'uncover', 'cloudlist'],
            maxAssets: 100000,
            deduplication: true,
          },
          priority: 7,
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['dnsx', 'httpx', 'tlsx'],
            concurrency: 500,
            checkCDN: true,
            extractTech: true,
          },
          priority: 7,
        },
        {
          agent: 'crawl',
          options: {
            depth: 2,
            maxUrls: 10000,
            jsRendering: true,
            parallelInstances: 5,
          },
          priority: 6,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'fast',
            tier: 'tier1',
            concurrency: 500,
            excludeTemplates: [],
          },
          priority: 6,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 10,
            minSeverity: 'medium',
          },
          priority: 5,
        },
      ],
      metadata: {
        useCase: 'First-time comprehensive program assessment',
        targetAudience: 'Bug bounty hunters starting new program',
        requirements: ['Program with discovery enabled', 'Valid scope configuration'],
      },
    };
  }
}

/**
 * Quick Scan Pattern
 * Fast workflow: Fingerprint → Scanner
 *
 * Use case: Rapid vulnerability check on known assets
 * Duration: 5-10 minutes
 * Cost: $0.00
 */
export class QuickScanPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Quick Scan',
      description: 'Fast vulnerability scan on known assets (skip discovery for speed)',
      tags: ['quick', 'fast', 'targeted', 'known-assets'],
      estimatedDuration: '5-10 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
            checkCDN: false,
            extractTech: false,
          },
          priority: 8,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'fast',
            tier: 'tier1',
            concurrency: 500,
            timeout: 10,
          },
          priority: 8,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 10,
            minSeverity: 'high',
          },
          priority: 7,
        },
      ],
      metadata: {
        useCase: 'Quick security check on existing infrastructure',
        targetAudience: 'Security teams doing routine scans',
        requirements: ['Pre-existing asset list or recent discovery run'],
      },
    };
  }
}

/**
 * Deep Scan Pattern
 * Exhaustive workflow: Discovery → Bruteforce → Fingerprint → Crawler → PortScan → Scanner → Triage
 *
 * Use case: Maximum coverage for high-value targets
 * Duration: 60-90 minutes
 * Cost: $0.00
 */
export class DeepScanPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Deep Scan',
      description: 'Exhaustive scanning with DNS bruteforce, port scanning, and comprehensive templates',
      tags: ['deep', 'exhaustive', 'slow', 'comprehensive', 'bruteforce'],
      estimatedDuration: '60-90 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['chaosdb', 'subfinder', 'uncover', 'cloudlist'],
            maxAssets: 100000,
            deduplication: true,
          },
          priority: 6,
        },
        {
          agent: 'bruteforce',
          options: {
            tool: 'massdns',
            wordlist: 'top10k',
            resolvers: '/app/tools/resolvers.txt',
            qps: 100000,
          },
          priority: 5,
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['dnsx', 'httpx', 'tlsx'],
            concurrency: 500,
            checkCDN: true,
            extractTech: true,
          },
          priority: 5,
        },
        {
          agent: 'portscan',
          options: {
            tool: 'masscan',
            ports: 'top-1000',
            rate: 10000,
          },
          priority: 5,
        },
        {
          agent: 'crawl',
          options: {
            depth: 3,
            maxUrls: 50000,
            jsRendering: true,
            parallelInstances: 10,
          },
          priority: 4,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'comprehensive',
            tier: 'tier2',
            concurrency: 500,
            timeout: 30,
          },
          priority: 4,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 10,
            minSeverity: 'low',
          },
          priority: 3,
        },
      ],
      metadata: {
        useCase: 'Maximum coverage for high-value targets or periodic deep assessments',
        targetAudience: 'Security teams, pentesters, advanced bug bounty hunters',
        requirements: ['Program policy allows bruteforce', 'Program policy allows port scanning'],
      },
    };
  }
}

/**
 * WordPress Scan Pattern
 * Specialized workflow: Discovery → Filter(WordPress) → Scanner(WP templates)
 *
 * Use case: WordPress-specific vulnerability assessment
 * Duration: 10-15 minutes
 * Cost: $0.00
 */
export class WordPressScanPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'WordPress Specialized Scan',
      description: 'Targeted scanning for WordPress-specific vulnerabilities (themes, plugins, core)',
      tags: ['wordpress', 'cms', 'specialized', 'targeted'],
      estimatedDuration: '10-15 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['subfinder', 'chaosdb'],
            maxAssets: 50000,
          },
          priority: 7,
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
            extractTech: true,
            fingerprintConditions: {
              technologies: ['WordPress'],
            },
          },
          priority: 7,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'comprehensive',
            templates: ['/app/tools/templates/wordpress', '/app/tools/templates/technologies/wordpress'],
            tier: 'tier1',
            concurrency: 300,
            fingerprintConditions: {
              technologies: ['WordPress'],
            },
          },
          priority: 8,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 10,
            minSeverity: 'medium',
          },
          priority: 7,
        },
      ],
      metadata: {
        useCase: 'WordPress-specific vulnerability assessment',
        targetAudience: 'Security teams, WordPress specialists',
        requirements: ['WordPress sites in scope'],
      },
    };
  }
}

/**
 * API Scan Pattern
 * API-focused workflow: Discovery → Crawler(API) → Scanner(API templates) → Fuzzer
 *
 * Use case: API endpoint discovery and security testing
 * Duration: 15-20 minutes
 * Cost: $0.00
 */
export class APIScanPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'API Security Scan',
      description: 'API endpoint discovery, testing, and fuzzing with specialized templates',
      tags: ['api', 'rest', 'graphql', 'endpoints', 'fuzzing'],
      estimatedDuration: '15-20 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['subfinder', 'chaosdb'],
            maxAssets: 50000,
            filterPatterns: ['*api*', '*rest*', '*graphql*', '*v1*', '*v2*'],
          },
          priority: 7,
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
            extractTech: true,
          },
          priority: 7,
        },
        {
          agent: 'crawl',
          options: {
            depth: 2,
            maxUrls: 20000,
            jsRendering: false,
            extractAPIs: true,
            parallelInstances: 5,
          },
          priority: 7,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'comprehensive',
            templates: [
              '/app/tools/templates/http/vulnerabilities/generic/',
              '/app/tools/templates/http/misconfiguration/',
              '/app/tools/templates/exposures/',
            ],
            tier: 'tier1',
            concurrency: 500,
          },
          priority: 6,
        },
        {
          agent: 'fuzzer',
          options: {
            targets: 'api-endpoints',
            wordlist: 'api-common',
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
          },
          priority: 5,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 10,
            minSeverity: 'medium',
          },
          priority: 5,
        },
      ],
      metadata: {
        useCase: 'API security testing and endpoint discovery',
        targetAudience: 'API security specialists, mobile app testers',
        requirements: ['API endpoints in scope'],
      },
    };
  }
}

/**
 * Export all pattern implementations
 */
export const patterns = {
  'full-recon': FullReconPattern,
  'quick-scan': QuickScanPattern,
  'deep-scan': DeepScanPattern,
  'wordpress-scan': WordPressScanPattern,
  'api-scan': APIScanPattern,
};

export default patterns;
