import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import config from '../config';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';

export interface OsintJob extends BaseJob {
  programId: string;
  domain: string;
  options: {
    emailLeaks?: boolean;
    metadata?: boolean;
    apiLeaks?: boolean;
    googleDorks?: boolean;
    githubRepos?: boolean;
    githubSecrets?: boolean;
    thirdPartyMisconfigs?: boolean;
    spoofCheck?: boolean;
    msftRecon?: boolean;
    metafinderLimit?: number;
  };
}

export interface OsintResult {
  emails: Array<{ email: string; source: string; leaked?: boolean }>;
  credentials: Array<{ email: string; password?: string; source: string; breach: string }>;
  metadata: Array<{ file: string; author?: string; creator?: string; keywords?: string[] }>;
  apiLeaks: Array<{ api: string; endpoint: string; method: string; source: string }>;
  dorksFindings: Array<{ query: string; url: string; snippet: string }>;
  githubRepos: string[];
  githubSecrets: Array<{ repo: string; file: string; type: string; match: string }>;
  misconfigs: Array<{ service: string; issue: string; severity: string; details: any }>;
  spoofable: { canSpoof: boolean; details: string };
  microsoft: { tenant?: string; domains: string[]; services: string[] };
}

/**
 * OSINT Agent - Advanced Open Source Intelligence Gathering
 *
 * Features:
 * - Email and password leak searches
 * - Microsoft 365/Azure tenant mapping
 * - Metadata extraction from documents
 * - API leak detection
 * - Google dorking automation
 * - GitHub repository and secret scanning
 * - Third-party misconfiguration detection
 * - Domain spoofing checks
 */
export class OsintAgent extends BaseAgent<OsintJob> {
  private enhanced = new EnhancedAgentCapabilities();
  constructor() {
    super('osint' as any);
  }
  protected getSteps() {
    return [
      {
        name: 'Load targets for OSINT',
        metadata: {},
      },
      {
        name: 'Gather intelligence from public sources',
        metadata: {},
      },
      {
        name: 'Analyze and correlate findings',
        metadata: {},
      },
      {
        name: 'Store OSINT data',
        metadata: {},
      },
    ];
  }

  async process(job: Job<OsintJob>): Promise<OsintResult> {
    const { programId, domain, options } = job.data;

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'osint',
      'start',
      'info',
      `Starting OSINT collection for ${domain}`
    );

    const result: OsintResult = {
      emails: [],
      credentials: [],
      metadata: [],
      apiLeaks: [],
      dorksFindings: [],
      githubRepos: [],
      githubSecrets: [],
      misconfigs: [],
      spoofable: { canSpoof: false, details: '' },
      microsoft: { domains: [], services: [] },
    };

    try {
      // Check for cancellation
      if (await this.shouldCancel(job.id)) {
        throw new Error('Job cancelled');
      }

      // Email and credential leak searches
      if (options.emailLeaks !== false) {
        await this.logExecution(
          job.id,
          programId,
          'emailfinder',
          'start',
          'info',
          'Searching for email leaks'
        );
        result.emails = await this.searchEmails(domain, job.id, programId);
        result.credentials = await this.searchLeaks(domain, job.id, programId);
      }

      // Microsoft 365/Azure reconnaissance
      if (options.msftRecon !== false) {
        await this.logExecution(
          job.id,
          programId,
          'msftrecon',
          'start',
          'info',
          'Mapping Microsoft services'
        );
        result.microsoft = await this.microsoftRecon(domain, job.id, programId);
      }

      // Metadata extraction from documents
      if (options.metadata !== false) {
        await this.logExecution(
          job.id,
          programId,
          'metagoofil',
          'start',
          'info',
          'Extracting metadata from documents'
        );
        result.metadata = await this.extractMetadata(
          domain,
          options.metafinderLimit || 20,
          job.id,
          programId
        );
      }

      // API leak detection
      if (options.apiLeaks !== false) {
        await this.logExecution(
          job.id,
          programId,
          'porch-pirate',
          'start',
          'info',
          'Detecting API leaks'
        );
        result.apiLeaks = await this.detectApiLeaks(domain, job.id, programId);
      }

      // Google dorking
      if (options.googleDorks !== false) {
        await this.logExecution(
          job.id,
          programId,
          'dorks_hunter',
          'start',
          'info',
          'Running Google dorks'
        );
        result.dorksFindings = await this.googleDorks(domain, job.id, programId);
      }

      // GitHub reconnaissance
      if (options.githubRepos !== false || options.githubSecrets !== false) {
        await this.logExecution(
          job.id,
          programId,
          'github-recon',
          'start',
          'info',
          'Scanning GitHub'
        );
        result.githubRepos = await this.scanGithubRepos(domain, job.id, programId);

        if (options.githubSecrets !== false) {
          result.githubSecrets = await this.scanGithubSecrets(
            result.githubRepos,
            job.id,
            programId
          );
        }
      }

      // Third-party misconfiguration detection
      if (options.thirdPartyMisconfigs !== false) {
        await this.logExecution(
          job.id,
          programId,
          'misconfig-mapper',
          'start',
          'info',
          'Checking third-party misconfigs'
        );
        result.misconfigs = await this.detectMisconfigs(domain, job.id, programId);
      }

      // Domain spoofing check
      if (options.spoofCheck !== false) {
        await this.logExecution(
          job.id,
          programId,
          'spoofcheck',
          'start',
          'info',
          'Checking domain spoofability'
        );
        result.spoofable = await this.checkSpoofing(domain, job.id, programId);
      }

      // Save results to database
      await this.saveOsintResults(programId, domain, result);

      await this.logExecution(
        job.id,
        programId,
        'osint',
        'complete',
        'info',
        `OSINT collection complete: ${result.emails.length} emails, ${result.credentials.length} leaked creds, ${result.githubSecrets.length} secrets found`
      );

      // 🚀 THREE-AGENT INTEGRATION
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory) {
        try {
          const osintFindings = [];
          if (result.credentials.length > 0) {
            osintFindings.push(
              ...result.credentials.map((cred: any) => ({
                id: uuidv4(),
                type: 'leaked-credentials',
                severity: 'critical' as const,
                url: cred.source || 'unknown',
                evidence: `Leaked credential: ${cred.email}`,
                confidence: 0.9,
                timestamp: new Date(),
                discoveredBy: `osint-${job.id}`,
                metadata: { email: cred.email, password: cred.password, source: cred.source },
              }))
            );
          }
          if (result.githubSecrets.length > 0) {
            osintFindings.push(
              ...result.githubSecrets.map((secret: any) => ({
                id: uuidv4(),
                type: 'github-secret',
                severity: 'high' as const,
                url: secret.url || 'unknown',
                evidence: `GitHub secret: ${secret.type}`,
                confidence: 0.85,
                timestamp: new Date(),
                discoveredBy: `osint-${job.id}`,
                metadata: secret,
              }))
            );
          }
          if (osintFindings.length > 0) {
            await sharedMemory.storeFindings(swarmId, osintFindings);
            await sharedMemory.shareSuccess(swarmId, {
              id: uuidv4(),
              name: 'osint-intel',
              description: `Found ${osintFindings.length} OSINT items`,
              successRate: 0.85,
              metadata: {
                emails: result.emails.length,
                credentials: result.credentials.length,
                secrets: result.githubSecrets.length,
              },
            });
            logger.info({ swarmId, osintShared: osintFindings.length }, 'OSINT shared findings');
          }
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share OSINT findings');
        }
      }

      // 🎯 RICH HANDOFF: Send critical OSINT findings to Triage for classification
      const criticalFindings = [
        ...result.credentials,
        ...result.githubSecrets,
        ...result.misconfigs.filter((m: any) => m.severity === 'critical' || m.severity === 'high'),
      ];
      if (criticalFindings.length > 0) {
        await this.handoffToTriage(job.id, programId, result, domain);
      }

      await this.updateJobStatus(job.id, 'completed', result);
      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'osint', 'error', 'error', error.message);
      await this.updateJobStatus(job.id, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Search for email addresses using multiple sources
   */
  private async searchEmails(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<Array<{ email: string; source: string; leaked?: boolean }>> {
    const emails: Array<{ email: string; source: string; leaked?: boolean }> = [];

    try {
      // Hunter.io-style email finder
      const hunterCmd = `emailfinder -d ${domain} 2>/dev/null || echo "[]"`;
      const { stdout: hunterOut } = await this.executeCommand(hunterCmd, { timeout: 120000 });

      const hunterEmails = hunterOut
        .split('\n')
        .filter((line) => line.includes('@'))
        .map((email) => ({ email: email.trim(), source: 'emailfinder', leaked: false }));

      emails.push(...hunterEmails);

      // theHarvester
      const harvesterCmd = `theHarvester -d ${domain} -b google,bing,yahoo,duckduckgo -l 500 2>/dev/null | grep "@${domain}" || echo ""`;
      const { stdout: harvesterOut } = await this.executeCommand(harvesterCmd, { timeout: 180000 });

      const harvesterEmails = harvesterOut
        .split('\n')
        .filter((line) => line.includes('@'))
        .map((email) => ({ email: email.trim(), source: 'theHarvester', leaked: false }));

      emails.push(...harvesterEmails);

      // Deduplicate
      const uniqueEmails = Array.from(new Map(emails.map((e) => [e.email, e])).values());

      logger.info({ count: uniqueEmails.length, domain }, 'Emails discovered');
      return uniqueEmails;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'Email search failed');
      return emails;
    }
  }

  /**
   * Search for leaked credentials
   */
  private async searchLeaks(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<Array<{ email: string; password?: string; source: string; breach: string }>> {
    const leaks: Array<{ email: string; password?: string; source: string; breach: string }> = [];

    try {
      // LeakSearch API (if configured)
      if (process.env.LEAKSEARCH_API_KEY) {
        const cmd = `curl -s "https://leaksearch.net/api/public?query=${domain}" -H "Authorization: Bearer ${process.env.LEAKSEARCH_API_KEY}" || echo "[]"`;
        const { stdout } = await this.executeCommand(cmd, { timeout: 60000 });

        try {
          const data = JSON.parse(stdout);
          if (Array.isArray(data)) {
            data.forEach((leak: any) => {
              leaks.push({
                email: leak.email || '',
                password: leak.password ? '[REDACTED]' : undefined,
                source: 'LeakSearch',
                breach: leak.breach || 'unknown',
              });
            });
          }
        } catch (e) {
          logger.debug('No leaks found in LeakSearch');
        }
      }

      // DeHashed API (if configured)
      if (process.env.DEHASHED_API_KEY && process.env.DEHASHED_USERNAME) {
        const cmd = `curl -s -u "${process.env.DEHASHED_USERNAME}:${process.env.DEHASHED_API_KEY}" "https://api.dehashed.com/search?query=email:${domain}" || echo "{}"`;
        const { stdout } = await this.executeCommand(cmd, { timeout: 60000 });

        try {
          const data = JSON.parse(stdout);
          if (data.entries && Array.isArray(data.entries)) {
            data.entries.forEach((entry: any) => {
              leaks.push({
                email: entry.email || '',
                password: entry.password ? '[REDACTED]' : undefined,
                source: 'DeHashed',
                breach: entry.database_name || 'unknown',
              });
            });
          }
        } catch (e) {
          logger.debug('No leaks found in DeHashed');
        }
      }

      logger.info({ count: leaks.length, domain }, 'Credential leaks discovered');
      return leaks;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'Leak search failed');
      return leaks;
    }
  }

  /**
   * Microsoft 365/Azure reconnaissance
   */
  private async microsoftRecon(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<{ tenant?: string; domains: string[]; services: string[] }> {
    const result: { tenant?: string; domains: string[]; services: string[] } = {
      domains: [],
      services: [],
    };

    try {
      // Check for Microsoft 365 tenant
      const tenantCmd = `curl -s "https://login.microsoftonline.com/${domain}/.well-known/openid-configuration" || echo "{}"`;
      const { stdout: tenantOut } = await this.executeCommand(tenantCmd, { timeout: 30000 });

      try {
        const tenantData = JSON.parse(tenantOut);
        if (tenantData.token_endpoint) {
          const match = tenantData.token_endpoint.match(
            /https:\/\/login\.microsoftonline\.com\/([^\/]+)\//
          );
          if (match) {
            result.tenant = match[1];
          }
        }
      } catch (e) {
        logger.debug('No Microsoft tenant found');
      }

      // Check for Azure services
      const services = [
        { name: 'Azure Portal', url: `https://${domain}.azurewebsites.net` },
        { name: 'Azure Blob', url: `https://${domain}.blob.core.windows.net` },
        { name: 'Azure Table', url: `https://${domain}.table.core.windows.net` },
        { name: 'Azure Queue', url: `https://${domain}.queue.core.windows.net` },
        { name: 'Azure File', url: `https://${domain}.file.core.windows.net` },
      ];

      for (const service of services) {
        const checkCmd = `curl -s -o /dev/null -w "%{http_code}" "${service.url}" --max-time 10 || echo "000"`;
        const { stdout } = await this.executeCommand(checkCmd, { timeout: 15000 });

        if (stdout.trim() !== '000' && stdout.trim() !== '404') {
          result.services.push(service.name);
        }
      }

      logger.info(
        { tenant: result.tenant, services: result.services.length, domain },
        'Microsoft recon complete'
      );
      return result;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'Microsoft recon failed');
      return result;
    }
  }

  /**
   * Extract metadata from indexed documents
   */
  private async extractMetadata(
    domain: string,
    limit: number,
    jobId: string,
    programId: string
  ): Promise<Array<{ file: string; author?: string; creator?: string; keywords?: string[] }>> {
    const metadata: Array<{
      file: string;
      author?: string;
      creator?: string;
      keywords?: string[];
    }> = [];

    try {
      // Use metagoofil or similar tool
      const metaCmd = `metagoofil -d ${domain} -t pdf,doc,docx,xls,xlsx,ppt,pptx -l ${limit} -o /tmp/metagoofil-${jobId} -n ${limit} 2>/dev/null || echo ""`;
      const { stdout } = await this.executeCommand(metaCmd, { timeout: 300000 });

      // Parse results
      const lines = stdout
        .split('\n')
        .filter((line) => line.includes('Author') || line.includes('Creator'));
      lines.forEach((line) => {
        const match = line.match(/File: ([^\s]+).*Author: ([^,]+)/);
        if (match) {
          metadata.push({
            file: match[1],
            author: match[2],
          });
        }
      });

      logger.info({ count: metadata.length, domain }, 'Metadata extracted');
      return metadata;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'Metadata extraction failed');
      return metadata;
    }
  }

  /**
   * Detect API leaks in public sources
   */
  private async detectApiLeaks(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<Array<{ api: string; endpoint: string; method: string; source: string }>> {
    const apiLeaks: Array<{ api: string; endpoint: string; method: string; source: string }> = [];

    try {
      // SwaggerSpy - Find Swagger/OpenAPI specs
      const swaggerCmd = `curl -s "https://www.google.com/search?q=site:${domain}+swagger.json+OR+openapi.json" | grep -oP 'https?://[^"]+swagger[^"]+\\.json' | head -10 || echo ""`;
      const { stdout: swaggerOut } = await this.executeCommand(swaggerCmd, { timeout: 60000 });

      const swaggerUrls = swaggerOut.split('\n').filter((url) => url.trim());

      for (const url of swaggerUrls) {
        const specCmd = `curl -s "${url}" --max-time 10 || echo "{}"`;
        const { stdout: specOut } = await this.executeCommand(specCmd, { timeout: 15000 });

        try {
          const spec = JSON.parse(specOut);
          if (spec.paths) {
            Object.keys(spec.paths).forEach((path) => {
              Object.keys(spec.paths[path]).forEach((method) => {
                apiLeaks.push({
                  api: url,
                  endpoint: path,
                  method: method.toUpperCase(),
                  source: 'Swagger/OpenAPI',
                });
              });
            });
          }
        } catch (e) {
          logger.debug({ url }, 'Failed to parse Swagger spec');
        }
      }

      // Porch-pirate - postman collection finder
      const postmanCmd = `curl -s "https://www.postman.com/search?q=${domain}" | grep -oP 'href="/[^"]+/collection/[^"]+"' | head -10 || echo ""`;
      const { stdout: postmanOut } = await this.executeCommand(postmanCmd, { timeout: 60000 });

      const postmanUrls = postmanOut.split('\n').filter((url) => url.includes('collection'));
      if (postmanUrls.length > 0) {
        apiLeaks.push({
          api: 'Postman Collections',
          endpoint: `Found ${postmanUrls.length} collections`,
          method: 'VARIOUS',
          source: 'Postman',
        });
      }

      logger.info({ count: apiLeaks.length, domain }, 'API leaks detected');
      return apiLeaks;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'API leak detection failed');
      return apiLeaks;
    }
  }

  /**
   * Perform automated Google dorking
   */
  private async googleDorks(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<Array<{ query: string; url: string; snippet: string }>> {
    const findings: Array<{ query: string; url: string; snippet: string }> = [];

    const dorks = [
      `site:${domain} ext:log`,
      `site:${domain} ext:sql`,
      `site:${domain} ext:env`,
      `site:${domain} ext:bak`,
      `site:${domain} intext:"error" | intext:"warning" | intext:"exception"`,
      `site:${domain} inurl:admin | inurl:login | inurl:dashboard`,
      `site:${domain} intext:"api_key" | intext:"apikey" | intext:"secret"`,
      `site:${domain} intitle:"Index of /"`,
      `site:${domain} ext:php inurl:config`,
      `site:${domain} filetype:pdf`,
    ];

    try {
      for (const dork of dorks) {
        if (await this.shouldCancel(jobId)) break;

        // Use googler or custom scraper (respecting rate limits)
        const dorkCmd = `googler --json -n 10 "${dork}" 2>/dev/null || echo "[]"`;
        const { stdout } = await this.executeCommand(dorkCmd, { timeout: 60000 });

        try {
          const results = JSON.parse(stdout);
          if (Array.isArray(results)) {
            results.forEach((result: any) => {
              findings.push({
                query: dork,
                url: result.url || '',
                snippet: result.abstract || '',
              });
            });
          }
        } catch (e) {
          logger.debug({ dork }, 'No results for dork');
        }

        // Rate limiting - wait 3 seconds between queries
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }

      logger.info({ count: findings.length, domain }, 'Google dork findings');
      return findings;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'Google dorking failed');
      return findings;
    }
  }

  /**
   * Scan GitHub for repositories related to domain
   */
  private async scanGithubRepos(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<string[]> {
    const repos: string[] = [];

    try {
      if (!process.env.GITHUB_TOKEN) {
        logger.warn('GITHUB_TOKEN not set, skipping GitHub scan');
        return repos;
      }

      // Search for repositories mentioning the domain
      const searchCmd = `curl -s -H "Authorization: token ${process.env.GITHUB_TOKEN}" "https://api.github.com/search/repositories?q=${domain}&per_page=100" || echo "{}"`;
      const { stdout } = await this.executeCommand(searchCmd, { timeout: 60000 });

      try {
        const data = JSON.parse(stdout);
        if (data.items && Array.isArray(data.items)) {
          data.items.forEach((repo: any) => {
            repos.push(repo.full_name);
          });
        }
      } catch (e) {
        logger.debug('No GitHub repos found');
      }

      logger.info({ count: repos.length, domain }, 'GitHub repos discovered');
      return repos;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'GitHub repo scan failed');
      return repos;
    }
  }

  /**
   * Scan GitHub repositories for secrets
   */
  private async scanGithubSecrets(
    repos: string[],
    jobId: string,
    programId: string
  ): Promise<Array<{ repo: string; file: string; type: string; match: string }>> {
    const secrets: Array<{ repo: string; file: string; type: string; match: string }> = [];

    try {
      if (!process.env.GITHUB_TOKEN) {
        return secrets;
      }

      for (const repo of repos.slice(0, 10)) {
        // Limit to first 10 repos
        if (await this.shouldCancel(jobId)) break;

        // Use gitleaks or trufflehog
        const tempDir = `/tmp/github-${jobId}-${Date.now()}`;
        const cloneCmd = `git clone --depth 1 https://github.com/${repo}.git ${tempDir} 2>/dev/null || echo "failed"`;
        await this.executeCommand(cloneCmd, { timeout: 120000 });

        // Run gitleaks
        const gitleaksCmd = `gitleaks detect --source ${tempDir} --report-format json --report-path /tmp/gitleaks-${jobId}.json 2>/dev/null || echo "[]"`;
        await this.executeCommand(gitleaksCmd, { timeout: 180000 });

        // Parse results
        try {
          const fs = require('fs');
          const results = JSON.parse(fs.readFileSync(`/tmp/gitleaks-${jobId}.json`, 'utf8'));
          if (Array.isArray(results)) {
            results.forEach((finding: any) => {
              secrets.push({
                repo,
                file: finding.File || '',
                type: finding.RuleID || 'unknown',
                match: finding.Match ? finding.Match.substring(0, 50) + '...' : '',
              });
            });
          }
        } catch (e) {
          logger.debug({ repo }, 'No secrets found in repo');
        }

        // Cleanup
        await this.executeCommand(`rm -rf ${tempDir} /tmp/gitleaks-${jobId}.json`, {
          timeout: 30000,
        });

        // Rate limiting
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      logger.info({ count: secrets.length }, 'GitHub secrets discovered');
      return secrets;
    } catch (error: any) {
      logger.error({ error: error.message }, 'GitHub secret scan failed');
      return secrets;
    }
  }

  /**
   * Detect third-party service misconfigurations
   */
  private async detectMisconfigs(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<Array<{ service: string; issue: string; severity: string; details: any }>> {
    const misconfigs: Array<{ service: string; issue: string; severity: string; details: any }> =
      [];

    try {
      // Check common third-party services
      const services = [
        {
          name: 'Slack',
          check: async () => {
            const cmd = `curl -s "https://${domain}.slack.com" | grep -i "workspace" || echo ""`;
            const { stdout } = await this.executeCommand(cmd, { timeout: 15000 });
            return stdout.trim().length > 0;
          },
        },
        {
          name: 'Jira',
          check: async () => {
            const cmd = `curl -s "https://${domain}.atlassian.net" -o /dev/null -w "%{http_code}" || echo "000"`;
            const { stdout } = await this.executeCommand(cmd, { timeout: 15000 });
            return stdout.trim() !== '000' && stdout.trim() !== '404';
          },
        },
        {
          name: 'GitHub Pages',
          check: async () => {
            const cmd = `curl -s "https://${domain}.github.io" -o /dev/null -w "%{http_code}" || echo "000"`;
            const { stdout } = await this.executeCommand(cmd, { timeout: 15000 });
            return stdout.trim() === '200';
          },
        },
      ];

      for (const service of services) {
        if (await this.shouldCancel(jobId)) break;

        const exists = await service.check();
        if (exists) {
          misconfigs.push({
            service: service.name,
            issue: 'Service endpoint accessible',
            severity: 'info',
            details: { domain },
          });
        }
      }

      logger.info({ count: misconfigs.length, domain }, 'Third-party misconfigs detected');
      return misconfigs;
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'Misconfig detection failed');
      return misconfigs;
    }
  }

  /**
   * Check if domain is spoofable
   */
  private async checkSpoofing(
    domain: string,
    jobId: string,
    programId: string
  ): Promise<{ canSpoof: boolean; details: string }> {
    try {
      // Check SPF, DMARC, DKIM records
      const spfCmd = `dig +short TXT ${domain} | grep "v=spf1" || echo "none"`;
      const dmarcCmd = `dig +short TXT _dmarc.${domain} | grep "v=DMARC1" || echo "none"`;

      const [{ stdout: spfOut }, { stdout: dmarcOut }] = await Promise.all([
        this.executeCommand(spfCmd, { timeout: 15000 }),
        this.executeCommand(dmarcCmd, { timeout: 15000 }),
      ]);

      const hasSPF = !spfOut.includes('none') && spfOut.trim().length > 0;
      const hasDMARC = !dmarcOut.includes('none') && dmarcOut.trim().length > 0;

      const canSpoof = !hasSPF || !hasDMARC;
      const details = `SPF: ${hasSPF ? 'Configured' : 'Missing'}, DMARC: ${hasDMARC ? 'Configured' : 'Missing'}`;

      logger.info({ canSpoof, details, domain }, 'Spoofing check complete');
      return { canSpoof, details };
    } catch (error: any) {
      logger.error({ error: error.message, domain }, 'Spoofing check failed');
      return { canSpoof: false, details: 'Check failed' };
    }
  }

  /**
   * Save OSINT results to database
   */
  private async saveOsintResults(
    programId: string,
    domain: string,
    result: OsintResult
  ): Promise<void> {
    try {
      // Save emails as assets (batch insert for performance)
      if (result.emails.length > 0) {
        try {
          const { batchInsertAssets } = require('../utils/batch-insert');
          const assetsToInsert = result.emails.map((email) => ({
            programId,
            type: 'email',
            value: email.email,
            source: email.source,
            status: 'active',
            metadata: { leaked: email.leaked },
          }));
          await batchInsertAssets(assetsToInsert);
        } catch (error) {
          logger.error(
            { error, count: result.emails.length },
            'Failed to batch save OSINT emails, using fallback'
          );
          // Fallback to individual inserts
          for (const email of result.emails) {
            try {
              await database.query(
                `INSERT INTO assets (program_id, type, value, source, status, metadata)
                 VALUES ($1, 'email', $2, $3, 'active', $4)
                 ON CONFLICT (program_id, type, value_hash) DO UPDATE
                 SET source = array_append(assets.source, $3), metadata = $4`,
                [programId, email.email, [email.source], JSON.stringify({ leaked: email.leaked })]
              );
            } catch (err) {
              logger.error(
                { error: err, email: email.email },
                'Failed to save OSINT email (fallback)'
              );
            }
          }
        }
      }

      // Save credential leaks as findings if any passwords found
      for (const cred of result.credentials.filter((c) => c.password)) {
        await database.query(
          `INSERT INTO findings (program_id, title, description, severity, confidence, status, evidence)
           VALUES ($1, $2, $3, $4, $5, 'new', $6)`,
          [
            programId,
            `Leaked Credentials - ${cred.email}`,
            `Credentials for ${cred.email} found in breach: ${cred.breach}`,
            'high',
            0.9,
            JSON.stringify([
              { type: 'log', content: `Source: ${cred.source}, Breach: ${cred.breach}` },
            ]),
          ]
        );
      }

      // Save GitHub secrets as findings
      for (const secret of result.githubSecrets) {
        await database.query(
          `INSERT INTO findings (program_id, title, description, severity, confidence, status, evidence)
           VALUES ($1, $2, $3, $4, $5, 'new', $6)`,
          [
            programId,
            `GitHub Secret Exposed - ${secret.type}`,
            `Secret of type ${secret.type} found in repository ${secret.repo}`,
            'high',
            0.8,
            JSON.stringify([
              {
                type: 'log',
                content: `File: ${secret.file}, Match: ${secret.match}`,
              },
            ]),
          ]
        );
      }

      logger.info({ programId, domain }, 'OSINT results saved to database');
    } catch (error: any) {
      logger.error({ error: error.message, programId }, 'Failed to save OSINT results');
    }
  }

  /**
   * 🎯 RICH HANDOFF: OSINT → Triage
   * Hands off critical OSINT findings (leaked credentials, secrets, misconfigs) for AI-powered triage
   */
  private async handoffToTriage(
    osintJobId: string,
    programId: string,
    result: any,
    domain: string
  ): Promise<void> {
    const criticalFindings = {
      credentials: result.credentials.length,
      githubSecrets: result.githubSecrets.length,
      misconfigs: result.misconfigs.filter(
        (m: any) => m.severity === 'critical' || m.severity === 'high'
      ).length,
    };

    const totalCritical =
      criticalFindings.credentials + criticalFindings.githubSecrets + criticalFindings.misconfigs;

    const outputContract = {
      triageMethods: ['ai-classification', 'severity-assessment', 'false-positive-filter'],
      requiredEvidence: ['finding-type', 'severity', 'confidence'],
      minConfidence: 0.8,
      maxDuration: 300, // 5 minutes
    };

    await this.createRichHandoff(
      osintJobId,
      programId,
      'triage',
      {
        parentResult: {
          agentType: 'osint',
          summary: {
            totalEmails: result.emails.length,
            leakedCredentials: result.credentials.length,
            githubSecrets: result.githubSecrets.length,
            misconfigurations: result.misconfigs.length,
            criticalFindings: totalCritical,
          },
          credentials: result.credentials,
          githubSecrets: result.githubSecrets,
          misconfigs: result.misconfigs,
          spoofable: result.spoofable,
          domain,
        },
        reasoning: {
          trigger: `Found ${totalCritical} critical OSINT findings requiring classification`,
          confidence: 0.9,
          alternatives: [
            'Report all findings as-is (risk: false positives)',
            'Manual OSINT review (slower)',
            'AI-powered triage and severity assessment (recommended)',
          ],
          decisionFactors: [
            `${result.credentials.length} leaked credentials discovered (critical for credential stuffing)`,
            `${result.githubSecrets.length} GitHub secrets exposed (API keys, tokens)`,
            `${criticalFindings.misconfigs} high/critical misconfigurations found`,
            'OSINT findings often have false positives or outdated data',
            'AI triage can assess real-world exploitability',
          ],
        },
        objectives: {
          primary: 'Classify and prioritize critical OSINT findings for immediate action',
          secondary: [
            'Assess exploitability of leaked credentials (still valid?)',
            'Validate GitHub secrets (keys still active?)',
            'Prioritize misconfigurations by business impact',
            'Filter false positives (old breaches, revoked keys)',
            'Generate actionable intelligence reports',
            'Recommend immediate remediation steps',
          ],
          avoid: [
            'Do not test leaked credentials on production systems',
            'Avoid exposing sensitive credential data in logs',
            'Skip reporting already-revoked secrets',
          ],
        },
        successCriteria: {
          minAssets: totalCritical,
          maxDuration: 300, // 5 min
          requiredFields: ['finding_type', 'severity', 'confidence', 'actionable'],
          qualityThreshold: 0.85,
          customCriteria: {
            falsePositiveRate: 0.2, // Max 20% false positives
            criticalAccuracy: 0.9, // 90% accuracy on critical findings
            actionableRate: 0.7, // 70%+ must be actionable
          },
        },
        inherited: {
          programId,
          rateLimit: 100, // High rate for AI triage
          timeout: 30,
          safetyChecks: true,
          budget: {
            maxRequests: totalCritical,
            maxTime: 300,
          },
          retryPolicy: {
            maxRetries: 1,
            backoff: 'linear',
          },
        },
      },
      outputContract
    );

    logger.info(
      {
        osintJobId,
        programId,
        domain,
        credentials: result.credentials.length,
        secrets: result.githubSecrets.length,
        misconfigs: criticalFindings.misconfigs,
        totalCritical,
      },
      '🔗 OSINT agent initiated rich handoff to Triage'
    );
  }
}
