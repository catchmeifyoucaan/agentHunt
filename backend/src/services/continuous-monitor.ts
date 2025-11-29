/**
 * Continuous Monitoring Service
 * Tracks target changes over time and triggers scans when new assets are discovered
 *
 * Features:
 * - Periodic subdomain discovery (daily/weekly)
 * - Diff detection: new subdomains, new URLs, new technologies
 * - Automatic scan triggering on changes
 * - Change history tracking
 * - Alerting on significant changes
 */

import database from './database';
import queue from './queue';
import logger from '../utils/logger';
import { EventEmitter } from 'events';

interface MonitoringConfig {
  programId: string;
  frequency: 'hourly' | 'daily' | 'weekly' | 'monthly';
  enabled: boolean;
  targets: {
    domains: string[];
    monitorSubdomains: boolean;
    monitorUrls: boolean;
    monitorTech: boolean;
    monitorPorts: boolean;
  };
  alertOn: {
    newSubdomains: boolean;
    newUrls: boolean;
    newTechnologies: boolean;
    newPorts: boolean;
    configChanges: boolean; // DNS, SSL cert changes
  };
  autoScan: boolean; // Automatically trigger scans on changes
}

interface ChangeDetection {
  programId: string;
  timestamp: Date;
  changeType:
    | 'new_subdomain'
    | 'new_url'
    | 'new_technology'
    | 'new_port'
    | 'config_change'
    | 'asset_removed';
  changes: {
    added: string[];
    removed: string[];
    modified: string[];
  };
  significance: 'low' | 'medium' | 'high' | 'critical';
  autoScanTriggered: boolean;
  scanJobId?: string;
}

class ContinuousMonitor extends EventEmitter {
  private monitors: Map<string, MonitoringConfig> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  constructor() {
    super();
    this.loadMonitorsFromDatabase();
  }

  /**
   * Start the continuous monitoring service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Continuous monitor already running');
      return;
    }

    this.isRunning = true;
    logger.info('Starting continuous monitoring service');

    // Load monitors from database
    await this.loadMonitorsFromDatabase();

    // Start monitoring for all enabled programs
    for (const [programId, config] of this.monitors.entries()) {
      if (config.enabled) {
        await this.startMonitoring(programId);
      }
    }

    logger.info({ activeMonitors: this.intervals.size }, 'Continuous monitoring started');
  }

  /**
   * Stop the continuous monitoring service
   */
  async stop(): Promise<void> {
    logger.info('Stopping continuous monitoring service');

    // Clear all intervals
    for (const [programId, interval] of this.intervals.entries()) {
      clearInterval(interval);
      logger.debug({ programId }, 'Stopped monitoring');
    }

    this.intervals.clear();
    this.isRunning = false;

    logger.info('Continuous monitoring stopped');
  }

  /**
   * Add or update monitoring configuration for a program
   */
  async addMonitor(config: MonitoringConfig): Promise<void> {
    const { programId } = config;

    // Store in database
    await database.query(
      `INSERT INTO monitoring_configs (program_id, config, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (program_id)
       DO UPDATE SET config = $2, updated_at = NOW()`,
      [programId, JSON.stringify(config)]
    );

    // Add to memory
    this.monitors.set(programId, config);

    // Start monitoring if enabled
    if (config.enabled) {
      await this.startMonitoring(programId);
    }

    logger.info({ programId, frequency: config.frequency }, 'Monitor added/updated');
  }

  /**
   * Remove monitoring for a program
   */
  async removeMonitor(programId: string): Promise<void> {
    // Stop monitoring
    await this.stopMonitoring(programId);

    // Remove from database
    await database.query('DELETE FROM monitoring_configs WHERE program_id = $1', [programId]);

    // Remove from memory
    this.monitors.delete(programId);

    logger.info({ programId }, 'Monitor removed');
  }

  /**
   * Get monitoring status for a program
   */
  getMonitorStatus(programId: string): {
    enabled: boolean;
    frequency: string;
    lastCheck?: Date;
    nextCheck?: Date;
    changesDetected: number;
  } | null {
    const config = this.monitors.get(programId);
    if (!config) return null;

    const interval = this.intervals.get(programId);

    return {
      enabled: config.enabled,
      frequency: config.frequency,
      lastCheck: undefined, // Would track this in database
      nextCheck: undefined, // Would calculate based on frequency
      changesDetected: 0, // Would query from change_history table
    };
  }

  /**
   * Load monitors from database
   */
  private async loadMonitorsFromDatabase(): Promise<void> {
    try {
      const result = await database.query(
        "SELECT program_id, config FROM monitoring_configs WHERE config->>'enabled' = 'true'"
      );

      for (const row of result.rows) {
        const config = JSON.parse(row.config) as MonitoringConfig;
        this.monitors.set(row.program_id, config);
      }

      logger.info({ monitorsLoaded: this.monitors.size }, 'Monitors loaded from database');
    } catch (error) {
      logger.error({ error }, 'Failed to load monitors from database');
    }
  }

  /**
   * Start monitoring for a specific program
   */
  private async startMonitoring(programId: string): Promise<void> {
    const config = this.monitors.get(programId);
    if (!config) {
      logger.warn({ programId }, 'No config found for program');
      return;
    }

    // Stop existing interval if any
    await this.stopMonitoring(programId);

    // Calculate interval in milliseconds
    const intervalMs = this.getIntervalMs(config.frequency);

    // Create new interval
    const interval = setInterval(async () => {
      await this.checkForChanges(programId);
    }, intervalMs);

    this.intervals.set(programId, interval);

    // Run initial check immediately
    await this.checkForChanges(programId);

    logger.info({ programId, frequency: config.frequency, intervalMs }, 'Started monitoring');
  }

  /**
   * Stop monitoring for a specific program
   */
  private async stopMonitoring(programId: string): Promise<void> {
    const interval = this.intervals.get(programId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(programId);
      logger.debug({ programId }, 'Stopped monitoring');
    }
  }

  /**
   * Check for changes in a program's assets
   */
  private async checkForChanges(programId: string): Promise<void> {
    const config = this.monitors.get(programId);
    if (!config) return;

    logger.debug({ programId }, 'Checking for changes');

    try {
      const changes: ChangeDetection = {
        programId,
        timestamp: new Date(),
        changeType: 'new_subdomain',
        changes: {
          added: [],
          removed: [],
          modified: [],
        },
        significance: 'low',
        autoScanTriggered: false,
      };

      // 1. Check for new subdomains
      if (config.targets.monitorSubdomains) {
        const newSubdomains = await this.detectNewSubdomains(programId, config.targets.domains);
        changes.changes.added.push(...newSubdomains);
      }

      // 2. Check for new URLs (if enabled)
      if (config.targets.monitorUrls) {
        const newUrls = await this.detectNewUrls(programId);
        changes.changes.added.push(...newUrls);
      }

      // 3. Check for technology changes
      if (config.targets.monitorTech) {
        const newTech = await this.detectNewTechnologies(programId);
        changes.changes.added.push(...newTech);
      }

      // 4. Check for new open ports
      if (config.targets.monitorPorts) {
        const newPorts = await this.detectNewPorts(programId);
        changes.changes.added.push(...newPorts);
      }

      // Calculate significance
      changes.significance = this.calculateSignificance(changes);

      // If changes detected
      if (changes.changes.added.length > 0 || changes.changes.removed.length > 0) {
        logger.info(
          {
            programId,
            added: changes.changes.added.length,
            removed: changes.changes.removed.length,
            significance: changes.significance,
          },
          '🔍 Changes detected'
        );

        // Store change history
        await this.storeChangeHistory(changes);

        // Emit event
        this.emit('changes-detected', changes);

        // Trigger auto-scan if enabled
        if (config.autoScan && changes.changes.added.length > 0) {
          const scanJobId = await this.triggerAutoScan(programId, changes);
          changes.autoScanTriggered = true;
          changes.scanJobId = scanJobId;

          logger.info(
            { programId, scanJobId, newAssets: changes.changes.added.length },
            '🚀 Auto-scan triggered'
          );
        }

        // Send alert if configured
        if (this.shouldAlert(config, changes)) {
          await this.sendAlert(programId, changes);
        }
      } else {
        logger.debug({ programId }, 'No changes detected');
      }
    } catch (error) {
      logger.error({ error, programId }, 'Error checking for changes');
    }
  }

  /**
   * Detect new subdomains
   */
  private async detectNewSubdomains(programId: string, domains: string[]): Promise<string[]> {
    // Run lightweight discovery (chaosdb + subfinder only)
    const jobId = `monitor-${programId}-${Date.now()}`;

    try {
      const discoveryJob = await queue.addJob('discovery', {
        id: jobId,
        type: 'discovery',
        programId,
        priority: 5,
        status: 'pending',
        attempts: 0,
        maxAttempts: 2,
        options: {
          sources: ['chaosdb', 'subfinder'], // Fast sources only
          maxAssets: 10000,
        },
        metadata: {
          requestedBy: 'continuous-monitor',
          monitoringCheck: true,
        },
        createdAt: new Date(),
      });

      // Wait for completion (with timeout)
      const result = await this.waitForJob(jobId, 300000); // 5 min timeout

      // Get current subdomains from database
      const currentSubdomains = await database.query(
        'SELECT value FROM assets WHERE program_id = $1 AND type = $2',
        [programId, 'subdomain']
      );

      const currentSet = new Set(currentSubdomains.rows.map((r) => r.value));
      const newSet = new Set(result.subdomains || []);

      // Find new subdomains (in newSet but not in currentSet)
      const newSubdomains = Array.from(newSet).filter((s) => !currentSet.has(s));

      return newSubdomains;
    } catch (error) {
      logger.error({ error, programId }, 'Failed to detect new subdomains');
      return [];
    }
  }

  /**
   * Detect new URLs
   */
  private async detectNewUrls(programId: string): Promise<string[]> {
    // Implementation: Compare current URL assets with previous snapshot
    // For brevity, returning empty array (would implement similar to detectNewSubdomains)
    return [];
  }

  /**
   * Detect new technologies
   */
  private async detectNewTechnologies(programId: string): Promise<string[]> {
    // Implementation: Compare technology fingerprints
    return [];
  }

  /**
   * Detect new open ports
   */
  private async detectNewPorts(programId: string): Promise<string[]> {
    // Implementation: Compare port scan results
    return [];
  }

  /**
   * Calculate significance of changes
   */
  private calculateSignificance(changes: ChangeDetection): 'low' | 'medium' | 'high' | 'critical' {
    const totalChanges = changes.changes.added.length + changes.changes.removed.length;

    if (totalChanges === 0) return 'low';
    if (totalChanges < 5) return 'low';
    if (totalChanges < 20) return 'medium';
    if (totalChanges < 50) return 'high';
    return 'critical';
  }

  /**
   * Store change history in database
   */
  private async storeChangeHistory(changes: ChangeDetection): Promise<void> {
    await database.query(
      `INSERT INTO change_history (program_id, timestamp, change_type, changes, significance, auto_scan_triggered, scan_job_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        changes.programId,
        changes.timestamp,
        changes.changeType,
        JSON.stringify(changes.changes),
        changes.significance,
        changes.autoScanTriggered,
        changes.scanJobId,
      ]
    );
  }

  /**
   * Trigger auto-scan on new assets
   */
  private async triggerAutoScan(programId: string, changes: ChangeDetection): Promise<string> {
    const jobId = `autoscan-${programId}-${Date.now()}`;

    // Trigger fingerprint → scan pipeline for new assets
    await queue.addJob('fingerprint', {
      id: jobId,
      type: 'fingerprint',
      programId,
      priority: 7,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
      options: {
        assets: changes.changes.added,
        tools: ['dnsx', 'httpx'],
        followRedirects: true,
        concurrency: 100,
      },
      metadata: {
        requestedBy: 'continuous-monitor',
        triggeredBy: 'change-detection',
        changeSignificance: changes.significance,
      },
      createdAt: new Date(),
    });

    return jobId;
  }

  /**
   * Determine if alert should be sent
   */
  private shouldAlert(config: MonitoringConfig, changes: ChangeDetection): boolean {
    if (changes.significance === 'critical') return true;
    if (changes.significance === 'high' && changes.changes.added.length > 10) return true;

    // Check specific alert rules
    if (config.alertOn.newSubdomains && changes.changes.added.length > 0) return true;

    return false;
  }

  /**
   * Send alert notification
   */
  private async sendAlert(programId: string, changes: ChangeDetection): Promise<void> {
    logger.info({ programId, changes }, '📧 Sending change alert');
    // Would integrate with notification service (email, Slack, etc.)
    this.emit('alert', { programId, changes });
  }

  /**
   * Wait for job completion
   */
  private async waitForJob(jobId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Job ${jobId} timed out`));
      }, timeoutMs);

      const checkInterval = setInterval(async () => {
        try {
          const job = await database.query('SELECT status, result FROM jobs WHERE id = $1', [
            jobId,
          ]);
          if (job.rows.length > 0) {
            const { status, result } = job.rows[0];
            if (status === 'completed') {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              resolve(result);
            } else if (status === 'failed') {
              clearInterval(checkInterval);
              clearTimeout(timeout);
              reject(new Error(`Job ${jobId} failed`));
            }
          }
        } catch (error) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          reject(error);
        }
      }, 2000); // Check every 2 seconds
    });
  }

  /**
   * Get interval in milliseconds from frequency
   */
  private getIntervalMs(frequency: 'hourly' | 'daily' | 'weekly' | 'monthly'): number {
    switch (frequency) {
      case 'hourly':
        return 60 * 60 * 1000; // 1 hour
      case 'daily':
        return 24 * 60 * 60 * 1000; // 24 hours
      case 'weekly':
        return 7 * 24 * 60 * 60 * 1000; // 7 days
      case 'monthly':
        return 30 * 24 * 60 * 60 * 1000; // 30 days
      default:
        return 24 * 60 * 60 * 1000; // Default: daily
    }
  }

  /**
   * Get all active monitors
   */
  getActiveMonitors(): Array<{ programId: string; config: MonitoringConfig }> {
    return Array.from(this.monitors.entries()).map(([programId, config]) => ({
      programId,
      config,
    }));
  }

  /**
   * Get change history for a program
   */
  async getChangeHistory(programId: string, limit: number = 50): Promise<ChangeDetection[]> {
    const result = await database.query(
      `SELECT * FROM change_history
       WHERE program_id = $1
       ORDER BY timestamp DESC
       LIMIT $2`,
      [programId, limit]
    );

    return result.rows.map((row) => ({
      programId: row.program_id,
      timestamp: row.timestamp,
      changeType: row.change_type,
      changes: row.changes,
      significance: row.significance,
      autoScanTriggered: row.auto_scan_triggered,
      scanJobId: row.scan_job_id,
    }));
  }
}

// Singleton instance
const continuousMonitor = new ContinuousMonitor();

export default continuousMonitor;
export { MonitoringConfig, ChangeDetection };
