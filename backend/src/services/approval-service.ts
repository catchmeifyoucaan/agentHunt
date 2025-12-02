/**
 * Approval Service
 * Manages approval workflows for critical/destructive operations.
 * Provides authenticated approval enforcement and audit logging.
 */

import database from './database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface ApprovalRequest {
  id: string;
  action: string;
  reason: string;
  requestedBy: string;
  requestedAt: Date;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  approvedBy?: string;
  approvedAt?: Date;
  rejectionReason?: string;
  expiresAt: Date;
  context: Record<string, any>;
  dangerLevel: 'safe' | 'elevated' | 'critical' | 'destructive';
}

export interface ApprovalDecision {
  approved: boolean;
  approvedBy: string;
  reason?: string;
  timestamp: Date;
}

class ApprovalService {
  private readonly DEFAULT_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

  /**
   * Create an approval request for a critical operation
   */
  async createApprovalRequest(
    action: string,
    reason: string,
    requestedBy: string,
    context: Record<string, any>,
    dangerLevel: ApprovalRequest['dangerLevel'] = 'critical'
  ): Promise<string> {
    const requestId = uuidv4();
    const expiresAt = new Date(Date.now() + this.DEFAULT_EXPIRY_MS);

    try {
      await database.query(
        `INSERT INTO approval_requests 
         (id, action, reason, requested_by, requested_at, status, expires_at, context, danger_level)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, 'pending', $5, $6, $7)`,
        [requestId, action, reason, requestedBy, expiresAt, JSON.stringify(context), dangerLevel]
      );

      // Log the request for audit trail
      await this.logAuditEvent('approval_requested', {
        requestId,
        action,
        reason,
        requestedBy,
        dangerLevel,
        expiresAt: expiresAt.toISOString(),
      });

      logger.info(
        { requestId, action, dangerLevel, requestedBy },
        'Approval request created'
      );

      return requestId;
    } catch (error: any) {
      logger.error({ error, action, requestedBy }, 'Failed to create approval request');
      throw error;
    }
  }

  /**
   * Approve a pending request (requires admin authentication)
   */
  async approveRequest(
    requestId: string,
    approvedBy: string,
    isAdmin: boolean
  ): Promise<ApprovalDecision> {
    if (!isAdmin) {
      throw new Error('Only admin users can approve critical operations');
    }

    try {
      // Get the request
      const result = await database.query(
        'SELECT * FROM approval_requests WHERE id = $1',
        [requestId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Approval request not found: ${requestId}`);
      }

      const request = result.rows[0];

      // Check if already processed
      if (request.status !== 'pending') {
        throw new Error(`Request already ${request.status}`);
      }

      // Check if expired
      if (new Date(request.expires_at) < new Date()) {
        await database.query(
          `UPDATE approval_requests SET status = 'expired' WHERE id = $1`,
          [requestId]
        );
        throw new Error('Approval request has expired');
      }

      // Approve the request
      await database.query(
        `UPDATE approval_requests 
         SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [approvedBy, requestId]
      );

      // Log the approval
      await this.logAuditEvent('approval_granted', {
        requestId,
        action: request.action,
        approvedBy,
        dangerLevel: request.danger_level,
        originalRequester: request.requested_by,
      });

      logger.info(
        { requestId, action: request.action, approvedBy },
        'Approval request approved'
      );

      return {
        approved: true,
        approvedBy,
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error, requestId, approvedBy }, 'Failed to approve request');
      throw error;
    }
  }

  /**
   * Reject a pending request
   */
  async rejectRequest(
    requestId: string,
    rejectedBy: string,
    reason: string
  ): Promise<ApprovalDecision> {
    try {
      const result = await database.query(
        'SELECT * FROM approval_requests WHERE id = $1',
        [requestId]
      );

      if (result.rows.length === 0) {
        throw new Error(`Approval request not found: ${requestId}`);
      }

      const request = result.rows[0];

      if (request.status !== 'pending') {
        throw new Error(`Request already ${request.status}`);
      }

      await database.query(
        `UPDATE approval_requests 
         SET status = 'rejected', approved_by = $1, approved_at = CURRENT_TIMESTAMP, rejection_reason = $2
         WHERE id = $3`,
        [rejectedBy, reason, requestId]
      );

      // Log the rejection
      await this.logAuditEvent('approval_rejected', {
        requestId,
        action: request.action,
        rejectedBy,
        reason,
        dangerLevel: request.danger_level,
      });

      logger.info(
        { requestId, action: request.action, rejectedBy, reason },
        'Approval request rejected'
      );

      return {
        approved: false,
        approvedBy: rejectedBy,
        reason,
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error, requestId, rejectedBy }, 'Failed to reject request');
      throw error;
    }
  }

  /**
   * Check if an operation has been approved
   */
  async isApproved(requestId: string): Promise<boolean> {
    try {
      const result = await database.query(
        `SELECT status FROM approval_requests WHERE id = $1`,
        [requestId]
      );

      return result.rows.length > 0 && result.rows[0].status === 'approved';
    } catch (error: any) {
      logger.error({ error, requestId }, 'Failed to check approval status');
      return false;
    }
  }

  /**
   * Get pending approval requests
   */
  async getPendingRequests(limit: number = 50): Promise<ApprovalRequest[]> {
    try {
      const result = await database.query(
        `SELECT * FROM approval_requests 
         WHERE status = 'pending' AND expires_at > CURRENT_TIMESTAMP
         ORDER BY requested_at DESC
         LIMIT $1`,
        [limit]
      );

      return result.rows.map((row: any) => ({
        id: row.id,
        action: row.action,
        reason: row.reason,
        requestedBy: row.requested_by,
        requestedAt: row.requested_at,
        status: row.status,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        rejectionReason: row.rejection_reason,
        expiresAt: row.expires_at,
        context: row.context,
        dangerLevel: row.danger_level,
      }));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get pending requests');
      return [];
    }
  }

  /**
   * Expire old pending requests
   */
  async expireOldRequests(): Promise<number> {
    try {
      const result = await database.query(
        `UPDATE approval_requests 
         SET status = 'expired'
         WHERE status = 'pending' AND expires_at < CURRENT_TIMESTAMP
         RETURNING id`
      );

      const count = result.rows.length;
      if (count > 0) {
        logger.info({ count }, 'Expired old approval requests');
      }
      return count;
    } catch (error: any) {
      logger.error({ error }, 'Failed to expire old requests');
      return 0;
    }
  }

  /**
   * Log an audit event
   */
  private async logAuditEvent(
    eventType: string,
    details: Record<string, any>
  ): Promise<void> {
    try {
      await database.query(
        `INSERT INTO audit_logs (id, event_type, details, created_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [uuidv4(), eventType, JSON.stringify(details)]
      );
    } catch (error: any) {
      // Don't fail the main operation if audit logging fails
      logger.error({ error, eventType }, 'Failed to log audit event');
    }
  }

  /**
   * Get audit log for an action
   */
  async getAuditLog(
    filters?: {
      eventType?: string;
      startDate?: Date;
      endDate?: Date;
    },
    limit: number = 100
  ): Promise<any[]> {
    try {
      let query = 'SELECT * FROM audit_logs WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (filters?.eventType) {
        query += ` AND event_type = $${paramIndex++}`;
        params.push(filters.eventType);
      }

      if (filters?.startDate) {
        query += ` AND created_at >= $${paramIndex++}`;
        params.push(filters.startDate);
      }

      if (filters?.endDate) {
        query += ` AND created_at <= $${paramIndex++}`;
        params.push(filters.endDate);
      }

      query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
      params.push(limit);

      const result = await database.query(query, params);
      return result.rows;
    } catch (error: any) {
      logger.error({ error }, 'Failed to get audit log');
      return [];
    }
  }
}

export const approvalService = new ApprovalService();
export default approvalService;
