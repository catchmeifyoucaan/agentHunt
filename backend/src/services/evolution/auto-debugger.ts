/**
 * Auto-Debugging System
 *
 * Enables agents to debug themselves and fix errors autonomously
 * Features:
 * - Error pattern recognition
 * - Automatic fix generation
 * - Fix validation in sandbox
 * - Learning from successful fixes
 * - Debug history tracking
 */

import logger from '../../utils/logger';
import llmEngine from '../llm/llm-engine';
import sandboxExecutor from '../sandbox/sandbox-executor';
import database from '../database';
import { v4 as uuidv4 } from 'uuid';

export interface DebugRequest {
  code: string;
  language: 'python' | 'node' | 'bash' | 'go';
  error: string;
  errorType?: string;
  stackTrace?: string;
  context?: {
    inputs?: any;
    expectedOutput?: any;
    actualOutput?: any;
  };
  constraints?: {
    maxAttempts?: number;
    timeout?: number;
  };
}

export interface DebugResult {
  id: string;
  success: boolean;
  fixedCode?: string;
  attempts: DebugAttempt[];
  finalError?: string;
  duration: number;
  learningAdded: boolean;
}

export interface DebugAttempt {
  attemptNumber: number;
  analysis: string;
  proposedFix: string;
  fixedCode: string;
  testSuccess: boolean;
  error?: string;
  timestamp: Date;
}

export interface DebugPattern {
  id: string;
  errorType: string;
  errorPattern: string;
  fixPattern: string;
  language: string;
  successCount: number;
  failureCount: number;
  confidence: number;
  examples: string[];
  createdAt: Date;
  updatedAt: Date;
}

export class AutoDebugger {
  private debugPatterns: Map<string, DebugPattern> = new Map();
  private maxAttempts = 5;

  constructor() {
    this.loadDebugPatterns();
  }

  /**
   * Auto-debug code with error
   * Main entry point for debugging
   */
  async debugCode(request: DebugRequest): Promise<DebugResult> {
    logger.info(
      { language: request.language, errorType: request.errorType },
      'Starting auto-debug'
    );

    const startTime = Date.now();
    const debugId = uuidv4();
    const attempts: DebugAttempt[] = [];
    const maxAttempts = request.constraints?.maxAttempts || this.maxAttempts;

    try {
      // First, try pattern-based fix (fast path)
      const patternFix = await this.tryPatternFix(request);
      if (patternFix) {
        logger.info({ debugId }, 'Pattern-based fix successful');

        return {
          id: debugId,
          success: true,
          fixedCode: patternFix.fixedCode,
          attempts: [patternFix],
          duration: Date.now() - startTime,
          learningAdded: false,
        };
      }

      // Pattern fix failed or no pattern found - use LLM debugging
      let currentCode = request.code;
      let currentError = request.error;

      for (let attemptNum = 1; attemptNum <= maxAttempts; attemptNum++) {
        logger.debug({ debugId, attemptNum }, 'Debug attempt');

        const attempt = await this.attemptFix(
          currentCode,
          currentError,
          request,
          attemptNum
        );

        attempts.push(attempt);

        if (attempt.testSuccess) {
          logger.info({ debugId, attempts: attemptNum }, 'Debug successful');

          // Learn from this successful fix
          await this.learnFromSuccess(request, attempt);

          return {
            id: debugId,
            success: true,
            fixedCode: attempt.fixedCode,
            attempts,
            duration: Date.now() - startTime,
            learningAdded: true,
          };
        }

        // Update for next attempt
        currentCode = attempt.fixedCode;
        currentError = attempt.error || currentError;

        // If we're making no progress, try a different approach
        if (attemptNum > 2 && attempts[attempts.length - 1].error === attempts[attempts.length - 2].error) {
          logger.warn({ debugId }, 'No progress - trying alternative approach');
          // Next attempt will use different temperature/strategy
        }
      }

      logger.warn({ debugId, attempts: maxAttempts }, 'Debug failed after max attempts');

      return {
        id: debugId,
        success: false,
        attempts,
        finalError: attempts[attempts.length - 1].error,
        duration: Date.now() - startTime,
        learningAdded: false,
      };
    } catch (error: any) {
      logger.error({ error, debugId }, 'Auto-debug crashed');

      return {
        id: debugId,
        success: false,
        attempts,
        finalError: error.message,
        duration: Date.now() - startTime,
        learningAdded: false,
      };
    }
  }

  /**
   * Try to fix using learned patterns (fast path)
   */
  private async tryPatternFix(request: DebugRequest): Promise<DebugAttempt | null> {
    // Find matching patterns
    const patterns = Array.from(this.debugPatterns.values()).filter(
      p =>
        p.language === request.language &&
        p.confidence > 0.7 &&
        request.error.toLowerCase().includes(p.errorPattern.toLowerCase())
    );

    if (patterns.length === 0) {
      return null;
    }

    // Try the most confident pattern
    const bestPattern = patterns.sort((a, b) => b.confidence - a.confidence)[0];

    logger.debug({ patternId: bestPattern.id }, 'Trying pattern-based fix');

    try {
      // Apply pattern fix
      const fixedCode = await this.applyPatternFix(
        request.code,
        request.error,
        bestPattern
      );

      // Test the fix
      const testSuccess = await this.testFix(
        fixedCode,
        request.language,
        request.context
      );

      if (testSuccess) {
        // Update pattern success count
        bestPattern.successCount++;
        bestPattern.confidence = Math.min(
          0.99,
          bestPattern.successCount / (bestPattern.successCount + bestPattern.failureCount)
        );
        bestPattern.updatedAt = new Date();
        await this.saveDebugPattern(bestPattern);

        return {
          attemptNumber: 0,
          analysis: `Applied pattern: ${bestPattern.errorType}`,
          proposedFix: bestPattern.fixPattern,
          fixedCode,
          testSuccess: true,
          timestamp: new Date(),
        };
      }

      // Pattern didn't work
      bestPattern.failureCount++;
      bestPattern.confidence = Math.min(
        0.99,
        bestPattern.successCount / (bestPattern.successCount + bestPattern.failureCount)
      );
      await this.saveDebugPattern(bestPattern);
    } catch (error: any) {
      logger.error({ error, patternId: bestPattern.id }, 'Pattern fix failed');
    }

    return null;
  }

  /**
   * Apply a pattern-based fix to code
   */
  private async applyPatternFix(
    code: string,
    error: string,
    pattern: DebugPattern
  ): Promise<string> {
    const prompt = `Apply this known fix pattern to the code:

**Error**: ${error}

**Fix Pattern**: ${pattern.fixPattern}

**Code**:
\`\`\`${pattern.language}
${code}
\`\`\`

Return the fixed code implementing the pattern. Return ONLY the code.`;

    const fixedCode = await llmEngine.query(prompt, {
      maxTokens: 2000,
      temperature: 0.1,
    });

    return this.cleanCode(fixedCode);
  }

  /**
   * Attempt a single debug fix
   */
  private async attemptFix(
    code: string,
    error: string,
    request: DebugRequest,
    attemptNumber: number
  ): Promise<DebugAttempt> {
    // Build debug prompt with increasing detail
    const temperature = 0.2 + (attemptNumber - 1) * 0.1; // Increase creativity with attempts

    const prompt = this.buildDebugPrompt(code, error, request, attemptNumber);

    try {
      const response = await llmEngine.query(prompt, {
        maxTokens: 2500,
        temperature: Math.min(0.7, temperature),
      });

      // Parse response
      const { analysis, proposedFix, fixedCode } = this.parseDebugResponse(
        response,
        code,
        request.language
      );

      // Test the fix
      const testSuccess = await this.testFix(
        fixedCode,
        request.language,
        request.context
      );

      let newError: string | undefined;
      if (!testSuccess) {
        // Try to get new error from testing
        try {
          const testResult = await sandboxService.executeCode(
            fixedCode,
            request.language,
            {
              input: request.context?.inputs,
              timeout: 5000,
            }
          );
          newError = testResult.error || 'Test failed - output mismatch';
        } catch (e: any) {
          newError = e.message;
        }
      }

      return {
        attemptNumber,
        analysis,
        proposedFix,
        fixedCode,
        testSuccess,
        error: newError,
        timestamp: new Date(),
      };
    } catch (error: any) {
      logger.error({ error, attemptNumber }, 'Debug attempt failed');

      return {
        attemptNumber,
        analysis: 'LLM error',
        proposedFix: 'Unable to generate fix',
        fixedCode: code,
        testSuccess: false,
        error: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Build debug prompt based on attempt number
   */
  private buildDebugPrompt(
    code: string,
    error: string,
    request: DebugRequest,
    attemptNumber: number
  ): string {
    let prompt = `You are an expert debugger. Fix this ${request.language} code that has an error.

**Error**: ${error}

${request.errorType ? `**Error Type**: ${request.errorType}` : ''}

${request.stackTrace ? `**Stack Trace**:\n${request.stackTrace}` : ''}

**Code**:
\`\`\`${request.language}
${code}
\`\`\`

${request.context?.inputs ? `**Inputs**: ${JSON.stringify(request.context.inputs)}` : ''}
${request.context?.expectedOutput ? `**Expected Output**: ${JSON.stringify(request.context.expectedOutput)}` : ''}
${request.context?.actualOutput ? `**Actual Output**: ${JSON.stringify(request.context.actualOutput)}` : ''}

`;

    if (attemptNumber === 1) {
      prompt += `Analyze the error carefully and provide a fix. Return:
1. Analysis: What's causing the error
2. Proposed Fix: Description of the fix
3. Fixed Code: The corrected code

Format:
ANALYSIS: [your analysis]
PROPOSED FIX: [your fix description]
FIXED CODE:
\`\`\`${request.language}
[fixed code]
\`\`\``;
    } else {
      prompt += `This is attempt #${attemptNumber}. Previous attempts failed. Try a DIFFERENT approach.
Focus on:
- Edge cases that might have been missed
- Alternative implementations
- Different error handling strategies

Return the analysis, proposed fix, and fixed code as before.`;
    }

    return prompt;
  }

  /**
   * Parse debug response from LLM
   */
  private parseDebugResponse(
    response: string,
    originalCode: string,
    language: string
  ): { analysis: string; proposedFix: string; fixedCode: string } {
    try {
      // Extract analysis
      const analysisMatch = response.match(/ANALYSIS:\s*(.+?)(?=PROPOSED FIX:|FIXED CODE:|$)/is);
      const analysis = analysisMatch ? analysisMatch[1].trim() : 'No analysis provided';

      // Extract proposed fix
      const fixMatch = response.match(/PROPOSED FIX:\s*(.+?)(?=FIXED CODE:|$)/is);
      const proposedFix = fixMatch ? fixMatch[1].trim() : 'No fix description provided';

      // Extract fixed code
      let fixedCode = originalCode;
      const codeMatch = response.match(/```(?:\w+)?\n([\s\S]*?)```/);
      if (codeMatch) {
        fixedCode = codeMatch[1].trim();
      } else {
        // Try to extract code after "FIXED CODE:"
        const codeTextMatch = response.match(/FIXED CODE:\s*(.+)/is);
        if (codeTextMatch) {
          fixedCode = codeTextMatch[1].trim();
        }
      }

      return { analysis, proposedFix, fixedCode: this.cleanCode(fixedCode) };
    } catch (error: any) {
      logger.error({ error }, 'Failed to parse debug response');
      return {
        analysis: 'Parse error',
        proposedFix: 'Unable to parse',
        fixedCode: originalCode,
      };
    }
  }

  /**
   * Test if fixed code works
   */
  private async testFix(
    code: string,
    language: string,
    context?: DebugRequest['context']
  ): Promise<boolean> {
    if (!context?.inputs && !context?.expectedOutput) {
      // Can't test without inputs/expected output - assume success
      return true;
    }

    try {
      const result = await sandboxService.executeCode(code, language, {
        input: context?.inputs,
        timeout: 5000,
      });

      if (!result.success) {
        return false;
      }

      // Check output if expected provided
      if (context?.expectedOutput) {
        return JSON.stringify(result.output) === JSON.stringify(context.expectedOutput);
      }

      return true;
    } catch (error: any) {
      logger.error({ error }, 'Test execution failed');
      return false;
    }
  }

  /**
   * Clean code (remove markdown, extra whitespace)
   */
  private cleanCode(code: string): string {
    return code.trim();
  }

  /**
   * Learn from successful debug fix
   */
  private async learnFromSuccess(
    request: DebugRequest,
    attempt: DebugAttempt
  ): Promise<void> {
    try {
      // Extract error pattern
      const errorPattern = this.extractErrorPattern(request.error);

      // Check if we already have this pattern
      const existingPattern = Array.from(this.debugPatterns.values()).find(
        p =>
          p.language === request.language &&
          p.errorPattern === errorPattern
      );

      if (existingPattern) {
        // Update existing pattern
        existingPattern.successCount++;
        existingPattern.confidence = Math.min(
          0.99,
          existingPattern.successCount / (existingPattern.successCount + existingPattern.failureCount)
        );
        existingPattern.examples.push(request.code.substring(0, 200));
        existingPattern.updatedAt = new Date();

        await this.saveDebugPattern(existingPattern);
      } else {
        // Create new pattern
        const pattern: DebugPattern = {
          id: uuidv4(),
          errorType: request.errorType || 'unknown',
          errorPattern,
          fixPattern: attempt.proposedFix,
          language: request.language,
          successCount: 1,
          failureCount: 0,
          confidence: 1.0,
          examples: [request.code.substring(0, 200)],
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        this.debugPatterns.set(pattern.id, pattern);
        await this.saveDebugPattern(pattern);
      }

      logger.info({ errorPattern }, 'Learned new debug pattern');
    } catch (error: any) {
      logger.error({ error }, 'Failed to learn from success');
    }
  }

  /**
   * Extract error pattern from error message
   */
  private extractErrorPattern(error: string): string {
    // Remove specific values/numbers to create pattern
    return error
      .replace(/\d+/g, 'N')
      .replace(/'[^']*'/g, 'STR')
      .replace(/"[^"]*"/g, 'STR')
      .replace(/\/[^\s]+/g, 'PATH')
      .substring(0, 100);
  }

  /**
   * Save debug pattern to database
   */
  private async saveDebugPattern(pattern: DebugPattern): Promise<void> {
    try {
      await database.query(`
        CREATE TABLE IF NOT EXISTS debug_patterns (
          id UUID PRIMARY KEY,
          error_type TEXT,
          error_pattern TEXT,
          fix_pattern TEXT,
          language TEXT,
          success_count INTEGER DEFAULT 0,
          failure_count INTEGER DEFAULT 0,
          confidence FLOAT DEFAULT 0.0,
          examples JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await database.query(
        `INSERT INTO debug_patterns
         (id, error_type, error_pattern, fix_pattern, language, success_count, failure_count, confidence, examples, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
         ON CONFLICT (id)
         DO UPDATE SET
           success_count = $6,
           failure_count = $7,
           confidence = $8,
           examples = $9,
           updated_at = CURRENT_TIMESTAMP`,
        [
          pattern.id,
          pattern.errorType,
          pattern.errorPattern,
          pattern.fixPattern,
          pattern.language,
          pattern.successCount,
          pattern.failureCount,
          pattern.confidence,
          JSON.stringify(pattern.examples),
        ]
      );
    } catch (error: any) {
      logger.error({ error, patternId: pattern.id }, 'Failed to save debug pattern');
    }
  }

  /**
   * Load debug patterns from database
   */
  private async loadDebugPatterns(): Promise<void> {
    try {
      const result = await database.query(`
        SELECT * FROM debug_patterns
        WHERE confidence > 0.5
        ORDER BY confidence DESC, updated_at DESC
        LIMIT 100
      `);

      result.rows.forEach(row => {
        const pattern: DebugPattern = {
          id: row.id,
          errorType: row.error_type,
          errorPattern: row.error_pattern,
          fixPattern: row.fix_pattern,
          language: row.language,
          successCount: row.success_count,
          failureCount: row.failure_count,
          confidence: row.confidence,
          examples: row.examples || [],
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        };

        this.debugPatterns.set(pattern.id, pattern);
      });

      logger.info({ patternsLoaded: this.debugPatterns.size }, 'Debug patterns loaded');
    } catch (error: any) {
      logger.debug({ error }, 'No debug patterns loaded (table may not exist yet)');
    }
  }

  /**
   * Get debug statistics
   */
  async getStats(): Promise<{
    totalPatterns: number;
    avgConfidence: number;
    byLanguage: Record<string, number>;
    topPatterns: Array<{
      errorType: string;
      confidence: number;
      successCount: number;
    }>;
  }> {
    const patterns = Array.from(this.debugPatterns.values());

    const byLanguage: Record<string, number> = {};
    patterns.forEach(p => {
      byLanguage[p.language] = (byLanguage[p.language] || 0) + 1;
    });

    const topPatterns = patterns
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10)
      .map(p => ({
        errorType: p.errorType,
        confidence: p.confidence,
        successCount: p.successCount,
      }));

    return {
      totalPatterns: patterns.length,
      avgConfidence:
        patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length || 0,
      byLanguage,
      topPatterns,
    };
  }
}

// Singleton instance
export const autoDebugger = new AutoDebugger();
export default autoDebugger;
