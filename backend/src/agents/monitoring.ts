/**
 * Continuous Monitoring Agent
 * Purpose: Real-time attack surface monitoring
 * 
 * Features:
 * - Certificate transparency monitoring (new certs)
 * - Subdomain monitoring (new subdomains)
 * - Port scan monitoring (new services)
 * - GitHub monitoring (new repos/commits)
 * - Cloud storage monitoring (new buckets)
 * - Shodan alerts
 * - Slack/Discord notifications
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface MonitoringJob extends BaseJob {
  type: 'monitoring';
  options: {
    programId: string;
    monitorType: 'ct' | 'subdomain' | 'port' | 'github' | 'cloud' | 'shodan' | 'all';
    domains?: string[];
    notifyChannels?: string[];
  };
}

interface MonitoringAlert {
  id: string;
  type: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  data: any;
  timestamp: Date;
}

export class MonitoringAgent extends BaseAgent<MonitoringJob> {
  private readonly CT_LOG_URL = 'https://crt.sh';
  private readonly GITHUB_API = 'https://api.github.com';

  constructor() {
    super('monitoring');
  }

  protected getSteps() {
    return [
      { name: 'Load baseline data' },
      { name: 'Run monitoring checks' },
      { name: 'Compare with baseline' },
      { name: 'Generate alerts' },
      { name: 'Send notifications' },
      { name: 'Update baseline' },
    ];
  }

  async process(job: Job<MonitoringJob>): Promise<any> {
    const { programId, options } = job.data;
    const { monitorType, domains = [], notifyChannels = [] } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const alerts: MonitoringAlert[] = [];

    try {
      // Step 1: Load baseline
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'baseline-loader',
        toolStatus: 'running',
        message: 'Loading baseline data',
      });

      const baseline = await this.loadBaseline(programId);

      // Step 2: Run monitoring checks
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'monitor',
        toolStatus: 'running',
        message: `Running ${monitorType} monitoring`,
      });

      const currentState = await this.runMonitoringChecks(monitorType, domains, programId);

      // Step 3: Compare with baseline
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 50,
        currentTool: 'compare',
        toolStatus: 'running',
        message: 'Comparing with baseline',
      });

      const changes = this.compareWithBaseline(baseline, currentState, monitorType);

      // Step 4: Generate alerts
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 65,
        currentTool: 'alert-generator',
        toolStatus: 'running',
        message: 'Generating alerts',
      });

      for (const change of changes) {
        const alert = this.createAlert(change, monitorType);
        alerts.push(alert);
        await this.storeAlert(programId, alert);
      }

      // Step 5: Send notifications
      if (alerts.length > 0 && notifyChannels.length > 0) {
        await this.updateJobProgress(job.id!, {
          current: 5,
          total: 6,
          percentage: 80,
          currentTool: 'notifier',
          toolStatus: 'running',
          message: 'Sending notifications',
        });

        await this.sendNotifications(alerts, notifyChannels);
      }

      // Step 6: Update baseline
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 95,
        currentTool: 'baseline-update',
        toolStatus: 'running',
        message: 'Updating baseline',
      });

      await this.updateBaseline(programId, currentState, monitorType);

      // Trigger handoffs for critical alerts
      const criticalAlerts = alerts.filter(a => a.severity === 'critical' || a.severity === 'high');
      if (criticalAlerts.length > 0) {
        await this.triggerHandoffs(programId, criticalAlerts, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Generated ${alerts.length} alerts`,
      });

      const result = {
        programId,
        monitorType,
        alertsGenerated: alerts.length,
        criticalAlerts: criticalAlerts.length,
        alerts,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, monitorType }, 'Monitoring failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Load baseline data for comparison
   */
  private async loadBaseline(programId: string): Promise<any> {
    try {
      const result = await database.query(
        'SELECT * FROM monitoring_baselines WHERE program_id = $1',
        [programId]
      );
      
      if (result.rows.length === 0) {
        return {
          subdomains: [],
          certificates: [],
          ports: [],
          repos: [],
          buckets: [],
        };
      }

      return result.rows[0].data || {};
    } catch {
      return {};
    }
  }

  /**
   * Run monitoring checks based on type
   */
  private async runMonitoringChecks(
    monitorType: string,
    domains: string[],
    programId: string
  ): Promise<any> {
    const results: any = {};

    if (monitorType === 'all' || monitorType === 'ct') {
      results.certificates = await this.checkCertificateTransparency(domains);
    }

    if (monitorType === 'all' || monitorType === 'subdomain') {
      results.subdomains = await this.checkSubdomains(domains);
    }

    if (monitorType === 'all' || monitorType === 'port') {
      results.ports = await this.checkPorts(domains);
    }

    if (monitorType === 'all' || monitorType === 'github') {
      results.repos = await this.checkGitHub(domains);
    }

    if (monitorType === 'all' || monitorType === 'cloud') {
      results.buckets = await this.checkCloudStorage(domains);
    }

    if (monitorType === 'all' || monitorType === 'shodan') {
      results.shodan = await this.checkShodan(domains);
    }

    return results;
  }

  /**
   * Check Certificate Transparency logs
   */
  private async checkCertificateTransparency(domains: string[]): Promise<any[]> {
    const certificates: any[] = [];

    for (const domain of domains) {
      try {
        const response = await this.fetchJson(`${this.CT_LOG_URL}/?q=%.${domain}&output=json`);
        
        if (Array.isArray(response)) {
          for (const cert of response.slice(0, 100)) { // Limit to recent 100
            certificates.push({
              domain,
              commonName: cert.common_name,
              issuer: cert.issuer_name,
              notBefore: cert.not_before,
              notAfter: cert.not_after,
              serialNumber: cert.serial_number,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, domain }, 'CT check failed');
      }
    }

    return certificates;
  }

  /**
   * Check for new subdomains
   */
  private async checkSubdomains(domains: string[]): Promise<string[]> {
    const subdomains: string[] = [];

    for (const domain of domains) {
      try {
        // Use crt.sh for subdomain discovery
        const response = await this.fetchJson(`${this.CT_LOG_URL}/?q=%.${domain}&output=json`);
        
        if (Array.isArray(response)) {
          for (const cert of response) {
            if (cert.name_value) {
              const names = cert.name_value.split('\n');
              for (const name of names) {
                const cleanName = name.trim().replace(/^\*\./, '');
                if (cleanName.endsWith(domain) && !subdomains.includes(cleanName)) {
                  subdomains.push(cleanName);
                }
              }
            }
          }
        }
      } catch (error) {
        logger.debug({ error, domain }, 'Subdomain check failed');
      }
    }

    return [...new Set(subdomains)];
  }

  /**
   * Check for new open ports
   */
  private async checkPorts(domains: string[]): Promise<any[]> {
    const ports: any[] = [];
    const shodanKey = process.env.SHODAN_API_KEY;

    if (!shodanKey) {
      logger.warn('Shodan API key not configured for port monitoring');
      return ports;
    }

    for (const domain of domains) {
      try {
        const response = await this.fetchJson(
          `https://api.shodan.io/dns/resolve?hostnames=${domain}&key=${shodanKey}`
        );

        if (response && response[domain]) {
          const ip = response[domain];
          const hostInfo = await this.fetchJson(
            `https://api.shodan.io/shodan/host/${ip}?key=${shodanKey}`
          );

          if (hostInfo && hostInfo.ports) {
            for (const port of hostInfo.ports) {
              ports.push({
                domain,
                ip,
                port,
                service: hostInfo.data?.find((d: any) => d.port === port)?.product,
              });
            }
          }
        }
      } catch (error) {
        logger.debug({ error, domain }, 'Port check failed');
      }
    }

    return ports;
  }

  /**
   * Check GitHub for new repos/commits
   */
  private async checkGitHub(domains: string[]): Promise<any[]> {
    const repos: any[] = [];
    const githubToken = process.env.GITHUB_TOKEN;

    for (const domain of domains) {
      try {
        const orgName = domain.split('.')[0];
        const headers: Record<string, string> = {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'AgentHunt-Monitor',
        };
        
        if (githubToken) {
          headers['Authorization'] = `token ${githubToken}`;
        }

        // Search for repos mentioning the domain
        const searchResponse = await this.fetchJson(
          `${this.GITHUB_API}/search/repositories?q=${domain}`,
          headers
        );

        if (searchResponse && searchResponse.items) {
          for (const repo of searchResponse.items.slice(0, 20)) {
            repos.push({
              domain,
              name: repo.full_name,
              url: repo.html_url,
              description: repo.description,
              updatedAt: repo.updated_at,
              stars: repo.stargazers_count,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, domain }, 'GitHub check failed');
      }
    }

    return repos;
  }

  /**
   * Check for cloud storage buckets
   */
  private async checkCloudStorage(domains: string[]): Promise<any[]> {
    const buckets: any[] = [];

    const bucketPatterns = [
      (d: string) => `${d.replace(/\./g, '-')}`,
      (d: string) => `${d.split('.')[0]}`,
      (d: string) => `${d.split('.')[0]}-backup`,
      (d: string) => `${d.split('.')[0]}-assets`,
      (d: string) => `${d.split('.')[0]}-uploads`,
    ];

    for (const domain of domains) {
      for (const pattern of bucketPatterns) {
        const bucketName = pattern(domain);

        // Check S3
        try {
          const s3Response = await this.checkBucketExists(`https://${bucketName}.s3.amazonaws.com`);
          if (s3Response.exists) {
            buckets.push({
              domain,
              name: bucketName,
              provider: 'aws',
              url: `https://${bucketName}.s3.amazonaws.com`,
              public: s3Response.public,
            });
          }
        } catch {}

        // Check GCS
        try {
          const gcsResponse = await this.checkBucketExists(`https://storage.googleapis.com/${bucketName}`);
          if (gcsResponse.exists) {
            buckets.push({
              domain,
              name: bucketName,
              provider: 'gcp',
              url: `https://storage.googleapis.com/${bucketName}`,
              public: gcsResponse.public,
            });
          }
        } catch {}

        // Check Azure
        try {
          const azureResponse = await this.checkBucketExists(`https://${bucketName}.blob.core.windows.net`);
          if (azureResponse.exists) {
            buckets.push({
              domain,
              name: bucketName,
              provider: 'azure',
              url: `https://${bucketName}.blob.core.windows.net`,
              public: azureResponse.public,
            });
          }
        } catch {}
      }
    }

    return buckets;
  }

  /**
   * Check Shodan for new findings
   */
  private async checkShodan(domains: string[]): Promise<any[]> {
    const findings: any[] = [];
    const shodanKey = process.env.SHODAN_API_KEY;

    if (!shodanKey) return findings;

    for (const domain of domains) {
      try {
        const response = await this.fetchJson(
          `https://api.shodan.io/shodan/host/search?key=${shodanKey}&query=hostname:${domain}`
        );

        if (response && response.matches) {
          for (const match of response.matches) {
            findings.push({
              domain,
              ip: match.ip_str,
              port: match.port,
              product: match.product,
              version: match.version,
              vulns: match.vulns,
            });
          }
        }
      } catch (error) {
        logger.debug({ error, domain }, 'Shodan check failed');
      }
    }

    return findings;
  }

  /**
   * Check if a bucket exists
   */
  private async checkBucketExists(url: string): Promise<{ exists: boolean; public: boolean }> {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      return {
        exists: response.status !== 404,
        public: response.status === 200,
      };
    } catch {
      return { exists: false, public: false };
    }
  }

  /**
   * Compare current state with baseline
   */
  private compareWithBaseline(baseline: any, current: any, monitorType: string): any[] {
    const changes: any[] = [];

    // Compare subdomains
    if (current.subdomains) {
      const baselineSubdomains = new Set(baseline.subdomains || []);
      for (const subdomain of current.subdomains) {
        if (!baselineSubdomains.has(subdomain)) {
          changes.push({ type: 'new-subdomain', data: subdomain });
        }
      }
    }

    // Compare certificates
    if (current.certificates) {
      const baselineCerts = new Set((baseline.certificates || []).map((c: any) => c.serialNumber));
      for (const cert of current.certificates) {
        if (!baselineCerts.has(cert.serialNumber)) {
          changes.push({ type: 'new-certificate', data: cert });
        }
      }
    }

    // Compare ports
    if (current.ports) {
      const baselinePorts = new Set((baseline.ports || []).map((p: any) => `${p.ip}:${p.port}`));
      for (const port of current.ports) {
        if (!baselinePorts.has(`${port.ip}:${port.port}`)) {
          changes.push({ type: 'new-port', data: port });
        }
      }
    }

    // Compare repos
    if (current.repos) {
      const baselineRepos = new Set((baseline.repos || []).map((r: any) => r.name));
      for (const repo of current.repos) {
        if (!baselineRepos.has(repo.name)) {
          changes.push({ type: 'new-repo', data: repo });
        }
      }
    }

    // Compare buckets
    if (current.buckets) {
      const baselineBuckets = new Set((baseline.buckets || []).map((b: any) => b.url));
      for (const bucket of current.buckets) {
        if (!baselineBuckets.has(bucket.url)) {
          changes.push({ type: 'new-bucket', data: bucket });
        }
      }
    }

    return changes;
  }

  /**
   * Create alert from change
   */
  private createAlert(change: any, monitorType: string): MonitoringAlert {
    const severityMap: Record<string, 'critical' | 'high' | 'medium' | 'low' | 'info'> = {
      'new-subdomain': 'info',
      'new-certificate': 'info',
      'new-port': 'medium',
      'new-repo': 'low',
      'new-bucket': 'high',
    };

    const titleMap: Record<string, string> = {
      'new-subdomain': `New subdomain discovered: ${change.data}`,
      'new-certificate': `New certificate issued for: ${change.data.commonName}`,
      'new-port': `New port open: ${change.data.ip}:${change.data.port}`,
      'new-repo': `New GitHub repo: ${change.data.name}`,
      'new-bucket': `New cloud bucket: ${change.data.name} (${change.data.provider})`,
    };

    return {
      id: uuidv4(),
      type: change.type,
      severity: severityMap[change.type] || 'info',
      title: titleMap[change.type] || `Change detected: ${change.type}`,
      description: JSON.stringify(change.data),
      data: change.data,
      timestamp: new Date(),
    };
  }

  /**
   * Store alert in database
   */
  private async storeAlert(programId: string, alert: MonitoringAlert): Promise<void> {
    try {
      await database.query(
        `INSERT INTO monitoring_alerts (id, program_id, type, severity, title, description, data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [alert.id, programId, alert.type, alert.severity, alert.title, alert.description, JSON.stringify(alert.data)]
      );
    } catch (error) {
      logger.error({ error, alert }, 'Failed to store alert');
    }
  }

  /**
   * Send notifications
   */
  private async sendNotifications(alerts: MonitoringAlert[], channels: string[]): Promise<void> {
    for (const channel of channels) {
      if (channel.startsWith('slack:')) {
        await this.sendSlackNotification(channel.replace('slack:', ''), alerts);
      } else if (channel.startsWith('discord:')) {
        await this.sendDiscordNotification(channel.replace('discord:', ''), alerts);
      }
    }
  }

  private async sendSlackNotification(webhookUrl: string, alerts: MonitoringAlert[]): Promise<void> {
    try {
      const message = {
        text: `🚨 AgentHunt Monitoring: ${alerts.length} new alerts`,
        blocks: alerts.slice(0, 10).map(alert => ({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${alert.severity.toUpperCase()}*: ${alert.title}`,
          },
        })),
      };

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to send Slack notification');
    }
  }

  private async sendDiscordNotification(webhookUrl: string, alerts: MonitoringAlert[]): Promise<void> {
    try {
      const message = {
        content: `🚨 AgentHunt Monitoring: ${alerts.length} new alerts`,
        embeds: alerts.slice(0, 10).map(alert => ({
          title: alert.title,
          description: alert.description.substring(0, 200),
          color: alert.severity === 'critical' ? 0xff0000 : alert.severity === 'high' ? 0xff8800 : 0x00ff00,
        })),
      };

      await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      });
    } catch (error) {
      logger.error({ error }, 'Failed to send Discord notification');
    }
  }

  /**
   * Update baseline
   */
  private async updateBaseline(programId: string, currentState: any, monitorType: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO monitoring_baselines (id, program_id, data, updated_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (program_id) DO UPDATE SET data = $3, updated_at = CURRENT_TIMESTAMP`,
        [uuidv4(), programId, JSON.stringify(currentState)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to update baseline');
    }
  }

  /**
   * Trigger handoffs for critical alerts
   */
  private async triggerHandoffs(programId: string, alerts: MonitoringAlert[], jobId: string): Promise<void> {
    await this.handoff('scanner', {
      toAgent: 'scanner',
      reason: `${alerts.length} critical monitoring alerts require scanning`,
      data: { alerts },
      priority: 8,
      metadata: { programId, parentJobId: jobId, source: 'monitoring' },
    });
  }

  /**
   * Fetch JSON helper
   */
  private async fetchJson(url: string, headers?: Record<string, string>): Promise<any> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AgentHunt-Monitor',
          ...headers,
        },
      });
      if (response.ok) {
        return await response.json();
      }
      return null;
    } catch {
      return null;
    }
  }
}

export default new MonitoringAgent();
