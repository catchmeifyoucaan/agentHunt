/**
 * Shared Types for AgentHunt Platform
 * All agents, workers, and services use these canonical types
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type AgentType = 'discovery' | 'subdomain' | 'bruteforce' | 'fingerprint' | 'crawl' | 'scanner' | 'interact' | 'confirm' | 'triage' | 'manager';
export type TemplateTier = 'tier0' | 'tier1' | 'tier2' | 'tier3';
export type ConfidenceLevel = number; // 0.0 to 1.0

// Program Configuration
export interface Program {
  id: string;
  name: string;
  slug: string;
  platform: 'hackerone' | 'bugcrowd' | 'intigriti' | 'yeswehack' | 'synack' | 'other';
  scope: ProgramScope;
  policy: ProgramPolicy;
  metadata: ProgramMetadata;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProgramScope {
  domains: string[];
  wildcardDomains: string[];
  excludedDomains: string[];
  ipRanges?: string[];
  asns?: string[];
  maxAssets: number;
}

export interface ProgramPolicy {
  allowedActions: {
    passiveDiscovery: boolean;
    activeDiscovery: boolean;
    bruteforce: boolean;
    portScanning: boolean;
    crawling: boolean;
    fuzzing: boolean;
    oobTesting: boolean;
  };
  allowedSources: string[];
  allowedTemplates: {
    tier0: boolean;
    tier1: boolean;
    tier2: boolean;
    tier3: boolean;
  };
  requireHumanApproval: {
    tier2: boolean;
    tier3: boolean;
    highSeverity: boolean;
    criticalSeverity: boolean;
  };
  rateLimit: {
    maxConcurrentScans: number;
    maxRequestsPerSecond: number;
    respectRateLimit: boolean;
  };
  notification: {
    telegram: boolean;
    email: boolean;
    webhook?: string;
  };
}

export interface ProgramMetadata {
  platform_url?: string;
  bounty_range?: string;
  tags?: string[];
  researchers?: string[];
  notes?: string;
}

// Asset Management
export interface Asset {
  id: string;
  programId: string;
  type: 'domain' | 'subdomain' | 'ip' | 'url' | 'port';
  value: string;
  source: string[];
  status: 'active' | 'inactive' | 'out_of_scope';
  metadata: AssetMetadata;
  firstSeen: Date;
  lastSeen: Date;
  lastScanned?: Date;
}

export interface AssetMetadata {
  resolved?: boolean;
  ipAddresses?: string[];
  cnames?: string[];
  technologies?: string[];
  httpStatus?: number;
  title?: string;
  server?: string;
  cdn?: string;
  tlsVersion?: string;
  certificates?: string[];
  tags?: string[];
}

// Finding Management
export interface Finding {
  id: string;
  programId: string;
  assetId: string;
  severity: Severity;
  confidence: ConfidenceLevel;
  title: string;
  description: string;
  cvss?: number;
  cwe?: string[];
  evidence: Evidence[];
  poc: PoC;
  impact: string;
  remediation: string;
  status: 'new' | 'triaged' | 'confirmed' | 'false_positive' | 'duplicate' | 'submitted' | 'accepted' | 'closed';
  confirmations: Confirmation[];
  triageResult?: TriageResult;
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface Evidence {
  type: 'request' | 'response' | 'screenshot' | 'log' | 'artifact';
  content?: string;
  url?: string;
  s3Key?: string;
  metadata?: Record<string, any>;
  timestamp: Date;
}

export interface PoC {
  steps: string[];
  curl?: string;
  payload?: string;
  reproductionRate: number; // 0.0 to 1.0
  notes?: string;
}

export interface Confirmation {
  id: string;
  method: 'template' | 'manual' | 'httpx_regex' | 'secondary_nuclei' | 'different_worker';
  result: 'pass' | 'fail' | 'error';
  details: string;
  workerId?: string;
  templateId?: string;
  timestamp: Date;
}

export interface TriageResult {
  agentVersion: string;
  promptVersion: string;
  rawOutput: string;
  normalizedFinding: any;
  severityReasoning: string;
  confidenceReasoning: string;
  suggestedConfirmations: string[];
  falsePositiveLikelihood: number;
  requiresHumanReview: boolean;
  aiModel: string;
  timestamp: Date;
}

// Job Schemas
export interface BaseJob {
  id: string;
  type: AgentType;
  programId: string;
  priority: number;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  workerId?: string;
  error?: string;
  metadata: JobMetadata;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}

export interface JobMetadata {
  requestedBy: string;
  parentJobId?: string;
  tags?: string[];
  estimatedDuration?: number;
  actualDuration?: number;
}

// Specific Job Types
export interface DiscoveryJob extends BaseJob {
  type: 'discovery';
  options: {
    sources: ('chaosdb' | 'subfinder' | 'uncover' | 'cloudlist')[];
    maxAssets: number;
    timeout?: number;
  };
}

export interface BruteforceJob extends BaseJob {
  type: 'bruteforce';
  options: {
    domains: string[];
    wordlists: string[];
    resolvers: string[];
    tools: ('shuffledns' | 'massdns' | 'alterx')[];
    concurrency: number;
  };
}

export interface SubdomainJob extends BaseJob {
  type: 'subdomain';
  options: {
    domains: string[];
    tools: ('subfinder' | 'amass' | 'assetfinder')[];
    maxResults?: number;
  };
}

export interface FingerprintJob extends BaseJob {
  type: 'fingerprint';
  options: {
    assets: string[];
    tools: ('httpx' | 'tlsx' | 'wappalyzergo' | 'cdncheck')[];
    concurrency: number;
    followRedirects: boolean;
  };
}

export interface CrawlJob extends BaseJob {
  type: 'crawl';
  options: {
    targetUrls: string[];
    depth: number;
    respectRobots: boolean;
    maxUrls?: number;
    timeout?: number;
  };
}

export interface ScannerJob extends BaseJob {
  type: 'scanner';
  options: {
    inputUrlsFile: string; // S3 key
    templateSet: 'fast' | 'fuzz' | 'custom';
    templates?: string[];
    tier: TemplateTier;
    concurrency: number;
    fingerprintConditions?: Record<string, any>;
    interactshEnabled: boolean;
  };
}

export interface ConfirmJob extends BaseJob {
  type: 'confirm';
  options: {
    findingId: string;
    methods: string[];
    requiredPasses: number;
    useDifferentWorker: boolean;
  };
}

export interface TriageJob extends BaseJob {
  type: 'triage';
  options: {
    rawOutputFile: string; // S3 key
    scannerJobId: string;
    useAI: boolean;
    temperature: number;
  };
}

// Events for real-time streaming
export interface BaseEvent {
  id: string;
  type: string;
  timestamp: Date;
  programId?: string;
  jobId?: string;
  workerId?: string;
}

export interface LogEvent extends BaseEvent {
  type: 'log';
  level: 'debug' | 'info' | 'warn' | 'error';
  tool: string;
  context: string;
  message: string;
}

export interface FindingEvent extends BaseEvent {
  type: 'finding';
  finding: Finding;
}

export interface JobEvent extends BaseEvent {
  type: 'job_status';
  job: Partial<BaseJob>;
}

export interface ProgressEvent extends BaseEvent {
  type: 'progress';
  operation: string;
  current: number;
  total: number;
  percentage: number;
  eta?: number;
}

export interface HumanActionRequest extends BaseEvent {
  type: 'human_action_request';
  action: string;
  reason: string;
  options: string[];
  requiredApproval: boolean;
  context: Record<string, any>;
}

// Manager AI Types
export interface ManagerCommand {
  id: string;
  command: string;
  programId?: string;
  userId: string;
  parsedIntent?: Intent;
  response?: string;
  executedActions?: Action[];
  timestamp: Date;
}

export interface Intent {
  action: string;
  entities: Record<string, any>;
  confidence: number;
}

export interface Action {
  type: string;
  params: Record<string, any>;
  result?: any;
  error?: string;
}

// Worker Types
export interface Worker {
  id: string;
  type: AgentType;
  status: 'idle' | 'busy' | 'error' | 'offline';
  currentJobId?: string;
  region?: string;
  ip?: string;
  capacity: number;
  jobsCompleted: number;
  lastHeartbeat: Date;
  metadata: Record<string, any>;
}

// Safety and Compliance
export interface SafetyCheck {
  id: string;
  jobId: string;
  checkType: 'template_tier' | 'rate_limit' | 'scope' | 'policy';
  passed: boolean;
  reason?: string;
  blockedActions?: string[];
  timestamp: Date;
}

export interface AuditLog {
  id: string;
  userId?: string;
  workerId?: string;
  action: string;
  resource: string;
  resourceId: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
  timestamp: Date;
}

// Tool Output Types
export interface ToolOutput {
  tool: string;
  version?: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  metadata?: Record<string, any>;
}

// Template Types
export interface NucleiTemplate {
  id: string;
  name: string;
  author: string[];
  severity: Severity;
  tier: TemplateTier;
  tags: string[];
  description: string;
  reference?: string[];
  classification?: {
    cwe?: string[];
    cve?: string[];
    cvss?: number;
  };
  requiredFingerprints?: string[];
  path: string;
}

// Notification Types
export interface Notification {
  id: string;
  type: 'telegram' | 'email' | 'webhook';
  severity: Severity;
  title: string;
  message: string;
  findingId?: string;
  programId: string;
  sent: boolean;
  sentAt?: Date;
  error?: string;
  createdAt: Date;
}
