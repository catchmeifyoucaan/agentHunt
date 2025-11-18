/**
 * Agent Topology API
 * Provides real-time agent graph visualization data
 */

import { Router } from 'express';
import database from '../../services/database';
import queue from '../../services/queue';
import logger from '../../utils/logger';

const router = Router();

/**
 * Get agent topology (nodes and connections)
 */
router.get('/', async (req, res) => {
  try {
    // Get agent health data
    const healthResult = await database.query(`
      SELECT
        agent_type,
        MAX(last_heartbeat) as last_heartbeat,
        COUNT(*) as instance_count,
        AVG(queue_depth) as avg_queue_depth,
        SUM(jobs_processed_24h) as total_jobs_24h
      FROM agent_health
      WHERE last_heartbeat > NOW() - INTERVAL '5 minutes'
      GROUP BY agent_type
    `);

    // Get handoff relationships
    const handoffResult = await database.query(`
      SELECT DISTINCT
        from_agent_type,
        to_agent_type,
        COUNT(*) as handoff_count
      FROM rich_handoffs
      WHERE created_at > NOW() - INTERVAL '1 hour'
      GROUP BY from_agent_type, to_agent_type
    `);

    // Map to agent nodes
    const agentTypes = [
      'manager', 'discovery', 'subdomain', 'bruteforce', 'fingerprint',
      'crawl', 'portscan', 'scanner', 'interact', 'confirm',
      'triage', 'osint', 'xss', 'sqli', 'webvulns', 'jsanalysis',
      'cloudmisconfig', 'three-agent'
    ];

    const healthMap = new Map(
      healthResult.rows.map((row: any) => [row.agent_type, row])
    );

    const agents = agentTypes.map(type => {
      const health = healthMap.get(type) as any;
      const lastHeartbeat = health?.last_heartbeat ? new Date(health.last_heartbeat) : null;
      const isActive = lastHeartbeat && (Date.now() - lastHeartbeat.getTime()) < 60000; // Active if heartbeat within 1 minute

      return {
        id: `${type}-001`,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)} Agent`,
        type,
        status: isActive ? 'active' : health ? 'idle' : 'offline',
        jobsProcessed: health?.total_jobs_24h || 0,
        lastHeartbeat: lastHeartbeat || new Date(Date.now() - 300000), // 5 minutes ago if no data
        connections: [], // Will be populated from handoffs
        capacity: 100,
        currentLoad: health?.avg_queue_depth || 0,
        version: '1.0.0'
      };
    });

    // Build connections from handoffs
    const connections = handoffResult.rows.map((row: any, index: number) => ({
      id: `c${index}`,
      from: `${row.from_agent_type}-001`,
      to: `${row.to_agent_type}-001`,
      type: 'handoff',
      active: row.handoff_count > 0
    }));

    // Add static coordination connections (manager coordinates others)
    if (agents.find(a => a.type === 'manager')) {
      const managerConnections = ['discovery', 'scanner', 'triage'].map((type, idx) => ({
        id: `manager-${idx}`,
        from: 'manager-001',
        to: `${type}-001`,
        type: 'coordination' as const,
        active: true
      }));
      connections.push(...managerConnections);
    }

    // Update agent connections based on edges
    connections.forEach(conn => {
      const fromAgent = agents.find(a => a.id === conn.from);
      if (fromAgent && !fromAgent.connections.includes(conn.to)) {
        fromAgent.connections.push(conn.to);
      }
    });

    res.json({
      agents,
      connections,
      lastUpdated: new Date()
    });

  } catch (error: any) {
    logger.error({ error }, 'Failed to fetch agent topology');
    res.status(500).json({ error: error.message });
  }
});

export default router;
