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

export interface RaceConditionJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testTOCTOU?: boolean;
    testRateLimitBypass?: boolean;
    testDoubleSpending?: boolean;
    testAuthRace?: boolean;
    parallelRequests?: number;
    timeout?: number;
  };
}

export interface RaceConditionResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type: 'toctou' | 'rate-limit-bypass' | 'double-spending' | 'auth-race' | 'parallel-race';
    severity: 'critical' | 'high' | 'medium';
    confidence: number;
    evidence: string;
    raceVector: string;
    impact: string;
    remediation: string;
  }>;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * Race Condition Agent
 *
 * Detects and exploits race condition vulnerabilities:
 * - TOCTOU (Time-of-Check-Time-of-Use) attacks
 * - Parallel request racing
 * - Rate limit bypass via concurrent requests
 * - Double spending in payment/transaction flows
 * - Race conditions in authentication flows
 * - Session creation races
 * - Inventory/coupon code exhaustion
 *
 * Tools: Turbo Intruder patterns, custom race harness
 */
export class RaceConditionAgent extends BaseAgent<RaceConditionJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('racecondition' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify race-vulnerable endpoints', metadata: { phase: 'discovery' } },
      { name: 'Test TOCTOU vulnerabilities', metadata: { phase: 'toctou-testing' } },
      { name: 'Test rate limit bypass', metadata: { phase: 'rate-limit-testing' } },
      { name: 'Test payment/transaction races', metadata: { phase: 'payment-testing' } },
      { name: 'Test authentication races', metadata: { phase: 'auth-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<RaceConditionJob>): Promise<RaceConditionResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'racecondition',
      'start',
      'info',
      `Starting race condition testing on ${urls.length} URLs`
    );

    const result: RaceConditionResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify vulnerable endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const endpoints = await this.identifyRaceVulnerableEndpoints(urls, programId, job.id);
      result.testedEndpoints = endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', { endpointsFound: endpoints.length });

      // Step 2: TOCTOU testing
      if (options.testTOCTOU !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const toctouVulns = await this.testTOCTOU(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...toctouVulns);
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: toctouVulns.length,
        });
      }

      // Step 3: Rate limit bypass
      if (options.testRateLimitBypass !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const rateLimitVulns = await this.testRateLimitBypass(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...rateLimitVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: rateLimitVulns.length,
        });
      }

      // Step 4: Payment/transaction races
      if (options.testDoubleSpending !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const paymentVulns = await this.testPaymentRaces(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...paymentVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: paymentVulns.length,
        });
      }

      // Step 5: Authentication races
      if (options.testAuthRace !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const authVulns = await this.testAuthenticationRaces(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...authVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: authVulns.length,
        });
      }

      // Step 6: Store findings
      await this.updateStepStatus(job.id, 5, 'running');
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }
      await this.updateStepStatus(job.id, 5, 'completed', {
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
        'racecondition',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} race condition vulnerabilities in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(job.id, programId, 'racecondition', 'error', 'error', `Error: ${error.message}`);
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify endpoints vulnerable to race conditions
   */
  private async identifyRaceVulnerableEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    // Target endpoints that handle state changes
    const racePatterns = [
      '/checkout',
      '/payment',
      '/purchase',
      '/redeem',
      '/coupon',
      '/vote',
      '/like',
      '/apply',
      '/register',
      '/signup',
      '/transfer',
      '/withdraw',
    ];

    return urls.filter((url) => racePatterns.some((pattern) => url.toLowerCase().includes(pattern)));
  }

  /**
   * Test TOCTOU (Time-of-Check-Time-of-Use) vulnerabilities
   */
  private async testTOCTOU(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: RaceConditionJob['options']
  ): Promise<RaceConditionResult['vulnerabilities']> {
    const vulnerabilities: RaceConditionResult['vulnerabilities'] = [];
    const parallelRequests = options.parallelRequests || 50;

    for (const endpoint of endpoints) {
      try {
        // Send parallel requests to exploit TOCTOU window
        const promises = Array.from({ length: parallelRequests }, () =>
          axios.post(
            endpoint,
            { test: 'race' },
            {
              timeout: 10000,
              validateStatus: () => true,
            }
          )
        );

        const responses = await Promise.all(promises);

        // Check for inconsistent responses indicating race condition
        const successCount = responses.filter((r) => r.status === 200).length;
        const differentResponses = new Set(responses.map((r) => JSON.stringify(r.data))).size;

        if (successCount > 1 && differentResponses > 1) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'toctou',
            severity: 'high',
            confidence: 0.8,
            evidence: `${successCount} successful responses out of ${parallelRequests} parallel requests with ${differentResponses} different response bodies`,
            raceVector: `Parallel requests: ${parallelRequests}, Success rate: ${(successCount / parallelRequests * 100).toFixed(2)}%`,
            impact:
              'TOCTOU race conditions can allow attackers to bypass checks, manipulate state, or exploit timing windows between validation and action.',
            remediation:
              'Use atomic operations, database transactions with proper isolation levels, and pessimistic locking. Implement idempotency keys for critical operations.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing TOCTOU');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test rate limit bypass via race conditions
   */
  private async testRateLimitBypass(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: RaceConditionJob['options']
  ): Promise<RaceConditionResult['vulnerabilities']> {
    const vulnerabilities: RaceConditionResult['vulnerabilities'] = [];
    const parallelRequests = options.parallelRequests || 100;

    for (const endpoint of endpoints) {
      try {
        // Sequential baseline (should hit rate limit)
        let rateLimitHit = false;
        for (let i = 0; i < 20; i++) {
          const response = await axios.get(endpoint, {
            timeout: 5000,
            validateStatus: () => true,
          });
          if (response.status === 429 || response.headers['x-ratelimit-remaining'] === '0') {
            rateLimitHit = true;
            break;
          }
        }

        if (!rateLimitHit) continue; // No rate limit detected

        // Wait a bit for rate limit to reset
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Parallel burst (should bypass if vulnerable)
        const promises = Array.from({ length: parallelRequests }, () =>
          axios.get(endpoint, {
            timeout: 10000,
            validateStatus: () => true,
          })
        );

        const responses = await Promise.all(promises);
        const successCount = responses.filter((r) => r.status === 200).length;

        // If many parallel requests succeeded but sequential failed, vulnerable
        if (successCount > 20) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'rate-limit-bypass',
            severity: 'medium',
            confidence: 0.85,
            evidence: `Rate limit bypassed: ${successCount}/${parallelRequests} parallel requests succeeded despite rate limiting`,
            raceVector: `Burst of ${parallelRequests} concurrent requests bypassed rate limit`,
            impact:
              'Rate limit bypass via race conditions allows attackers to perform brute force attacks, scraping, or resource exhaustion.',
            remediation:
              'Implement distributed rate limiting with Redis or similar. Use token bucket with atomic operations. Apply rate limiting before request processing begins.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing rate limit bypass');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test payment/transaction race conditions
   */
  private async testPaymentRaces(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: RaceConditionJob['options']
  ): Promise<RaceConditionResult['vulnerabilities']> {
    const vulnerabilities: RaceConditionResult['vulnerabilities'] = [];

    const paymentEndpoints = endpoints.filter((url) =>
      ['/payment', '/checkout', '/purchase', '/redeem'].some((p) => url.toLowerCase().includes(p))
    );

    for (const endpoint of paymentEndpoints) {
      try {
        // Test double spending by racing payment requests
        const parallelRequests = options.parallelRequests || 10;

        const promises = Array.from({ length: parallelRequests }, () =>
          axios.post(
            endpoint,
            {
              amount: 1,
              currency: 'USD',
              paymentMethod: 'test',
            },
            {
              timeout: 15000,
              validateStatus: () => true,
            }
          )
        );

        const responses = await Promise.all(promises);
        const successCount = responses.filter(
          (r) => r.status === 200 || r.status === 201
        ).length;

        // If multiple payments succeeded, potential double-spending
        if (successCount > 1) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'double-spending',
            severity: 'critical',
            confidence: 0.9,
            evidence: `${successCount} payment transactions succeeded from ${parallelRequests} parallel requests - potential double-spending`,
            raceVector: `Parallel payment requests allowed multiple charges`,
            impact:
              'Double-spending race conditions can allow attackers to purchase items multiple times while only paying once, redeem coupons multiple times, or drain account balances.',
            remediation:
              'Use database transactions with SELECT FOR UPDATE, implement idempotency keys, add unique constraints on transaction IDs, use distributed locks (Redis SETNX).',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing payment races');
      }
    }

    return vulnerabilities;
  }

  /**
   * Test authentication flow race conditions
   */
  private async testAuthenticationRaces(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: RaceConditionJob['options']
  ): Promise<RaceConditionResult['vulnerabilities']> {
    const vulnerabilities: RaceConditionResult['vulnerabilities'] = [];

    const authEndpoints = endpoints.filter((url) =>
      ['/login', '/register', '/signup', '/auth'].some((p) => url.toLowerCase().includes(p))
    );

    for (const endpoint of authEndpoints) {
      try {
        // Test session creation race
        const parallelRequests = options.parallelRequests || 20;

        const promises = Array.from({ length: parallelRequests }, () =>
          axios.post(
            endpoint,
            {
              username: `testuser_${Date.now()}`,
              password: 'testpassword123',
            },
            {
              timeout: 10000,
              validateStatus: () => true,
            }
          )
        );

        const responses = await Promise.all(promises);
        const sessionTokens = responses
          .map((r) => r.headers['set-cookie']?.join(','))
          .filter(Boolean);

        // Check for duplicate sessions or multiple successful registrations
        const uniqueSessions = new Set(sessionTokens).size;
        const successCount = responses.filter((r) => r.status === 200 || r.status === 201).length;

        if (successCount > 1) {
          vulnerabilities.push({
            url: endpoint,
            endpoint,
            type: 'auth-race',
            severity: 'high',
            confidence: 0.75,
            evidence: `${successCount} successful auth operations from ${parallelRequests} parallel requests, ${uniqueSessions} unique sessions created`,
            raceVector: `Race in authentication flow allowed duplicate operations`,
            impact:
              'Authentication race conditions can lead to account enumeration, duplicate accounts, session fixation, or privilege escalation.',
            remediation:
              'Use atomic operations for user creation, implement unique constraints on usernames/emails, use distributed locks for critical auth operations.',
          });
        }
      } catch (error: any) {
        logger.debug({ endpoint, error: error.message }, 'Error testing auth races');
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: RaceConditionResult['vulnerabilities'],
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
          vuln.raceVector,
          vuln.remediation,
          vuln.confidence,
          JSON.stringify({
            endpoint: vuln.endpoint,
            raceType: vuln.type,
            impact: vuln.impact,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: vulnerabilities.length,
      severity: vulnerabilities[0]?.severity,
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: RaceConditionResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `race-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `racecondition-${jobId}`,
        metadata: {
          raceType: vuln.type,
          raceVector: vuln.raceVector,
          impact: vuln.impact,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ Race condition agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share race condition findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<RaceConditionJob>, result: RaceConditionResult) {
    const { programId } = job.data;

    // Critical race conditions -> escalate
    const criticalVulns = result.vulnerabilities.filter(
      (v) => v.severity === 'critical' || v.type === 'double-spending'
    );
    if (criticalVulns.length > 0) {
      await this.createHandoff(
        job.id,
        'racecondition',
        'triage',
        {
          reason: 'Critical race condition vulnerabilities detected',
          vulnerabilities: criticalVulns,
          priority: 'critical',
        },
        programId
      );
    }

    // Confirm all findings
    if (result.vulnerabilities.length > 0) {
      await this.createHandoff(
        job.id,
        'racecondition',
        'confirm',
        {
          reason: 'Race condition vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'race-condition',
        },
        programId
      );
    }
  }
}
