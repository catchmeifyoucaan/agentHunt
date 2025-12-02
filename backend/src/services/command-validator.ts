/**
 * Command Validation Service
 * Pre-execution validation to prevent errors (inspired by Claude Code's safety-first approach)
 */

import database from './database';
import logger from '../utils/logger';
import fs from 'fs/promises';
import path from 'path';
import { CommandValidation, ResourceEstimate } from '../../../shared/agent-collaboration.types';
import config from '../config';

interface ParsedCommand {
  tool: string;
  inputFile?: string;
  outputFile?: string;
  targets?: string[];
  flags: Map<string, string>;
}

class CommandValidatorService {
  /**
   * Validate command before execution
   */
  async validateCommand(
    jobId: string,
    agentType: string,
    command: string
  ): Promise<CommandValidation> {
    const reasons: string[] = [];
    const warnings: string[] = [];
    let estimatedResources: ResourceEstimate | undefined;

    try {
      // Parse the command
      const parsed = this.parseCommand(command);

      // 1. Check tool binary exists
      if (!(await this.toolExists(parsed.tool))) {
        reasons.push(`Tool not found: ${parsed.tool}`);
      }

      // 2. Validate input files exist
      if (parsed.inputFile && !(await this.fileExists(parsed.inputFile))) {
        reasons.push(`Input file missing: ${parsed.inputFile}`);
      }

      // 3. Validate output directory is writable
      if (parsed.outputFile) {
        const dir = path.dirname(parsed.outputFile);
        if (!(await this.isWritable(dir))) {
          reasons.push(`Cannot write to directory: ${dir}`);
        }
      }

      // 4. Check target count is reasonable
      if (parsed.targets && parsed.targets.length > 50000) {
        warnings.push(`Large target count: ${parsed.targets.length}. May take significant time.`);
      }

      // 5. Estimate resource usage
      estimatedResources = await this.estimateResources(parsed, agentType);

      // 6. Check estimated resources against limits
      const maxMemoryMB = 4000;
      if (estimatedResources.memory > maxMemoryMB) {
        reasons.push(
          `Command would use ~${estimatedResources.memory}MB memory, ` +
            `exceeds limit of ${maxMemoryMB}MB`
        );
      }

      // 7. Check for dangerous flags
      const dangerousFlags = this.checkDangerousFlags(parsed);
      if (dangerousFlags.length > 0) {
        warnings.push(`Potentially dangerous flags detected: ${dangerousFlags.join(', ')}`);
      }

      // 8. Tool-specific validations
      const toolValidation = await this.validateToolSpecific(parsed, agentType);
      reasons.push(...toolValidation.reasons);
      warnings.push(...toolValidation.warnings);

      // Store validation result
      await this.storeValidation(jobId, agentType, command, {
        safe: reasons.length === 0,
        reasons,
        estimatedResources,
        warnings,
      });

      return {
        safe: reasons.length === 0,
        reasons,
        estimatedResources,
        warnings,
      };
    } catch (error: any) {
      logger.error({ error, command }, 'Command validation failed');
      return {
        safe: false,
        reasons: [`Validation error: ${error.message}`],
        warnings,
      };
    }
  }

  /**
   * Parse command string into structured format
   */
  private parseCommand(command: string): ParsedCommand {
    const parts = command.trim().split(/\s+/);
    const tool = parts[0];
    const flags = new Map<string, string>();
    let inputFile: string | undefined;
    let outputFile: string | undefined;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];

      if (part.startsWith('-')) {
        const flagName = part.replace(/^-+/, '');
        const flagValue =
          i + 1 < parts.length && !parts[i + 1].startsWith('-') ? parts[++i] : 'true';
        flags.set(flagName, flagValue);

        // Track input/output files
        if (['l', 'list', 'i', 'input'].includes(flagName)) {
          inputFile = flagValue;
        }
        if (['o', 'output', 'w'].includes(flagName)) {
          outputFile = flagValue;
        }
      }
    }

    return {
      tool,
      inputFile,
      outputFile,
      flags,
    };
  }

  /**
   * Check if tool binary exists
   */
  private async toolExists(toolPath: string): Promise<boolean> {
    try {
      await fs.access(toolPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if directory is writable
   */
  private async isWritable(dirPath: string): Promise<boolean> {
    try {
      await fs.access(dirPath, fs.constants.W_OK);
      return true;
    } catch {
      // Try to create directory if it doesn't exist
      try {
        await fs.mkdir(dirPath, { recursive: true });
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Estimate resource usage for a command
   */
  private async estimateResources(
    parsed: ParsedCommand,
    agentType: string
  ): Promise<ResourceEstimate> {
    // Read target count from input file if exists
    let targetCount = 1;
    if (parsed.inputFile) {
      try {
        const content = await fs.readFile(parsed.inputFile, 'utf-8');
        targetCount = content.split('\n').filter((l) => l.trim()).length;
      } catch {
        // File might not exist yet, use default
      }
    }

    // Tool-specific resource estimations
    const toolName = path.basename(parsed.tool);
    const estimates: Record<string, (count: number) => ResourceEstimate> = {
      httpx: (count) => ({
        memory: Math.min(200 + count * 0.1, 2000),
        cpu: 2,
        duration: Math.ceil(count / 100) * 60, // ~100 targets/minute
        networkIO: count * 0.05, // 50KB per target
        diskIO: count * 0.02, // 20KB per target
      }),
      naabu: (count) => ({
        memory: Math.min(300 + count * 0.2, 3000),
        cpu: 4,
        duration: Math.ceil(count / 50) * 60, // ~50 targets/minute
        networkIO: count * 10, // 10MB per target (port scanning)
        diskIO: count * 0.1,
      }),
      masscan: (count) => ({
        memory: Math.min(500 + count * 0.5, 4000),
        cpu: 8,
        duration: Math.ceil(count / 500) * 60, // ~500 targets/minute (fast!)
        networkIO: count * 5,
        diskIO: count * 0.05,
      }),
      nuclei: (count) => ({
        memory: Math.min(1000 + count * 2, 8000),
        cpu: 4,
        duration: Math.ceil(count / 10) * 60, // ~10 targets/minute (slow, thorough)
        networkIO: count * 50, // 50MB per target (many requests)
        diskIO: count * 0.5,
      }),
      dnsx: (count) => ({
        memory: Math.min(100 + count * 0.05, 1000),
        cpu: 2,
        duration: Math.ceil(count / 1000) * 60, // ~1000 targets/minute (fast)
        networkIO: count * 0.001, // 1KB per target
        diskIO: count * 0.001,
      }),
      subfinder: (count) => ({
        memory: 200,
        cpu: 2,
        duration: count * 120, // ~2 minutes per domain
        networkIO: count * 10,
        diskIO: count * 0.1,
      }),
      katana: (count) => ({
        memory: Math.min(500 + count * 1, 4000),
        cpu: 3,
        duration: Math.ceil(count / 5) * 60, // ~5 URLs/minute (crawling is slow)
        networkIO: count * 100, // 100MB per URL (full crawl)
        diskIO: count * 10,
      }),
    };

    const estimator = estimates[toolName];
    if (estimator) {
      return estimator(targetCount);
    }

    // Default conservative estimate
    return {
      memory: 500,
      cpu: 2,
      duration: 300, // 5 minutes
      networkIO: targetCount * 1,
      diskIO: targetCount * 0.1,
    };
  }

  /**
   * Check for potentially dangerous command flags
   */
  private checkDangerousFlags(parsed: ParsedCommand): string[] {
    const dangerous: string[] = [];
    const toolName = path.basename(parsed.tool);

    // Masscan-specific dangerous flags
    if (toolName === 'masscan') {
      if (parsed.flags.has('rate')) {
        const rate = parseInt(parsed.flags.get('rate') || '0');
        if (rate > 100000) {
          dangerous.push(`--rate ${rate} (very aggressive, may cause network issues)`);
        }
      }
    }

    // Nuclei-specific dangerous flags
    if (toolName === 'nuclei') {
      if (parsed.flags.has('no-interactsh')) {
        dangerous.push('--no-interactsh (disables OOB testing)');
      }
      if (parsed.flags.has('severity') && !parsed.flags.get('severity')?.includes('high')) {
        dangerous.push('--severity without high/critical (may miss important vulns)');
      }
    }

    // httpx-specific dangerous flags
    if (toolName === 'httpx') {
      if (parsed.flags.has('threads')) {
        const threads = parseInt(parsed.flags.get('threads') || '0');
        if (threads > 500) {
          dangerous.push(`--threads ${threads} (may overwhelm target)`);
        }
      }
    }

    return dangerous;
  }

  /**
   * Tool-specific validation logic
   */
  private async validateToolSpecific(
    parsed: ParsedCommand,
    agentType: string
  ): Promise<{ reasons: string[]; warnings: string[] }> {
    const reasons: string[] = [];
    const warnings: string[] = [];
    const toolName = path.basename(parsed.tool);

    // Validate required flags for each tool
    const requiredFlags: Record<string, string[]> = {
      httpx: ['l', 'list'], // Requires input list
      naabu: ['list'], // Requires target list
      nuclei: ['l', 'list'], // Requires target list
      dnsx: ['l', 'list'], // Requires domain list
    };

    const required = requiredFlags[toolName];
    if (required) {
      const hasRequired = required.some((flag) => parsed.flags.has(flag));
      if (!hasRequired) {
        reasons.push(`Missing required flag: ${required.join(' or ')}`);
      }
    }

    // Warn about missing recommended flags
    const recommendedFlags: Record<string, string[]> = {
      httpx: ['json'], // JSON output recommended
      nuclei: ['json', 'severity'], // JSON output and severity filter
      naabu: ['json'], // JSON output
    };

    const recommended = recommendedFlags[toolName];
    if (recommended) {
      for (const flag of recommended) {
        if (!parsed.flags.has(flag)) {
          warnings.push(`Recommended flag missing: --${flag}`);
        }
      }
    }

    return { reasons, warnings };
  }

  /**
   * Store validation result in database
   */
  private async storeValidation(
    jobId: string,
    agentType: string,
    command: string,
    validation: CommandValidation
  ): Promise<void> {
    try {
      await database.query(
        `INSERT INTO command_validations (job_id, agent_type, command, validation_result, executed)
         VALUES ($1, $2, $3, $4, $5)`,
        [jobId, agentType, command, validation, false]
      );
    } catch (error: any) {
      // Don't throw - validation storage failed but validation itself succeeded
      logger.warn({ error, jobId }, 'Failed to store validation result');
    }
  }

  /**
   * Record actual resource usage after command execution
   */
  async recordActualResources(
    jobId: string,
    command: string,
    actualResources: ResourceEstimate
  ): Promise<void> {
    try {
      await database.query(
        `UPDATE command_validations
         SET executed = TRUE,
             actual_resources = $1
         WHERE job_id = $2 AND command = $3`,
        [actualResources, jobId, command]
      );
    } catch (error: any) {
      logger.warn({ error, jobId }, 'Failed to record actual resources');
    }
  }

  /**
   * Get validation history for analysis
   */
  async getValidationHistory(agentType?: string, limit: number = 100): Promise<any[]> {
    try {
      const query = agentType
        ? `SELECT * FROM command_validations WHERE agent_type = $1 ORDER BY created_at DESC LIMIT $2`
        : `SELECT * FROM command_validations ORDER BY created_at DESC LIMIT $1`;

      const values = agentType ? [agentType, limit] : [limit];
      const result = await database.query(query, values);
      return result.rows;
    } catch (error: any) {
      logger.error({ error }, 'Failed to get validation history');
      return [];
    }
  }
}

export default new CommandValidatorService();
