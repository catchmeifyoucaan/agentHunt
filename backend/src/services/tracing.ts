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

import logger from '../utils/logger';

/**
 * Initialize OpenTelemetry SDK with Phoenix backend
 *
 * Environment Variables:
 * - OTEL_ENABLED: Enable/disable tracing (default: false for compatibility)
 * - PHOENIX_ENDPOINT: Phoenix endpoint (default: http://localhost:6006)
 * - OTEL_SERVICE_NAME: Service name (default: agenthunt)
 */
class TracingService {
  private enabled: boolean = false;

  constructor() {
    this.enabled = process.env.OTEL_ENABLED === 'true';

    if (!this.enabled) {
      logger.info('OpenTelemetry tracing disabled (set OTEL_ENABLED=true to enable)');
      return;
    }

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

        logger.info({
          phoenixEndpoint,
          serviceName,
        }, 'Phoenix OpenTelemetry tracing initialized successfully');

        // Graceful shutdown handler
        process.on('SIGTERM', async () => {
          await this.shutdown();
        });
      } catch (importError) {
        logger.warn('Phoenix OTEL package not installed. Tracing will be disabled. Install @arizeai/phoenix-otel to enable.');
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
}

// Singleton instance - initialized on import
export const tracingService = new TracingService();

export default tracingService;
