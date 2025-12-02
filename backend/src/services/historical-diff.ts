/**
 * Historical Comparison Service
 * Tracks changes in assets, findings, and attack surface over time
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import database from './database';
import events from './events';

export interface Snapshot {
  id: string;
  programId: string;
  type: 'assets' | 'findings' | 'full';
  data: SnapshotData;
  metadata: {
    assetCount: number;
    findingCount: number;
    subdomainCount: number;
    urlCount: number;
    portCount: number;
  };
  createdAt: Date;
}

export interface SnapshotData {
  assets: AssetSnapshot[];
  findings: FindingSnapshot[];
  subdomains: string[];
  urls: string[];
  openPorts: PortSnapshot[];
  technologies: TechSnapshot[];
}

export interface AssetSnapshot {
  id: string;
  type: string;
  value: string;
  status: string;
  metadata?: Record<string, any>;
}

export interface FindingSnapshot {
  id: string;
  title: string;
  severity: string;
  status: string;
  assetValue: string;
}

export interface PortSnapshot {
  host: string;
  port: number;
  service?: string;
  version?: string;
}

export interface TechSnapshot {
  host: string;
  technology: string;
  version?: string;
  category?: string;
}

export interface DiffResult {
  snapshotA: string;
  snapshotB: string;
  programId: string;
  timestamp: Date;
  summary: DiffSummary;
  changes: {
    assets: DiffChanges<AssetSnapshot>;
    findings: DiffChanges<FindingSnapshot>;
    subdomains: DiffChanges<string>;
    urls: DiffChanges<string>;
    ports: DiffChanges<PortSnapshot>;
    technologies: DiffChanges<TechSnapshot>;
  };
}

export interface DiffSummary {
  totalChanges: number;
  newAssets: number;
  removedAssets: number;
  newFindings: number;
  resolvedFindings: number;
  newSubdomains: number;
  removedSubdomains: number;
  newUrls: number;
  removedUrls: number;
  newPorts: number;
  closedPorts: number;
  newTechnologies: number;
  removedTechnologies: number;
  riskDelta: number; // Positive = more risk, negative = less risk
}

export interface DiffChanges<T> {
  added: T[];
  removed: T[];
  modified: Array<{ before: T; after: T; changes: string[] }>;
}

class HistoricalDiffService {
  private static instance: HistoricalDiffService;

  private constructor() {}

  public static getInstance(): HistoricalDiffService {
    if (!HistoricalDiffService.instance) {
      HistoricalDiffService.instance = new HistoricalDiffService();
    }
    return HistoricalDiffService.instance;
  }

  /**
   * Create a snapshot of current program state
   */
  public async createSnapshot(
    programId: string,
    type: Snapshot['type'] = 'full'
  ): Promise<Snapshot> {
    const id = uuidv4();
    const now = new Date();

    logger.info({ programId, type }, 'Creating program snapshot');

    // Gather current state
    const data = await this.gatherSnapshotData(programId, type);

    const snapshot: Snapshot = {
      id,
      programId,
      type,
      data,
      metadata: {
        assetCount: data.assets.length,
        findingCount: data.findings.length,
        subdomainCount: data.subdomains.length,
        urlCount: data.urls.length,
        portCount: data.openPorts.length,
      },
      createdAt: now,
    };

    // Store snapshot
    await database.query(
      `INSERT INTO snapshots (id, program_id, type, data, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        programId,
        type,
        JSON.stringify(data),
        JSON.stringify(snapshot.metadata),
        now,
      ]
    );

    logger.info(
      {
        snapshotId: id,
        programId,
        assetCount: snapshot.metadata.assetCount,
        findingCount: snapshot.metadata.findingCount,
      },
      'Snapshot created'
    );

    return snapshot;
  }

  /**
   * Get snapshot by ID
   */
  public async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    const result = await database.query(
      `SELECT * FROM snapshots WHERE id = $1`,
      [snapshotId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      programId: row.program_id,
      type: row.type,
      data: row.data,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  /**
   * Get latest snapshot for a program
   */
  public async getLatestSnapshot(programId: string): Promise<Snapshot | null> {
    const result = await database.query(
      `SELECT * FROM snapshots WHERE program_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [programId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      programId: row.program_id,
      type: row.type,
      data: row.data,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  /**
   * List snapshots for a program
   */
  public async listSnapshots(
    programId: string,
    limit: number = 10
  ): Promise<Array<Omit<Snapshot, 'data'>>> {
    const result = await database.query(
      `SELECT id, program_id, type, metadata, created_at
       FROM snapshots WHERE program_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [programId, limit]
    );

    return result.rows.map((row) => ({
      id: row.id,
      programId: row.program_id,
      type: row.type,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }

  /**
   * Compare two snapshots
   */
  public async compareSnapshots(
    snapshotIdA: string,
    snapshotIdB: string
  ): Promise<DiffResult> {
    const [snapshotA, snapshotB] = await Promise.all([
      this.getSnapshot(snapshotIdA),
      this.getSnapshot(snapshotIdB),
    ]);

    if (!snapshotA || !snapshotB) {
      throw new Error('One or both snapshots not found');
    }

    if (snapshotA.programId !== snapshotB.programId) {
      throw new Error('Snapshots must be from the same program');
    }

    logger.info(
      { snapshotA: snapshotIdA, snapshotB: snapshotIdB },
      'Comparing snapshots'
    );

    const changes = {
      assets: this.diffAssets(snapshotA.data.assets, snapshotB.data.assets),
      findings: this.diffFindings(snapshotA.data.findings, snapshotB.data.findings),
      subdomains: this.diffStrings(snapshotA.data.subdomains, snapshotB.data.subdomains),
      urls: this.diffStrings(snapshotA.data.urls, snapshotB.data.urls),
      ports: this.diffPorts(snapshotA.data.openPorts, snapshotB.data.openPorts),
      technologies: this.diffTechnologies(
        snapshotA.data.technologies,
        snapshotB.data.technologies
      ),
    };

    const summary = this.calculateSummary(changes);

    return {
      snapshotA: snapshotIdA,
      snapshotB: snapshotIdB,
      programId: snapshotA.programId,
      timestamp: new Date(),
      summary,
      changes,
    };
  }

  /**
   * Compare current state with latest snapshot
   */
  public async compareWithLatest(programId: string): Promise<DiffResult | null> {
    const latestSnapshot = await this.getLatestSnapshot(programId);
    if (!latestSnapshot) {
      return null;
    }

    // Create a temporary current snapshot
    const currentSnapshot = await this.createSnapshot(programId);

    return this.compareSnapshots(latestSnapshot.id, currentSnapshot.id);
  }

  /**
   * Get change history for a program
   */
  public async getChangeHistory(
    programId: string,
    days: number = 30
  ): Promise<Array<{ date: Date; changes: DiffSummary }>> {
    const snapshots = await database.query(
      `SELECT id, created_at FROM snapshots
       WHERE program_id = $1 AND created_at > NOW() - INTERVAL '${days} days'
       ORDER BY created_at ASC`,
      [programId]
    );

    if (snapshots.rows.length < 2) {
      return [];
    }

    const history: Array<{ date: Date; changes: DiffSummary }> = [];

    for (let i = 1; i < snapshots.rows.length; i++) {
      const diff = await this.compareSnapshots(
        snapshots.rows[i - 1].id,
        snapshots.rows[i].id
      );

      history.push({
        date: snapshots.rows[i].created_at,
        changes: diff.summary,
      });
    }

    return history;
  }

  /**
   * Detect significant changes and emit alerts
   */
  public async detectSignificantChanges(
    programId: string
  ): Promise<{
    hasSignificantChanges: boolean;
    alerts: string[];
  }> {
    const diff = await this.compareWithLatest(programId);
    if (!diff) {
      return { hasSignificantChanges: false, alerts: [] };
    }

    const alerts: string[] = [];

    // Check for significant changes
    if (diff.summary.newSubdomains > 10) {
      alerts.push(`${diff.summary.newSubdomains} new subdomains discovered`);
    }

    if (diff.summary.newFindings > 0) {
      alerts.push(`${diff.summary.newFindings} new vulnerabilities found`);
    }

    if (diff.summary.newPorts > 5) {
      alerts.push(`${diff.summary.newPorts} new open ports detected`);
    }

    if (diff.summary.riskDelta > 10) {
      alerts.push(`Risk score increased by ${diff.summary.riskDelta} points`);
    }

    // Check for removed assets (might indicate issues)
    if (diff.summary.removedSubdomains > 20) {
      alerts.push(
        `${diff.summary.removedSubdomains} subdomains no longer resolving (possible takeover opportunity)`
      );
    }

    // Log significant changes (events service will handle broadcasting)
    if (alerts.length > 0) {
      logger.info({
        event: 'significant-changes-detected',
        programId,
        alerts,
        diff: diff.summary,
      }, 'Significant changes detected in program');
    }

    return {
      hasSignificantChanges: alerts.length > 0,
      alerts,
    };
  }

  /**
   * Schedule automatic snapshots
   */
  public async scheduleAutoSnapshot(
    programId: string,
    intervalHours: number = 24
  ): Promise<void> {
    // Store schedule in database
    await database.query(
      `INSERT INTO snapshot_schedules (program_id, interval_hours, next_run, enabled)
       VALUES ($1, $2, NOW() + INTERVAL '${intervalHours} hours', true)
       ON CONFLICT (program_id) DO UPDATE SET
         interval_hours = $2,
         next_run = NOW() + INTERVAL '${intervalHours} hours',
         enabled = true`,
      [programId, intervalHours]
    );

    logger.info({ programId, intervalHours }, 'Auto-snapshot scheduled');
  }

  // ============ Private Methods ============

  private async gatherSnapshotData(
    programId: string,
    type: Snapshot['type']
  ): Promise<SnapshotData> {
    const data: SnapshotData = {
      assets: [],
      findings: [],
      subdomains: [],
      urls: [],
      openPorts: [],
      technologies: [],
    };

    if (type === 'assets' || type === 'full') {
      // Get assets
      const assetsResult = await database.query(
        `SELECT id, type, value, status, metadata FROM assets WHERE program_id = $1`,
        [programId]
      );
      data.assets = assetsResult.rows.map((row) => ({
        id: row.id,
        type: row.type,
        value: row.value,
        status: row.status,
        metadata: row.metadata,
      }));

      // Extract subdomains
      data.subdomains = data.assets
        .filter((a) => a.type === 'subdomain' || a.type === 'domain')
        .map((a) => a.value);

      // Extract URLs
      data.urls = data.assets.filter((a) => a.type === 'url').map((a) => a.value);

      // Get open ports from metadata
      for (const asset of data.assets) {
        if (asset.metadata?.ports) {
          for (const port of asset.metadata.ports) {
            data.openPorts.push({
              host: asset.value,
              port: port.port,
              service: port.service,
              version: port.version,
            });
          }
        }

        // Get technologies
        if (asset.metadata?.technologies) {
          for (const tech of asset.metadata.technologies) {
            data.technologies.push({
              host: asset.value,
              technology: tech.name || tech,
              version: tech.version,
              category: tech.category,
            });
          }
        }
      }
    }

    if (type === 'findings' || type === 'full') {
      // Get findings
      const findingsResult = await database.query(
        `SELECT f.id, f.title, f.severity, f.status, a.value as asset_value
         FROM findings f
         LEFT JOIN assets a ON f.asset_id = a.id
         WHERE f.program_id = $1`,
        [programId]
      );
      data.findings = findingsResult.rows.map((row) => ({
        id: row.id,
        title: row.title,
        severity: row.severity,
        status: row.status,
        assetValue: row.asset_value,
      }));
    }

    return data;
  }

  private diffAssets(
    before: AssetSnapshot[],
    after: AssetSnapshot[]
  ): DiffChanges<AssetSnapshot> {
    const beforeMap = new Map(before.map((a) => [a.value, a]));
    const afterMap = new Map(after.map((a) => [a.value, a]));

    const added: AssetSnapshot[] = [];
    const removed: AssetSnapshot[] = [];
    const modified: Array<{ before: AssetSnapshot; after: AssetSnapshot; changes: string[] }> = [];

    // Find added and modified
    for (const [value, asset] of afterMap) {
      const beforeAsset = beforeMap.get(value);
      if (!beforeAsset) {
        added.push(asset);
      } else if (beforeAsset.status !== asset.status) {
        modified.push({
          before: beforeAsset,
          after: asset,
          changes: [`status: ${beforeAsset.status} → ${asset.status}`],
        });
      }
    }

    // Find removed
    for (const [value, asset] of beforeMap) {
      if (!afterMap.has(value)) {
        removed.push(asset);
      }
    }

    return { added, removed, modified };
  }

  private diffFindings(
    before: FindingSnapshot[],
    after: FindingSnapshot[]
  ): DiffChanges<FindingSnapshot> {
    const beforeMap = new Map(before.map((f) => [f.id, f]));
    const afterMap = new Map(after.map((f) => [f.id, f]));

    const added: FindingSnapshot[] = [];
    const removed: FindingSnapshot[] = [];
    const modified: Array<{
      before: FindingSnapshot;
      after: FindingSnapshot;
      changes: string[];
    }> = [];

    for (const [id, finding] of afterMap) {
      const beforeFinding = beforeMap.get(id);
      if (!beforeFinding) {
        added.push(finding);
      } else {
        const changes: string[] = [];
        if (beforeFinding.status !== finding.status) {
          changes.push(`status: ${beforeFinding.status} → ${finding.status}`);
        }
        if (beforeFinding.severity !== finding.severity) {
          changes.push(`severity: ${beforeFinding.severity} → ${finding.severity}`);
        }
        if (changes.length > 0) {
          modified.push({ before: beforeFinding, after: finding, changes });
        }
      }
    }

    for (const [id, finding] of beforeMap) {
      if (!afterMap.has(id)) {
        removed.push(finding);
      }
    }

    return { added, removed, modified };
  }

  private diffStrings(before: string[], after: string[]): DiffChanges<string> {
    const beforeSet = new Set(before);
    const afterSet = new Set(after);

    return {
      added: after.filter((s) => !beforeSet.has(s)),
      removed: before.filter((s) => !afterSet.has(s)),
      modified: [],
    };
  }

  private diffPorts(
    before: PortSnapshot[],
    after: PortSnapshot[]
  ): DiffChanges<PortSnapshot> {
    const key = (p: PortSnapshot) => `${p.host}:${p.port}`;
    const beforeMap = new Map(before.map((p) => [key(p), p]));
    const afterMap = new Map(after.map((p) => [key(p), p]));

    const added: PortSnapshot[] = [];
    const removed: PortSnapshot[] = [];
    const modified: Array<{ before: PortSnapshot; after: PortSnapshot; changes: string[] }> = [];

    for (const [k, port] of afterMap) {
      const beforePort = beforeMap.get(k);
      if (!beforePort) {
        added.push(port);
      } else if (beforePort.service !== port.service || beforePort.version !== port.version) {
        modified.push({
          before: beforePort,
          after: port,
          changes: [
            beforePort.service !== port.service
              ? `service: ${beforePort.service} → ${port.service}`
              : '',
            beforePort.version !== port.version
              ? `version: ${beforePort.version} → ${port.version}`
              : '',
          ].filter(Boolean),
        });
      }
    }

    for (const [k, port] of beforeMap) {
      if (!afterMap.has(k)) {
        removed.push(port);
      }
    }

    return { added, removed, modified };
  }

  private diffTechnologies(
    before: TechSnapshot[],
    after: TechSnapshot[]
  ): DiffChanges<TechSnapshot> {
    const key = (t: TechSnapshot) => `${t.host}:${t.technology}`;
    const beforeMap = new Map(before.map((t) => [key(t), t]));
    const afterMap = new Map(after.map((t) => [key(t), t]));

    return {
      added: after.filter((t) => !beforeMap.has(key(t))),
      removed: before.filter((t) => !afterMap.has(key(t))),
      modified: [],
    };
  }

  private calculateSummary(changes: DiffResult['changes']): DiffSummary {
    const severityScore: Record<string, number> = {
      critical: 10,
      high: 7,
      medium: 4,
      low: 1,
      info: 0,
    };

    // Calculate risk delta from findings
    let riskDelta = 0;
    for (const finding of changes.findings.added) {
      riskDelta += severityScore[finding.severity] || 0;
    }
    for (const finding of changes.findings.removed) {
      riskDelta -= severityScore[finding.severity] || 0;
    }

    // Add risk for new open ports
    riskDelta += changes.ports.added.length * 2;

    return {
      totalChanges:
        changes.assets.added.length +
        changes.assets.removed.length +
        changes.findings.added.length +
        changes.findings.removed.length +
        changes.subdomains.added.length +
        changes.subdomains.removed.length +
        changes.urls.added.length +
        changes.urls.removed.length +
        changes.ports.added.length +
        changes.ports.removed.length +
        changes.technologies.added.length +
        changes.technologies.removed.length,
      newAssets: changes.assets.added.length,
      removedAssets: changes.assets.removed.length,
      newFindings: changes.findings.added.length,
      resolvedFindings: changes.findings.removed.length,
      newSubdomains: changes.subdomains.added.length,
      removedSubdomains: changes.subdomains.removed.length,
      newUrls: changes.urls.added.length,
      removedUrls: changes.urls.removed.length,
      newPorts: changes.ports.added.length,
      closedPorts: changes.ports.removed.length,
      newTechnologies: changes.technologies.added.length,
      removedTechnologies: changes.technologies.removed.length,
      riskDelta,
    };
  }

  /**
   * Delete old snapshots to save space
   */
  public async cleanupOldSnapshots(
    programId: string,
    keepCount: number = 30
  ): Promise<number> {
    const result = await database.query(
      `DELETE FROM snapshots
       WHERE program_id = $1
       AND id NOT IN (
         SELECT id FROM snapshots
         WHERE program_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       )
       RETURNING id`,
      [programId, keepCount]
    );

    const deleted = result.rows.length;
    if (deleted > 0) {
      logger.info({ programId, deleted }, 'Old snapshots cleaned up');
    }

    return deleted;
  }
}

export default HistoricalDiffService.getInstance();
