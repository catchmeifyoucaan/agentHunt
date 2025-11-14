/**
 * Knowledge Base Types - RAG System
 * Vector embeddings, semantic search, and knowledge storage
 */

export interface KnowledgeEntry {
  id: string;
  type: 'vulnerability' | 'exploit' | 'technique' | 'finding' | 'template' | 'tool';

  // Content
  title: string;
  description: string;
  content: string;

  // Metadata
  severity?: 'info' | 'low' | 'medium' | 'high' | 'critical';
  cveId?: string;
  cweId?: string;
  tags: string[];

  // Source
  source: 'internal' | 'cve' | 'exploitdb' | 'github' | 'nuclei' | 'manual';
  sourceUrl?: string;
  author?: string;

  // Embeddings
  embedding?: number[]; // Vector embedding for semantic search
  embeddingModel?: string;

  // Usage tracking
  timesUsed: number;
  successRate: number; // 0.0-1.0
  lastUsed?: Date;

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
}

export interface VulnerabilityKnowledge extends KnowledgeEntry {
  type: 'vulnerability';

  // Vulnerability details
  affectedSoftware?: string[];
  affectedVersions?: string[];
  cvss?: number;

  // Exploitation
  exploitAvailable: boolean;
  exploitDifficulty?: 'easy' | 'medium' | 'hard';
  requiresAuth: boolean;

  // Detection
  detectionSignatures?: string[];
  nucleiTemplateId?: string;

  // Remediation
  remediation?: string;
  patches?: string[];
}

export interface ExploitKnowledge extends KnowledgeEntry {
  type: 'exploit';

  // Exploit details
  targetVulnerability: string; // CVE ID or description
  language: 'python' | 'bash' | 'ruby' | 'javascript' | 'go' | 'other';
  framework?: string;

  // Code
  exploitCode: string;
  dependencies?: string[];

  // Effectiveness
  successRate: number;
  averageExecutionTime?: number;
  requiresInteraction: boolean;

  // Constraints
  requiresNetwork: boolean;
  requiresAuth: boolean;
  requiresPrivileges?: string;
}

export interface TechniqueKnowledge extends KnowledgeEntry {
  type: 'technique';

  // Technique details
  category: 'reconnaissance' | 'exploitation' | 'post-exploitation' | 'evasion' | 'other';
  mitreAttackId?: string; // MITRE ATT&CK technique ID

  // Steps
  steps: string[];
  prerequisites?: string[];

  // Tools
  requiredTools?: string[];
  optionalTools?: string[];

  // Indicators
  indicators?: string[]; // IoCs that might be generated
}

export interface SearchQuery {
  query: string;
  type?: KnowledgeEntry['type'];
  filters?: {
    severity?: string[];
    tags?: string[];
    source?: string[];
    requiresAuth?: boolean;
  };
  limit?: number;
  minSimilarity?: number; // 0.0-1.0 for vector similarity
}

export interface SearchResult {
  entry: KnowledgeEntry;
  score: number; // Similarity score 0.0-1.0
  relevance: string; // Why this result is relevant
}

export interface KnowledgeStats {
  totalEntries: number;
  byType: Record<KnowledgeEntry['type'], number>;
  bySource: Record<string, number>;
  averageSuccessRate: number;
  mostUsedEntries: Array<{ id: string; title: string; timesUsed: number }>;
  recentlyAdded: number; // Count in last 7 days
}

export interface EmbeddingRequest {
  text: string;
  model?: 'text-embedding-ada-002' | 'text-embedding-3-small' | 'text-embedding-3-large';
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  tokensUsed: number;
}

export interface LearningResult {
  success: boolean;
  entryId: string;
  previousSuccessRate: number;
  newSuccessRate: number;
  confidence: number;
  insights: string[];
}

export interface KnowledgeRecommendation {
  entry: KnowledgeEntry;
  reasoning: string;
  confidence: number;
  alternatives?: KnowledgeEntry[];
}
