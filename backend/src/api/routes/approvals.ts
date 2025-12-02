/**
 * Approval Routes
 * API endpoints for managing approval requests for critical operations
 */

import { Router, Request, Response } from 'express';
import approvalService from '../../services/approval-service';
import logger from '../../utils/logger';

const router = Router();

/**
 * GET /api/approvals/pending
 * Get all pending approval requests
 */
router.get('/pending', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const requests = await approvalService.getPendingRequests(limit);

    res.json({
      success: true,
      requests,
      count: requests.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get pending approvals');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/approvals/:id/approve
 * Approve a pending request
 */
router.post('/:id/approve', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // In production, get user from authenticated session
    const approvedBy = req.body.approvedBy || req.headers['x-user-id'] || 'admin';
    const isAdmin = req.body.isAdmin !== false; // Default to true for now

    if (!isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Only admin users can approve critical operations',
      });
    }

    const decision = await approvalService.approveRequest(id, approvedBy as string, isAdmin);

    res.json({
      success: true,
      decision,
    });
  } catch (error: any) {
    logger.error({ error, requestId: req.params.id }, 'Failed to approve request');
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/approvals/:id/reject
 * Reject a pending request
 */
router.post('/:id/reject', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const rejectedBy = req.body.rejectedBy || req.headers['x-user-id'] || 'admin';

    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Rejection reason is required',
      });
    }

    const decision = await approvalService.rejectRequest(id, rejectedBy as string, reason);

    res.json({
      success: true,
      decision,
    });
  } catch (error: any) {
    logger.error({ error, requestId: req.params.id }, 'Failed to reject request');
    res.status(400).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/approvals/:id/status
 * Check if a request has been approved
 */
router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const isApproved = await approvalService.isApproved(id);

    res.json({
      success: true,
      requestId: id,
      isApproved,
    });
  } catch (error: any) {
    logger.error({ error, requestId: req.params.id }, 'Failed to check approval status');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/approvals/audit
 * Get audit log for approvals
 */
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const { eventType, startDate, endDate, limit } = req.query;

    const filters: any = {};
    if (eventType) filters.eventType = eventType as string;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const auditLog = await approvalService.getAuditLog(
      Object.keys(filters).length > 0 ? filters : undefined,
      parseInt(limit as string) || 100
    );

    res.json({
      success: true,
      auditLog,
      count: auditLog.length,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to get audit log');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/approvals/expire
 * Manually expire old pending requests
 */
router.post('/expire', async (req: Request, res: Response) => {
  try {
    const expiredCount = await approvalService.expireOldRequests();

    res.json({
      success: true,
      expiredCount,
    });
  } catch (error: any) {
    logger.error({ error }, 'Failed to expire old requests');
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
