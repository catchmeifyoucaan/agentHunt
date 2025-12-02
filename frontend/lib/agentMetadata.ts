import { LucideIcon, Search, Globe, Zap, Fingerprint, Link, Wifi, Shield, MessageSquare, CheckCircle, Brain, Database, XCircle, Code, AlertTriangle, FileCode, Cloud, Key, Lock, Users, Eye, Package, Radio, Blocks, Settings, GitBranch, ArrowRight, Server, FileText, Activity, Terminal, Upload } from 'lucide-react';
import { AgentType } from '@/shared/types';

export interface AgentFormOption {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean' | 'file' | 'textarea';
  required?: boolean;
  default?: any;
  options?: { label: string; value: string }[];
  description?: string;
  placeholder?: string;
  min?: number;
  max?: number;
}

export interface AgentMetadata {
  type: AgentType;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'reconnaissance' | 'scanning' | 'exploitation' | 'analysis' | 'ai';
  color: string;
  formOptions: AgentFormOption[];
  examples?: string[];
}

export const AGENT_METADATA: Partial<Record<AgentType, AgentMetadata>> = {
  discovery: {
    type: 'discovery',
    name: 'Discovery',
    description: 'Passive reconnaissance using Chaos DB, Subfinder, and Uncover for asset discovery',
    icon: Search,
    category: 'reconnaissance',
    color: 'bg-blue-500',
    formOptions: [
      {
        name: 'domain',
        label: 'Target Domain',
        type: 'text',
        required: true,
        placeholder: 'example.com',
        description: 'Primary domain to discover assets for'
      },
      {
        name: 'sources',
        label: 'Data Sources',
        type: 'select',
        options: [
          { label: 'All Sources', value: 'all' },
          { label: 'Chaos DB Only', value: 'chaos' },
          { label: 'Subfinder Only', value: 'subfinder' },
          { label: 'Uncover Only', value: 'uncover' }
        ],
        default: 'all'
      }
    ],
    examples: ['Discover subdomains for bug bounty programs', 'Initial reconnaissance phase']
  },

  subdomain: {
    type: 'subdomain',
    name: 'Subdomain Enumeration',
    description: 'Active subdomain enumeration using Subfinder, Amass, and Assetfinder',
    icon: Globe,
    category: 'reconnaissance',
    color: 'bg-cyan-500',
    formOptions: [
      {
        name: 'domain',
        label: 'Target Domain',
        type: 'text',
        required: true,
        placeholder: 'example.com'
      },
      {
        name: 'recursive',
        label: 'Recursive Enumeration',
        type: 'boolean',
        default: false,
        description: 'Enable recursive subdomain discovery'
      },
      {
        name: 'timeout',
        label: 'Timeout (seconds)',
        type: 'number',
        default: 300,
        min: 60,
        max: 3600
      }
    ]
  },

  bruteforce: {
    type: 'bruteforce',
    name: 'DNS Brute Force',
    description: 'High-speed DNS brute-forcing with ShuffledDNS, MassDNS, and Alterx',
    icon: Zap,
    category: 'reconnaissance',
    color: 'bg-yellow-500',
    formOptions: [
      {
        name: 'domain',
        label: 'Target Domain',
        type: 'text',
        required: true,
        placeholder: 'example.com'
      },
      {
        name: 'wordlist',
        label: 'Wordlist',
        type: 'select',
        options: [
          { label: 'Small (1K)', value: 'small' },
          { label: 'Medium (10K)', value: 'medium' },
          { label: 'Large (100K)', value: 'large' },
          { label: 'Custom', value: 'custom' }
        ],
        default: 'medium'
      },
      {
        name: 'resolvers',
        label: 'DNS Resolvers',
        type: 'number',
        default: 10,
        min: 1,
        max: 100,
        description: 'Number of DNS resolvers to use'
      }
    ]
  },

  fingerprint: {
    type: 'fingerprint',
    name: 'Fingerprinting',
    description: 'Web technology fingerprinting using httpx, tlsx, Wappalyzer, and CDN detection',
    icon: Fingerprint,
    category: 'reconnaissance',
    color: 'bg-purple-500',
    formOptions: [
      {
        name: 'inputUrlsFile',
        label: 'Input URLs File',
        type: 'file',
        required: true,
        description: 'S3 path or local file with URLs to fingerprint'
      },
      {
        name: 'probeHTTP',
        label: 'Probe HTTP',
        type: 'boolean',
        default: true
      },
      {
        name: 'probeHTTPS',
        label: 'Probe HTTPS',
        type: 'boolean',
        default: true
      },
      {
        name: 'detectCDN',
        label: 'Detect CDN',
        type: 'boolean',
        default: true
      }
    ]
  },

  crawl: {
    type: 'crawl',
    name: 'Web Crawler',
    description: 'Intelligent web crawling and link discovery',
    icon: Link,
    category: 'reconnaissance',
    color: 'bg-green-500',
    formOptions: [
      {
        name: 'startUrl',
        label: 'Start URL',
        type: 'text',
        required: true,
        placeholder: 'https://example.com'
      },
      {
        name: 'maxDepth',
        label: 'Maximum Depth',
        type: 'number',
        default: 3,
        min: 1,
        max: 10
      },
      {
        name: 'respectRobots',
        label: 'Respect robots.txt',
        type: 'boolean',
        default: true
      },
      {
        name: 'followExternal',
        label: 'Follow External Links',
        type: 'boolean',
        default: false
      }
    ]
  },

  portscan: {
    type: 'portscan',
    name: 'Port Scanner',
    description: 'Network port scanning and service detection',
    icon: Wifi,
    category: 'scanning',
    color: 'bg-red-500',
    formOptions: [
      {
        name: 'targets',
        label: 'Target Hosts',
        type: 'textarea',
        required: true,
        placeholder: '192.168.1.0/24\nexample.com',
        description: 'One target per line (IPs, CIDRs, or hostnames)'
      },
      {
        name: 'ports',
        label: 'Port Range',
        type: 'select',
        options: [
          { label: 'Top 100', value: 'top100' },
          { label: 'Top 1000', value: 'top1000' },
          { label: 'All Ports', value: 'all' },
          { label: 'Custom', value: 'custom' }
        ],
        default: 'top1000'
      },
      {
        name: 'scanSpeed',
        label: 'Scan Speed',
        type: 'select',
        options: [
          { label: 'Slow (Stealthy)', value: 'slow' },
          { label: 'Normal', value: 'normal' },
          { label: 'Fast', value: 'fast' },
          { label: 'Aggressive', value: 'aggressive' }
        ],
        default: 'normal'
      }
    ]
  },

  scanner: {
    type: 'scanner',
    name: 'Nuclei Scanner',
    description: 'Vulnerability scanning with Nuclei templates (tier-gated: tier0-tier3)',
    icon: Shield,
    category: 'scanning',
    color: 'bg-orange-500',
    formOptions: [
      {
        name: 'inputUrlsFile',
        label: 'Input URLs File',
        type: 'file',
        required: true,
        description: 'S3 path or file with URLs to scan'
      },
      {
        name: 'templateSet',
        label: 'Template Set',
        type: 'select',
        options: [
          { label: 'Fast (Quick Scan)', value: 'fast' },
          { label: 'Default', value: 'default' },
          { label: 'Deep (Comprehensive)', value: 'deep' },
          { label: 'Custom', value: 'custom' }
        ],
        default: 'default'
      },
      {
        name: 'tier',
        label: 'Scan Tier',
        type: 'select',
        options: [
          { label: 'Tier 0 (Safe)', value: 'tier0' },
          { label: 'Tier 1 (Low Risk)', value: 'tier1' },
          { label: 'Tier 2 (Medium Risk)', value: 'tier2' },
          { label: 'Tier 3 (Aggressive)', value: 'tier3' }
        ],
        default: 'tier1',
        description: 'Higher tiers may trigger IDS/IPS systems'
      },
      {
        name: 'concurrency',
        label: 'Concurrency',
        type: 'number',
        default: 50,
        min: 1,
        max: 200
      },
      {
        name: 'interactshEnabled',
        label: 'Enable Interactsh',
        type: 'boolean',
        default: false,
        description: 'Enable OOB interaction testing'
      }
    ]
  },

  interact: {
    type: 'interact',
    name: 'Interaction Testing',
    description: 'Out-of-band (OOB) interaction testing for blind vulnerabilities',
    icon: MessageSquare,
    category: 'exploitation',
    color: 'bg-pink-500',
    formOptions: [
      {
        name: 'pollInterval',
        label: 'Poll Interval (seconds)',
        type: 'number',
        default: 30,
        min: 10,
        max: 300
      },
      {
        name: 'duration',
        label: 'Test Duration (minutes)',
        type: 'number',
        default: 60,
        min: 5,
        max: 480
      }
    ]
  },

  confirm: {
    type: 'confirm',
    name: 'Vulnerability Confirmation',
    description: 'Automated vulnerability confirmation and validation',
    icon: CheckCircle,
    category: 'exploitation',
    color: 'bg-teal-500',
    formOptions: [
      {
        name: 'findingId',
        label: 'Finding ID',
        type: 'text',
        required: true,
        placeholder: 'UUID of finding to confirm'
      },
      {
        name: 'confirmationMethod',
        label: 'Confirmation Method',
        type: 'select',
        options: [
          { label: 'Automated', value: 'auto' },
          { label: 'Manual', value: 'manual' },
          { label: 'Hybrid', value: 'hybrid' }
        ],
        default: 'auto'
      }
    ]
  },

  triage: {
    type: 'triage',
    name: 'AI Triage',
    description: 'AI-powered vulnerability analysis and prioritization using Claude',
    icon: Brain,
    category: 'ai',
    color: 'bg-indigo-500',
    formOptions: [
      {
        name: 'findingsFile',
        label: 'Findings File',
        type: 'file',
        required: true,
        description: 'JSON file with findings to triage'
      },
      {
        name: 'aiModel',
        label: 'AI Model',
        type: 'select',
        options: [
          { label: 'Claude 3.5 Sonnet', value: 'claude-3-5-sonnet-20241022' },
          { label: 'Claude 3 Opus', value: 'claude-3-opus-20240229' },
          { label: 'Gemini Pro', value: 'gemini-pro' }
        ],
        default: 'claude-3-5-sonnet-20241022'
      },
      {
        name: 'includeRiskScoring',
        label: 'Include Risk Scoring',
        type: 'boolean',
        default: true,
        description: 'Generate AI-powered risk scores'
      },
      {
        name: 'generateReport',
        label: 'Generate Report',
        type: 'boolean',
        default: true
      }
    ]
  },

  manager: {
    type: 'manager',
    name: 'Manager AI',
    description: 'Conversational AI orchestrator for intelligent agent coordination',
    icon: Brain,
    category: 'ai',
    color: 'bg-violet-500',
    formOptions: [
      {
        name: 'objective',
        label: 'Security Objective',
        type: 'textarea',
        required: true,
        placeholder: 'Describe your security testing goals...',
        description: 'What do you want the AI to accomplish?'
      },
      {
        name: 'scope',
        label: 'Scope',
        type: 'textarea',
        placeholder: 'example.com\n*.example.com',
        description: 'Target scope (domains, IPs, URLs)'
      },
      {
        name: 'autonomyLevel',
        label: 'Autonomy Level',
        type: 'select',
        options: [
          { label: 'Supervised (Ask before actions)', value: 'supervised' },
          { label: 'Semi-Autonomous', value: 'semi' },
          { label: 'Fully Autonomous', value: 'full' }
        ],
        default: 'semi'
      }
    ]
  },

  osint: {
    type: 'osint',
    name: 'OSINT',
    description: 'Open-source intelligence gathering and reconnaissance',
    icon: Database,
    category: 'reconnaissance',
    color: 'bg-slate-500',
    formOptions: [
      {
        name: 'target',
        label: 'OSINT Target',
        type: 'text',
        required: true,
        placeholder: 'Domain, email, username, or organization'
      },
      {
        name: 'sources',
        label: 'Intelligence Sources',
        type: 'select',
        options: [
          { label: 'All Sources', value: 'all' },
          { label: 'Social Media', value: 'social' },
          { label: 'Code Repositories', value: 'code' },
          { label: 'Breach Data', value: 'breaches' },
          { label: 'DNS Records', value: 'dns' }
        ],
        default: 'all'
      }
    ]
  },

  xss: {
    type: 'xss',
    name: 'XSS Testing',
    description: 'Cross-site scripting (XSS) vulnerability detection and exploitation',
    icon: XCircle,
    category: 'exploitation',
    color: 'bg-rose-500',
    formOptions: [
      {
        name: 'targetUrls',
        label: 'Target URLs',
        type: 'file',
        required: true,
        description: 'File containing URLs to test for XSS'
      },
      {
        name: 'payloadSet',
        label: 'Payload Set',
        type: 'select',
        options: [
          { label: 'Basic', value: 'basic' },
          { label: 'Advanced', value: 'advanced' },
          { label: 'WAF Bypass', value: 'waf-bypass' },
          { label: 'Polyglot', value: 'polyglot' }
        ],
        default: 'advanced'
      },
      {
        name: 'xssType',
        label: 'XSS Type',
        type: 'select',
        options: [
          { label: 'All Types', value: 'all' },
          { label: 'Reflected', value: 'reflected' },
          { label: 'Stored', value: 'stored' },
          { label: 'DOM-based', value: 'dom' }
        ],
        default: 'all'
      }
    ]
  },

  sqli: {
    type: 'sqli',
    name: 'SQL Injection',
    description: 'SQL injection vulnerability detection and exploitation',
    icon: Code,
    category: 'exploitation',
    color: 'bg-red-600',
    formOptions: [
      {
        name: 'targetUrls',
        label: 'Target URLs',
        type: 'file',
        required: true,
        description: 'File with URLs containing parameters to test'
      },
      {
        name: 'dbmsType',
        label: 'Database Type',
        type: 'select',
        options: [
          { label: 'Auto-detect', value: 'auto' },
          { label: 'MySQL', value: 'mysql' },
          { label: 'PostgreSQL', value: 'postgresql' },
          { label: 'MSSQL', value: 'mssql' },
          { label: 'Oracle', value: 'oracle' },
          { label: 'MongoDB', value: 'mongodb' }
        ],
        default: 'auto'
      },
      {
        name: 'injectionTechnique',
        label: 'Injection Technique',
        type: 'select',
        options: [
          { label: 'All Techniques', value: 'all' },
          { label: 'Boolean-based', value: 'boolean' },
          { label: 'Time-based', value: 'time' },
          { label: 'Error-based', value: 'error' },
          { label: 'Union-based', value: 'union' }
        ],
        default: 'all'
      }
    ]
  },

  webvulns: {
    type: 'webvulns',
    name: 'Web Vulnerabilities',
    description: 'General web application vulnerability scanning (LFI, RCE, SSRF, etc.)',
    icon: AlertTriangle,
    category: 'exploitation',
    color: 'bg-amber-600',
    formOptions: [
      {
        name: 'targetUrls',
        label: 'Target URLs',
        type: 'file',
        required: true
      },
      {
        name: 'vulnCategories',
        label: 'Vulnerability Categories',
        type: 'select',
        options: [
          { label: 'All Categories', value: 'all' },
          { label: 'LFI/RFI', value: 'file-inclusion' },
          { label: 'RCE', value: 'rce' },
          { label: 'SSRF', value: 'ssrf' },
          { label: 'XXE', value: 'xxe' },
          { label: 'IDOR', value: 'idor' },
          { label: 'Open Redirect', value: 'redirect' }
        ],
        default: 'all'
      },
      {
        name: 'depth',
        label: 'Testing Depth',
        type: 'select',
        options: [
          { label: 'Surface', value: 'surface' },
          { label: 'Standard', value: 'standard' },
          { label: 'Deep', value: 'deep' }
        ],
        default: 'standard'
      }
    ]
  },

  jsanalysis: {
    type: 'jsanalysis',
    name: 'JavaScript Analysis',
    description: 'JavaScript file analysis, secret extraction, and endpoint discovery',
    icon: FileCode,
    category: 'analysis',
    color: 'bg-yellow-600',
    formOptions: [
      {
        name: 'targetUrls',
        label: 'Target URLs',
        type: 'file',
        required: true,
        description: 'URLs or JS file paths to analyze'
      },
      {
        name: 'extractSecrets',
        label: 'Extract Secrets',
        type: 'boolean',
        default: true,
        description: 'Find API keys, tokens, credentials'
      },
      {
        name: 'extractEndpoints',
        label: 'Extract Endpoints',
        type: 'boolean',
        default: true,
        description: 'Discover API endpoints and URLs'
      },
      {
        name: 'beautify',
        label: 'Beautify Minified JS',
        type: 'boolean',
        default: true
      }
    ]
  },

  cloudmisconfig: {
    type: 'cloudmisconfig',
    name: 'Cloud Misconfiguration',
    description: 'Cloud infrastructure misconfiguration detection (AWS, Azure, GCP)',
    icon: Cloud,
    category: 'scanning',
    color: 'bg-sky-600',
    formOptions: [
      {
        name: 'cloudProvider',
        label: 'Cloud Provider',
        type: 'select',
        options: [
          { label: 'All Providers', value: 'all' },
          { label: 'AWS', value: 'aws' },
          { label: 'Azure', value: 'azure' },
          { label: 'GCP', value: 'gcp' },
          { label: 'DigitalOcean', value: 'do' }
        ],
        default: 'all',
        required: true
      },
      {
        name: 'targetDomain',
        label: 'Target Domain',
        type: 'text',
        required: true,
        placeholder: 'example.com'
      },
      {
        name: 'checkS3Buckets',
        label: 'Check S3 Buckets',
        type: 'boolean',
        default: true
      },
      {
        name: 'checkDatabases',
        label: 'Check Databases',
        type: 'boolean',
        default: true
      },
      {
        name: 'checkStorage',
        label: 'Check Storage',
        type: 'boolean',
        default: true
      }
    ]
  },

  apifuzzing: {
    type: 'apifuzzing',
    name: 'API Fuzzing',
    description: 'Automated API endpoint fuzzing and testing for injection vulnerabilities',
    icon: Zap,
    category: 'exploitation',
    color: 'bg-red-600',
    formOptions: [
      {
        name: 'apiEndpoints',
        label: 'API Endpoints',
        type: 'file',
        required: true,
        description: 'File containing API endpoints to fuzz',
        placeholder: '/path/to/endpoints.txt'
      },
      {
        name: 'wordlist',
        label: 'Fuzzing Wordlist',
        type: 'text',
        default: 'default',
        description: 'Wordlist for fuzzing parameters'
      },
      {
        name: 'threads',
        label: 'Threads',
        type: 'number',
        default: 10,
        min: 1,
        max: 50
      },
      {
        name: 'timeout',
        label: 'Timeout (seconds)',
        type: 'number',
        default: 30,
        min: 5,
        max: 300
      }
    ],
    examples: ['Fuzz REST API parameters', 'Test GraphQL mutations', 'Discover hidden API endpoints']
  },

  ssrf: {
    type: 'ssrf',
    name: 'SSRF Detection',
    description: 'Server-Side Request Forgery vulnerability detection and exploitation',
    icon: Link,
    category: 'exploitation',
    color: 'bg-red-700',
    formOptions: [
      {
        name: 'targets',
        label: 'Target URLs',
        type: 'file',
        required: true,
        description: 'URLs to test for SSRF vulnerabilities'
      },
      {
        name: 'oobServer',
        label: 'Out-of-Band Server',
        type: 'text',
        required: true,
        placeholder: 'https://your-interact.sh',
        description: 'Interact.sh or Burp Collaborator URL'
      },
      {
        name: 'payloadTypes',
        label: 'Payload Types',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'URL-based', value: 'url' },
          { label: 'Redirect', value: 'redirect' },
          { label: 'File Protocol', value: 'file' },
          { label: 'Cloud Metadata', value: 'cloud_metadata' }
        ],
        default: 'all'
      },
      {
        name: 'timeout',
        label: 'Timeout (seconds)',
        type: 'number',
        default: 10,
        min: 5,
        max: 60
      }
    ],
    examples: ['Test cloud metadata access', 'Detect internal network scanning', 'Find file read vulnerabilities']
  },

  deserialization: {
    type: 'deserialization',
    name: 'Deserialization Scan',
    description: 'Detect insecure deserialization vulnerabilities (Java, PHP, Python, Node.js)',
    icon: Package,
    category: 'exploitation',
    color: 'bg-red-800',
    formOptions: [
      {
        name: 'targets',
        label: 'Target URLs',
        type: 'file',
        required: true,
        description: 'URLs to test for deserialization flaws'
      },
      {
        name: 'languages',
        label: 'Target Languages',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Java', value: 'java' },
          { label: 'PHP', value: 'php' },
          { label: 'Python', value: 'python' },
          { label: 'Node.js', value: 'nodejs' },
          { label: '.NET', value: 'dotnet' }
        ],
        default: 'all'
      },
      {
        name: 'gadgetChains',
        label: 'Test Gadget Chains',
        type: 'boolean',
        default: true,
        description: 'Test known gadget chains for RCE'
      }
    ],
    examples: ['Detect Java deserialization', 'Test PHP unserialize', 'Find pickle vulnerabilities']
  },

  racecondition: {
    type: 'racecondition',
    name: 'Race Condition',
    description: 'Detect and exploit race condition vulnerabilities in concurrent operations',
    icon: Zap,
    category: 'exploitation',
    color: 'bg-orange-600',
    formOptions: [
      {
        name: 'targetUrl',
        label: 'Target URL',
        type: 'text',
        required: true,
        placeholder: 'https://example.com/api/transfer'
      },
      {
        name: 'requestMethod',
        label: 'HTTP Method',
        type: 'select',
        options: [
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'PATCH', value: 'PATCH' },
          { label: 'DELETE', value: 'DELETE' }
        ],
        default: 'POST'
      },
      {
        name: 'concurrentRequests',
        label: 'Concurrent Requests',
        type: 'number',
        default: 20,
        min: 2,
        max: 100,
        description: 'Number of parallel requests'
      },
      {
        name: 'iterations',
        label: 'Test Iterations',
        type: 'number',
        default: 10,
        min: 1,
        max: 50
      }
    ],
    examples: ['Test discount code reuse', 'Bypass rate limits', 'Double-spend vulnerabilities']
  },

  authbypass: {
    type: 'authbypass',
    name: 'Auth Bypass',
    description: 'Authentication and authorization bypass vulnerability detection',
    icon: Lock,
    category: 'exploitation',
    color: 'bg-red-500',
    formOptions: [
      {
        name: 'targetUrls',
        label: 'Protected URLs',
        type: 'file',
        required: true,
        description: 'URLs requiring authentication'
      },
      {
        name: 'testMethods',
        label: 'Test Methods',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Header Manipulation', value: 'headers' },
          { label: 'Path Traversal', value: 'path' },
          { label: 'HTTP Method Override', value: 'method' },
          { label: 'Token Manipulation', value: 'token' }
        ],
        default: 'all'
      },
      {
        name: 'checkIDOR',
        label: 'Check IDOR',
        type: 'boolean',
        default: true,
        description: 'Test for Insecure Direct Object References'
      }
    ],
    examples: ['Bypass JWT validation', 'Test IDOR vulnerabilities', 'Header injection auth bypass']
  },

  secrethunter: {
    type: 'secrethunter',
    name: 'Secret Hunter',
    description: 'Hunt for exposed API keys, tokens, credentials, and sensitive data',
    icon: Key,
    category: 'reconnaissance',
    color: 'bg-purple-600',
    formOptions: [
      {
        name: 'targetDomains',
        label: 'Target Domains',
        type: 'file',
        required: true,
        description: 'Domains to scan for secrets'
      },
      {
        name: 'scanGitHub',
        label: 'Scan GitHub',
        type: 'boolean',
        default: true,
        description: 'Search public GitHub repositories'
      },
      {
        name: 'scanJSFiles',
        label: 'Scan JavaScript Files',
        type: 'boolean',
        default: true
      },
      {
        name: 'scanConfigs',
        label: 'Scan Config Files',
        type: 'boolean',
        default: true,
        description: 'Search for .env, config.json, etc.'
      },
      {
        name: 'customPatterns',
        label: 'Custom Regex Patterns',
        type: 'textarea',
        placeholder: 'sk_live_\\w+\nAKIA[0-9A-Z]{16}',
        description: 'One pattern per line'
      }
    ],
    examples: ['Find AWS access keys', 'Discover Stripe API keys', 'Extract database credentials']
  },

  socialmediaosint: {
    type: 'socialmediaosint',
    name: 'Social Media OSINT',
    description: 'Open-source intelligence gathering from social media platforms',
    icon: Users,
    category: 'reconnaissance',
    color: 'bg-blue-600',
    formOptions: [
      {
        name: 'targetCompany',
        label: 'Target Company',
        type: 'text',
        required: true,
        placeholder: 'Example Corp'
      },
      {
        name: 'platforms',
        label: 'Platforms',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'LinkedIn', value: 'linkedin' },
          { label: 'Twitter/X', value: 'twitter' },
          { label: 'GitHub', value: 'github' },
          { label: 'Facebook', value: 'facebook' }
        ],
        default: 'all'
      },
      {
        name: 'searchEmployees',
        label: 'Search Employees',
        type: 'boolean',
        default: true
      },
      {
        name: 'searchRepos',
        label: 'Search Repositories',
        type: 'boolean',
        default: true
      }
    ],
    examples: ['Find employee emails', 'Discover tech stack', 'Identify key personnel']
  },

  visualrecon: {
    type: 'visualrecon',
    name: 'Visual Reconnaissance',
    description: 'Screenshot-based reconnaissance and visual similarity analysis',
    icon: Eye,
    category: 'reconnaissance',
    color: 'bg-indigo-600',
    formOptions: [
      {
        name: 'targetUrls',
        label: 'Target URLs',
        type: 'file',
        required: true,
        description: 'URLs to screenshot'
      },
      {
        name: 'resolution',
        label: 'Screenshot Resolution',
        type: 'select',
        options: [
          { label: 'Desktop (1920x1080)', value: '1920x1080' },
          { label: 'Tablet (1024x768)', value: '1024x768' },
          { label: 'Mobile (375x667)', value: '375x667' }
        ],
        default: '1920x1080'
      },
      {
        name: 'fullPage',
        label: 'Full Page Screenshot',
        type: 'boolean',
        default: false
      },
      {
        name: 'detectTech',
        label: 'Detect Technologies',
        type: 'boolean',
        default: true,
        description: 'Identify tech stack from screenshots'
      }
    ],
    examples: ['Screenshot all subdomains', 'Find login panels', 'Detect admin interfaces']
  },

  dependencyscan: {
    type: 'dependencyscan',
    name: 'Dependency Scan',
    description: 'Scan for vulnerable dependencies and outdated packages',
    icon: Package,
    category: 'analysis',
    color: 'bg-yellow-600',
    formOptions: [
      {
        name: 'targetRepos',
        label: 'Target Repositories',
        type: 'file',
        required: true,
        description: 'GitHub/GitLab repository URLs'
      },
      {
        name: 'packageManagers',
        label: 'Package Managers',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'npm/yarn', value: 'npm' },
          { label: 'pip', value: 'pip' },
          { label: 'maven', value: 'maven' },
          { label: 'composer', value: 'composer' },
          { label: 'go modules', value: 'go' }
        ],
        default: 'all'
      },
      {
        name: 'checkCVEs',
        label: 'Check CVEs',
        type: 'boolean',
        default: true
      },
      {
        name: 'onlyHighSeverity',
        label: 'Only High/Critical',
        type: 'boolean',
        default: false
      }
    ],
    examples: ['Find vulnerable npm packages', 'Scan Python dependencies', 'Check outdated libraries']
  },

  ctmonitor: {
    type: 'ctmonitor',
    name: 'Certificate Transparency Monitor',
    description: 'Monitor Certificate Transparency logs for new subdomains and certificates',
    icon: Radio,
    category: 'reconnaissance',
    color: 'bg-green-600',
    formOptions: [
      {
        name: 'domain',
        label: 'Domain to Monitor',
        type: 'text',
        required: true,
        placeholder: 'example.com'
      },
      {
        name: 'includeSubdomains',
        label: 'Include Subdomains',
        type: 'boolean',
        default: true
      },
      {
        name: 'checkInterval',
        label: 'Check Interval (hours)',
        type: 'number',
        default: 24,
        min: 1,
        max: 168,
        description: 'How often to check CT logs'
      },
      {
        name: 'notifyNewCerts',
        label: 'Notify on New Certificates',
        type: 'boolean',
        default: true
      }
    ],
    examples: ['Monitor new subdomains', 'Track SSL certificate changes', 'Discover new infrastructure']
  },

  wafbypass: {
    type: 'wafbypass',
    name: 'WAF Bypass',
    description: 'Web Application Firewall detection and bypass techniques',
    icon: Shield,
    category: 'exploitation',
    color: 'bg-orange-700',
    formOptions: [
      {
        name: 'targetUrl',
        label: 'Target URL',
        type: 'text',
        required: true,
        placeholder: 'https://example.com'
      },
      {
        name: 'attackType',
        label: 'Attack Type',
        type: 'select',
        options: [
          { label: 'SQL Injection', value: 'sqli' },
          { label: 'XSS', value: 'xss' },
          { label: 'Command Injection', value: 'cmdi' },
          { label: 'Path Traversal', value: 'lfi' }
        ],
        required: true
      },
      {
        name: 'bypassTechniques',
        label: 'Bypass Techniques',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Encoding', value: 'encoding' },
          { label: 'Case Manipulation', value: 'case' },
          { label: 'Comment Injection', value: 'comments' },
          { label: 'HTTP Header Manipulation', value: 'headers' }
        ],
        default: 'all'
      }
    ],
    examples: ['Detect Cloudflare WAF', 'Bypass ModSecurity', 'Test WAF evasion']
  },

  iacscan: {
    type: 'iacscan',
    name: 'IaC Security Scan',
    description: 'Infrastructure as Code security scanning (Terraform, CloudFormation, K8s)',
    icon: Blocks,
    category: 'analysis',
    color: 'bg-teal-600',
    formOptions: [
      {
        name: 'targetRepos',
        label: 'Repository URLs',
        type: 'file',
        required: true,
        description: 'Git repositories containing IaC'
      },
      {
        name: 'iacType',
        label: 'IaC Type',
        type: 'select',
        options: [
          { label: 'All', value: 'all' },
          { label: 'Terraform', value: 'terraform' },
          { label: 'CloudFormation', value: 'cloudformation' },
          { label: 'Kubernetes', value: 'k8s' },
          { label: 'Docker', value: 'docker' },
          { label: 'Ansible', value: 'ansible' }
        ],
        default: 'all'
      },
      {
        name: 'checkCompliance',
        label: 'Check Compliance',
        type: 'boolean',
        default: true,
        description: 'Check CIS benchmarks and best practices'
      },
      {
        name: 'scanSecrets',
        label: 'Scan for Secrets',
        type: 'boolean',
        default: true
      }
    ],
    examples: ['Scan Terraform for misconfigs', 'Audit Kubernetes manifests', 'Find hardcoded secrets in IaC']
  },

  clickjacking: {
    type: 'clickjacking',
    name: 'Clickjacking',
    description: 'Detects UI redress attacks and missing frame protection headers',
    icon: AlertTriangle,
    category: 'exploitation',
    color: 'bg-orange-500',
    formOptions: [
      {
        name: 'urls',
        label: 'Target URLs',
        type: 'textarea',
        required: true,
        placeholder: 'https://example.com/login'
      },
      {
        name: 'testFrameBusting',
        label: 'Test Frame Busting',
        type: 'boolean',
        default: true
      }
    ]
  },
  'dns-rebinding': {
    type: 'dns-rebinding',
    name: 'DNS Rebinding',
    description: 'Tests for DNS rebinding vulnerabilities to bypass SOP',
    icon: Globe,
    category: 'exploitation',
    color: 'bg-purple-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'crlf-injection': {
    type: 'crlf-injection',
    name: 'CRLF Injection',
    description: 'Detects HTTP Response Splitting and Header Injection',
    icon: Code,
    category: 'exploitation',
    color: 'bg-red-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'open-redirect': {
    type: 'open-redirect',
    name: 'Open Redirect',
    description: 'Scans for unvalidated redirects and forwards',
    icon: ArrowRight,
    category: 'exploitation',
    color: 'bg-yellow-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  lfirfi: {
    type: 'lfirfi',
    name: 'LFI / RFI',
    description: 'Local and Remote File Inclusion vulnerability scanner',
    icon: FileCode,
    category: 'exploitation',
    color: 'bg-red-600',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'nosql-injection': {
    type: 'nosql-injection',
    name: 'NoSQL Injection',
    description: 'Detects injection vulnerabilities in NoSQL databases like MongoDB',
    icon: Database,
    category: 'exploitation',
    color: 'bg-green-600',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'host-header-injection': {
    type: 'host-header-injection',
    name: 'Host Header Injection',
    description: 'Tests for Host header manipulation vulnerabilities',
    icon: Server,
    category: 'exploitation',
    color: 'bg-blue-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'csv-injection': {
    type: 'csv-injection',
    name: 'CSV Injection',
    description: 'Detects formula injection in CSV export features',
    icon: FileText,
    category: 'exploitation',
    color: 'bg-gray-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'ldap-injection': {
    type: 'ldap-injection',
    name: 'LDAP Injection',
    description: 'Tests for LDAP query manipulation vulnerabilities',
    icon: Database,
    category: 'exploitation',
    color: 'bg-indigo-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'saml-injection': {
    type: 'saml-injection',
    name: 'SAML Injection',
    description: 'Tests for XML Signature Wrapping and SAML vulnerabilities',
    icon: Key,
    category: 'exploitation',
    color: 'bg-orange-600',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'web-cache-deception': {
    type: 'web-cache-deception',
    name: 'Web Cache Deception',
    description: 'Detects cache configuration vulnerabilities leaking sensitive data',
    icon: Cloud,
    category: 'exploitation',
    color: 'bg-cyan-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'mass-assignment': {
    type: 'mass-assignment',
    name: 'Mass Assignment',
    description: 'Tests for unauthorized parameter binding/auto-binding',
    icon: Code,
    category: 'exploitation',
    color: 'bg-pink-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'http-parameter-pollution': {
    type: 'http-parameter-pollution',
    name: 'HTTP Parameter Pollution',
    description: 'Tests for HPP vulnerabilities in GET/POST parameters',
    icon: Activity,
    category: 'exploitation',
    color: 'bg-violet-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'latex-injection': {
    type: 'latex-injection',
    name: 'LaTeX Injection',
    description: 'Detects code injection in LaTeX generation features',
    icon: FileCode,
    category: 'exploitation',
    color: 'bg-slate-600',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'xpath-injection': {
    type: 'xpath-injection',
    name: 'XPath Injection',
    description: 'Tests for XPath query manipulation in XML processing',
    icon: Code,
    category: 'exploitation',
    color: 'bg-emerald-600',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'command-injection': {
    type: 'command-injection',
    name: 'Command Injection',
    description: 'Detects OS command injection vulnerabilities',
    icon: Terminal,
    category: 'exploitation',
    color: 'bg-red-800',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  'file-upload': {
    type: 'file-upload',
    name: 'File Upload',
    description: 'Tests file upload forms for malicious file execution',
    icon: Upload,
    category: 'exploitation',
    color: 'bg-amber-500',
    formOptions: [
      {
        name: 'url',
        label: 'Target URL',
        type: 'text',
        required: true
      }
    ]
  },
  businesslogic: {
    type: 'businesslogic',
    name: 'Business Logic Testing',
    description: 'Detect business logic flaws and workflow vulnerabilities',
    icon: GitBranch,
    category: 'exploitation',
    color: 'bg-pink-600',
    formOptions: [
      {
        name: 'applicationUrl',
        label: 'Application URL',
        type: 'text',
        required: true,
        placeholder: 'https://example.com'
      },
      {
        name: 'workflowType',
        label: 'Workflow Type',
        type: 'select',
        options: [
          { label: 'E-commerce', value: 'ecommerce' },
          { label: 'Banking/Finance', value: 'finance' },
          { label: 'Social Media', value: 'social' },
          { label: 'Custom', value: 'custom' }
        ],
        required: true
      },
      {
        name: 'testCases',
        label: 'Test Cases',
        type: 'textarea',
        placeholder: 'Describe the business logic flows to test...',
        description: 'Custom test scenarios'
      },
      {
        name: 'checkPriceManipulation',
        label: 'Test Price Manipulation',
        type: 'boolean',
        default: true
      },
      {
        name: 'checkWorkflowBypass',
        label: 'Test Workflow Bypass',
        type: 'boolean',
        default: true
      }
    ],
    examples: ['Test payment bypass', 'Price manipulation', 'Workflow sequence bypass']
  }
};

export const AGENT_CATEGORIES = {
  reconnaissance: {
    label: 'Reconnaissance',
    description: 'Asset discovery and information gathering',
    color: 'blue'
  },
  scanning: {
    label: 'Scanning',
    description: 'Vulnerability scanning and detection',
    color: 'orange'
  },
  exploitation: {
    label: 'Exploitation',
    description: 'Active vulnerability testing',
    color: 'red'
  },
  analysis: {
    label: 'Analysis',
    description: 'Code and data analysis',
    color: 'yellow'
  },
  ai: {
    label: 'AI-Powered',
    description: 'Intelligent automation and triage',
    color: 'purple'
  }
};

export function getAgentMetadata(type: AgentType): AgentMetadata | undefined {
  return AGENT_METADATA[type];
}

export function getAgentsByCategory(category: AgentMetadata['category']): AgentMetadata[] {
  return Object.values(AGENT_METADATA).filter((agent): agent is AgentMetadata => agent !== undefined && agent.category === category);
}

export function getAllAgents(): AgentMetadata[] {
  return Object.values(AGENT_METADATA).filter((agent): agent is AgentMetadata => agent !== undefined);
}
