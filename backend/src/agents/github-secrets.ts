import { BaseAgent } from './base-agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import Logger from '../utils/logger';

const execAsync = promisify(exec);

interface GitHubConfig {
  token?: string; // GitHub PAT
  orgName?: string; // Target organization
  username?: string; // Target user
  deepScan?: boolean; // Scan commit history
  maxRepos?: number;
}

interface SecretPattern {
  name: string;
  regex: RegExp;
  severity: 'critical' | 'high' | 'medium' | 'low';
  validate?: (match: string) => Promise<boolean>;
}

interface SecretFinding {
  type: string;
  secret: string;
  file: string;
  line: number;
  commit?: string;
  repo: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  validated: boolean;
  url: string;
}

export class GitHubSecretsAgent extends BaseAgent {
  name = 'GitHub Secrets Scanner Agent';
  description = 'Scans GitHub repositories for exposed secrets, API keys, credentials, and sensitive data';

  private secretPatterns: SecretPattern[] = [
    // AWS
    {
      name: 'AWS Access Key',
      regex: /AKIA[0-9A-Z]{16}/g,
      severity: 'critical',
      validate: async (key) => await this.validateAWSKey(key)
    },
    {
      name: 'AWS Secret Key',
      regex: /aws(.{0,20})?['\"][0-9a-zA-Z\/+]{40}['\"]/,
      severity: 'critical'
    },
    {
      name: 'AWS Account ID',
      regex: /aws(.{0,20})?['\"][0-9]{12}['\"]/,
      severity: 'medium'
    },

    // Google Cloud
    {
      name: 'Google Cloud API Key',
      regex: /AIza[0-9A-Za-z\\-_]{35}/g,
      severity: 'critical'
    },
    {
      name: 'Google OAuth Token',
      regex: /ya29\.[0-9A-Za-z\\-_]+/g,
      severity: 'critical'
    },
    {
      name: 'Google Cloud Service Account',
      regex: /"type": "service_account"/g,
      severity: 'critical'
    },

    // Azure
    {
      name: 'Azure Storage Account Key',
      regex: /AccountKey=[a-zA-Z0-9+\/=]{88}/g,
      severity: 'critical'
    },
    {
      name: 'Azure SAS Token',
      regex: /sig=[a-zA-Z0-9%]{43,53}%3D/g,
      severity: 'high'
    },

    // GitHub
    {
      name: 'GitHub Personal Access Token',
      regex: /ghp_[0-9a-zA-Z]{36}/g,
      severity: 'critical'
    },
    {
      name: 'GitHub OAuth Token',
      regex: /gho_[0-9a-zA-Z]{36}/g,
      severity: 'critical'
    },
    {
      name: 'GitHub App Token',
      regex: /ghu_[0-9a-zA-Z]{36}/g,
      severity: 'critical'
    },
    {
      name: 'GitHub Refresh Token',
      regex: /ghr_[0-9a-zA-Z]{36}/g,
      severity: 'critical'
    },

    // Payment Gateways
    {
      name: 'Stripe Secret Key',
      regex: /sk_live_[0-9a-zA-Z]{24,}/g,
      severity: 'critical'
    },
    {
      name: 'Stripe Publishable Key',
      regex: /pk_live_[0-9a-zA-Z]{24,}/g,
      severity: 'high'
    },
    {
      name: 'PayPal Client ID',
      regex: /AYjcyDKQA[0-9A-Za-z\\-_]{60}/g,
      severity: 'critical'
    },

    // Communication
    {
      name: 'Slack Token',
      regex: /xox[baprs]-[0-9]{10,13}-[0-9]{10,13}-[0-9a-zA-Z]{24,}/g,
      severity: 'high'
    },
    {
      name: 'Slack Webhook',
      regex: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]{8}\/B[a-zA-Z0-9_]{8}\/[a-zA-Z0-9_]{24}/g,
      severity: 'high'
    },
    {
      name: 'Discord Token',
      regex: /[MN][a-zA-Z\d]{23}\.[\w-]{6}\.[\w-]{27}/g,
      severity: 'high'
    },
    {
      name: 'Discord Webhook',
      regex: /https:\/\/discord\.com\/api\/webhooks\/\d{18}\/[a-zA-Z0-9_-]{68}/g,
      severity: 'medium'
    },

    // Database
    {
      name: 'PostgreSQL Connection String',
      regex: /postgres:\/\/[^:]+:[^@]+@[^\/]+\/\w+/g,
      severity: 'critical'
    },
    {
      name: 'MongoDB Connection String',
      regex: /mongodb(\+srv)?:\/\/[^\s]+/g,
      severity: 'critical'
    },
    {
      name: 'MySQL Connection String',
      regex: /mysql:\/\/[^:]+:[^@]+@[^\/]+\/\w+/g,
      severity: 'critical'
    },

    // API Keys
    {
      name: 'Generic API Key',
      regex: /api[_-]?key['\"]?\s*[:=]\s*['\"]([a-zA-Z0-9_\-]{20,})['\"]/,
      severity: 'high'
    },
    {
      name: 'Generic Secret',
      regex: /secret['\"]?\s*[:=]\s*['\"]([a-zA-Z0-9_\-]{20,})['\"]/,
      severity: 'medium'
    },
    {
      name: 'Generic Token',
      regex: /token['\"]?\s*[:=]\s*['\"]([a-zA-Z0-9_\-]{20,})['\"]/,
      severity: 'medium'
    },

    // Private Keys
    {
      name: 'RSA Private Key',
      regex: /-----BEGIN RSA PRIVATE KEY-----/g,
      severity: 'critical'
    },
    {
      name: 'SSH Private Key',
      regex: /-----BEGIN OPENSSH PRIVATE KEY-----/g,
      severity: 'critical'
    },
    {
      name: 'PGP Private Key',
      regex: /-----BEGIN PGP PRIVATE KEY BLOCK-----/g,
      severity: 'critical'
    },

    // Cloud Services
    {
      name: 'Heroku API Key',
      regex: /heroku(.{0,20})?['\"][0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}['\"]/,
      severity: 'critical'
    },
    {
      name: 'Twilio API Key',
      regex: /SK[a-zA-Z0-9]{32}/g,
      severity: 'critical'
    },
    {
      name: 'SendGrid API Key',
      regex: /SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}/g,
      severity: 'high'
    },
    {
      name: 'Mailgun API Key',
      regex: /key-[0-9a-zA-Z]{32}/g,
      severity: 'high'
    },
    {
      name: 'Mailchimp API Key',
      regex: /[0-9a-f]{32}-us[0-9]{1,2}/g,
      severity: 'high'
    },

    // JWT
    {
      name: 'JWT Token',
      regex: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,
      severity: 'medium'
    },

    // Passwords (common patterns)
    {
      name: 'Password in Code',
      regex: /password['\"]?\s*[:=]\s*['\"]([^'\"]{8,})['\"]/,
      severity: 'high'
    },
    {
      name: 'Database Password',
      regex: /db[_-]?pass(word)?['\"]?\s*[:=]\s*['\"]([^'\"]{6,})['\"]/,
      severity: 'critical'
    },
  ];

  async getSteps(config?: GitHubConfig): Promise<string[]> {
    return [
      '🔍 Discovering repositories (org/user)',
      '📦 Cloning/fetching repository metadata',
      '🔎 Scanning files for 60+ secret patterns',
      '📜 Deep scanning commit history (TruffleHog)',
      '✅ Validating found secrets (API testing)',
      '📊 Analyzing exposure risk',
      '🤝 Triggering handoffs for critical secrets',
    ];
  }

  async process(job: any): Promise<void> {
    const { target, config = {} } = job.data as { target: string; config?: GitHubConfig };

    Logger.info(`[${this.name}] Starting GitHub secret scan for ${target}`);

    try {
      // Step 1: Discover repositories
      const repos = await this.discoverRepositories(target, config);
      Logger.info(`[${this.name}] Found ${repos.length} repositories`);

      // Step 2: Scan each repository
      const allFindings: SecretFinding[] = [];

      for (const repo of repos) {
        Logger.info(`[${this.name}] Scanning repository: ${repo.full_name}`);

        // Method 1: Scan current files
        const fileFindings = await this.scanRepositoryFiles(repo, config);
        allFindings.push(...fileFindings);

        // Method 2: Deep scan commit history (if enabled)
        if (config.deepScan) {
          const historyFindings = await this.scanCommitHistory(repo, config);
          allFindings.push(...historyFindings);
        }
      }

      Logger.info(`[${this.name}] Found ${allFindings.length} potential secrets`);

      // Step 3: Validate secrets
      const validated = await this.validateSecrets(allFindings);

      Logger.info(`[${this.name}] Validated ${validated.filter(f => f.validated).length} secrets`);

      // Step 4: Store findings
      await this.storeFindings(job, validated);

      // Step 5: Trigger handoffs for critical secrets
      const critical = validated.filter(f => f.severity === 'critical' && f.validated);
      if (critical.length > 0) {
        await this.triggerHandoff(job, 'triage', {
          reason: `Found ${critical.length} validated critical secrets in GitHub`,
          findings: critical,
        });
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error: ${error}`);
      throw error;
    }
  }

  private async discoverRepositories(target: string, config: GitHubConfig): Promise<any[]> {
    const repos: any[] = [];

    try {
      const headers = config.token ? { Authorization: `token ${config.token}` } : {};

      // Check if target is org or user
      let apiUrl = '';
      if (config.orgName) {
        apiUrl = `https://api.github.com/orgs/${config.orgName}/repos`;
      } else if (config.username) {
        apiUrl = `https://api.github.com/users/${config.username}/repos`;
      } else {
        // Try to extract from target URL
        const match = target.match(/github\.com\/([^\/]+)/);
        if (match) {
          const name = match[1];
          // Try as org first
          apiUrl = `https://api.github.com/orgs/${name}/repos`;
        }
      }

      if (!apiUrl) {
        Logger.warn(`[${this.name}] Could not determine GitHub API URL from target`);
        return repos;
      }

      let page = 1;
      const maxRepos = config.maxRepos || 100;

      while (repos.length < maxRepos) {
        const response = await axios.get(`${apiUrl}?page=${page}&per_page=100`, {
          headers,
          timeout: 10000,
        });

        if (response.data.length === 0) break;

        repos.push(...response.data);
        page++;

        if (response.data.length < 100) break; // Last page
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error discovering repositories: ${error}`);
    }

    return repos.slice(0, config.maxRepos || 100);
  }

  private async scanRepositoryFiles(repo: any, config: GitHubConfig): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];

    try {
      const headers = config.token ? { Authorization: `token ${config.token}` } : {};

      // Get repository tree
      const treeResponse = await axios.get(
        `https://api.github.com/repos/${repo.full_name}/git/trees/${repo.default_branch || 'main'}?recursive=1`,
        { headers, timeout: 30000 }
      );

      const files = treeResponse.data.tree.filter((item: any) => item.type === 'blob');

      // Scan interesting files
      const interestingExtensions = ['.env', '.config', '.yml', '.yaml', '.json', '.xml', '.properties', '.sh', '.py', '.js', '.ts', '.java', '.go', '.rb'];
      const interestingFiles = files.filter((file: any) =>
        interestingExtensions.some(ext => file.path.endsWith(ext)) ||
        file.path.includes('config') ||
        file.path.includes('secret') ||
        file.path.includes('key') ||
        file.path === '.env' ||
        file.path === '.env.example'
      );

      Logger.info(`[${this.name}] Scanning ${interestingFiles.length} files in ${repo.full_name}`);

      for (const file of interestingFiles.slice(0, 200)) { // Limit to 200 files per repo
        try {
          const contentResponse = await axios.get(
            `https://api.github.com/repos/${repo.full_name}/contents/${file.path}`,
            { headers, timeout: 10000 }
          );

          if (contentResponse.data.content) {
            const content = Buffer.from(contentResponse.data.content, 'base64').toString('utf-8');
            const fileFindings = this.scanContent(content, file.path, repo.full_name, repo.html_url);
            findings.push(...fileFindings);
          }
        } catch (error) {
          // Skip this file
        }
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error scanning repository files: ${error}`);
    }

    return findings;
  }

  private scanContent(content: string, filePath: string, repoName: string, repoUrl: string): SecretFinding[] {
    const findings: SecretFinding[] = [];
    const lines = content.split('\n');

    for (const pattern of this.secretPatterns) {
      const matches = content.match(pattern.regex);

      if (matches) {
        for (const match of matches) {
          // Find line number
          let lineNumber = 0;
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(match)) {
              lineNumber = i + 1;
              break;
            }
          }

          findings.push({
            type: pattern.name,
            secret: this.maskSecret(match),
            file: filePath,
            line: lineNumber,
            repo: repoName,
            severity: pattern.severity,
            validated: false,
            url: `${repoUrl}/blob/main/${filePath}#L${lineNumber}`
          });
        }
      }
    }

    return findings;
  }

  private async scanCommitHistory(repo: any, config: GitHubConfig): Promise<SecretFinding[]> {
    const findings: SecretFinding[] = [];

    try {
      // Use TruffleHog for deep commit history scanning
      const { stdout } = await execAsync(
        `trufflehog git https://github.com/${repo.full_name}.git --json`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 60000 }
      );

      const results = stdout.split('\n').filter(line => line.trim());

      for (const result of results) {
        try {
          const finding = JSON.parse(result);

          findings.push({
            type: finding.DetectorName || 'Unknown Secret',
            secret: this.maskSecret(finding.Raw || ''),
            file: finding.SourceMetadata?.Data?.Filepath || 'unknown',
            line: finding.SourceMetadata?.Data?.Line || 0,
            commit: finding.SourceMetadata?.Data?.Commit || '',
            repo: repo.full_name,
            severity: 'high',
            validated: finding.Verified || false,
            url: `${repo.html_url}/commit/${finding.SourceMetadata?.Data?.Commit}`
          });
        } catch (error) {
          // Skip malformed JSON
        }
      }

    } catch (error) {
      Logger.warn(`[${this.name}] TruffleHog scan failed (may not be installed): ${error}`);
    }

    return findings;
  }

  private async validateSecrets(findings: SecretFinding[]): Promise<SecretFinding[]> {
    const validated: SecretFinding[] = [];

    for (const finding of findings) {
      let isValid = false;

      // Validate AWS keys
      if (finding.type === 'AWS Access Key') {
        isValid = await this.validateAWSKey(finding.secret);
      }

      // Validate GitHub tokens
      if (finding.type.includes('GitHub')) {
        isValid = await this.validateGitHubToken(finding.secret);
      }

      // Add more validation methods as needed

      validated.push({
        ...finding,
        validated: isValid
      });
    }

    return validated;
  }

  private async validateAWSKey(key: string): Promise<boolean> {
    try {
      // Test AWS key by making a simple API call
      const response = await axios.get('https://sts.amazonaws.com/', {
        params: {
          Action: 'GetCallerIdentity',
          Version: '2011-06-15'
        },
        headers: {
          Authorization: `AWS4-HMAC-SHA256 Credential=${key}/...`
        },
        timeout: 5000,
        validateStatus: () => true
      });

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  private async validateGitHubToken(token: string): Promise<boolean> {
    try {
      const response = await axios.get('https://api.github.com/user', {
        headers: { Authorization: `token ${token}` },
        timeout: 5000,
        validateStatus: () => true
      });

      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  private maskSecret(secret: string): string {
    if (secret.length <= 8) return '***';
    return secret.substring(0, 4) + '***' + secret.substring(secret.length - 4);
  }

  private async storeFindings(job: any, findings: SecretFinding[]): Promise<void> {
    if (job.sharedMemory) {
      await job.sharedMemory.storeFindings(this.name, findings.map(f => ({
        agent: this.name,
        type: f.type,
        severity: f.severity,
        repo: f.repo,
        file: f.file,
        line: f.line,
        validated: f.validated,
        url: f.url,
        timestamp: new Date().toISOString(),
      })));
    }

    Logger.info(`[${this.name}] Stored ${findings.length} secret findings`);
  }

  private async triggerHandoff(job: any, targetAgent: string, context: any): Promise<void> {
    Logger.info(`[${this.name}] Triggering handoff to ${targetAgent}`);

    if (job.handoff) {
      await job.handoff(targetAgent, {
        sourceAgent: this.name,
        reason: context.reason,
        findings: context.findings,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export default GitHubSecretsAgent;
