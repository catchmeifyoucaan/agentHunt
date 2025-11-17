/**
 * Policy & Legal Engine
 * Enforces consent, scope, rate limits, and action policies
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import type {
  PolicyRule,
  PolicyCondition,
  PolicyAction,
  ConsentRecord,
  BaseJob,
  Asset,
  Notification
} from '../../../../shared/types';
import logger from '../../utils/logger';

export class PolicyEngineService {
  private db: Pool;
  private ruleCache: Map<string, PolicyRule[]> = new Map();
  private cacheTimeout: number = 60000; // 1 minute
  private lastCacheUpdate: number = 0;

  constructor(db: Pool) {
    this.db = db;
  }

  /**
   * Create a policy rule
   */
  async createPolicyRule(rule: Omit<PolicyRule, 'id' | 'createdAt' | 'updatedAt'>): Promise<PolicyRule> {
    const id = uuidv4();
    const now = new Date();

    await this.db.query(
      `INSERT INTO policy_rules
       (id, name, description, scope, target_id, rule_type, conditions, actions, enabled, priority, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        id, rule.name, rule.description, rule.scope, rule.targetId, rule.ruleType,
        JSON.stringify(rule.conditions), JSON.stringify(rule.actions),
        rule.enabled, rule.priority, JSON.stringify(rule.metadata), now, now
      ]
    );

    logger.info({ ruleId: id, name: rule.name, ruleType: rule.ruleType }, 'Policy rule created');

    this.invalidateCache();

    return {
      ...rule,
      id,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Evaluate if a job is allowed to run based on policies
   */
  async evaluateJobPolicy(job: BaseJob, asset?: Asset): Promise<{
    allowed: boolean;
    requiresApproval: boolean;
    denialReason?: string;
    throttleDelay?: number;
  }> {
    const rules = await this.getApplicableRules(job.programId, asset?.id);

    let allowed = true;
    let requiresApproval = false;
    let denialReason: string | undefined;
    let throttleDelay: number | undefined;

    // Sort by priority (lower number = higher priority)
    rules.sort((a, b) => a.priority - b.priority);

    for (const rule of rules) {
      // Check if rule conditions match
      if (!this.evaluateConditions(rule.conditions, job, asset)) {
        continue;
      }

      logger.debug({ ruleId: rule.id, jobId: job.id }, 'Policy rule matched');

      // Execute actions
      for (const action of rule.actions) {
        switch (action.action) {
          case 'deny':
            allowed = false;
            denialReason = action.params?.reason || `Denied by policy rule: ${rule.name}`;
            break;

          case 'require_approval':
            requiresApproval = true;
            break;

          case 'throttle':
            throttleDelay = action.params?.delaySeconds || 60;
            break;

          case 'log':
            logger.info({
              ruleId: rule.id,
              jobId: job.id,
              message: action.params?.message
            }, 'Policy action: log');
            break;

          case 'alert':
            // Integrate with a proper notification system (e.g., Slack, Email, PagerDuty)
            await this.sendAlertNotification({
              ruleId: rule.id,
              jobId: job.id,
              jobType: job.type,
              programId: job.programId,
              alertMessage: action.params?.alert || `Policy rule triggered: ${rule.name}`,
              ruleName: rule.name,
              ruleDescription: rule.description
            });
            break;
        }
      }

      // If denied, stop processing further rules
      if (!allowed) break;
    }

    return {
      allowed,
      requiresApproval,
      denialReason,
      throttleDelay
    };
  }

  /**
   * Check consent for a target
   */
  async hasConsent(programId: string, target: string, scope: string[]): Promise<{
    hasConsent: boolean;
    consentRecord?: ConsentRecord;
    reason?: string;
  }> {
    // Find active consent records
    const result = await this.db.query(
      `SELECT * FROM consent_records
       WHERE program_id = $1
       AND revoked = false
       AND valid_from <= NOW()
       AND (valid_until IS NULL OR valid_until > NOW())
       ORDER BY created_at DESC`,
      [programId]
    );

    for (const row of result.rows) {
      const consent: ConsentRecord = {
        id: row.id,
        programId: row.program_id,
        assetId: row.asset_id,
        consentType: row.consent_type,
        scope: row.scope,
        restrictions: row.restrictions,
        grantedBy: row.granted_by,
        evidence: row.evidence,
        validFrom: row.valid_from,
        validUntil: row.valid_until,
        revoked: row.revoked,
        revokedAt: row.revoked_at,
        createdAt: row.created_at
      };

      // Check if target matches (exact match or wildcard)
      const targetMatches = consent.scope.some(s =>
        s === target ||
        s === '*' ||
        (s.startsWith('*.') && target.endsWith(s.substring(1)))
      );

      if (targetMatches) {
        // Check if requested scope is covered
        const scopeCovered = scope.every(s =>
          consent.scope.includes(s) || consent.scope.includes('*')
        );

        if (scopeCovered) {
          return {
            hasConsent: true,
            consentRecord: consent
          };
        }
      }
    }

    return {
      hasConsent: false,
      reason: 'No valid consent record found for this target and scope'
    };
  }

  /**
   * Create a consent record
   */
  async createConsentRecord(consent: Omit<ConsentRecord, 'id' | 'createdAt'>): Promise<ConsentRecord> {
    const id = uuidv4();
    const now = new Date();

    await this.db.query(
      `INSERT INTO consent_records
       (id, program_id, asset_id, consent_type, scope, restrictions, granted_by, evidence,
        valid_from, valid_until, revoked, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        id, consent.programId, consent.assetId, consent.consentType,
        consent.scope, consent.restrictions, consent.grantedBy, consent.evidence,
        consent.validFrom, consent.validUntil, false, now
      ]
    );

    logger.info({
      consentId: id,
      programId: consent.programId,
      consentType: consent.consentType
    }, 'Consent record created');

    return {
      ...consent,
      id,
      revoked: false,
      createdAt: now
    };
  }

  /**
   * Revoke a consent record
   */
  async revokeConsent(consentId: string): Promise<void> {
    await this.db.query(
      `UPDATE consent_records
       SET revoked = true, revoked_at = NOW()
       WHERE id = $1`,
      [consentId]
    );

    logger.info({ consentId }, 'Consent revoked');
  }

  /**
   * Check rate limits for a program
   */
  async checkRateLimit(programId: string, jobType: string): Promise<{
    allowed: boolean;
    reason?: string;
    retryAfter?: number; // seconds
  }> {
    // Get program policy
    const programResult = await this.db.query(
      `SELECT policy FROM programs WHERE id = $1`,
      [programId]
    );

    if (programResult.rows.length === 0) {
      return { allowed: true };
    }

    const policy = programResult.rows[0].policy;
    const rateLimit = policy.rateLimit;

    if (!rateLimit?.respectRateLimit) {
      return { allowed: true };
    }

    // Check concurrent scans
    const concurrentResult = await this.db.query(
      `SELECT COUNT(*) as count FROM jobs
       WHERE program_id = $1 AND status = 'active'`,
      [programId]
    );

    const currentConcurrent = parseInt(concurrentResult.rows[0].count);

    if (currentConcurrent >= rateLimit.maxConcurrentScans) {
      return {
        allowed: false,
        reason: `Maximum concurrent scans (${rateLimit.maxConcurrentScans}) reached`,
        retryAfter: 60
      };
    }

    // Check requests per second (look at recent jobs)
    const recentJobsResult = await this.db.query(
      `SELECT COUNT(*) as count FROM jobs
       WHERE program_id = $1
       AND created_at > NOW() - INTERVAL '1 second'`,
      [programId]
    );

    const recentJobCount = parseInt(recentJobsResult.rows[0].count);

    if (recentJobCount >= rateLimit.maxRequestsPerSecond) {
      return {
        allowed: false,
        reason: `Rate limit of ${rateLimit.maxRequestsPerSecond} requests/second exceeded`,
        retryAfter: 1
      };
    }

    return { allowed: true };
  }

  /**
   * Check if target is in scope
   */
  async isInScope(programId: string, target: string): Promise<boolean> {
    const programResult = await this.db.query(
      `SELECT scope FROM programs WHERE id = $1`,
      [programId]
    );

    if (programResult.rows.length === 0) {
      return false;
    }

    const scope = programResult.rows[0].scope;

    // Check explicit domains
    if (scope.domains?.includes(target)) {
      return true;
    }

    // Check wildcard domains
    if (scope.wildcardDomains) {
      for (const wildcard of scope.wildcardDomains) {
        if (wildcard.startsWith('*.')) {
          const domain = wildcard.substring(2);
          if (target === domain || target.endsWith(`.${domain}`)) {
            return true;
          }
        }
      }
    }

    // Check excluded domains
    if (scope.excludedDomains?.includes(target)) {
      return false;
    }

    return false;
  }

  /**
   * Get applicable rules for a program/asset
   */
  private async getApplicableRules(programId: string, assetId?: string): Promise<PolicyRule[]> {
    // Check cache
    const now = Date.now();
    if (now - this.lastCacheUpdate < this.cacheTimeout) {
      const cached = this.ruleCache.get(programId);
      if (cached) {
        return cached;
      }
    }

    // Query database
    const result = await this.db.query(
      `SELECT * FROM policy_rules
       WHERE enabled = true
       AND (
         scope = 'global'
         OR (scope = 'program' AND target_id = $1)
         OR (scope = 'asset' AND target_id = $2)
       )
       ORDER BY priority ASC`,
      [programId, assetId]
    );

    const rules: PolicyRule[] = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description,
      scope: row.scope,
      targetId: row.target_id,
      ruleType: row.rule_type,
      conditions: row.conditions,
      actions: row.actions,
      enabled: row.enabled,
      priority: row.priority,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    // Update cache
    this.ruleCache.set(programId, rules);
    this.lastCacheUpdate = now;

    return rules;
  }

  /**
   * Evaluate conditions against job/asset
   */
  private evaluateConditions(
    conditions: PolicyCondition[],
    job: BaseJob,
    asset?: Asset
  ): boolean {
    for (const condition of conditions) {
      const value = this.getFieldValue(condition.field, job, asset);

      if (!this.evaluateCondition(condition, value)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get field value from job or asset
   */
  private getFieldValue(field: string, job: BaseJob, asset?: Asset): any {
    // Support dot notation for nested fields
    const parts = field.split('.');

    if (parts[0] === 'job') {
      let value: any = job;
      for (let i = 1; i < parts.length; i++) {
        value = value?.[parts[i]];
      }
      return value;
    } else if (parts[0] === 'asset' && asset) {
      let value: any = asset;
      for (let i = 1; i < parts.length; i++) {
        value = value?.[parts[i]];
      }
      return value;
    }

    return undefined;
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(condition: PolicyCondition, actualValue: any): boolean {
    switch (condition.operator) {
      case 'equals':
        return actualValue === condition.value;

      case 'not_equals':
        return actualValue !== condition.value;

      case 'contains':
        return typeof actualValue === 'string' && actualValue.includes(condition.value);

      case 'not_contains':
        return typeof actualValue === 'string' && !actualValue.includes(condition.value);

      case 'greater_than':
        return actualValue > condition.value;

      case 'less_than':
        return actualValue < condition.value;

      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(actualValue);

      case 'not_in':
        return Array.isArray(condition.value) && !condition.value.includes(actualValue);

      default:
        logger.warn({ operator: condition.operator }, 'Unknown condition operator');
        return false;
    }
  }

  /**
   * Invalidate rule cache
   */
  private invalidateCache(): void {
    this.ruleCache.clear();
    this.lastCacheUpdate = 0;
  }

  /**
   * Send alert notifications through various channels
   */
  private async sendAlertNotification(notificationData: {
    ruleId: string;
    jobId: string;
    jobType: string;
    programId: string;
    alertMessage: string;
    ruleName: string;
    ruleDescription: string;
  }): Promise<void> {
    try {
      // Determine notification channels from environment/config
      const notificationChannels: string[] = [];

      if (process.env.SLACK_WEBHOOK_URL) notificationChannels.push('slack');
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) notificationChannels.push('telegram');
      if (process.env.SMTP_HOST) notificationChannels.push('email');
      if (process.env.WEBHOOK_URL) notificationChannels.push('webhook');

      // If no notification channels are configured, fall back to logging
      if (notificationChannels.length === 0) {
        logger.warn({
          ruleId: notificationData.ruleId,
          jobId: notificationData.jobId,
          programId: notificationData.programId,
          alert: notificationData.alertMessage
        }, 'Policy action: alert (no notification channels configured)');
        return;
      }

      // Send notifications to all configured channels
      for (const channel of notificationChannels) {
        try {
          switch (channel) {
            case 'slack':
              await this.sendSlackNotification(notificationData);
              break;
            case 'telegram':
              await this.sendTelegramNotification(notificationData);
              break;
            case 'email':
              await this.sendEmailNotification(notificationData);
              break;
            case 'webhook':
              await this.sendWebhookNotification(notificationData);
              break;
          }
        } catch (error) {
          logger.error({
            channel,
            error,
            ruleId: notificationData.ruleId,
            jobId: notificationData.jobId
          }, 'Failed to send notification via channel');
        }
      }

      // Also save to database for audit trail
      await this.saveNotificationToDatabase(notificationData);
    } catch (error) {
      logger.error({
        error,
        notificationData
      }, 'Failed to send policy alert notification');
    }
  }

  /**
   * Send notification to Slack
   */
  private async sendSlackNotification(data: {
    ruleId: string;
    jobId: string;
    jobType: string;
    programId: string;
    alertMessage: string;
    ruleName: string;
    ruleDescription: string;
  }): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) {
      logger.warn('SLACK_WEBHOOK_URL not configured');
      return;
    }

    const message = {
      text: `🚨 Policy Alert: ${data.alertMessage}`,
      attachments: [
        {
          color: 'danger',
          fields: [
            {
              title: 'Rule Name',
              value: data.ruleName,
              short: true
            },
            {
              title: 'Job ID',
              value: data.jobId,
              short: true
            },
            {
              title: 'Job Type',
              value: data.jobType,
              short: true
            },
            {
              title: 'Program ID',
              value: data.programId,
              short: true
            },
            {
              title: 'Rule Description',
              value: data.ruleDescription,
              short: false
            }
          ],
          footer: 'AgentHunt Policy Engine',
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    };

    await axios.post(webhookUrl, message);
  }

  /**
   * Send notification to Telegram
   */
  private async sendTelegramNotification(data: {
    ruleId: string;
    jobId: string;
    jobType: string;
    programId: string;
    alertMessage: string;
    ruleName: string;
    ruleDescription: string;
  }): Promise<void> {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      logger.warn('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not configured');
      return;
    }

    const message = `
🚨 *Policy Alert*

*Message:* ${data.alertMessage}
*Rule:* ${data.ruleName}
*Job ID:* ${data.jobId}
*Job Type:* ${data.jobType}
*Program ID:* ${data.programId}
*Description:* ${data.ruleDescription}
    `.trim();

    await axios.post(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown'
      }
    );
  }

  /**
   * Send notification via email
   */
  private async sendEmailNotification(data: {
    ruleId: string;
    jobId: string;
    jobType: string;
    programId: string;
    alertMessage: string;
    ruleName: string;
    ruleDescription: string;
  }): Promise<void> {
    // For now, log the intent to send email
    // In a production system, you would use an email service like nodemailer
    logger.info({
      ruleId: data.ruleId,
      jobId: data.jobId,
      programId: data.programId,
      alertMessage: data.alertMessage,
      ruleName: data.ruleName
    }, 'Would send email notification (configure SMTP to enable)');
  }

  /**
   * Send notification via webhook
   */
  private async sendWebhookNotification(data: {
    ruleId: string;
    jobId: string;
    jobType: string;
    programId: string;
    alertMessage: string;
    ruleName: string;
    ruleDescription: string;
  }): Promise<void> {
    const webhookUrl = process.env.WEBHOOK_URL;
    if (!webhookUrl) {
      logger.warn('WEBHOOK_URL not configured');
      return;
    }

    await axios.post(webhookUrl, {
      type: 'policy_alert',
      timestamp: new Date().toISOString(),
      data
    }, {
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.WEBHOOK_AUTH_TOKEN && { 'Authorization': `Bearer ${process.env.WEBHOOK_AUTH_TOKEN}` })
      }
    });
  }

  /**
   * Save notification to database for audit trail
   */
  private async saveNotificationToDatabase(data: {
    ruleId: string;
    jobId: string;
    jobType: string;
    programId: string;
    alertMessage: string;
    ruleName: string;
    ruleDescription: string;
  }): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO notifications (id, type, severity, title, message, finding_id, program_id, sent, sent_at, created_at)
        VALUES ($1, 'policy_alert', 'high', $2, $3, $4, $5, true, NOW(), NOW())
      `, [
        uuidv4(),
        data.ruleName,
        data.alertMessage,
        data.jobId,
        data.programId
      ]);
    } catch (error) {
      logger.error({ error, data }, 'Failed to save notification to database');
    }
  }
}
