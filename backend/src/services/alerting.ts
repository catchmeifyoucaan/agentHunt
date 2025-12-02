/**
 * Alerting & Notification Service
 * 
 * Provides multi-channel alerting for:
 * - Critical vulnerability findings
 * - Scan completion notifications
 * - System health alerts
 * - SLA violations
 * 
 * Channels:
 * - Slack
 * - Discord
 * - Email
 * - PagerDuty
 * - Webhooks
 */

import logger from '../utils/logger';
import database from './database';
import { v4 as uuidv4 } from 'uuid';

interface AlertConfig {
  slack?: {
    webhookUrl: string;
    channel?: string;
    username?: string;
  };
  discord?: {
    webhookUrl: string;
  };
  email?: {
    smtpHost: string;
    smtpPort: number;
    smtpUser: string;
    smtpPass: string;
    from: string;
    to: string[];
  };
  pagerduty?: {
    routingKey: string;
    serviceId?: string;
  };
  webhooks?: Array<{
    url: string;
    headers?: Record<string, string>;
  }>;
}

interface Alert {
  id: string;
  type: 'critical_finding' | 'scan_complete' | 'system_health' | 'sla_violation' | 'agent_failure' | 'queue_backlog';
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  message: string;
  metadata?: Record<string, any>;
  programId?: string;
  timestamp: Date;
}

// Severity colors for different platforms
const SEVERITY_COLORS = {
  critical: { slack: '#dc3545', discord: 0xdc3545 },
  high: { slack: '#fd7e14', discord: 0xfd7e14 },
  medium: { slack: '#ffc107', discord: 0xffc107 },
  low: { slack: '#28a745', discord: 0x28a745 },
  info: { slack: '#17a2b8', discord: 0x17a2b8 },
};

class AlertingService {
  private config: AlertConfig = {};
  private alertHistory: Map<string, Date> = new Map();
  private rateLimitWindow = 60000; // 1 minute
  private maxAlertsPerWindow = 10;

  /**
   * Configure alerting channels
   */
  configure(config: AlertConfig): void {
    this.config = config;
    logger.info({ channels: Object.keys(config).filter(k => config[k as keyof AlertConfig]) }, 'Alerting configured');
  }

  /**
   * Send alert to all configured channels
   */
  async sendAlert(alert: Omit<Alert, 'id' | 'timestamp'>): Promise<string> {
    const fullAlert: Alert = {
      ...alert,
      id: uuidv4(),
      timestamp: new Date(),
    };

    // Rate limiting
    if (!this.checkRateLimit(alert.type)) {
      logger.warn({ type: alert.type }, 'Alert rate limited');
      return '';
    }

    // Store alert
    await this.storeAlert(fullAlert);

    // Send to all channels in parallel
    const promises: Promise<void>[] = [];

    if (this.config.slack) {
      promises.push(this.sendSlack(fullAlert));
    }
    if (this.config.discord) {
      promises.push(this.sendDiscord(fullAlert));
    }
    if (this.config.email && ['critical', 'high'].includes(alert.severity)) {
      promises.push(this.sendEmail(fullAlert));
    }
    if (this.config.pagerduty && alert.severity === 'critical') {
      promises.push(this.sendPagerDuty(fullAlert));
    }
    if (this.config.webhooks) {
      promises.push(...this.config.webhooks.map(wh => this.sendWebhook(fullAlert, wh)));
    }

    await Promise.allSettled(promises);

    logger.info({ alertId: fullAlert.id, type: alert.type, severity: alert.severity }, 'Alert sent');
    return fullAlert.id;
  }

  /**
   * Send critical finding alert
   */
  async alertCriticalFinding(finding: {
    programId: string;
    title: string;
    severity: string;
    url: string;
    type: string;
    cvss?: number;
  }): Promise<string> {
    return this.sendAlert({
      type: 'critical_finding',
      severity: finding.severity as any || 'high',
      title: `🚨 ${finding.severity.toUpperCase()} Vulnerability Found`,
      message: `**${finding.title}**\n\nURL: ${finding.url}\nType: ${finding.type}${finding.cvss ? `\nCVSS: ${finding.cvss}` : ''}`,
      metadata: finding,
      programId: finding.programId,
    });
  }

  /**
   * Send scan completion alert
   */
  async alertScanComplete(scan: {
    programId: string;
    jobId: string;
    duration: number;
    findingsCount: number;
    criticalCount: number;
    highCount: number;
  }): Promise<string> {
    const severity = scan.criticalCount > 0 ? 'critical' : scan.highCount > 0 ? 'high' : 'info';
    
    return this.sendAlert({
      type: 'scan_complete',
      severity,
      title: '✅ Scan Completed',
      message: `Scan finished in ${Math.round(scan.duration / 1000)}s\n\n**Findings:**\n- Critical: ${scan.criticalCount}\n- High: ${scan.highCount}\n- Total: ${scan.findingsCount}`,
      metadata: scan,
      programId: scan.programId,
    });
  }

  /**
   * Send agent failure alert
   */
  async alertAgentFailure(failure: {
    agentType: string;
    jobId: string;
    error: string;
    programId?: string;
  }): Promise<string> {
    return this.sendAlert({
      type: 'agent_failure',
      severity: 'high',
      title: `⚠️ Agent Failure: ${failure.agentType}`,
      message: `Job ${failure.jobId} failed\n\nError: ${failure.error}`,
      metadata: failure,
      programId: failure.programId,
    });
  }

  /**
   * Send queue backlog alert
   */
  async alertQueueBacklog(backlog: {
    queueName: string;
    depth: number;
    threshold: number;
    oldestJobAge: number;
  }): Promise<string> {
    return this.sendAlert({
      type: 'queue_backlog',
      severity: backlog.depth > backlog.threshold * 2 ? 'critical' : 'high',
      title: `📊 Queue Backlog: ${backlog.queueName}`,
      message: `Queue depth: ${backlog.depth} (threshold: ${backlog.threshold})\nOldest job: ${Math.round(backlog.oldestJobAge / 1000)}s old`,
      metadata: backlog,
    });
  }

  /**
   * Send SLA violation alert
   */
  async alertSLAViolation(violation: {
    programId: string;
    slaType: string;
    expected: number;
    actual: number;
    unit: string;
  }): Promise<string> {
    return this.sendAlert({
      type: 'sla_violation',
      severity: 'critical',
      title: `🚫 SLA Violation: ${violation.slaType}`,
      message: `Expected: ${violation.expected}${violation.unit}\nActual: ${violation.actual}${violation.unit}`,
      metadata: violation,
      programId: violation.programId,
    });
  }

  /**
   * Send to Slack
   */
  private async sendSlack(alert: Alert): Promise<void> {
    if (!this.config.slack) return;

    const color = SEVERITY_COLORS[alert.severity]?.slack || '#6c757d';

    const payload = {
      channel: this.config.slack.channel,
      username: this.config.slack.username || 'AgentHunt',
      attachments: [{
        color,
        title: alert.title,
        text: alert.message,
        fields: [
          { title: 'Type', value: alert.type, short: true },
          { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
          ...(alert.programId ? [{ title: 'Program', value: alert.programId, short: true }] : []),
        ],
        footer: 'AgentHunt Security Scanner',
        ts: Math.floor(alert.timestamp.getTime() / 1000),
      }],
    };

    try {
      const response = await fetch(this.config.slack.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack API error: ${response.status}`);
      }
    } catch (error) {
      logger.error({ error, alertId: alert.id }, 'Failed to send Slack alert');
    }
  }

  /**
   * Send to Discord
   */
  private async sendDiscord(alert: Alert): Promise<void> {
    if (!this.config.discord) return;

    const color = SEVERITY_COLORS[alert.severity]?.discord || 0x6c757d;

    const payload = {
      embeds: [{
        title: alert.title,
        description: alert.message,
        color,
        fields: [
          { name: 'Type', value: alert.type, inline: true },
          { name: 'Severity', value: alert.severity.toUpperCase(), inline: true },
          ...(alert.programId ? [{ name: 'Program', value: alert.programId, inline: true }] : []),
        ],
        footer: { text: 'AgentHunt Security Scanner' },
        timestamp: alert.timestamp.toISOString(),
      }],
    };

    try {
      const response = await fetch(this.config.discord.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }
    } catch (error) {
      logger.error({ error, alertId: alert.id }, 'Failed to send Discord alert');
    }
  }

  /**
   * Send email (using external SMTP)
   */
  private async sendEmail(alert: Alert): Promise<void> {
    if (!this.config.email) return;

    // Would use nodemailer or similar
    // For now, log the intent
    logger.info({
      alertId: alert.id,
      to: this.config.email.to,
      subject: alert.title,
    }, 'Email alert would be sent');
  }

  /**
   * Send to PagerDuty
   */
  private async sendPagerDuty(alert: Alert): Promise<void> {
    if (!this.config.pagerduty) return;

    const payload = {
      routing_key: this.config.pagerduty.routingKey,
      event_action: 'trigger',
      dedup_key: `agenthunt-${alert.type}-${alert.programId || 'system'}`,
      payload: {
        summary: alert.title,
        severity: alert.severity === 'critical' ? 'critical' : 'error',
        source: 'AgentHunt',
        custom_details: {
          message: alert.message,
          ...alert.metadata,
        },
      },
    };

    try {
      const response = await fetch('https://events.pagerduty.com/v2/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`PagerDuty API error: ${response.status}`);
      }
    } catch (error) {
      logger.error({ error, alertId: alert.id }, 'Failed to send PagerDuty alert');
    }
  }

  /**
   * Send to custom webhook
   */
  private async sendWebhook(alert: Alert, webhook: { url: string; headers?: Record<string, string> }): Promise<void> {
    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...webhook.headers,
        },
        body: JSON.stringify(alert),
      });

      if (!response.ok) {
        throw new Error(`Webhook error: ${response.status}`);
      }
    } catch (error) {
      logger.error({ error, alertId: alert.id, webhookUrl: webhook.url }, 'Failed to send webhook alert');
    }
  }

  /**
   * Check rate limit
   */
  private checkRateLimit(type: string): boolean {
    const now = Date.now();
    const key = type;
    
    // Clean old entries
    for (const [k, v] of this.alertHistory) {
      if (now - v.getTime() > this.rateLimitWindow) {
        this.alertHistory.delete(k);
      }
    }

    // Count recent alerts of this type
    let count = 0;
    for (const [k, v] of this.alertHistory) {
      if (k.startsWith(type) && now - v.getTime() < this.rateLimitWindow) {
        count++;
      }
    }

    if (count >= this.maxAlertsPerWindow) {
      return false;
    }

    this.alertHistory.set(`${type}-${now}`, new Date());
    return true;
  }

  /**
   * Store alert in database
   */
  private async storeAlert(alert: Alert): Promise<void> {
    try {
      await database.query(
        `INSERT INTO alerts (id, type, severity, title, message, metadata, program_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          alert.id,
          alert.type,
          alert.severity,
          alert.title,
          alert.message,
          JSON.stringify(alert.metadata || {}),
          alert.programId,
          alert.timestamp,
        ]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to store alert');
    }
  }

  /**
   * Get recent alerts
   */
  async getRecentAlerts(programId?: string, limit: number = 50): Promise<Alert[]> {
    try {
      const query = programId
        ? `SELECT * FROM alerts WHERE program_id = $1 ORDER BY created_at DESC LIMIT $2`
        : `SELECT * FROM alerts ORDER BY created_at DESC LIMIT $1`;
      
      const params = programId ? [programId, limit] : [limit];
      const result = await database.query(query, params);

      return result.rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        severity: row.severity,
        title: row.title,
        message: row.message,
        metadata: row.metadata,
        programId: row.program_id,
        timestamp: row.created_at,
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get recent alerts');
      return [];
    }
  }
}

export const alerting = new AlertingService();
export default alerting;
