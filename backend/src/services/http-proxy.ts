/**
 * HTTP Proxy Service - Phase 2.4: Enhanced Tool Suite
 *
 * Provides HTTP request interception and modification capabilities for testing:
 * - Authentication bypass (modify/remove auth headers)
 * - Header injection (X-Forwarded-For, custom headers)
 * - Request replay and modification
 * - Response interception and analysis
 *
 * Use cases:
 * - Test if removing Authorization header bypasses auth
 * - Test IP-based restrictions with X-Forwarded-For
 * - Replay and modify authenticated requests
 * - Capture and analyze authentication flows
 */

import httpProxy from 'http-proxy';
import http from 'http';
import { EventEmitter } from 'events';
import logger from '../utils/logger';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

export interface ProxyConfig {
  port: number;
  target?: string;
  interceptRequests?: boolean;
  interceptResponses?: boolean;
  timeout?: number;
}

export interface InterceptedRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string | string[]>;
  body?: any;
  timestamp: Date;
}

export interface InterceptedResponse {
  id: string;
  statusCode: number;
  headers: Record<string, string | string[]>;
  body?: any;
  timestamp: Date;
}

export interface RequestModification {
  addHeaders?: Record<string, string>;
  removeHeaders?: string[];
  replaceHeaders?: Record<string, string>;
  modifyUrl?: string;
  modifyMethod?: string;
  modifyBody?: any;
}

/**
 * HTTPProxyService - Intercept and modify HTTP traffic
 */
export class HTTPProxyService extends EventEmitter {
  private proxy: httpProxy | null = null;
  private server: http.Server | null = null;
  private config: ProxyConfig;
  private interceptedRequests: Map<string, InterceptedRequest> = new Map();
  private interceptedResponses: Map<string, InterceptedResponse> = new Map();
  private requestModifications: Map<string, RequestModification> = new Map();
  private tracer = trace.getTracer('agenthunt-http-proxy');
  private isRunning = false;

  constructor(config: ProxyConfig) {
    super();
    this.config = {
      timeout: 30000,
      interceptRequests: true,
      interceptResponses: true,
      ...config,
    };
  }

  /**
   * Start the proxy server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Proxy server is already running');
    }

    const span = this.tracer.startSpan('proxy.start', {
      attributes: {
        'proxy.port': this.config.port,
        'proxy.target': this.config.target || 'dynamic',
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        this.proxy = httpProxy.createProxyServer({
          changeOrigin: true,
          timeout: this.config.timeout,
          proxyTimeout: this.config.timeout,
        });

        // Handle proxy errors
        this.proxy.on('error', (err, req, res) => {
          logger.error({ error: err, url: req.url }, 'Proxy error');
          if ('headersSent' in res && 'writeHead' in res) {
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
            }
            res.end('Bad Gateway: ' + err.message);
          }
        });

        // Create HTTP server
        this.server = http.createServer((req, res) => {
          this.handleRequest(req, res);
        });

        await new Promise<void>((resolve, reject) => {
          this.server!.listen(this.config.port, () => {
            this.isRunning = true;
            logger.info({ port: this.config.port }, 'HTTP Proxy server started');
            resolve();
          });
          this.server!.on('error', reject);
        });

        span.setStatus({ code: SpanStatusCode.OK });
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Stop the proxy server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    return new Promise<void>((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.isRunning = false;
          this.proxy = null;
          this.server = null;
          logger.info('HTTP Proxy server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Handle incoming request
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    const requestId = this.generateRequestId();
    const targetUrl = this.config.target || req.url;

    // Intercept request
    if (this.config.interceptRequests) {
      const intercepted: InterceptedRequest = {
        id: requestId,
        method: req.method || 'GET',
        url: req.url || '/',
        headers: req.headers as Record<string, string | string[]>,
        timestamp: new Date(),
      };

      // Capture request body for POST/PUT/PATCH
      if (['POST', 'PUT', 'PATCH'].includes(req.method || '')) {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk.toString();
        });
        req.on('end', () => {
          try {
            intercepted.body = JSON.parse(body);
          } catch {
            intercepted.body = body;
          }
        });
      }

      this.interceptedRequests.set(requestId, intercepted);
      this.emit('request', intercepted);
    }

    // Apply modifications if any
    const modifications = this.requestModifications.get(requestId);
    if (modifications) {
      this.applyRequestModifications(req, modifications);
    }

    // Proxy the request
    if (!targetUrl || !this.proxy) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request: No target URL specified');
      return;
    }

    // Intercept response
    if (this.config.interceptResponses) {
      const originalWrite = res.write.bind(res);
      const originalEnd = res.end.bind(res);
      let responseBody = '';

      res.write = function (chunk: any, ...args: any[]): boolean {
        if (chunk) {
          responseBody += chunk.toString();
        }
        return originalWrite(chunk, ...args);
      };

      res.end = function (chunk: any, ...args: any[]): any {
        if (chunk) {
          responseBody += chunk.toString();
        }

        const intercepted: InterceptedResponse = {
          id: requestId,
          statusCode: res.statusCode,
          headers: res.getHeaders() as Record<string, string | string[]>,
          timestamp: new Date(),
        };

        try {
          intercepted.body = JSON.parse(responseBody);
        } catch {
          intercepted.body = responseBody;
        }

        this.interceptedResponses.set(requestId, intercepted);
        this.emit('response', intercepted);

        return originalEnd(chunk, ...args);
      }.bind(this);
    }

    this.proxy.web(req, res, { target: targetUrl });
  }

  /**
   * Apply request modifications
   */
  private applyRequestModifications(req: http.IncomingMessage, mods: RequestModification): void {
    // Add headers
    if (mods.addHeaders) {
      Object.entries(mods.addHeaders).forEach(([key, value]) => {
        req.headers[key.toLowerCase()] = value;
      });
    }

    // Remove headers
    if (mods.removeHeaders) {
      mods.removeHeaders.forEach((header) => {
        delete req.headers[header.toLowerCase()];
      });
    }

    // Replace headers
    if (mods.replaceHeaders) {
      Object.entries(mods.replaceHeaders).forEach(([key, value]) => {
        req.headers[key.toLowerCase()] = value;
      });
    }

    // Modify URL
    if (mods.modifyUrl) {
      req.url = mods.modifyUrl;
    }

    // Modify method
    if (mods.modifyMethod) {
      req.method = mods.modifyMethod;
    }

    logger.debug({ requestId: req.url, modifications: mods }, 'Applied request modifications');
  }

  /**
   * Set modifications for next request matching URL pattern
   */
  setRequestModification(urlPattern: string, modifications: RequestModification): void {
    this.requestModifications.set(urlPattern, modifications);
    logger.info({ urlPattern, modifications }, 'Request modification registered');
  }

  /**
   * Clear all request modifications
   */
  clearModifications(): void {
    this.requestModifications.clear();
  }

  /**
   * Get intercepted requests
   */
  getInterceptedRequests(filter?: { method?: string; urlContains?: string }): InterceptedRequest[] {
    let requests = Array.from(this.interceptedRequests.values());

    if (filter) {
      if (filter.method) {
        requests = requests.filter((r) => r.method === filter.method);
      }
      if (filter.urlContains) {
        requests = requests.filter((r) => r.url.includes(filter.urlContains));
      }
    }

    return requests.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get intercepted responses
   */
  getInterceptedResponses(filter?: { statusCode?: number }): InterceptedResponse[] {
    let responses = Array.from(this.interceptedResponses.values());

    if (filter?.statusCode) {
      responses = responses.filter((r) => r.statusCode === filter.statusCode);
    }

    return responses.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Clear intercepted traffic history
   */
  clearHistory(): void {
    this.interceptedRequests.clear();
    this.interceptedResponses.clear();
    logger.debug('Cleared proxy history');
  }

  /**
   * Test authentication bypass by removing auth headers
   */
  async testAuthBypass(
    targetUrl: string,
    authHeaders: string[] = ['authorization', 'cookie']
  ): Promise<{
    vulnerable: boolean;
    details: any;
  }> {
    const span = this.tracer.startSpan('proxy.test_auth_bypass', {
      attributes: {
        'test.url': targetUrl,
        'test.headers_removed': authHeaders.join(','),
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      try {
        // Set modification to remove auth headers
        this.setRequestModification(targetUrl, {
          removeHeaders: authHeaders,
        });

        // Make request through proxy
        const response = await this.makeProxiedRequest(targetUrl);

        // Check if request succeeded without auth
        const vulnerable = response.statusCode === 200 && !response.body?.error;

        span.setAttributes({
          'test.vulnerable': vulnerable,
          'test.status_code': response.statusCode,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return {
          vulnerable,
          details: {
            statusCode: response.statusCode,
            headers: response.headers,
            authHeadersRemoved: authHeaders,
          },
        };
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Test header injection (e.g., X-Forwarded-For)
   */
  async testHeaderInjection(
    targetUrl: string,
    headers: Record<string, string>
  ): Promise<{
    successful: boolean;
    details: any;
  }> {
    try {
      this.setRequestModification(targetUrl, {
        addHeaders: headers,
      });

      const response = await this.makeProxiedRequest(targetUrl);

      return {
        successful: response.statusCode < 400,
        details: {
          statusCode: response.statusCode,
          injectedHeaders: headers,
          response: response.body,
        },
      };
    } catch (error: any) {
      logger.error({ error, targetUrl }, 'Header injection test failed');
      return {
        successful: false,
        details: { error: error.message },
      };
    }
  }

  /**
   * Make a proxied request (for testing)
   */
  private async makeProxiedRequest(url: string): Promise<InterceptedResponse> {
    return new Promise((resolve, reject) => {
      const requestId = this.generateRequestId();

      // Listen for response
      const responseHandler = (response: InterceptedResponse) => {
        if (response.id === requestId) {
          this.removeListener('response', responseHandler);
          resolve(response);
        }
      };

      this.on('response', responseHandler);

      // Make request
      const proxyUrl = `http://localhost:${this.config.port}${url}`;
      http
        .get(proxyUrl, (res) => {
          // Response will be captured by interceptor
        })
        .on('error', (error) => {
          this.removeListener('response', responseHandler);
          reject(error);
        });

      // Timeout
      setTimeout(() => {
        this.removeListener('response', responseHandler);
        reject(new Error('Proxy request timeout'));
      }, this.config.timeout || 30000);
    });
  }

  /**
   * Generate unique request ID
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Get proxy statistics
   */
  getStats(): {
    isRunning: boolean;
    port: number;
    requestsIntercepted: number;
    responsesIntercepted: number;
    modificationsActive: number;
  } {
    return {
      isRunning: this.isRunning,
      port: this.config.port,
      requestsIntercepted: this.interceptedRequests.size,
      responsesIntercepted: this.interceptedResponses.size,
      modificationsActive: this.requestModifications.size,
    };
  }
}

/**
 * Create a new HTTP Proxy instance
 */
export function createProxy(config: ProxyConfig): HTTPProxyService {
  return new HTTPProxyService(config);
}

export default HTTPProxyService;
