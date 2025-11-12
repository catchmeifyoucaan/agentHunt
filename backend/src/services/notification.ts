import TelegramBot from 'node-telegram-bot-api';
import config from '../config';
import logger from '../utils/logger';
import database from './database';
import { Finding, Notification } from '../../../shared/types';
import { v4 as uuidv4 } from 'uuid';

class NotificationService {
  private static instance: NotificationService;
  private bot?: TelegramBot;
  private messageQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  private lastMessageTime = 0;
  private readonly MESSAGE_DELAY_MS = 100; // 10 messages per second (well below 30/sec limit)

  private constructor() {
    if (config.telegram.botToken) {
      this.bot = new TelegramBot(config.telegram.botToken);
      logger.info('Telegram bot initialized');
    } else {
      logger.warn('Telegram bot token not configured');
    }
  }

  /**
   * Rate-limited message sender
   * Telegram allows 30 messages/second, we use 10/second to be safe
   */
  private async sendWithRateLimit(sendFn: () => Promise<void>): Promise<void> {
    this.messageQueue.push(sendFn);

    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    this.isProcessingQueue = true;

    while (this.messageQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastMessage = now - this.lastMessageTime;

      // Wait if we're sending too fast
      if (timeSinceLastMessage < this.MESSAGE_DELAY_MS) {
        await new Promise(resolve => setTimeout(resolve, this.MESSAGE_DELAY_MS - timeSinceLastMessage));
      }

      const sendFn = this.messageQueue.shift();
      if (sendFn) {
        try {
          await sendFn();
          this.lastMessageTime = Date.now();
        } catch (error: any) {
          // If we hit rate limit, wait longer
          if (error.code === 'ETELEGRAM' && error.message.includes('429')) {
            const retryAfter = this.extractRetryAfter(error.message) || 3;
            logger.warn({ retryAfter }, 'Telegram rate limit hit, waiting');
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
          } else {
            // For other errors, just log and continue
            logger.error({ error }, 'Error sending Telegram message');
          }
        }
      }
    }

    this.isProcessingQueue = false;
  }

  private extractRetryAfter(message: string): number | null {
    const match = message.match(/retry after (\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  /**
   * Send notification for a finding
   */
  public async notifyFinding(finding: Finding, programName: string, assetValue: string): Promise<void> {
    const notificationId = uuidv4();

    try {
      // Determine channel based on severity
      const channelId = this.getChannelForSeverity(finding.severity);

      if (!channelId) {
        logger.warn({ severity: finding.severity }, 'No Telegram channel configured for severity');
        return;
      }

      // Format message
      const message = this.formatFindingMessage(finding, programName, assetValue);

      // Send via Telegram with rate limiting
      if (this.bot) {
        await this.sendWithRateLimit(async () => {
          await this.bot!.sendMessage(channelId, message, {
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          });
        });

        // Save notification record
        await database.query(
          `INSERT INTO notifications (id, type, severity, title, message, finding_id, program_id, sent, sent_at)
           VALUES ($1, 'telegram', $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP)`,
          [notificationId, finding.severity, finding.title, message, finding.id, finding.programId]
        );

        logger.info(
          {
            notificationId,
            findingId: finding.id,
            severity: finding.severity,
            channel: channelId,
          },
          'Telegram notification sent'
        );
      }
    } catch (error: any) {
      logger.error({ error, findingId: finding.id }, 'Failed to send Telegram notification');

      // Save error record
      await database.query(
        `INSERT INTO notifications (id, type, severity, title, message, finding_id, program_id, sent, error)
         VALUES ($1, 'telegram', $2, $3, '', $4, $5, false, $6)`,
        [notificationId, finding.severity, finding.title, finding.id, finding.programId, error.message]
      );
    }
  }

  /**
   * Send ops notification (non-finding alerts)
   */
  public async notifyOps(title: string, message: string, level: 'info' | 'warn' | 'error' = 'info'): Promise<void> {
    if (!this.bot || !config.telegram.opsChannel) {
      return;
    }

    try {
      const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';
      const formattedMessage = `${icon} *${title}*\n\n${message}`;

      await this.sendWithRateLimit(async () => {
        await this.bot!.sendMessage(config.telegram.opsChannel, formattedMessage, {
          parse_mode: 'Markdown',
        });
      });

      logger.debug({ title, level }, 'Ops notification sent');
    } catch (error) {
      logger.error({ error, title }, 'Failed to send ops notification');
    }
  }

  /**
   * Send job creation notification
   */
  public async notifyJobCreated(jobType: string, jobId: string, programId: string, priority: number): Promise<void> {
    try {
      const programResult = await database.query('SELECT name FROM programs WHERE id = $1', [programId]);
      const programName = programResult.rows.length > 0 ? programResult.rows[0].name : programId;

      await this.notifyOps(
        '🆕 New Job Created',
        `*Type:* ${jobType}\n` +
        `*Job ID:* \`${jobId}\`\n` +
        `*Program:* ${programName}\n` +
        `*Priority:* ${priority}\n` +
        `*Status:* Queued`,
        'info'
      );
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to send job creation notification');
    }
  }

  /**
   * Send job status change notification
   */
  public async notifyJobStatusChange(
    jobType: string,
    jobId: string,
    programId: string,
    oldStatus: string,
    newStatus: string,
    result?: any,
    error?: string
  ): Promise<void> {
    try {
      const programResult = await database.query('SELECT name FROM programs WHERE id = $1', [programId]);
      const programName = programResult.rows.length > 0 ? programResult.rows[0].name : programId;

      let icon = '📋';
      let level: 'info' | 'warn' | 'error' = 'info';

      switch (newStatus) {
        case 'active':
          icon = '⚙️';
          break;
        case 'completed':
          icon = '✅';
          break;
        case 'failed':
          icon = '❌';
          level = 'error';
          break;
        case 'paused':
          icon = '⏸️';
          level = 'warn';
          break;
        case 'cancelled':
          icon = '🚫';
          level = 'warn';
          break;
      }

      let message = `*Type:* ${jobType}\n` +
        `*Job ID:* \`${jobId}\`\n` +
        `*Program:* ${programName}\n` +
        `*Old Status:* ${oldStatus}\n` +
        `*New Status:* ${newStatus}`;

      if (result) {
        message += `\n\n*Result:*\n\`\`\`json\n${JSON.stringify(result, null, 2).substring(0, 500)}\n\`\`\``;
      }

      if (error) {
        message += `\n\n*Error:* ${error.substring(0, 300)}`;
      }

      await this.notifyOps(`${icon} Job Status Changed`, message, level);
    } catch (error) {
      logger.error({ error, jobId }, 'Failed to send job status change notification');
    }
  }

  /**
   * Send backend service notification
   */
  public async notifyBackendStarted(port: number): Promise<void> {
    await this.notifyOps(
      '🚀 Backend Started',
      `AgentHunt backend API server is now running on port ${port}`,
      'info'
    );
  }

  /**
   * Send backend restart notification
   */
  public async notifyBackendRestarted(port: number, reason: string): Promise<void> {
    await this.notifyOps(
      '🔄 Backend Restarted',
      `AgentHunt backend API server has been restarted on port ${port}\n\n*Reason:* ${reason}`,
      'warn'
    );
  }

  /**
   * Send daily digest
   */
  public async sendDailyDigest(programId: string): Promise<void> {
    try {
      // Get program info
      const programResult = await database.query('SELECT name FROM programs WHERE id = $1', [
        programId,
      ]);

      if (programResult.rows.length === 0) {
        return;
      }

      const programName = programResult.rows[0].name;

      // Get 24h stats
      const findingsResult = await database.query(
        `SELECT severity, COUNT(*) as count
         FROM findings
         WHERE program_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY severity`,
        [programId]
      );

      const jobsResult = await database.query(
        `SELECT status, COUNT(*) as count
         FROM jobs
         WHERE program_id = $1 AND created_at > NOW() - INTERVAL '24 hours'
         GROUP BY status`,
        [programId]
      );

      const findingsBySevertiy: Record<string, number> = {};
      findingsResult.rows.forEach((row) => {
        findingsBySevertiy[row.severity] = parseInt(row.count, 10);
      });

      const jobsByStatus: Record<string, number> = {};
      jobsResult.rows.forEach((row) => {
        jobsByStatus[row.status] = parseInt(row.count, 10);
      });

      // Format digest
      const message = `
📊 *Daily Digest: ${programName}*

*Findings (24h):*
${findingsBySevertiy.critical ? `🔴 Critical: ${findingsBySevertiy.critical}` : ''}
${findingsBySevertiy.high ? `🟠 High: ${findingsBySevertiy.high}` : ''}
${findingsBySevertiy.medium ? `🟡 Medium: ${findingsBySevertiy.medium}` : ''}
${findingsBySevertiy.low ? `🔵 Low: ${findingsBySevertiy.low}` : ''}

*Jobs (24h):*
✅ Completed: ${jobsByStatus.completed || 0}
⏳ Pending: ${jobsByStatus.pending || 0}
❌ Failed: ${jobsByStatus.failed || 0}
      `.trim();

      if (this.bot && config.telegram.opsChannel) {
        await this.sendWithRateLimit(async () => {
          await this.bot!.sendMessage(config.telegram.opsChannel, message, {
            parse_mode: 'Markdown',
          });
        });

        logger.info({ programId }, 'Daily digest sent');
      }
    } catch (error) {
      logger.error({ error, programId }, 'Failed to send daily digest');
    }
  }

  private getChannelForSeverity(severity: string): string | undefined {
    switch (severity) {
      case 'critical':
        return config.telegram.criticalChannel;
      case 'high':
        return config.telegram.highChannel;
      case 'medium':
      case 'low':
        return config.telegram.opsChannel;
      default:
        return undefined;
    }
  }

  private formatFindingMessage(finding: Finding, programName: string, assetValue: string): string {
    const severityIcon = this.getSeverityIcon(finding.severity);
    const confidencePercentage = Math.round(finding.confidence * 100);

    let message = `
${severityIcon} *New ${finding.severity.toUpperCase()} Finding*

*Program:* ${programName}
*Asset:* \`${assetValue}\`
*Title:* ${finding.title}

*Confidence:* ${confidencePercentage}%
*CVSS:* ${finding.cvss || 'N/A'}
${finding.cwe.length > 0 ? `*CWE:* ${finding.cwe.join(', ')}` : ''}

*Description:*
${finding.description.substring(0, 300)}${finding.description.length > 300 ? '...' : ''}

*Impact:*
${finding.impact.substring(0, 200)}${finding.impact.length > 200 ? '...' : ''}

*Status:* ${finding.status}
*Finding ID:* \`${finding.id}\`
    `.trim();

    // Add confirmation status
    if (finding.confirmations.length > 0) {
      const passed = finding.confirmations.filter((c) => c.result === 'pass').length;
      message += `\n\n*Confirmations:* ${passed}/${finding.confirmations.length} passed`;
    }

    return message;
  }

  private getSeverityIcon(severity: string): string {
    switch (severity) {
      case 'critical':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      case 'low':
        return '🔵';
      default:
        return 'ℹ️';
    }
  }
}

export default NotificationService.getInstance();
