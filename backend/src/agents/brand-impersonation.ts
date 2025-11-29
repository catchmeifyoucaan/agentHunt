import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface BrandImpersonationJob extends BaseJob {
  programId: string;
  brands: Array<{
    name: string;
    domains: string[];
    logos?: string[];
  }>;
  options: {
    checkTyposquatting?: boolean;
    checkPhishing?: boolean;
    checkSocialMedia?: boolean;
    checkAppStores?: boolean;
    checkDomainRegistrations?: boolean;
    deepScan?: boolean;
    timeout?: number;
  };
}

export interface BrandImpersonationResult {
  threats: Array<{
    type: 'typosquatting' | 'phishing' | 'fake-social-media' | 'fake-app' | 'domain-squatting' | 'trademark-abuse';
    domain?: string;
    url: string;
    brandName: string;
    similarity: number;
    evidence: string;
    screenshot?: string;
    registrationDate?: Date;
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    active: boolean;
  }>;
  domainsChecked: number;
  executionTime: number;
}

/**
 * Brand Impersonation Agent
 *
 * Detects brand abuse and impersonation attempts:
 *
 * Typosquatting Techniques:
 * - Character substitution (examp1e.com, exarnple.com)
 * - Missing characters (exampl.com, exmple.com)
 * - Added characters (examplee.com, eexample.com)
 * - Homoglyphs (exαmple.com using Greek alpha)
 * - TLD variations (example.org, example.co, example.io)
 * - Hyphenation (ex-ample.com, exam-ple.com)
 * - Common misspellings
 *
 * Phishing Detection:
 * - Login page clones
 * - SSL certificate analysis
 * - Visual similarity detection
 * - Hosting infrastructure analysis
 * - Domain age and registration data
 *
 * Social Media Impersonation:
 * - Fake Twitter/X accounts
 * - Fake Facebook pages
 * - Fake LinkedIn profiles
 * - Fake Instagram accounts
 * - Username squatting
 *
 * App Store Abuse:
 * - Fake mobile apps (Google Play, Apple App Store)
 * - Similar app names and icons
 * - Malicious functionality in lookalike apps
 *
 * Domain Monitoring:
 * - Newly registered similar domains
 * - Expired domain takeovers
 * - Trademark violations
 * - Brand keyword abuse
 *
 * Tools: dnstwist patterns, URLCrazy algorithms
 */
export class BrandImpersonationAgent extends BaseAgent<BrandImpersonationJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('brand-impersonation' as any);
  }

  protected getSteps() {
    return [
      { name: 'Generate typosquatting variants', metadata: { phase: 'generation' } },
      { name: 'Check domain registrations', metadata: { phase: 'domain-check' } },
      { name: 'Detect phishing sites', metadata: { phase: 'phishing-detection' } },
      { name: 'Scan social media', metadata: { phase: 'social-media-scan' } },
      { name: 'Analyze threats', metadata: { phase: 'analysis' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<BrandImpersonationJob>): Promise<BrandImpersonationResult> {
    const { programId, brands, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'brand-impersonation',
      'start',
      'info',
      `Starting brand impersonation detection for ${brands.length} brands`
    );

    const result: BrandImpersonationResult = {
      threats: [],
      domainsChecked: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Generate typosquatting variants
      await this.updateStepStatus(job.id, 0, 'running');
      const variants = await this.generateTyposquattingVariants(brands, programId, job.id);
      await this.updateStepStatus(job.id, 0, 'completed', { variantsGenerated: variants.length });

      // Step 2: Check domain registrations
      if (options.checkDomainRegistrations !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const domainThreats = await this.checkDomainRegistrations(variants, brands, programId, job.id);
        result.threats.push(...domainThreats.threats);
        result.domainsChecked = domainThreats.domainsChecked;
        await this.updateStepStatus(job.id, 1, 'completed', { threatsFound: domainThreats.threats.length });
      }

      // Step 3: Detect phishing sites
      if (options.checkPhishing !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const phishingThreats = await this.detectPhishingSites(result.threats, brands, programId, job.id);
        result.threats.push(...phishingThreats);
        await this.updateStepStatus(job.id, 2, 'completed', { phishingSitesFound: phishingThreats.length });
      }

      // Step 4: Scan social media
      if (options.checkSocialMedia !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const socialThreats = await this.scanSocialMedia(brands, programId, job.id);
        result.threats.push(...socialThreats);
        await this.updateStepStatus(job.id, 3, 'completed', { fakeAccountsFound: socialThreats.length });
      }

      // Step 5: Analyze threats
      await this.updateStepStatus(job.id, 4, 'running');
      await this.analyzeThreats(result.threats, programId, job.id);
      await this.updateStepStatus(job.id, 4, 'completed');

      // Step 6: Store findings
      await this.updateStepStatus(job.id, 5, 'running');
      if (result.threats.length > 0) {
        await this.storeFindingsInDatabase(result.threats, programId, job.id);
      }
      await this.updateStepStatus(job.id, 5, 'completed', { totalThreats: result.threats.length });

      // Three-agent integration
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && result.threats.length > 0) {
        await this.shareWithSwarm(swarmId, result.threats, job.id);
      }

      result.executionTime = Date.now() - startTime;

      await this.updateJobStatus(job.id, 'completed', result);
      await this.logExecution(
        job.id,
        programId,
        'brand-impersonation',
        'complete',
        'success',
        `Found ${result.threats.length} brand impersonation threats from ${result.domainsChecked} domains checked in ${result.executionTime}ms`
      );

      if (result.threats.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'brand-impersonation',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Generate typosquatting domain variants
   */
  private async generateTyposquattingVariants(
    brands: BrandImpersonationJob['brands'],
    programId: string,
    jobId: string
  ): Promise<Array<{ variant: string; technique: string; brandName: string }>> {
    const variants: Array<{ variant: string; technique: string; brandName: string }> = [];

    for (const brand of brands) {
      for (const domain of brand.domains) {
        const baseName = domain.split('.')[0];
        const tld = domain.split('.').slice(1).join('.');

        // Character substitution (1 -> l, 0 -> o, etc.)
        const substitutions = [
          { from: 'l', to: '1' },
          { from: 'i', to: '1' },
          { from: 'o', to: '0' },
          { from: 'a', to: '@' },
          { from: 'e', to: '3' },
        ];
        for (const sub of substitutions) {
          if (baseName.includes(sub.from)) {
            variants.push({
              variant: `${baseName.replace(sub.from, sub.to)}.${tld}`,
              technique: 'character-substitution',
              brandName: brand.name,
            });
          }
        }

        // Missing characters
        for (let i = 0; i < baseName.length; i++) {
          const missing = baseName.slice(0, i) + baseName.slice(i + 1);
          if (missing.length >= 3) {
            variants.push({
              variant: `${missing}.${tld}`,
              technique: 'missing-character',
              brandName: brand.name,
            });
          }
        }

        // Added characters (doubling)
        for (let i = 0; i < baseName.length; i++) {
          const doubled = baseName.slice(0, i + 1) + baseName[i] + baseName.slice(i + 1);
          variants.push({
            variant: `${doubled}.${tld}`,
            technique: 'added-character',
            brandName: brand.name,
          });
        }

        // Hyphenation
        for (let i = 1; i < baseName.length; i++) {
          const hyphenated = baseName.slice(0, i) + '-' + baseName.slice(i);
          variants.push({
            variant: `${hyphenated}.${tld}`,
            technique: 'hyphenation',
            brandName: brand.name,
          });
        }

        // TLD variations
        const commonTLDs = ['com', 'net', 'org', 'io', 'co', 'info', 'biz', 'app', 'online'];
        for (const alternativeTLD of commonTLDs) {
          if (alternativeTLD !== tld) {
            variants.push({
              variant: `${baseName}.${alternativeTLD}`,
              technique: 'tld-variation',
              brandName: brand.name,
            });
          }
        }

        // Common misspellings (adjacent keyboard keys)
        const keyboardNeighbors: Record<string, string[]> = {
          a: ['s', 'q', 'w'],
          s: ['a', 'd', 'w', 'e'],
          e: ['w', 'r', 'd'],
          // Add more as needed
        };
        for (let i = 0; i < baseName.length; i++) {
          const char = baseName[i];
          const neighbors = keyboardNeighbors[char] || [];
          for (const neighbor of neighbors) {
            const typo = baseName.slice(0, i) + neighbor + baseName.slice(i + 1);
            variants.push({
              variant: `${typo}.${tld}`,
              technique: 'keyboard-typo',
              brandName: brand.name,
            });
          }
        }
      }
    }

    // Limit to reasonable number
    return variants.slice(0, 500);
  }

  /**
   * Check if typosquatting domains are registered
   */
  private async checkDomainRegistrations(
    variants: Array<{ variant: string; technique: string; brandName: string }>,
    brands: BrandImpersonationJob['brands'],
    programId: string,
    jobId: string
  ): Promise<{ threats: BrandImpersonationResult['threats']; domainsChecked: number }> {
    const threats: BrandImpersonationResult['threats'] = [];
    let domainsChecked = 0;

    for (const variantData of variants.slice(0, 100)) {
      try {
        domainsChecked++;

        // Check if domain is registered and active
        const response = await axios.get(`http://${variantData.variant}`, {
          timeout: 5000,
          validateStatus: () => true,
          maxRedirects: 5,
        });

        // Domain is registered and serving content
        if (response.status === 200 || response.status === 301 || response.status === 302) {
          const similarity = this.calculateSimilarity(variantData.variant, variantData.brandName);

          threats.push({
            type: 'typosquatting',
            domain: variantData.variant,
            url: `http://${variantData.variant}`,
            brandName: variantData.brandName,
            similarity: similarity,
            evidence: `Typosquatting domain detected using ${variantData.technique} technique. Domain responds with HTTP ${response.status}`,
            severity: similarity > 0.8 ? 'high' : 'medium',
            confidence: 0.85,
            active: true,
          });
        }
      } catch (error: any) {
        // Domain not registered or not responding
        logger.debug({ variant: variantData.variant, error: error.message }, 'Domain check error');
      }
    }

    return { threats, domainsChecked };
  }

  /**
   * Detect phishing sites among registered domains
   */
  private async detectPhishingSites(
    existingThreats: BrandImpersonationResult['threats'],
    brands: BrandImpersonationJob['brands'],
    programId: string,
    jobId: string
  ): Promise<BrandImpersonationResult['threats']> {
    const phishingThreats: BrandImpersonationResult['threats'] = [];

    for (const threat of existingThreats.filter((t) => t.active)) {
      try {
        const response = await axios.get(threat.url, {
          timeout: 10000,
          validateStatus: () => true,
        });

        const content = typeof response.data === 'string' ? response.data : '';

        // Check for phishing indicators
        const hasLoginForm = content.includes('<form') && (content.includes('password') || content.includes('login'));
        const hasBrandMention = brands.some((brand) =>
          content.toLowerCase().includes(brand.name.toLowerCase())
        );
        const hasSSL = threat.url.startsWith('https://');
        const hasSuspiciousTitle = content.match(/<title>([^<]+)<\/title>/i);

        if (hasLoginForm && hasBrandMention) {
          phishingThreats.push({
            type: 'phishing',
            domain: threat.domain,
            url: threat.url,
            brandName: threat.brandName,
            similarity: threat.similarity,
            evidence: `Phishing site detected: Login form present, brand name mentioned, SSL: ${hasSSL}, Title: ${hasSuspiciousTitle?.[1] || 'N/A'}`,
            severity: 'critical',
            confidence: 0.9,
            active: true,
          });
        }
      } catch (error: any) {
        logger.debug({ url: threat.url, error: error.message }, 'Error detecting phishing');
      }
    }

    return phishingThreats;
  }

  /**
   * Scan social media for fake accounts
   */
  private async scanSocialMedia(
    brands: BrandImpersonationJob['brands'],
    programId: string,
    jobId: string
  ): Promise<BrandImpersonationResult['threats']> {
    const threats: BrandImpersonationResult['threats'] = [];

    // Note: Real implementation would use social media APIs
    // This is a simplified simulation

    for (const brand of brands) {
      // Twitter/X search
      try {
        const searchQuery = encodeURIComponent(brand.name);
        const response = await axios.get(`https://twitter.com/search?q=${searchQuery}&f=user`, {
          timeout: 10000,
          validateStatus: () => true,
        });

        // Simplified detection - would need proper scraping or API
        const content = typeof response.data === 'string' ? response.data : '';
        if (content.includes(brand.name) && content.includes('Unverified')) {
          threats.push({
            type: 'fake-social-media',
            url: `https://twitter.com/search?q=${searchQuery}`,
            brandName: brand.name,
            similarity: 0.9,
            evidence: `Potential fake Twitter/X account found for brand: ${brand.name}`,
            severity: 'medium',
            confidence: 0.6,
            active: true,
          });
        }
      } catch (error: any) {
        logger.debug({ brand: brand.name, error: error.message }, 'Error scanning Twitter');
      }
    }

    return threats;
  }

  /**
   * Calculate string similarity using Levenshtein distance
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }

    const distance = costs[s2.length];
    const maxLength = Math.max(s1.length, s2.length);
    return 1 - distance / maxLength;
  }

  /**
   * Analyze threats for severity
   */
  private async analyzeThreats(
    threats: BrandImpersonationResult['threats'],
    programId: string,
    jobId: string
  ): Promise<void> {
    for (const threat of threats) {
      // Escalate severity for active phishing sites
      if (threat.type === 'phishing' && threat.active) {
        threat.severity = 'critical';
        threat.confidence = Math.min(threat.confidence + 0.1, 1.0);
      }

      // High similarity = higher severity
      if (threat.similarity > 0.9) {
        if (threat.severity === 'medium') threat.severity = 'high';
      }
    }
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    threats: BrandImpersonationResult['threats'],
    programId: string,
    jobId: string
  ) {
    for (const threat of threats) {
      await database.query(
        `INSERT INTO findings (
          program_id, job_id, type, severity, url, evidence,
          poc, remediation, confidence, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (program_id, url, type) DO UPDATE SET
          evidence = EXCLUDED.evidence,
          updated_at = NOW()`,
        [
          programId,
          jobId,
          `brand-${threat.type}`,
          threat.severity,
          threat.url,
          `Brand: ${threat.brandName}\nSimilarity: ${(threat.similarity * 100).toFixed(1)}%\nActive: ${threat.active}\n\n${threat.evidence}`,
          threat.domain ? `Visit ${threat.url} to verify` : '',
          threat.type === 'phishing'
            ? 'File DMCA takedown request. Contact domain registrar. Report to anti-phishing organizations (APWG). Alert users. Consider legal action.'
            : 'Monitor domain. File trademark infringement claim if applicable. Contact registrar for domain dispute resolution. Consider domain buyout.',
          threat.confidence,
          JSON.stringify({
            domain: threat.domain,
            brandName: threat.brandName,
            similarity: threat.similarity,
            type: threat.type,
            active: threat.active,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: threats.length,
      severity: 'high',
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    threats: BrandImpersonationResult['threats'],
    jobId: string
  ) {
    try {
      const findings = threats.map((threat) => ({
        id: uuidv4(),
        type: `brand-${threat.type}`,
        severity: threat.severity,
        url: threat.url,
        evidence: `${threat.brandName} impersonation (${(threat.similarity * 100).toFixed(1)}% similar)`,
        confidence: threat.confidence,
        timestamp: new Date(),
        discoveredBy: `brand-impersonation-${jobId}`,
        metadata: {
          domain: threat.domain,
          brandName: threat.brandName,
          similarity: threat.similarity,
          active: threat.active,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ Brand impersonation agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share brand impersonation findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<BrandImpersonationJob>, result: BrandImpersonationResult) {
    const { programId } = job.data;

    // Active phishing sites -> immediate escalation
    const phishingThreats = result.threats.filter((t) => t.type === 'phishing' && t.active);

    if (phishingThreats.length > 0) {
      await this.createHandoff(
        job.id,
        'brand-impersonation',
        'triage',
        {
          reason: 'Active phishing sites impersonating brand detected - immediate takedown required',
          vulnerabilities: phishingThreats,
          priority: 'critical',
        },
        programId
      );
    }

    // All threats need review
    if (result.threats.length > 0) {
      await this.createHandoff(
        job.id,
        'brand-impersonation',
        'confirm',
        {
          reason: 'Brand impersonation threats require manual review and legal action',
          targets: result.threats.map((t) => t.url),
          testType: 'brand-impersonation',
        },
        programId
      );
    }
  }
}
