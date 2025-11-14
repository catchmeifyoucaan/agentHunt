/**
 * Docker Manager - Manages Docker container lifecycle for sandboxes
 * Creates, starts, stops, and cleans up containers
 */

import Docker from 'dockerode';
import { DockerContainer, SandboxConfig, SandboxCleanupPolicy, SandboxLanguage } from './types';
import logger from '../../utils/logger';

export class DockerManager {
  private docker: Docker;
  private containers: Map<string, DockerContainer> = new Map();
  private cleanupPolicy: SandboxCleanupPolicy;
  private cleanupInterval?: NodeJS.Timer;

  // Image names for each language
  private readonly imageMap: Record<SandboxLanguage, string> = {
    python: 'agenthunt-sandbox-python:latest',
    node: 'agenthunt-sandbox-node:latest',
    go: 'agenthunt-sandbox-go:latest',
    bash: 'agenthunt-sandbox-bash:latest',
    ruby: 'agenthunt-sandbox-ruby:latest',
  };

  constructor(cleanupPolicy?: Partial<SandboxCleanupPolicy>) {
    this.docker = new Docker();

    this.cleanupPolicy = {
      maxIdleTimeMs: cleanupPolicy?.maxIdleTimeMs || 300000, // 5 minutes
      maxContainerAge: cleanupPolicy?.maxContainerAge || 3600000, // 1 hour
      maxTotalContainers: cleanupPolicy?.maxTotalContainers || 50,
      cleanupOnExit: cleanupPolicy?.cleanupOnExit ?? true,
      cleanupFailedContainers: cleanupPolicy?.cleanupFailedContainers ?? true,
      persistentContainerTTL: cleanupPolicy?.persistentContainerTTL || 86400000, // 24 hours
    };

    // Start cleanup interval
    this.startCleanupInterval();

    // Cleanup on process exit
    if (this.cleanupPolicy.cleanupOnExit) {
      process.on('SIGINT', () => this.cleanupAll());
      process.on('SIGTERM', () => this.cleanupAll());
      process.on('exit', () => this.cleanupAll());
    }
  }

  /**
   * Create and start a container
   */
  async createContainer(config: SandboxConfig): Promise<DockerContainer> {
    const image = this.imageMap[config.language];
    const containerName = `sandbox-${config.language}-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    logger.info({ language: config.language, containerName }, 'Creating sandbox container');

    try {
      // Ensure image exists
      await this.ensureImage(image, config.language);

      // Container configuration
      const createOptions: Docker.ContainerCreateOptions = {
        Image: image,
        name: containerName,
        WorkingDir: config.workdir || '/workspace',

        // Resource limits
        HostConfig: {
          Memory: config.maxMemoryMB * 1024 * 1024,
          NanoCpus: config.maxCpuPercent * 10000000, // Convert percent to nano CPUs
          PidsLimit: 100, // Limit number of processes

          // Network
          NetworkMode: config.allowNetwork ? 'bridge' : 'none',

          // Security
          ReadonlyRootfs: config.readOnly,
          CapDrop: config.capDrop || ['ALL'],
          CapAdd: ['CHOWN', 'SETGID', 'SETUID'], // Minimal caps needed
          SecurityOpt: config.seccompProfile ? [`seccomp=${config.seccompProfile}`] : ['no-new-privileges'],

          // Auto-remove container when stopped (if not persistent)
          AutoRemove: !config.persistFiles,

          // Bind mounts (if needed)
          Binds: config.persistFiles ? [`${containerName}-data:/workspace`] : undefined,
        },

        // User (run as non-root)
        User: config.rootless ? '1000:1000' : undefined,

        // Environment variables
        Env: config.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`) : undefined,

        // Labels for tracking
        Labels: {
          'agenthunt.sandbox': 'true',
          'agenthunt.language': config.language,
          'agenthunt.agentId': config.agentId || '',
          'agenthunt.jobId': config.jobId || '',
          ...config.tags,
        },

        // Command (keep container alive)
        Cmd: ['tail', '-f', '/dev/null'],
        Tty: false,
        AttachStdin: false,
        AttachStdout: false,
        AttachStderr: false,
      };

      // Create container
      const container = await this.docker.createContainer(createOptions);
      const containerInfo = await container.inspect();

      // Start container
      await container.start();

      // Track container
      const containerRecord: DockerContainer = {
        id: containerInfo.Id,
        name: containerName,
        image,
        status: 'running',
        language: config.language,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        expiresAt: config.persistFiles
          ? new Date(Date.now() + this.cleanupPolicy.persistentContainerTTL)
          : undefined,
        executions: 0,
        totalCpuTimeMs: 0,
        totalMemoryMB: 0,
        agentId: config.agentId,
        jobId: config.jobId,
        persistent: config.persistFiles,
      };

      this.containers.set(containerRecord.id, containerRecord);

      logger.info({ containerId: containerRecord.id, containerName }, 'Container created and started');

      return containerRecord;
    } catch (error: any) {
      logger.error({ error, language: config.language }, 'Failed to create container');
      throw new Error(`Container creation failed: ${error.message}`);
    }
  }

  /**
   * Execute command in container
   */
  async executeInContainer(
    containerId: string,
    command: string[],
    options?: {
      stdin?: string;
      env?: Record<string, string>;
      workdir?: string;
      timeoutMs?: number;
    }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const container = this.docker.getContainer(containerId);

    try {
      // Create exec instance
      const exec = await container.exec({
        Cmd: command,
        AttachStdin: !!options?.stdin,
        AttachStdout: true,
        AttachStderr: true,
        Env: options?.env ? Object.entries(options.env).map(([k, v]) => `${k}=${v}`) : undefined,
        WorkingDir: options?.workdir,
        Tty: false,
      });

      // Start execution with timeout
      const execPromise = new Promise<{ stdout: string; stderr: string; exitCode: number }>(
        async (resolve, reject) => {
          try {
            const stream = await exec.start({ hijack: true, stdin: !!options?.stdin });

            let stdout = '';
            let stderr = '';

            // Demultiplex Docker stream
            const stdoutStream = new (require('stream').PassThrough)();
            const stderrStream = new (require('stream').PassThrough)();

            stdoutStream.on('data', (chunk: Buffer) => {
              stdout += chunk.toString();
            });

            stderrStream.on('data', (chunk: Buffer) => {
              stderr += chunk.toString();
            });

            // Write stdin if provided
            if (options?.stdin) {
              stream.write(options.stdin);
              stream.end();
            }

            // Demux stream
            this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);

            stream.on('end', async () => {
              // Get exit code
              const inspectResult = await exec.inspect();
              resolve({
                stdout,
                stderr,
                exitCode: inspectResult.ExitCode || 0,
              });
            });

            stream.on('error', reject);
          } catch (error) {
            reject(error);
          }
        }
      );

      // Apply timeout if specified
      if (options?.timeoutMs) {
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Execution timeout')), options.timeoutMs);
        });
        return await Promise.race([execPromise, timeoutPromise]);
      }

      return await execPromise;
    } catch (error: any) {
      logger.error({ error, containerId }, 'Failed to execute command in container');
      throw error;
    }
  }

  /**
   * Stop a container
   */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.stop({ t: 5 }); // 5 second grace period

      // Update status
      const record = this.containers.get(containerId);
      if (record) {
        record.status = 'stopped';
      }

      logger.info({ containerId }, 'Container stopped');
    } catch (error: any) {
      if (error.statusCode === 304) {
        // Already stopped
        logger.debug({ containerId }, 'Container already stopped');
      } else {
        logger.error({ error, containerId }, 'Failed to stop container');
        throw error;
      }
    }
  }

  /**
   * Remove a container
   */
  async removeContainer(containerId: string, force: boolean = true): Promise<void> {
    try {
      const container = this.docker.getContainer(containerId);
      await container.remove({ force });

      // Remove from tracking
      this.containers.delete(containerId);

      logger.info({ containerId }, 'Container removed');
    } catch (error: any) {
      if (error.statusCode === 404) {
        // Already removed
        logger.debug({ containerId }, 'Container already removed');
        this.containers.delete(containerId);
      } else {
        logger.error({ error, containerId }, 'Failed to remove container');
        throw error;
      }
    }
  }

  /**
   * Get container by ID
   */
  getContainer(containerId: string): DockerContainer | undefined {
    return this.containers.get(containerId);
  }

  /**
   * List all tracked containers
   */
  listContainers(): DockerContainer[] {
    return Array.from(this.containers.values());
  }

  /**
   * Find reusable container for agent/job
   */
  findReusableContainer(language: SandboxLanguage, agentId?: string): DockerContainer | null {
    for (const container of this.containers.values()) {
      if (
        container.language === language &&
        container.status === 'running' &&
        container.persistent &&
        container.agentId === agentId
      ) {
        return container;
      }
    }
    return null;
  }

  /**
   * Ensure Docker image exists, build if needed
   */
  private async ensureImage(image: string, language: SandboxLanguage): Promise<void> {
    try {
      // Check if image exists
      const images = await this.docker.listImages({ filters: { reference: [image] } });

      if (images.length === 0) {
        logger.warn({ image }, 'Sandbox image not found, will use fallback');
        // TODO: In production, we should build the image or pull it
        // For now, fall back to base images
        const fallbackImages: Record<SandboxLanguage, string> = {
          python: 'python:3.11-slim',
          node: 'node:20-slim',
          go: 'golang:1.21-alpine',
          bash: 'ubuntu:22.04',
          ruby: 'ruby:3.2-slim',
        };

        // Update image map
        (this.imageMap as any)[language] = fallbackImages[language];

        logger.info({ language, fallbackImage: fallbackImages[language] }, 'Using fallback image');
      }
    } catch (error: any) {
      logger.error({ error, image }, 'Failed to check for image');
      throw error;
    }
  }

  /**
   * Start cleanup interval
   */
  private startCleanupInterval(): void {
    this.cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 60000); // Run cleanup every minute
  }

  /**
   * Perform cleanup based on policy
   */
  private async performCleanup(): Promise<void> {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [id, container] of this.containers.entries()) {
      // Remove failed containers immediately
      if (this.cleanupPolicy.cleanupFailedContainers && container.status === 'error') {
        toRemove.push(id);
        continue;
      }

      // Check idle time
      const idleTime = now - container.lastUsedAt.getTime();
      if (idleTime > this.cleanupPolicy.maxIdleTimeMs) {
        logger.info({ containerId: id, idleTimeMs: idleTime }, 'Removing idle container');
        toRemove.push(id);
        continue;
      }

      // Check container age
      const age = now - container.createdAt.getTime();
      if (age > this.cleanupPolicy.maxContainerAge) {
        logger.info({ containerId: id, ageMs: age }, 'Removing old container');
        toRemove.push(id);
        continue;
      }

      // Check expiration (for persistent containers)
      if (container.expiresAt && now > container.expiresAt.getTime()) {
        logger.info({ containerId: id }, 'Removing expired persistent container');
        toRemove.push(id);
        continue;
      }
    }

    // Check total container count
    if (this.containers.size > this.cleanupPolicy.maxTotalContainers) {
      const excess = this.containers.size - this.cleanupPolicy.maxTotalContainers;
      logger.warn({ excess, total: this.containers.size }, 'Too many containers, removing oldest');

      // Sort by last used time and remove oldest
      const sorted = Array.from(this.containers.entries()).sort(
        ([, a], [, b]) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime()
      );

      for (let i = 0; i < excess; i++) {
        toRemove.push(sorted[i][0]);
      }
    }

    // Remove containers
    for (const id of toRemove) {
      try {
        await this.removeContainer(id, true);
      } catch (error: any) {
        logger.error({ error, containerId: id }, 'Failed to cleanup container');
      }
    }

    if (toRemove.length > 0) {
      logger.info({ removed: toRemove.length }, 'Cleanup completed');
    }
  }

  /**
   * Cleanup all containers
   */
  async cleanupAll(): Promise<void> {
    logger.info({ total: this.containers.size }, 'Cleaning up all containers');

    const containerIds = Array.from(this.containers.keys());

    await Promise.all(
      containerIds.map(id =>
        this.removeContainer(id, true).catch(error =>
          logger.error({ error, containerId: id }, 'Failed to remove container during cleanup')
        )
      )
    );

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }

    logger.info('All containers cleaned up');
  }

  /**
   * Update container last used time
   */
  updateLastUsed(containerId: string): void {
    const container = this.containers.get(containerId);
    if (container) {
      container.lastUsedAt = new Date();
      container.executions++;
    }
  }

  /**
   * Update container resource usage
   */
  updateResourceUsage(containerId: string, cpuTimeMs: number, memoryMB: number): void {
    const container = this.containers.get(containerId);
    if (container) {
      container.totalCpuTimeMs += cpuTimeMs;
      container.totalMemoryMB = Math.max(container.totalMemoryMB, memoryMB);
    }
  }

  /**
   * Get stats
   */
  getStats(): {
    total: number;
    running: number;
    stopped: number;
    error: number;
    persistent: number;
    byLanguage: Record<SandboxLanguage, number>;
  } {
    const stats = {
      total: this.containers.size,
      running: 0,
      stopped: 0,
      error: 0,
      persistent: 0,
      byLanguage: {} as Record<SandboxLanguage, number>,
    };

    for (const container of this.containers.values()) {
      if (container.status === 'running') stats.running++;
      if (container.status === 'stopped') stats.stopped++;
      if (container.status === 'error') stats.error++;
      if (container.persistent) stats.persistent++;

      stats.byLanguage[container.language] = (stats.byLanguage[container.language] || 0) + 1;
    }

    return stats;
  }
}

export default new DockerManager();
