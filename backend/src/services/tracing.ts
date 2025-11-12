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
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import logger from '../utils/logger';

/**
 * Initialize OpenTelemetry SDK with Phoenix backend
 *
 * Environment Variables:
 * - OTEL_ENABLED: Enable/disable tracing (default: false for compatibility)
 * - PHOENIX_ENDPOINT: Phoenix OTLP endpoint (default: http://localhost:6006/v1/traces)
 * - OTEL_SERVICE_NAME: Service name (default: agenthunt)
 */
class TracingService {
  private sdk: NodeSDK | null = null;
  private enabled: boolean = false;

  constructor() {
    this.enabled = process.env.OTEL_ENABLED === 'true';

    if (!this.enabled) {
      logger.info('OpenTelemetry tracing disabled (set OTEL_ENABLED=true to enable)');
      return;
    }

    this.initialize();
  }

  private initialize(): void {
    try {
      const phoenixEndpoint = process.env.PHOENIX_ENDPOINT || 'http://localhost:6006/v1/traces';
      const serviceName = process.env.OTEL_SERVICE_NAME || 'agenthunt';
      const serviceVersion = process.env.npm_package_version || '1.0.0';

      this.sdk = new NodeSDK({
        resource: new Resource({
          [SEMRESATTRS_SERVICE_NAME]: serviceName,
          [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
        }),
        traceExporter: new OTLPTraceExporter({
          url: phoenixEndpoint,
          headers: {},
        }),
        instrumentations: [
          getNodeAutoInstrumentations({
            // Disable file system instrumentation (too noisy)
            '@opentelemetry/instrumentation-fs': {
              enabled: false,
            },
            // Enable HTTP instrumentation (for API calls)
            '@opentelemetry/instrumentation-http': {
              enabled: true,
            },
            // Enable Express instrumentation (for API routes)
            '@opentelemetry/instrumentation-express': {
              enabled: true,
            },
            // Enable IORedis instrumentation (for BullMQ)
            '@opentelemetry/instrumentation-ioredis': {
              enabled: true,
            },
            // Enable pg instrumentation (for database)
            '@opentelemetry/instrumentation-pg': {
              enabled: true,
            },
          }),
        ],
      });

      this.sdk.start();

      logger.info({
        phoenixEndpoint,
        serviceName,
        serviceVersion,
      }, 'OpenTelemetry tracing initialized successfully');

      // Graceful shutdown
      process.on('SIGTERM', async () => {
        await this.shutdown();
      });
    } catch (error) {
      logger.error({ error }, 'Failed to initialize OpenTelemetry tracing');
    }
  }

  async shutdown(): Promise<void> {
    if (this.sdk) {
      try {
        await this.sdk.shutdown();
        logger.info('OpenTelemetry SDK shut down successfully');
      } catch (error) {
        logger.error({ error }, 'Error shutting down OpenTelemetry SDK');
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

// Singleton instance - initialized on import
export const tracingService = new TracingService();

export default tracingService;
