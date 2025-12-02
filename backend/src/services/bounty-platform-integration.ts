/**
 * Bounty Platform Integration - Part 1: Core Types and Authentication
 * See bounty-platform-integration-2.ts for submission and tracking
 */

import axios, { AxiosInstance } from 'axios';
import logger from '../utils/logger';
import database from './database';
import events from './events';

export type Platform = 'hackerone' | 'bugcrowd' | 'intigriti';

export interface PlatformCredentials {
  platform: Platform;
  identifier: string;
  token: string;
  enabled: boolean;
}

export interface BountyProgram {
  id: string;
  platform: Platform;
  handle: string;
  name: string;
  url: string;
  state: 'active' | 'paused' | 'private';
  acceptingSubmissions: boolean;
  offersBounties: boolean;
  assets: ProgramAsset[];
  policy: string;
  bountyTable: BountyTableEntry[];
  averageBounty: number;
  totalPaid: number;
  resolvedCount: number;
  launchedAt: Date;
  lastSyncedAt: Date;
}

export interface ProgramAsset {
  id: string;
  type: 'domain' | 'wildcard' | 'url' | 'api' | 'mobile_app' | 'cidr' | 'other';
  identifier: string;
  description?: string;
  inScope: boolean;
  eligibleForBounty: boolean;
  maxSeverity: 'critical' | 'high' | 'medium' | 'low' | 'info';
}

export interface BountyTableEntry {
  severity: 'critical' | 'high' | 'medium' | 'low';
  minBounty: number;
  maxBounty: number;
  currency: string;
}

export interface VulnerabilityFinding {
  id: string;
  programId: string;
  type: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  cweId?: string;
  asset: string;
  url: string;
  parameter?: string;
  payload?: string;
  request?: string;
  response?: string;
  impact: string;
  stepsToReproduce: string[];
  discoveredAt: Date;
  discoveredBy: string;
  confidence: number;
  status: 'new' | 'verified' | 'drafted' | 'submitted' | 'duplicate';
  draftId?: string;
  reportId?: string;
}

export interface ReportDraft {
  id: string;
  findingId: string;
  programHandle: string;
  platform: Platform;
  title: string;
  severity: string;
  weaknessId?: string;
  assetIdentifier: string;
  summary: string;
  vulnerabilityDetails: string;
  stepsToReproduce: string[];
  impact: string;
  remediation?: string;
  references?: string[];
  status: 'draft' | 'pending_review' | 'approved' | 'submitted';
  createdAt: Date;
  updatedAt: Date;
  submittedAt?: Date;
  reportUrl?: string;
}

export interface SubmittedReport {
  id: string;
  platform: Platform;
  programHandle: string;
  title: string;
  url: string;
  state: string;
  severity: string;
  submittedAt: Date;
  triagedAt?: Date;
  resolvedAt?: Date;
  bountyAmount?: number;
  bonusAmount?: number;
  lastActivityAt: Date;
  unreadComments: number;
}

class BountyPlatformIntegration {
  private credentials: Map<Platform, PlatformCredentials> = new Map();
  private apis: Map<Platform, AxiosInstance> = new Map();
  private programs: Map<string, BountyProgram> = new Map();
  private findings: Map<string, VulnerabilityFinding> = new Map();
  private drafts: Map<string, ReportDraft> = new Map();
  private reports: Map<string, SubmittedReport> = new Map();
  
  private autoSubmitEnabled = false;
  private autoSubmitMinConfidence = 0.95;
  private autoSubmitSeverities = ['critical', 'high'];
  private requireHumanApproval = true;

  constructor() {
    this.apis.set('hackerone', axios.create({
      baseURL: 'https://api.hackerone.com/v1',
      timeout: 30000,
      headers: { 'Accept': 'application/json' },
    }));
    this.apis.set('bugcrowd', axios.create({
      baseURL: 'https://api.bugcrowd.com',
      timeout: 30000,
    }));
    this.apis.set('intigriti', axios.create({
      baseURL: 'https://api.intigriti.com',
      timeout: 30000,
    }));
  }

  async addCredentials(creds: PlatformCredentials): Promise<boolean> {
    try {
      const api = this.apis.get(creds.platform)!;
      const auth = Buffer.from(`${creds.identifier}:${creds.token}`).toString('base64');
      api.defaults.headers.common['Authorization'] = `Basic ${auth}`;
      
      if (creds.platform === 'hackerone') {
        const resp = await api.get('/me');
        if (resp.data?.id) {
          this.credentials.set(creds.platform, creds);
          logger.info({ platform: creds.platform, user: resp.data.attributes?.username }, 'Authenticated');
          return true;
        }
      }
      return false;
    } catch (e: any) {
      logger.error({ error: e.message }, 'Auth failed');
      return false;
    }
  }

  async syncPrograms(platform: Platform = 'hackerone'): Promise<BountyProgram[]> {
    const api = this.apis.get(platform)!;
    const programs: BountyProgram[] = [];
    
    const resp = await api.get('/hackers/programs', { params: { 'page[size]': 100 } });
    for (const p of resp.data.data || []) {
      const attrs = p.attributes;
      let assets: ProgramAsset[] = [];
      
      try {
        const scopeResp = await api.get(`/programs/${attrs.handle}/structured_scopes`);
        assets = (scopeResp.data.data || []).map((s: any) => ({
          id: s.id,
          type: s.attributes.asset_type.toLowerCase(),
          identifier: s.attributes.asset_identifier,
          inScope: s.attributes.eligible_for_submission !== false,
          eligibleForBounty: s.attributes.eligible_for_bounty || false,
          maxSeverity: s.attributes.max_severity || 'critical',
        }));
      } catch {}

      const program: BountyProgram = {
        id: p.id,
        platform,
        handle: attrs.handle,
        name: attrs.name,
        url: `https://hackerone.com/${attrs.handle}`,
        state: attrs.state === 'public_mode' ? 'active' : 'paused',
        acceptingSubmissions: attrs.submission_state === 'open',
        offersBounties: attrs.offers_bounties || false,
        assets,
        policy: attrs.policy || '',
        bountyTable: [],
        averageBounty: attrs.average_bounty_lower_amount || 0,
        totalPaid: attrs.total_bounties_paid || 0,
        resolvedCount: attrs.resolved_report_count || 0,
        launchedAt: new Date(attrs.launched_at),
        lastSyncedAt: new Date(),
      };
      
      programs.push(program);
      this.programs.set(`${platform}:${attrs.handle}`, program);
    }
    
    logger.info({ count: programs.length }, 'Programs synced');
    return programs;
  }

  checkScope(target: string, programKey: string): { inScope: boolean; asset?: ProgramAsset } {
    const program = this.programs.get(programKey);
    if (!program) return { inScope: false };
    
    for (const asset of program.assets) {
      if (!asset.inScope) continue;
      const id = asset.identifier.toLowerCase();
      const t = target.toLowerCase();
      
      if (asset.type === 'domain' && (t === id || t.endsWith(`.${id}`))) {
        return { inScope: true, asset };
      }
      if (asset.type === 'wildcard') {
        const pattern = id.replace(/\*/g, '.*');
        if (new RegExp(`^${pattern}$`).test(t)) return { inScope: true, asset };
      }
      if (asset.type === 'url' && t.includes(id)) {
        return { inScope: true, asset };
      }
    }
    return { inScope: false };
  }

  async registerFinding(finding: Omit<VulnerabilityFinding, 'id' | 'status'>): Promise<VulnerabilityFinding> {
    const id = `finding-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const full: VulnerabilityFinding = { ...finding, id, status: 'new' };
    this.findings.set(id, full);
    events.publish('finding:new', { finding: full });
    logger.info({ id, type: finding.type, severity: finding.severity }, 'Finding registered');
    return full;
  }

  async generateDraft(findingId: string): Promise<ReportDraft> {
    const finding = this.findings.get(findingId)!;
    const draftId = `draft-${Date.now()}`;
    
    const typeNames: Record<string, string> = {
      'xss': 'Cross-Site Scripting (XSS)',
      'sqli': 'SQL Injection',
      'ssrf': 'Server-Side Request Forgery',
      'idor': 'Insecure Direct Object Reference',
      'rce': 'Remote Code Execution',
    };
    
    const draft: ReportDraft = {
      id: draftId,
      findingId,
      programHandle: finding.programId,
      platform: 'hackerone',
      title: `${typeNames[finding.type] || finding.type} on ${finding.asset}`,
      severity: finding.severity,
      weaknessId: finding.cweId,
      assetIdentifier: finding.asset,
      summary: `A ${finding.severity} ${finding.type} vulnerability was found at ${finding.url}`,
      vulnerabilityDetails: `**URL:** ${finding.url}\n**Parameter:** ${finding.parameter || 'N/A'}\n**Payload:** ${finding.payload || 'N/A'}`,
      stepsToReproduce: finding.stepsToReproduce,
      impact: finding.impact,
      status: 'draft',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    
    this.drafts.set(draftId, draft);
    finding.status = 'drafted';
    finding.draftId = draftId;
    logger.info({ draftId }, 'Draft generated');
    return draft;
  }

  async submitDraft(draftId: string): Promise<SubmittedReport> {
    const draft = this.drafts.get(draftId)!;
    const api = this.apis.get(draft.platform)!;
    
    let body = `${draft.summary}\n\n## Details\n${draft.vulnerabilityDetails}\n\n## Steps\n`;
    draft.stepsToReproduce.forEach((s, i) => body += `${i+1}. ${s}\n`);
    body += `\n## Impact\n${draft.impact}`;
    
    const resp = await api.post('/reports', {
      data: {
        type: 'report',
        attributes: {
          team_handle: draft.programHandle,
          title: draft.title,
          vulnerability_information: body,
          severity_rating: draft.severity,
        },
      },
    });
    
    const report: SubmittedReport = {
      id: resp.data.data.id,
      platform: draft.platform,
      programHandle: draft.programHandle,
      title: draft.title,
      url: `https://hackerone.com/reports/${resp.data.data.id}`,
      state: 'new',
      severity: draft.severity,
      submittedAt: new Date(),
      lastActivityAt: new Date(),
      unreadComments: 0,
    };
    
    this.reports.set(report.id, report);
    draft.status = 'submitted';
    draft.reportUrl = report.url;
    events.publish('report:submitted', { report });
    logger.info({ reportId: report.id, url: report.url }, 'Report submitted');
    return report;
  }

  async syncReports(): Promise<SubmittedReport[]> {
    const api = this.apis.get('hackerone')!;
    const resp = await api.get('/hackers/me/reports', { params: { 'page[size]': 100 } });
    const reports: SubmittedReport[] = [];
    
    for (const r of resp.data.data || []) {
      const attrs = r.attributes;
      const report: SubmittedReport = {
        id: r.id,
        platform: 'hackerone',
        programHandle: attrs.team?.handle || '',
        title: attrs.title,
        url: `https://hackerone.com/reports/${r.id}`,
        state: attrs.state,
        severity: attrs.severity_rating,
        submittedAt: new Date(attrs.created_at),
        triagedAt: attrs.triaged_at ? new Date(attrs.triaged_at) : undefined,
        resolvedAt: attrs.closed_at ? new Date(attrs.closed_at) : undefined,
        bountyAmount: attrs.bounty_amount,
        bonusAmount: attrs.bonus_amount,
        lastActivityAt: new Date(attrs.last_activity_at || attrs.created_at),
        unreadComments: 0,
      };
      reports.push(report);
      this.reports.set(report.id, report);
    }
    return reports;
  }

  async getStats() {
    await this.syncReports();
    let totalEarnings = 0;
    const byState: Record<string, number> = {};
    
    for (const r of this.reports.values()) {
      totalEarnings += (r.bountyAmount || 0) + (r.bonusAmount || 0);
      byState[r.state] = (byState[r.state] || 0) + 1;
    }
    
    return { totalEarnings, reportsByState: byState, totalReports: this.reports.size };
  }

  configureAutoSubmit(opts: { enabled: boolean; minConfidence?: number; severities?: string[]; requireApproval?: boolean }) {
    this.autoSubmitEnabled = opts.enabled;
    if (opts.minConfidence) this.autoSubmitMinConfidence = opts.minConfidence;
    if (opts.severities) this.autoSubmitSeverities = opts.severities;
    if (opts.requireApproval !== undefined) this.requireHumanApproval = opts.requireApproval;
  }

  async processFinding(finding: Omit<VulnerabilityFinding, 'id' | 'status'>) {
    const registered = await this.registerFinding(finding);
    const draft = await this.generateDraft(registered.id);
    
    if (this.autoSubmitEnabled && finding.confidence >= this.autoSubmitMinConfidence && 
        this.autoSubmitSeverities.includes(finding.severity) && !this.requireHumanApproval) {
      const report = await this.submitDraft(draft.id);
      return { finding: registered, draft, report, action: 'submitted' };
    }
    
    return { finding: registered, draft, action: this.requireHumanApproval ? 'pending_review' : 'drafted' };
  }

  getPrograms() { return Array.from(this.programs.values()); }
  getFindings() { return Array.from(this.findings.values()); }
  getDrafts() { return Array.from(this.drafts.values()); }
  getReports() { return Array.from(this.reports.values()); }
}

export const bountyPlatform = new BountyPlatformIntegration();
export default bountyPlatform;
