/**
 * Human-in-the-Loop (HITL) Service
 * Manages approval workflows for high-risk actions
 */

import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import type { ApprovalRequest, Approval } from '../../../../shared/types';
import logger from '../../utils/logger';
import { EventEmitter } from 'events';

export class HITLService extends EventEmitter {
  private db: Pool;

  constructor(db: Pool) {
    super();
    this.db = db;
  }

  /**
   * Create an approval request
   */
  async createApprovalRequest(
    type: ApprovalRequest['type'],
    requestedBy: string,
    action: string,
    reason: string,
    riskLevel: ApprovalRequest['riskLevel'],
    context: Record<string, any> = {},
    options: {
      jobId?: string;
      findingId?: string;
      requiredApprovers?: number;
      expiresIn?: number; // minutes
    } = {}
  ): Promise<ApprovalRequest> {
    const id = uuidv4();
    const now = new Date();

    const requiredApprovers = options.requiredApprovers || this.getRequiredApprovers(riskLevel);
    const expiresAt = options.expiresIn
      ? new Date(now.getTime() + options.expiresIn * 60 * 1000)
      : undefined;

    const request: ApprovalRequest = {
      id,
      type,
      requestedBy,
      jobId: options.jobId,
      findingId: options.findingId,
      action,
      reason,
      riskLevel,
      context,
      requiredApprovers,
      approvers: [],
      status: 'pending',
      expiresAt,
      createdAt: now,
    };

    await this.db.query(
      `INSERT INTO approval_requests
       (id, type, requested_by, job_id, finding_id, action, reason, risk_level, context,
        required_approvers, approvers, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        type,
        requestedBy,
        options.jobId,
        options.findingId,
        action,
        reason,
        riskLevel,
        JSON.stringify(context),
        requiredApprovers,
        JSON.stringify([]),
        'pending',
        expiresAt,
        now,
      ]
    );

    logger.info(
      {
        requestId: id,
        type,
        riskLevel,
        action,
      },
      'Approval request created'
    );

    // Emit event for real-time notifications
    this.emit('approval_requested', request);

    return request;
  }

  /**
   * Submit an approval or rejection
   */
  async submitApproval(
    requestId: string,
    userId: string,
    decision: 'approve' | 'reject',
    comment?: string
  ): Promise<ApprovalRequest> {
    const request = await this.getApprovalRequest(requestId);

    if (!request) {
      throw new Error(`Approval request ${requestId} not found`);
    }

    if (request.status !== 'pending') {
      throw new Error(`Approval request ${requestId} is already ${request.status}`);
    }

    if (request.expiresAt && new Date() > request.expiresAt) {
      // Mark as expired
      await this.expireRequest(requestId);
      throw new Error(`Approval request ${requestId} has expired`);
    }

    // Check if user already approved
    const existingApproval = request.approvers.find((a) => a.userId === userId);
    if (existingApproval) {
      throw new Error(`User ${userId} has already submitted approval for ${requestId}`);
    }

    // Add approval
    const approval: Approval = {
      userId,
      decision,
      comment,
      timestamp: new Date(),
    };

    request.approvers.push(approval);

    // Check if we have enough approvals or any rejection
    const approvalCount = request.approvers.filter((a) => a.decision === 'approve').length;
    const rejectionCount = request.approvers.filter((a) => a.decision === 'reject').length;

    let newStatus: ApprovalRequest['status'] = 'pending';
    let resolvedAt: Date | undefined;

    if (rejectionCount > 0) {
      // Any rejection immediately rejects the request
      newStatus = 'rejected';
      resolvedAt = new Date();
    } else if (approvalCount >= request.requiredApprovers) {
      // Enough approvals
      newStatus = 'approved';
      resolvedAt = new Date();
    }

    // Update in database
    await this.db.query(
      `UPDATE approval_requests
       SET approvers = $1, status = $2, resolved_at = $3
       WHERE id = $4`,
      [JSON.stringify(request.approvers), newStatus, resolvedAt, requestId]
    );

    request.status = newStatus;
    request.resolvedAt = resolvedAt;

    logger.info(
      {
        requestId,
        userId,
        decision,
        newStatus,
        approvalCount,
      },
      'Approval submitted'
    );

    // Emit events based on status
    if (newStatus === 'approved') {
      this.emit('approval_granted', request);

      // If this was blocking a job, resume it
      if (request.jobId) {
        this.emit('job_approved', request.jobId);
      }
    } else if (newStatus === 'rejected') {
      this.emit('approval_rejected', request);

      // If this was blocking a job, cancel it
      if (request.jobId) {
        this.emit('job_rejected', request.jobId);
      }
    }

    return request;
  }

  /**
   * Check if an action requires approval based on policy
   */
  async requiresApproval(
    jobType: string,
    severity?: string,
    tier?: string,
    programId?: string
  ): Promise<{ required: boolean; reason?: string; riskLevel?: string }> {
    // Check program-specific policy if programId provided
    if (programId) {
      const programPolicy = await this.db.query(`SELECT policy FROM programs WHERE id = $1`, [
        programId,
      ]);

      if (programPolicy.rows.length > 0) {
        const policy = programPolicy.rows[0].policy;

        // Check tier requirements
        if (tier && policy.requireHumanApproval?.[tier]) {
          return {
            required: true,
            reason: `Template tier ${tier} requires human approval per program policy`,
            riskLevel: tier === 'tier3' ? 'critical' : 'high',
          };
        }

        // Check severity requirements
        if (severity && policy.requireHumanApproval?.[`${severity}Severity`]) {
          return {
            required: true,
            reason: `${severity} severity findings require human approval per program policy`,
            riskLevel: severity === 'critical' ? 'critical' : 'high',
          };
        }
      }
    }

    // Global high-risk job types
    const highRiskJobs = ['deserialization', 'racecondition', 'wafbypass'];
    if (highRiskJobs.includes(jobType)) {
      return {
        required: true,
        reason: `Job type ${jobType} is high-risk and requires approval`,
        riskLevel: 'high',
      };
    }

    return { required: false };
  }

  /**
   * Wait for approval with timeout
   */
  async waitForApproval(
    requestId: string,
    pollIntervalMs: number = 5000,
    timeoutMs: number = 3600000 // 1 hour default
  ): Promise<boolean> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkApproval = async () => {
        try {
          const request = await this.getApprovalRequest(requestId);

          if (!request) {
            clearInterval(interval);
            reject(new Error(`Approval request ${requestId} not found`));
            return;
          }

          if (request.status === 'approved') {
            clearInterval(interval);
            resolve(true);
          } else if (request.status === 'rejected' || request.status === 'expired') {
            clearInterval(interval);
            resolve(false);
          } else if (Date.now() - startTime > timeoutMs) {
            clearInterval(interval);
            // Mark as expired
            await this.expireRequest(requestId);
            resolve(false);
          }
        } catch (error: any) {
          clearInterval(interval);
          reject(error);
        }
      };

      const interval = setInterval(checkApproval, pollIntervalMs);
      checkApproval(); // Check immediately
    });
  }

  /**
   * Get pending approval requests
   */
  async getPendingApprovals(userId?: string): Promise<ApprovalRequest[]> {
    const query = `
      SELECT * FROM approval_requests
      WHERE status = 'pending'
      AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
    `;

    const result = await this.db.query(query);

    const requests = result.rows.map((row) => this.rowToApprovalRequest(row));

    // Filter by userId if provided (show only what user can approve)
    if (userId) {
      // In a real system, check user permissions/roles here
      return requests;
    }

    return requests;
  }

  /**
   * Get approval request by ID
   */
  async getApprovalRequest(id: string): Promise<ApprovalRequest | null> {
    const result = await this.db.query(`SELECT * FROM approval_requests WHERE id = $1`, [id]);

    if (result.rows.length === 0) return null;

    return this.rowToApprovalRequest(result.rows[0]);
  }

  /**
   * Expire an approval request
   */
  async expireRequest(requestId: string): Promise<void> {
    await this.db.query(
      `UPDATE approval_requests
       SET status = 'expired', resolved_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [requestId]
    );

    logger.info({ requestId }, 'Approval request expired');
    this.emit('approval_expired', requestId);
  }

  /**
   * Expire all pending requests that have passed their expiration time
   */
  async expirePendingRequests(): Promise<number> {
    const result = await this.db.query(
      `UPDATE approval_requests
       SET status = 'expired', resolved_at = NOW()
       WHERE status = 'pending'
       AND expires_at IS NOT NULL
       AND expires_at < NOW()
       RETURNING id`
    );

    const expiredCount = result.rows.length;

    if (expiredCount > 0) {
      logger.info({ expiredCount }, 'Expired pending approval requests');

      for (const row of result.rows) {
        this.emit('approval_expired', row.id);
      }
    }

    return expiredCount;
  }

  /**
   * Get required approvers based on risk level
   */
  private getRequiredApprovers(riskLevel: string): number {
    switch (riskLevel) {
      case 'critical':
        return 2; // Require 2 approvals for critical
      case 'high':
        return 1;
      case 'medium':
        return 1;
      case 'low':
        return 1;
      default:
        return 1;
    }
  }

  /**
   * Helper: Convert DB row to ApprovalRequest
   */
  private rowToApprovalRequest(row: any): ApprovalRequest {
    return {
      id: row.id,
      type: row.type,
      requestedBy: row.requested_by,
      jobId: row.job_id,
      findingId: row.finding_id,
      action: row.action,
      reason: row.reason,
      riskLevel: row.risk_level,
      context: row.context,
      requiredApprovers: row.required_approvers,
      approvers: row.approvers,
      status: row.status,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }
}
