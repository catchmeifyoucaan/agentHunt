/**
 * Dynamic Handoff Router
 * Purpose: Intelligent, dynamic routing of findings between agents
 * 
 * This is the BRAIN of the agent orchestration system.
 * Every agent publishes findings here, and this router automatically
 * determines which other agents should receive them.
 * 
 * Features:
 * - Pattern-based routing rules
 * - AI-powered routing decisions
 * - Multi-cast to multiple agents
 * - Priority-based queuing
 * - Feedback loop for learning
 * - Real-time event streaming
 */

import database from './database';
import redis from './redis';
import queue from './queue';
import logger from '../utils/logger';
import ai from './ai';
import { v4 as uuidv4 } from 'uuid';
import { AgentType } from '../../../shared/types';

// Finding categories that trigger specific agent routing
interface FindingSignal {
  id: string;
  sourceAgent: AgentType;
  programId: string;
  jobId: string;
  signalType: SignalType;
  data: any;
  confidence: number;
  timestamp: Date;
}

type SignalType = 
  | 'url_discovered'
  | 'parameter_found'
  | 'endpoint_found'
  | 'js_file_found'
  | 'form_found'
  | 'api_endpoint'
  | 'graphql_endpoint'
  | 'websocket_endpoint'
  | 'auth_endpoint'
  | 'file_upload'
  | 'redirect_found'
  | 'cookie_found'
  | 'header_found'
  | 'technology_detected'
  | 'vulnerability_potential'
  | 'dom_sink_found'
  | 'reflection_found'
  | 'error_message'
  | 'database_error'
  | 'template_syntax'
  | 'serialized_data'
  | 'jwt_token'
  | 'oauth_flow'
  | 'ssrf_potential'
  | 'lfi_potential'
  | 'rce_potential'
  | 'idor_potential'
  | 'open_redirect'
  | 'cors_misconfiguration'
  | 'cache_header'
  | 'waf_detected'
  | 'rate_limit'
  | 'subdomain_found'
  | 'port_open'
  | 'service_detected'
  | 'cloud_resource'
  | 'secret_found'
  | 'sensitive_file'
  | 'strategy_update';

// Routing rules: signal type -> target agents with priority
export const ROUTING_RULES: Record<SignalType, { agents: AgentType[]; priority: number; condition?: (data: any) => boolean }[]> = {
  'strategy_update': [
    { agents: ['manager'], priority: 10 }, // Manager always gets updates
    // Broadest possible distribution for learning
    { agents: ['scanner', 'webvulns', 'sqli', 'xss', 'ssrf', 'lfi', 'rce', 'idor', 'authbypass', 'oauth', 'jwt-attack', 'csrf', 'cors', 'cache-poisoning', 'request-smuggling', 'templateinjection', 'deserialization', 'prototype-pollution', 'xxe', 'cloudmisconfig', 'cloud-storage', 'secrethunter', 'github-secrets', 'subdomain-takeover', 'portscan'], priority: 5 }
  ],
  'url_discovered': [
    { agents: ['crawl', 'fingerprint'], priority: 8 },
    { agents: ['scanner'], priority: 7 },
    { agents: ['parameter-discovery'], priority: 6 },
  ],
  'parameter_found': [
    { agents: ['xss', 'sqli', 'ssrf', 'templateinjection'], priority: 9 },
    { agents: ['intelligent-fuzz'], priority: 8 },
    { agents: ['waf-bypass'], priority: 7 },
  ],
  'endpoint_found': [
    { agents: ['scanner', 'webvulns'], priority: 8 },
    { agents: ['apifuzz', 'idor'], priority: 7 },
    { agents: ['authbypass'], priority: 6 },
  ],
  'js_file_found': [
    { agents: ['jsanalysis'], priority: 9 },
    { agents: ['secrethunter'], priority: 8 },
    { agents: ['xss'], priority: 7, condition: (d) => d.content?.includes('innerHTML') || d.content?.includes('eval') },
  ],
  'form_found': [
    { agents: ['xss', 'csrf'], priority: 9 },
    { agents: ['sqli'], priority: 8, condition: (d) => d.action?.includes('login') || d.action?.includes('search') },
    { agents: ['authbypass'], priority: 7, condition: (d) => d.hasPasswordField },
  ],
  'api_endpoint': [
    { agents: ['apifuzz', 'apifuzzing'], priority: 9 },
    { agents: ['idor', 'authbypass'], priority: 8 },
    { agents: ['sqli', 'ssrf'], priority: 7 },
  ],
  'graphql_endpoint': [
    { agents: ['graphql'], priority: 10 },
    { agents: ['sqli', 'idor'], priority: 8 },
  ],
  'websocket_endpoint': [
    { agents: ['websocket'], priority: 10 },
    { agents: ['xss'], priority: 7 },
  ],
  'auth_endpoint': [
    { agents: ['authbypass', 'oauth', 'jwt-attack'], priority: 10 },
    { agents: ['bruteforce'], priority: 7 },
    { agents: ['business-logic'], priority: 8 },
  ],
  'file_upload': [
    { agents: ['webvulns'], priority: 10 },
    { agents: ['scanner'], priority: 8 },
  ],
  'redirect_found': [
    { agents: ['xss'], priority: 8, condition: (d) => d.url?.includes('url=') || d.url?.includes('redirect=') },
    { agents: ['ssrf'], priority: 9 },
    { agents: ['oauth'], priority: 7 },
  ],
  'cookie_found': [
    { agents: ['xss', 'csrf'], priority: 8 },
    { agents: ['authbypass'], priority: 7, condition: (d) => !d.httpOnly || !d.secure },
  ],
  'header_found': [
    { agents: ['cache-poisoning'], priority: 9, condition: (d) => d.name?.toLowerCase().includes('cache') },
    { agents: ['cors'], priority: 9, condition: (d) => d.name?.toLowerCase().includes('access-control') },
    { agents: ['request-smuggling'], priority: 8, condition: (d) => d.name?.toLowerCase() === 'transfer-encoding' },
  ],
  'technology_detected': [
    { agents: ['scanner'], priority: 8 },
    { agents: ['templateinjection'], priority: 9, condition: (d) => ['jinja', 'twig', 'freemarker', 'velocity', 'thymeleaf'].some(t => d.tech?.toLowerCase().includes(t)) },
    { agents: ['deserialization'], priority: 9, condition: (d) => ['java', 'php', 'python', '.net'].some(t => d.tech?.toLowerCase().includes(t)) },
    { agents: ['prototype-pollution'], priority: 9, condition: (d) => d.tech?.toLowerCase().includes('node') || d.tech?.toLowerCase().includes('express') },
  ],
  'vulnerability_potential': [
    { agents: ['scanner', 'confirm'], priority: 10 },
    { agents: ['exploit-chain'], priority: 8 },
  ],
  'dom_sink_found': [
    { agents: ['xss'], priority: 10 },
    { agents: ['browser'], priority: 9 },
  ],
  'reflection_found': [
    { agents: ['xss'], priority: 10 },
    { agents: ['templateinjection'], priority: 9 },
    { agents: ['sqli'], priority: 8 },
  ],
  'error_message': [
    { agents: ['sqli'], priority: 9, condition: (d) => d.message?.toLowerCase().includes('sql') || d.message?.toLowerCase().includes('query') },
    { agents: ['templateinjection'], priority: 9, condition: (d) => d.message?.includes('template') || d.message?.includes('render') },
    { agents: ['lfi'], priority: 8, condition: (d) => d.message?.includes('file') || d.message?.includes('path') },
  ],
  'database_error': [
    { agents: ['sqli'], priority: 10 },
    { agents: ['scanner'], priority: 8 },
  ],
  'template_syntax': [
    { agents: ['templateinjection'], priority: 10 },
    { agents: ['xss'], priority: 8 },
  ],
  'serialized_data': [
    { agents: ['deserialization'], priority: 10 },
    { agents: ['xxe'], priority: 9, condition: (d) => d.format === 'xml' },
  ],
  'jwt_token': [
    { agents: ['jwt-attack'], priority: 10 },
    { agents: ['authbypass'], priority: 8 },
  ],
  'oauth_flow': [
    { agents: ['oauth'], priority: 10 },
    { agents: ['authbypass'], priority: 8 },
    { agents: ['xss'], priority: 7, condition: (d) => d.hasRedirect },
  ],
  'ssrf_potential': [
    { agents: ['ssrf'], priority: 10 },
    { agents: ['scanner'], priority: 8 },
  ],
  'lfi_potential': [
    { agents: ['webvulns'], priority: 10 },
    { agents: ['scanner'], priority: 8 },
  ],
  'rce_potential': [
    { agents: ['scanner'], priority: 10 },
    { agents: ['deserialization'], priority: 9 },
  ],
  'idor_potential': [
    { agents: ['idor'], priority: 10 },
    { agents: ['authbypass'], priority: 8 },
  ],
  'open_redirect': [
    { agents: ['xss'], priority: 9 },
    { agents: ['oauth'], priority: 8 },
    { agents: ['ssrf'], priority: 7 },
  ],
  'cors_misconfiguration': [
    { agents: ['cors'], priority: 10 },
    { agents: ['xss'], priority: 8 },
  ],
  'cache_header': [
    { agents: ['cache-poisoning'], priority: 10 },
    { agents: ['request-smuggling'], priority: 8 },
  ],
  'waf_detected': [
    { agents: ['waf-bypass'], priority: 10 },
    { agents: ['payload-engine'], priority: 9 },
  ],
  'rate_limit': [
    { agents: ['racecondition'], priority: 9 },
    { agents: ['business-logic'], priority: 8 },
  ],
  'subdomain_found': [
    { agents: ['fingerprint'], priority: 9 },
    { agents: ['portscan'], priority: 8 },
    { agents: ['subdomain-takeover'], priority: 10 },
  ],
  'port_open': [
    { agents: ['scanner'], priority: 9 },
    { agents: ['fingerprint'], priority: 8 },
  ],
  'service_detected': [
    { agents: ['scanner'], priority: 9 },
    { agents: ['webvulns'], priority: 8, condition: (d) => d.service === 'http' || d.service === 'https' },
  ],
  'cloud_resource': [
    { agents: ['cloud-storage', 'cloudmisconfig'], priority: 10 },
    { agents: ['ssrf'], priority: 8 },
  ],
  'secret_found': [
    { agents: ['secrethunter', 'github-secrets'], priority: 10 },
    { agents: ['triage'], priority: 9 },
  ],
  'sensitive_file': [
    { agents: ['scanner'], priority: 9 },
    { agents: ['secrethunter'], priority: 10 },
  ],
};

// Agent capabilities for AI-based routing
const AGENT_CAPABILITIES: Record<string, string[]> = {
  'xss': ['reflected xss', 'stored xss', 'dom xss', 'javascript injection', 'html injection', 'script execution'],
  'sqli': ['sql injection', 'database extraction', 'authentication bypass', 'data manipulation', 'blind sqli', 'time-based sqli'],
  'ssrf': ['server-side request forgery', 'internal network access', 'cloud metadata', 'port scanning', 'protocol smuggling'],
  'idor': ['insecure direct object reference', 'authorization bypass', 'horizontal privilege escalation', 'vertical privilege escalation'],
  'csrf': ['cross-site request forgery', 'state-changing actions', 'token bypass'],
  'xxe': ['xml external entity', 'file disclosure', 'ssrf via xxe', 'denial of service'],
  'templateinjection': ['server-side template injection', 'ssti', 'code execution', 'sandbox escape'],
  'deserialization': ['insecure deserialization', 'object injection', 'remote code execution', 'java deserialization', 'php deserialization'],
  'authbypass': ['authentication bypass', 'session hijacking', 'password reset flaws', 'mfa bypass'],
  'oauth': ['oauth vulnerabilities', 'redirect_uri manipulation', 'token theft', 'scope escalation', 'state bypass'],
  'jwt-attack': ['jwt vulnerabilities', 'algorithm confusion', 'signature bypass', 'claim tampering', 'key confusion'],
  'request-smuggling': ['http request smuggling', 'cl.te', 'te.cl', 'http desync', 'cache poisoning'],
  'cache-poisoning': ['web cache poisoning', 'cache deception', 'unkeyed headers', 'parameter cloaking'],
  'prototype-pollution': ['prototype pollution', 'property injection', 'rce via pollution', 'dos'],
  'business-logic': ['business logic flaws', 'race conditions', 'payment manipulation', 'workflow bypass'],
  'waf-bypass': ['waf evasion', 'filter bypass', 'encoding bypass', 'payload obfuscation'],
  'portscan': ['port scanning', 'service discovery', 'network mapping'],
  'fingerprint': ['technology detection', 'version identification', 'cms detection'],
  'crawl': ['web crawling', 'link discovery', 'content extraction', 'sitemap parsing'],
  'jsanalysis': ['javascript analysis', 'endpoint extraction', 'secret detection', 'dom sink analysis'],
};

class DynamicHandoffRouter {
  private signalBuffer: FindingSignal[] = [];
  private processingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor() {
    this.startProcessing();
  }

  /**
   * Publish a finding signal from any agent
   * This is the main entry point for all agents to share discoveries
   */
  async publishSignal(signal: Omit<FindingSignal, 'id' | 'timestamp'>): Promise<string> {
    const fullSignal: FindingSignal = {
      ...signal,
      id: uuidv4(),
      timestamp: new Date(),
    };

    // Store in buffer for batch processing
    this.signalBuffer.push(fullSignal);

    // Also store in Redis for real-time streaming
    await redis.lpush(`signals:${signal.programId}`, JSON.stringify(fullSignal));
    await redis.ltrim(`signals:${signal.programId}`, 0, 999); // Keep last 1000

    // Publish for real-time subscribers
    await redis.publish(`program:${signal.programId}:signals`, JSON.stringify(fullSignal));

    logger.debug({
      signalId: fullSignal.id,
      type: signal.signalType,
      source: signal.sourceAgent,
    }, 'Signal published');

    // Process immediately for high-priority signals
    if (signal.confidence >= 0.9) {
      await this.processSignal(fullSignal);
    }

    return fullSignal.id;
  }

  /**
   * Start background processing of signals
   */
  private startProcessing(): void {
    this.processingInterval = setInterval(async () => {
      if (this.isProcessing || this.signalBuffer.length === 0) return;

      this.isProcessing = true;
      try {
        const signals = this.signalBuffer.splice(0, 50); // Process 50 at a time
        await Promise.all(signals.map(s => this.processSignal(s)));
      } catch (error) {
        logger.error({ error }, 'Error processing signal batch');
      } finally {
        this.isProcessing = false;
      }
    }, 100); // Process every 100ms
  }

  /**
   * Process a single signal and route to appropriate agents
   */
  private async processSignal(signal: FindingSignal): Promise<void> {
    const routes = await this.determineRoutes(signal);

    for (const route of routes) {
      await this.createHandoff(signal, route.agent, route.priority, route.reason);
    }

    // Store signal for analytics
    await this.storeSignal(signal, routes);
  }

  /**
   * Determine which agents should receive this signal
   */
  private async determineRoutes(signal: FindingSignal): Promise<{ agent: AgentType; priority: number; reason: string }[]> {
    const routes: { agent: AgentType; priority: number; reason: string }[] = [];

    // 1. Rule-based routing
    const rules = ROUTING_RULES[signal.signalType];
    if (rules) {
      for (const rule of rules) {
        // Check condition if exists
        if (rule.condition && !rule.condition(signal.data)) {
          continue;
        }

        for (const agent of rule.agents) {
          // Don't route back to source
          if (agent === signal.sourceAgent) continue;

          routes.push({
            agent,
            priority: Math.round(rule.priority * signal.confidence),
            reason: `Rule-based: ${signal.signalType} -> ${agent}`,
          });
        }
      }
    }

    // 2. AI-based routing for complex signals
    if (signal.confidence >= 0.7 && routes.length < 3) {
      const aiRoutes = await this.getAIRoutes(signal);
      routes.push(...aiRoutes);
    }

    // 3. Context-based routing (based on program history)
    const contextRoutes = await this.getContextRoutes(signal);
    routes.push(...contextRoutes);

    // Deduplicate and sort by priority
    const uniqueRoutes = this.deduplicateRoutes(routes);
    return uniqueRoutes.sort((a, b) => b.priority - a.priority).slice(0, 10);
  }

  /**
   * Get AI-powered routing suggestions
   */
  private async getAIRoutes(signal: FindingSignal): Promise<{ agent: AgentType; priority: number; reason: string }[]> {
    try {
      const prompt = `You are a security testing orchestrator. Given this finding signal, determine which security testing agents should investigate further.

Signal Type: ${signal.signalType}
Source Agent: ${signal.sourceAgent}
Data: ${JSON.stringify(signal.data).substring(0, 500)}
Confidence: ${signal.confidence}

Available agents and their capabilities:
${Object.entries(AGENT_CAPABILITIES).map(([agent, caps]) => `- ${agent}: ${caps.join(', ')}`).join('\n')}

Return a JSON array of agents that should investigate, with priority (1-10) and reason:
[{"agent": "xss", "priority": 9, "reason": "Reflected input detected"}]

Only return agents that are highly relevant. Max 3 agents.`;

      const response = await this.callAI(prompt);
      try {
        const aiRoutes = JSON.parse(response);
        return aiRoutes.filter((r: any) => 
          r.agent && r.priority && r.agent !== signal.sourceAgent
        ).map((r: any) => ({
          agent: r.agent as AgentType,
          priority: r.priority,
          reason: `AI: ${r.reason}`,
        }));
      } catch {
        return [];
      }
    } catch {
      return [];
    }
  }

  /**
   * Get context-based routes from program history
   */
  private async getContextRoutes(signal: FindingSignal): Promise<{ agent: AgentType; priority: number; reason: string }[]> {
    try {
      // Find successful patterns from this program
      const result = await database.query(
        `SELECT to_agent_type, COUNT(*) as count, AVG(confidence) as avg_confidence
         FROM signal_routes
         WHERE program_id = $1 AND signal_type = $2 AND success = true
         GROUP BY to_agent_type
         ORDER BY count DESC, avg_confidence DESC
         LIMIT 3`,
        [signal.programId, signal.signalType]
      );

      return result.rows.map((row: any) => ({
        agent: row.to_agent_type as AgentType,
        priority: Math.round(row.avg_confidence * 10),
        reason: `Historical: ${row.count} successful handoffs`,
      }));
    } catch {
      return [];
    }
  }

  /**
   * Deduplicate routes, keeping highest priority for each agent
   */
  private deduplicateRoutes(routes: { agent: AgentType; priority: number; reason: string }[]): { agent: AgentType; priority: number; reason: string }[] {
    const agentMap = new Map<AgentType, { agent: AgentType; priority: number; reason: string }>();

    for (const route of routes) {
      const existing = agentMap.get(route.agent);
      if (!existing || route.priority > existing.priority) {
        agentMap.set(route.agent, route);
      }
    }

    return Array.from(agentMap.values());
  }

  /**
   * Create a handoff to target agent
   */
  private async createHandoff(
    signal: FindingSignal,
    targetAgent: AgentType,
    priority: number,
    reason: string
  ): Promise<void> {
    try {
      const handoffId = uuidv4();

      // Create job for target agent
      await queue.addJob(targetAgent, {
        id: uuidv4(),
        type: targetAgent,
        programId: signal.programId,
        priority,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
        options: {
          ...signal.data,
          sourceSignal: signal.id,
          sourceAgent: signal.sourceAgent,
          signalType: signal.signalType,
        },
        metadata: {
          handoffId,
          sourceJobId: signal.jobId,
          routingReason: reason,
          confidence: signal.confidence,
        },
        createdAt: new Date(),
      });

      // Store handoff record
      await database.query(
        `INSERT INTO dynamic_handoffs (id, signal_id, from_agent, to_agent, program_id, priority, reason, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [handoffId, signal.id, signal.sourceAgent, targetAgent, signal.programId, priority, reason]
      );

      // Publish event
      await redis.publish(`program:${signal.programId}:handoffs`, JSON.stringify({
        handoffId,
        signalId: signal.id,
        from: signal.sourceAgent,
        to: targetAgent,
        priority,
        reason,
        timestamp: new Date().toISOString(),
      }));

      logger.info({
        handoffId,
        from: signal.sourceAgent,
        to: targetAgent,
        signalType: signal.signalType,
        priority,
      }, 'Dynamic handoff created');

    } catch (error) {
      logger.error({ error, signal, targetAgent }, 'Failed to create dynamic handoff');
    }
  }

  /**
   * Store signal for analytics
   */
  private async storeSignal(signal: FindingSignal, routes: { agent: AgentType; priority: number; reason: string }[]): Promise<void> {
    try {
      await database.query(
        `INSERT INTO finding_signals (id, source_agent, program_id, job_id, signal_type, data, confidence, routes, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [
          signal.id,
          signal.sourceAgent,
          signal.programId,
          signal.jobId,
          signal.signalType,
          JSON.stringify(signal.data),
          signal.confidence,
          JSON.stringify(routes),
        ]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to store signal');
    }
  }

  /**
   * Record feedback on handoff success/failure
   */
  async recordFeedback(handoffId: string, success: boolean, findingId?: string): Promise<void> {
    try {
      await database.query(
        `UPDATE dynamic_handoffs SET success = $1, finding_id = $2, completed_at = CURRENT_TIMESTAMP WHERE id = $3`,
        [success, findingId, handoffId]
      );

      // Also update signal_routes for learning
      const handoff = await database.query(
        `SELECT signal_id, from_agent, to_agent, program_id FROM dynamic_handoffs WHERE id = $1`,
        [handoffId]
      );

      if (handoff.rows[0]) {
        const h = handoff.rows[0];
        const signal = await database.query(
          `SELECT signal_type, confidence FROM finding_signals WHERE id = $1`,
          [h.signal_id]
        );

        if (signal.rows[0]) {
          await database.query(
            `INSERT INTO signal_routes (id, program_id, signal_type, from_agent, to_agent, confidence, success, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
            [uuidv4(), h.program_id, signal.rows[0].signal_type, h.from_agent, h.to_agent, signal.rows[0].confidence, success]
          );
        }
      }
    } catch (error) {
      logger.error({ error, handoffId }, 'Failed to record feedback');
    }
  }

  /**
   * Get routing statistics
   */
  async getStats(programId?: string): Promise<any> {
    try {
      const whereClause = programId ? 'WHERE program_id = $1' : '';
      const params = programId ? [programId] : [];

      const result = await database.query(
        `SELECT 
           COUNT(*) as total_handoffs,
           COUNT(CASE WHEN success = true THEN 1 END) as successful,
           COUNT(CASE WHEN success = false THEN 1 END) as failed,
           AVG(CASE WHEN success = true THEN 1 ELSE 0 END) as success_rate
         FROM dynamic_handoffs ${whereClause}`,
        params
      );

      const topRoutes = await database.query(
        `SELECT from_agent, to_agent, COUNT(*) as count, 
                AVG(CASE WHEN success = true THEN 1 ELSE 0 END) as success_rate
         FROM dynamic_handoffs ${whereClause}
         GROUP BY from_agent, to_agent
         ORDER BY count DESC
         LIMIT 20`,
        params
      );

      return {
        summary: result.rows[0],
        topRoutes: topRoutes.rows,
      };
    } catch (error) {
      logger.error({ error }, 'Failed to get stats');
      return { summary: {}, topRoutes: [] };
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

  /**
   * Cleanup
   */
  destroy(): void {
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
  }
}

// Singleton instance
export const dynamicRouter = new DynamicHandoffRouter();
export default dynamicRouter;
