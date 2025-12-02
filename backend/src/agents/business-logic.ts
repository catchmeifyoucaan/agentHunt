/**
 * Business Logic Flaw Agent
 * Purpose: AI-powered detection of business logic vulnerabilities
 * 
 * Detection Targets:
 * - Payment manipulation (price tampering, currency arbitrage)
 * - Race conditions (double-spend, TOCTOU)
 * - 2FA bypass techniques
 * - Referral/reward abuse
 * - Coupon/voucher bypass
 * - Privilege escalation flows
 * - OAuth flow attacks
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface BusinessLogicJob extends BaseJob {
  type: 'business-logic';
  options: {
    targetUrl: string;
    programId: string;
    endpoints?: string[];
    authToken?: string;
    testPayment?: boolean;
    testRaceConditions?: boolean;
    test2FABypass?: boolean;
    testReferralAbuse?: boolean;
  };
}

interface BusinessLogicFinding {
  vulnerability: string;
  category: 'payment' | 'race-condition' | '2fa-bypass' | 'referral-abuse' | 'privilege-escalation' | 'workflow-bypass';
  severity: 'critical' | 'high' | 'medium' | 'low';
  endpoint: string;
  method: string;
  description: string;
  impact: string;
  payload?: any;
  evidence?: string;
}

export class BusinessLogicAgent extends BaseAgent<BusinessLogicJob> {
  constructor() {
    super('business-logic');
  }

  protected getSteps() {
    return [
      { name: 'Discover application workflows' },
      { name: 'Test payment manipulation' },
      { name: 'Test race conditions' },
      { name: 'Test 2FA bypass' },
      { name: 'Test referral/reward abuse' },
      { name: 'Store findings' },
    ];
  }

  async process(job: Job<BusinessLogicJob>): Promise<any> {
    const { programId, options } = job.data;
    const {
      targetUrl,
      endpoints = [],
      authToken,
      testPayment = true,
      testRaceConditions = true,
      test2FABypass = true,
      testReferralAbuse = true,
    } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const findings: BusinessLogicFinding[] = [];

    try {
      // Step 1: Discover application workflows
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'workflow-discovery',
        toolStatus: 'running',
        message: 'Discovering application workflows',
      });

      const discoveredEndpoints = await this.discoverWorkflows(targetUrl, endpoints, authToken);
      logger.info({ endpointCount: discoveredEndpoints.length }, 'Discovered workflow endpoints');

      // Step 2: Test payment manipulation
      if (testPayment) {
        await this.updateJobProgress(job.id!, {
          current: 2,
          total: 6,
          percentage: 25,
          currentTool: 'payment-test',
          toolStatus: 'running',
          message: 'Testing payment manipulation',
        });

        const paymentFindings = await this.testPaymentManipulation(
          targetUrl,
          discoveredEndpoints,
          authToken
        );
        findings.push(...paymentFindings);
      }

      // Step 3: Test race conditions
      if (testRaceConditions) {
        await this.updateJobProgress(job.id!, {
          current: 3,
          total: 6,
          percentage: 45,
          currentTool: 'race-condition-test',
          toolStatus: 'running',
          message: 'Testing race conditions',
        });

        const raceFindings = await this.testRaceConditions(
          targetUrl,
          discoveredEndpoints,
          authToken
        );
        findings.push(...raceFindings);
      }

      // Step 4: Test 2FA bypass
      if (test2FABypass) {
        await this.updateJobProgress(job.id!, {
          current: 4,
          total: 6,
          percentage: 65,
          currentTool: '2fa-bypass-test',
          toolStatus: 'running',
          message: 'Testing 2FA bypass',
        });

        const twoFAFindings = await this.test2FABypass(targetUrl, authToken);
        findings.push(...twoFAFindings);
      }

      // Step 5: Test referral/reward abuse
      if (testReferralAbuse) {
        await this.updateJobProgress(job.id!, {
          current: 5,
          total: 6,
          percentage: 80,
          currentTool: 'referral-abuse-test',
          toolStatus: 'running',
          message: 'Testing referral/reward abuse',
        });

        const referralFindings = await this.testReferralAbuse(targetUrl, authToken);
        findings.push(...referralFindings);
      }

      // Step 6: Store findings
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 95,
        currentTool: 'storage',
        toolStatus: 'running',
        message: 'Storing findings',
      });

      for (const finding of findings) {
        await this.storeFinding(programId, finding, job.id!);
      }

      if (findings.length > 0) {
        await this.triggerHandoffs(programId, findings, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${findings.length} business logic vulnerabilities`,
      });

      const result = {
        targetUrl,
        endpointsAnalyzed: discoveredEndpoints.length,
        findingsCount: findings.length,
        criticalCount: findings.filter(f => f.severity === 'critical').length,
        highCount: findings.filter(f => f.severity === 'high').length,
        findings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'Business logic testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Discover application workflows and endpoints
   */
  private async discoverWorkflows(
    baseUrl: string,
    providedEndpoints: string[],
    authToken?: string
  ): Promise<string[]> {
    const endpoints = [...providedEndpoints];

    // Common business logic endpoints to probe
    const commonEndpoints = [
      '/api/checkout',
      '/api/payment',
      '/api/cart',
      '/api/order',
      '/api/purchase',
      '/api/subscribe',
      '/api/referral',
      '/api/reward',
      '/api/coupon',
      '/api/voucher',
      '/api/discount',
      '/api/promo',
      '/api/2fa',
      '/api/mfa',
      '/api/verify',
      '/api/confirm',
      '/api/transfer',
      '/api/withdraw',
      '/api/deposit',
      '/api/balance',
      '/api/wallet',
      '/api/credits',
      '/api/points',
      '/api/upgrade',
      '/api/downgrade',
      '/api/subscription',
    ];

    for (const endpoint of commonEndpoints) {
      try {
        const url = `${baseUrl}${endpoint}`;
        const response = await this.makeRequest(url, 'GET', authToken);
        
        // If endpoint exists (not 404), add it
        if (response.status !== 404) {
          endpoints.push(endpoint);
        }
      } catch {}
    }

    return [...new Set(endpoints)];
  }

  /**
   * Test payment manipulation vulnerabilities
   */
  private async testPaymentManipulation(
    baseUrl: string,
    endpoints: string[],
    authToken?: string
  ): Promise<BusinessLogicFinding[]> {
    const findings: BusinessLogicFinding[] = [];

    // Filter for payment-related endpoints
    const paymentEndpoints = endpoints.filter(e => 
      /payment|checkout|cart|order|purchase|price|amount|total/i.test(e)
    );

    for (const endpoint of paymentEndpoints) {
      const url = `${baseUrl}${endpoint}`;

      // Test 1: Negative price manipulation
      try {
        const negativePayload = { amount: -100, price: -50, quantity: -1 };
        const response = await this.makeRequest(url, 'POST', authToken, negativePayload);
        
        if (response.status === 200 || response.status === 201) {
          findings.push({
            vulnerability: 'Negative Price Manipulation',
            category: 'payment',
            severity: 'critical',
            endpoint: url,
            method: 'POST',
            description: 'The application accepts negative values for price/amount fields, potentially allowing attackers to receive money instead of paying.',
            impact: 'Financial loss, fraudulent transactions',
            payload: negativePayload,
            evidence: `Response status: ${response.status}`,
          });
        }
      } catch {}

      // Test 2: Zero price manipulation
      try {
        const zeroPayload = { amount: 0, price: 0, total: 0 };
        const response = await this.makeRequest(url, 'POST', authToken, zeroPayload);
        
        if (response.status === 200 || response.status === 201) {
          if (!response.body?.includes('error') && !response.body?.includes('invalid')) {
            findings.push({
              vulnerability: 'Zero Price Bypass',
              category: 'payment',
              severity: 'high',
              endpoint: url,
              method: 'POST',
              description: 'The application accepts zero values for price fields, potentially allowing free purchases.',
              impact: 'Financial loss, free products/services',
              payload: zeroPayload,
            });
          }
        }
      } catch {}

      // Test 3: Currency manipulation
      try {
        const currencyPayloads = [
          { currency: 'XXX', amount: 100 },
          { currency: 'VND', amount: 100 }, // Low value currency
          { currency: '', amount: 100 },
        ];

        for (const payload of currencyPayloads) {
          const response = await this.makeRequest(url, 'POST', authToken, payload);
          
          if (response.status === 200 || response.status === 201) {
            findings.push({
              vulnerability: 'Currency Manipulation',
              category: 'payment',
              severity: 'high',
              endpoint: url,
              method: 'POST',
              description: 'The application may be vulnerable to currency manipulation attacks.',
              impact: 'Financial arbitrage, payment bypass',
              payload,
            });
            break;
          }
        }
      } catch {}
    }

    return findings;
  }

  /**
   * Test race condition vulnerabilities
   */
  private async testRaceConditions(
    baseUrl: string,
    endpoints: string[],
    authToken?: string
  ): Promise<BusinessLogicFinding[]> {
    const findings: BusinessLogicFinding[] = [];

    // Endpoints likely vulnerable to race conditions
    const raceEndpoints = endpoints.filter(e =>
      /redeem|claim|transfer|withdraw|use|apply|coupon|voucher|reward|bonus/i.test(e)
    );

    for (const endpoint of raceEndpoints) {
      const url = `${baseUrl}${endpoint}`;

      try {
        // Send multiple concurrent requests
        const concurrentRequests = 10;
        const payload = { action: 'claim', amount: 1 };

        const promises = Array(concurrentRequests).fill(null).map(() =>
          this.makeRequest(url, 'POST', authToken, payload)
        );

        const responses = await Promise.all(promises);
        const successCount = responses.filter(r => r.status === 200 || r.status === 201).length;

        // If more than one request succeeded, potential race condition
        if (successCount > 1) {
          findings.push({
            vulnerability: 'Race Condition (Double-Spend)',
            category: 'race-condition',
            severity: 'critical',
            endpoint: url,
            method: 'POST',
            description: `Sent ${concurrentRequests} concurrent requests, ${successCount} succeeded. This indicates a potential race condition allowing double-spend or multiple claims.`,
            impact: 'Financial loss, reward abuse, duplicate transactions',
            evidence: `${successCount}/${concurrentRequests} requests succeeded`,
          });
        }
      } catch {}
    }

    return findings;
  }

  /**
   * Test 2FA bypass vulnerabilities
   */
  private async test2FABypass(
    baseUrl: string,
    authToken?: string
  ): Promise<BusinessLogicFinding[]> {
    const findings: BusinessLogicFinding[] = [];

    const twoFAEndpoints = [
      '/api/2fa/verify',
      '/api/mfa/verify',
      '/api/verify-otp',
      '/api/auth/2fa',
      '/api/login/2fa',
      '/2fa',
      '/mfa',
    ];

    for (const endpoint of twoFAEndpoints) {
      const url = `${baseUrl}${endpoint}`;

      // Test 1: Empty OTP
      try {
        const response = await this.makeRequest(url, 'POST', authToken, { otp: '', code: '' });
        if (response.status === 200) {
          findings.push({
            vulnerability: '2FA Bypass - Empty OTP Accepted',
            category: '2fa-bypass',
            severity: 'critical',
            endpoint: url,
            method: 'POST',
            description: 'The 2FA verification accepts empty OTP codes.',
            impact: 'Complete 2FA bypass, account takeover',
          });
        }
      } catch {}

      // Test 2: Null OTP
      try {
        const response = await this.makeRequest(url, 'POST', authToken, { otp: null, code: null });
        if (response.status === 200) {
          findings.push({
            vulnerability: '2FA Bypass - Null OTP Accepted',
            category: '2fa-bypass',
            severity: 'critical',
            endpoint: url,
            method: 'POST',
            description: 'The 2FA verification accepts null OTP values.',
            impact: 'Complete 2FA bypass, account takeover',
          });
        }
      } catch {}

      // Test 3: Response manipulation (check if response contains bypass indicators)
      try {
        const response = await this.makeRequest(url, 'POST', authToken, { otp: '000000' });
        if (response.body?.includes('success') || response.body?.includes('verified')) {
          findings.push({
            vulnerability: '2FA Bypass - Weak OTP Validation',
            category: '2fa-bypass',
            severity: 'high',
            endpoint: url,
            method: 'POST',
            description: 'The 2FA verification may accept predictable OTP codes.',
            impact: 'Potential 2FA bypass',
          });
        }
      } catch {}

      // Test 4: Skip 2FA by directly accessing protected resource
      try {
        const protectedEndpoints = ['/api/account', '/api/profile', '/api/settings'];
        for (const protected_ of protectedEndpoints) {
          const response = await this.makeRequest(`${baseUrl}${protected_}`, 'GET', authToken);
          if (response.status === 200 && !response.body?.includes('2fa') && !response.body?.includes('verify')) {
            findings.push({
              vulnerability: '2FA Bypass - Direct Access',
              category: '2fa-bypass',
              severity: 'high',
              endpoint: protected_,
              method: 'GET',
              description: 'Protected resources may be accessible without completing 2FA.',
              impact: 'Partial 2FA bypass',
            });
            break;
          }
        }
      } catch {}
    }

    return findings;
  }

  /**
   * Test referral/reward abuse vulnerabilities
   */
  private async testReferralAbuse(
    baseUrl: string,
    authToken?: string
  ): Promise<BusinessLogicFinding[]> {
    const findings: BusinessLogicFinding[] = [];

    const referralEndpoints = [
      '/api/referral',
      '/api/refer',
      '/api/invite',
      '/api/reward',
      '/api/bonus',
      '/api/promo',
      '/api/coupon',
    ];

    for (const endpoint of referralEndpoints) {
      const url = `${baseUrl}${endpoint}`;

      // Test 1: Self-referral
      try {
        const selfReferralPayload = { referrer: 'self', code: 'SELF' };
        const response = await this.makeRequest(url, 'POST', authToken, selfReferralPayload);
        
        if (response.status === 200 || response.status === 201) {
          findings.push({
            vulnerability: 'Self-Referral Abuse',
            category: 'referral-abuse',
            severity: 'medium',
            endpoint: url,
            method: 'POST',
            description: 'The application may allow users to refer themselves.',
            impact: 'Reward abuse, unfair advantage',
            payload: selfReferralPayload,
          });
        }
      } catch {}

      // Test 2: Coupon reuse
      try {
        const couponPayload = { code: 'TEST123', coupon: 'DISCOUNT50' };
        
        // Try to use the same coupon twice
        await this.makeRequest(url, 'POST', authToken, couponPayload);
        const response2 = await this.makeRequest(url, 'POST', authToken, couponPayload);
        
        if (response2.status === 200 || response2.status === 201) {
          findings.push({
            vulnerability: 'Coupon Reuse',
            category: 'referral-abuse',
            severity: 'medium',
            endpoint: url,
            method: 'POST',
            description: 'The application may allow reusing single-use coupons.',
            impact: 'Financial loss, unlimited discounts',
            payload: couponPayload,
          });
        }
      } catch {}
    }

    return findings;
  }

  /**
   * Make HTTP request
   */
  private async makeRequest(
    url: string,
    method: string,
    authToken?: string,
    body?: any
  ): Promise<{ status: number; body: string }> {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      return {
        status: response.status,
        body: await response.text(),
      };
    } catch (error) {
      return { status: 0, body: '' };
    }
  }

  /**
   * Store finding in database
   */
  private async storeFinding(programId: string, finding: BusinessLogicFinding, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          programId,
          jobId,
          'business-logic',
          finding.severity,
          finding.vulnerability,
          finding.endpoint,
          `${finding.description}\n\nImpact: ${finding.impact}`,
          JSON.stringify({ category: finding.category, payload: finding.payload, evidence: finding.evidence }),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save business logic finding');
    }
  }

  /**
   * Trigger handoffs for critical findings
   */
  private async triggerHandoffs(programId: string, findings: BusinessLogicFinding[], jobId: string): Promise<void> {
    const criticalFindings = findings.filter(f => f.severity === 'critical');
    
    if (criticalFindings.length > 0) {
      await this.handoff('triage', {
        toAgent: 'triage',
        reason: `Found ${criticalFindings.length} critical business logic vulnerabilities`,
        data: {
          findings: criticalFindings,
          urgency: 'critical',
        },
        priority: 10,
        metadata: {
          programId,
          parentJobId: jobId,
          source: 'business-logic',
        },
      });
    }
  }
}

export default new BusinessLogicAgent();
