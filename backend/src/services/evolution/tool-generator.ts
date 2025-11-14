/**
 * Tool Auto-Generation Engine
 *
 * Enables agents to create custom security tools on-the-fly
 * Features:
 * - LLM-powered code generation
 * - Automatic testing in sandbox
 * - Auto-debugging with fix attempts
 * - Tool library storage
 * - Cross-swarm tool sharing
 */

import logger from '../../utils/logger';
import { llmEngine } from '../llm/llm-engine';
import { sandboxService } from '../sandbox/sandbox-service';
import database from '../database';
import { v4 as uuidv4 } from 'uuid';

export interface ToolRequirement {
  purpose: string;
  language: 'python' | 'node' | 'bash' | 'go';
  inputs: Array<{ name: string; type: string; description: string }>;
  outputs: Array<{ name: string; type: string; description: string }>;
  requirements: string[];
  testCases?: Array<{ input: any; expectedOutput: any; description: string }>;
  constraints?: {
    maxExecutionTime?: number;
    maxMemory?: number;
    allowedLibraries?: string[];
  };
}

export interface GeneratedTool {
  id: string;
  name: string;
  description: string;
  language: string;
  code: string;
  version: number;
  tested: boolean;
  successRate: number;
  testResults?: TestResult[];
  debugHistory?: DebugAttempt[];
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    executionTime?: number;
    memoryUsage?: number;
    dependencies?: string[];
  };
}

export interface TestResult {
  testCase: string;
  passed: boolean;
  output: any;
  expectedOutput: any;
  error?: string;
  executionTime: number;
}

export interface DebugAttempt {
  attempt: number;
  error: string;
  fix: string;
  success: boolean;
  timestamp: Date;
}

export class ToolGenerator {
  private toolLibrary: Map<string, GeneratedTool> = new Map();
  private maxDebugAttempts = 3;

  /**
   * Generate a custom tool from requirements
   * Includes automatic testing and debugging
   */
  async generateTool(requirement: ToolRequirement): Promise<GeneratedTool> {
    logger.info({ purpose: requirement.purpose, language: requirement.language }, 'Generating custom tool');

    try {
      // Generate initial tool code
      let tool = await this.createToolCode(requirement);

      // Test the tool
      if (requirement.testCases && requirement.testCases.length > 0) {
        const testResults = await this.testTool(tool, requirement.testCases);
        tool.testResults = testResults;

        const failedTests = testResults.filter(r => !r.passed);

        if (failedTests.length > 0) {
          logger.warn(
            { toolId: tool.id, failedTests: failedTests.length },
            'Tool has failing tests - attempting auto-debug'
          );

          // Auto-debug failing tests
          tool = await this.autoDebugTool(tool, requirement, failedTests);
        }

        // Calculate success rate
        const passedTests = testResults.filter(r => r.passed).length;
        tool.successRate = passedTests / testResults.length;
        tool.tested = tool.successRate >= 0.8; // 80% pass rate required
      }

      // Store in library
      this.toolLibrary.set(tool.id, tool);

      // Persist to database
      await this.saveToolToDatabase(tool);

      logger.info(
        {
          toolId: tool.id,
          name: tool.name,
          tested: tool.tested,
          successRate: (tool.successRate * 100).toFixed(1) + '%',
        },
        'Tool generation completed'
      );

      return tool;
    } catch (error: any) {
      logger.error({ error, purpose: requirement.purpose }, 'Tool generation failed');
      throw error;
    }
  }

  /**
   * Create tool code using LLM
   */
  private async createToolCode(requirement: ToolRequirement): Promise<GeneratedTool> {
    const prompt = `You are an expert security tool developer. Create a ${requirement.language} tool for the following purpose:

**Purpose**: ${requirement.purpose}

**Inputs**:
${requirement.inputs.map(i => `- ${i.name} (${i.type}): ${i.description}`).join('\n')}

**Expected Outputs**:
${requirement.outputs.map(o => `- ${o.name} (${o.type}): ${o.description}`).join('\n')}

**Requirements**:
${requirement.requirements.map(r => `- ${r}`).join('\n')}

${requirement.constraints?.allowedLibraries ? `**Allowed Libraries**: ${requirement.constraints.allowedLibraries.join(', ')}` : ''}

Generate production-ready, secure code with:
1. Proper error handling and validation
2. Clear comments explaining logic
3. Type safety (where applicable)
4. Efficient algorithms
5. Security best practices (input validation, no command injection, etc.)
6. Modular, testable functions

${this.getLanguageSpecificInstructions(requirement.language)}

Return ONLY the code, no explanations or markdown formatting.`;

    const code = await llmEngine.query(prompt, {
      maxTokens: 2500,
      temperature: 0.2, // Low temperature for more consistent code
    });

    // Clean up code (remove markdown if present)
    let cleanCode = code.trim();
    const codeBlockMatch = cleanCode.match(/```(?:\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      cleanCode = codeBlockMatch[1].trim();
    }

    const tool: GeneratedTool = {
      id: uuidv4(),
      name: this.generateToolName(requirement.purpose),
      description: requirement.purpose,
      language: requirement.language,
      code: cleanCode,
      version: 1,
      tested: false,
      successRate: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return tool;
  }

  /**
   * Get language-specific code generation instructions
   */
  private getLanguageSpecificInstructions(language: string): string {
    const instructions: Record<string, string> = {
      python: `
**Python-specific**:
- Use type hints (from typing import ...)
- Follow PEP 8 style guide
- Use argparse for CLI arguments if needed
- Handle exceptions properly with try/except
- Return results as JSON when appropriate`,

      node: `
**Node.js-specific**:
- Use modern JavaScript (async/await, ES6+)
- Add JSDoc comments for functions
- Use proper error handling with try/catch
- Return results as JSON objects
- Use built-in modules when possible`,

      bash: `
**Bash-specific**:
- Use proper error handling (set -e, set -u)
- Add usage instructions in comments
- Validate all inputs
- Use functions for modularity
- Return proper exit codes`,

      go: `
**Go-specific**:
- Follow Go conventions and formatting
- Use proper error handling (return err)
- Add godoc comments
- Use structs for complex data
- Return JSON for structured output`,
    };

    return instructions[language] || '';
  }

  /**
   * Test generated tool in sandbox
   */
  private async testTool(
    tool: GeneratedTool,
    testCases: Array<{ input: any; expectedOutput: any; description: string }>
  ): Promise<TestResult[]> {
    logger.debug({ toolId: tool.id, testCases: testCases.length }, 'Testing tool');

    const results: TestResult[] = [];

    for (const testCase of testCases) {
      const startTime = Date.now();

      try {
        const result = await sandboxService.executeCode(tool.code, tool.language, {
          input: testCase.input,
          timeout: 10000, // 10 second timeout per test
        });

        const executionTime = Date.now() - startTime;

        if (!result.success) {
          results.push({
            testCase: testCase.description,
            passed: false,
            output: result.output,
            expectedOutput: testCase.expectedOutput,
            error: result.error,
            executionTime,
          });
          continue;
        }

        // Check if output matches expected
        const passed = this.outputMatches(result.output, testCase.expectedOutput);

        results.push({
          testCase: testCase.description,
          passed,
          output: result.output,
          expectedOutput: testCase.expectedOutput,
          error: passed ? undefined : 'Output mismatch',
          executionTime,
        });
      } catch (error: any) {
        results.push({
          testCase: testCase.description,
          passed: false,
          output: null,
          expectedOutput: testCase.expectedOutput,
          error: error.message,
          executionTime: Date.now() - startTime,
        });
      }
    }

    return results;
  }

  /**
   * Auto-debug failing tool using LLM
   * Attempts to fix errors automatically
   */
  private async autoDebugTool(
    tool: GeneratedTool,
    requirement: ToolRequirement,
    failedTests: TestResult[]
  ): Promise<GeneratedTool> {
    logger.info({ toolId: tool.id, failedTests: failedTests.length }, 'Auto-debugging tool');

    tool.debugHistory = [];
    let currentCode = tool.code;
    let debugAttempt = 0;

    while (debugAttempt < this.maxDebugAttempts) {
      debugAttempt++;

      logger.debug({ toolId: tool.id, attempt: debugAttempt }, 'Debug attempt');

      // Prepare debug prompt with error details
      const debugPrompt = `You are debugging a ${tool.language} security tool. The tool has failing tests.

**Original Purpose**: ${requirement.purpose}

**Current Code**:
\`\`\`${tool.language}
${currentCode}
\`\`\`

**Failed Tests**:
${failedTests.map((t, i) => `
Test ${i + 1}: ${t.testCase}
- Expected: ${JSON.stringify(t.expectedOutput)}
- Got: ${JSON.stringify(t.output)}
- Error: ${t.error || 'Output mismatch'}
`).join('\n')}

Analyze the errors and provide a FIXED version of the code that will pass these tests.
Focus on:
1. Fixing logic errors
2. Handling edge cases
3. Proper error handling
4. Correct output formatting

Return ONLY the fixed code, no explanations.`;

      try {
        const fixedCode = await llmEngine.query(debugPrompt, {
          maxTokens: 2500,
          temperature: 0.3,
        });

        // Clean up fixed code
        let cleanFixedCode = fixedCode.trim();
        const codeBlockMatch = cleanFixedCode.match(/```(?:\w+)?\n([\s\S]*?)```/);
        if (codeBlockMatch) {
          cleanFixedCode = codeBlockMatch[1].trim();
        }

        // Test the fixed code
        const updatedTool = { ...tool, code: cleanFixedCode };
        const newTestResults = await this.testTool(updatedTool, requirement.testCases!);
        const newFailedTests = newTestResults.filter(r => !r.passed);

        // Record debug attempt
        const attempt: DebugAttempt = {
          attempt: debugAttempt,
          error: failedTests.map(t => t.error || 'Unknown').join(', '),
          fix: 'Auto-generated fix',
          success: newFailedTests.length < failedTests.length,
          timestamp: new Date(),
        };
        tool.debugHistory!.push(attempt);

        // Check if we fixed all tests
        if (newFailedTests.length === 0) {
          logger.info({ toolId: tool.id, attempts: debugAttempt }, 'Auto-debug successful');
          tool.code = cleanFixedCode;
          tool.testResults = newTestResults;
          tool.version++;
          tool.updatedAt = new Date();
          return tool;
        }

        // If we made progress, update and continue
        if (newFailedTests.length < failedTests.length) {
          logger.debug(
            { toolId: tool.id, remaining: newFailedTests.length },
            'Debug made progress'
          );
          currentCode = cleanFixedCode;
          failedTests = newFailedTests;
          tool.testResults = newTestResults;
        } else {
          logger.warn({ toolId: tool.id, attempt: debugAttempt }, 'Debug attempt made no progress');
        }
      } catch (error: any) {
        logger.error({ error, toolId: tool.id, attempt: debugAttempt }, 'Debug attempt failed');
      }
    }

    logger.warn(
      { toolId: tool.id, remainingFailures: failedTests.length },
      'Auto-debug exhausted attempts'
    );

    // Return best version we achieved
    tool.code = currentCode;
    tool.version++;
    tool.updatedAt = new Date();
    return tool;
  }

  /**
   * Compare actual vs expected output
   */
  private outputMatches(actual: any, expected: any): boolean {
    // Try exact match first
    if (JSON.stringify(actual) === JSON.stringify(expected)) {
      return true;
    }

    // Try type-flexible matching
    if (typeof actual === 'string' && typeof expected === 'string') {
      return actual.trim().toLowerCase() === expected.trim().toLowerCase();
    }

    // Try numerical tolerance
    if (typeof actual === 'number' && typeof expected === 'number') {
      return Math.abs(actual - expected) < 0.001;
    }

    // Try array matching
    if (Array.isArray(actual) && Array.isArray(expected)) {
      if (actual.length !== expected.length) return false;
      return actual.every((val, idx) => this.outputMatches(val, expected[idx]));
    }

    return false;
  }

  /**
   * Generate tool name from purpose
   */
  private generateToolName(purpose: string): string {
    return purpose
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);
  }

  /**
   * Save tool to database for persistence
   */
  private async saveToolToDatabase(tool: GeneratedTool): Promise<void> {
    try {
      // Create table if not exists
      await database.query(`
        CREATE TABLE IF NOT EXISTS generated_tools (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          language TEXT NOT NULL,
          code TEXT NOT NULL,
          version INTEGER DEFAULT 1,
          tested BOOLEAN DEFAULT false,
          success_rate FLOAT DEFAULT 0.0,
          test_results JSONB,
          debug_history JSONB,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Upsert tool
      await database.query(
        `INSERT INTO generated_tools
         (id, name, description, language, code, version, tested, success_rate, test_results, debug_history, metadata, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP)
         ON CONFLICT (id)
         DO UPDATE SET
           code = $5,
           version = $6,
           tested = $7,
           success_rate = $8,
           test_results = $9,
           debug_history = $10,
           updated_at = CURRENT_TIMESTAMP`,
        [
          tool.id,
          tool.name,
          tool.description,
          tool.language,
          tool.code,
          tool.version,
          tool.tested,
          tool.successRate,
          JSON.stringify(tool.testResults || []),
          JSON.stringify(tool.debugHistory || []),
          JSON.stringify(tool.metadata || {}),
        ]
      );

      logger.debug({ toolId: tool.id }, 'Tool saved to database');
    } catch (error: any) {
      logger.error({ error, toolId: tool.id }, 'Failed to save tool to database');
    }
  }

  /**
   * Get tool from library
   */
  getTool(toolId: string): GeneratedTool | undefined {
    return this.toolLibrary.get(toolId);
  }

  /**
   * Search tools by purpose/name
   */
  async searchTools(query: string): Promise<GeneratedTool[]> {
    try {
      const result = await database.query(
        `SELECT * FROM generated_tools
         WHERE name ILIKE $1 OR description ILIKE $1
         ORDER BY success_rate DESC, updated_at DESC
         LIMIT 20`,
        [`%${query}%`]
      );

      return result.rows.map(row => this.dbRowToTool(row));
    } catch (error: any) {
      logger.error({ error, query }, 'Failed to search tools');
      return [];
    }
  }

  /**
   * Get all tools with high success rate
   */
  async getWorkingTools(minSuccessRate: number = 0.8): Promise<GeneratedTool[]> {
    try {
      const result = await database.query(
        `SELECT * FROM generated_tools
         WHERE tested = true AND success_rate >= $1
         ORDER BY success_rate DESC, updated_at DESC
         LIMIT 50`,
        [minSuccessRate]
      );

      return result.rows.map(row => this.dbRowToTool(row));
    } catch (error: any) {
      logger.error({ error }, 'Failed to get working tools');
      return [];
    }
  }

  /**
   * Convert database row to GeneratedTool
   */
  private dbRowToTool(row: any): GeneratedTool {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      language: row.language,
      code: row.code,
      version: row.version,
      tested: row.tested,
      successRate: row.success_rate,
      testResults: row.test_results,
      debugHistory: row.debug_history,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      metadata: row.metadata,
    };
  }

  /**
   * Get tool generation statistics
   */
  async getStats(): Promise<{
    totalTools: number;
    testedTools: number;
    workingTools: number;
    avgSuccessRate: number;
    byLanguage: Record<string, number>;
  }> {
    try {
      const result = await database.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE tested = true) as tested,
          COUNT(*) FILTER (WHERE tested = true AND success_rate >= 0.8) as working,
          AVG(success_rate) FILTER (WHERE tested = true) as avg_success,
          language,
          COUNT(*) as lang_count
        FROM generated_tools
        GROUP BY language
      `);

      const byLanguage: Record<string, number> = {};
      result.rows.forEach(row => {
        byLanguage[row.language] = parseInt(row.lang_count);
      });

      const statsResult = await database.query(`
        SELECT
          COUNT(*) as total,
          COUNT(*) FILTER (WHERE tested = true) as tested,
          COUNT(*) FILTER (WHERE tested = true AND success_rate >= 0.8) as working,
          AVG(success_rate) FILTER (WHERE tested = true) as avg_success
        FROM generated_tools
      `);

      const stats = statsResult.rows[0];

      return {
        totalTools: parseInt(stats.total) || 0,
        testedTools: parseInt(stats.tested) || 0,
        workingTools: parseInt(stats.working) || 0,
        avgSuccessRate: parseFloat(stats.avg_success) || 0,
        byLanguage,
      };
    } catch (error: any) {
      logger.error({ error }, 'Failed to get tool stats');
      return {
        totalTools: 0,
        testedTools: 0,
        workingTools: 0,
        avgSuccessRate: 0,
        byLanguage: {},
      };
    }
  }
}

// Singleton instance
export const toolGenerator = new ToolGenerator();
export default toolGenerator;
