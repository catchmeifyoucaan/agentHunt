/**
 * Ingestion Layer Service
 * Handles data ingestion from multiple external sources:
 * - Shodan, ZoomEye, Censys
 * - GitHub, GitLab
 * - CT Logs
 * - Webhooks, SIEM, CI/CD
 */

import { Pool } from 'pg';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import type {
  DataSource,
  DataSourceType,
  IngestionJob,
  Asset,
  ShodanResult,
  CTLogEntry,
  GitHubSecret
} from '../../../shared/types';
import { logger } from '../logger';

export class IngestionService {
  private db: Pool;
  private connectors: Map<DataSourceType, BaseConnector>;

  constructor(db: Pool) {
    this.db = db;
    this.connectors = new Map();
    this.initializeConnectors();
  }

  private initializeConnectors() {
    this.connectors.set('shodan', new ShodanConnector());
    this.connectors.set('zoomeye', new ZoomEyeConnector());
    this.connectors.set('censys', new CensysConnector());
    this.connectors.set('github', new GitHubConnector());
    this.connectors.set('gitlab', new GitLabConnector());
    this.connectors.set('ctlogs', new CTLogsConnector());
    this.connectors.set('webhook', new WebhookConnector());
  }

  /**
   * Create a new data source
   */
  async createDataSource(source: Omit<DataSource, 'id' | 'createdAt' | 'updatedAt'>): Promise<DataSource> {
    const id = uuidv4();
    const now = new Date();

    await this.db.query(
      `INSERT INTO data_sources (id, type, name, enabled, config, sync_interval, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, source.type, source.name, source.enabled, JSON.stringify(source.config),
        source.syncInterval, JSON.stringify(source.metadata), now, now]
    );

    logger.info({ sourceId: id, type: source.type }, 'Data source created');

    return {
      ...source,
      id,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Run ingestion job for a data source
   */
  async runIngestion(sourceId: string, programId: string): Promise<IngestionJob> {
    const jobId = uuidv4();
    const source = await this.getDataSource(sourceId);

    if (!source) {
      throw new Error(`Data source ${sourceId} not found`);
    }

    if (!source.enabled) {
      throw new Error(`Data source ${sourceId} is disabled`);
    }

    // Create ingestion job
    const job: IngestionJob = {
      id: jobId,
      sourceId,
      sourceType: source.type,
      status: 'pending',
      assetsDiscovered: 0,
      assetsNew: 0,
      assetsUpdated: 0,
      createdAt: new Date()
    };

    await this.db.query(
      `INSERT INTO ingestion_jobs (id, source_id, source_type, status, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, sourceId, source.type, 'pending', job.createdAt]
    );

    // Run ingestion in background
    this.executeIngestion(job, source, programId).catch(err => {
      logger.error({ jobId, error: err.message }, 'Ingestion failed');
    });

    return job;
  }

  /**
   * Execute ingestion and normalize assets
   */
  private async executeIngestion(job: IngestionJob, source: DataSource, programId: string): Promise<void> {
    const startedAt = new Date();

    try {
      // Update status to running
      await this.db.query(
        `UPDATE ingestion_jobs SET status = 'running', started_at = $1 WHERE id = $2`,
        [startedAt, job.id]
      );

      const connector = this.connectors.get(source.type);
      if (!connector) {
        throw new Error(`No connector for source type ${source.type}`);
      }

      logger.info({ jobId: job.id, sourceType: source.type }, 'Starting ingestion');

      // Fetch data from connector
      const results = await connector.fetch(source.config);

      // Normalize and store assets
      let assetsNew = 0;
      let assetsUpdated = 0;

      for (const result of results) {
        const normalizedAsset = this.normalizeAsset(result, source.type);
        const existed = await this.upsertAsset(normalizedAsset, programId, source.name);

        if (existed) {
          assetsUpdated++;
        } else {
          assetsNew++;
        }
      }

      const completedAt = new Date();

      // Update job status
      await this.db.query(
        `UPDATE ingestion_jobs
         SET status = 'completed', completed_at = $1, assets_discovered = $2,
             assets_new = $3, assets_updated = $4
         WHERE id = $5`,
        [completedAt, results.length, assetsNew, assetsUpdated, job.id]
      );

      // Update source last_sync
      await this.db.query(
        `UPDATE data_sources SET last_sync = $1 WHERE id = $2`,
        [completedAt, source.id]
      );

      logger.info({
        jobId: job.id,
        assetsDiscovered: results.length,
        assetsNew,
        assetsUpdated,
        duration: completedAt.getTime() - startedAt.getTime()
      }, 'Ingestion completed');

    } catch (error: any) {
      logger.error({ jobId: job.id, error: error.message }, 'Ingestion failed');

      await this.db.query(
        `UPDATE ingestion_jobs SET status = 'failed', error = $1, completed_at = $2 WHERE id = $3`,
        [error.message, new Date(), job.id]
      );
    }
  }

  /**
   * Normalize external data into canonical Asset format
   */
  private normalizeAsset(data: any, sourceType: DataSourceType): Partial<Asset> {
    switch (sourceType) {
      case 'shodan':
        return this.normalizeShodanAsset(data);
      case 'ctlogs':
        return this.normalizeCTLogAsset(data);
      case 'github':
      case 'gitlab':
        return this.normalizeRepoAsset(data);
      default:
        return {
          type: 'url',
          value: data.value || data.url,
          metadata: data
        };
    }
  }

  private normalizeShodanAsset(data: ShodanResult): Partial<Asset> {
    return {
      type: 'ip',
      value: data.ip,
      metadata: {
        ipAddresses: [data.ip],
        technologies: data.metadata?.product ? [data.metadata.product] : [],
        server: data.banner?.split('\n')[0],
        tags: [`port:${data.port}`, `protocol:${data.protocol}`, `org:${data.org}`]
      }
    };
  }

  private normalizeCTLogAsset(data: CTLogEntry): Partial<Asset> {
    return {
      type: 'domain',
      value: data.domain,
      metadata: {
        certificates: [data.issuer],
        tags: [`issuer:${data.issuer}`, 'ct-log']
      }
    };
  }

  private normalizeRepoAsset(data: any): Partial<Asset> {
    return {
      type: 'url',
      value: data.repository,
      metadata: {
        tags: ['repository', data.platform]
      }
    };
  }

  /**
   * Upsert asset into database
   * Returns true if asset existed, false if new
   */
  private async upsertAsset(asset: Partial<Asset>, programId: string, source: string): Promise<boolean> {
    const existing = await this.db.query(
      `SELECT id FROM assets WHERE program_id = $1 AND value = $2 AND type = $3`,
      [programId, asset.value, asset.type]
    );

    if (existing.rows.length > 0) {
      // Update existing asset
      await this.db.query(
        `UPDATE assets
         SET last_seen = $1, source = array_append(source, $2), metadata = $3
         WHERE id = $4`,
        [new Date(), source, JSON.stringify(asset.metadata), existing.rows[0].id]
      );
      return true;
    } else {
      // Insert new asset
      await this.db.query(
        `INSERT INTO assets (id, program_id, type, value, source, metadata, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          uuidv4(),
          programId,
          asset.type,
          asset.value,
          [source],
          JSON.stringify(asset.metadata),
          new Date(),
          new Date()
        ]
      );
      return false;
    }
  }

  /**
   * Get data source by ID
   */
  private async getDataSource(id: string): Promise<DataSource | null> {
    const result = await this.db.query(
      `SELECT * FROM data_sources WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      type: row.type,
      name: row.name,
      enabled: row.enabled,
      config: row.config,
      lastSync: row.last_sync,
      syncInterval: row.sync_interval,
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  /**
   * Schedule periodic syncs for all enabled sources
   */
  async schedulePeriodicSyncs(): Promise<void> {
    const result = await this.db.query(
      `SELECT * FROM data_sources WHERE enabled = true AND sync_interval IS NOT NULL`
    );

    for (const row of result.rows) {
      const source: DataSource = {
        id: row.id,
        type: row.type,
        name: row.name,
        enabled: row.enabled,
        config: row.config,
        lastSync: row.last_sync,
        syncInterval: row.sync_interval,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };

      // Check if sync is due
      const now = new Date();
      const lastSync = source.lastSync ? new Date(source.lastSync) : new Date(0);
      const minutesSinceSync = (now.getTime() - lastSync.getTime()) / 1000 / 60;

      if (minutesSinceSync >= source.syncInterval!) {
        // Get associated program (from metadata or config)
        const programId = source.metadata.programId;
        if (programId) {
          logger.info({ sourceId: source.id }, 'Triggering periodic sync');
          this.runIngestion(source.id, programId).catch(err => {
            logger.error({ sourceId: source.id, error: err.message }, 'Periodic sync failed');
          });
        }
      }
    }
  }
}

/**
 * Base connector interface
 */
abstract class BaseConnector {
  abstract fetch(config: any): Promise<any[]>;

  protected async makeRequest(url: string, config: any): Promise<any> {
    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': config.apiKey ? `Bearer ${config.apiKey}` : undefined,
          'User-Agent': 'AgentHunt/1.0'
        },
        timeout: 30000
      });
      return response.data;
    } catch (error: any) {
      logger.error({ url, error: error.message }, 'Connector request failed');
      throw error;
    }
  }
}

/**
 * Shodan Connector
 */
class ShodanConnector extends BaseConnector {
  async fetch(config: any): Promise<ShodanResult[]> {
    const query = config.query || 'org:*';
    const url = `https://api.shodan.io/shodan/host/search?key=${config.apiKey}&query=${encodeURIComponent(query)}`;

    const data = await this.makeRequest(url, config);
    const maxResults = config.maxResults || 100;

    return (data.matches || []).slice(0, maxResults).map((match: any) => ({
      ip: match.ip_str,
      port: match.port,
      protocol: match.transport,
      banner: match.data,
      hostnames: match.hostnames || [],
      org: match.org || '',
      asn: match.asn || '',
      location: {
        city: match.location?.city,
        country: match.location?.country_name,
        latitude: match.location?.latitude,
        longitude: match.location?.longitude
      },
      vulnerabilities: match.vulns || [],
      metadata: match
    }));
  }
}

/**
 * ZoomEye Connector
 */
class ZoomEyeConnector extends BaseConnector {
  async fetch(config: any): Promise<any[]> {
    const query = config.query || '*';
    const url = `https://api.zoomeye.org/host/search?query=${encodeURIComponent(query)}`;

    const data = await this.makeRequest(url, {
      ...config,
      headers: { 'API-KEY': config.apiKey }
    });

    return (data.matches || []).map((match: any) => ({
      ip: match.ip,
      port: match.portinfo?.port,
      protocol: match.portinfo?.service,
      banner: match.portinfo?.banner,
      hostnames: match.geoinfo?.hostname ? [match.geoinfo.hostname] : [],
      org: match.geoinfo?.organization,
      metadata: match
    }));
  }
}

/**
 * Censys Connector
 */
class CensysConnector extends BaseConnector {
  async fetch(config: any): Promise<any[]> {
    const query = config.query || '*';
    const url = `https://search.censys.io/api/v2/hosts/search?q=${encodeURIComponent(query)}`;

    const data = await this.makeRequest(url, config);

    return (data.result?.hits || []).map((hit: any) => ({
      ip: hit.ip,
      services: hit.services,
      location: hit.location,
      metadata: hit
    }));
  }
}

/**
 * GitHub Connector
 */
class GitHubConnector extends BaseConnector {
  async fetch(config: any): Promise<any[]> {
    // Search for repositories or code
    const query = config.query || 'org:*';
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}`;

    const data = await this.makeRequest(url, config);

    return (data.items || []).map((repo: any) => ({
      repository: repo.full_name,
      url: repo.html_url,
      platform: 'github',
      metadata: repo
    }));
  }
}

/**
 * GitLab Connector
 */
class GitLabConnector extends BaseConnector {
  async fetch(config: any): Promise<any[]> {
    const url = config.apiUrl || 'https://gitlab.com/api/v4/projects';

    const data = await this.makeRequest(url, config);

    return (Array.isArray(data) ? data : []).map((project: any) => ({
      repository: project.path_with_namespace,
      url: project.web_url,
      platform: 'gitlab',
      metadata: project
    }));
  }
}

/**
 * Certificate Transparency Logs Connector
 */
class CTLogsConnector extends BaseConnector {
  async fetch(config: any): Promise<CTLogEntry[]> {
    const domain = config.query;
    const url = `https://crt.sh/?q=${encodeURIComponent(domain)}&output=json`;

    const data = await this.makeRequest(url, config);

    return (Array.isArray(data) ? data : []).map((entry: any) => ({
      id: entry.id?.toString(),
      domain: entry.name_value,
      issuer: entry.issuer_name,
      notBefore: new Date(entry.not_before),
      notAfter: new Date(entry.not_after),
      subjectAltNames: entry.name_value?.split('\n') || [],
      logSource: 'crt.sh',
      discoveredAt: new Date()
    }));
  }
}

/**
 * Webhook Connector (passive receiver)
 */
class WebhookConnector extends BaseConnector {
  async fetch(config: any): Promise<any[]> {
    // Webhooks are passive - data is pushed to us
    // This method is for manual pulls if supported
    return [];
  }
}
