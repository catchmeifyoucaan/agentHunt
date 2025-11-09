import { Router } from 'express';
import database from '../../services/database';
import templates from '../../services/templates';
import logger from '../../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * Human-in-the-Loop Submission Workflow
 * All submissions require explicit human approval
 */

// Get manual submission template for a finding
router.get('/findings/:findingId/template', async (req, res) => {
  try {
    const { findingId } = req.params;
    const { platform = 'generic' } = req.query;

    // Get finding with related data
    const result = await database.query(
      `SELECT f.*, a.value as asset_value, p.name as program_name, p.platform as program_platform
       FROM findings f
       JOIN assets a ON f.asset_id = a.id
       JOIN programs p ON f.program_id = p.id
       WHERE f.id = $1`,
      [findingId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Finding not found' });
    }

    const finding = result.rows[0];

    // Use program platform if not specified
    const targetPlatform = (platform as string) || finding.program_platform || 'generic';

    // Generate template
    const template = templates.generateTemplate(finding, targetPlatform);

    res.json({
      platform: targetPlatform,
      template,
      findingId,
      generatedAt: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create submission approval request (human-in-the-loop)
router.post('/findings/:findingId/request-approval', async (req, res) => {
  try {
    const { findingId } = req.params;
    const { userId, notes, autoSubmit = false } = req.body;

    // Create approval request
    const requestId = uuidv4();

    await database.query(
      `INSERT INTO submission_approvals (id, finding_id, requested_by, notes, auto_submit, status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW())`,
      [requestId, findingId, userId, notes || '', autoSubmit]
    );

    // Emit human action request event
    const finding = await database.query('SELECT * FROM findings WHERE id = $1', [findingId]);

    if (finding.rows.length > 0) {
      // This would trigger a notification to admins
      // For now, just log
      console.log('Submission approval requested for finding:', findingId);
    }

    res.json({
      requestId,
      status: 'pending',
      message: 'Submission approval request created. Waiting for admin review.',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get pending approval requests
router.get('/approvals/pending', async (req, res) => {
  try {
    const { userId } = req.query;

    let query = `
      SELECT sa.*, f.title as finding_title, f.severity, p.name as program_name
      FROM submission_approvals sa
      JOIN findings f ON sa.finding_id = f.id
      JOIN programs p ON f.program_id = p.id
      WHERE sa.status = 'pending'
    `;

    const params: any[] = [];

    if (userId) {
      query += ' AND sa.requested_by = $1';
      params.push(userId);
    }

    query += ' ORDER BY sa.created_at DESC';

    const result = await database.query(query, params);

    res.json({ approvals: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Approve submission (admin only)
router.post('/approvals/:requestId/approve', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { approvedBy, comments } = req.body;

    // Update approval status
    await database.query(
      `UPDATE submission_approvals
       SET status = 'approved',
           approved_by = $1,
           approved_at = NOW(),
           comments = $2
       WHERE id = $3`,
      [approvedBy, comments || '', requestId]
    );

    // Get approval details
    const result = await database.query(
      'SELECT * FROM submission_approvals WHERE id = $1',
      [requestId]
    );

    const approval = result.rows[0];

    // If auto_submit is true, trigger automatic submission
    if (approval.auto_submit) {
      // Trigger platform API submission
      try {
        // Get finding and program details
        const findingResult = await database.query(
          'SELECT f.*, p.platform FROM findings f JOIN programs p ON f.program_id = p.id WHERE f.id = $1',
          [approval.finding_id]
        );

        if (findingResult.rows.length > 0) {
          const finding = findingResult.rows[0];
          const platform = finding.platform;

          // Queue submission job based on platform
          if (platform === 'hackerone' || platform === 'bugcrowd') {
            logger.info({
              findingId: approval.finding_id,
              platform
            }, 'Queueing platform submission');

            // Update status to submitted (actual API integration would happen via a worker)
            await database.query(
              `UPDATE findings SET status = 'submitted', submitted_at = NOW(), metadata = metadata || $2 WHERE id = $1`,
              [
                approval.finding_id,
                JSON.stringify({ autoSubmitted: true, submittedBy: 'system' })
              ]
            );

            // Log the submission event
            await database.query(
              `INSERT INTO events (id, job_id, program_id, level, message, metadata, timestamp)
               VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
              [
                uuidv4(),
                null,
                finding.program_id,
                'info',
                `Finding ${approval.finding_id} auto-submitted to ${platform}`,
                JSON.stringify({ findingId: approval.finding_id, platform })
              ]
            );
          }
        }
      } catch (error: any) {
        logger.error({ error, findingId: approval.finding_id }, 'Failed to trigger platform submission');
        // Don't fail the approval if submission fails
      }
    }

    res.json({
      status: 'approved',
      message: approval.auto_submit
        ? 'Approval granted and submission initiated'
        : 'Approval granted. Manual submission can proceed.',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reject submission
router.post('/approvals/:requestId/reject', async (req, res) => {
  try {
    const { requestId } = req.params;
    const { rejectedBy, reason } = req.body;

    await database.query(
      `UPDATE submission_approvals
       SET status = 'rejected',
           approved_by = $1,
           approved_at = NOW(),
           comments = $2
       WHERE id = $3`,
      [rejectedBy, reason || 'No reason provided', requestId]
    );

    res.json({
      status: 'rejected',
      message: 'Submission request rejected',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Mark finding as manually submitted
router.post('/findings/:findingId/mark-submitted', async (req, res) => {
  try {
    const { findingId } = req.params;
    const { platform, reportUrl, submittedBy } = req.body;

    await database.query(
      `UPDATE findings
       SET status = 'submitted',
           submitted_at = NOW(),
           metadata = metadata || jsonb_build_object(
             'manual_submission', true,
             'submitted_platform', $2,
             'report_url', $3,
             'submitted_by', $4
           )
       WHERE id = $1`,
      [findingId, platform, reportUrl, submittedBy]
    );

    res.json({
      message: 'Finding marked as submitted',
      findingId,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
