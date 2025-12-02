/**
 * HackerOne Hacktivity Intelligence Service
 * 
 * Integrates with HackerOne's public Hacktivity feed to:
 * 1. Learn from successful vulnerability reports
 * 2. Extract working payloads and techniques
 * 3. Build program-specific intelligence
 * 4. Prioritize testing based on trends
 * 5. Avoid duplicate submissions
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import database from './database';
import config from '../config';

// ============================================
// Types
// ============================================

export interface HacktivityReport {
  id: string;
  type: string;
  attributes: {
    title: string;
    severity_rating: 'none' | 'low' | 'medium' | 'high' | 'critical';
    state: string;
    created_at: string;
    disclosed_at: string;
    bounty_awarded_at?: string;
    cve_ids: string[];
    cwe: {
      id: string;
      name: string;
    };
    weakness: {
      id: number;
      name: string;
      description: string;
    };
    structured_scope?: {
      asset_type: string;
      asset_identifier: string;
    };
    report_url?: string;
    vulnerability_information?: string;
  };
  relationships: {
    program: {
      data: {
        id: string;
        type: string;
        attributes: {
          handle: string;
          name: string;
        };
      };
    };
    severity?: {
      data: {
        attributes: {
          rating: string;
          score: number;
        };
      };
    };
    bounties?: {
      data: Array<{
        attributes: {
          amount: string;
          bonus_amount: string;
          awarded_at: string;
        };
      }>;
    };
  };
}

export interface ExtractedPattern {
  id: string;
  source: 'hacktivity';
  reportId: string;
  programHandle: string;
  vulnerabilityType: string;
  cweId: string;
  cweName: string;
  cveIds: string[];
  severity: string;
  bountyAmount: number;
  
  // Extracted intelligence
  affectedEndpoint?: string;
  affectedParameter?: string;
  payloads: string[];
  bypassTechniques: string[];
  technologies: string[];
  
  // Metadata
  disclosedAt: Date;
  extractedAt: Date;
  confidence: number;
}

export interface ProgramIntelligence {
  programHandle: string;
  programName: string;
  totalReports: number;
  
  // Vulnerability breakdown
  vulnerabilityTypes: Record<string, number>;
  severityDistribution: Record<string, number>;
  cweDistribution: Record<string, number>;
  
  // Financial signals
  totalBounties: number;
  averageBounty: number;
  highestBounty: number;
  
  // Patterns
  commonEndpoints: string[];
  commonParameters: string[];
  successfulTechniques: string[];
  
  // Timing
  lastReportDate: Date;
  reportFrequency: number; // reports per month
  
  // Agent recommendations
  priorityAreas: string[];
  avoidAreas: string[]; // heavily tested, likely duplicates
}

export interface TrendAnalysis {
  period: string;
  hotVulnerabilityTypes: Array<{
    type: string;
    count: number;
    trend: 'rising' | 'stable' | 'declining';
    averageBounty: number;
  }>;
  emergingTechniques: string[];
  topPrograms: Array<{
    handle: string;
    reportCount: number;
    totalBounties: number;
  }>;
  newCVEs: string[];
}

// ============================================
// HackerOne API Client
// ============================================

class HackerOneClient {
  private api: AxiosInstance;
  private authenticated: boolean = false;

  constructor() {
    this.api = axios.create({
      baseURL: 'https://api.hackerone.com/v1',
      timeout: 30000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Authenticate with HackerOne API
   * Requires API identifier and token from HackerOne settings
   */
  async authenticate(identifier: string, token: string): Promise<boolean> {
    try {
      const auth = Buffer.from(`${identifier}:${token}`).toString('base64');
      this.api.defaults.headers.common['Authorization'] = `Basic ${auth}`;
      
      // Test authentication
      await this.api.get('/me');
      this.authenticated = true;
      logger.info('HackerOne API authenticated successfully');
      return true;
    } catch (error: any) {
      logger.error({ error: error.message }, 'HackerOne authentication failed');
      return false;
    }
  }

  /**
   * Fetch public hacktivity feed
   * This endpoint is publicly accessible
   */
  async getHacktivity(params: {
    page?: number;
    size?: number;
    queryString?: string;
    sortType?: 'latest_disclosable_activity_at' | 'popular';
    severityRatings?: string[];
    hacktivityFrom?: string;
  } = {}): Promise<HacktivityReport[]> {
    try {
      // Public hacktivity endpoint (GraphQL)
      const response = await axios.post('https://hackerone.com/graphql', {
        operationName: 'HacktivityPageQuery',
        variables: {
          queryString: params.queryString || '',
          size: params.size || 25,
          from: params.page ? params.page * (params.size || 25) : 0,
          sort: {
            field: params.sortType || 'latest_disclosable_activity_at',
            direction: 'DESC',
          },
          product_area: 'hacktivity',
          product_feature: 'overview',
        },
        query: `
          query HacktivityPageQuery(
            $queryString: String
            $size: Int
            $from: Int
            $sort: SortInput
          ) {
            hacktivity_items(
              query_string: $queryString
              size: $size
              from: $from
              sort: $sort
            ) {
              total_count
              nodes {
                ... on HacktivityItemInterface {
                  id
                  databaseId: _id
                  ... on Disclosed {
                    report {
                      id
                      databaseId: _id
                      title
                      substate
                      url
                      disclosed_at
                      severity_rating
                      cve_ids
                      cwe {
                        id
                        name
                      }
                      weakness {
                        id
                        name
                        description
                      }
                      team {
                        handle
                        name
                        url
                      }
                      bounty_awarded_at
                      severity {
                        rating
                        score
                      }
                      awarded_amount
                      structured_scope {
                        asset_type
                        asset_identifier
                      }
                    }
                  }
                }
              }
            }
          }
        `,
      }, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const items = response.data?.data?.hacktivity_items?.nodes || [];
      return this.transformGraphQLResponse(items);
    } catch (error: any) {
      logger.error({ error: error.message }, 'Failed to fetch hacktivity');
      return [];
    }
  }

  /**
   * Search hacktivity by vulnerability type
   */
  async searchByVulnerabilityType(vulnType: string, limit: number = 50): Promise<HacktivityReport[]> {
    return this.getHacktivity({
      queryString: vulnType,
      size: limit,
    });
  }

  /**
   * Search hacktivity by program
   */
  async searchByProgram(programHandle: string, limit: number = 100): Promise<HacktivityReport[]> {
    return this.getHacktivity({
      queryString: `team:${programHandle}`,
      size: limit,
    });
  }

  /**
   * Search hacktivity by CWE
   */
  async searchByCWE(cweId: string, limit: number = 50): Promise<HacktivityReport[]> {
    return this.getHacktivity({
      queryString: `cwe:${cweId}`,
      size: limit,
    });
  }

  /**
   * Get recent critical/high severity reports
   */
  async getHighSeverityReports(limit: number = 50): Promise<HacktivityReport[]> {
    return this.getHacktivity({
      queryString: 'severity:critical OR severity:high',
      size: limit,
    });
  }

  private transformGraphQLResponse(items: any[]): HacktivityReport[] {
    return items
      .filter(item => item.report)
      .map(item => {
        const report = item.report;
        return {
          id: report.id,
          type: 'report',
          attributes: {
            title: report.title,
            severity_rating: report.severity_rating || 'none',
            state: report.substate,
            created_at: report.disclosed_at,
            disclosed_at: report.disclosed_at,
            bounty_awarded_at: report.bounty_awarded_at,
            cve_ids: report.cve_ids || [],
            cwe: report.cwe || { id: '', name: '' },
            weakness: report.weakness || { id: 0, name: '', description: '' },
            structured_scope: report.structured_scope,
            report_url: report.url,
          },
          relationships: {
            program: {
              data: {
                id: report.team?.handle || '',
                type: 'program',
                attributes: {
                  handle: report.team?.handle || '',
                  name: report.team?.name || '',
                },
              },
            },
            severity: report.severity ? {
              data: {
                attributes: {
                  rating: report.severity.rating,
                  score: report.severity.score,
                },
              },
            } : undefined,
            bounties: report.awarded_amount ? {
              data: [{
                attributes: {
                  amount: String(report.awarded_amount),
                  bonus_amount: '0',
                  awarded_at: report.bounty_awarded_at,
                },
              }],
            } : undefined,
          },
        };
      });
  }
}

// ============================================
// Intelligence Extraction Service
// ============================================

export class HacktivityIntelligenceService {
  private client: HackerOneClient;
  private patterns: Map<string, ExtractedPattern> = new Map();
  private programIntel: Map<string, ProgramIntelligence> = new Map();

  constructor() {
    this.client = new HackerOneClient();
  }

  /**
   * Initialize with HackerOne API credentials (optional for public data)
   */
  async initialize(identifier?: string, token?: string): Promise<void> {
    if (identifier && token) {
      await this.client.authenticate(identifier, token);
    }
    
    // Load cached patterns from database
    await this.loadCachedPatterns();
    
    logger.info('HacktivityIntelligenceService initialized');
  }

  // ============================================
  // 1. PATTERN EXTRACTION
  // ============================================

  /**
   * Extract attack patterns from hacktivity reports
   * Used by: All vulnerability-specific agents
   */
  async extractPatterns(reports: HacktivityReport[]): Promise<ExtractedPattern[]> {
    const patterns: ExtractedPattern[] = [];

    for (const report of reports) {
      const pattern = await this.extractPatternFromReport(report);
      if (pattern) {
        patterns.push(pattern);
        this.patterns.set(pattern.id, pattern);
      }
    }

    // Persist to database
    await this.persistPatterns(patterns);

    return patterns;
  }

  private async extractPatternFromReport(report: HacktivityReport): Promise<ExtractedPattern | null> {
    const attrs = report.attributes;
    const program = report.relationships.program.data.attributes;
    
    // Calculate bounty
    let bountyAmount = 0;
    if (report.relationships.bounties?.data) {
      bountyAmount = report.relationships.bounties.data.reduce((sum, b) => {
        return sum + parseFloat(b.attributes.amount || '0') + parseFloat(b.attributes.bonus_amount || '0');
      }, 0);
    }

    // Extract payloads and techniques from title and description
    const { payloads, techniques, endpoint, parameter, technologies } = 
      this.extractDetailsFromText(attrs.title, attrs.vulnerability_information);

    return {
      id: `hacktivity-${report.id}`,
      source: 'hacktivity',
      reportId: report.id,
      programHandle: program.handle,
      vulnerabilityType: this.normalizeVulnType(attrs.weakness?.name || attrs.cwe?.name || 'unknown'),
      cweId: attrs.cwe?.id || '',
      cweName: attrs.cwe?.name || '',
      cveIds: attrs.cve_ids || [],
      severity: attrs.severity_rating,
      bountyAmount,
      
      affectedEndpoint: endpoint,
      affectedParameter: parameter,
      payloads,
      bypassTechniques: techniques,
      technologies,
      
      disclosedAt: new Date(attrs.disclosed_at),
      extractedAt: new Date(),
      confidence: this.calculateConfidence(attrs, payloads, techniques),
    };
  }

  private extractDetailsFromText(title: string, description?: string): {
    payloads: string[];
    techniques: string[];
    endpoint?: string;
    parameter?: string;
    technologies: string[];
  } {
    const text = `${title} ${description || ''}`.toLowerCase();
    const payloads: string[] = [];
    const techniques: string[] = [];
    const technologies: string[] = [];
    let endpoint: string | undefined;
    let parameter: string | undefined;

    // Extract payloads (common patterns)
    const payloadPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /<img[^>]*onerror[^>]*>/gi,
      /<svg[^>]*onload[^>]*>/gi,
      /\{\{.*?\}\}/g, // Template injection
      /\$\{.*?\}/g, // Template literals
      /'.*?OR.*?'.*?='/gi, // SQLi
      /UNION\s+SELECT/gi,
      /;.*?--/g,
      /\.\.\/+/g, // Path traversal
      /file:\/\//gi,
      /gopher:\/\//gi,
      /dict:\/\//gi,
    ];

    for (const pattern of payloadPatterns) {
      const matches = text.match(pattern);
      if (matches) {
        payloads.push(...matches.map(m => m.trim()));
      }
    }

    // Extract bypass techniques
    const bypassKeywords = [
      'bypass', 'waf', 'filter', 'sanitization', 'encoding', 'double encoding',
      'unicode', 'null byte', 'case variation', 'obfuscation', 'mutation',
      'chunked', 'multipart', 'content-type', 'race condition',
    ];

    for (const keyword of bypassKeywords) {
      if (text.includes(keyword)) {
        techniques.push(keyword);
      }
    }

    // Extract endpoint patterns
    const endpointMatch = text.match(/\/api\/[^\s"'<>]+|\/[a-z]+\/[a-z]+[^\s"'<>]*/i);
    if (endpointMatch) {
      endpoint = endpointMatch[0];
    }

    // Extract parameter names
    const paramMatch = text.match(/parameter[:\s]+["']?(\w+)["']?|param[:\s]+["']?(\w+)["']?|(\w+)\s+parameter/i);
    if (paramMatch) {
      parameter = paramMatch[1] || paramMatch[2] || paramMatch[3];
    }

    // Extract technologies
    const techKeywords = [
      'react', 'angular', 'vue', 'node', 'express', 'django', 'flask', 'rails',
      'php', 'java', 'spring', 'asp.net', 'wordpress', 'drupal', 'joomla',
      'nginx', 'apache', 'iis', 'cloudflare', 'akamai', 'aws', 'azure', 'gcp',
      'graphql', 'rest', 'soap', 'grpc', 'websocket',
    ];

    for (const tech of techKeywords) {
      if (text.includes(tech)) {
        technologies.push(tech);
      }
    }

    return { payloads, techniques, endpoint, parameter, technologies };
  }

  private normalizeVulnType(weakness: string): string {
    const mapping: Record<string, string> = {
      'cross-site scripting': 'xss',
      'xss': 'xss',
      'sql injection': 'sqli',
      'sqli': 'sqli',
      'server-side request forgery': 'ssrf',
      'ssrf': 'ssrf',
      'insecure direct object reference': 'idor',
      'idor': 'idor',
      'cross-site request forgery': 'csrf',
      'csrf': 'csrf',
      'remote code execution': 'rce',
      'rce': 'rce',
      'path traversal': 'path-traversal',
      'directory traversal': 'path-traversal',
      'open redirect': 'open-redirect',
      'information disclosure': 'info-disclosure',
      'authentication bypass': 'auth-bypass',
      'privilege escalation': 'privesc',
      'race condition': 'race-condition',
      'business logic': 'business-logic',
    };

    const lower = weakness.toLowerCase();
    for (const [key, value] of Object.entries(mapping)) {
      if (lower.includes(key)) {
        return value;
      }
    }
    return lower.replace(/\s+/g, '-');
  }

  private calculateConfidence(attrs: any, payloads: string[], techniques: string[]): number {
    let confidence = 0.5; // Base confidence

    // Higher severity = more reliable pattern
    if (attrs.severity_rating === 'critical') confidence += 0.2;
    else if (attrs.severity_rating === 'high') confidence += 0.15;
    else if (attrs.severity_rating === 'medium') confidence += 0.1;

    // Has CVE = validated
    if (attrs.cve_ids?.length > 0) confidence += 0.15;

    // Has extracted payloads = actionable
    if (payloads.length > 0) confidence += 0.1;

    // Has techniques = detailed
    if (techniques.length > 0) confidence += 0.05;

    return Math.min(confidence, 1);
  }

  // ============================================
  // 2. PROGRAM INTELLIGENCE
  // ============================================

  /**
   * Build intelligence profile for a specific program
   * Used by: Orchestrator before starting a scan
   */
  async buildProgramIntelligence(programHandle: string): Promise<ProgramIntelligence> {
    logger.info({ programHandle }, 'Building program intelligence');

    // Fetch all public reports for this program
    const reports = await this.client.searchByProgram(programHandle, 200);

    if (reports.length === 0) {
      return this.createEmptyProgramIntel(programHandle);
    }

    // Analyze reports
    const vulnerabilityTypes: Record<string, number> = {};
    const severityDistribution: Record<string, number> = {};
    const cweDistribution: Record<string, number> = {};
    const endpoints: string[] = [];
    const parameters: string[] = [];
    const techniques: string[] = [];
    let totalBounties = 0;
    const bounties: number[] = [];
    let lastReportDate = new Date(0);

    for (const report of reports) {
      const pattern = await this.extractPatternFromReport(report);
      if (!pattern) continue;

      // Count vulnerability types
      vulnerabilityTypes[pattern.vulnerabilityType] = 
        (vulnerabilityTypes[pattern.vulnerabilityType] || 0) + 1;

      // Count severities
      severityDistribution[pattern.severity] = 
        (severityDistribution[pattern.severity] || 0) + 1;

      // Count CWEs
      if (pattern.cweId) {
        cweDistribution[pattern.cweId] = (cweDistribution[pattern.cweId] || 0) + 1;
      }

      // Collect endpoints and parameters
      if (pattern.affectedEndpoint) endpoints.push(pattern.affectedEndpoint);
      if (pattern.affectedParameter) parameters.push(pattern.affectedParameter);
      techniques.push(...pattern.bypassTechniques);

      // Track bounties
      if (pattern.bountyAmount > 0) {
        totalBounties += pattern.bountyAmount;
        bounties.push(pattern.bountyAmount);
      }

      // Track dates
      if (pattern.disclosedAt > lastReportDate) {
        lastReportDate = pattern.disclosedAt;
      }
    }

    // Calculate statistics
    const averageBounty = bounties.length > 0 
      ? totalBounties / bounties.length 
      : 0;
    const highestBounty = bounties.length > 0 
      ? Math.max(...bounties) 
      : 0;

    // Calculate report frequency (reports per month)
    const oldestReport = reports.reduce((oldest, r) => {
      const date = new Date(r.attributes.disclosed_at);
      return date < oldest ? date : oldest;
    }, new Date());
    const monthsSpan = Math.max(1, 
      (Date.now() - oldestReport.getTime()) / (30 * 24 * 60 * 60 * 1000)
    );
    const reportFrequency = reports.length / monthsSpan;

    // Determine priority and avoid areas
    const sortedVulnTypes = Object.entries(vulnerabilityTypes)
      .sort((a, b) => b[1] - a[1]);
    
    // Priority: Less common vuln types (less competition)
    const priorityAreas = sortedVulnTypes
      .filter(([_, count]) => count < reports.length * 0.1)
      .map(([type]) => type)
      .slice(0, 5);

    // Avoid: Most common vuln types (likely duplicates)
    const avoidAreas = sortedVulnTypes
      .filter(([_, count]) => count > reports.length * 0.3)
      .map(([type]) => type);

    const intel: ProgramIntelligence = {
      programHandle,
      programName: reports[0]?.relationships.program.data.attributes.name || programHandle,
      totalReports: reports.length,
      vulnerabilityTypes,
      severityDistribution,
      cweDistribution,
      totalBounties,
      averageBounty,
      highestBounty,
      commonEndpoints: this.getTopItems(endpoints, 10),
      commonParameters: this.getTopItems(parameters, 10),
      successfulTechniques: this.getTopItems(techniques, 10),
      lastReportDate,
      reportFrequency,
      priorityAreas,
      avoidAreas,
    };

    this.programIntel.set(programHandle, intel);
    await this.persistProgramIntel(intel);

    return intel;
  }

  private createEmptyProgramIntel(programHandle: string): ProgramIntelligence {
    return {
      programHandle,
      programName: programHandle,
      totalReports: 0,
      vulnerabilityTypes: {},
      severityDistribution: {},
      cweDistribution: {},
      totalBounties: 0,
      averageBounty: 0,
      highestBounty: 0,
      commonEndpoints: [],
      commonParameters: [],
      successfulTechniques: [],
      lastReportDate: new Date(),
      reportFrequency: 0,
      priorityAreas: ['xss', 'sqli', 'ssrf', 'idor', 'rce'], // Default priorities
      avoidAreas: [],
    };
  }

  private getTopItems(items: string[], limit: number): string[] {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item, (counts.get(item) || 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([item]) => item);
  }

  // ============================================
  // 3. TREND ANALYSIS
  // ============================================

  /**
   * Analyze current vulnerability trends
   * Used by: Orchestrator for global prioritization
   */
  async analyzeTrends(days: number = 30): Promise<TrendAnalysis> {
    logger.info({ days }, 'Analyzing hacktivity trends');

    // Fetch recent high-value reports
    const recentReports = await this.client.getHighSeverityReports(200);

    // Group by vulnerability type
    const vulnTypeCounts: Record<string, { count: number; bounties: number[] }> = {};
    const programCounts: Record<string, { count: number; bounties: number }> = {};
    const newCVEs: string[] = [];
    const techniques: string[] = [];

    for (const report of recentReports) {
      const pattern = await this.extractPatternFromReport(report);
      if (!pattern) continue;

      // Count vulnerability types
      if (!vulnTypeCounts[pattern.vulnerabilityType]) {
        vulnTypeCounts[pattern.vulnerabilityType] = { count: 0, bounties: [] };
      }
      vulnTypeCounts[pattern.vulnerabilityType].count++;
      if (pattern.bountyAmount > 0) {
        vulnTypeCounts[pattern.vulnerabilityType].bounties.push(pattern.bountyAmount);
      }

      // Count programs
      if (!programCounts[pattern.programHandle]) {
        programCounts[pattern.programHandle] = { count: 0, bounties: 0 };
      }
      programCounts[pattern.programHandle].count++;
      programCounts[pattern.programHandle].bounties += pattern.bountyAmount;

      // Collect CVEs
      newCVEs.push(...pattern.cveIds);

      // Collect techniques
      techniques.push(...pattern.bypassTechniques);
    }

    // Build hot vulnerability types
    const hotVulnerabilityTypes = Object.entries(vulnTypeCounts)
      .map(([type, data]) => ({
        type,
        count: data.count,
        trend: this.calculateTrend(type) as 'rising' | 'stable' | 'declining',
        averageBounty: data.bounties.length > 0 
          ? data.bounties.reduce((a, b) => a + b, 0) / data.bounties.length 
          : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Build top programs
    const topPrograms = Object.entries(programCounts)
      .map(([handle, data]) => ({
        handle,
        reportCount: data.count,
        totalBounties: data.bounties,
      }))
      .sort((a, b) => b.reportCount - a.reportCount)
      .slice(0, 10);

    return {
      period: `${days} days`,
      hotVulnerabilityTypes,
      emergingTechniques: this.getTopItems(techniques, 10),
      topPrograms,
      newCVEs: [...new Set(newCVEs)],
    };
  }

  private calculateTrend(vulnType: string): string {
    // In a real implementation, compare with historical data
    // For now, return stable
    return 'stable';
  }

  // ============================================
  // 4. AGENT INTEGRATION METHODS
  // ============================================

  /**
   * Get payloads for a specific vulnerability type
   * Used by: XSS Agent, SQLi Agent, etc.
   */
  async getPayloadsForVulnType(vulnType: string): Promise<string[]> {
    const patterns = Array.from(this.patterns.values())
      .filter(p => p.vulnerabilityType === vulnType)
      .sort((a, b) => b.confidence - a.confidence);

    const payloads = new Set<string>();
    for (const pattern of patterns) {
      pattern.payloads.forEach(p => payloads.add(p));
    }

    return Array.from(payloads);
  }

  /**
   * Get bypass techniques for a specific vulnerability type
   * Used by: All agents when WAF detected
   */
  async getBypassTechniques(vulnType: string): Promise<string[]> {
    const patterns = Array.from(this.patterns.values())
      .filter(p => p.vulnerabilityType === vulnType);

    const techniques = new Set<string>();
    for (const pattern of patterns) {
      pattern.bypassTechniques.forEach(t => techniques.add(t));
    }

    return Array.from(techniques);
  }

  /**
   * Check if a finding might be a duplicate
   * Used by: Triage Agent before submission
   */
  async checkPotentialDuplicate(
    programHandle: string,
    vulnType: string,
    endpoint: string
  ): Promise<{ isDuplicate: boolean; similarReports: string[] }> {
    const patterns = Array.from(this.patterns.values())
      .filter(p => 
        p.programHandle === programHandle &&
        p.vulnerabilityType === vulnType
      );

    const similarReports: string[] = [];
    
    for (const pattern of patterns) {
      if (pattern.affectedEndpoint && this.endpointsSimilar(endpoint, pattern.affectedEndpoint)) {
        similarReports.push(pattern.reportId);
      }
    }

    return {
      isDuplicate: similarReports.length > 0,
      similarReports,
    };
  }

  private endpointsSimilar(endpoint1: string, endpoint2: string): boolean {
    // Normalize endpoints
    const normalize = (e: string) => e
      .replace(/\/\d+/g, '/{id}')
      .replace(/\?.*$/, '')
      .toLowerCase();

    return normalize(endpoint1) === normalize(endpoint2);
  }

  /**
   * Get recommended scan priorities for a program
   * Used by: Orchestrator when starting a new scan
   */
  async getScanPriorities(programHandle: string): Promise<{
    highPriority: string[];
    mediumPriority: string[];
    lowPriority: string[];
    skipAreas: string[];
  }> {
    let intel = this.programIntel.get(programHandle);
    
    if (!intel) {
      intel = await this.buildProgramIntelligence(programHandle);
    }

    // Get global trends
    const trends = await this.analyzeTrends(30);
    const hotTypes = new Set(trends.hotVulnerabilityTypes.map(t => t.type));

    // High priority: Hot trends + program priority areas
    const highPriority = [
      ...intel.priorityAreas.filter(p => hotTypes.has(p)),
      ...Array.from(hotTypes).filter(t => !intel!.avoidAreas.includes(t)),
    ].slice(0, 5);

    // Medium priority: Other priority areas
    const mediumPriority = intel.priorityAreas
      .filter(p => !highPriority.includes(p))
      .slice(0, 5);

    // Low priority: Common but not oversaturated
    const lowPriority = Object.keys(intel.vulnerabilityTypes)
      .filter(t => !highPriority.includes(t) && !mediumPriority.includes(t) && !intel!.avoidAreas.includes(t))
      .slice(0, 5);

    return {
      highPriority,
      mediumPriority,
      lowPriority,
      skipAreas: intel.avoidAreas,
    };
  }

  /**
   * Sync latest hacktivity data
   * Should be called periodically (e.g., every hour)
   */
  async syncLatestHacktivity(): Promise<number> {
    logger.info('Syncing latest hacktivity data');

    const reports = await this.client.getHacktivity({ size: 100 });
    const patterns = await this.extractPatterns(reports);

    logger.info({ newPatterns: patterns.length }, 'Hacktivity sync complete');
    return patterns.length;
  }

  // ============================================
  // Persistence Methods
  // ============================================

  private async loadCachedPatterns(): Promise<void> {
    try {
      const result = await database.query(`
        SELECT * FROM hacktivity_patterns 
        WHERE extracted_at > NOW() - INTERVAL '7 days'
      `);

      for (const row of result.rows) {
        this.patterns.set(row.id, {
          id: row.id,
          source: 'hacktivity',
          reportId: row.report_id,
          programHandle: row.program_handle,
          vulnerabilityType: row.vulnerability_type,
          cweId: row.cwe_id,
          cweName: row.cwe_name,
          cveIds: row.cve_ids || [],
          severity: row.severity,
          bountyAmount: row.bounty_amount,
          affectedEndpoint: row.affected_endpoint,
          affectedParameter: row.affected_parameter,
          payloads: row.payloads || [],
          bypassTechniques: row.bypass_techniques || [],
          technologies: row.technologies || [],
          disclosedAt: row.disclosed_at,
          extractedAt: row.extracted_at,
          confidence: row.confidence,
        });
      }

      logger.info({ cachedPatterns: this.patterns.size }, 'Loaded cached hacktivity patterns');
    } catch (error) {
      // Table might not exist yet
      logger.debug('No cached patterns found');
    }
  }

  private async persistPatterns(patterns: ExtractedPattern[]): Promise<void> {
    for (const pattern of patterns) {
      try {
        await database.query(`
          INSERT INTO hacktivity_patterns (
            id, report_id, program_handle, vulnerability_type,
            cwe_id, cwe_name, cve_ids, severity, bounty_amount,
            affected_endpoint, affected_parameter, payloads,
            bypass_techniques, technologies, disclosed_at,
            extracted_at, confidence
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          ON CONFLICT (id) DO UPDATE SET
            payloads = EXCLUDED.payloads,
            bypass_techniques = EXCLUDED.bypass_techniques,
            extracted_at = EXCLUDED.extracted_at
        `, [
          pattern.id, pattern.reportId, pattern.programHandle, pattern.vulnerabilityType,
          pattern.cweId, pattern.cweName, pattern.cveIds, pattern.severity, pattern.bountyAmount,
          pattern.affectedEndpoint, pattern.affectedParameter, pattern.payloads,
          pattern.bypassTechniques, pattern.technologies, pattern.disclosedAt,
          pattern.extractedAt, pattern.confidence,
        ]);
      } catch (error) {
        // Ignore persistence errors
      }
    }
  }

  private async persistProgramIntel(intel: ProgramIntelligence): Promise<void> {
    try {
      await database.query(`
        INSERT INTO program_intelligence (
          program_handle, program_name, total_reports,
          vulnerability_types, severity_distribution, cwe_distribution,
          total_bounties, average_bounty, highest_bounty,
          common_endpoints, common_parameters, successful_techniques,
          last_report_date, report_frequency, priority_areas, avoid_areas,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
        ON CONFLICT (program_handle) DO UPDATE SET
          total_reports = EXCLUDED.total_reports,
          vulnerability_types = EXCLUDED.vulnerability_types,
          priority_areas = EXCLUDED.priority_areas,
          avoid_areas = EXCLUDED.avoid_areas,
          updated_at = NOW()
      `, [
        intel.programHandle, intel.programName, intel.totalReports,
        intel.vulnerabilityTypes, intel.severityDistribution, intel.cweDistribution,
        intel.totalBounties, intel.averageBounty, intel.highestBounty,
        intel.commonEndpoints, intel.commonParameters, intel.successfulTechniques,
        intel.lastReportDate, intel.reportFrequency, intel.priorityAreas, intel.avoidAreas,
      ]);
    } catch (error) {
      // Ignore persistence errors
    }
  }
}

// Export singleton
export const hacktivityIntelligence = new HacktivityIntelligenceService();
export default hacktivityIntelligence;
