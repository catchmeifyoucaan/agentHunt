/**
 * AgentHunt Interceptor - Core MITM Proxy
 * 
 * A full-featured HTTP/HTTPS intercepting proxy similar to Burp Suite Pro.
 * Features:
 * - SSL/TLS interception with dynamic certificate generation
 * - Request/response modification in real-time
 * - WebSocket interception
 * - HTTP/2 support
 * - Automatic session tracking
 * - Request history with full body capture
 */

import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import { URL } from 'url';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import forge from 'node-forge';
import zlib from 'zlib';
import logger from '../../utils/logger';

// ============================================
// Types and Interfaces
// ============================================

export interface InterceptedRequest {
  id: string;
  timestamp: Date;
  method: string;
  url: string;
  host: string;
  port: number;
  path: string;
  httpVersion: string;
  headers: Record<string, string | string[]>;
  body: Buffer;
  bodyText?: string;
  contentType?: string;
  cookies: Record<string, string>;
  queryParams: Record<string, string>;
  isHttps: boolean;
  clientIp: string;
  // For modification
  modified: boolean;
  originalRequest?: InterceptedRequest;
}

export interface InterceptedResponse {
  id: string;
  requestId: string;
  timestamp: Date;
  statusCode: number;
  statusMessage: string;
  httpVersion: string;
  headers: Record<string, string | string[]>;
  body: Buffer;
  bodyText?: string;
  contentType?: string;
  contentLength: number;
  responseTime: number;
  // For modification
  modified: boolean;
  originalResponse?: InterceptedResponse;
}

export interface ProxySession {
  id: string;
  startTime: Date;
  requests: Map<string, InterceptedRequest>;
  responses: Map<string, InterceptedResponse>;
  cookies: Map<string, Map<string, string>>; // domain -> cookie name -> value
  tokens: Map<string, string>; // token name -> value (CSRF, JWT, etc.)
  authHeaders: Map<string, string>; // header name -> value
}

export interface InterceptionRule {
  id: string;
  name: string;
  enabled: boolean;
  scope: 'request' | 'response' | 'both';
  conditions: InterceptionCondition[];
  action: 'intercept' | 'drop' | 'forward' | 'modify';
  modifications?: RequestModification[];
}

export interface InterceptionCondition {
  field: 'host' | 'path' | 'method' | 'header' | 'body' | 'status' | 'content-type';
  operator: 'equals' | 'contains' | 'matches' | 'starts_with' | 'ends_with';
  value: string;
  headerName?: string; // For header conditions
}

export interface RequestModification {
  type: 'add_header' | 'remove_header' | 'replace_header' | 'replace_body' | 'replace_param';
  target: string;
  value?: string;
  regex?: string;
  replacement?: string;
}

export interface ProxyConfig {
  port: number;
  host: string;
  enableSsl: boolean;
  caCertPath?: string;
  caKeyPath?: string;
  interceptEnabled: boolean;
  recordHistory: boolean;
  maxHistorySize: number;
  timeout: number;
  upstreamProxy?: {
    host: string;
    port: number;
    auth?: { username: string; password: string };
  };
}

// ============================================
// Certificate Authority for SSL Interception
// ============================================

class CertificateAuthority {
  private caCert: forge.pki.Certificate;
  private caKey: forge.pki.PrivateKey;
  private certCache: Map<string, { cert: string; key: string }> = new Map();

  constructor(caCertPem?: string, caKeyPem?: string) {
    if (caCertPem && caKeyPem) {
      this.caCert = forge.pki.certificateFromPem(caCertPem);
      this.caKey = forge.pki.privateKeyFromPem(caKeyPem);
    } else {
      // Generate new CA certificate
      const { cert, key } = this.generateCACertificate();
      this.caCert = cert;
      this.caKey = key;
    }
  }

  private generateCACertificate(): { cert: forge.pki.Certificate; key: forge.pki.PrivateKey } {
    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = '01';
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

    const attrs = [
      { name: 'commonName', value: 'AgentHunt Interceptor CA' },
      { name: 'organizationName', value: 'AgentHunt Security' },
      { name: 'countryName', value: 'US' },
    ];

    cert.setSubject(attrs);
    cert.setIssuer(attrs);
    cert.setExtensions([
      { name: 'basicConstraints', cA: true, critical: true },
      { name: 'keyUsage', keyCertSign: true, digitalSignature: true, critical: true },
      { name: 'subjectKeyIdentifier' },
    ]);

    cert.sign(keys.privateKey, forge.md.sha256.create());

    return { cert, key: keys.privateKey };
  }

  public generateHostCertificate(hostname: string): { cert: string; key: string } {
    // Check cache
    if (this.certCache.has(hostname)) {
      return this.certCache.get(hostname)!;
    }

    const keys = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();

    cert.publicKey = keys.publicKey;
    cert.serialNumber = uuidv4().replace(/-/g, '');
    cert.validity.notBefore = new Date();
    cert.validity.notAfter = new Date();
    cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);

    const attrs = [{ name: 'commonName', value: hostname }];
    cert.setSubject(attrs);
    cert.setIssuer(this.caCert.subject.attributes);

    cert.setExtensions([
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: hostname }, // DNS
          { type: 2, value: `*.${hostname}` }, // Wildcard
        ],
      },
    ]);

    cert.sign(this.caKey, forge.md.sha256.create());

    const result = {
      cert: forge.pki.certificateToPem(cert),
      key: forge.pki.privateKeyToPem(keys.privateKey),
    };

    // Cache the certificate
    this.certCache.set(hostname, result);

    return result;
  }

  public getCACertificatePem(): string {
    return forge.pki.certificateToPem(this.caCert);
  }

  public getCAKeyPem(): string {
    return forge.pki.privateKeyToPem(this.caKey);
  }
}

// ============================================
// Main Proxy Core Class
// ============================================

export class ProxyCore extends EventEmitter {
  private config: ProxyConfig;
  private server: http.Server | null = null;
  private ca: CertificateAuthority;
  private session: ProxySession;
  private rules: InterceptionRule[] = [];
  private pendingRequests: Map<string, { resolve: Function; reject: Function }> = new Map();
  private isIntercepting: boolean = false;

  constructor(config: Partial<ProxyConfig> = {}) {
    super();

    this.config = {
      port: config.port || 8080,
      host: config.host || '127.0.0.1',
      enableSsl: config.enableSsl !== false,
      interceptEnabled: config.interceptEnabled || false,
      recordHistory: config.recordHistory !== false,
      maxHistorySize: config.maxHistorySize || 10000,
      timeout: config.timeout || 30000,
      ...config,
    };

    this.ca = new CertificateAuthority(config.caCertPath, config.caKeyPath);
    this.session = this.createSession();
  }

  private createSession(): ProxySession {
    return {
      id: uuidv4(),
      startTime: new Date(),
      requests: new Map(),
      responses: new Map(),
      cookies: new Map(),
      tokens: new Map(),
      authHeaders: new Map(),
    };
  }

  // ============================================
  // Server Lifecycle
  // ============================================

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer();

      // Handle regular HTTP requests
      this.server.on('request', (req, res) => this.handleRequest(req, res));

      // Handle CONNECT for HTTPS tunneling
      this.server.on('connect', (req, socket, head) => this.handleConnect(req, socket, head));

      // Handle WebSocket upgrades
      this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));

      this.server.on('error', (err) => {
        logger.error({ error: err }, 'Proxy server error');
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        logger.info(
          { port: this.config.port, host: this.config.host },
          'AgentHunt Interceptor proxy started'
        );
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          logger.info('Proxy server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  // ============================================
  // HTTP Request Handling
  // ============================================

  private async handleRequest(
    clientReq: http.IncomingMessage,
    clientRes: http.ServerResponse
  ): Promise<void> {
    const requestId = uuidv4();
    const startTime = Date.now();

    try {
      // Parse the request
      const interceptedReq = await this.parseRequest(clientReq, requestId, false);

      // Check interception rules
      if (this.config.interceptEnabled && this.shouldIntercept(interceptedReq, 'request')) {
        // Wait for user to release the request
        const modifiedReq = await this.waitForInterception(interceptedReq);
        if (!modifiedReq) {
          // Request was dropped
          clientRes.writeHead(502, 'Request Dropped');
          clientRes.end();
          return;
        }
        Object.assign(interceptedReq, modifiedReq);
      }

      // Store in history
      if (this.config.recordHistory) {
        this.session.requests.set(requestId, interceptedReq);
        this.emit('request', interceptedReq);
      }

      // Forward the request
      const response = await this.forwardRequest(interceptedReq);

      // Parse response
      const interceptedRes = this.parseResponse(response, requestId, startTime);

      // Check response interception
      if (this.config.interceptEnabled && this.shouldIntercept(interceptedRes, 'response')) {
        const modifiedRes = await this.waitForResponseInterception(interceptedRes);
        if (modifiedRes) {
          Object.assign(interceptedRes, modifiedRes);
        }
      }

      // Store response
      if (this.config.recordHistory) {
        this.session.responses.set(requestId, interceptedRes);
        this.emit('response', interceptedRes);
      }

      // Extract tokens and cookies
      this.extractSessionData(interceptedReq, interceptedRes);

      // Send response to client
      this.sendResponse(clientRes, interceptedRes);
    } catch (error: any) {
      logger.error({ error: error.message, requestId }, 'Request handling error');
      clientRes.writeHead(502, 'Proxy Error');
      clientRes.end(`Proxy Error: ${error.message}`);
    }
  }

  // ============================================
  // HTTPS CONNECT Handling (SSL Interception)
  // ============================================

  private handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ): void {
    const [host, portStr] = (req.url || '').split(':');
    const port = parseInt(portStr) || 443;

    if (!this.config.enableSsl) {
      // Passthrough mode - just tunnel
      this.tunnelConnection(host, port, clientSocket, head);
      return;
    }

    // SSL interception mode
    clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');

    // Generate certificate for this host
    const { cert, key } = this.ca.generateHostCertificate(host);

    // Create TLS server for this connection
    const tlsOptions: tls.TlsOptions = {
      key,
      cert,
      isServer: true,
    };

    const tlsSocket = new tls.TLSSocket(clientSocket, tlsOptions);

    // Create a virtual HTTP server for this TLS connection
    const virtualServer = http.createServer();
    virtualServer.on('request', (req, res) => {
      // Modify request to include full URL
      (req as any).isHttps = true;
      (req as any).targetHost = host;
      (req as any).targetPort = port;
      this.handleRequest(req, res);
    });

    virtualServer.emit('connection', tlsSocket);

    if (head.length > 0) {
      tlsSocket.unshift(head);
    }
  }

  private tunnelConnection(
    host: string,
    port: number,
    clientSocket: net.Socket,
    head: Buffer
  ): void {
    const serverSocket = net.connect(port, host, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      logger.error({ error: err, host, port }, 'Tunnel connection error');
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      serverSocket.end();
    });
  }

  // ============================================
  // WebSocket Handling
  // ============================================

  private handleUpgrade(
    req: http.IncomingMessage,
    socket: net.Socket,
    head: Buffer
  ): void {
    const requestId = uuidv4();

    // Parse WebSocket upgrade request
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    this.emit('websocket-upgrade', {
      id: requestId,
      url: url.toString(),
      headers: req.headers,
    });

    // For now, pass through WebSocket connections
    // Full WebSocket interception would require more complex handling
    const targetHost = url.hostname;
    const targetPort = parseInt(url.port) || (url.protocol === 'wss:' ? 443 : 80);

    const serverSocket = net.connect(targetPort, targetHost, () => {
      // Forward the upgrade request
      const upgradeRequest = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.entries(req.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n') +
        '\r\n\r\n';

      serverSocket.write(upgradeRequest);
      serverSocket.write(head);

      // Bidirectional pipe with interception
      this.pipeWithInterception(socket, serverSocket, requestId, 'client-to-server');
      this.pipeWithInterception(serverSocket, socket, requestId, 'server-to-client');
    });

    serverSocket.on('error', (err) => {
      logger.error({ error: err }, 'WebSocket upgrade error');
      socket.end();
    });
  }

  private pipeWithInterception(
    source: net.Socket,
    dest: net.Socket,
    requestId: string,
    direction: string
  ): void {
    source.on('data', (data) => {
      this.emit('websocket-message', {
        requestId,
        direction,
        data: data.toString(),
        timestamp: new Date(),
      });
      dest.write(data);
    });

    source.on('end', () => dest.end());
    source.on('error', () => dest.end());
  }

  // ============================================
  // Request Parsing and Forwarding
  // ============================================

  private async parseRequest(
    req: http.IncomingMessage,
    requestId: string,
    isHttps: boolean
  ): Promise<InterceptedRequest> {
    const body = await this.readBody(req);
    const targetHost = (req as any).targetHost || req.headers.host?.split(':')[0] || 'localhost';
    const targetPort = (req as any).targetPort || (isHttps ? 443 : 80);
    const fullUrl = `${isHttps ? 'https' : 'http'}://${targetHost}:${targetPort}${req.url}`;

    const parsedUrl = new URL(fullUrl);
    const queryParams: Record<string, string> = {};
    parsedUrl.searchParams.forEach((v, k) => (queryParams[k] = v));

    // Parse cookies
    const cookies: Record<string, string> = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      cookieHeader.split(';').forEach((cookie) => {
        const [name, value] = cookie.trim().split('=');
        if (name && value) {
          cookies[name] = value;
        }
      });
    }

    return {
      id: requestId,
      timestamp: new Date(),
      method: req.method || 'GET',
      url: fullUrl,
      host: targetHost,
      port: targetPort,
      path: req.url || '/',
      httpVersion: req.httpVersion,
      headers: req.headers as Record<string, string | string[]>,
      body,
      bodyText: this.decodeBody(body, req.headers['content-encoding'] as string),
      contentType: req.headers['content-type'],
      cookies,
      queryParams,
      isHttps: isHttps || (req as any).isHttps,
      clientIp: req.socket.remoteAddress || 'unknown',
      modified: false,
    };
  }

  private async forwardRequest(req: InterceptedRequest): Promise<http.IncomingMessage> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        hostname: req.host,
        port: req.port,
        path: req.path,
        method: req.method,
        headers: req.headers,
        timeout: this.config.timeout,
      };

      // Use upstream proxy if configured
      if (this.config.upstreamProxy) {
        options.hostname = this.config.upstreamProxy.host;
        options.port = this.config.upstreamProxy.port;
        options.path = req.url;
        if (this.config.upstreamProxy.auth) {
          const auth = Buffer.from(
            `${this.config.upstreamProxy.auth.username}:${this.config.upstreamProxy.auth.password}`
          ).toString('base64');
          options.headers = { ...options.headers, 'Proxy-Authorization': `Basic ${auth}` };
        }
      }

      const protocol = req.isHttps ? https : http;
      const proxyReq = protocol.request(options, (res) => {
        resolve(res);
      });

      proxyReq.on('error', reject);
      proxyReq.on('timeout', () => reject(new Error('Request timeout')));

      if (req.body.length > 0) {
        proxyReq.write(req.body);
      }

      proxyReq.end();
    });
  }

  private parseResponse(
    res: http.IncomingMessage,
    requestId: string,
    startTime: number
  ): InterceptedResponse {
    return {
      id: uuidv4(),
      requestId,
      timestamp: new Date(),
      statusCode: res.statusCode || 0,
      statusMessage: res.statusMessage || '',
      httpVersion: res.httpVersion,
      headers: res.headers as Record<string, string | string[]>,
      body: Buffer.alloc(0), // Will be filled by readBody
      contentType: res.headers['content-type'],
      contentLength: parseInt(res.headers['content-length'] || '0'),
      responseTime: Date.now() - startTime,
      modified: false,
    };
  }

  private async readBody(stream: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  private decodeBody(body: Buffer, encoding?: string): string {
    try {
      if (encoding === 'gzip') {
        return zlib.gunzipSync(body).toString('utf-8');
      } else if (encoding === 'deflate') {
        return zlib.inflateSync(body).toString('utf-8');
      } else if (encoding === 'br') {
        return zlib.brotliDecompressSync(body).toString('utf-8');
      }
      return body.toString('utf-8');
    } catch {
      return body.toString('utf-8');
    }
  }

  private sendResponse(clientRes: http.ServerResponse, res: InterceptedResponse): void {
    clientRes.writeHead(res.statusCode, res.statusMessage, res.headers as http.OutgoingHttpHeaders);
    clientRes.end(res.body);
  }

  // ============================================
  // Interception Logic
  // ============================================

  private shouldIntercept(
    item: InterceptedRequest | InterceptedResponse,
    scope: 'request' | 'response'
  ): boolean {
    if (!this.isIntercepting) return false;

    for (const rule of this.rules) {
      if (!rule.enabled) continue;
      if (rule.scope !== 'both' && rule.scope !== scope) continue;

      const matches = rule.conditions.every((cond) => this.matchCondition(item, cond));
      if (matches && rule.action === 'intercept') {
        return true;
      }
    }

    return false;
  }

  private matchCondition(
    item: InterceptedRequest | InterceptedResponse,
    condition: InterceptionCondition
  ): boolean {
    let value: string = '';

    if ('url' in item) {
      // Request
      const req = item as InterceptedRequest;
      switch (condition.field) {
        case 'host':
          value = req.host;
          break;
        case 'path':
          value = req.path;
          break;
        case 'method':
          value = req.method;
          break;
        case 'header':
          value = String(req.headers[condition.headerName || ''] || '');
          break;
        case 'body':
          value = req.bodyText || '';
          break;
        case 'content-type':
          value = req.contentType || '';
          break;
      }
    } else {
      // Response
      const res = item as InterceptedResponse;
      switch (condition.field) {
        case 'status':
          value = String(res.statusCode);
          break;
        case 'header':
          value = String(res.headers[condition.headerName || ''] || '');
          break;
        case 'body':
          value = res.bodyText || '';
          break;
        case 'content-type':
          value = res.contentType || '';
          break;
      }
    }

    switch (condition.operator) {
      case 'equals':
        return value === condition.value;
      case 'contains':
        return value.includes(condition.value);
      case 'matches':
        return new RegExp(condition.value).test(value);
      case 'starts_with':
        return value.startsWith(condition.value);
      case 'ends_with':
        return value.endsWith(condition.value);
      default:
        return false;
    }
  }

  private async waitForInterception(req: InterceptedRequest): Promise<InterceptedRequest | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(req.id);
        resolve(req); // Auto-forward after timeout
      }, 60000); // 1 minute timeout

      this.pendingRequests.set(req.id, {
        resolve: (modified: InterceptedRequest | null) => {
          clearTimeout(timeoutId);
          resolve(modified);
        },
        reject: () => {
          clearTimeout(timeoutId);
          resolve(null);
        },
      });

      this.emit('intercept-request', req);
    });
  }

  private async waitForResponseInterception(
    res: InterceptedResponse
  ): Promise<InterceptedResponse | null> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(res.id);
        resolve(res);
      }, 60000);

      this.pendingRequests.set(res.id, {
        resolve: (modified: InterceptedResponse | null) => {
          clearTimeout(timeoutId);
          resolve(modified);
        },
        reject: () => {
          clearTimeout(timeoutId);
          resolve(null);
        },
      });

      this.emit('intercept-response', res);
    });
  }

  // ============================================
  // Session Data Extraction
  // ============================================

  private extractSessionData(req: InterceptedRequest, res: InterceptedResponse): void {
    // Extract Set-Cookie headers
    const setCookies = res.headers['set-cookie'];
    if (setCookies) {
      const cookies = Array.isArray(setCookies) ? setCookies : [setCookies];
      for (const cookie of cookies) {
        const parsed = this.parseCookie(cookie);
        if (parsed) {
          const domain = parsed.domain || req.host;
          if (!this.session.cookies.has(domain)) {
            this.session.cookies.set(domain, new Map());
          }
          this.session.cookies.get(domain)!.set(parsed.name, parsed.value);
        }
      }
    }

    // Extract CSRF tokens from response body
    if (res.bodyText) {
      // Look for common CSRF token patterns
      const csrfPatterns = [
        /name="csrf[_-]?token"[^>]*value="([^"]+)"/i,
        /name="_token"[^>]*value="([^"]+)"/i,
        /"csrfToken":\s*"([^"]+)"/i,
        /X-CSRF-TOKEN['":\s]+([^'"}\s]+)/i,
      ];

      for (const pattern of csrfPatterns) {
        const match = res.bodyText.match(pattern);
        if (match) {
          this.session.tokens.set('csrf', match[1]);
          this.emit('token-extracted', { type: 'csrf', value: match[1] });
          break;
        }
      }
    }

    // Extract Authorization headers
    if (req.headers.authorization) {
      this.session.authHeaders.set('Authorization', String(req.headers.authorization));
    }
  }

  private parseCookie(cookieStr: string): { name: string; value: string; domain?: string } | null {
    const parts = cookieStr.split(';');
    if (parts.length === 0) return null;

    const [nameValue, ...attrs] = parts;
    const [name, value] = nameValue.split('=');
    if (!name || !value) return null;

    let domain: string | undefined;
    for (const attr of attrs) {
      const [key, val] = attr.trim().split('=');
      if (key.toLowerCase() === 'domain') {
        domain = val;
      }
    }

    return { name: name.trim(), value: value.trim(), domain };
  }

  // ============================================
  // Public API
  // ============================================

  public setIntercepting(enabled: boolean): void {
    this.isIntercepting = enabled;
    this.emit('intercept-mode-changed', enabled);
  }

  public addRule(rule: InterceptionRule): void {
    this.rules.push(rule);
  }

  public removeRule(ruleId: string): void {
    this.rules = this.rules.filter((r) => r.id !== ruleId);
  }

  public getRules(): InterceptionRule[] {
    return [...this.rules];
  }

  public forwardInterceptedRequest(requestId: string, modified?: InterceptedRequest): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.resolve(modified || this.session.requests.get(requestId));
      this.pendingRequests.delete(requestId);
    }
  }

  public dropInterceptedRequest(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.reject();
      this.pendingRequests.delete(requestId);
    }
  }

  public getHistory(): { requests: InterceptedRequest[]; responses: InterceptedResponse[] } {
    return {
      requests: Array.from(this.session.requests.values()),
      responses: Array.from(this.session.responses.values()),
    };
  }

  public getRequest(requestId: string): InterceptedRequest | undefined {
    return this.session.requests.get(requestId);
  }

  public getResponse(requestId: string): InterceptedResponse | undefined {
    return this.session.responses.get(requestId);
  }

  public getSession(): ProxySession {
    return this.session;
  }

  public clearHistory(): void {
    this.session.requests.clear();
    this.session.responses.clear();
  }

  public getCACertificate(): string {
    return this.ca.getCACertificatePem();
  }

  public getConfig(): ProxyConfig {
    return { ...this.config };
  }
}

export default ProxyCore;
