/**
 * OpenTelemetry Distributed Tracing Service
 *
 * Provides comprehensive observability for multi-agent workflows:
 * - Agent execution traces (Discovery → Fingerprint → Scanner → Triage chains)
 * - Tool execution tracking (Nuclei, HTTPx, DNSx, etc.)
 * - AI decision tracking (LLM prompts, responses, costs)
 * - Performance metrics (bottleneck identification)
 * - Error tracking (failed jobs, tool failures)
 *
 * Integration: Phoenix Dashboard (http://localhost:6006)
 *
 * Phoenix Features Utilized:
 * - LLM Tracing: Input/output, tokens, latency, cost
 * - Agent Tracing: Multi-step workflows with parent-child spans
 * - Tool Tracing: External tool executions (nuclei, httpx, etc.)
 * - Error Tracking: Exceptions with full stack traces
 * - Custom Attributes: Security-specific metadata
 */

import logger from '../utils/logger';
import { trace, context, SpanStatusCode, Span, SpanKind } from '@opentelemetry/api';

/**
 * Initialize OpenTelemetry SDK with Phoenix backend
 *
 * Environment Variables:
 * - OTEL_ENABLED: Enable/disable tracing (default: false for compatibility)
 * - PHOENIX_ENDPOINT: Phoenix endpoint (default: http://localhost:6006)
 * - OTEL_SERVICE_NAME: Service name (default: agenthunt)
 */
// LLM Semantic Conventions (OpenTelemetry GenAI)
const LLM_ATTRIBUTES = {
  SYSTEM: 'gen_ai.system',
  REQUEST_MODEL: 'gen_ai.request.model',
  REQUEST_MAX_TOKENS: 'gen_ai.request.max_tokens',
  REQUEST_TEMPERATURE: 'gen_ai.request.temperature',
  RESPONSE_MODEL: 'gen_ai.response.model',
  USAGE_INPUT_TOKENS: 'gen_ai.usage.input_tokens',
  USAGE_OUTPUT_TOKENS: 'gen_ai.usage.output_tokens',
  USAGE_TOTAL_TOKENS: 'gen_ai.usage.total_tokens',
  PROMPT: 'gen_ai.prompt',
  COMPLETION: 'gen_ai.completion',
};

// Security-specific attributes
const SECURITY_ATTRIBUTES = {
  TARGET_URL: 'security.target.url',
  TARGET_DOMAIN: 'security.target.domain',
  VULNERABILITY_TYPE: 'security.vulnerability.type',
  SEVERITY: 'security.severity',
  TOOL_NAME: 'security.tool.name',
  TOOL_VERSION: 'security.tool.version',
  FINDING_ID: 'security.finding.id',
  PROGRAM_ID: 'security.program.id',
};

class TracingService {
  private enabled: boolean = false;
  private tracer = trace.getTracer('agenthunt', '1.0.0');

  constructor() {
    // Enable tracing by default, unless explicitly disabled
    // This provides better observability out of the box
    const explicitlyDisabled = process.env.OTEL_ENABLED === 'false';
    this.enabled = !explicitlyDisabled;

    if (explicitlyDisabled) {
      logger.info('OpenTelemetry tracing explicitly disabled (OTEL_ENABLED=false)');
      return;
    }

    logger.info('Initializing OpenTelemetry tracing (set OTEL_ENABLED=false to disable)');
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const phoenixEndpoint = process.env.PHOENIX_ENDPOINT || 'http://localhost:6006';
      const serviceName = process.env.OTEL_SERVICE_NAME || 'agenthunt';

      // Dynamically import Phoenix OTEL if available
      try {
        const { register } = await import('@arizeai/phoenix-otel');
        register({
          url: phoenixEndpoint,
          projectName: serviceName,
          batch: true,
          global: true,
        });

        logger.info(
          {
            phoenixEndpoint,
            serviceName,
          },
          'Phoenix OpenTelemetry tracing initialized successfully'
        );

        // Graceful shutdown handler
        process.on('SIGTERM', async () => {
          await this.shutdown();
        });
      } catch (importError) {
        logger.warn(
          'Phoenix OTEL package not installed. Tracing will be disabled. Install @arizeai/phoenix-otel to enable.'
        );
        this.enabled = false;
      }
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Phoenix OpenTelemetry tracing');
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Method to suppress tracing when needed (no-op for now)
  suppressTracing(): void {
    // Phoenix OTEL doesn't have a suppress method
    // This is a no-op
  }

  async shutdown(): Promise<void> {
    try {
      logger.info('Phoenix OpenTelemetry tracer shut down successfully');
    } catch (error) {
      logger.error({ error }, 'Error shutting down Phoenix OpenTelemetry tracer');
    }
  }

  /**
   * Create a span for LLM calls with full input/output logging
   * This enables Phoenix's LLM tracing features
   */
  startLLMSpan(
    operationName: string,
    options: {
      provider: string;
      model: string;
      temperature?: number;
      maxTokens?: number;
      prompt?: string;
    }
  ): Span {
    if (!this.enabled) {
      return trace.getTracer('noop').startSpan('noop');
    }

    const span = this.tracer.startSpan(`llm.${operationName}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        [LLM_ATTRIBUTES.SYSTEM]: options.provider,
        [LLM_ATTRIBUTES.REQUEST_MODEL]: options.model,
        [LLM_ATTRIBUTES.REQUEST_TEMPERATURE]: options.temperature || 0,
        [LLM_ATTRIBUTES.REQUEST_MAX_TOKENS]: options.maxTokens || 4096,
        // Store prompt for Phoenix LLM tracing (truncate if too long)
        [LLM_ATTRIBUTES.PROMPT]: options.prompt?.slice(0, 10000) || '',
      },
    });

    return span;
  }

  /**
   * Complete an LLM span with response data
   */
  completeLLMSpan(
    span: Span,
    response: {
      content: string;
      inputTokens?: number;
      outputTokens?: number;
      totalTokens?: number;
      model?: string;
      costUsd?: number;
    }
  ): void {
    if (!this.enabled) return;

    span.setAttributes({
      [LLM_ATTRIBUTES.COMPLETION]: response.content?.slice(0, 10000) || '',
      [LLM_ATTRIBUTES.USAGE_INPUT_TOKENS]: response.inputTokens || 0,
      [LLM_ATTRIBUTES.USAGE_OUTPUT_TOKENS]: response.outputTokens || 0,
      [LLM_ATTRIBUTES.USAGE_TOTAL_TOKENS]: response.totalTokens || 0,
      [LLM_ATTRIBUTES.RESPONSE_MODEL]: response.model || '',
      'llm.cost_usd': response.costUsd || 0,
    });
    span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  /**
   * Create a span for security tool execution
   */
  startToolSpan(
    toolName: string,
    options: {
      target?: string;
      domain?: string;
      programId?: string;
      jobId?: string;
      toolVersion?: string;
      command?: string;
    }
  ): Span {
    if (!this.enabled) {
      return trace.getTracer('noop').startSpan('noop');
    }

    const span = this.tracer.startSpan(`tool.${toolName}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        [SECURITY_ATTRIBUTES.TOOL_NAME]: toolName,
        [SECURITY_ATTRIBUTES.TOOL_VERSION]: options.toolVersion || 'unknown',
        [SECURITY_ATTRIBUTES.TARGET_URL]: options.target || '',
        [SECURITY_ATTRIBUTES.TARGET_DOMAIN]: options.domain || '',
        [SECURITY_ATTRIBUTES.PROGRAM_ID]: options.programId || '',
        'job.id': options.jobId || '',
        'tool.command': options.command?.slice(0, 1000) || '',
      },
    });

    return span;
  }

  /**
   * Complete a tool span with results
   */
  completeToolSpan(
    span: Span,
    result: {
      success: boolean;
      resultsCount?: number;
      duration?: number;
      error?: string;
      findings?: Array<{ type: string; severity: string }>;
    }
  ): void {
    if (!this.enabled) return;

    span.setAttributes({
      'tool.success': result.success,
      'tool.results_count': result.resultsCount || 0,
      'tool.duration_ms': result.duration || 0,
      'tool.findings_count': result.findings?.length || 0,
    });

    if (result.findings && result.findings.length > 0) {
      // Log finding types for analysis
      const findingTypes = result.findings.map(f => f.type).join(',');
      const severities = result.findings.map(f => f.severity).join(',');
      span.setAttributes({
        'tool.finding_types': findingTypes,
        'tool.finding_severities': severities,
      });
    }

    if (result.error) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: result.error });
      span.recordException(new Error(result.error));
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }

    span.end();
  }

  /**
   * Create a span for agent workflow step
   */
  startAgentSpan(
    agentType: string,
    stepName: string,
    options: {
      jobId?: string;
      programId?: string;
      parentSpan?: Span;
      targets?: string[];
    }
  ): Span {
    if (!this.enabled) {
      return trace.getTracer('noop').startSpan('noop');
    }

    const parentContext = options.parentSpan
      ? trace.setSpan(context.active(), options.parentSpan)
      : context.active();

    const span = this.tracer.startSpan(
      `agent.${agentType}.${stepName}`,
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          'agent.type': agentType,
          'agent.step': stepName,
          'job.id': options.jobId || '',
          [SECURITY_ATTRIBUTES.PROGRAM_ID]: options.programId || '',
          'agent.targets_count': options.targets?.length || 0,
        },
      },
      parentContext
    );

    return span;
  }

  /**
   * Record a security finding in the current span
   */
  recordFinding(
    span: Span,
    finding: {
      id: string;
      type: string;
      severity: string;
      confidence: number;
      url?: string;
    }
  ): void {
    if (!this.enabled) return;

    span.addEvent('finding_discovered', {
      [SECURITY_ATTRIBUTES.FINDING_ID]: finding.id,
      [SECURITY_ATTRIBUTES.VULNERABILITY_TYPE]: finding.type,
      [SECURITY_ATTRIBUTES.SEVERITY]: finding.severity,
      'finding.confidence': finding.confidence,
      [SECURITY_ATTRIBUTES.TARGET_URL]: finding.url || '',
    });
  }

  /**
   * Record a handoff between agents
   */
  recordHandoff(
    span: Span,
    handoff: {
      fromAgent: string;
      toAgent: string;
      dataSize: number;
      confidence: number;
    }
  ): void {
    if (!this.enabled) return;

    span.addEvent('agent_handoff', {
      'handoff.from_agent': handoff.fromAgent,
      'handoff.to_agent': handoff.toAgent,
      'handoff.data_size': handoff.dataSize,
      'handoff.confidence': handoff.confidence,
    });
  }

  /**
   * Get the Phoenix dashboard URL
   */
  getPhoenixUrl(): string {
    return process.env.PHOENIX_ENDPOINT || 'http://localhost:6006';
  }

  /**
   * Get current trace context for propagation
   */
  getCurrentTraceContext(): { traceId: string; spanId: string } | null {
    if (!this.enabled) return null;

    const span = trace.getActiveSpan();
    if (!span) return null;

    const spanContext = span.spanContext();
    return {
      traceId: spanContext.traceId,
      spanId: spanContext.spanId,
    };
  }
}

// Singleton instance - initialized on import
export const tracingService = new TracingService();

// Export attribute constants for use in other modules
export { LLM_ATTRIBUTES, SECURITY_ATTRIBUTES };

export default tracingService;
