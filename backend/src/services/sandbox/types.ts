/**
 * Sandbox Service Type Definitions
 * Defines types for safe code execution in isolated environments
 */

export type SandboxLanguage = 'python' | 'node' | 'go' | 'bash' | 'ruby';

export type SandboxEnvironment = 'isolated' | 'persistent' | 'shared';

export interface SandboxConfig {
  language: SandboxLanguage;
  environment: SandboxEnvironment;

  // Resource limits
  maxMemoryMB: number; // Max memory in MB (default: 512)
  maxCpuPercent: number; // Max CPU percentage (default: 50)
  timeoutMs: number; // Execution timeout in ms (default: 30000)

  // Network access
  allowNetwork: boolean; // Allow internet access (default: false)
  allowedHosts?: string[]; // Whitelist of allowed hosts if network enabled

  // File system
  workdir: string; // Working directory inside container
  readOnly: boolean; // Mount workdir as read-only (default: false)
  persistFiles: boolean; // Keep files after execution (default: false)

  // Dependencies
  autoInstall: boolean; // Auto-install dependencies (default: true)
  dependencies?: string[]; // Pre-install dependencies before execution

  // Security
  rootless: boolean; // Run as non-root user (default: true)
  seccompProfile?: string; // Custom seccomp profile
  capDrop?: string[]; // Drop Linux capabilities

  // Metadata
  agentId?: string; // Agent that requested execution
  jobId?: string; // Job ID for tracking
  tags?: Record<string, string>; // Custom tags
}

export interface SandboxExecutionRequest {
  // Code to execute
  code: string;

  // Execution config
  config: Partial<SandboxConfig>;

  // Input/output
  stdin?: string; // Input to pass to code
  files?: Record<string, string>; // Files to create before execution

  // Environment variables
  env?: Record<string, string>;
}

export interface SandboxExecutionResult {
  // Execution status
  success: boolean;
  exitCode: number;

  // Output
  stdout: string;
  stderr: string;

  // Files created/modified
  files?: Record<string, string>;

  // Resource usage
  resources: {
    memoryUsedMB: number;
    cpuPercent: number;
    executionTimeMs: number;
  };

  // Errors
  error?: string;
  killed?: boolean; // Was execution killed (timeout/OOM)
  killReason?: 'timeout' | 'oom' | 'signal';

  // Metadata
  containerId?: string;
  startedAt: Date;
  finishedAt: Date;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
  language: SandboxLanguage;

  // Lifecycle
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt?: Date;

  // Resource tracking
  executions: number;
  totalCpuTimeMs: number;
  totalMemoryMB: number;

  // Metadata
  agentId?: string;
  jobId?: string;
  persistent: boolean;
}

export interface ResourceMonitoringData {
  containerId: string;
  timestamp: Date;

  // CPU
  cpuPercent: number;
  cpuTimeMs: number;

  // Memory
  memoryUsedMB: number;
  memoryLimitMB: number;
  memoryPercent: number;

  // Network (if enabled)
  networkRxBytes?: number;
  networkTxBytes?: number;

  // I/O
  blockReadBytes?: number;
  blockWriteBytes?: number;
}

export interface CodeValidationResult {
  safe: boolean;
  errors: string[];
  warnings: string[];

  // Detected issues
  detectedImports?: string[]; // Potentially dangerous imports
  detectedSyscalls?: string[]; // Potentially dangerous system calls
  detectedNetworkCalls?: string[]; // Network operations detected
  detectedFileOps?: string[]; // File operations detected

  // Risk assessment
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  riskReasons: string[];
}

export interface SandboxStats {
  // Container stats
  totalContainers: number;
  runningContainers: number;
  idleContainers: number;

  // Execution stats
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  killedExecutions: number;

  // Resource usage
  totalCpuTimeMs: number;
  totalMemoryMB: number;
  averageExecutionTimeMs: number;

  // By language
  executionsByLanguage: Record<SandboxLanguage, number>;
}

export interface SandboxCleanupPolicy {
  // When to cleanup containers
  maxIdleTimeMs: number; // Kill idle containers after this time (default: 300000 = 5 min)
  maxContainerAge: number; // Kill containers after this age (default: 3600000 = 1 hour)
  maxTotalContainers: number; // Max total containers (default: 50)

  // What to cleanup
  cleanupOnExit: boolean; // Cleanup all containers on process exit (default: true)
  cleanupFailedContainers: boolean; // Remove failed containers immediately (default: true)
  persistentContainerTTL: number; // TTL for persistent containers (default: 86400000 = 24 hours)
}
