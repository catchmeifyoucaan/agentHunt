/**
 * Nuclei AI Template Generator Agent
 * Purpose: AI-powered custom Nuclei template generation
 * 
 * Features:
 * - Analyze vulnerability patterns
 * - Generate custom Nuclei templates
 * - Template optimization
 * - False positive reduction
 * - Template testing
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import ai from '../services/ai';
import { v4 as uuidv4 } from 'uuid';

interface NucleiGeneratorJob extends BaseJob {
  type: 'nuclei-generator';
  options: {
    programId: string;
    findingId?: string;
    vulnerabilityType?: string;
    targetUrl?: string;
    customPattern?: string;
  };
}

interface NucleiTemplate {
  id: string;
  name: string;
  severity: string;
  template: string;
  tags: string[];
  tested: boolean;
  falsePositiveRate?: number;
}

export class NucleiGeneratorAgent extends BaseAgent<NucleiGeneratorJob> {
  constructor() {
    super('nuclei-generator');
  }

  protected getSteps() {
    return [
      { name: 'Analyze vulnerability' },
      { name: 'Generate template' },
      { name: 'Optimize matchers' },
      { name: 'Test template' },
      { name: 'Store template' },
    ];
  }

  async process(job: Job<NucleiGeneratorJob>): Promise<any> {
    const { programId, options } = job.data;
    const { findingId, vulnerabilityType, targetUrl, customPattern } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Step 1: Analyze vulnerability
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 5,
        percentage: 10,
        currentTool: 'analyzer',
        toolStatus: 'running',
        message: 'Analyzing vulnerability pattern',
      });

      let finding: any = null;
      if (findingId) {
        finding = await this.loadFinding(findingId);
      }

      const analysis = await this.analyzeVulnerability(finding, vulnerabilityType, customPattern);

      // Step 2: Generate template
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 5,
        percentage: 30,
        currentTool: 'generator',
        toolStatus: 'running',
        message: 'Generating Nuclei template',
      });

      const template = await this.generateTemplate(analysis, finding);

      // Step 3: Optimize matchers
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 5,
        percentage: 55,
        currentTool: 'optimizer',
        toolStatus: 'running',
        message: 'Optimizing matchers',
      });

      const optimizedTemplate = await this.optimizeTemplate(template);

      // Step 4: Test template
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 5,
        percentage: 75,
        currentTool: 'tester',
        toolStatus: 'running',
        message: 'Testing template',
      });

      let testResult = { success: false, falsePositiveRate: 0 };
      if (targetUrl) {
        testResult = await this.testTemplate(optimizedTemplate, targetUrl);
      }

      // Step 5: Store template
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 5,
        percentage: 95,
        currentTool: 'storage',
        toolStatus: 'running',
        message: 'Storing template',
      });

      const nucleiTemplate: NucleiTemplate = {
        id: uuidv4(),
        name: analysis.name,
        severity: analysis.severity,
        template: optimizedTemplate,
        tags: analysis.tags,
        tested: testResult.success,
        falsePositiveRate: testResult.falsePositiveRate,
      };

      await this.storeTemplate(programId, nucleiTemplate);

      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 5,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: 'Template generated successfully',
      });

      const result = {
        templateId: nucleiTemplate.id,
        name: nucleiTemplate.name,
        severity: nucleiTemplate.severity,
        tested: nucleiTemplate.tested,
        template: nucleiTemplate.template,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error }, 'Nuclei template generation failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Load finding from database
   */
  private async loadFinding(findingId: string): Promise<any> {
    const result = await database.query('SELECT * FROM findings WHERE id = $1', [findingId]);
    return result.rows[0] || null;
  }

  /**
   * Analyze vulnerability pattern
   */
  private async analyzeVulnerability(
    finding: any,
    vulnerabilityType?: string,
    customPattern?: string
  ): Promise<any> {
    const type = finding?.type || vulnerabilityType || 'generic';
    
    // Base analysis
    const analysis = {
      name: `custom-${type}-${Date.now()}`,
      severity: finding?.severity || 'medium',
      type,
      tags: [type, 'custom', 'agenthunt'],
      pattern: customPattern || finding?.evidence?.payload || '',
      url: finding?.url || '',
      method: finding?.evidence?.method || 'GET',
      headers: finding?.evidence?.headers || {},
      body: finding?.evidence?.body || '',
      matchers: [],
    };

    // Use AI to enhance analysis
    try {
      const prompt = `Analyze this vulnerability and suggest Nuclei template matchers:

Type: ${type}
URL: ${analysis.url}
Pattern: ${analysis.pattern}
Evidence: ${JSON.stringify(finding?.evidence || {})}

Suggest:
1. HTTP matchers (status codes, headers, body patterns)
2. Regex patterns for detection
3. Word matchers
4. DSL conditions

Respond with JSON: { "matchers": [...], "extractors": [...], "conditions": [...] }`;

      const response = await this.callAI(prompt);
      try {
        const aiAnalysis = JSON.parse(response);
        analysis.matchers = aiAnalysis.matchers || [];
      } catch {}
    } catch {}

    return analysis;
  }

  /**
   * Generate Nuclei template
   */
  private async generateTemplate(analysis: any, finding: any): Promise<string> {
    const templateId = `agenthunt-${analysis.type}-${Date.now()}`;
    
    // Build matchers
    const matchers = this.buildMatchers(analysis, finding);
    
    // Build extractors
    const extractors = this.buildExtractors(analysis);

    const template = `id: ${templateId}

info:
  name: ${analysis.name}
  author: agenthunt
  severity: ${analysis.severity}
  description: Auto-generated template for ${analysis.type} detection
  tags: ${analysis.tags.join(',')}
  reference:
    - https://owasp.org/

http:
  - method: ${analysis.method}
    path:
      - "{{BaseURL}}${analysis.url ? new URL(analysis.url).pathname : '/'}"
${analysis.headers && Object.keys(analysis.headers).length > 0 ? `    headers:
${Object.entries(analysis.headers).map(([k, v]) => `      ${k}: "${v}"`).join('\n')}` : ''}
${analysis.body ? `    body: |
      ${analysis.body}` : ''}

    matchers-condition: and
    matchers:
${matchers}

${extractors ? `    extractors:
${extractors}` : ''}
`;

    return template;
  }

  /**
   * Build matchers for template
   */
  private buildMatchers(analysis: any, finding: any): string {
    const matchers: string[] = [];

    // Status code matcher
    matchers.push(`      - type: status
        status:
          - 200`);

    // Word matchers based on vulnerability type
    const wordMatchers = this.getWordMatchersForType(analysis.type, finding);
    if (wordMatchers.length > 0) {
      matchers.push(`      - type: word
        words:
${wordMatchers.map(w => `          - "${w}"`).join('\n')}
        condition: or`);
    }

    // Regex matchers
    const regexMatchers = this.getRegexMatchersForType(analysis.type, finding);
    if (regexMatchers.length > 0) {
      matchers.push(`      - type: regex
        regex:
${regexMatchers.map(r => `          - "${r}"`).join('\n')}`);
    }

    return matchers.join('\n\n');
  }

  /**
   * Get word matchers for vulnerability type
   */
  private getWordMatchersForType(type: string, finding: any): string[] {
    const typeMatchers: Record<string, string[]> = {
      'xss': ['<script', 'javascript:', 'onerror=', 'onload=', 'alert('],
      'sqli': ['SQL syntax', 'mysql_fetch', 'ORA-', 'PostgreSQL', 'sqlite3'],
      'ssrf': ['127.0.0.1', 'localhost', 'internal', 'metadata'],
      'lfi': ['root:x:', '/etc/passwd', 'win.ini', '[extensions]'],
      'rce': ['uid=', 'gid=', 'root', 'www-data'],
      'xxe': ['<!ENTITY', 'SYSTEM', 'file://'],
      'ssti': ['{{', '${', '<%=', '{#'],
    };

    const matchers = typeMatchers[type.toLowerCase()] || [];
    
    // Add custom pattern if available
    if (finding?.evidence?.payload) {
      matchers.push(finding.evidence.payload);
    }

    return matchers;
  }

  /**
   * Get regex matchers for vulnerability type
   */
  private getRegexMatchersForType(type: string, finding: any): string[] {
    const typeRegex: Record<string, string[]> = {
      'xss': ['<script[^>]*>.*?</script>', 'on\\w+\\s*='],
      'sqli': ['SQL.*error', 'mysql.*error', 'ORA-\\d+'],
      'ssrf': ['\\b(?:127\\.0\\.0\\.1|localhost|10\\.\\d+\\.\\d+\\.\\d+)\\b'],
      'lfi': ['root:[x*]:\\d+:\\d+:', '\\[boot loader\\]'],
      'rce': ['uid=\\d+.*gid=\\d+', 'Linux.*\\d+\\.\\d+'],
    };

    return typeRegex[type.toLowerCase()] || [];
  }

  /**
   * Build extractors
   */
  private buildExtractors(analysis: any): string {
    return `      - type: regex
        name: extracted
        regex:
          - "([a-zA-Z0-9_-]+)"
        group: 1`;
  }

  /**
   * Optimize template
   */
  private async optimizeTemplate(template: string): Promise<string> {
    try {
      const prompt = `Optimize this Nuclei template for better detection and fewer false positives:

${template}

Improvements to make:
1. Add more specific matchers
2. Reduce false positive potential
3. Add negative matchers if needed
4. Optimize regex patterns

Return the improved YAML template only.`;

      const response = await this.callAI(prompt);
      
      // Validate it's still valid YAML
      if (response.includes('id:') && response.includes('http:')) {
        return response;
      }
      return template;
    } catch {
      return template;
    }
  }

  /**
   * Test template against target
   */
  private async testTemplate(template: string, targetUrl: string): Promise<{ success: boolean; falsePositiveRate: number }> {
    try {
      // Write template to temp file and run nuclei
      const fs = require('fs/promises');
      const path = require('path');
      const os = require('os');

      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nuclei-'));
      const templatePath = path.join(tmpDir, 'template.yaml');
      
      await fs.writeFile(templatePath, template);

      const result = await this.executeCommand(
        `nuclei -t ${templatePath} -u ${targetUrl} -silent -json`,
        { timeout: 60000 }
      );

      await fs.rm(tmpDir, { recursive: true });

      if (result.exitCode === 0 && result.stdout) {
        return { success: true, falsePositiveRate: 0 };
      }

      return { success: false, falsePositiveRate: 0 };
    } catch (error) {
      logger.debug({ error }, 'Template test failed');
      return { success: false, falsePositiveRate: 0 };
    }
  }

  /**
   * Store template in database
   */
  private async storeTemplate(programId: string, template: NucleiTemplate): Promise<void> {
    try {
      await database.query(
        `INSERT INTO nuclei_templates (id, program_id, name, severity, template, tags, tested, fp_rate, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [
          template.id,
          programId,
          template.name,
          template.severity,
          template.template,
          template.tags,
          template.tested,
          template.falsePositiveRate,
        ]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store template');
    }
  }

  /**
   * Call AI service
   */
  private async callAI(prompt: string): Promise<string> {
    try {
      const response = await (ai as any).generateText?.(prompt) ||
                       await (ai as any).chat?.([{ role: 'user', content: prompt }]) ||
                       '';
      return response;
    } catch {
      return '';
    }
  }
}

export default new NucleiGeneratorAgent();
