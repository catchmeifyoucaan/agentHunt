import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import config from '../config';
import logger from '../utils/logger';
import { Readable } from 'stream';

class StorageService {
  private static instance: StorageService;
  private s3Client: S3Client;
  private bucket: string;

  private constructor() {
    this.s3Client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
      forcePathStyle: true, // Required for MinIO
    });

    this.bucket = config.s3.bucket;
    logger.info({ bucket: this.bucket }, 'Storage service initialized');
  }

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService();
    }
    return StorageService.instance;
  }

  /**
   * Upload data to S3
   */
  public async upload(
    key: string,
    data: Buffer | string | Readable,
    metadata?: Record<string, string>
  ): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        Metadata: metadata,
      });

      await this.s3Client.send(command);
      logger.debug({ key, bucket: this.bucket }, 'File uploaded to S3');

      return `s3://${this.bucket}/${key}`;
    } catch (error) {
      logger.error({ error, key }, 'Failed to upload to S3');
      throw error;
    }
  }

  /**
   * Upload JSON object
   */
  public async uploadJson(key: string, data: any, metadata?: Record<string, string>): Promise<string> {
    const jsonString = JSON.stringify(data, null, 2);
    return this.upload(key, jsonString, {
      ...metadata,
      'content-type': 'application/json',
    });
  }

  /**
   * Upload text file
   */
  public async uploadText(key: string, text: string, metadata?: Record<string, string>): Promise<string> {
    return this.upload(key, text, {
      ...metadata,
      'content-type': 'text/plain',
    });
  }

  /**
   * Download file from S3
   */
  public async download(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const stream = response.Body as Readable;

      return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } catch (error) {
      logger.error({ error, key }, 'Failed to download from S3');
      throw error;
    }
  }

  /**
   * Download and parse JSON
   */
  public async downloadJson<T = any>(key: string): Promise<T> {
    const buffer = await this.download(key);
    return JSON.parse(buffer.toString('utf-8'));
  }

  /**
   * Download text file
   */
  public async downloadText(key: string): Promise<string> {
    const buffer = await this.download(key);
    return buffer.toString('utf-8');
  }

  /**
   * Delete file from S3
   */
  public async delete(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      await this.s3Client.send(command);
      logger.debug({ key }, 'File deleted from S3');
    } catch (error) {
      logger.error({ error, key }, 'Failed to delete from S3');
      throw error;
    }
  }

  /**
   * Generate presigned URL for download
   */
  public async getPresignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const url = await getSignedUrl(this.s3Client, command, { expiresIn });
      return url;
    } catch (error) {
      logger.error({ error, key }, 'Failed to generate presigned URL');
      throw error;
    }
  }

  /**
   * Generate S3 key with timestamp and program
   */
  public generateKey(programId: string, type: string, filename: string): string {
    const timestamp = Date.now();
    return `${programId}/${type}/${timestamp}_${filename}`;
  }

  /**
   * Parse S3 URI to key (also accepts plain keys without s3:// prefix)
   */
  public parseS3Uri(uri: string): string {
    // If already a plain key (no s3:// prefix), return as-is
    if (!uri.startsWith('s3://')) {
      return uri;
    }
    
    // Parse s3:// URI
    const match = uri.match(/^s3:\/\/[^/]+\/(.+)$/);
    if (!match) {
      throw new Error(`Invalid S3 URI: ${uri}`);
    }
    return match[1];
  }
}

export default StorageService.getInstance();
