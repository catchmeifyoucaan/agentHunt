import { LucideIcon, Search, Globe, Zap, Fingerprint, Link, Wifi, Shield, MessageSquare, CheckCircle, Brain, Database, XCircle, Code, AlertTriangle, FileCode, Cloud } from 'lucide-react';
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

export const AGENT_METADATA: Record<AgentType, AgentMetadata> = {
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

export function getAgentMetadata(type: AgentType): AgentMetadata {
  return AGENT_METADATA[type];
}

export function getAgentsByCategory(category: AgentMetadata['category']): AgentMetadata[] {
  return Object.values(AGENT_METADATA).filter(agent => agent.category === category);
}

export function getAllAgents(): AgentMetadata[] {
  return Object.values(AGENT_METADATA);
}
