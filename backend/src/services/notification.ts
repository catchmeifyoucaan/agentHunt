import TelegramBot from 'node-telegram-bot-api';
import config from '../config';
import logger from '../utils/logger';
import database from './database';
import redis from './redis';
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
        await new Promise((resolve) =>
          setTimeout(resolve, this.MESSAGE_DELAY_MS - timeSinceLastMessage)
        );
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
            await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
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

  /**
   * Escape reserved characters for Telegram MarkdownV2
   */
  private escapeMarkdown(text: string): string {
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
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
  public async notifyFinding(
    finding: Finding,
    programName: string,
    assetValue: string
  ): Promise<void> {
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
            parse_mode: 'MarkdownV2',
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

      // 🚀 REAL-TIME WEBSOCKET: Publish finding to Redis pub/sub
      try {
        const findingUpdate = {
          findingId: finding.id,
          programId: finding.programId,
          programName,
          severity: finding.severity,
          title: finding.title,
          assetValue,
          timestamp: new Date().toISOString(),
        };

        // Publish to program-wide finding channel
        await redis.publish(`program:${finding.programId}:findings`, JSON.stringify(findingUpdate));

        // Publish to severity-specific channel for filtering
        await redis.publish(`findings:${finding.severity}`, JSON.stringify(findingUpdate));

        logger.debug(
          { findingId: finding.id, severity: finding.severity },
          'Published finding to Redis pub/sub'
        );
      } catch (redisError: any) {
        logger.error(
          { error: redisError, findingId: finding.id },
          'Failed to publish finding to Redis'
        );
      }
    } catch (error: any) {
      logger.error({ error, findingId: finding.id }, 'Failed to send Telegram notification');

      // Save error record
      await database.query(
        `INSERT INTO notifications (id, type, severity, title, message, finding_id, program_id, sent, error)
         VALUES ($1, 'telegram', $2, $3, '', $4, $5, false, $6)`,
        [
          notificationId,
          finding.severity,
          finding.title,
          finding.id,
          finding.programId,
          error.message,
        ]
      );
    }
  }

  /**
   * Send ops notification (non-finding alerts)
   */
  public async notifyOps(
    title: string,
    message: string,
    level: 'info' | 'warn' | 'error' = 'info'
  ): Promise<void> {
    if (!this.bot || !config.telegram.opsChannel) {
      return;
    }

    try {
      const icon = level === 'error' ? '🚨' : level === 'warn' ? '⚠️' : 'ℹ️';
      const escapedTitle = this.escapeMarkdown(title);
      const escapedMessage = this.escapeMarkdown(message);
      const formattedMessage = `${icon} *${escapedTitle}*\n\n${escapedMessage}`;

      await this.sendWithRateLimit(async () => {
        await this.bot!.sendMessage(config.telegram.opsChannel, formattedMessage, {
          parse_mode: 'MarkdownV2',
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
  public async notifyJobCreated(
    jobType: string,
    jobId: string,
    programId: string,
    priority: number
  ): Promise<void> {
    try {
      const programResult = await database.query('SELECT name FROM programs WHERE id = $1', [
        programId,
      ]);
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
      const programResult = await database.query('SELECT name FROM programs WHERE id = $1', [
        programId,
      ]);
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

      const escapedJobType = this.escapeMarkdown(jobType);
      const escapedJobId = this.escapeMarkdown(jobId);
      const escapedProgramName = this.escapeMarkdown(programName);
      const escapedOldStatus = this.escapeMarkdown(oldStatus);
      const escapedNewStatus = this.escapeMarkdown(newStatus);
      const escapedError = error ? this.escapeMarkdown(error.substring(0, 300)) : '';

      const lines = [
        `*Type:* ${escapedJobType}`,
        `*Job ID:* ${escapedJobId}`,
        `*Program:* ${escapedProgramName}`,
        `*Old Status:* ${escapedOldStatus}`,
        `*New Status:* ${escapedNewStatus}`,
      ];

      if (result) {
        const escapedResult = this.escapeMarkdown(
          JSON.stringify(result, null, 2).substring(0, 500)
        );
        lines.push(``, `*Result:*`, escapedResult);
      }

      if (error) {
        lines.push(``, `*Error:* ${escapedError}`);
      }

      const message = lines.join('\n');

      await this.notifyOps(`${icon} Job Status Changed`, message, level);

      // 🚀 REAL-TIME WEBSOCKET: Publish job status change to Redis pub/sub
      // This enables real-time WebSocket updates for connected clients
      try {
        const jobUpdate = {
          jobId,
          jobType,
          programId,
          programName,
          oldStatus,
          newStatus,
          result,
          error,
          timestamp: new Date().toISOString(),
        };

        // Publish to job-specific channel (job:${jobId}:progress)
        await redis.publish(`job:${jobId}:progress`, JSON.stringify(jobUpdate));

        // Also publish to program-wide channel for dashboard updates
        await redis.publish(`program:${programId}:jobs`, JSON.stringify(jobUpdate));

        logger.debug(
          { jobId, newStatus, channel: `job:${jobId}:progress` },
          'Published job status to Redis pub/sub'
        );
      } catch (redisError: any) {
        logger.error({ error: redisError, jobId }, 'Failed to publish job status to Redis');
      }
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
      const escapedProgramName = this.escapeMarkdown(programName);

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
📊 *Daily Digest: ${escapedProgramName}*

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
            parse_mode: 'MarkdownV2',
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

    const escapedProgramName = this.escapeMarkdown(programName);
    const escapedAssetValue = this.escapeMarkdown(assetValue);
    const escapedTitle = this.escapeMarkdown(finding.title);
    const escapedDescription =
      this.escapeMarkdown(finding.description.substring(0, 300)) +
      (finding.description.length > 300 ? '...' : '');
    const escapedImpact =
      this.escapeMarkdown(finding.impact.substring(0, 200)) +
      (finding.impact.length > 200 ? '...' : '');
    const escapedCwe =
      finding.cwe.length > 0 ? finding.cwe.map((c) => this.escapeMarkdown(c)).join(', ') : '';

    let message = `
${severityIcon} *New ${finding.severity.toUpperCase()} Finding*

*Program:* ${escapedProgramName}
*Asset:* ${escapedAssetValue}
*Title:* ${escapedTitle}

*Confidence:* ${confidencePercentage}%
*CVSS:* ${finding.cvss || 'N/A'}
${finding.cwe.length > 0 ? `*CWE:* ${escapedCwe}` : ''}

*Description:*
${escapedDescription}

*Impact:*
${escapedImpact}

*Status:* ${this.escapeMarkdown(finding.status)}
*Finding ID:* ${this.escapeMarkdown(finding.id)}
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
