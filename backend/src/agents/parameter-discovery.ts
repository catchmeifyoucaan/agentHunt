import { BaseAgent } from './base-agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import Logger from '../utils/logger';

const execAsync = promisify(exec);

interface ParameterConfig {
  methods?: ('GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH')[];
  maxParameters?: number;
  useArjun?: boolean;
  useParamSpider?: boolean;
  customWordlist?: string;
}

interface ParameterFinding {
  url: string;
  parameter: string;
  method: string;
  source: 'arjun' | 'paramspider' | 'bruteforce' | 'wayback' | 'js-analysis';
  reflected: boolean;
  type?: 'query' | 'body' | 'header' | 'cookie';
  value?: string;
  response?: {
    statusCode: number;
    lengthDiff: number;
    timeDiff: number;
  };
}

export class ParameterDiscoveryAgent extends BaseAgent {
  name = 'Parameter Discovery Agent';
  description = 'Discovers hidden parameters using Arjun, ParamSpider, Wayback Machine, and intelligent bruteforce';

  private commonParameters = [
    // Common GET/POST parameters
    'id', 'user', 'username', 'email', 'password', 'token', 'api_key',
    'access_token', 'refresh_token', 'session', 'key', 'secret', 'code',
    'callback', 'redirect', 'return', 'url', 'link', 'src', 'dest',
    'file', 'path', 'page', 'view', 'action', 'method', 'function',
    'cmd', 'command', 'exec', 'query', 'search', 'q', 'keyword',
    'name', 'value', 'data', 'input', 'output', 'content', 'body',
    'message', 'text', 'comment', 'note', 'description', 'title',
    'type', 'format', 'mode', 'debug', 'verbose', 'v', 'version',
    'limit', 'offset', 'page_size', 'per_page', 'count', 'max',
    'sort', 'order', 'order_by', 'filter', 'where', 'group_by',
    'start', 'end', 'from', 'to', 'before', 'after', 'since',
    'id[]', 'ids[]', 'user_id', 'user_ids[]', 'item_id', 'product_id',
    'category', 'tag', 'tags[]', 'status', 'state', 'lang', 'language',
    'locale', 'timezone', 'currency', 'country', 'region', 'city',
    'lat', 'latitude', 'lng', 'longitude', 'location', 'address',
    'zip', 'postal_code', 'phone', 'mobile', 'fax', 'website',
    'admin', 'administrator', 'root', 'superuser', 'moderator',
    'role', 'permission', 'access', 'level', 'group', 'team',
    'organization', 'org', 'company', 'department', 'division',
    'firstName', 'first_name', 'lastName', 'last_name', 'middleName',
    'age', 'gender', 'birthday', 'birthdate', 'dob', 'date_of_birth',
    'avatar', 'image', 'photo', 'picture', 'thumbnail', 'icon',
    'upload', 'download', 'import', 'export', 'backup', 'restore',
    'create', 'update', 'delete', 'read', 'write', 'edit', 'remove',
    'enable', 'disable', 'activate', 'deactivate', 'suspend', 'resume',
    'approve', 'reject', 'accept', 'deny', 'confirm', 'cancel',
    'submit', 'save', 'send', 'share', 'publish', 'unpublish',
    'amount', 'price', 'cost', 'total', 'subtotal', 'tax', 'discount',
    'quantity', 'qty', 'stock', 'inventory', 'sku', 'barcode',
    'invoice', 'receipt', 'order', 'transaction', 'payment', 'refund',
    'shipping', 'delivery', 'tracking', 'carrier', 'method', 'option',

    // API-specific
    'api', 'v', 'v1', 'v2', 'v3', 'api_version', 'format', 'pretty',
    'callback', 'jsonp', 'json', 'xml', 'csv', 'fields', 'include',
    'exclude', 'expand', 'embed', 'nested', 'depth', 'relations',

    // Security-related
    'csrf', 'csrf_token', '_csrf', 'authenticity_token', 'nonce',
    'signature', 'hash', 'checksum', 'mac', 'hmac', 'salt',
    'iv', 'cipher', 'encrypt', 'decrypt', 'encode', 'decode',

    // Framework-specific
    '_method', '__method', 'X-HTTP-Method-Override', '_', '__',
    'debug', 'trace', 'profile', 'test', 'dev', 'development',

    // IDOR candidates
    'userId', 'accountId', 'customerId', 'orderId', 'invoiceId',
    'ticketId', 'messageId', 'postId', 'commentId', 'fileId',
  ];

  async getSteps(config?: ParameterConfig): Promise<string[]> {
    return [
      '🔍 Running Arjun parameter discovery',
      '🕷️ Mining parameters from Wayback Machine (ParamSpider)',
      '📜 Extracting parameters from JavaScript files',
      '🎯 Bruteforce testing common parameters',
      '🔎 Testing parameter reflection',
      '📊 Analyzing response differences',
      '🤝 Storing parameters for IDOR/injection testing',
      '🔗 Triggering handoffs to exploitation agents',
    ];
  }

  async process(job: any): Promise<void> {
    const { target, config = {} } = job.data as { target: string; config?: ParameterConfig };

    Logger.info(`[${this.name}] Starting parameter discovery for ${target}`);

    try {
      const allParameters: ParameterFinding[] = [];

      // Method 1: Arjun (if enabled and installed)
      if (config.useArjun !== false) {
        const arjunParams = await this.runArjun(target);
        allParameters.push(...arjunParams);
      }

      // Method 2: ParamSpider (Wayback Machine)
      if (config.useParamSpider !== false) {
        const waybackParams = await this.runParamSpider(target);
        allParameters.push(...waybackParams);
      }

      // Method 3: JavaScript analysis
      const jsParams = await this.extractFromJavaScript(target);
      allParameters.push(...jsParams);

      // Method 4: Bruteforce common parameters
      const bruteforceParams = await this.bruteforceParameters(target, config);
      allParameters.push(...bruteforceParams);

      // Deduplicate
      const unique = this.deduplicateParameters(allParameters);

      Logger.info(`[${this.name}] Found ${unique.length} unique parameters`);

      // Store findings
      await this.storeFindings(job, unique);

      // Trigger handoffs for interesting parameters
      const sensitiveParams = unique.filter(p =>
        p.parameter.includes('id') ||
        p.parameter.includes('user') ||
        p.parameter.includes('admin') ||
        p.parameter.includes('redirect') ||
        p.parameter.includes('callback') ||
        p.parameter.includes('url')
      );

      if (sensitiveParams.length > 0) {
        await this.triggerHandoff(job, 'sqli', {
          reason: `Found ${sensitiveParams.length} parameters for injection testing`,
          findings: sensitiveParams,
        });

        await this.triggerHandoff(job, 'xss', {
          reason: `Found ${sensitiveParams.length} parameters for XSS testing`,
          findings: sensitiveParams,
        });
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error: ${error}`);
      throw error;
    }
  }

  private async runArjun(target: string): Promise<ParameterFinding[]> {
    const findings: ParameterFinding[] = [];

    try {
      Logger.info(`[${this.name}] Running Arjun on ${target}`);

      const { stdout } = await execAsync(
        `arjun -u "${target}" --stable -oJ /tmp/arjun-results.json`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 120000 }
      );

      // Parse Arjun JSON output
      const results = JSON.parse(await require('fs/promises').readFile('/tmp/arjun-results.json', 'utf-8'));

      for (const result of results) {
        if (result.params) {
          for (const param of result.params) {
            findings.push({
              url: result.url || target,
              parameter: param,
              method: result.method || 'GET',
              source: 'arjun',
              reflected: false,
            });
          }
        }
      }

    } catch (error) {
      Logger.warn(`[${this.name}] Arjun failed (may not be installed): ${error}`);
    }

    return findings;
  }

  private async runParamSpider(target: string): Promise<ParameterFinding[]> {
    const findings: ParameterFinding[] = [];

    try {
      Logger.info(`[${this.name}] Running ParamSpider on ${target}`);

      const domain = new URL(target).hostname;

      const { stdout } = await execAsync(
        `paramspider -d ${domain} --output /tmp/paramspider-results.txt`,
        { maxBuffer: 10 * 1024 * 1024, timeout: 120000 }
      );

      // Parse ParamSpider output
      const content = await require('fs/promises').readFile('/tmp/paramspider-results.txt', 'utf-8');
      const urls = content.split('\n').filter(line => line.trim());

      for (const url of urls) {
        const parsedUrl = new URL(url);
        for (const [param, value] of parsedUrl.searchParams.entries()) {
          findings.push({
            url: url,
            parameter: param,
            method: 'GET',
            source: 'paramspider',
            reflected: false,
            type: 'query',
            value,
          });
        }
      }

    } catch (error) {
      Logger.warn(`[${this.name}] ParamSpider failed (may not be installed): ${error}`);
    }

    return findings;
  }

  private async extractFromJavaScript(target: string): Promise<ParameterFinding[]> {
    const findings: ParameterFinding[] = [];

    try {
      // Fetch the target page
      const response = await axios.get(target, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });

      const html = response.data;

      // Extract JS file URLs
      const scriptMatches = html.match(/<script[^>]+src=["']([^"']+)["']/g);
      if (!scriptMatches) return findings;

      for (const match of scriptMatches) {
        const srcMatch = match.match(/src=["']([^"']+)["']/);
        if (!srcMatch) continue;

        let jsUrl = srcMatch[1];
        if (!jsUrl.startsWith('http')) {
          jsUrl = new URL(jsUrl, target).toString();
        }

        // Fetch and analyze JS file
        try {
          const jsResponse = await axios.get(jsUrl, {
            timeout: 10000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
          });

          const jsContent = jsResponse.data;

          // Extract parameter patterns from JS
          const paramPatterns = [
            /["'](\w+)["']\s*:\s*["']?.*?["']?[,}]/g, // Object keys
            /params\[["'](\w+)["']\]/g, // params['key']
            /\.get\(["'](\w+)["']\)/g, // .get('key')
            /\.set\(["'](\w+)["']/g, // .set('key'
            /searchParams\.append\(["'](\w+)["']/g, // URLSearchParams
          ];

          for (const pattern of paramPatterns) {
            let match;
            while ((match = pattern.exec(jsContent)) !== null) {
              findings.push({
                url: target,
                parameter: match[1],
                method: 'GET',
                source: 'js-analysis',
                reflected: false,
              });
            }
          }

        } catch (error) {
          // Skip this JS file
          continue;
        }
      }

    } catch (error) {
      Logger.warn(`[${this.name}] JS extraction failed: ${error}`);
    }

    return findings;
  }

  private async bruteforceParameters(target: string, config: ParameterConfig): Promise<ParameterFinding[]> {
    const findings: ParameterFinding[] = [];
    const methods = config.methods || ['GET', 'POST'];
    const maxParams = config.maxParameters || 100;

    Logger.info(`[${this.name}] Bruteforcing ${this.commonParameters.length} common parameters`);

    // Get baseline response
    const baseline = await this.getResponse(target, 'GET', {});

    for (const param of this.commonParameters.slice(0, maxParams)) {
      for (const method of methods) {
        try {
          const testParams = { [param]: 'test' };
          const response = await this.getResponse(target, method, testParams);

          // Check if parameter made a difference
          const lengthDiff = Math.abs(response.length - baseline.length);
          const timeDiff = Math.abs(response.time - baseline.time);

          if (lengthDiff > 0 || response.status !== baseline.status) {
            findings.push({
              url: target,
              parameter: param,
              method,
              source: 'bruteforce',
              reflected: response.body.includes('test'),
              type: method === 'GET' ? 'query' : 'body',
              response: {
                statusCode: response.status,
                lengthDiff,
                timeDiff,
              },
            });
          }

        } catch (error) {
          // Skip this parameter
          continue;
        }
      }
    }

    return findings;
  }

  private async getResponse(
    url: string,
    method: string,
    params: Record<string, string>
  ): Promise<{ status: number; length: number; time: number; body: string }> {
    const startTime = Date.now();

    let response;
    if (method === 'GET') {
      response = await axios.get(url, {
        params,
        timeout: 5000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
    } else {
      response = await axios.post(url, params, {
        timeout: 5000,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
    }

    const endTime = Date.now();

    return {
      status: response.status,
      length: JSON.stringify(response.data).length,
      time: endTime - startTime,
      body: typeof response.data === 'string' ? response.data : JSON.stringify(response.data),
    };
  }

  private deduplicateParameters(params: ParameterFinding[]): ParameterFinding[] {
    const seen = new Map<string, ParameterFinding>();

    for (const param of params) {
      const key = `${param.url}:${param.parameter}:${param.method}`;

      if (!seen.has(key)) {
        seen.set(key, param);
      }
    }

    return Array.from(seen.values());
  }

  private async storeFindings(job: any, findings: ParameterFinding[]): Promise<void> {
    if (job.sharedMemory) {
      await job.sharedMemory.storeFindings(this.name, findings.map(f => ({
        agent: this.name,
        type: 'Parameter Discovery',
        url: f.url,
        parameter: f.parameter,
        method: f.method,
        source: f.source,
        reflected: f.reflected,
        timestamp: new Date().toISOString(),
      })));
    }

    Logger.info(`[${this.name}] Stored ${findings.length} parameter findings`);
  }

  private async triggerHandoff(job: any, targetAgent: string, context: any): Promise<void> {
    Logger.info(`[${this.name}] Triggering handoff to ${targetAgent}`);

    if (job.handoff) {
      await job.handoff(targetAgent, {
        sourceAgent: this.name,
        reason: context.reason,
        findings: context.findings,
        timestamp: new Date().toISOString(),
      });
    }
  }
}

export default ParameterDiscoveryAgent;
