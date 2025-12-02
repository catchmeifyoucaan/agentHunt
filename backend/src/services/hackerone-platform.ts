/**
 * HackerOne Platform Integration Service
 * 
 * Full integration with HackerOne API for:
 * 1. Program discovery and scope pulling
 * 2. Report drafting and submission
 * 3. Report management (comments, state changes)
 * 4. Bounty tracking
 * 5. Reputation and statistics
 * 
 * API Documentation: https://api.hackerone.com/
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import logger from '../utils/logger';
import database from './database';
import config from '../config';

// ============================================
// Types
// ============================================

export interface HackerOneCredentials {
  identifier: string; // API identifier (username)
  token: string;      // API token
}

export interface Program {
  id: string;
  handle: string;
  name: string;
  url: string;
  offersBounties: boolean;
  state: 'open' | 'paused' | 'soft_launched';
  
  // Scope
  inScope: ScopeAsset[];
  outOfScope: ScopeAsset[];
  
  // Policy
  policy: string;
  submissionState: 'open' | 'paused' | 'disabled';
  responseEfficiencyPercentage: number;
  
  // Bounty info
  minimumBounty?: number;
  maximumBounty?: number;
  averageBounty?: number;
  
  // Stats
  resolvedReportCount: number;
  totalBountiesPaid: number;
  
  // Dates
  launchedAt: Date;
  updatedAt: Date;
}

export interface ScopeAsset {
  id: string;
  assetType: 'URL' | 'CIDR' | 'DOMAIN' | 'WILDCARD' | 'API' | 'SOURCE_CODE' | 'MOBILE' | 'OTHER';
  assetIdentifier: string;
  eligibleForBounty: boolean;
  eligibleForSubmission: boolean;
  instruction?: string;
  maxSeverity?: 'critical' | 'high' | 'medium' | 'low' | 'none';
  confidentialityRequirement?: string;
  integrityRequirement?: string;
  availabilityRequirement?: string;
}

export interface ReportDraft {
  programHandle: string;
  title: string;
  vulnerabilityType: string;
  severity: {
    rating: 'none' | 'low' | 'medium' | 'high' | 'critical';
    attackVector?: string;
    attackComplexity?: string;
    privilegesRequired?: string;
    userInteraction?: string;
    scope?: string;
    confidentialityImpact?: string;
    integrityImpact?: string;
    availabilityImpact?: string;
  };
  weakness?: {
    cweId: string;
  };
  structuredScope?: {
    assetIdentifier: string;
  };
  vulnerabilityInformation: string; // Markdown report body
  impactStatement: string;
  stepsToReproduce: string[];
  supportingMaterial?: string[]; // URLs to attachments
  
  // Optional
  discoveredAt?: Date;
  cveIds?: string[];
}

export interface SubmittedReport {
  id: string;
  databaseId: number;
  title: string;
  state: 'new' | 'triaged' | 'needs-more-info' | 'resolved' | 'not-applicable' | 'informative' | 'duplicate' | 'spam';
  substate: string;
  severity: string;
  createdAt: Date;
  disclosedAt?: Date;
  bountyAwardedAt?: Date;
  awardedAmount?: number;
  programHandle: string;
  url: string;
}

export interface HackerProfile {
  id: string;
  username: string;
  name: string;
  reputation: number;
  signal: number;
  impact: number;
  rank: number;
  
  // Stats
  totalBountiesEarned: number;
  totalReportsSubmitted: number;
  resolvedReports: number;
  
  // Percentages
  signalPercentile: number;
  impactPercentile: number;
}

export interface APICapabilities {
  canReadPrograms: boolean;
  canReadScope: boolean;
  canSubmitReports: boolean;
  canReadOwnReports: boolean;
  canCommentOnReports: boolean;
  canUploadAttachments: boolean;
  canReadHacktivity: boolean;
  rateLimits: {
    requestsPerMinute: number;
    requestsPerHour: number;
  };
}

// ============================================
// HackerOne Platform Service
// ============================================

export class HackerOnePlatformService {
  private api: AxiosInstance;
  private credentials?: HackerOneCredentials;
  private authenticated: boolean = false;
  private capabilities?: APICapabilities;
  private profile?: HackerProfile;
  
  // Cache
  private programCache: Map<string, Program> = new Map();
  private scopeCache: Map<string, ScopeAsset[]> = new Map();
  private reportCache: Map<string, SubmittedReport> = new Map();

  constructor() {
    this.api = axios.create({
      baseURL: 'https://api.hackerone.com/v1',
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
    });

    // Add response interceptor for rate limiting
    this.api.interceptors.response.use(
      response => response,
      async (error: AxiosError) => {
        if (error.response?.status === 429) {
          const retryAfter = error.response.headers['retry-after'];
          logger.warn({ retryAfter }, 'HackerOne rate limit hit, waiting...');
          await this.sleep(parseInt(retryAfter as string) * 1000 || 60000);
          return this.api.request(error.config!);
        }
        throw error;
      }
    );
  }

  // ============================================
  // Authentication & Capabilities
  // ============================================

  /**
   * Authenticate with HackerOne API
   * Token format: identifier:token (base64 encoded)
   */
  async authenticate(identifier: string, token: string): Promise<boolean> {
    try {
      this.credentials = { identifier, token };
      const auth = Buffer.from(`${identifier}:${token}`).toString('base64');
      this.api.defaults.headers.common['Authorization'] = `Basic ${auth}`;
      
      // Test authentication by fetching profile
      const response = await this.api.get('/me');
      
      if (response.data?.id) {
        this.authenticated = true;
        this.profile = this.parseProfile(response.data);
        
        // Check capabilities
        this.capabilities = await this.checkCapabilities();
        
        logger.info({
          username: this.profile.username,
          reputation: this.profile.reputation,
          capabilities: this.capabilities,
        }, 'HackerOne API authenticated');
        
        return true;
      }
      
      return false;
    } catch (error: any) {
      logger.error({ error: error.message }, 'HackerOne authentication failed');
      this.authenticated = false;
      return false;
    }
  }

  /**
   * Check what the API token can do
   */
  private async checkCapabilities(): Promise<APICapabilities> {
    const capabilities: APICapabilities = {
      canReadPrograms: false,
      canReadScope: false,
      canSubmitReports: false,
      canReadOwnReports: false,
      canCommentOnReports: false,
      canUploadAttachments: false,
      canReadHacktivity: true, // Always public
      rateLimits: {
        requestsPerMinute: 60,
        requestsPerHour: 600,
      },
    };

    // Test each capability
    try {
      await this.api.get('/hackers/programs', { params: { page: { size: 1 } } });
      capabilities.canReadPrograms = true;
      capabilities.canReadScope = true;
    } catch (e) {}

    try {
      await this.api.get('/hackers/me/reports', { params: { page: { size: 1 } } });
      capabilities.canReadOwnReports = true;
    } catch (e) {}

    // Submission capability is inferred from being able to read programs
    capabilities.canSubmitReports = capabilities.canReadPrograms;
    capabilities.canCommentOnReports = capabilities.canReadOwnReports;
    capabilities.canUploadAttachments = capabilities.canSubmitReports;

    return capabilities;
  }

  /**
   * Get current API capabilities
   */
  getCapabilities(): APICapabilities | undefined {
    return this.capabilities;
  }

  /**
   * Get authenticated hacker profile
   */
  getProfile(): HackerProfile | undefined {
    return this.profile;
  }

  // ============================================
  // Program Discovery
  // ============================================

  /**
   * Get all programs the hacker can submit to
   */
  async getPrograms(options: {
    page?: number;
    size?: number;
    filter?: 'launched' | 'soft_launched' | 'all';
  } = {}): Promise<Program[]> {
    this.ensureAuthenticated();

    try {
      const response = await this.api.get('/hackers/programs', {
        params: {
          'page[number]': options.page || 1,
          'page[size]': options.size || 100,
        },
      });

      const programs = response.data.data.map((p: any) => this.parseProgram(p));
      
      // Cache programs
      for (const program of programs) {
        this.programCache.set(program.handle, program);
      }

      return programs;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch programs');
      throw error;
    }
  }

  /**
   * Get a specific program by handle
   */
  async getProgram(handle: string): Promise<Program | null> {
    // Check cache first
    if (this.programCache.has(handle)) {
      return this.programCache.get(handle)!;
    }

    this.ensureAuthenticated();

    try {
      const response = await this.api.get(`/programs/${handle}`);
      const program = this.parseProgram(response.data);
      this.programCache.set(handle, program);
      return program;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Search programs by keyword
   */
  async searchPrograms(query: string): Promise<Program[]> {
    this.ensureAuthenticated();

    try {
      const response = await this.api.get('/hackers/programs', {
        params: {
          'filter[keyword]': query,
          'page[size]': 50,
        },
      });

      return response.data.data.map((p: any) => this.parseProgram(p));
    } catch (error: any) {
      logger.error({ error: error.message, query }, 'Failed to search programs');
      throw error;
    }
  }

  // ============================================
  // Scope Management
  // ============================================

  /**
   * Get program scope (in-scope and out-of-scope assets)
   */
  async getProgramScope(handle: string): Promise<{
    inScope: ScopeAsset[];
    outOfScope: ScopeAsset[];
  }> {
    // Check cache
    const cacheKey = `scope:${handle}`;
    if (this.scopeCache.has(cacheKey)) {
      const cached = this.scopeCache.get(cacheKey)!;
      return {
        inScope: cached.filter(a => a.eligibleForSubmission),
        outOfScope: cached.filter(a => !a.eligibleForSubmission),
      };
    }

    this.ensureAuthenticated();

    try {
      const response = await this.api.get(`/programs/${handle}/structured_scopes`, {
        params: {
          'page[size]': 100,
        },
      });

      const assets = response.data.data.map((s: any) => this.parseScopeAsset(s));
      this.scopeCache.set(cacheKey, assets);

      return {
        inScope: assets.filter((a: ScopeAsset) => a.eligibleForSubmission),
        outOfScope: assets.filter((a: ScopeAsset) => !a.eligibleForSubmission),
      };
    } catch (error: any) {
      logger.error({ error: error.message, handle }, 'Failed to fetch program scope');
      throw error;
    }
  }

  /**
   * Check if a target is in scope for a program
   */
  async isInScope(handle: string, target: string): Promise<{
    inScope: boolean;
    matchedAsset?: ScopeAsset;
    reason?: string;
  }> {
    const scope = await this.getProgramScope(handle);

    // Check exact match first
    for (const asset of scope.inScope) {
      if (this.matchesAsset(target, asset)) {
        return {
          inScope: true,
          matchedAsset: asset,
        };
      }
    }

    // Check out-of-scope
    for (const asset of scope.outOfScope) {
      if (this.matchesAsset(target, asset)) {
        return {
          inScope: false,
          matchedAsset: asset,
          reason: 'Target matches out-of-scope asset',
        };
      }
    }

    return {
      inScope: false,
      reason: 'Target does not match any in-scope asset',
    };
  }

  private matchesAsset(target: string, asset: ScopeAsset): boolean {
    const identifier = asset.assetIdentifier.toLowerCase();
    const targetLower = target.toLowerCase();

    switch (asset.assetType) {
      case 'DOMAIN':
        return targetLower === identifier || targetLower.endsWith(`.${identifier}`);
      
      case 'WILDCARD':
        const pattern = identifier.replace(/\*/g, '.*');
        return new RegExp(`^${pattern}$`).test(targetLower);
      
      case 'URL':
        return targetLower.startsWith(identifier) || targetLower.includes(identifier);
      
      case 'CIDR':
        // Would need IP parsing library for proper CIDR matching
        return targetLower.includes(identifier.split('/')[0]);
      
      default:
        return targetLower.includes(identifier);
    }
  }

  // ============================================
  // Report Drafting & Submission
  // ============================================

  /**
   * Create a report draft (saved locally, not submitted)
   */
  async createDraft(draft: ReportDraft): Promise<string> {
    // Validate draft
    this.validateDraft(draft);

    // Generate draft ID
    const draftId = `draft-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Save to database
    await database.query(`
      INSERT INTO report_drafts (
        id, program_handle, title, vulnerability_type,
        severity, weakness_cwe, structured_scope,
        vulnerability_information, impact_statement,
        steps_to_reproduce, supporting_material,
        created_at, updated_at, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), 'draft')
    `, [
      draftId,
      draft.programHandle,
      draft.title,
      draft.vulnerabilityType,
      JSON.stringify(draft.severity),
      draft.weakness?.cweId,
      draft.structuredScope?.assetIdentifier,
      draft.vulnerabilityInformation,
      draft.impactStatement,
      draft.stepsToReproduce,
      draft.supportingMaterial,
    ]);

    logger.info({ draftId, program: draft.programHandle }, 'Report draft created');
    return draftId;
  }

  /**
   * Update an existing draft
   */
  async updateDraft(draftId: string, updates: Partial<ReportDraft>): Promise<void> {
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.title) {
      setClauses.push(`title = $${paramIndex++}`);
      values.push(updates.title);
    }
    if (updates.vulnerabilityInformation) {
      setClauses.push(`vulnerability_information = $${paramIndex++}`);
      values.push(updates.vulnerabilityInformation);
    }
    if (updates.impactStatement) {
      setClauses.push(`impact_statement = $${paramIndex++}`);
      values.push(updates.impactStatement);
    }
    if (updates.severity) {
      setClauses.push(`severity = $${paramIndex++}`);
      values.push(JSON.stringify(updates.severity));
    }
    if (updates.stepsToReproduce) {
      setClauses.push(`steps_to_reproduce = $${paramIndex++}`);
      values.push(updates.stepsToReproduce);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(draftId);

    await database.query(`
      UPDATE report_drafts 
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
    `, values);
  }

  /**
   * Get all drafts
   */
  async getDrafts(): Promise<ReportDraft[]> {
    const result = await database.query(`
      SELECT * FROM report_drafts 
      WHERE status = 'draft'
      ORDER BY updated_at DESC
    `);

    return result.rows.map(row => ({
      programHandle: row.program_handle,
      title: row.title,
      vulnerabilityType: row.vulnerability_type,
      severity: JSON.parse(row.severity || '{}'),
      weakness: row.weakness_cwe ? { cweId: row.weakness_cwe } : undefined,
      structuredScope: row.structured_scope ? { assetIdentifier: row.structured_scope } : undefined,
      vulnerabilityInformation: row.vulnerability_information,
      impactStatement: row.impact_statement,
      stepsToReproduce: row.steps_to_reproduce || [],
      supportingMaterial: row.supporting_material,
    }));
  }

  /**
   * Submit a report to HackerOne
   */
  async submitReport(draft: ReportDraft): Promise<SubmittedReport> {
    this.ensureAuthenticated();
    this.validateDraft(draft);

    // Check scope before submission
    const scopeCheck = await this.isInScope(
      draft.programHandle,
      draft.structuredScope?.assetIdentifier || ''
    );

    if (!scopeCheck.inScope && draft.structuredScope) {
      throw new Error(`Target ${draft.structuredScope.assetIdentifier} is not in scope: ${scopeCheck.reason}`);
    }

    try {
      // Build the report payload
      const payload = {
        data: {
          type: 'report',
          attributes: {
            team_handle: draft.programHandle,
            title: draft.title,
            vulnerability_information: this.buildReportBody(draft),
            severity_rating: draft.severity.rating,
            weakness_id: draft.weakness?.cweId ? parseInt(draft.weakness.cweId.replace('CWE-', '')) : undefined,
            structured_scope_id: scopeCheck.matchedAsset?.id,
          },
        },
      };

      // Add CVSS if provided
      if (draft.severity.attackVector) {
        (payload.data.attributes as any).severity = {
          attack_vector: draft.severity.attackVector,
          attack_complexity: draft.severity.attackComplexity,
          privileges_required: draft.severity.privilegesRequired,
          user_interaction: draft.severity.userInteraction,
          scope: draft.severity.scope,
          confidentiality_impact: draft.severity.confidentialityImpact,
          integrity_impact: draft.severity.integrityImpact,
          availability_impact: draft.severity.availabilityImpact,
        };
      }

      const response = await this.api.post('/reports', payload);
      
      const report = this.parseSubmittedReport(response.data.data);
      this.reportCache.set(report.id, report);

      logger.info({
        reportId: report.id,
        program: draft.programHandle,
        title: draft.title,
      }, 'Report submitted to HackerOne');

      // Update draft status
      await database.query(`
        UPDATE report_drafts 
        SET status = 'submitted', submitted_report_id = $1, submitted_at = NOW()
        WHERE program_handle = $2 AND title = $3 AND status = 'draft'
      `, [report.id, draft.programHandle, draft.title]);

      return report;
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        program: draft.programHandle,
      }, 'Failed to submit report');
      throw error;
    }
  }

  /**
   * Build the full report body from draft
   */
  private buildReportBody(draft: ReportDraft): string {
    let body = draft.vulnerabilityInformation;

    // Add steps to reproduce
    if (draft.stepsToReproduce.length > 0) {
      body += '\n\n## Steps to Reproduce\n\n';
      draft.stepsToReproduce.forEach((step, i) => {
        body += `${i + 1}. ${step}\n`;
      });
    }

    // Add impact
    if (draft.impactStatement) {
      body += `\n\n## Impact\n\n${draft.impactStatement}`;
    }

    // Add supporting materials
    if (draft.supportingMaterial && draft.supportingMaterial.length > 0) {
      body += '\n\n## Supporting Material/References\n\n';
      draft.supportingMaterial.forEach(url => {
        body += `- ${url}\n`;
      });
    }

    return body;
  }

  private validateDraft(draft: ReportDraft): void {
    if (!draft.programHandle) throw new Error('Program handle is required');
    if (!draft.title) throw new Error('Title is required');
    if (!draft.vulnerabilityInformation) throw new Error('Vulnerability information is required');
    if (!draft.severity?.rating) throw new Error('Severity rating is required');
    if (draft.title.length < 10) throw new Error('Title must be at least 10 characters');
    if (draft.vulnerabilityInformation.length < 100) {
      throw new Error('Vulnerability information must be at least 100 characters');
    }
  }

  // ============================================
  // Report Management
  // ============================================

  /**
   * Get all submitted reports
   */
  async getMyReports(options: {
    page?: number;
    size?: number;
    state?: string;
  } = {}): Promise<SubmittedReport[]> {
    this.ensureAuthenticated();

    try {
      const params: any = {
        'page[number]': options.page || 1,
        'page[size]': options.size || 100,
      };

      if (options.state) {
        params['filter[state][]'] = options.state;
      }

      const response = await this.api.get('/hackers/me/reports', { params });
      
      return response.data.data.map((r: any) => this.parseSubmittedReport(r));
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch reports');
      throw error;
    }
  }

  /**
   * Get a specific report
   */
  async getReport(reportId: string): Promise<SubmittedReport | null> {
    this.ensureAuthenticated();

    try {
      const response = await this.api.get(`/reports/${reportId}`);
      return this.parseSubmittedReport(response.data.data);
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Add a comment to a report
   */
  async addComment(reportId: string, message: string, internal: boolean = false): Promise<void> {
    this.ensureAuthenticated();

    try {
      await this.api.post(`/reports/${reportId}/activities`, {
        data: {
          type: 'activity-comment',
          attributes: {
            message,
            internal,
          },
        },
      });

      logger.info({ reportId }, 'Comment added to report');
    } catch (error: any) {
      logger.error({ error: error.message, reportId }, 'Failed to add comment');
      throw error;
    }
  }

  /**
   * Upload an attachment
   */
  async uploadAttachment(reportId: string, filename: string, content: Buffer, contentType: string): Promise<string> {
    this.ensureAuthenticated();

    try {
      // First, get upload URL
      const presignResponse = await this.api.post(`/reports/${reportId}/attachments`, {
        data: {
          type: 'attachment',
          attributes: {
            file_name: filename,
            content_type: contentType,
          },
        },
      });

      const uploadUrl = presignResponse.data.data.attributes.upload_url;
      const attachmentId = presignResponse.data.data.id;

      // Upload to S3
      await axios.put(uploadUrl, content, {
        headers: {
          'Content-Type': contentType,
        },
      });

      logger.info({ reportId, filename, attachmentId }, 'Attachment uploaded');
      return attachmentId;
    } catch (error: any) {
      logger.error({ error: error.message, reportId, filename }, 'Failed to upload attachment');
      throw error;
    }
  }

  // ============================================
  // Statistics & Tracking
  // ============================================

  /**
   * Get hacker statistics
   */
  async getStats(): Promise<{
    reputation: number;
    signal: number;
    impact: number;
    rank: number;
    totalEarnings: number;
    reportsByState: Record<string, number>;
    recentActivity: any[];
  }> {
    this.ensureAuthenticated();

    const profile = this.profile!;
    const reports = await this.getMyReports({ size: 100 });

    // Count by state
    const reportsByState: Record<string, number> = {};
    for (const report of reports) {
      reportsByState[report.state] = (reportsByState[report.state] || 0) + 1;
    }

    // Calculate earnings
    const totalEarnings = reports.reduce((sum, r) => sum + (r.awardedAmount || 0), 0);

    return {
      reputation: profile.reputation,
      signal: profile.signal,
      impact: profile.impact,
      rank: profile.rank,
      totalEarnings,
      reportsByState,
      recentActivity: reports.slice(0, 10),
    };
  }

  // ============================================
  // Agent Integration Methods
  // ============================================

  /**
   * Auto-generate a report draft from a finding
   * Used by: Triage Agent, Report Agent
   */
  async generateDraftFromFinding(finding: {
    programId: string;
    type: string;
    severity: string;
    url: string;
    parameter?: string;
    payload?: string;
    evidence: string;
    cweId?: string;
  }): Promise<ReportDraft> {
    // Get program info
    const program = await this.getProgram(finding.programId);
    if (!program) {
      throw new Error(`Program ${finding.programId} not found`);
    }

    // Map severity
    const severityMap: Record<string, 'none' | 'low' | 'medium' | 'high' | 'critical'> = {
      'info': 'none',
      'low': 'low',
      'medium': 'medium',
      'high': 'high',
      'critical': 'critical',
    };

    // Generate title
    const title = this.generateTitle(finding);

    // Generate vulnerability information
    const vulnerabilityInformation = this.generateVulnerabilityInfo(finding);

    // Generate impact statement
    const impactStatement = this.generateImpactStatement(finding);

    // Generate steps to reproduce
    const stepsToReproduce = this.generateStepsToReproduce(finding);

    return {
      programHandle: program.handle,
      title,
      vulnerabilityType: finding.type,
      severity: {
        rating: severityMap[finding.severity.toLowerCase()] || 'medium',
      },
      weakness: finding.cweId ? { cweId: finding.cweId } : undefined,
      structuredScope: { assetIdentifier: new URL(finding.url).hostname },
      vulnerabilityInformation,
      impactStatement,
      stepsToReproduce,
    };
  }

  private generateTitle(finding: any): string {
    const typeNames: Record<string, string> = {
      'xss': 'Cross-Site Scripting (XSS)',
      'sqli': 'SQL Injection',
      'ssrf': 'Server-Side Request Forgery (SSRF)',
      'idor': 'Insecure Direct Object Reference (IDOR)',
      'rce': 'Remote Code Execution',
      'lfi': 'Local File Inclusion',
      'xxe': 'XML External Entity (XXE)',
      'csrf': 'Cross-Site Request Forgery (CSRF)',
      'open-redirect': 'Open Redirect',
    };

    const typeName = typeNames[finding.type] || finding.type.toUpperCase();
    const location = finding.parameter 
      ? `in ${finding.parameter} parameter`
      : `at ${new URL(finding.url).pathname}`;

    return `${typeName} ${location}`;
  }

  private generateVulnerabilityInfo(finding: any): string {
    return `## Summary

A ${finding.type.toUpperCase()} vulnerability was discovered at:

**URL:** \`${finding.url}\`
${finding.parameter ? `**Parameter:** \`${finding.parameter}\`` : ''}
${finding.payload ? `**Payload:** \`${finding.payload}\`` : ''}

## Technical Details

${finding.evidence}

## Proof of Concept

The vulnerability can be reproduced using the following request:

\`\`\`
${finding.evidence}
\`\`\`
`;
  }

  private generateImpactStatement(finding: any): string {
    const impacts: Record<string, string> = {
      'xss': 'An attacker could execute arbitrary JavaScript in the context of the victim\'s browser session, potentially stealing session tokens, performing actions on behalf of the user, or defacing the application.',
      'sqli': 'An attacker could extract sensitive data from the database, modify or delete data, or potentially gain shell access to the underlying server.',
      'ssrf': 'An attacker could access internal services, scan internal networks, or potentially access cloud metadata endpoints to steal credentials.',
      'idor': 'An attacker could access or modify data belonging to other users, potentially leading to unauthorized data disclosure or manipulation.',
      'rce': 'An attacker could execute arbitrary commands on the server, leading to complete system compromise.',
    };

    return impacts[finding.type] || 'This vulnerability could be exploited by an attacker to compromise the security of the application and its users.';
  }

  private generateStepsToReproduce(finding: any): string[] {
    const steps = [
      `Navigate to ${finding.url}`,
    ];

    if (finding.parameter) {
      steps.push(`Locate the ${finding.parameter} parameter`);
    }

    if (finding.payload) {
      steps.push(`Inject the following payload: ${finding.payload}`);
    }

    steps.push('Observe the vulnerability trigger');
    steps.push('Review the response/behavior as shown in the evidence');

    return steps;
  }

  // ============================================
  // Helper Methods
  // ============================================

  private ensureAuthenticated(): void {
    if (!this.authenticated) {
      throw new Error('Not authenticated with HackerOne API');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private parseProfile(data: any): HackerProfile {
    const attrs = data.attributes || data;
    return {
      id: data.id,
      username: attrs.username,
      name: attrs.name,
      reputation: attrs.reputation || 0,
      signal: attrs.signal || 0,
      impact: attrs.impact || 0,
      rank: attrs.rank || 0,
      totalBountiesEarned: attrs.total_bounties_earned || 0,
      totalReportsSubmitted: attrs.total_reports_submitted || 0,
      resolvedReports: attrs.resolved_reports || 0,
      signalPercentile: attrs.signal_percentile || 0,
      impactPercentile: attrs.impact_percentile || 0,
    };
  }

  private parseProgram(data: any): Program {
    const attrs = data.attributes || data;
    return {
      id: data.id,
      handle: attrs.handle,
      name: attrs.name,
      url: `https://hackerone.com/${attrs.handle}`,
      offersBounties: attrs.offers_bounties || false,
      state: attrs.state || 'open',
      inScope: [],
      outOfScope: [],
      policy: attrs.policy || '',
      submissionState: attrs.submission_state || 'open',
      responseEfficiencyPercentage: attrs.response_efficiency_percentage || 0,
      minimumBounty: attrs.minimum_bounty_table_value,
      maximumBounty: attrs.maximum_bounty_table_value,
      averageBounty: attrs.average_bounty_lower_amount,
      resolvedReportCount: attrs.resolved_report_count || 0,
      totalBountiesPaid: attrs.total_bounties_paid || 0,
      launchedAt: new Date(attrs.launched_at),
      updatedAt: new Date(attrs.updated_at),
    };
  }

  private parseScopeAsset(data: any): ScopeAsset {
    const attrs = data.attributes || data;
    return {
      id: data.id,
      assetType: attrs.asset_type,
      assetIdentifier: attrs.asset_identifier,
      eligibleForBounty: attrs.eligible_for_bounty || false,
      eligibleForSubmission: attrs.eligible_for_submission !== false,
      instruction: attrs.instruction,
      maxSeverity: attrs.max_severity,
      confidentialityRequirement: attrs.confidentiality_requirement,
      integrityRequirement: attrs.integrity_requirement,
      availabilityRequirement: attrs.availability_requirement,
    };
  }

  private parseSubmittedReport(data: any): SubmittedReport {
    const attrs = data.attributes || data;
    return {
      id: data.id,
      databaseId: attrs.database_id || parseInt(data.id),
      title: attrs.title,
      state: attrs.state,
      substate: attrs.substate,
      severity: attrs.severity_rating,
      createdAt: new Date(attrs.created_at),
      disclosedAt: attrs.disclosed_at ? new Date(attrs.disclosed_at) : undefined,
      bountyAwardedAt: attrs.bounty_awarded_at ? new Date(attrs.bounty_awarded_at) : undefined,
      awardedAmount: attrs.awarded_amount,
      programHandle: attrs.team?.handle || '',
      url: `https://hackerone.com/reports/${data.id}`,
    };
  }
}

// Export singleton
export const hackeronePlatform = new HackerOnePlatformService();
export default hackeronePlatform;
