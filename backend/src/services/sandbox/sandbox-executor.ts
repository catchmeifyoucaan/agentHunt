/**
 * Sandbox Executor - Main interface for safe code execution
 * Coordinates validation, Docker containers, and resource monitoring
 */

// @ts-nocheck
import {
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxConfig,
  SandboxLanguage,
  SandboxStats,
} from './types';
import codeValidator from './code-validator';
import dockerManager from './docker-manager';
import resourceMonitor from './resource-monitor';
import logger from '../../utils/logger';
import * as fs from 'fs/promises';
import * as path from 'path';

export class SandboxExecutor {
  /**
   * Execute code in a sandbox
   */
  async execute(request: SandboxExecutionRequest): Promise<SandboxExecutionResult> {
    const startTime = Date.now();
    const config = this.buildConfig(request);

    logger.info(
      {
        language: config.language,
        codeLength: request.code.length,
        agentId: config.agentId,
        jobId: config.jobId,
      },
      'Executing code in sandbox'
    );

    // Step 1: Validate code safety
    const validation = codeValidator.validate(request.code, config.language, config.allowNetwork);

    if (!validation.safe) {
      logger.warn({ validation }, 'Code validation failed');
      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: `Code validation failed:\n${validation.errors.join('\n')}`,
        resources: {
          memoryUsedMB: 0,
          cpuPercent: 0,
          executionTimeMs: Date.now() - startTime,
        },
        error: 'Code validation failed',
        startedAt: new Date(startTime),
        finishedAt: new Date(),
      };
    }

    // Warnings don't block execution, just log them
    if (validation.warnings.length > 0) {
      logger.warn({ warnings: validation.warnings }, 'Code validation warnings');
    }

    let containerId: string | undefined;

    try {
      // Step 2: Get or create container
      let container = config.persistFiles
        ? dockerManager.findReusableContainer(config.language, config.agentId)
        : null;

      if (!container) {
        container = await dockerManager.createContainer(config);
      } else {
        logger.info({ containerId: container.id }, 'Reusing existing container');
      }

      containerId = container.id;

      // Step 3: Start resource monitoring
      await resourceMonitor.startMonitoring(containerId, 1000);

      // Step 4: Prepare execution environment
      await this.prepareEnvironment(containerId, config, request.files);

      // Step 5: Auto-install dependencies if needed
      if (config.autoInstall && config.dependencies && config.dependencies.length > 0) {
        await this.installDependencies(containerId, config.language, config.dependencies);
      }

      // Step 6: Execute code
      const result = await this.executeCode(containerId, config, request);

      // Step 7: Collect final resource stats
      const finalStats = resourceMonitor.getLatestStats(containerId);
      const peakStats = resourceMonitor.getPeakStats(containerId);

      // Step 8: Update container tracking
      dockerManager.updateLastUsed(containerId);
      if (peakStats) {
        dockerManager.updateResourceUsage(containerId, peakStats.cpuTimeMs, peakStats.memoryUsedMB);
      }

      // Step 9: Stop monitoring and cleanup if not persistent
      resourceMonitor.stopMonitoring(containerId);

      if (!config.persistFiles) {
        await dockerManager.removeContainer(containerId).catch(err =>
          logger.warn({ error: err }, 'Failed to cleanup container')
        );
      }

      return {
        ...result,
        resources: {
          memoryUsedMB: peakStats?.memoryUsedMB || 0,
          cpuPercent: peakStats?.cpuPercent || 0,
          executionTimeMs: Date.now() - startTime,
        },
        containerId,
      };
    } catch (error: any) {
      logger.error({ error, containerId }, 'Sandbox execution failed');

      // Cleanup on error
      if (containerId) {
        resourceMonitor.stopMonitoring(containerId);
        if (!config.persistFiles) {
          await dockerManager.removeContainer(containerId, true).catch(() => {});
        }
      }

      return {
        success: false,
        exitCode: -1,
        stdout: '',
        stderr: error.message || 'Unknown error',
        resources: {
          memoryUsedMB: 0,
          cpuPercent: 0,
          executionTimeMs: Date.now() - startTime,
        },
        error: error.message,
        startedAt: new Date(startTime),
        finishedAt: new Date(),
      };
    }
  }

  /**
   * Build full config with defaults
   */
  private buildConfig(request: SandboxExecutionRequest): SandboxConfig {
    return {
      language: request.config.language || 'python',
      environment: request.config.environment || 'isolated',
      maxMemoryMB: request.config.maxMemoryMB || 512,
      maxCpuPercent: request.config.maxCpuPercent || 50,
      timeoutMs: request.config.timeoutMs || 30000,
      allowNetwork: request.config.allowNetwork || false,
      allowedHosts: request.config.allowedHosts,
      workdir: request.config.workdir || '/workspace',
      readOnly: request.config.readOnly || false,
      persistFiles: request.config.persistFiles || false,
      autoInstall: request.config.autoInstall ?? true,
      dependencies: request.config.dependencies,
      rootless: request.config.rootless ?? true,
      seccompProfile: request.config.seccompProfile,
      capDrop: request.config.capDrop,
      agentId: request.config.agentId,
      jobId: request.config.jobId,
      tags: request.config.tags,
      env: request.env,
    } as SandboxConfig;
  }

  /**
   * Prepare execution environment (write files, etc.)
   */
  private async prepareEnvironment(
    containerId: string,
    config: SandboxConfig,
    files?: Record<string, string>
  ): Promise<void> {
    if (!files || Object.keys(files).length === 0) {
      return;
    }

    logger.debug({ containerId, fileCount: Object.keys(files).length }, 'Preparing environment files');

    // Write files to container
    for (const [filename, content] of Object.entries(files)) {
      const filepath = path.join(config.workdir, filename);
      const command = ['sh', '-c', `cat > ${filepath} << 'EOL'\n${content}\nEOL`];

      await dockerManager.executeInContainer(containerId, command, { workdir: config.workdir });
    }
  }

  /**
   * Install dependencies
   */
  private async installDependencies(
    containerId: string,
    language: SandboxLanguage,
    dependencies: string[]
  ): Promise<void> {
    logger.info({ containerId, language, dependencies }, 'Installing dependencies');

    const commands: Record<SandboxLanguage, string> = {
      python: `pip install --no-cache-dir ${dependencies.join(' ')}`,
      node: `npm install ${dependencies.join(' ')}`,
      go: `go get ${dependencies.join(' ')}`,
      ruby: `gem install ${dependencies.join(' ')}`,
      bash: '', // No package manager for bash
    };

    const command = commands[language];
    if (!command) {
      logger.warn({ language }, 'No package manager for language');
      return;
    }

    try {
      const result = await dockerManager.executeInContainer(containerId, ['sh', '-c', command], {
        timeoutMs: 120000, // 2 minute timeout for dependency installation
      });

      if (result.exitCode !== 0) {
        logger.warn({ stderr: result.stderr }, 'Dependency installation had warnings');
      }
    } catch (error: any) {
      logger.error({ error }, 'Failed to install dependencies');
      throw new Error(`Dependency installation failed: ${error.message}`);
    }
  }

  /**
   * Execute code in container
   */
  private async executeCode(
    containerId: string,
    config: SandboxConfig,
    request: SandboxExecutionRequest
  ): Promise<Omit<SandboxExecutionResult, 'resources' | 'containerId'>> {
    const startTime = new Date();

    // Language-specific execution commands
    const commands: Record<SandboxLanguage, string[]> = {
      python: ['python', '-c', request.code],
      node: ['node', '-e', request.code],
      go: ['sh', '-c', `echo '${request.code.replace(/'/g, "'\\''")}' > /tmp/main.go && go run /tmp/main.go`],
      bash: ['bash', '-c', request.code],
      ruby: ['ruby', '-e', request.code],
    };

    const command = commands[config.language];

    try {
      const result = await dockerManager.executeInContainer(containerId, command, {
        stdin: request.stdin,
        env: config.env,
        workdir: config.workdir,
        timeoutMs: config.timeoutMs,
      });

      return {
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        startedAt: startTime,
        finishedAt: new Date(),
      };
    } catch (error: any) {
      if (error.message.includes('timeout')) {
        return {
          success: false,
          exitCode: -1,
          stdout: '',
          stderr: 'Execution timeout',
          error: 'Execution timeout',
          killed: true,
          killReason: 'timeout',
          startedAt: startTime,
          finishedAt: new Date(),
        };
      }

      throw error;
    }
  }

  /**
   * Quick execution (single-shot, no persistence)
   */
  async quickExecute(
    code: string,
    language: SandboxLanguage,
    options?: {
      stdin?: string;
      timeoutMs?: number;
      env?: Record<string, string>;
    }
  ): Promise<SandboxExecutionResult> {
    return this.execute({
      code,
      config: {
        language,
        environment: 'isolated',
        persistFiles: false,
        timeoutMs: options?.timeoutMs,
        env: options?.env,
      },
      stdin: options?.stdin,
    });
  }

  /**
   * Get sandbox statistics
   */
  getStats(): SandboxStats {
    const dockerStats = dockerManager.getStats();

    return {
      totalContainers: dockerStats.total,
      runningContainers: dockerStats.running,
      idleContainers: dockerStats.running - 0, // TODO: Track active executions
      totalExecutions: 0, // TODO: Track total executions
      successfulExecutions: 0,
      failedExecutions: 0,
      killedExecutions: 0,
      totalCpuTimeMs: 0,
      totalMemoryMB: 0,
      averageExecutionTimeMs: 0,
      executionsByLanguage: dockerStats.byLanguage as any,
    };
  }

  /**
   * Cleanup all sandboxes
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up all sandboxes');
    await dockerManager.cleanupAll();
    resourceMonitor.clearAll();
  }
}

export default new SandboxExecutor();
