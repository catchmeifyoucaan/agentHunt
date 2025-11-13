import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';

export interface CloudMisconfigJob extends BaseJob {
  programId: string;
  domain: string;
  keywords: string[];
  options: {
    testS3?: boolean;
    testAzure?: boolean;
    testGCP?: boolean;
    testDigitalOcean?: boolean;
    testCloudflare?: boolean;
    permutations?: 'normal' | 'deep' | 'none';
    checkPublicAccess?: boolean;
    checkVersioning?: boolean;
    checkEncryption?: boolean;
    threads?: number;
  };
}

export interface CloudMisconfigResult {
  s3Buckets: Array<CloudBucket>;
  azureBlobs: Array<CloudBucket>;
  gcpBuckets: Array<CloudBucket>;
  digitalOceanSpaces: Array<CloudBucket>;
  cloudflareR2: Array<CloudBucket>;
  statistics: {
    totalBucketsFound: number;
    publicBuckets: number;
    listableBuckets: number;
    writableBuckets: number;
  };
}

export interface CloudBucket {
  provider: 'aws' | 'azure' | 'gcp' | 'digitalocean' | 'cloudflare';
  name: string;
  url: string;
  region?: string;
  exists: boolean;
  public: boolean;
  listable: boolean;
  writable: boolean;
  versioningEnabled?: boolean;
  encryptionEnabled?: boolean;
  files?: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  findings: string[];
}

/**
 * Cloud Misconfiguration Scanner Agent
 *
 * Features:
 * - AWS S3 bucket discovery and testing
 * - Azure Blob storage discovery
 * - GCP Cloud Storage bucket testing
 * - DigitalOcean Spaces detection
 * - Cloudflare R2 storage testing
 * - Public access detection
 * - Bucket listing capabilities
 * - Write permission testing
 * - Versioning and encryption checks
 * - Intelligent permutation generation
 */
export class CloudMisconfigAgent extends BaseAgent<CloudMisconfigJob> {
  constructor() {
    super('cloudmisconfig' as any);
  }
  protected getSteps() {
    return [
      {
            name: "Load cloud targets",
            metadata: {}
      },
      {
            name: "Scan for misconfigurations",
            metadata: {}
      },
      {
            name: "Validate findings",
            metadata: {}
      },
      {
            name: "Store cloud security issues",
            metadata: {}
      }
];
  }


  async process(job: Job<CloudMisconfigJob>): Promise<CloudMisconfigResult> {
    const { programId, domain, keywords, options } = job.data;

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'cloudmisconfig',
      'start',
      'info',
      `Starting cloud misconfiguration scan for ${domain}`
    );

    const result: CloudMisconfigResult = {
      s3Buckets: [],
      azureBlobs: [],
      gcpBuckets: [],
      digitalOceanSpaces: [],
      cloudflareR2: [],
      statistics: {
        totalBucketsFound: 0,
        publicBuckets: 0,
        listableBuckets: 0,
        writableBuckets: 0,
      },
    };

    try {
      // Generate bucket name candidates
      const candidates = this.generateBucketNames(domain, keywords, options.permutations || 'normal');

      // Test AWS S3 buckets
      if (options.testS3 !== false) {
        await this.logExecution(job.id, programId, 's3scanner', 'start', 'info', 'Scanning AWS S3 buckets');
        result.s3Buckets = await this.scanS3Buckets(candidates, options, job.id, programId);
      }

      // Test Azure Blob storage
      if (options.testAzure !== false) {
        await this.logExecution(job.id, programId, 'azure-scanner', 'start', 'info', 'Scanning Azure Blob storage');
        result.azureBlobs = await this.scanAzureBlobs(candidates, options, job.id, programId);
      }

      // Test GCP buckets
      if (options.testGCP !== false) {
        await this.logExecution(job.id, programId, 'gcp-scanner', 'start', 'info', 'Scanning GCP Cloud Storage');
        result.gcpBuckets = await this.scanGCPBuckets(candidates, options, job.id, programId);
      }

      // Test DigitalOcean Spaces
      if (options.testDigitalOcean !== false) {
        await this.logExecution(job.id, programId, 'do-scanner', 'start', 'info', 'Scanning DigitalOcean Spaces');
        result.digitalOceanSpaces = await this.scanDOSpaces(candidates, options, job.id, programId);
      }

      // Calculate statistics
      const allBuckets = [
        ...result.s3Buckets,
        ...result.azureBlobs,
        ...result.gcpBuckets,
        ...result.digitalOceanSpaces,
        ...result.cloudflareR2,
      ];

      result.statistics.totalBucketsFound = allBuckets.filter(b => b.exists).length;
      result.statistics.publicBuckets = allBuckets.filter(b => b.public).length;
      result.statistics.listableBuckets = allBuckets.filter(b => b.listable).length;
      result.statistics.writableBuckets = allBuckets.filter(b => b.writable).length;

      // Save findings
      await this.saveCloudFindings(programId, allBuckets);

      await this.logExecution(
        job.id,
        programId,
        'cloudmisconfig',
        'complete',
        'info',
        `Cloud scan complete: ${result.statistics.totalBucketsFound} buckets found, ${result.statistics.publicBuckets} public`
      );

      await this.updateJobStatus(job.id, 'completed', result);
      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'cloudmisconfig', 'error', 'error', error.message);
      await this.updateJobStatus(job.id, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Generate bucket name candidates
   */
  private generateBucketNames(domain: string, keywords: string[], permutation: 'normal' | 'deep' | 'none'): string[] {
    const candidates = new Set<string>();

    // Extract base domain parts
    const domainParts = domain.replace(/\./g, '-').split('-');
    const baseDomain = domain.split('.')[0];

    // Basic candidates
    candidates.add(domain);
    candidates.add(domain.replace(/\./g, '-'));
    candidates.add(domain.replace(/\./g, ''));
    candidates.add(baseDomain);

    // Add keywords
    keywords.forEach(keyword => {
      candidates.add(keyword);
      candidates.add(`${keyword}-${baseDomain}`);
      candidates.add(`${baseDomain}-${keyword}`);
    });

    if (permutation === 'none') {
      return Array.from(candidates);
    }

    // Normal permutations
    const suffixes = ['backup', 'dev', 'prod', 'staging', 'test', 'assets', 'images', 'files', 'data', 'public', 'private', 'uploads'];
    const prefixes = ['my', 'the', 'our', 'app', 'api', 'web', 'www'];

    suffixes.forEach(suffix => {
      candidates.add(`${baseDomain}-${suffix}`);
      candidates.add(`${baseDomain}${suffix}`);
      candidates.add(`${suffix}-${baseDomain}`);
    });

    prefixes.forEach(prefix => {
      candidates.add(`${prefix}-${baseDomain}`);
      candidates.add(`${prefix}${baseDomain}`);
    });

    if (permutation === 'deep') {
      // Deep permutations
      const years = ['2020', '2021', '2022', '2023', '2024'];
      const environments = ['production', 'development', 'testing', 'qa', 'uat'];

      years.forEach(year => {
        candidates.add(`${baseDomain}-${year}`);
        candidates.add(`${baseDomain}${year}`);
      });

      environments.forEach(env => {
        candidates.add(`${baseDomain}-${env}`);
        candidates.add(`${env}-${baseDomain}`);
      });

      // Combine domain parts
      for (let i = 0; i < domainParts.length - 1; i++) {
        candidates.add(domainParts.slice(0, i + 1).join('-'));
        candidates.add(domainParts.slice(i).join('-'));
      }
    }

    logger.info({ count: candidates.size, permutation }, 'Bucket name candidates generated');
    return Array.from(candidates);
  }

  /**
   * Scan AWS S3 buckets
   */
  private async scanS3Buckets(
    candidates: string[],
    options: CloudMisconfigJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<CloudBucket>> {
    const buckets: Array<CloudBucket> = [];

    try {
      const regions = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'];

      for (const name of candidates.slice(0, 500)) {
        if (await this.shouldCancel(jobId)) break;

        const bucket: CloudBucket = {
          provider: 'aws',
          name,
          url: `https://${name}.s3.amazonaws.com`,
          exists: false,
          public: false,
          listable: false,
          writable: false,
          findings: [],
          severity: 'low',
        };

        // Check if bucket exists
        const checkCmd = `curl -s -o /dev/null -w "%{http_code}" "https://${name}.s3.amazonaws.com" --max-time 5 || echo "000"`;
        const { stdout: statusCode } = await this.executeCommand(checkCmd, { timeout: 10000 });

        if (statusCode.trim() === '200' || statusCode.trim() === '403') {
          bucket.exists = true;

          // Try to list bucket contents
          const listCmd = `aws s3 ls s3://${name} --no-sign-request --region us-east-1 2>&1 || echo "AccessDenied"`;
          const { stdout: listOutput } = await this.executeCommand(listCmd, { timeout: 15000 });

          if (!listOutput.includes('AccessDenied') && !listOutput.includes('NoSuchBucket')) {
            bucket.listable = true;
            bucket.public = true;
            bucket.severity = 'high';
            bucket.findings.push('Bucket is publicly listable');

            // Extract file list
            const files = listOutput.split('\n')
              .filter(line => line.trim() && !line.includes('PRE'))
              .map(line => line.split(/\s+/).pop())
              .filter(Boolean)
              .slice(0, 20);

            if (files.length > 0) {
              bucket.files = files as string[];
            }
          }

          // Test write permissions
          if (options.checkPublicAccess !== false) {
            const testFile = `test-${Date.now()}.txt`;
            const writeCmd = `echo "test" | aws s3 cp - s3://${name}/${testFile} --no-sign-request 2>&1 || echo "AccessDenied"`;
            const { stdout: writeOutput } = await this.executeCommand(writeCmd, { timeout: 15000 });

            if (!writeOutput.includes('AccessDenied') && !writeOutput.includes('error')) {
              bucket.writable = true;
              bucket.severity = 'critical';
              bucket.findings.push('Bucket is publicly writable');

              // Clean up test file
              await this.executeCommand(`aws s3 rm s3://${name}/${testFile} --no-sign-request 2>&1`, { timeout: 10000 });
            }
          }

          buckets.push(bucket);
          logger.info({ name, public: bucket.public, listable: bucket.listable }, 'S3 bucket found');
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.info({ count: buckets.length }, 'S3 bucket scan complete');
      return buckets;
    } catch (error: any) {
      logger.error({ error: error.message }, 'S3 bucket scan failed');
      return buckets;
    }
  }

  /**
   * Scan Azure Blob storage
   */
  private async scanAzureBlobs(
    candidates: string[],
    options: CloudMisconfigJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<CloudBucket>> {
    const blobs: Array<CloudBucket> = [];

    try {
      for (const name of candidates.slice(0, 300)) {
        if (await this.shouldCancel(jobId)) break;

        const blob: CloudBucket = {
          provider: 'azure',
          name,
          url: `https://${name}.blob.core.windows.net`,
          exists: false,
          public: false,
          listable: false,
          writable: false,
          findings: [],
          severity: 'low',
        };

        // Check if blob exists
        const checkCmd = `curl -s -o /dev/null -w "%{http_code}" "${blob.url}" --max-time 5 || echo "000"`;
        const { stdout: statusCode } = await this.executeCommand(checkCmd, { timeout: 10000 });

        if (statusCode.trim() !== '000' && statusCode.trim() !== '404') {
          blob.exists = true;

          // Try to list containers
          const listCmd = `curl -s "${blob.url}?comp=list" --max-time 10 || echo ""`;
          const { stdout: listOutput } = await this.executeCommand(listCmd, { timeout: 15000 });

          if (listOutput.includes('<Containers>') || listOutput.includes('<Container>')) {
            blob.listable = true;
            blob.public = true;
            blob.severity = 'high';
            blob.findings.push('Azure Blob storage is publicly listable');
          }

          blobs.push(blob);
          logger.info({ name, public: blob.public }, 'Azure Blob found');
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.info({ count: blobs.length }, 'Azure Blob scan complete');
      return blobs;
    } catch (error: any) {
      logger.error({ error: error.message }, 'Azure Blob scan failed');
      return blobs;
    }
  }

  /**
   * Scan GCP Cloud Storage buckets
   */
  private async scanGCPBuckets(
    candidates: string[],
    options: CloudMisconfigJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<CloudBucket>> {
    const buckets: Array<CloudBucket> = [];

    try {
      for (const name of candidates.slice(0, 300)) {
        if (await this.shouldCancel(jobId)) break;

        const bucket: CloudBucket = {
          provider: 'gcp',
          name,
          url: `https://storage.googleapis.com/${name}`,
          exists: false,
          public: false,
          listable: false,
          writable: false,
          findings: [],
          severity: 'low',
        };

        // Check if bucket exists
        const checkCmd = `curl -s -o /dev/null -w "%{http_code}" "${bucket.url}" --max-time 5 || echo "000"`;
        const { stdout: statusCode } = await this.executeCommand(checkCmd, { timeout: 10000 });

        if (statusCode.trim() === '200' || statusCode.trim() === '403') {
          bucket.exists = true;

          // Try to list bucket
          const listCmd = `curl -s "${bucket.url}" --max-time 10 || echo ""`;
          const { stdout: listOutput } = await this.executeCommand(listCmd, { timeout: 15000 });

          if (listOutput.includes('<Contents>') || listOutput.includes('<Name>')) {
            bucket.listable = true;
            bucket.public = true;
            bucket.severity = 'high';
            bucket.findings.push('GCP bucket is publicly listable');

            // Extract files
            const fileMatches = listOutput.match(/<Key>([^<]+)<\/Key>/g);
            if (fileMatches) {
              bucket.files = fileMatches.slice(0, 20).map(m => m.replace(/<\/?Key>/g, ''));
            }
          }

          buckets.push(bucket);
          logger.info({ name, public: bucket.public }, 'GCP bucket found');
        }

        await new Promise(resolve => setTimeout(resolve, 50));
      }

      logger.info({ count: buckets.length }, 'GCP bucket scan complete');
      return buckets;
    } catch (error: any) {
      logger.error({ error: error.message }, 'GCP bucket scan failed');
      return buckets;
    }
  }

  /**
   * Scan DigitalOcean Spaces
   */
  private async scanDOSpaces(
    candidates: string[],
    options: CloudMisconfigJob['options'],
    jobId: string,
    programId: string
  ): Promise<Array<CloudBucket>> {
    const spaces: Array<CloudBucket> = [];

    try {
      const regions = ['nyc3', 'sfo2', 'ams3', 'sgp1', 'fra1'];

      for (const name of candidates.slice(0, 200)) {
        if (await this.shouldCancel(jobId)) break;

        for (const region of regions) {
          const space: CloudBucket = {
            provider: 'digitalocean',
            name,
            url: `https://${name}.${region}.digitaloceanspaces.com`,
            region,
            exists: false,
            public: false,
            listable: false,
            writable: false,
            findings: [],
            severity: 'low',
          };

          // Check if space exists
          const checkCmd = `curl -s -o /dev/null -w "%{http_code}" "${space.url}" --max-time 5 || echo "000"`;
          const { stdout: statusCode } = await this.executeCommand(checkCmd, { timeout: 10000 });

          if (statusCode.trim() === '200' || statusCode.trim() === '403') {
            space.exists = true;

            // Try to list space
            const listCmd = `curl -s "${space.url}" --max-time 10 || echo ""`;
            const { stdout: listOutput } = await this.executeCommand(listCmd, { timeout: 15000 });

            if (listOutput.includes('<ListBucketResult>')) {
              space.listable = true;
              space.public = true;
              space.severity = 'high';
              space.findings.push('DigitalOcean Space is publicly listable');
            }

            spaces.push(space);
            logger.info({ name, region, public: space.public }, 'DO Space found');
            break; // Stop checking other regions once found
          }

          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      logger.info({ count: spaces.length }, 'DigitalOcean Spaces scan complete');
      return spaces;
    } catch (error: any) {
      logger.error({ error: error.message }, 'DO Spaces scan failed');
      return spaces;
    }
  }

  /**
   * Save cloud misconfiguration findings to database
   */
  private async saveCloudFindings(programId: string, buckets: Array<CloudBucket>): Promise<void> {
    try {
      const existingBuckets = buckets.filter(b => b.exists);
      if (existingBuckets.length > 0) {
        try {
          const { batchInsertAssets } = require('../utils/batch-insert');
          const assetsToInsert = existingBuckets.map((bucket) => ({
            programId,
            type: 'cloud-storage',
            value: bucket.url,
            source: bucket.provider,
            status: 'active',
            metadata: {
              provider: bucket.provider,
              name: bucket.name,
              region: bucket.region,
              public: bucket.public,
              listable: bucket.listable,
              writable: bucket.writable,
            },
          }));
          await batchInsertAssets(assetsToInsert);
        } catch (error) {
          logger.error({ error, count: existingBuckets.length }, 'Failed to batch save cloud buckets, using fallback');
          // Fallback to individual inserts
          for (const bucket of existingBuckets) {
            try {
              await database.query(
                `INSERT INTO assets (program_id, type, value, source, status, metadata)
                 VALUES ($1, 'cloud-storage', $2, $3, 'active', $4)
                 ON CONFLICT (program_id, type, value) DO UPDATE
                 SET metadata = $4`,
                [
                  programId,
                  bucket.url,
                  [bucket.provider],
                  JSON.stringify({
                    provider: bucket.provider,
                    name: bucket.name,
                    region: bucket.region,
                    public: bucket.public,
                    listable: bucket.listable,
                    writable: bucket.writable,
                  }),
                ]
              );
            } catch (err) {
              logger.error({ error: err, bucket: bucket.url }, 'Failed to save cloud bucket (fallback)');
            }
          }
        }
      }

      // Process findings for public/writable buckets
      for (const bucket of existingBuckets) {

        // Save misconfiguration as finding if public/writable
        if (bucket.public || bucket.writable) {
          const title = bucket.writable
            ? `Critical: Publicly Writable ${bucket.provider.toUpperCase()} Bucket`
            : `High: Publicly Accessible ${bucket.provider.toUpperCase()} Bucket`;

          const description = `${bucket.provider.toUpperCase()} storage bucket "${bucket.name}" is ${bucket.writable ? 'publicly writable' : 'publicly accessible'}. ${bucket.findings.join('. ')}`;

          await database.query(
            `INSERT INTO findings (
              program_id, title, description, severity, confidence, status,
              evidence, tags
            ) VALUES ($1, $2, $3, $4, $5, 'new', $6, $7)
            ON CONFLICT DO NOTHING`,
            [
              programId,
              title,
              description,
              bucket.severity,
              1.0,
              JSON.stringify([
                { type: 'log', content: `URL: ${bucket.url}` },
                { type: 'log', content: `Provider: ${bucket.provider}` },
                { type: 'log', content: `Public: ${bucket.public}, Listable: ${bucket.listable}, Writable: ${bucket.writable}` },
                ...(bucket.files ? [{ type: 'log', content: `Sample files: ${bucket.files.slice(0, 5).join(', ')}` }] : []),
              ]),
              ['cloud', bucket.provider, 'misconfiguration', bucket.writable ? 'writable' : 'public'],
            ]
          );

          await events.emitFinding({
            programId,
            severity: bucket.severity,
            title,
            url: bucket.url,
          } as any);
        }
      }

      logger.info({ count: buckets.length, programId }, 'Cloud findings saved');
    } catch (error: any) {
      logger.error({ error: error.message, programId }, 'Failed to save cloud findings');
    }
  }
}
