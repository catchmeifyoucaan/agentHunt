/**
 * Metrics & Monitoring Service
 * 
 * Provides Prometheus-compatible metrics for:
 * - Agent execution times
 * - Queue depths
 * - Success/failure rates
 * - Resource utilization
 * - Cost tracking
 * 
 * Integrates with:
 * - Prometheus
 * - Grafana
 * - StatsD
 * - OpenTelemetry
 */

import logger from '../utils/logger';
import database from './database';
import redis from './redis';

interface MetricValue {
  value: number;
  timestamp: Date;
  labels: Record<string, string>;
}

interface Histogram {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

// Prometheus-style metric types
type MetricType = 'counter' | 'gauge' | 'histogram' | 'summary';

interface MetricDefinition {
  name: string;
  type: MetricType;
  help: string;
  labels: string[];
}

// Pre-defined metrics
const METRIC_DEFINITIONS: MetricDefinition[] = [
  // Agent metrics
  { name: 'agenthunt_agent_executions_total', type: 'counter', help: 'Total agent executions', labels: ['agent_type', 'status'] },
  { name: 'agenthunt_agent_execution_duration_seconds', type: 'histogram', help: 'Agent execution duration', labels: ['agent_type'] },
  { name: 'agenthunt_agent_findings_total', type: 'counter', help: 'Total findings by agent', labels: ['agent_type', 'severity'] },
  
  // Queue metrics
  { name: 'agenthunt_queue_depth', type: 'gauge', help: 'Current queue depth', labels: ['queue_name'] },
  { name: 'agenthunt_queue_processing_time_seconds', type: 'histogram', help: 'Job processing time', labels: ['queue_name'] },
  { name: 'agenthunt_queue_jobs_total', type: 'counter', help: 'Total jobs processed', labels: ['queue_name', 'status'] },
  
  // System metrics
  { name: 'agenthunt_active_scans', type: 'gauge', help: 'Currently active scans', labels: [] },
  { name: 'agenthunt_total_programs', type: 'gauge', help: 'Total programs', labels: [] },
  { name: 'agenthunt_total_assets', type: 'gauge', help: 'Total assets discovered', labels: ['type'] },
  { name: 'agenthunt_total_findings', type: 'gauge', help: 'Total findings', labels: ['severity'] },
  
  // Cost metrics
  { name: 'agenthunt_llm_tokens_total', type: 'counter', help: 'Total LLM tokens used', labels: ['model', 'type'] },
  { name: 'agenthunt_llm_cost_dollars', type: 'counter', help: 'Total LLM cost in dollars', labels: ['model'] },
  { name: 'agenthunt_scan_cost_dollars', type: 'counter', help: 'Total scan cost', labels: ['program_id'] },
  
  // Performance metrics
  { name: 'agenthunt_http_request_duration_seconds', type: 'histogram', help: 'HTTP request duration', labels: ['method', 'path', 'status'] },
  { name: 'agenthunt_database_query_duration_seconds', type: 'histogram', help: 'Database query duration', labels: ['operation'] },
  { name: 'agenthunt_redis_operation_duration_seconds', type: 'histogram', help: 'Redis operation duration', labels: ['operation'] },
];

// Histogram buckets for different metric types
const HISTOGRAM_BUCKETS = {
  duration: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 120, 300, 600],
  size: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
};

class MetricsService {
  private counters: Map<string, Map<string, number>> = new Map();
  private gauges: Map<string, Map<string, number>> = new Map();
  private histograms: Map<string, Map<string, Histogram>> = new Map();
  private startTime: Date = new Date();

  constructor() {
    // Initialize metrics
    for (const def of METRIC_DEFINITIONS) {
      switch (def.type) {
        case 'counter':
          this.counters.set(def.name, new Map());
          break;
        case 'gauge':
          this.gauges.set(def.name, new Map());
          break;
        case 'histogram':
          this.histograms.set(def.name, new Map());
          break;
      }
    }
  }

  /**
   * Increment a counter
   */
  incCounter(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const counter = this.counters.get(name);
    if (!counter) {
      logger.warn({ name }, 'Unknown counter metric');
      return;
    }

    const key = this.labelsToKey(labels);
    counter.set(key, (counter.get(key) || 0) + value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, labels: Record<string, string> = {}, value: number): void {
    const gauge = this.gauges.get(name);
    if (!gauge) {
      logger.warn({ name }, 'Unknown gauge metric');
      return;
    }

    const key = this.labelsToKey(labels);
    gauge.set(key, value);
  }

  /**
   * Increment a gauge
   */
  incGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    const gauge = this.gauges.get(name);
    if (!gauge) return;

    const key = this.labelsToKey(labels);
    gauge.set(key, (gauge.get(key) || 0) + value);
  }

  /**
   * Decrement a gauge
   */
  decGauge(name: string, labels: Record<string, string> = {}, value: number = 1): void {
    this.incGauge(name, labels, -value);
  }

  /**
   * Observe a histogram value
   */
  observeHistogram(name: string, labels: Record<string, string> = {}, value: number): void {
    const histogram = this.histograms.get(name);
    if (!histogram) {
      logger.warn({ name }, 'Unknown histogram metric');
      return;
    }

    const key = this.labelsToKey(labels);
    let hist = histogram.get(key);
    
    if (!hist) {
      hist = {
        count: 0,
        sum: 0,
        buckets: new Map(HISTOGRAM_BUCKETS.duration.map(b => [b, 0])),
      };
      histogram.set(key, hist);
    }

    hist.count++;
    hist.sum += value;

    // Update buckets
    for (const bucket of hist.buckets.keys()) {
      if (value <= bucket) {
        hist.buckets.set(bucket, (hist.buckets.get(bucket) || 0) + 1);
      }
    }
  }

  /**
   * Time a function and record to histogram
   */
  async timeAsync<T>(name: string, labels: Record<string, string>, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      const duration = (Date.now() - start) / 1000;
      this.observeHistogram(name, labels, duration);
    }
  }

  /**
   * Record agent execution
   */
  recordAgentExecution(agentType: string, status: 'success' | 'failure', duration: number, findingsCount: number = 0): void {
    this.incCounter('agenthunt_agent_executions_total', { agent_type: agentType, status });
    this.observeHistogram('agenthunt_agent_execution_duration_seconds', { agent_type: agentType }, duration);
    
    if (findingsCount > 0) {
      this.incCounter('agenthunt_agent_findings_total', { agent_type: agentType, severity: 'all' }, findingsCount);
    }
  }

  /**
   * Record finding
   */
  recordFinding(agentType: string, severity: string): void {
    this.incCounter('agenthunt_agent_findings_total', { agent_type: agentType, severity });
  }

  /**
   * Record LLM usage
   */
  recordLLMUsage(model: string, inputTokens: number, outputTokens: number, cost: number): void {
    this.incCounter('agenthunt_llm_tokens_total', { model, type: 'input' }, inputTokens);
    this.incCounter('agenthunt_llm_tokens_total', { model, type: 'output' }, outputTokens);
    this.incCounter('agenthunt_llm_cost_dollars', { model }, cost);
  }

  /**
   * Update queue metrics
   */
  async updateQueueMetrics(): Promise<void> {
    try {
      // Get queue depths from Redis
      const queues = ['discovery', 'fingerprint', 'scanner', 'crawl', 'triage', 'xss', 'sqli'];
      
      for (const queue of queues) {
        try {
          const depth = await redis.llen(`bull:${queue}:wait`) + await redis.llen(`bull:${queue}:active`);
          this.setGauge('agenthunt_queue_depth', { queue_name: queue }, depth);
        } catch {
          // Queue might not exist
        }
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to update queue metrics');
    }
  }

  /**
   * Update system metrics from database
   */
  async updateSystemMetrics(): Promise<void> {
    try {
      // Active scans
      const activeScans = await database.query(
        `SELECT COUNT(*) as count FROM jobs WHERE status = 'active'`
      );
      this.setGauge('agenthunt_active_scans', {}, parseInt(activeScans.rows[0]?.count || '0'));

      // Total programs
      const programs = await database.query(`SELECT COUNT(*) as count FROM programs`);
      this.setGauge('agenthunt_total_programs', {}, parseInt(programs.rows[0]?.count || '0'));

      // Assets by type
      const assets = await database.query(
        `SELECT type, COUNT(*) as count FROM assets GROUP BY type`
      );
      for (const row of assets.rows) {
        this.setGauge('agenthunt_total_assets', { type: row.type }, parseInt(row.count));
      }

      // Findings by severity
      const findings = await database.query(
        `SELECT severity, COUNT(*) as count FROM findings GROUP BY severity`
      );
      for (const row of findings.rows) {
        this.setGauge('agenthunt_total_findings', { severity: row.severity || 'unknown' }, parseInt(row.count));
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to update system metrics');
    }
  }

  /**
   * Get Prometheus-formatted metrics
   */
  getPrometheusMetrics(): string {
    const lines: string[] = [];

    // Add uptime
    const uptime = (Date.now() - this.startTime.getTime()) / 1000;
    lines.push('# HELP agenthunt_uptime_seconds Time since service start');
    lines.push('# TYPE agenthunt_uptime_seconds gauge');
    lines.push(`agenthunt_uptime_seconds ${uptime}`);
    lines.push('');

    // Counters
    for (const [name, values] of this.counters) {
      const def = METRIC_DEFINITIONS.find(d => d.name === name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} counter`);
      }
      for (const [labels, value] of values) {
        lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
      }
      lines.push('');
    }

    // Gauges
    for (const [name, values] of this.gauges) {
      const def = METRIC_DEFINITIONS.find(d => d.name === name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} gauge`);
      }
      for (const [labels, value] of values) {
        lines.push(`${name}${labels ? `{${labels}}` : ''} ${value}`);
      }
      lines.push('');
    }

    // Histograms
    for (const [name, values] of this.histograms) {
      const def = METRIC_DEFINITIONS.find(d => d.name === name);
      if (def) {
        lines.push(`# HELP ${name} ${def.help}`);
        lines.push(`# TYPE ${name} histogram`);
      }
      for (const [labels, hist] of values) {
        const labelStr = labels ? `{${labels}}` : '';
        
        // Buckets
        for (const [bucket, count] of hist.buckets) {
          const bucketLabels = labels ? `${labels},le="${bucket}"` : `le="${bucket}"`;
          lines.push(`${name}_bucket{${bucketLabels}} ${count}`);
        }
        lines.push(`${name}_bucket{${labels ? `${labels},` : ''}le="+Inf"} ${hist.count}`);
        lines.push(`${name}_sum${labelStr} ${hist.sum}`);
        lines.push(`${name}_count${labelStr} ${hist.count}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Get metrics as JSON
   */
  getMetricsJSON(): Record<string, any> {
    const result: Record<string, any> = {
      uptime: (Date.now() - this.startTime.getTime()) / 1000,
      counters: {},
      gauges: {},
      histograms: {},
    };

    for (const [name, values] of this.counters) {
      result.counters[name] = Object.fromEntries(values);
    }

    for (const [name, values] of this.gauges) {
      result.gauges[name] = Object.fromEntries(values);
    }

    for (const [name, values] of this.histograms) {
      result.histograms[name] = {};
      for (const [labels, hist] of values) {
        result.histograms[name][labels || 'default'] = {
          count: hist.count,
          sum: hist.sum,
          avg: hist.count > 0 ? hist.sum / hist.count : 0,
        };
      }
    }

    return result;
  }

  /**
   * Get dashboard summary
   */
  async getDashboardSummary(): Promise<Record<string, any>> {
    await this.updateSystemMetrics();
    await this.updateQueueMetrics();

    const metrics = this.getMetricsJSON();

    return {
      uptime: metrics.uptime,
      activeScans: metrics.gauges['agenthunt_active_scans']?.[''] || 0,
      totalPrograms: metrics.gauges['agenthunt_total_programs']?.[''] || 0,
      totalFindings: Object.values(metrics.gauges['agenthunt_total_findings'] || {}).reduce((a: number, b: any) => a + b, 0),
      queueDepths: metrics.gauges['agenthunt_queue_depth'] || {},
      agentExecutions: metrics.counters['agenthunt_agent_executions_total'] || {},
      recentPerformance: {
        avgExecutionTime: this.getAverageHistogramValue('agenthunt_agent_execution_duration_seconds'),
      },
    };
  }

  /**
   * Get average histogram value
   */
  private getAverageHistogramValue(name: string): number {
    const histogram = this.histograms.get(name);
    if (!histogram) return 0;

    let totalSum = 0;
    let totalCount = 0;

    for (const hist of histogram.values()) {
      totalSum += hist.sum;
      totalCount += hist.count;
    }

    return totalCount > 0 ? totalSum / totalCount : 0;
  }

  /**
   * Convert labels to string key
   */
  private labelsToKey(labels: Record<string, string>): string {
    const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
    return entries.map(([k, v]) => `${k}="${v}"`).join(',');
  }

  /**
   * Reset all metrics (for testing)
   */
  reset(): void {
    for (const counter of this.counters.values()) counter.clear();
    for (const gauge of this.gauges.values()) gauge.clear();
    for (const histogram of this.histograms.values()) histogram.clear();
    this.startTime = new Date();
  }
}

export const metrics = new MetricsService();
export default metrics;
