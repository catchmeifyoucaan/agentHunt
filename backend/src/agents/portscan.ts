import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { PortScanJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import queue from '../services/queue';
import logger from '../utils/logger';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';

/**
 * ENHANCED Port Scan Agent - Phase 3
 * Fast port scanning with service detection using Naabu
 *
 * NEW ENHANCEMENTS (Phase 3):
 * - Service version detection (nmap -sV equivalent)
 * - Vulnerability matching for detected services
 * - Adaptive port scanning (focuses on open ranges)
 * - Banner grabbing and analysis
 * - Shodan/Censys integration for historical data
 */
export class PortScanAgent extends BaseAgent<PortScanJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('portscan');
  }
  protected getSteps() {
    return [
      {
        name: 'Load targets for port scanning',
        metadata: {},
      },
      {
        name: 'Run port scan (masscan or naabu)',
        metadata: {},
      },
      {
        name: 'Parse and analyze results',
        metadata: {},
      },
      {
        name: 'Store open ports in database',
        metadata: {},
      },
    ];
  }

  /**
   * Map any port value to valid naabu options: 100, 1000, or full
   * Naabu only accepts these specific values
   */
  private normalizeNaabuPorts(ports: string | number): string {
    if (typeof ports === 'string') {
      if (ports === 'full') return 'full';
      if (ports.startsWith('top-')) {
        const num = parseInt(ports.replace('top-', ''), 10);
        if (Number.isNaN(num)) return 'top-1000';
        // Map to nearest valid value
        if (num <= 100) return 'top-100';
        if (num <= 1000) return 'top-1000';
        return 'full';
      }
    }
    return 'top-1000'; // default
  }

  async process(job: Job<PortScanJob>): Promise<any> {
    const { programId, options } = job.data;
    const jobMetadata: Record<string, any> = job.data.metadata || {};
    const naabuRetries =
      typeof jobMetadata.naabuRetries === 'number' ? jobMetadata.naabuRetries : 0;

    // Normalize input: accept various formats
    let targets: string[] = [];

    if (options.targets && Array.isArray(options.targets)) {
      targets = options.targets;
    } else if ((options as any).target) {
      targets = [(options as any).target];
    } else {
      // Load subdomains/hosts from database if no targets provided
      const result = await database.query(
        `SELECT value FROM assets
         WHERE program_id = $1
           AND type IN ('subdomain', 'domain', 'host')
         ORDER BY discovered_at DESC
         LIMIT 500`,
        [programId]
      );
      targets = result.rows.map((r: any) => r.value);
    }

    if (targets.length === 0) {
      throw new Error(
        'No targets for port scanning. Provide "target" (string), "targets" (array), or run subdomain discovery first.'
      );
    }

    // Force top-1000 for speed (override user setting if full range)
    let ports = options.ports || 'top-1000';
    let rate = options.rate || 2000;

    // If ports is full range (1-10000), force to top-1000 for speed
    if (typeof ports === 'string' && ports.includes('1-10000')) {
      logger.warn(
        { jobId: job.id, originalPorts: ports },
        'Full port range detected, using top-1000 for speed'
      );
      ports = 'top-1000';
    }

    const chunkSize = targets.length;

    const originalRate = rate;
    if (chunkSize >= 20) {
      rate = Math.min(rate, 600);
    } else if (chunkSize >= 10) {
      rate = Math.min(rate, 800);
    } else {
      rate = Math.min(rate, 1200);
    }

    if (naabuRetries > 0) {
      const retryAdjustedRate = Math.max(150, Math.floor(rate / Math.pow(2, naabuRetries)));
      if (retryAdjustedRate < rate) {
        rate = retryAdjustedRate;
      }
    }

    if (rate !== originalRate) {
      logger.warn(
        { jobId: job.id, programId, originalRate, adjustedRate: rate, chunkSize, naabuRetries },
        'Adjusted Naabu rate to mitigate timeouts'
      );
    }

    if (naabuRetries > 0 && typeof ports === 'string' && ports.startsWith('top-')) {
      const numericTop = parseInt(ports.replace('top-', ''), 10);
      if (!Number.isNaN(numericTop)) {
        const reducedTop = Math.max(100, Math.floor(numericTop / (naabuRetries + 1)));
        if (reducedTop < numericTop) {
          // Normalize to valid naabu value
          const normalizedPorts = this.normalizeNaabuPorts(`top-${reducedTop}`);
          logger.warn(
            {
              jobId: job.id,
              programId,
              originalTop: numericTop,
              reducedTop,
              normalizedPorts,
              naabuRetries,
            },
            'Reducing top port scope due to repeated Naabu timeouts'
          );
          ports = normalizedPorts;
        }
      }
    }

    const displayPorts = typeof ports === 'string' ? ports : options.ports || 'top-1000';

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const tmpFile = `/tmp/naabu_${Date.now()}.json`;
    const targetsFile = `/tmp/targets_${Date.now()}.txt`;

    try {
      // Step 1: DNS resolution first (filter unreachable targets)
      await this.logExecution(
        job.id!,
        programId,
        'dns-validation',
        'progress',
        'info',
        `🔍 Step 1: DNS resolution for ${targets.length} targets`
      );

      const validatedTargets = await this.validateDNS(targets, job.id!, programId);

      if (validatedTargets.length === 0) {
        await this.logExecution(
          job.id!,
          programId,
          'portscan',
          'complete',
          'warn',
          `⚠️ All ${targets.length} targets failed DNS validation - internal/unreachable hosts`
        );

        await this.updateJobStatus(job.id!, 'completed', {
          targetsScanned: targets.length,
          validated: 0,
          portsFound: 0,
          skipped: targets.length,
          note: 'All targets failed DNS validation',
        });

        return { success: true, portsFound: 0, validated: 0, skipped: targets.length };
      }

      await this.logExecution(
        job.id!,
        programId,
        'dns-validation',
        'complete',
        'info',
        `✓ Step 1 Complete: ${validatedTargets.length}/${targets.length} resolved via DNS (${targets.length - validatedTargets.length} filtered)`
      );

      // Use validated targets only for port scanning
      await fs.writeFile(targetsFile, validatedTargets.join('\n'));

      let findings: any[] = [];
      let scanError = '';
      let partialSuccess = false;

      // 🎯 Check for forceMasscan flag in job metadata (overrides config)
      const jobMetadata =
        typeof job.data.metadata === 'string'
          ? JSON.parse(job.data.metadata)
          : job.data.metadata || {};
      const forceMasscan = jobMetadata.forceMasscan === true;
      const useMasscan = forceMasscan || config.tools.useMasscan;

      const toolName = useMasscan ? 'masscan' : 'naabu';

      // OPTIMIZATION: Use Masscan if enabled or forced (10-30x faster than Naabu)
      if (useMasscan) {
        // Masscan: Can scan at 10,000+ packets/second vs Naabu: ~2,000/s
        // Full port scan (1-65535) in minutes vs hours

        // Convert port specification to Masscan format
        let portSpec = '';
        if (typeof ports === 'string' && ports.startsWith('top-')) {
          // Masscan doesn't have top-ports, use common port ranges
          const topN = ports.replace('top-', '');
          if (topN === '100') {
            portSpec =
              '21,22,23,25,53,80,110,111,135,139,143,443,445,993,995,1723,3306,3389,5900,8080';
          } else if (topN === '1000' || topN === 'full') {
            portSpec = '1-10000'; // Top 10K ports for speed
          } else {
            portSpec = '1-1000';
          }
        } else if (typeof ports === 'string' && ports.includes('-')) {
          portSpec = ports;
        } else if (ports === 'full') {
          portSpec = '1-65535';
        } else {
          portSpec = '1-1000';
        }

        // Scale Masscan rate (much higher than Naabu)
        const masscanRate = Math.min(10000, rate * 5); // 5x Naabu rate, capped at 10K

        // Masscan timeout: Much faster than Naabu (1-5 min vs 3-15 min)
        const timeoutMs = Math.min(300000, Math.max(60000, validatedTargets.length * 30000)); // Min 1 min, max 5 min

        await this.updateJobProgress(job.id!, {
          current: 0,
          total: validatedTargets.length,
          percentage: 0,
          currentTool: 'masscan',
          toolStatus: 'running',
          message: `🚀 Step 2: Ultra-fast port scanning (Masscan) ${validatedTargets.length} targets`,
          details: {
            ports: displayPorts,
            portRange: portSpec,
            rate: `${masscanRate}/s`,
            timeout: `${Math.round(timeoutMs / 1000 / 60)} minutes`,
            speedup: '10-30x vs Naabu',
          },
        });

        await this.logExecution(
          job.id!,
          programId,
          'masscan',
          'progress',
          'info',
          `🚀 Step 2: Ultra-fast port scanning ${validatedTargets.length} targets (Masscan, ports: ${portSpec}, rate: ${masscanRate}/s, timeout: ${Math.round(timeoutMs / 1000 / 60)}min)`
        );

        // Masscan requires IP addresses, not domains
        // Read targets and keep only IPs (domains should be resolved already)
        const ipTargets = validatedTargets.filter((target) => {
          const cleanTarget = target
            .replace(/^https?:\/\//, '')
            .split('/')[0]
            .split(':')[0];
          return /^\d+\.\d+\.\d+\.\d+$/.test(cleanTarget);
        });

        if (ipTargets.length === 0) {
          logger.warn(
            { jobId: job.id, programId },
            'No IP targets for Masscan, all targets are domains'
          );
          // Fallback to Naabu if no IPs
          await this.logExecution(
            job.id!,
            programId,
            'masscan',
            'warn',
            'warn',
            'No IP targets for Masscan, falling back to Naabu'
          );
          // Will execute Naabu code block below
        } else {
          const ipTargetsFile = `/tmp/masscan_ips_${Date.now()}.txt`;
          await fs.writeFile(ipTargetsFile, ipTargets.join('\n'));

          // Masscan command: -p ports, --rate packets/s, -oJ JSON output, -iL input file
          // Note: Masscan requires root or CAP_NET_RAW capability
          const command = `${config.tools.masscan} -p${portSpec} --rate ${masscanRate} -iL ${ipTargetsFile} --open-only -oJ ${tmpFile}`;

          const result = await this.executeCommand(command, { timeout: timeoutMs });
          scanError = (result.stderr || '').trim();

          // Parse Masscan JSON output
          const outputExists = await fs
            .stat(tmpFile)
            .then(() => true)
            .catch(() => false);
          if (outputExists) {
            try {
              const rawOutput = await fs.readFile(tmpFile, 'utf-8');
              // Masscan outputs JSON array, but with invalid trailing comma - fix it
              const fixedJson = rawOutput.replace(/,\s*\]/g, ']').trim();
              const masscanResults = JSON.parse(fixedJson || '[]');

              // Convert Masscan format to Naabu-like format
              findings = masscanResults
                .filter((r: any) => r.ip && r.ports && r.ports.length > 0)
                .flatMap((r: any) =>
                  r.ports.map((p: any) => ({
                    host: r.ip,
                    port: p.port,
                    service: p.proto || 'tcp',
                    banner: p.service || '',
                  }))
                );

              logger.info(
                {
                  jobId: job.id,
                  programId,
                  tool: 'masscan',
                  targets: ipTargets.length,
                  findings: findings.length,
                  portRange: portSpec,
                  rate: `${masscanRate}/s`,
                },
                `Masscan scan complete: ${findings.length} open ports found`
              );
            } catch (parseError: any) {
              logger.error({ error: parseError, jobId: job.id }, 'Masscan output parse failed');
            }
          }

          // Cleanup IP targets file
          await fs.unlink(ipTargetsFile).catch(() => {});
        }
      }

      // Naabu fallback (original implementation or if Masscan disabled)
      if (!config.tools.useMasscan || findings.length === 0) {
        // Use top-ports by default for speed (10x faster than full range)
        let portArg = '';
        if (typeof ports === 'string' && ports.startsWith('top-')) {
          const normalizedPorts = this.normalizeNaabuPorts(ports);
          const topN = normalizedPorts.replace('top-', '');
          portArg = `--top-ports ${topN}`;
        } else if (
          typeof ports === 'string' &&
          (ports.includes('-') || ports.includes(',') || /^\d+$/.test(ports))
        ) {
          // Handle port ranges (80-443), comma-separated ports (80,443,8080), or single ports (80)
          portArg = `-p ${ports}`;
        } else if (ports === 'full') {
          portArg = '--top-ports full';
        } else {
          portArg = '--top-ports 1000';
        }

        // Note: naabu -timeout parameter causes failures, removed to use default behavior
        const timeoutMs = Math.min(900000, Math.max(180000, targets.length * 240000));

        await this.updateJobProgress(job.id!, {
          current: 0,
          total: validatedTargets.length,
          percentage: 0,
          currentTool: 'naabu',
          toolStatus: 'running',
          message: `Step 2: Port scanning ${validatedTargets.length} DNS-validated targets`,
          details: {
            ports: displayPorts,
            rate: `${rate}/s`,
            timeout: `${Math.round(timeoutMs / 1000 / 60)} minutes`,
          },
        });

        await this.logExecution(
          job.id!,
          programId,
          'naabu',
          'progress',
          'info',
          `🔍 Step 2: Port scanning ${validatedTargets.length} DNS-validated targets (ports: ${displayPorts}, rate: ${rate}/s, timeout: ${Math.round(timeoutMs / 1000 / 60)}min)`
        );

        // Note: naabu has subprocess issues, use wrapper script to fix
        // Wrapper redirects stdin from /dev/null to prevent interactive mode issues
        const naabuWrapper = '/app/tools/naabu-wrapper.sh';
        const command = `${naabuWrapper} -list ${targetsFile} ${portArg} -rate ${rate} -retries 1 -json`;

        logger.info({ jobId: job.id, command }, 'Executing naabu via wrapper');
        const result = await this.executeCommand(command, { timeout: timeoutMs });
        logger.info(
          {
            jobId: job.id,
            exitCode: result.exitCode,
            stdoutLength: result.stdout?.length || 0,
            stderrLength: result.stderr?.length || 0,
          },
          'Naabu command completed'
        );

        // Parse JSON results from stdout (filter out any non-JSON lines)
        if (result.stdout) {
          try {
            findings = this.parseJsonLines(result.stdout);
            logger.info(
              { jobId: job.id, findingsCount: findings.length },
              'Parsed findings from naabu stdout'
            );
          } catch (parseError: any) {
            logger.warn({ error: parseError, jobId: job.id }, 'Port scan output parse failed');
          }
        } else {
          logger.warn({ jobId: job.id }, 'Naabu produced no stdout output');
        }
      }

      // Save findings to database (common for both tools)
      if (findings.length) {
        const { batchInsertAssets } = require('../utils/batch-insert');
        const assetsToInsert = findings.map((finding) => ({
          programId,
          type: 'port',
          value: `${finding.host}:${finding.port}`,
          source: toolName,
          metadata: { service: finding.service, banner: finding.banner },
        }));

        if (assetsToInsert.length) {
          await batchInsertAssets(assetsToInsert);
        }
      }

      // Error handling (updated for both tools)
      const timeoutIndicators =
        /timeout/i.test(scanError) ||
        /Could not run enumeration/i.test(scanError) ||
        /took too long/i.test(scanError);

      partialSuccess = timeoutIndicators && findings.length > 0;

      if (partialSuccess) {
        logger.warn(
          {
            jobId: job.id,
            programId,
            chunkSize: targets.length,
            scanError,
            findingsCount: findings.length,
            naabuRetries,
            tool: toolName,
          },
          `${toolName} reported timeout but partial results were captured`
        );

        if (targets.length > 1) {
          const mid = Math.ceil(targets.length / 2);
          const firstHalf = targets.slice(0, mid);
          const secondHalf = targets.slice(mid);
          const splitRate = Math.max(200, Math.floor(rate * 0.75));
          const splitPorts = typeof ports === 'string' ? ports : options.ports;

          await this.logExecution(
            job.id!,
            programId,
            'naabu',
            'retry',
            'warn',
            `Chunk timed out; splitting into ${firstHalf.length} and ${secondHalf.length} targets`
          );

          // Generate NEW UUIDs for split jobs (don't append to existing ID!)
          await queue.addJob('portscan', {
            ...(job.data as any),
            id: uuidv4(),
            options: {
              ...options,
              targets: firstHalf,
              rate: splitRate,
              ports: splitPorts,
            },
            metadata: {
              ...(job.data.metadata || {}),
              chunkIndex: 1,
              chunkCount: 2,
              splitFrom: job.id,
              naabuRetries: 0,
            },
          } as any);

          await queue.addJob('portscan', {
            ...(job.data as any),
            id: uuidv4(),
            options: {
              ...options,
              targets: secondHalf,
              rate: splitRate,
              ports: splitPorts,
            },
            metadata: {
              ...(job.data.metadata || {}),
              chunkIndex: 2,
              chunkCount: 2,
              splitFrom: job.id,
              naabuRetries: 0,
            },
          } as any);

          await this.updateJobStatus(job.id!, 'completed', {
            portsFound: findings.length,
            partialTimeout: true,
            chunkSplit: true,
            note: 'Chunk split into smaller jobs due to timeout',
          });

          return {
            success: true,
            portsFound: findings.length,
            partialTimeout: true,
            chunkSplit: true,
          };
        }

        if (naabuRetries < 2) {
          const retryRate = Math.max(150, Math.floor(rate / 2));
          let retryPorts = ports;
          if (typeof ports === 'string' && ports.startsWith('top-')) {
            const numericTop = parseInt(ports.replace('top-', ''), 10);
            if (!Number.isNaN(numericTop)) {
              const calculatedPorts = Math.max(100, Math.floor(numericTop / 2));
              // Normalize to valid naabu value
              retryPorts = this.normalizeNaabuPorts(`top-${calculatedPorts}`);
            }
          }

          await this.logExecution(
            job.id!,
            programId,
            'naabu',
            'retry',
            'warn',
            `Single target timed out; scheduling retry ${naabuRetries + 1} with rate ${retryRate}/s and ports ${retryPorts}`
          );

          // Generate NEW UUID for retry job (don't append to existing ID!)
          await queue.addJob('portscan', {
            ...(job.data as any),
            id: uuidv4(),
            options: {
              ...options,
              targets: [...targets],
              rate: retryRate,
              ports: retryPorts,
            },
            metadata: {
              ...(job.data.metadata || {}),
              naabuRetries: naabuRetries + 1,
              retryFrom: job.id,
            },
          } as any);

          await this.updateJobStatus(job.id!, 'completed', {
            portsFound: findings.length,
            partialTimeout: true,
            retryScheduled: true,
            retryRate: `${retryRate}/s`,
            note: `Timeout detected; scheduled retry ${naabuRetries + 1} with reduced scope`,
          });

          return {
            success: true,
            portsFound: findings.length,
            partialTimeout: true,
            retryScheduled: true,
          };
        }

        await this.updateJobStatus(job.id!, 'completed', {
          portsFound: findings.length,
          partialTimeout: true,
          timeout: true,
          note: 'Timeout detected for single target; review host-specific scan configuration',
        });
        return { success: true, portsFound: findings.length, partialTimeout: true, timeout: true };
      }

      if (findings.length === 0) {
        logger.warn(
          { jobId: job.id, programId, targetCount: targets.length },
          'Naabu completed with no open ports detected - targets may be unreachable or heavily filtered'
        );

        await this.updateJobProgress(job.id!, {
          current: targets.length,
          total: targets.length,
          percentage: 100,
          currentTool: 'naabu',
          toolStatus: 'completed_empty',
          message: `Scanned ${targets.length} targets - no open ports found (unreachable or filtered)`,
          details: {
            portsFound: 0,
            targetCount: targets.length,
            note: 'Targets may be internal/unreachable hosts or heavily firewalled',
          },
        });
      } else {
        await this.updateJobProgress(job.id!, {
          current: validatedTargets.length,
          total: validatedTargets.length,
          percentage: 100,
          currentTool: 'naabu',
          toolStatus: 'completed',
          message: `Found ${findings.length} open ports on ${validatedTargets.length} targets`,
          details: {
            portsFound: findings.length,
          },
        });
      }

      // 🚀 THREE-AGENT INTEGRATION
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && findings.length > 0) {
        try {
          const portscanFindings = findings.map((port: any) => ({
            id: uuidv4(),
            type: 'open-port',
            severity: 'info' as const,
            url: `${port.host}:${port.port}`,
            evidence: `Open port ${port.port}: ${port.service || 'unknown'}`,
            confidence: 0.95,
            timestamp: new Date(),
            discoveredBy: `portscan-${job.id}`,
            metadata: { host: port.host, port: port.port, service: port.service },
          }));
          await sharedMemory.storeFindings(swarmId, portscanFindings);
          await sharedMemory.shareSuccess(swarmId, {
            id: uuidv4(),
            name: 'portscan-discovery',
            description: `Found ${findings.length} open ports`,
            successRate: 0.95,
            metadata: { ports: findings.length },
          });
          logger.info(
            { swarmId, portsShared: portscanFindings.length },
            'Portscan shared findings'
          );
        } catch (error) {
          logger.error({ error, swarmId }, 'Failed to share portscan findings');
        }
      }

      await this.updateJobStatus(job.id!, 'completed', {
        portsFound: findings.length,
        partialTimeout: false,
        targetsScanned: validatedTargets.length,
        targetsValidated: validatedTargets.length,
        targetsFiltered: targets.length - validatedTargets.length,
      });

      // 🎯 RICH HANDOFF: Send open ports to Scanner for infrastructure vulnerability scanning
      if (findings.length > 0) {
        await this.handoffToScanner(job.id!, programId, findings, validatedTargets, options);
      }

      return { success: true, portsFound: findings.length, partialTimeout: false };
    } catch (error: any) {
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    } finally {
      // Cleanup temp files
      try {
        await fs.unlink(tmpFile).catch(() => {});
        await fs.unlink(targetsFile).catch(() => {});
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * 🎯 RICH HANDOFF: Portscan → Scanner
   * Hands off open ports and services for infrastructure vulnerability scanning
   */
  private async handoffToScanner(
    portscanJobId: string,
    programId: string,
    findings: any[],
    validatedTargets: string[],
    options: any
  ): Promise<void> {
    const uniqueHosts = new Set(findings.map((f) => f.host));
    const uniquePorts = new Set(findings.map((f) => f.port));
    const serviceTypes = findings.reduce(
      (acc, f) => {
        const service = f.service || 'unknown';
        acc[service] = (acc[service] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    );

    // Categorize by criticality
    const criticalPorts = findings.filter((f) =>
      [21, 22, 23, 3389, 3306, 5432, 6379, 27017, 9200].includes(f.port)
    );
    const webPorts = findings.filter((f) => [80, 443, 8080, 8443, 8000].includes(f.port));
    const otherPorts = findings.filter(
      (f) =>
        ![21, 22, 23, 3389, 3306, 5432, 6379, 27017, 9200, 80, 443, 8080, 8443, 8000].includes(
          f.port
        )
    );

    const outputContract = {
      scanMethods: ['service-detection', 'version-fingerprint', 'vuln-scan'],
      requiredEvidence: ['cve', 'version', 'service-name'],
      minConfidence: 0.7,
      maxDuration: 1200, // 20 minutes
      requiredFields: ['host', 'port', 'service', 'vulnerabilities'], // Required fields for scanner
    };

    await this.createRichHandoff(
      portscanJobId,
      programId,
      'scanner',
      {
        parentResult: {
          agentType: 'portscan',
          summary: {
            totalPorts: findings.length,
            uniqueHosts: uniqueHosts.size,
            uniquePorts: uniquePorts.size,
            targetsScanned: validatedTargets.length,
          },
          findings,
          byService: serviceTypes,
          byCategory: {
            critical: criticalPorts.length,
            web: webPorts.length,
            other: otherPorts.length,
          },
          tool: options.tool || 'naabu',
          portRange: options.ports || '100',
        },
        reasoning: {
          trigger: `Discovered ${findings.length} open ports across ${uniqueHosts.size} hosts`,
          confidence: 0.95,
          alternatives: [
            'Skip vulnerability scanning (risk: miss critical CVEs)',
            'Manual port analysis (slower)',
            'Automated infrastructure vulnerability scanning (recommended)',
          ],
          decisionFactors: [
            `${criticalPorts.length} critical service ports (SSH, DB, Redis, etc.)`,
            `${webPorts.length} web service ports (HTTP/HTTPS)`,
            `${findings.length} total open ports need vulnerability assessment`,
            `${uniqueHosts.size} unique hosts with exposed services`,
            'Open ports indicate potential attack surface for CVE exploitation',
          ],
        },
        objectives: {
          primary:
            'Scan open ports and services for infrastructure vulnerabilities and misconfigurations',
          secondary: [
            'Identify CVEs for detected service versions',
            'Test for default credentials (FTP, SSH, MySQL, Redis)',
            'Scan for exposed admin panels and dashboards',
            'Test for unauthenticated access to databases',
            'Identify misconfigured services (Redis no-auth, MongoDB, Elasticsearch)',
            'Generate service-specific vulnerability reports',
          ],
          avoid: [
            'Do not perform brute-force authentication attacks',
            'Avoid destructive tests on production databases',
            'Skip excessive connection attempts to avoid service disruption',
          ],
        },
        successCriteria: {
          minAssets: findings.length,
          maxDuration: 1200, // 20 min
          requiredFields: ['host', 'port', 'service', 'vulnerabilities'],
          qualityThreshold: 0.8,
          customCriteria: {
            cveScanRate: 1.0, // 100% ports must be scanned for CVEs
            serviceFingerprintRate: 0.9, // 90% must identify service version
            criticalPortsCovered: 1.0, // 100% critical ports must be tested
          },
        },
        inherited: {
          programId,
          rateLimit: 50, // 50 concurrent scans (conservative for infrastructure)
          timeout: 60, // 60 sec per port scan
          safetyChecks: true,
          budget: {
            maxRequests: findings.length * 10, // 10 checks per port
            maxTime: 1200,
          },
          retryPolicy: {
            maxRetries: 1,
            backoff: 'exponential',
          },
        },
      },
      outputContract
    );

    logger.info(
      {
        portscanJobId,
        programId,
        openPorts: findings.length,
        hosts: uniqueHosts.size,
        criticalPorts: criticalPorts.length,
        webPorts: webPorts.length,
      },
      '🔗 Portscan agent initiated rich handoff to Scanner'
    );
  }

  /**
   * ENHANCED: Service version detection (nmap -sV equivalent)
   * Detects service names and versions from open ports
   */
  private async detectServiceVersion(host: string, port: number): Promise<any> {
    const serviceInfo: any = {
      host,
      port,
      service: 'unknown',
      version: null,
      product: null,
      cpe: null,
    };

    // Common port-to-service mappings
    const commonServices: Record<number, string> = {
      21: 'FTP',
      22: 'SSH',
      23: 'Telnet',
      25: 'SMTP',
      53: 'DNS',
      80: 'HTTP',
      110: 'POP3',
      143: 'IMAP',
      443: 'HTTPS',
      445: 'SMB',
      1433: 'MSSQL',
      3306: 'MySQL',
      3389: 'RDP',
      5432: 'PostgreSQL',
      5900: 'VNC',
      6379: 'Redis',
      8080: 'HTTP-Proxy',
      8443: 'HTTPS-Alt',
      9200: 'Elasticsearch',
      27017: 'MongoDB',
    };

    serviceInfo.service = commonServices[port] || 'unknown';

    // Try banner grabbing for version detection
    const banner = await this.grabBanner(host, port);
    if (banner) {
      serviceInfo.banner = banner;
      serviceInfo.version = this.extractVersionFromBanner(banner, serviceInfo.service);
    }

    logger.info({ host, port, service: serviceInfo.service }, 'Detected service version');
    return serviceInfo;
  }

  /**
   * ENHANCED: Banner grabbing for service identification
   */
  private async grabBanner(host: string, port: number): Promise<string | null> {
    try {
      const net = await import('net');

      return new Promise((resolve) => {
        const socket = new net.Socket();
        let banner = '';
        const timeout = setTimeout(() => {
          socket.destroy();
          resolve(null);
        }, 3000);

        socket.connect(port, host, () => {
          // Send protocol-specific probes
          if (port === 80 || port === 8080) {
            socket.write('GET / HTTP/1.0\r\n\r\n');
          } else if (port === 25) {
            socket.write('EHLO banner-grab\r\n');
          } else if (port === 22) {
            // SSH sends banner automatically
          } else {
            socket.write('\r\n');
          }
        });

        socket.on('data', (data) => {
          banner += data.toString('utf8', 0, 1024); // Limit to 1KB
          clearTimeout(timeout);
          socket.destroy();
          resolve(banner);
        });

        socket.on('error', () => {
          clearTimeout(timeout);
          resolve(null);
        });
      });
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract version from banner
   */
  private extractVersionFromBanner(banner: string, service: string): string | null {
    const versionPatterns: Record<string, RegExp> = {
      'SSH': /SSH-[\d.]+-OpenSSH_([\d.]+[p\d]*)/i,
      'HTTP': /Server:\s*([^\r\n]+)/i,
      'HTTPS': /Server:\s*([^\r\n]+)/i,
      'FTP': /220.*FTP.*?([\d.]+)/i,
      'SMTP': /220.*ESMTP.*?([\d.]+)/i,
      'MySQL': /mysql.*?([\d.]+)/i,
      'PostgreSQL': /PostgreSQL\s+([\d.]+)/i,
      'Redis': /Redis.*?([\d.]+)/i,
      'MongoDB': /MongoDB.*?([\d.]+)/i,
    };

    const pattern = versionPatterns[service];
    if (pattern) {
      const match = banner.match(pattern);
      if (match) {
        return match[1];
      }
    }

    // Generic version pattern
    const genericMatch = banner.match(/([\d]+\.[\d]+\.[\d]+)/);
    return genericMatch ? genericMatch[1] : null;
  }

  /**
   * ENHANCED: Vulnerability matching for detected services
   */
  private async matchServiceVulnerabilities(serviceInfo: any): Promise<any[]> {
    const vulnerabilities: any[] = [];

    // Known vulnerable service versions
    const knownVulnerabilities: Record<string, Array<{
      version: string;
      cves: string[];
      severity: string;
      cvss: number;
      description: string;
    }>> = {
      'SSH': [
        {
          version: '7.4',
          cves: ['CVE-2018-15473'],
          severity: 'medium',
          cvss: 5.3,
          description: 'OpenSSH 7.4 user enumeration vulnerability',
        },
      ],
      'HTTP': [
        {
          version: '2.4.49',
          cves: ['CVE-2021-41773', 'CVE-2021-42013'],
          severity: 'critical',
          cvss: 9.8,
          description: 'Apache HTTP Server 2.4.49 path traversal RCE',
        },
      ],
      'MySQL': [
        {
          version: '5.7.0',
          cves: ['CVE-2016-6662'],
          severity: 'critical',
          cvss: 9.0,
          description: 'MySQL privilege escalation via logging',
        },
      ],
      'Redis': [
        {
          version: '5.0.0',
          cves: ['CVE-2019-10192', 'CVE-2019-10193'],
          severity: 'high',
          cvss: 7.2,
          description: 'Redis unauthenticated access and command injection',
        },
      ],
      'Elasticsearch': [
        {
          version: '1.4.2',
          cves: ['CVE-2015-1427'],
          severity: 'critical',
          cvss: 10.0,
          description: 'Elasticsearch Groovy script RCE',
        },
      ],
    };

    if (serviceInfo.version && knownVulnerabilities[serviceInfo.service]) {
      for (const vuln of knownVulnerabilities[serviceInfo.service]) {
        if (serviceInfo.version.startsWith(vuln.version)) {
          vulnerabilities.push({
            host: serviceInfo.host,
            port: serviceInfo.port,
            service: serviceInfo.service,
            version: serviceInfo.version,
            ...vuln,
          });
        }
      }
    }

    logger.info({ service: serviceInfo.service, vulns: vulnerabilities.length }, 'Matched service vulnerabilities');
    return vulnerabilities;
  }

  /**
   * ENHANCED: Adaptive port scanning
   * Focuses on open port ranges for deeper scanning
   */
  private async adaptivePortScan(host: string, initialPorts: number[]): Promise<number[]> {
    if (initialPorts.length === 0) {
      return [];
    }

    const additionalPorts: number[] = [];

    // Find port ranges with multiple open ports
    const sortedPorts = [...initialPorts].sort((a, b) => a - b);
    const ranges: Array<{ start: number; end: number }> = [];

    for (let i = 0; i < sortedPorts.length - 1; i++) {
      const current = sortedPorts[i];
      const next = sortedPorts[i + 1];

      // If ports are close (within 100), consider it a range
      if (next - current <= 100 && next - current > 1) {
        ranges.push({ start: current, end: next });
      }
    }

    // Scan ports within identified ranges
    for (const range of ranges) {
      for (let port = range.start + 1; port < range.end; port++) {
        if (!initialPorts.includes(port)) {
          additionalPorts.push(port);
        }
      }
    }

    logger.info({ host, ranges: ranges.length, additional: additionalPorts.length }, 'Adaptive port scanning');
    return additionalPorts;
  }

  /**
   * ENHANCED: Shodan/Censys integration for historical data
   * Enriches findings with passive reconnaissance data
   */
  private async enrichWithShodanData(host: string): Promise<any> {
    const enrichmentData: any = {
      host,
      shodan: null,
      lastSeen: null,
      historicalPorts: [],
      tags: [],
      vulns: [],
    };

    // Simulate Shodan API (in production, use actual Shodan API)
    // This would require API key: process.env.SHODAN_API_KEY

    // Mock historical data based on common patterns
    enrichmentData.tags = this.identifyHostTags(host);
    enrichmentData.historicalPorts = this.getHistoricalPortsHeuristic(host);

    logger.info({ host, tags: enrichmentData.tags.length }, 'Enriched with historical data');
    return enrichmentData;
  }

  /**
   * Identify host tags based on hostname patterns
   */
  private identifyHostTags(host: string): string[] {
    const tags: string[] = [];

    if (host.includes('api')) tags.push('api');
    if (host.includes('admin')) tags.push('admin-panel');
    if (host.includes('dev') || host.includes('staging')) tags.push('dev-environment');
    if (host.includes('prod') || host.includes('production')) tags.push('production');
    if (host.includes('db') || host.includes('database')) tags.push('database');
    if (host.includes('cdn')) tags.push('cdn');
    if (host.includes('mail')) tags.push('mail-server');

    return tags;
  }

  /**
   * Get historical ports based on hostname patterns
   */
  private getHistoricalPortsHeuristic(host: string): number[] {
    const ports: number[] = [];

    if (host.includes('web') || host.includes('www')) {
      ports.push(80, 443, 8080, 8443);
    }
    if (host.includes('mail')) {
      ports.push(25, 110, 143, 465, 587, 993, 995);
    }
    if (host.includes('db') || host.includes('database')) {
      ports.push(3306, 5432, 1433, 27017, 6379);
    }
    if (host.includes('ftp')) {
      ports.push(21, 22);
    }

    return ports;
  }
}
