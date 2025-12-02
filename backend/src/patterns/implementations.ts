/**
 * Pattern Implementations - Phase 3.5: Formal Patterns
 *
 * Collection of pre-built workflow patterns:
 * 1. FullReconPattern - Comprehensive discovery and scanning
 * 2. QuickScanPattern - Fast targeted vulnerability scanning
 * 3. DeepScanPattern - Exhaustive scanning with bruteforce
 * 4. WordPressScanPattern - Specialized WordPress testing
 * 5. APIScanPattern - API endpoint discovery and fuzzing
 * 6. ThreeAgentSwarmPattern - AI-powered parallel swarm attack (20-200 agents)
 * 7. CloudSecurityPattern - Cloud misconfigurations and S3/Azure/GCP testing
 * 8. SSRFHuntPattern - Server-Side Request Forgery hunting
 * 9. XSSHuntPattern - Cross-Site Scripting comprehensive testing
 * 10. SQLiHuntPattern - SQL Injection detection and exploitation
 * 11. AuthBypassPattern - Authentication and authorization bypass testing
 * 12. OSINTPattern - Open Source Intelligence gathering
 * 13. JSAnalysisPattern - JavaScript analysis and secrets extraction
 * 14. BugBountySpeedrunPattern - Optimized for quick bounty wins
 * 15. CriticalOnlyPattern - Focus only on critical/high severity findings
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
      description:
        'Comprehensive discovery, fingerprinting, crawling, and vulnerability scanning with AI triage',
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
      description:
        'Exhaustive scanning with DNS bruteforce, port scanning, and comprehensive templates',
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
      description:
        'Targeted scanning for WordPress-specific vulnerabilities (themes, plugins, core)',
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
            templates: [
              '/app/tools/templates/wordpress',
              '/app/tools/templates/technologies/wordpress',
            ],
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
 * Three-Agent Swarm Pattern
 * AI-powered parallel attack: Planner → Executor (20-200 parallel) → Researcher
 *
 * Use case: Maximum coverage with intelligent target distribution
 * Duration: 30-60 minutes
 * Cost: ~$0.50-2.00 (AI-powered planning and validation)
 */
export class ThreeAgentSwarmPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Three-Agent Swarm Attack',
      description:
        'AI-powered swarm attack with intelligent planning, parallel execution (20-200 agents), and multi-reviewer validation',
      tags: ['ai-powered', 'swarm', 'parallel', 'advanced', 'three-agent'],
      estimatedDuration: '30-60 minutes',
      estimatedCost: '~$0.50-2.00 (AI planning + validation)',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['chaosdb', 'subfinder', 'uncover'],
            maxAssets: 100000,
          },
          priority: 8,
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx', 'dnsx'],
            concurrency: 500,
            extractTech: true,
          },
          priority: 8,
        },
        {
          agent: 'planner',
          options: {
            strategy: 'adaptive',
            maxParallelAgents: 200,
            targetClassification: true,
            attackChainDiscovery: true,
          },
          priority: 9,
        },
        {
          agent: 'executor',
          options: {
            swarmSize: 50,
            atomicTargetClaiming: true,
            parallelFuzzing: true,
            realTimeCoordination: true,
          },
          priority: 9,
        },
        {
          agent: 'researcher',
          options: {
            reviewerCount: 5,
            pocGeneration: true,
            falsePositiveFiltering: true,
            severityValidation: true,
          },
          priority: 9,
        },
      ],
      metadata: {
        useCase: 'Maximum coverage with AI-powered intelligent attack distribution',
        targetAudience: 'Advanced bug bounty hunters, red teams',
        requirements: ['AI API keys configured', 'High-value target'],
      },
    };
  }
}

/**
 * Cloud Security Pattern
 * Cloud-focused workflow: Discovery → CloudMisconfig → Scanner → Triage
 *
 * Use case: AWS/Azure/GCP security assessment
 * Duration: 15-25 minutes
 * Cost: $0.00
 */
export class CloudSecurityPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Cloud Security Assessment',
      description:
        'Cloud infrastructure security testing for AWS, Azure, GCP misconfigurations',
      tags: ['cloud', 'aws', 'azure', 'gcp', 's3', 'misconfig'],
      estimatedDuration: '15-25 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['cloudlist', 'subfinder'],
            maxAssets: 50000,
            filterPatterns: ['*s3*', '*blob*', '*storage*', '*cdn*', '*cloudfront*'],
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
          agent: 'cloudmisconfig',
          options: {
            providers: ['aws', 'azure', 'gcp'],
            checkS3Buckets: true,
            checkBlobStorage: true,
            checkIAM: true,
            checkSecurityGroups: true,
          },
          priority: 8,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'comprehensive',
            templates: [
              '/app/tools/templates/cloud/',
              '/app/tools/templates/exposures/configs/',
            ],
            tier: 'tier1',
            concurrency: 300,
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
        useCase: 'Cloud infrastructure security assessment',
        targetAudience: 'Cloud security specialists, DevSecOps',
        requirements: ['Cloud assets in scope'],
      },
    };
  }
}

/**
 * SSRF Hunt Pattern
 * SSRF-focused workflow: Discovery → Crawl → SSRF Agent → Confirm
 *
 * Use case: Server-Side Request Forgery vulnerability hunting
 * Duration: 20-30 minutes
 * Cost: $0.00
 */
export class SSRFHuntPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'SSRF Vulnerability Hunt',
      description:
        'Specialized Server-Side Request Forgery detection with callback verification',
      tags: ['ssrf', 'server-side', 'oob', 'callback'],
      estimatedDuration: '20-30 minutes',
      estimatedCost: '$0.00',
      steps: [
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
            depth: 3,
            maxUrls: 20000,
            jsRendering: true,
            extractForms: true,
            extractParams: true,
          },
          priority: 7,
        },
        {
          agent: 'ssrf',
          options: {
            payloads: ['internal-ip', 'cloud-metadata', 'localhost', 'dns-callback'],
            useInteractsh: true,
            checkCloudMetadata: true,
            checkInternalNetwork: true,
            timeout: 30,
          },
          priority: 8,
        },
        {
          agent: 'confirm',
          options: {
            verifyCallbacks: true,
            generatePoC: true,
            timeout: 60,
          },
          priority: 8,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 5,
            minSeverity: 'high',
          },
          priority: 7,
        },
      ],
      metadata: {
        useCase: 'SSRF vulnerability hunting',
        targetAudience: 'Bug bounty hunters, penetration testers',
        requirements: ['Interactsh or similar callback server'],
      },
    };
  }
}

/**
 * XSS Hunt Pattern
 * XSS-focused workflow: Crawl → XSS Agent → Browser Confirm
 *
 * Use case: Cross-Site Scripting comprehensive testing
 * Duration: 15-25 minutes
 * Cost: $0.00
 */
export class XSSHuntPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'XSS Vulnerability Hunt',
      description:
        'Comprehensive Cross-Site Scripting detection with DOM analysis and browser verification',
      tags: ['xss', 'client-side', 'dom', 'reflected', 'stored'],
      estimatedDuration: '15-25 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
          },
          priority: 7,
        },
        {
          agent: 'crawl',
          options: {
            depth: 3,
            maxUrls: 15000,
            jsRendering: true,
            extractForms: true,
            extractParams: true,
            parallelInstances: 5,
          },
          priority: 7,
        },
        {
          agent: 'jsanalysis',
          options: {
            extractSinks: true,
            extractSources: true,
            detectDOMXSS: true,
          },
          priority: 7,
        },
        {
          agent: 'xss',
          options: {
            payloadTypes: ['reflected', 'dom', 'stored'],
            contextAware: true,
            bypassWAF: true,
            encodings: ['html', 'url', 'unicode'],
          },
          priority: 8,
        },
        {
          agent: 'browser',
          options: {
            headless: true,
            verifyExecution: true,
            captureScreenshots: true,
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
          priority: 6,
        },
      ],
      metadata: {
        useCase: 'XSS vulnerability hunting',
        targetAudience: 'Web security specialists',
        requirements: ['Web application in scope'],
      },
    };
  }
}

/**
 * SQLi Hunt Pattern
 * SQLi-focused workflow: Crawl → SQLi Agent → Confirm
 *
 * Use case: SQL Injection detection and exploitation
 * Duration: 20-30 minutes
 * Cost: $0.00
 */
export class SQLiHuntPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'SQL Injection Hunt',
      description:
        'SQL Injection detection with error-based, blind, and time-based techniques',
      tags: ['sqli', 'database', 'injection', 'blind', 'error-based'],
      estimatedDuration: '20-30 minutes',
      estimatedCost: '$0.00',
      steps: [
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
            depth: 3,
            maxUrls: 15000,
            jsRendering: false,
            extractForms: true,
            extractParams: true,
          },
          priority: 7,
        },
        {
          agent: 'sqli',
          options: {
            techniques: ['error-based', 'blind-boolean', 'blind-time', 'union'],
            dbTypes: ['mysql', 'postgresql', 'mssql', 'oracle'],
            riskLevel: 2,
            threads: 10,
          },
          priority: 8,
        },
        {
          agent: 'confirm',
          options: {
            verifyInjection: true,
            extractData: false, // Don't extract data, just confirm
            generatePoC: true,
          },
          priority: 8,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 5,
            minSeverity: 'high',
          },
          priority: 7,
        },
      ],
      metadata: {
        useCase: 'SQL Injection vulnerability hunting',
        targetAudience: 'Database security specialists, pentesters',
        requirements: ['Database-backed application in scope'],
      },
    };
  }
}

/**
 * Auth Bypass Pattern
 * Auth-focused workflow: Crawl → Scanner(auth templates) → Confirm
 *
 * Use case: Authentication and authorization bypass testing
 * Duration: 15-20 minutes
 * Cost: $0.00
 */
export class AuthBypassPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Authentication Bypass Hunt',
      description:
        'Authentication and authorization bypass testing including IDOR, privilege escalation',
      tags: ['auth', 'bypass', 'idor', 'privilege-escalation', 'access-control'],
      estimatedDuration: '15-20 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
          },
          priority: 7,
        },
        {
          agent: 'crawl',
          options: {
            depth: 3,
            maxUrls: 10000,
            jsRendering: true,
            extractForms: true,
            extractAPIs: true,
          },
          priority: 7,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'comprehensive',
            templates: [
              '/app/tools/templates/http/vulnerabilities/auth-bypass/',
              '/app/tools/templates/http/exposures/tokens/',
              '/app/tools/templates/http/misconfiguration/',
            ],
            tier: 'tier1',
            concurrency: 300,
          },
          priority: 8,
        },
        {
          agent: 'apifuzz',
          options: {
            testIDOR: true,
            testPrivilegeEscalation: true,
            testJWTBypass: true,
            testSessionManagement: true,
          },
          priority: 8,
        },
        {
          agent: 'confirm',
          options: {
            verifyBypass: true,
            generatePoC: true,
          },
          priority: 8,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 5,
            minSeverity: 'high',
          },
          priority: 7,
        },
      ],
      metadata: {
        useCase: 'Authentication and authorization bypass testing',
        targetAudience: 'Application security specialists',
        requirements: ['Application with authentication'],
      },
    };
  }
}

/**
 * OSINT Pattern
 * Intelligence gathering: OSINT → Discovery → Fingerprint
 *
 * Use case: Open Source Intelligence gathering before active testing
 * Duration: 10-15 minutes
 * Cost: $0.00
 */
export class OSINTPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'OSINT Reconnaissance',
      description:
        'Open Source Intelligence gathering including leaked credentials, exposed data, social engineering vectors',
      tags: ['osint', 'reconnaissance', 'passive', 'intelligence'],
      estimatedDuration: '10-15 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'osint',
          options: {
            sources: ['github', 'pastebin', 'shodan', 'censys', 'crtsh'],
            checkLeakedCredentials: true,
            checkExposedData: true,
            checkSocialMedia: true,
            checkDNSHistory: true,
          },
          priority: 8,
        },
        {
          agent: 'discovery',
          options: {
            sources: ['chaosdb', 'subfinder', 'uncover'],
            maxAssets: 50000,
          },
          priority: 7,
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx', 'dnsx'],
            concurrency: 500,
            extractTech: true,
          },
          priority: 7,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 10,
            minSeverity: 'info',
          },
          priority: 6,
        },
      ],
      metadata: {
        useCase: 'Passive reconnaissance before active testing',
        targetAudience: 'Red teams, OSINT specialists',
        requirements: ['Target organization name/domain'],
      },
    };
  }
}

/**
 * JS Analysis Pattern
 * JavaScript-focused: Crawl → JSAnalysis → Scanner
 *
 * Use case: JavaScript analysis for secrets, endpoints, and vulnerabilities
 * Duration: 15-20 minutes
 * Cost: $0.00
 */
export class JSAnalysisPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'JavaScript Analysis',
      description:
        'JavaScript file analysis for secrets, API endpoints, and client-side vulnerabilities',
      tags: ['javascript', 'secrets', 'endpoints', 'client-side'],
      estimatedDuration: '15-20 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
          },
          priority: 7,
        },
        {
          agent: 'crawl',
          options: {
            depth: 2,
            maxUrls: 10000,
            jsRendering: true,
            extractJS: true,
            parallelInstances: 5,
          },
          priority: 7,
        },
        {
          agent: 'jsanalysis',
          options: {
            extractSecrets: true,
            extractEndpoints: true,
            extractSinks: true,
            extractSources: true,
            detectDOMXSS: true,
            beautify: true,
          },
          priority: 8,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'fast',
            templates: [
              '/app/tools/templates/exposures/tokens/',
              '/app/tools/templates/exposures/configs/',
            ],
            tier: 'tier1',
            concurrency: 300,
          },
          priority: 6,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 10,
            minSeverity: 'low',
          },
          priority: 5,
        },
      ],
      metadata: {
        useCase: 'JavaScript security analysis',
        targetAudience: 'Web security specialists, frontend security',
        requirements: ['JavaScript-heavy web application'],
      },
    };
  }
}

/**
 * Bug Bounty Speedrun Pattern
 * Optimized for quick wins: Fingerprint → Scanner(critical) → Triage
 *
 * Use case: Quick bounty wins on new programs
 * Duration: 5-10 minutes
 * Cost: $0.00
 */
export class BugBountySpeedrunPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Bug Bounty Speedrun',
      description:
        'Optimized workflow for quick bounty wins - focuses on low-hanging fruit and critical vulnerabilities',
      tags: ['speedrun', 'quick', 'bounty', 'low-hanging-fruit'],
      estimatedDuration: '5-10 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 1000,
            checkCDN: false,
          },
          priority: 9,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'fast',
            tier: 'tier1',
            concurrency: 1000,
            timeout: 5,
            templates: [
              '/app/tools/templates/cves/',
              '/app/tools/templates/exposures/',
              '/app/tools/templates/takeovers/',
            ],
          },
          priority: 9,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 20,
            minSeverity: 'high',
          },
          priority: 9,
        },
      ],
      metadata: {
        useCase: 'Quick bounty wins on new programs',
        targetAudience: 'Bug bounty hunters racing for first blood',
        requirements: ['New program or recently updated scope'],
      },
    };
  }
}

/**
 * Critical Only Pattern
 * High-severity focus: Discovery → Scanner(critical) → Confirm → Triage
 *
 * Use case: Focus only on critical/high severity findings
 * Duration: 15-20 minutes
 * Cost: $0.00
 */
export class CriticalOnlyPattern extends BasePattern {
  getDefinition(): Pattern {
    return {
      name: 'Critical Vulnerabilities Only',
      description:
        'Focus exclusively on critical and high severity vulnerabilities with verification',
      tags: ['critical', 'high-severity', 'verified', 'focused'],
      estimatedDuration: '15-20 minutes',
      estimatedCost: '$0.00',
      steps: [
        {
          agent: 'discovery',
          options: {
            sources: ['chaosdb', 'subfinder'],
            maxAssets: 50000,
          },
          priority: 7,
        },
        {
          agent: 'fingerprint',
          options: {
            tools: ['httpx'],
            concurrency: 500,
          },
          priority: 7,
        },
        {
          agent: 'scanner',
          options: {
            templateSet: 'comprehensive',
            tier: 'tier2',
            concurrency: 500,
            severity: ['critical', 'high'],
            templates: [
              '/app/tools/templates/cves/',
              '/app/tools/templates/vulnerabilities/',
            ],
          },
          priority: 8,
        },
        {
          agent: 'confirm',
          options: {
            verifyAll: true,
            generatePoC: true,
            timeout: 60,
          },
          priority: 9,
        },
        {
          agent: 'triage',
          options: {
            useAI: true,
            provider: 'gemini',
            batchSize: 5,
            minSeverity: 'high',
          },
          priority: 9,
        },
      ],
      metadata: {
        useCase: 'Focus on critical vulnerabilities only',
        targetAudience: 'Security teams with limited time',
        requirements: ['Target with potential critical vulnerabilities'],
      },
    };
  }
}

/**
 * Export all pattern implementations
 */
export const patterns = {
  // Original 5 patterns
  'full-recon': FullReconPattern,
  'quick-scan': QuickScanPattern,
  'deep-scan': DeepScanPattern,
  'wordpress-scan': WordPressScanPattern,
  'api-scan': APIScanPattern,
  // New advanced patterns
  'three-agent-swarm': ThreeAgentSwarmPattern,
  'cloud-security': CloudSecurityPattern,
  'ssrf-hunt': SSRFHuntPattern,
  'xss-hunt': XSSHuntPattern,
  'sqli-hunt': SQLiHuntPattern,
  'auth-bypass': AuthBypassPattern,
  'osint-recon': OSINTPattern,
  'js-analysis': JSAnalysisPattern,
  'bug-bounty-speedrun': BugBountySpeedrunPattern,
  'critical-only': CriticalOnlyPattern,
};

export default patterns;
