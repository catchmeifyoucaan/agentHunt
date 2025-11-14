/**
 * Scope Parser Type Definitions
 */

export interface ParsedScope {
  // Targets
  targets: string[];              // All targets (domains, subdomains, IPs)
  domains: string[];
  subdomains: string[];
  wildcardDomains: string[];
  ipRanges: string[];
  ips: string[];
  urls: string[];

  // Exclusions
  outOfScope: string[];
  excludedDomains: string[];
  excludedPaths: string[];

  // Constraints
  constraints: {
    noDoS: boolean;
    maxRateLimit?: number;
    testingWindow?: {
      start: string;
      end: string;
      timezone?: string;
    };
    requireAuth: boolean;
    prohibitedActions?: string[];
  };

  // Credentials
  credentials: Record<string, {
    type: 'api_key' | 'login' | 'jwt' | 'bearer' | 'custom';
    value: string;
    notes?: string;
  }>;

  // Priorities
  priorities: string[];            // High-priority targets
  attackSurface?: AttackSurface;

  // Deliverables
  deliverables: string[];

  // Metadata
  metadata: {
    parsedFrom: 'pdf' | 'docx' | 'csv' | 'text';
    parsedAt: Date;
    totalPages?: number;
    confidence?: number;
  };
}

export interface AttackSurface {
  highValue: string[];      // High-value targets (admin panels, APIs)
  quickWins: string[];      // Low-hanging fruit
  deepDives: string[];      // Complex attack chains
  novel: string[];          // Novel attack vectors
}

export interface CSVScopeRow {
  type: 'domain' | 'subdomain' | 'ip_range' | 'exclude' | 'constraint' | 'credential' | 'priority' | 'deliverable';
  value: string;
  priority?: 'low' | 'medium' | 'high' | 'critical';
  notes?: string;
  constraint_details?: string;
}

export interface TestingConfig {
  programs: Array<{
    name: string;
    domains: string[];
    rateLimit: number;
    timeout: number;
    excludedPaths: string[];
    credentials: any | null;
    priority: 'low' | 'normal' | 'high';
  }>;
  globalConstraints: {
    noDoS: boolean;
    authenticated: boolean;
    reportFormat: string[];
  };
}
