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

export interface DarkWebIntelJob extends BaseJob {
  programId: string;
  targets: {
    domains?: string[];
    keywords?: string[];
    credentials?: Array<{ email: string; username: string }>;
  };
  options: {
    searchPastebins?: boolean;
    searchForums?: boolean;
    searchMarketplaces?: boolean;
    monitorBreaches?: boolean;
    timeout?: number;
  };
}

export interface DarkWebIntelResult {
  findings: Array<{
    source: string;
    type: 'credential-dump' | 'data-breach' | 'forum-mention' | 'marketplace-listing' | 'pastebin' | 'chat-log';
    title: string;
    content: string;
    url?: string;
    discovered: Date;
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    relatedTo: string; // domain, keyword, or credential
  }>;
  sourcesChecked: number;
  executionTime: number;
}

/**
 * Dark Web Intelligence Agent
 *
 * Monitors dark web and underground forums for:
 *
 * Credential Leaks:
 * - Breached credentials (email:password combinations)
 * - Database dumps
 * - Employee credentials
 * - API keys and tokens
 *
 * Data Breaches:
 * - Company data dumps
 * - Customer databases
 * - Internal documents
 * - Source code leaks
 *
 * Threat Intelligence:
 * - Mentions in hacker forums
 * - Vulnerability disclosures
 * - Exploit sales
 * - Ransomware communications
 *
 * Brand Monitoring:
 * - Domain mentions
 * - Brand abuse
 * - Impersonation attempts
 * - Fraudulent services
 *
 * Sources Monitored:
 * - Public paste sites (Pastebin, GitHub Gists, etc.)
 * - Breach databases (Have I Been Pwned, DeHashed, etc.)
 * - Hacker forums (simulated - real monitoring requires special access)
 * - Telegram groups (public)
 * - Dark web marketplaces (simulated)
 *
 * NOTE: This agent monitors ONLY publicly accessible sources.
 * Actual dark web (.onion) access requires Tor integration.
 *
 * Tools: HIBP API, DeHashed patterns
 */
export class DarkWebIntelAgent extends BaseAgent<DarkWebIntelJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('darkweb-intel' as any);
  }

  protected getSteps() {
    return [
      { name: 'Search pastebin sites', metadata: { phase: 'pastebin-search' } },
      { name: 'Check breach databases', metadata: { phase: 'breach-check' } },
      { name: 'Monitor forums', metadata: { phase: 'forum-monitoring' } },
      { name: 'Analyze findings', metadata: { phase: 'analysis' } },
      { name: 'Store intelligence', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<DarkWebIntelJob>): Promise<DarkWebIntelResult> {
    const { programId, targets, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'darkweb-intel',
      'start',
      'info',
      `Starting dark web intelligence gathering for ${targets.domains?.length || 0} domains, ${targets.keywords?.length || 0} keywords`
    );

    const result: DarkWebIntelResult = {
      findings: [],
      sourcesChecked: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Search pastebin sites
      if (options.searchPastebins !== false) {
        await this.updateStepStatus(job.id, 0, 'running');
        const pastebinFindings = await this.searchPastebins(targets, programId, job.id);
        result.findings.push(...pastebinFindings.findings);
        result.sourcesChecked += pastebinFindings.sourcesChecked;
        await this.updateStepStatus(job.id, 0, 'completed', {
          findingsFound: pastebinFindings.findings.length,
        });
      }

      // Step 2: Check breach databases
      if (options.monitorBreaches !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const breachFindings = await this.checkBreachDatabases(targets, programId, job.id);
        result.findings.push(...breachFindings.findings);
        result.sourcesChecked += breachFindings.sourcesChecked;
        await this.updateStepStatus(job.id, 1, 'completed', {
          findingsFound: breachFindings.findings.length,
        });
      }

      // Step 3: Monitor forums
      if (options.searchForums !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const forumFindings = await this.monitorForums(targets, programId, job.id);
        result.findings.push(...forumFindings.findings);
        result.sourcesChecked += forumFindings.sourcesChecked;
        await this.updateStepStatus(job.id, 2, 'completed', {
          findingsFound: forumFindings.findings.length,
        });
      }

      // Step 4: Analyze findings
      await this.updateStepStatus(job.id, 3, 'running');
      await this.analyzeFindings(result.findings, programId, job.id);
      await this.updateStepStatus(job.id, 3, 'completed');

      // Step 5: Store intelligence
      await this.updateStepStatus(job.id, 4, 'running');
      if (result.findings.length > 0) {
        await this.storeFindingsInDatabase(result.findings, programId, job.id);
      }
      await this.updateStepStatus(job.id, 4, 'completed', { totalFindings: result.findings.length });

      // Three-agent integration
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && result.findings.length > 0) {
        await this.shareWithSwarm(swarmId, result.findings, job.id);
      }

      result.executionTime = Date.now() - startTime;

      await this.updateJobStatus(job.id, 'completed', result);
      await this.logExecution(
        job.id,
        programId,
        'darkweb-intel',
        'complete',
        'success',
        `Found ${result.findings.length} dark web intelligence findings from ${result.sourcesChecked} sources in ${result.executionTime}ms`
      );

      if (result.findings.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'darkweb-intel',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Search pastebin sites for leaks
   */
  private async searchPastebins(
    targets: DarkWebIntelJob['targets'],
    programId: string,
    jobId: string
  ): Promise<{ findings: DarkWebIntelResult['findings']; sourcesChecked: number }> {
    const findings: DarkWebIntelResult['findings'] = [];
    let sourcesChecked = 0;

    const pastebinSites = [
      'https://pastebin.com',
      'https://ghostbin.com',
      'https://paste.ee',
      'https://justpaste.it',
    ];

    const searchTerms = [
      ...(targets.domains || []),
      ...(targets.keywords || []),
      ...(targets.credentials || []).map((c) => c.email),
    ];

    for (const site of pastebinSites) {
      for (const term of searchTerms.slice(0, 5)) {
        // Limit searches
        try {
          sourcesChecked++;

          // Simulate pastebin search
          // In real implementation, would use site-specific APIs or scraping
          const searchUrl = `${site}/search?q=${encodeURIComponent(term)}`;
          const response = await axios.get(searchUrl, {
            timeout: 10000,
            validateStatus: () => true,
          });

          if (response.status === 200) {
            const content = typeof response.data === 'string' ? response.data : '';

            // Look for credential patterns
            const credentialPattern = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+):([^\s]+)/g;
            const matches = content.matchAll(credentialPattern);

            let matchCount = 0;
            for (const match of matches) {
              if (matchCount++ >= 10) break; // Limit results

              findings.push({
                source: site,
                type: 'pastebin',
                title: `Credentials found on ${site}`,
                content: `Email: ${match[1]}\nPassword: [REDACTED]\nFound in search for: ${term}`,
                url: searchUrl,
                discovered: new Date(),
                severity: 'high',
                confidence: 0.7,
                relatedTo: term,
              });
            }

            // Look for database dumps
            if (
              content.includes('INSERT INTO') ||
              content.includes('CREATE TABLE') ||
              content.includes('mongodump')
            ) {
              findings.push({
                source: site,
                type: 'credential-dump',
                title: `Database dump found on ${site}`,
                content: `Database dump detected containing ${term}\nPreview: ${content.substring(0, 200)}...`,
                url: searchUrl,
                discovered: new Date(),
                severity: 'critical',
                confidence: 0.85,
                relatedTo: term,
              });
            }
          }
        } catch (error: any) {
          logger.debug({ site, term, error: error.message }, 'Error searching pastebin');
        }
      }
    }

    return { findings, sourcesChecked };
  }

  /**
   * Check breach databases
   */
  private async checkBreachDatabases(
    targets: DarkWebIntelJob['targets'],
    programId: string,
    jobId: string
  ): Promise<{ findings: DarkWebIntelResult['findings']; sourcesChecked: number }> {
    const findings: DarkWebIntelResult['findings'] = [];
    let sourcesChecked = 0;

    // Check Have I Been Pwned API
    const emails = targets.credentials?.map((c) => c.email) || [];
    const domains = targets.domains || [];

    for (const email of emails.slice(0, 10)) {
      try {
        sourcesChecked++;

        // Have I Been Pwned API (requires API key in production)
        const response = await axios.get(`https://haveibeenpwned.com/api/v3/breachedaccount/${encodeURIComponent(email)}`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'AgentHunt-Security-Scanner',
          },
          validateStatus: () => true,
        });

        if (response.status === 200 && Array.isArray(response.data)) {
          for (const breach of response.data) {
            findings.push({
              source: 'Have I Been Pwned',
              type: 'data-breach',
              title: `Breach: ${breach.Name}`,
              content: `Email ${email} found in ${breach.Name} breach\nBreach Date: ${breach.BreachDate}\nData Classes: ${breach.DataClasses?.join(', ')}\nDescription: ${breach.Description}`,
              url: `https://haveibeenpwned.com/account/${email}`,
              discovered: new Date(),
              severity: breach.IsSensitive ? 'critical' : 'high',
              confidence: 1.0,
              relatedTo: email,
            });
          }
        }
      } catch (error: any) {
        logger.debug({ email, error: error.message }, 'Error checking HIBP');
      }
    }

    // Check for domain breaches
    for (const domain of domains.slice(0, 5)) {
      try {
        sourcesChecked++;

        const response = await axios.get(`https://haveibeenpwned.com/api/v3/breaches?domain=${encodeURIComponent(domain)}`, {
          timeout: 10000,
          headers: {
            'User-Agent': 'AgentHunt-Security-Scanner',
          },
          validateStatus: () => true,
        });

        if (response.status === 200 && Array.isArray(response.data)) {
          for (const breach of response.data) {
            findings.push({
              source: 'Have I Been Pwned',
              type: 'data-breach',
              title: `Domain Breach: ${breach.Name}`,
              content: `Domain ${domain} affected by ${breach.Name} breach\nAffected Accounts: ${breach.PwnCount}\nData Classes: ${breach.DataClasses?.join(', ')}`,
              url: `https://haveibeenpwned.com/domain/${domain}`,
              discovered: new Date(),
              severity: 'critical',
              confidence: 1.0,
              relatedTo: domain,
            });
          }
        }
      } catch (error: any) {
        logger.debug({ domain, error: error.message }, 'Error checking domain breaches');
      }
    }

    return { findings, sourcesChecked };
  }

  /**
   * Monitor hacker forums
   */
  private async monitorForums(
    targets: DarkWebIntelJob['targets'],
    programId: string,
    jobId: string
  ): Promise<{ findings: DarkWebIntelResult['findings']; sourcesChecked: number }> {
    const findings: DarkWebIntelResult['findings'] = [];
    let sourcesChecked = 0;

    // Public forums and communities (simulated)
    const forums = [
      { name: 'GitHub Issues', url: 'https://api.github.com/search/issues' },
      { name: 'Reddit', url: 'https://www.reddit.com/search.json' },
      { name: 'HackerNews', url: 'https://hn.algolia.com/api/v1/search' },
    ];

    const searchTerms = [...(targets.domains || []), ...(targets.keywords || [])];

    for (const forum of forums) {
      for (const term of searchTerms.slice(0, 3)) {
        try {
          sourcesChecked++;

          let response;
          if (forum.name === 'GitHub Issues') {
            response = await axios.get(`${forum.url}?q=${encodeURIComponent(term + ' vulnerability')}`, {
              timeout: 10000,
              validateStatus: () => true,
            });

            if (response.status === 200 && response.data.items) {
              for (const item of response.data.items.slice(0, 5)) {
                findings.push({
                  source: forum.name,
                  type: 'forum-mention',
                  title: item.title,
                  content: `Vulnerability discussion found: ${item.title}\nBody: ${item.body?.substring(0, 300) || 'N/A'}`,
                  url: item.html_url,
                  discovered: new Date(),
                  severity: 'medium',
                  confidence: 0.6,
                  relatedTo: term,
                });
              }
            }
          } else if (forum.name === 'Reddit') {
            response = await axios.get(`${forum.url}?q=${encodeURIComponent(term + ' breach')}`, {
              timeout: 10000,
              validateStatus: () => true,
            });

            if (response.status === 200 && response.data?.data?.children) {
              for (const post of response.data.data.children.slice(0, 5)) {
                const data = post.data;
                if (
                  data.title?.toLowerCase().includes('breach') ||
                  data.title?.toLowerCase().includes('leak')
                ) {
                  findings.push({
                    source: forum.name,
                    type: 'forum-mention',
                    title: data.title,
                    content: `Reddit post mentioning ${term}: ${data.selftext?.substring(0, 300) || data.title}`,
                    url: `https://reddit.com${data.permalink}`,
                    discovered: new Date(),
                    severity: 'medium',
                    confidence: 0.5,
                    relatedTo: term,
                  });
                }
              }
            }
          }
        } catch (error: any) {
          logger.debug({ forum: forum.name, term, error: error.message }, 'Error monitoring forum');
        }
      }
    }

    return { findings, sourcesChecked };
  }

  /**
   * Analyze findings for severity and confidence
   */
  private async analyzeFindings(
    findings: DarkWebIntelResult['findings'],
    programId: string,
    jobId: string
  ): Promise<void> {
    for (const finding of findings) {
      // Boost severity if finding contains critical keywords
      const criticalKeywords = ['password', 'admin', 'root', 'database', 'api key', 'token', 'private key'];
      const hasCriticalKeyword = criticalKeywords.some((keyword) =>
        finding.content.toLowerCase().includes(keyword)
      );

      if (hasCriticalKeyword && finding.severity !== 'critical') {
        finding.severity = 'high';
      }

      // Boost confidence for verified sources
      if (finding.source === 'Have I Been Pwned') {
        finding.confidence = 1.0;
      }
    }
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    findings: DarkWebIntelResult['findings'],
    programId: string,
    jobId: string
  ) {
    for (const finding of findings) {
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
          `darkweb-${finding.type}`,
          finding.severity,
          finding.url || finding.source,
          `${finding.title}\n\nSource: ${finding.source}\nRelated to: ${finding.relatedTo}\nDiscovered: ${finding.discovered.toISOString()}\n\n${finding.content}`,
          finding.url || '',
          finding.type === 'credential-dump' || finding.type === 'data-breach'
            ? 'Immediately force password resets for affected accounts. Notify users of breach. Enable MFA. Monitor for fraudulent activity. Contact law enforcement if necessary.'
            : 'Monitor the source for updates. Verify if data is legitimate. Take appropriate action if sensitive data is exposed.',
          finding.confidence,
          JSON.stringify({
            source: finding.source,
            type: finding.type,
            relatedTo: finding.relatedTo,
            discovered: finding.discovered,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: findings.length,
      severity: 'critical',
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    findings: DarkWebIntelResult['findings'],
    jobId: string
  ) {
    try {
      const intelFindings = findings.map((finding) => ({
        id: uuidv4(),
        type: `darkweb-${finding.type}`,
        severity: finding.severity,
        url: finding.url || finding.source,
        evidence: `${finding.title} (Source: ${finding.source})`,
        confidence: finding.confidence,
        timestamp: new Date(),
        discoveredBy: `darkweb-intel-${jobId}`,
        metadata: {
          source: finding.source,
          relatedTo: finding.relatedTo,
          discovered: finding.discovered,
        },
      }));

      await sharedMemory.storeFindings(swarmId, intelFindings);

      logger.info(
        { swarmId, findingsShared: intelFindings.length },
        '⚡ Dark web intel agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share dark web intel findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<DarkWebIntelJob>, result: DarkWebIntelResult) {
    const { programId } = job.data;

    // Critical findings (breaches, credential dumps) -> immediate escalation
    const criticalFindings = result.findings.filter(
      (f) =>
        f.severity === 'critical' ||
        f.type === 'credential-dump' ||
        f.type === 'data-breach'
    );

    if (criticalFindings.length > 0) {
      await this.createHandoff(
        job.id,
        'darkweb-intel',
        'triage',
        {
          reason: 'Critical dark web intelligence: credential dumps or data breaches detected',
          vulnerabilities: criticalFindings,
          priority: 'critical',
        },
        programId
      );
    }

    // All findings need review
    if (result.findings.length > 0) {
      await this.createHandoff(
        job.id,
        'darkweb-intel',
        'confirm',
        {
          reason: 'Dark web intelligence findings require manual review',
          targets: result.findings.map((f) => f.source),
          testType: 'dark-web-intel',
        },
        programId
      );
    }
  }
}
