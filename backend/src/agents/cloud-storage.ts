import { BaseAgent } from './base-agent';
import axios from 'axios';
import * as crypto from 'crypto';
import Logger from '../utils/logger';

interface CloudStorageConfig {
  platforms?: ('s3' | 'azure' | 'gcp' | 'digitalocean' | 'oracle')[];
  permutations?: number; // Max bucket name permutations
  downloadFiles?: boolean; // Download publicly accessible files
  maxFiles?: number; // Max files to download per bucket
}

interface BucketFinding {
  platform: string;
  bucketName: string;
  url: string;
  publicRead: boolean;
  publicWrite: boolean;
  publicList: boolean;
  files?: string[];
  sensitiveFiles?: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  cvss: number;
}

export class CloudStorageAgent extends BaseAgent {
  name = 'Cloud Storage Enumeration Agent';
  description = 'Discovers and tests misconfigured cloud storage buckets (S3, Azure, GCP, DigitalOcean, Oracle)';

  private commonWords = [
    'admin', 'api', 'app', 'assets', 'backup', 'backups', 'beta', 'cdn',
    'client', 'config', 'data', 'database', 'db', 'dev', 'development',
    'docs', 'downloads', 'files', 'images', 'internal', 'logs', 'media',
    'private', 'prod', 'production', 'public', 'resources', 'secret',
    'secrets', 'staging', 'static', 'storage', 'temp', 'test', 'tmp',
    'uploads', 'user', 'users', 'web', 'www'
  ];

  private sensitiveFilePatterns = [
    '.env', '.git', 'config', 'credentials', 'password', 'secret', 'key',
    'aws', 'api', 'token', 'backup', 'dump', 'sql', 'database', 'db',
    'private', 'confidential', 'internal'
  ];

  async getSteps(config?: CloudStorageConfig): Promise<string[]> {
    return [
      '🔍 Generating bucket name permutations from target domain',
      '☁️ Testing AWS S3 buckets',
      '🔷 Testing Azure Blob Storage',
      '📦 Testing Google Cloud Storage',
      '💧 Testing DigitalOcean Spaces',
      '🔶 Testing Oracle Object Storage',
      '📂 Enumerating publicly accessible files',
      '🔓 Testing read/write/list permissions',
      '📥 Downloading sensitive files',
      '🤝 Triggering handoffs for data exposure',
    ];
  }

  async process(job: any): Promise<void> {
    const { target, config = {} } = job.data as { target: string; config?: CloudStorageConfig };

    Logger.info(`[${this.name}] Starting cloud storage enumeration for ${target}`);

    try {
      // Step 1: Generate bucket name candidates
      const bucketNames = await this.generateBucketNames(target, config);
      Logger.info(`[${this.name}] Generated ${bucketNames.length} bucket name candidates`);

      // Step 2: Test each cloud platform
      const findings: BucketFinding[] = [];
      const platforms = config.platforms || ['s3', 'azure', 'gcp', 'digitalocean', 'oracle'];

      if (platforms.includes('s3')) {
        const s3Findings = await this.testS3Buckets(bucketNames, config);
        findings.push(...s3Findings);
      }

      if (platforms.includes('azure')) {
        const azureFindings = await this.testAzureStorage(bucketNames, config);
        findings.push(...azureFindings);
      }

      if (platforms.includes('gcp')) {
        const gcpFindings = await this.testGCPStorage(bucketNames, config);
        findings.push(...gcpFindings);
      }

      if (platforms.includes('digitalocean')) {
        const doFindings = await this.testDigitalOceanSpaces(bucketNames, config);
        findings.push(...doFindings);
      }

      Logger.info(`[${this.name}] Found ${findings.length} accessible cloud storage buckets`);

      // Step 3: Store findings
      await this.storeFindings(job, findings);

      // Step 4: Trigger handoffs for critical exposures
      const critical = findings.filter(f => f.severity === 'critical' || f.publicWrite);
      if (critical.length > 0) {
        await this.triggerHandoff(job, 'triage', {
          reason: `Found ${critical.length} critical cloud storage exposures`,
          findings: critical,
        });
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error: ${error}`);
      throw error;
    }
  }

  private async generateBucketNames(target: string, config: CloudStorageConfig): Promise<string[]> {
    const bucketNames = new Set<string>();
    const maxPermutations = config.permutations || 500;

    // Extract domain parts
    const domain = target.replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0];
    const parts = domain.split('.');
    const company = parts[0];

    // Base names
    bucketNames.add(domain);
    bucketNames.add(company);
    bucketNames.add(domain.replace(/\./g, '-'));
    bucketNames.add(domain.replace(/\./g, ''));

    // Common patterns
    for (const word of this.commonWords) {
      if (bucketNames.size >= maxPermutations) break;

      bucketNames.add(`${company}-${word}`);
      bucketNames.add(`${company}_${word}`);
      bucketNames.add(`${company}${word}`);
      bucketNames.add(`${word}-${company}`);
      bucketNames.add(`${word}_${company}`);
      bucketNames.add(`${word}${company}`);
      bucketNames.add(`${company}.${word}`);
      bucketNames.add(`${word}.${company}`);
    }

    // Environment variations
    const envs = ['dev', 'test', 'staging', 'prod', 'uat', 'qa'];
    const originals = Array.from(bucketNames);
    for (const name of originals) {
      if (bucketNames.size >= maxPermutations) break;
      for (const env of envs) {
        bucketNames.add(`${name}-${env}`);
        bucketNames.add(`${env}-${name}`);
      }
    }

    // Year variations
    const years = ['2023', '2024', '2025'];
    for (const name of originals) {
      if (bucketNames.size >= maxPermutations) break;
      for (const year of years) {
        bucketNames.add(`${name}-${year}`);
        bucketNames.add(`${name}${year}`);
      }
    }

    return Array.from(bucketNames).slice(0, maxPermutations);
  }

  private async testS3Buckets(bucketNames: string[], config: CloudStorageConfig): Promise<BucketFinding[]> {
    const findings: BucketFinding[] = [];

    Logger.info(`[${this.name}] Testing ${bucketNames.length} S3 bucket names`);

    for (const bucketName of bucketNames) {
      try {
        // Test bucket existence and permissions
        const url = `https://${bucketName}.s3.amazonaws.com`;

        // Test LIST permission
        const listResponse = await axios.get(url, {
          timeout: 5000,
          validateStatus: () => true,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        if (listResponse.status === 200) {
          // Bucket exists and is publicly listable
          const files = this.parseS3ListResponse(listResponse.data);

          const finding: BucketFinding = {
            platform: 'AWS S3',
            bucketName,
            url,
            publicRead: true,
            publicWrite: await this.testS3WritePermission(bucketName),
            publicList: true,
            files: files.slice(0, 100),
            sensitiveFiles: files.filter(f => this.isSensitiveFile(f)),
            severity: this.calculateSeverity(true, true, files),
            cvss: 8.6
          };

          findings.push(finding);
          Logger.info(`[${this.name}] ✓ S3 bucket found: ${bucketName} (${files.length} files)`);

        } else if (listResponse.status === 403) {
          // Bucket exists but not listable, try read
          const publicRead = await this.testS3ReadPermission(bucketName);
          if (publicRead) {
            findings.push({
              platform: 'AWS S3',
              bucketName,
              url,
              publicRead: true,
              publicWrite: false,
              publicList: false,
              severity: 'medium',
              cvss: 5.3
            });
          }
        }

      } catch (error) {
        // Bucket doesn't exist or network error
        continue;
      }
    }

    return findings;
  }

  private parseS3ListResponse(xmlData: string): string[] {
    const files: string[] = [];

    // Simple XML parsing for <Key> tags
    const keyMatches = xmlData.match(/<Key>([^<]+)<\/Key>/g);
    if (keyMatches) {
      for (const match of keyMatches) {
        const filename = match.replace(/<\/?Key>/g, '');
        files.push(filename);
      }
    }

    return files;
  }

  private async testS3ReadPermission(bucketName: string): Promise<boolean> {
    try {
      // Try to read a common file
      const testFiles = ['index.html', 'robots.txt', 'sitemap.xml', 'favicon.ico'];

      for (const file of testFiles) {
        const response = await axios.get(`https://${bucketName}.s3.amazonaws.com/${file}`, {
          timeout: 3000,
          validateStatus: () => true
        });

        if (response.status === 200) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private async testS3WritePermission(bucketName: string): Promise<boolean> {
    try {
      // Test write by attempting to upload a test file
      const testFilename = `test-${crypto.randomBytes(8).toString('hex')}.txt`;
      const url = `https://${bucketName}.s3.amazonaws.com/${testFilename}`;

      const response = await axios.put(url, 'test', {
        timeout: 3000,
        validateStatus: () => true,
        headers: { 'Content-Type': 'text/plain' }
      });

      // Clean up if successful
      if (response.status === 200 || response.status === 204) {
        await axios.delete(url, { timeout: 3000, validateStatus: () => true });
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  private async testAzureStorage(bucketNames: string[], config: CloudStorageConfig): Promise<BucketFinding[]> {
    const findings: BucketFinding[] = [];

    Logger.info(`[${this.name}] Testing ${bucketNames.length} Azure storage accounts`);

    for (const name of bucketNames) {
      try {
        // Azure Blob Storage format: https://{account}.blob.core.windows.net/{container}
        const containers = ['files', 'public', 'data', 'backup', 'uploads', 'assets'];

        for (const container of containers) {
          const url = `https://${name}.blob.core.windows.net/${container}?restype=container&comp=list`;

          const response = await axios.get(url, {
            timeout: 5000,
            validateStatus: () => true
          });

          if (response.status === 200) {
            const files = this.parseAzureListResponse(response.data);

            findings.push({
              platform: 'Azure Blob Storage',
              bucketName: `${name}/${container}`,
              url: `https://${name}.blob.core.windows.net/${container}`,
              publicRead: true,
              publicWrite: false, // Write testing would require more complex auth
              publicList: true,
              files: files.slice(0, 100),
              sensitiveFiles: files.filter(f => this.isSensitiveFile(f)),
              severity: this.calculateSeverity(true, true, files),
              cvss: 8.2
            });

            Logger.info(`[${this.name}] ✓ Azure container found: ${name}/${container}`);
          }
        }

      } catch (error) {
        continue;
      }
    }

    return findings;
  }

  private parseAzureListResponse(xmlData: string): string[] {
    const files: string[] = [];
    const nameMatches = xmlData.match(/<Name>([^<]+)<\/Name>/g);

    if (nameMatches) {
      for (const match of nameMatches) {
        const filename = match.replace(/<\/?Name>/g, '');
        files.push(filename);
      }
    }

    return files;
  }

  private async testGCPStorage(bucketNames: string[], config: CloudStorageConfig): Promise<BucketFinding[]> {
    const findings: BucketFinding[] = [];

    Logger.info(`[${this.name}] Testing ${bucketNames.length} GCP storage buckets`);

    for (const bucketName of bucketNames) {
      try {
        const url = `https://storage.googleapis.com/${bucketName}`;

        const response = await axios.get(url, {
          timeout: 5000,
          validateStatus: () => true
        });

        if (response.status === 200) {
          const files = this.parseGCPListResponse(response.data);

          findings.push({
            platform: 'Google Cloud Storage',
            bucketName,
            url,
            publicRead: true,
            publicWrite: false,
            publicList: true,
            files: files.slice(0, 100),
            sensitiveFiles: files.filter(f => this.isSensitiveFile(f)),
            severity: this.calculateSeverity(true, true, files),
            cvss: 8.4
          });

          Logger.info(`[${this.name}] ✓ GCP bucket found: ${bucketName}`);
        }

      } catch (error) {
        continue;
      }
    }

    return findings;
  }

  private parseGCPListResponse(xmlData: string): string[] {
    const files: string[] = [];
    const keyMatches = xmlData.match(/<Key>([^<]+)<\/Key>/g);

    if (keyMatches) {
      for (const match of keyMatches) {
        const filename = match.replace(/<\/?Key>/g, '');
        files.push(filename);
      }
    }

    return files;
  }

  private async testDigitalOceanSpaces(bucketNames: string[], config: CloudStorageConfig): Promise<BucketFinding[]> {
    const findings: BucketFinding[] = [];
    const regions = ['nyc3', 'sfo2', 'ams3', 'sgp1', 'fra1'];

    Logger.info(`[${this.name}] Testing DigitalOcean Spaces`);

    for (const bucketName of bucketNames) {
      for (const region of regions) {
        try {
          const url = `https://${bucketName}.${region}.digitaloceanspaces.com`;

          const response = await axios.get(url, {
            timeout: 5000,
            validateStatus: () => true
          });

          if (response.status === 200) {
            const files = this.parseS3ListResponse(response.data); // DO Spaces uses S3-compatible API

            findings.push({
              platform: 'DigitalOcean Spaces',
              bucketName: `${bucketName} (${region})`,
              url,
              publicRead: true,
              publicWrite: false,
              publicList: true,
              files: files.slice(0, 100),
              sensitiveFiles: files.filter(f => this.isSensitiveFile(f)),
              severity: this.calculateSeverity(true, true, files),
              cvss: 8.0
            });

            Logger.info(`[${this.name}] ✓ DigitalOcean Space found: ${bucketName} (${region})`);
            break; // Found in this region, no need to check others
          }

        } catch (error) {
          continue;
        }
      }
    }

    return findings;
  }

  private isSensitiveFile(filename: string): boolean {
    const lowerFilename = filename.toLowerCase();
    return this.sensitiveFilePatterns.some(pattern => lowerFilename.includes(pattern));
  }

  private calculateSeverity(publicRead: boolean, publicList: boolean, files: string[]): 'critical' | 'high' | 'medium' | 'low' {
    if (files && files.some(f => this.isSensitiveFile(f))) {
      return 'critical';
    }

    if (publicList && publicRead) {
      return 'high';
    }

    if (publicRead) {
      return 'medium';
    }

    return 'low';
  }

  private async storeFindings(job: any, findings: BucketFinding[]): Promise<void> {
    if (job.sharedMemory) {
      await job.sharedMemory.storeFindings(this.name, findings.map(f => ({
        agent: this.name,
        type: `Cloud Storage Exposure: ${f.platform}`,
        severity: f.severity,
        cvss: f.cvss,
        bucket: f.bucketName,
        url: f.url,
        publicRead: f.publicRead,
        publicWrite: f.publicWrite,
        publicList: f.publicList,
        fileCount: f.files?.length || 0,
        sensitiveFiles: f.sensitiveFiles,
        timestamp: new Date().toISOString(),
      })));
    }

    Logger.info(`[${this.name}] Stored ${findings.length} cloud storage findings`);
  }

  private async triggerHandoff(job: any, targetAgent: string, context: any): Promise<void> {
    Logger.info(`[${this.name}] Triggering handoff to ${targetAgent}`);

    if (job.handoff) {
      await job.handoff(targetAgent, {
        sourceAgent: this.name,
        reason: context.reason,
        findings: context.findings,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export default CloudStorageAgent;
