/**
 * Resource Monitor - Monitors container resource usage
 * Tracks CPU, memory, network, and I/O usage
 */

import { ResourceMonitoringData } from './types';
import logger from '../../utils/logger';
import Docker from 'dockerode';

export class ResourceMonitor {
  private docker: Docker;
  private monitors: Map<string, NodeJS.Timer> = new Map();
  private stats: Map<string, ResourceMonitoringData[]> = new Map();
  private maxStatsPerContainer: number = 100; // Keep last 100 stats entries

  constructor() {
    this.docker = new Docker();
  }

  /**
   * Start monitoring a container
   */
  async startMonitoring(containerId: string, intervalMs: number = 1000): Promise<void> {
    // Stop existing monitor if any
    this.stopMonitoring(containerId);

    logger.debug({ containerId, intervalMs }, 'Starting resource monitoring');

    // Create monitoring interval
    const interval = setInterval(async () => {
      try {
        const data = await this.collectStats(containerId);
        if (data) {
          this.recordStats(containerId, data);
        }
      } catch (error: any) {
        // Container might have stopped
        logger.debug({ error, containerId }, 'Failed to collect stats, stopping monitor');
        this.stopMonitoring(containerId);
      }
    }, intervalMs);

    this.monitors.set(containerId, interval);
  }

  /**
   * Stop monitoring a container
   */
  stopMonitoring(containerId: string): void {
    const interval = this.monitors.get(containerId);
    if (interval) {
      clearInterval(interval);
      this.monitors.delete(containerId);
      logger.debug({ containerId }, 'Stopped resource monitoring');
    }
  }

  /**
   * Collect current stats for a container
   */
  async collectStats(containerId: string): Promise<ResourceMonitoringData | null> {
    try {
      const container = this.docker.getContainer(containerId);
      const stats = await container.stats({ stream: false });

      // Parse Docker stats
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100 : 0;

      const memoryUsed = stats.memory_stats.usage || 0;
      const memoryLimit = stats.memory_stats.limit || 1;
      const memoryPercent = (memoryUsed / memoryLimit) * 100;

      const data: ResourceMonitoringData = {
        containerId,
        timestamp: new Date(),
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        cpuTimeMs: Math.round(stats.cpu_stats.cpu_usage.total_usage / 1000000),
        memoryUsedMB: Math.round(memoryUsed / 1024 / 1024),
        memoryLimitMB: Math.round(memoryLimit / 1024 / 1024),
        memoryPercent: Math.round(memoryPercent * 100) / 100,
      };

      // Network stats (if available)
      if (stats.networks) {
        let rxBytes = 0;
        let txBytes = 0;
        Object.values(stats.networks).forEach((network: any) => {
          rxBytes += network.rx_bytes || 0;
          txBytes += network.tx_bytes || 0;
        });
        data.networkRxBytes = rxBytes;
        data.networkTxBytes = txBytes;
      }

      // Block I/O stats (if available)
      if (stats.blkio_stats && stats.blkio_stats.io_service_bytes_recursive) {
        let readBytes = 0;
        let writeBytes = 0;
        stats.blkio_stats.io_service_bytes_recursive.forEach((entry: any) => {
          if (entry.op === 'read') readBytes += entry.value || 0;
          if (entry.op === 'write') writeBytes += entry.value || 0;
        });
        data.blockReadBytes = readBytes;
        data.blockWriteBytes = writeBytes;
      }

      return data;
    } catch (error: any) {
      logger.error({ error, containerId }, 'Failed to collect container stats');
      return null;
    }
  }

  /**
   * Record stats data point
   */
  private recordStats(containerId: string, data: ResourceMonitoringData): void {
    let containerStats = this.stats.get(containerId);
    if (!containerStats) {
      containerStats = [];
      this.stats.set(containerId, containerStats);
    }

    containerStats.push(data);

    // Keep only last N entries
    if (containerStats.length > this.maxStatsPerContainer) {
      containerStats.shift();
    }
  }

  /**
   * Get latest stats for a container
   */
  getLatestStats(containerId: string): ResourceMonitoringData | null {
    const containerStats = this.stats.get(containerId);
    if (!containerStats || containerStats.length === 0) {
      return null;
    }
    return containerStats[containerStats.length - 1];
  }

  /**
   * Get all stats for a container
   */
  getAllStats(containerId: string): ResourceMonitoringData[] {
    return this.stats.get(containerId) || [];
  }

  /**
   * Get average stats over time period
   */
  getAverageStats(containerId: string, sinceMs?: number): ResourceMonitoringData | null {
    const containerStats = this.stats.get(containerId);
    if (!containerStats || containerStats.length === 0) {
      return null;
    }

    // Filter by time if specified
    let relevantStats = containerStats;
    if (sinceMs) {
      const cutoffTime = Date.now() - sinceMs;
      relevantStats = containerStats.filter(s => s.timestamp.getTime() >= cutoffTime);
    }

    if (relevantStats.length === 0) {
      return null;
    }

    // Calculate averages
    const avg = relevantStats.reduce(
      (acc, stat) => ({
        cpuPercent: acc.cpuPercent + stat.cpuPercent,
        memoryUsedMB: acc.memoryUsedMB + stat.memoryUsedMB,
        memoryPercent: acc.memoryPercent + stat.memoryPercent,
        networkRxBytes: (acc.networkRxBytes || 0) + (stat.networkRxBytes || 0),
        networkTxBytes: (acc.networkTxBytes || 0) + (stat.networkTxBytes || 0),
      }),
      { cpuPercent: 0, memoryUsedMB: 0, memoryPercent: 0, networkRxBytes: 0, networkTxBytes: 0 }
    );

    const count = relevantStats.length;
    const latest = relevantStats[relevantStats.length - 1];

    return {
      containerId,
      timestamp: latest.timestamp,
      cpuPercent: Math.round((avg.cpuPercent / count) * 100) / 100,
      cpuTimeMs: latest.cpuTimeMs,
      memoryUsedMB: Math.round(avg.memoryUsedMB / count),
      memoryLimitMB: latest.memoryLimitMB,
      memoryPercent: Math.round((avg.memoryPercent / count) * 100) / 100,
      networkRxBytes: Math.round(avg.networkRxBytes / count),
      networkTxBytes: Math.round(avg.networkTxBytes / count),
      blockReadBytes: latest.blockReadBytes,
      blockWriteBytes: latest.blockWriteBytes,
    };
  }

  /**
   * Get peak stats (max values)
   */
  getPeakStats(containerId: string): ResourceMonitoringData | null {
    const containerStats = this.stats.get(containerId);
    if (!containerStats || containerStats.length === 0) {
      return null;
    }

    const peak = containerStats.reduce((max, stat) => ({
      cpuPercent: Math.max(max.cpuPercent, stat.cpuPercent),
      memoryUsedMB: Math.max(max.memoryUsedMB, stat.memoryUsedMB),
      memoryPercent: Math.max(max.memoryPercent, stat.memoryPercent),
      networkRxBytes: Math.max(max.networkRxBytes || 0, stat.networkRxBytes || 0),
      networkTxBytes: Math.max(max.networkTxBytes || 0, stat.networkTxBytes || 0),
    }), { cpuPercent: 0, memoryUsedMB: 0, memoryPercent: 0, networkRxBytes: 0, networkTxBytes: 0 });

    const latest = containerStats[containerStats.length - 1];

    return {
      containerId,
      timestamp: latest.timestamp,
      cpuPercent: peak.cpuPercent,
      cpuTimeMs: latest.cpuTimeMs,
      memoryUsedMB: peak.memoryUsedMB,
      memoryLimitMB: latest.memoryLimitMB,
      memoryPercent: peak.memoryPercent,
      networkRxBytes: peak.networkRxBytes,
      networkTxBytes: peak.networkTxBytes,
      blockReadBytes: latest.blockReadBytes,
      blockWriteBytes: latest.blockWriteBytes,
    };
  }

  /**
   * Check if container exceeds resource limits
   */
  async checkLimits(containerId: string, maxCpuPercent: number, maxMemoryMB: number): Promise<{
    exceeded: boolean;
    reason?: string;
  }> {
    const stats = await this.collectStats(containerId);
    if (!stats) {
      return { exceeded: false };
    }

    if (stats.cpuPercent > maxCpuPercent) {
      return {
        exceeded: true,
        reason: `CPU usage (${stats.cpuPercent}%) exceeds limit (${maxCpuPercent}%)`,
      };
    }

    if (stats.memoryUsedMB > maxMemoryMB) {
      return {
        exceeded: true,
        reason: `Memory usage (${stats.memoryUsedMB}MB) exceeds limit (${maxMemoryMB}MB)`,
      };
    }

    return { exceeded: false };
  }

  /**
   * Clear stats for a container
   */
  clearStats(containerId: string): void {
    this.stats.delete(containerId);
    this.stopMonitoring(containerId);
  }

  /**
   * Clear all stats and stop all monitoring
   */
  clearAll(): void {
    this.monitors.forEach((interval, containerId) => {
      clearInterval(interval);
    });
    this.monitors.clear();
    this.stats.clear();
    logger.info('Cleared all resource monitoring data');
  }

  /**
   * Get summary of all monitored containers
   */
  getSummary(): {
    totalContainers: number;
    activeMonitors: number;
    totalDataPoints: number;
  } {
    let totalDataPoints = 0;
    this.stats.forEach(stats => {
      totalDataPoints += stats.length;
    });

    return {
      totalContainers: this.stats.size,
      activeMonitors: this.monitors.size,
      totalDataPoints,
    };
  }
}

export default new ResourceMonitor();
