/**
 * Collaboration Agent
 * Purpose: Multi-hunter team coordination
 * 
 * Features:
 * - Shared findings database
 * - Duplicate prevention
 * - Task assignment
 * - Live notifications
 * - Shared targets
 * - Team dashboard data
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface CollaborationJob extends BaseJob {
  type: 'collaboration';
  options: {
    teamId: string;
    action: 'share' | 'assign' | 'claim' | 'sync' | 'notify' | 'dashboard';
    userId?: string;
    findingId?: string;
    targetId?: string;
    message?: string;
  };
}

interface TeamMember {
  id: string;
  name: string;
  role: 'lead' | 'hunter' | 'triager' | 'reporter';
  status: 'active' | 'idle' | 'offline';
  assignedTasks: number;
  findingsCount: number;
}

interface SharedFinding {
  id: string;
  findingId: string;
  sharedBy: string;
  sharedAt: Date;
  claimedBy?: string;
  status: 'available' | 'claimed' | 'submitted' | 'duplicate';
}

interface TeamDashboard {
  teamId: string;
  members: TeamMember[];
  activeTargets: number;
  totalFindings: number;
  pendingTasks: number;
  recentActivity: any[];
  leaderboard: { userId: string; name: string; score: number }[];
}

export class CollaborationAgent extends BaseAgent<CollaborationJob> {
  constructor() {
    super('collaboration');
  }

  protected getSteps() {
    return [
      { name: 'Load team data' },
      { name: 'Execute action' },
      { name: 'Sync state' },
      { name: 'Send notifications' },
    ];
  }

  async process(job: Job<CollaborationJob>): Promise<any> {
    const { options } = job.data;
    const { teamId, action, userId, findingId, targetId, message } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      let result: any;

      switch (action) {
        case 'share':
          result = await this.shareFinding(teamId, findingId!, userId!, job.id!);
          break;
        case 'assign':
          result = await this.assignTask(teamId, findingId!, userId!, job.id!);
          break;
        case 'claim':
          result = await this.claimFinding(teamId, findingId!, userId!, job.id!);
          break;
        case 'sync':
          result = await this.syncTeamState(teamId, job.id!);
          break;
        case 'notify':
          result = await this.sendNotification(teamId, userId!, message!, job.id!);
          break;
        case 'dashboard':
          result = await this.getDashboard(teamId, job.id!);
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, action }, 'Collaboration action failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Share a finding with the team
   */
  private async shareFinding(teamId: string, findingId: string, userId: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 4,
      percentage: 25,
      currentTool: 'share',
      toolStatus: 'running',
      message: 'Sharing finding with team',
    });

    // Check for duplicates
    const isDuplicate = await this.checkDuplicate(teamId, findingId);
    if (isDuplicate) {
      return { success: false, error: 'Finding already shared or duplicate exists' };
    }

    // Share the finding
    const sharedFinding: SharedFinding = {
      id: uuidv4(),
      findingId,
      sharedBy: userId,
      sharedAt: new Date(),
      status: 'available',
    };

    await this.storeSharedFinding(teamId, sharedFinding);

    // Notify team
    await this.notifyTeam(teamId, {
      type: 'finding_shared',
      userId,
      findingId,
      message: `New finding shared by ${userId}`,
    });

    await this.updateJobProgress(jobId, {
      current: 4,
      total: 4,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: 'Finding shared successfully',
    });

    return { success: true, sharedFinding };
  }

  /**
   * Assign a task to a team member
   */
  private async assignTask(teamId: string, findingId: string, assigneeId: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 4,
      percentage: 25,
      currentTool: 'assign',
      toolStatus: 'running',
      message: 'Assigning task',
    });

    // Update finding assignment
    await database.query(
      `UPDATE shared_findings SET claimed_by = $1, status = 'claimed' WHERE team_id = $2 AND finding_id = $3`,
      [assigneeId, teamId, findingId]
    );

    // Create task record
    const taskId = uuidv4();
    await database.query(
      `INSERT INTO team_tasks (id, team_id, finding_id, assigned_to, status, created_at)
       VALUES ($1, $2, $3, $4, 'assigned', CURRENT_TIMESTAMP)`,
      [taskId, teamId, findingId, assigneeId]
    );

    // Notify assignee
    await this.notifyUser(assigneeId, {
      type: 'task_assigned',
      findingId,
      message: `You have been assigned a new task`,
    });

    await this.updateJobProgress(jobId, {
      current: 4,
      total: 4,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: 'Task assigned successfully',
    });

    return { success: true, taskId, assigneeId };
  }

  /**
   * Claim a finding
   */
  private async claimFinding(teamId: string, findingId: string, userId: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 4,
      percentage: 25,
      currentTool: 'claim',
      toolStatus: 'running',
      message: 'Claiming finding',
    });

    // Check if already claimed
    const existing = await database.query(
      `SELECT * FROM shared_findings WHERE team_id = $1 AND finding_id = $2`,
      [teamId, findingId]
    );

    if (existing.rows[0]?.claimed_by) {
      return { success: false, error: 'Finding already claimed' };
    }

    // Claim the finding
    await database.query(
      `UPDATE shared_findings SET claimed_by = $1, status = 'claimed' WHERE team_id = $2 AND finding_id = $3`,
      [userId, teamId, findingId]
    );

    // Notify team
    await this.notifyTeam(teamId, {
      type: 'finding_claimed',
      userId,
      findingId,
      message: `Finding claimed by ${userId}`,
    });

    await this.updateJobProgress(jobId, {
      current: 4,
      total: 4,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: 'Finding claimed successfully',
    });

    return { success: true, claimedBy: userId };
  }

  /**
   * Sync team state
   */
  private async syncTeamState(teamId: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 4,
      percentage: 25,
      currentTool: 'sync',
      toolStatus: 'running',
      message: 'Syncing team state',
    });

    // Get all team members
    const members = await this.getTeamMembers(teamId);

    // Get all shared findings
    const findings = await database.query(
      `SELECT * FROM shared_findings WHERE team_id = $1`,
      [teamId]
    );

    // Get all tasks
    const tasks = await database.query(
      `SELECT * FROM team_tasks WHERE team_id = $1`,
      [teamId]
    );

    // Update member stats
    for (const member of members) {
      const memberFindings = findings.rows.filter((f: any) => f.shared_by === member.id).length;
      const memberTasks = tasks.rows.filter((t: any) => t.assigned_to === member.id && t.status !== 'completed').length;

      await database.query(
        `UPDATE team_members SET findings_count = $1, assigned_tasks = $2 WHERE id = $3`,
        [memberFindings, memberTasks, member.id]
      );
    }

    await this.updateJobProgress(jobId, {
      current: 4,
      total: 4,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: 'Team state synced',
    });

    return {
      success: true,
      memberCount: members.length,
      findingsCount: findings.rows.length,
      tasksCount: tasks.rows.length,
    };
  }

  /**
   * Send notification to team or user
   */
  private async sendNotification(teamId: string, userId: string, message: string, jobId: string): Promise<any> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 4,
      percentage: 25,
      currentTool: 'notify',
      toolStatus: 'running',
      message: 'Sending notification',
    });

    if (userId === 'all') {
      await this.notifyTeam(teamId, {
        type: 'broadcast',
        message,
      });
    } else {
      await this.notifyUser(userId, {
        type: 'direct',
        message,
      });
    }

    await this.updateJobProgress(jobId, {
      current: 4,
      total: 4,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: 'Notification sent',
    });

    return { success: true };
  }

  /**
   * Get team dashboard data
   */
  private async getDashboard(teamId: string, jobId: string): Promise<TeamDashboard> {
    await this.updateJobProgress(jobId, {
      current: 1,
      total: 4,
      percentage: 25,
      currentTool: 'dashboard',
      toolStatus: 'running',
      message: 'Building dashboard',
    });

    // Get team members
    const members = await this.getTeamMembers(teamId);

    // Get findings count
    const findingsResult = await database.query(
      `SELECT COUNT(*) as count FROM shared_findings WHERE team_id = $1`,
      [teamId]
    );

    // Get pending tasks
    const tasksResult = await database.query(
      `SELECT COUNT(*) as count FROM team_tasks WHERE team_id = $1 AND status != 'completed'`,
      [teamId]
    );

    // Get active targets
    const targetsResult = await database.query(
      `SELECT COUNT(DISTINCT target_id) as count FROM team_targets WHERE team_id = $1 AND active = true`,
      [teamId]
    );

    // Get recent activity
    const activityResult = await database.query(
      `SELECT * FROM team_activity WHERE team_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [teamId]
    );

    // Build leaderboard
    const leaderboard = members
      .map(m => ({
        userId: m.id,
        name: m.name,
        score: m.findingsCount * 10 + (m.assignedTasks || 0) * 5,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    await this.updateJobProgress(jobId, {
      current: 4,
      total: 4,
      percentage: 100,
      currentTool: 'complete',
      toolStatus: 'completed',
      message: 'Dashboard ready',
    });

    return {
      teamId,
      members,
      activeTargets: parseInt(targetsResult.rows[0]?.count || '0'),
      totalFindings: parseInt(findingsResult.rows[0]?.count || '0'),
      pendingTasks: parseInt(tasksResult.rows[0]?.count || '0'),
      recentActivity: activityResult.rows,
      leaderboard,
    };
  }

  // Helper methods

  private async checkDuplicate(teamId: string, findingId: string): Promise<boolean> {
    const result = await database.query(
      `SELECT id FROM shared_findings WHERE team_id = $1 AND finding_id = $2`,
      [teamId, findingId]
    );
    return result.rows.length > 0;
  }

  private async storeSharedFinding(teamId: string, finding: SharedFinding): Promise<void> {
    await database.query(
      `INSERT INTO shared_findings (id, team_id, finding_id, shared_by, shared_at, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [finding.id, teamId, finding.findingId, finding.sharedBy, finding.sharedAt, finding.status]
    );
  }

  private async getTeamMembers(teamId: string): Promise<TeamMember[]> {
    try {
      const result = await database.query(
        `SELECT * FROM team_members WHERE team_id = $1`,
        [teamId]
      );
      return result.rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        status: r.status,
        assignedTasks: r.assigned_tasks || 0,
        findingsCount: r.findings_count || 0,
      }));
    } catch {
      return [];
    }
  }

  private async notifyTeam(teamId: string, notification: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO team_notifications (id, team_id, type, data, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [uuidv4(), teamId, notification.type, JSON.stringify(notification)]
      );

      // Log activity
      await database.query(
        `INSERT INTO team_activity (id, team_id, type, data, created_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)`,
        [uuidv4(), teamId, notification.type, JSON.stringify(notification)]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to notify team');
    }
  }

  private async notifyUser(userId: string, notification: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO user_notifications (id, user_id, type, data, read, created_at)
         VALUES ($1, $2, $3, $4, false, CURRENT_TIMESTAMP)`,
        [uuidv4(), userId, notification.type, JSON.stringify(notification)]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to notify user');
    }
  }
}

export default new CollaborationAgent();
