/**
 * Shared Types for AgentHunt Platform
 * All agents, workers, and services use these canonical types
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type JobStatus = 'pending' | 'active' | 'completed' | 'failed' | 'paused' | 'cancelled';
export type AgentType =
  | 'discovery'
  | 'subdomain'
  | 'bruteforce'
  | 'fingerprint'
  | 'crawl'
  | 'portscan'
  | 'scanner'
  | 'interact'
  | 'confirm'
  | 'triage'
  | 'manager'
  | 'osint'
  | 'xss'
  | 'sqli'
  | 'webvulns'
  | 'jsanalysis'
  | 'cloudmisconfig'
  | 'apifuzzing'
  | 'ssrf'
  | 'deserialization'
  | 'racecondition'
  | 'authbypass'
  | 'secrethunter'
  | 'socialmediaosint'
  | 'visualrecon'
  | 'dependencyscan'
  | 'ctmonitor'
  | 'wafbypass'
  | 'iacscan'
  | 'businesslogic';
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

export interface PortScanJob extends BaseJob {
  type: 'portscan';
  options: {
    targets: string[];
    ports?: string;
    rate?: number;
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

export interface InteractJob extends BaseJob {
  type: 'interact';
  options: {
    pollInterval: number; // seconds
    duration: number; // minutes
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

// ============================================================================
// ENHANCED PLATFORM FEATURES
// ============================================================================

// Ingestion Layer Types
export type DataSourceType = 'shodan' | 'zoomeye' | 'censys' | 'github' | 'gitlab' |
  'archiveorg' | 'ctlogs' | 'webhook' | 'cicd' | 'siem' | 'manual';

export interface DataSource {
  id: string;
  type: DataSourceType;
  name: string;
  enabled: boolean;
  config: DataSourceConfig;
  lastSync?: Date;
  syncInterval?: number; // minutes
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface DataSourceConfig {
  apiKey?: string;
  apiUrl?: string;
  query?: string;
  filters?: Record<string, any>;
  rateLimit?: number;
  region?: string;
  maxResults?: number;
}

export interface IngestionJob {
  id: string;
  sourceId: string;
  sourceType: DataSourceType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  assetsDiscovered: number;
  assetsNew: number;
  assetsUpdated: number;
  query?: string;
  filters?: Record<string, any>;
  error?: string;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
}

// Asset Graph Types
export interface AssetRelationship {
  id: string;
  sourceAssetId: string;
  targetAssetId: string;
  relationshipType: RelationType;
  confidence: number; // 0.0 to 1.0
  metadata: Record<string, any>;
  discoveredBy: string; // agent or source
  createdAt: Date;
}

export type RelationType =
  | 'subdomain_of'
  | 'resolves_to'
  | 'cname_to'
  | 'hosts'
  | 'links_to'
  | 'shares_cert_with'
  | 'same_asn'
  | 'same_org'
  | 'uses_technology'
  | 'depends_on'
  | 'related_to';

export interface AssetGraph {
  nodes: Asset[];
  edges: AssetRelationship[];
  metadata: {
    lastUpdated: Date;
    nodeCount: number;
    edgeCount: number;
  };
}

export interface AttackPath {
  id: string;
  startAssetId: string;
  endAssetId: string;
  hops: AssetRelationship[];
  findings: Finding[];
  riskScore: number;
  impact: string;
  exploitability: number;
  createdAt: Date;
}

// Human-in-the-Loop (HITL) Types
export interface ApprovalRequest {
  id: string;
  type: 'job_execution' | 'finding_submission' | 'policy_override' | 'high_risk_action';
  requestedBy: string; // agent or user
  jobId?: string;
  findingId?: string;
  action: string;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  context: Record<string, any>;
  requiredApprovers: number;
  approvers: Approval[];
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  expiresAt?: Date;
  createdAt: Date;
  resolvedAt?: Date;
}

export interface Approval {
  userId: string;
  decision: 'approve' | 'reject';
  comment?: string;
  timestamp: Date;
}

// Enhanced Audit & Evidence Store
export interface EvidenceArtifact {
  id: string;
  findingId?: string;
  jobId?: string;
  type: 'traffic_capture' | 'screenshot' | 'video' | 'log' | 'poc' | 'config' | 'scan_output';
  format: string; // pcap, png, mp4, json, etc.
  s3Key: string;
  hash: string; // SHA-256
  size: number; // bytes
  metadata: Record<string, any>;
  encrypted: boolean;
  retentionPolicy: 'permanent' | 'temporary' | 'compliance';
  retentionUntil?: Date;
  createdAt: Date;
}

export interface ImmutableAuditLog extends AuditLog {
  hash: string; // Hash of previous log entry (blockchain-style)
  signature?: string; // Optional cryptographic signature
  immutable: true;
}

// Policy & Legal Engine
export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  scope: 'global' | 'program' | 'asset' | 'target';
  targetId?: string; // program_id or asset_id
  ruleType: 'consent' | 'scope' | 'rate_limit' | 'time_window' | 'action_whitelist' | 'action_blacklist';
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  enabled: boolean;
  priority: number;
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface PolicyCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'not_contains' | 'greater_than' | 'less_than' | 'in' | 'not_in';
  value: any;
}

export interface PolicyAction {
  action: 'allow' | 'deny' | 'require_approval' | 'throttle' | 'log' | 'alert';
  params?: Record<string, any>;
}

export interface ConsentRecord {
  id: string;
  programId: string;
  assetId?: string;
  consentType: 'explicit' | 'implied' | 'bug_bounty_terms';
  scope: string[];
  restrictions: string[];
  grantedBy: string;
  evidence: string; // URL or reference to consent document
  validFrom: Date;
  validUntil?: Date;
  revoked: boolean;
  revokedAt?: Date;
  createdAt: Date;
}

// Multi-Model AI Ensemble
export type AIModel = 'claude' | 'gemini' | 'gpt4' | 'gpt5' | 'perplexity' | 'custom';

export interface ModelProvider {
  model: AIModel;
  apiKey: string;
  baseUrl?: string;
  maxTokens: number;
  temperature: number;
  timeout: number; // seconds
  enabled: boolean;
  priority: number; // for fallback ordering
}

export interface EnsembleTriageResult {
  findingId: string;
  modelResults: ModelTriageResult[];
  ensembleScore: number; // 0.0 to 1.0
  ensembleSeverity: Severity;
  ensembleConfidence: number;
  consensusLevel: number; // how much models agree (0.0 to 1.0)
  topRationales: string[];
  recommendedAction: 'auto_submit' | 'human_review' | 'dismiss' | 'retest';
  createdAt: Date;
}

export interface ModelTriageResult {
  model: AIModel;
  score: number;
  severity: Severity;
  confidence: number;
  rationale: string;
  suggestedActions: string[];
  processingTime: number; // milliseconds
  error?: string;
}

// Exploit Chain Discovery
export interface ExploitChain {
  id: string;
  programId: string;
  name: string;
  findings: string[]; // finding IDs
  path: AttackPath;
  overallRiskScore: number;
  impact: string;
  exploitability: number;
  steps: ExploitStep[];
  mitigations: string[];
  status: 'discovered' | 'validated' | 'submitted' | 'patched';
  createdAt: Date;
  updatedAt: Date;
}

export interface ExploitStep {
  order: number;
  findingId: string;
  description: string;
  requiredPrivileges: string;
  achievedPrivileges: string;
  techniques: string[]; // MITRE ATT&CK techniques
  poc?: string;
}

// External Integration Types
export interface ShodanResult {
  ip: string;
  port: number;
  protocol: string;
  banner: string;
  hostnames: string[];
  org: string;
  asn: string;
  location: {
    city?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  };
  vulnerabilities: string[];
  metadata: Record<string, any>;
}

export interface CTLogEntry {
  id: string;
  domain: string;
  issuer: string;
  notBefore: Date;
  notAfter: Date;
  subjectAltNames: string[];
  logSource: string;
  discoveredAt: Date;
}

export interface GitHubSecret {
  id: string;
  repository: string;
  filePath: string;
  lineNumber: number;
  secretType: 'api_key' | 'password' | 'token' | 'private_key' | 'certificate' | 'credential' | 'other';
  pattern: string;
  entropy: number;
  redactedValue: string;
  commitHash: string;
  commitDate: Date;
  author: string;
  severity: Severity;
  verified: boolean;
  createdAt: Date;
}

// Report Generation
export interface ReportTemplate {
  id: string;
  name: string;
  platform: 'hackerone' | 'bugcrowd' | 'intigriti' | 'yeswehack' | 'synack' | 'generic';
  format: 'markdown' | 'html' | 'pdf' | 'docx';
  sections: ReportSection[];
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReportSection {
  order: number;
  title: string;
  content: string; // Template string with variables
  required: boolean;
  aiGenerated: boolean; // If true, use AI to generate content
}

export interface GeneratedReport {
  id: string;
  findingId: string;
  templateId: string;
  platform: string;
  content: string;
  format: string;
  aiModel?: AIModel;
  humanReviewed: boolean;
  reviewedBy?: string;
  reviewNotes?: string;
  status: 'draft' | 'reviewed' | 'submitted' | 'accepted' | 'rejected';
  submittedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// Continuous Monitoring
export interface MonitoringTarget {
  id: string;
  programId: string;
  assetId: string;
  monitoringType: 'continuous' | 'periodic' | 'on_change';
  interval: number; // minutes
  checks: MonitoringCheck[];
  alertThreshold: Severity;
  enabled: boolean;
  lastCheck?: Date;
  nextCheck?: Date;
  createdAt: Date;
}

export interface MonitoringCheck {
  type: 'availability' | 'content_change' | 'certificate' | 'dns' | 'vulnerability' | 'technology';
  config: Record<string, any>;
  baseline?: any; // Baseline value to compare against
}

export interface MonitoringAlert {
  id: string;
  monitoringTargetId: string;
  assetId: string;
  alertType: string;
  severity: Severity;
  message: string;
  changes: Record<string, any>;
  actionRequired: boolean;
  autoRetestTriggered: boolean;
  acknowledged: boolean;
  acknowledgedBy?: string;
  createdAt: Date;
}

// Vulnerability Research Lab
export interface ResearchLab {
  id: string;
  name: string;
  type: 'container' | 'vm' | 'kubernetes';
  status: 'provisioning' | 'running' | 'stopped' | 'terminated';
  environment: {
    os: string;
    tools: string[];
    network: 'isolated' | 'internal' | 'external';
  };
  config: Record<string, any>;
  createdBy: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface LabExperiment {
  id: string;
  labId: string;
  name: string;
  type: 'poc_testing' | 'exploit_dev' | 'fuzzing' | 'sandbox';
  target: string;
  findings: string[]; // Associated finding IDs
  artifacts: string[]; // S3 keys
  results: Record<string, any>;
  status: 'running' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
}

// Distributed Scanning
export interface ScannerNode {
  id: string;
  region: string;
  ipAddress: string;
  proxyType?: 'socks5' | 'http' | 'https';
  status: 'active' | 'idle' | 'maintenance' | 'offline';
  capacity: number;
  currentLoad: number;
  supportedAgents: AgentType[];
  lastHeartbeat: Date;
  metadata: Record<string, any>;
}

export interface DistributedScan {
  id: string;
  jobId: string;
  nodes: string[]; // scanner node IDs
  strategy: 'round_robin' | 'least_loaded' | 'geographic' | 'random';
  ipRotation: boolean;
  aggregatedResults?: any;
  status: 'distributing' | 'running' | 'aggregating' | 'completed' | 'failed';
  createdAt: Date;
  completedAt?: Date;
}

// Advanced Agent Job Types
export interface SSRFDetectionJob extends BaseJob {
  type: 'ssrf';
  options: {
    targets: string[];
    oobServer: string; // interact.sh or similar
    payloadTypes: ('url' | 'redirect' | 'file' | 'cloud_metadata')[];
    timeout: number;
  };
}

export interface DeserializationJob extends BaseJob {
  type: 'deserialization';
  options: {
    targets: string[];
    languages: ('java' | 'python' | 'php' | 'dotnet' | 'ruby')[];
    payloadTypes: string[];
    sandboxed: boolean;
  };
}

export interface RaceConditionJob extends BaseJob {
  type: 'racecondition';
  options: {
    targetUrls: string[];
    concurrentRequests: number;
    iterations: number;
    detectionMethod: 'timing' | 'state' | 'resource';
  };
}

export interface AuthBypassJob extends BaseJob {
  type: 'authbypass';
  options: {
    targetUrls: string[];
    authMechanisms: ('jwt' | 'oauth' | 'saml' | 'session' | 'api_key')[];
    testTypes: ('signature' | 'algorithm' | 'expiry' | 'scope' | 'injection')[];
  };
}

export interface SecretHunterJob extends BaseJob {
  type: 'secrethunter';
  options: {
    repositories: string[];
    platforms: ('github' | 'gitlab' | 'bitbucket')[];
    scanDepth: 'shallow' | 'deep' | 'full_history';
    secretTypes: string[];
  };
}

export interface VisualReconJob extends BaseJob {
  type: 'visualrecon';
  options: {
    urls: string[];
    screenshotDiff: boolean;
    ocrEnabled: boolean;
    baselineUrls?: string[]; // For comparison
  };
}

export interface DependencyScanJob extends BaseJob {
  type: 'dependencyscan';
  options: {
    repositories: string[];
    packageManagers: ('npm' | 'pip' | 'maven' | 'composer' | 'rubygems' | 'go')[];
    checkTransitive: boolean;
    cveThreshold: Severity;
  };
}

export interface CTMonitorJob extends BaseJob {
  type: 'ctmonitor';
  options: {
    domains: string[];
    ctLogs: string[];
    alertOnNew: boolean;
    checkInterval: number; // hours
  };
}

export interface BusinessLogicJob extends BaseJob {
  type: 'businesslogic';
  options: {
    targetUrls: string[];
    workflows: WorkflowDefinition[];
    aiAnalysis: boolean;
  };
}

export interface WorkflowDefinition {
  name: string;
  steps: WorkflowStep[];
  expectedBehavior: string;
}

export interface WorkflowStep {
  order: number;
  action: string;
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: any;
  };
  expectedResponse: {
    status?: number;
    contains?: string[];
    notContains?: string[];
  };
}

// Control Plane & System Configuration
export interface SystemConfig {
  globalRateLimits: {
    requestsPerSecond: number;
    concurrentScans: number;
    maxWorkersPerType: Record<AgentType, number>;
  };
  blacklist: {
    domains: string[];
    ips: string[];
    asns: string[];
  };
  whitelist: {
    domains: string[];
    ips: string[];
  };
  modelGovernance: {
    defaultModel: AIModel;
    fallbackOrder: AIModel[];
    costLimits: Record<AIModel, number>; // USD per day
    rateLimits: Record<AIModel, number>; // requests per minute
  };
  security: {
    requireMfa: boolean;
    sessionTimeout: number; // minutes
    maxFailedLogins: number;
    ipWhitelist: string[];
  };
  storage: {
    retentionPolicies: {
      logs: number; // days
      findings: number; // days
      artifacts: number; // days
    };
    maxUploadSize: number; // MB
    s3Encryption: boolean;
  };
}

// Metrics & Observability
export interface SystemMetrics {
  timestamp: Date;
  jobs: {
    pending: number;
    active: number;
    completed: number;
    failed: number;
    avgDuration: number; // seconds
  };
  workers: {
    total: number;
    active: number;
    idle: number;
    offline: number;
  };
  findings: {
    total: number;
    bySeverity: Record<Severity, number>;
    falsePositiveRate: number;
    submissionRate: number;
  };
  performance: {
    apiLatency: number; // ms
    queueDepth: number;
    dbConnections: number;
    memoryUsage: number; // MB
    cpuUsage: number; // percentage
  };
  costs: {
    aiModels: Record<AIModel, number>; // USD
    infrastructure: number; // USD
    storage: number; // USD
    total: number; // USD
  };
}
