/**
 * AgentHunt Turbo Intruder
 * 
 * High-performance HTTP request engine for:
 * - Race condition testing (single-packet attack)
 * - Mass parallel requests
 * - Timing-based attacks
 * - Parameter fuzzing at scale
 * - Last-byte sync for precise timing
 */

import http from 'http';
import https from 'https';
import http2 from 'http2';
import net from 'net';
import tls from 'tls';
import { URL } from 'url';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger';

// ============================================
// Types and Interfaces
// ============================================

export interface TurboRequest {
  id: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string | Buffer;
  // Payload markers for fuzzing
  payloadPositions?: PayloadPosition[];
}

export interface PayloadPosition {
  type: 'header' | 'body' | 'path' | 'query';
  name?: string; // Header name or param name
  start: number;
  end: number;
  marker: string; // e.g., §payload§
}

export interface TurboResponse {
  requestId: string;
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  bodyText: string;
  responseTime: number;
  connectionTime: number;
  ttfb: number; // Time to first byte
  error?: string;
  timestamp: Date;
}

export interface AttackConfig {
  type: 'race' | 'parallel' | 'sequential' | 'pitchfork' | 'clusterbomb';
  concurrency: number;
  requestsPerBatch: number;
  delayBetweenBatches: number;
  timeout: number;
  followRedirects: boolean;
  // Race condition specific
  useSinglePacket: boolean;
  useLastByteSync: boolean;
  useHttp2: boolean;
  // Connection settings
  keepAlive: boolean;
  maxSockets: number;
}

export interface AttackResult {
  id: string;
  config: AttackConfig;
  startTime: Date;
  endTime: Date;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  responses: TurboResponse[];
  statistics: AttackStatistics;
}

export interface AttackStatistics {
  minResponseTime: number;
  maxResponseTime: number;
  avgResponseTime: number;
  medianResponseTime: number;
  p95ResponseTime: number;
  p99ResponseTime: number;
  requestsPerSecond: number;
  statusCodeDistribution: Record<number, number>;
  uniqueResponses: number;
  potentialRaceConditions: RaceConditionIndicator[];
}

export interface RaceConditionIndicator {
  type: 'status_variation' | 'body_variation' | 'timing_anomaly' | 'duplicate_success';
  description: string;
  affectedRequests: string[];
  confidence: number;
}

export interface PayloadSet {
  name: string;
  type: 'list' | 'range' | 'bruteforce' | 'null';
  values?: string[];
  start?: number;
  end?: number;
  step?: number;
  charset?: string;
  minLength?: number;
  maxLength?: number;
}

// ============================================
// Single Packet Attack Engine
// ============================================

class SinglePacketEngine {
  /**
   * Send multiple HTTP requests in a single TCP packet
   * This is the key technique for race condition exploitation
   */
  public async sendSinglePacket(
    host: string,
    port: number,
    requests: string[],
    useTls: boolean = true
  ): Promise<{ responses: string[]; timing: number[] }> {
    return new Promise((resolve, reject) => {
      const responses: string[] = [];
      const timing: number[] = [];
      const startTime = Date.now();

      // Combine all requests into a single buffer
      const combinedRequest = requests.join('');
      const requestBuffer = Buffer.from(combinedRequest);

      const onConnect = (socket: net.Socket | tls.TLSSocket) => {
        const connectTime = Date.now() - startTime;
        logger.debug({ host, port, connectTime }, 'Single packet connection established');

        // Send all requests at once
        socket.write(requestBuffer);

        let responseBuffer = Buffer.alloc(0);
        let responseCount = 0;

        socket.on('data', (data) => {
          const receiveTime = Date.now() - startTime;
          timing.push(receiveTime);
          responseBuffer = Buffer.concat([responseBuffer, data]);

          // Try to parse complete responses
          const parsed = this.parseResponses(responseBuffer.toString());
          while (parsed.length > responseCount) {
            responses.push(parsed[responseCount]);
            responseCount++;
          }

          if (responseCount >= requests.length) {
            socket.end();
          }
        });

        socket.on('end', () => {
          resolve({ responses, timing });
        });

        socket.on('error', (err) => {
          reject(err);
        });
      };

      if (useTls) {
        const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
          onConnect(socket);
        });
      } else {
        const socket = net.connect({ host, port }, () => {
          onConnect(socket);
        });
      }
    });
  }

  /**
   * Last-byte synchronization attack
   * Sends all requests except the last byte, then sends all last bytes simultaneously
   */
  public async lastByteSync(
    host: string,
    port: number,
    requests: string[],
    useTls: boolean = true
  ): Promise<{ responses: string[]; timing: number[] }> {
    return new Promise((resolve, reject) => {
      const sockets: (net.Socket | tls.TLSSocket)[] = [];
      const responses: string[] = new Array(requests.length).fill('');
      const timing: number[] = new Array(requests.length).fill(0);
      let connectedCount = 0;
      let completedCount = 0;
      const startTime = Date.now();

      // Create connections and send all but last byte
      for (let i = 0; i < requests.length; i++) {
        const requestData = requests[i];
        const allButLast = requestData.slice(0, -1);
        const lastByte = requestData.slice(-1);

        const onConnect = (socket: net.Socket | tls.TLSSocket, index: number) => {
          sockets[index] = socket;

          // Send all but last byte
          socket.write(allButLast);

          connectedCount++;

          // When all connections are ready, send last bytes
          if (connectedCount === requests.length) {
            const syncTime = Date.now();

            // Send all last bytes as close together as possible
            for (let j = 0; j < sockets.length; j++) {
              sockets[j].write(requests[j].slice(-1));
            }

            logger.debug(
              { syncTime: syncTime - startTime, requestCount: requests.length },
              'Last byte sync executed'
            );
          }

          let responseBuffer = '';
          socket.on('data', (data) => {
            timing[index] = Date.now() - startTime;
            responseBuffer += data.toString();
          });

          socket.on('end', () => {
            responses[index] = responseBuffer;
            completedCount++;

            if (completedCount === requests.length) {
              resolve({ responses, timing });
            }
          });

          socket.on('error', (err) => {
            responses[index] = `Error: ${err.message}`;
            completedCount++;

            if (completedCount === requests.length) {
              resolve({ responses, timing });
            }
          });
        };

        if (useTls) {
          const socket = tls.connect({ host, port, rejectUnauthorized: false }, () => {
            onConnect(socket, i);
          });
        } else {
          const socket = net.connect({ host, port }, () => {
            onConnect(socket, i);
          });
        }
      }
    });
  }

  private parseResponses(data: string): string[] {
    const responses: string[] = [];
    const parts = data.split(/(?=HTTP\/)/);

    for (const part of parts) {
      if (part.startsWith('HTTP/')) {
        responses.push(part);
      }
    }

    return responses;
  }
}

// ============================================
// HTTP/2 Engine for Multiplexed Attacks
// ============================================

class Http2Engine {
  public async sendMultiplexed(
    url: string,
    requests: Array<{ method: string; path: string; headers: Record<string, string>; body?: string }>
  ): Promise<TurboResponse[]> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const responses: TurboResponse[] = [];
      const startTime = Date.now();

      const client = http2.connect(`${parsedUrl.protocol}//${parsedUrl.host}`, {
        rejectUnauthorized: false,
      });

      client.on('error', reject);

      let completedCount = 0;

      for (let i = 0; i < requests.length; i++) {
        const req = requests[i];
        const requestId = uuidv4();
        const requestStart = Date.now();

        const stream = client.request({
          ':method': req.method,
          ':path': req.path,
          ...req.headers,
        });

        let responseHeaders: Record<string, string | string[]> = {};
        let responseBody = Buffer.alloc(0);
        let statusCode = 0;
        let ttfb = 0;

        stream.on('response', (headers) => {
          ttfb = Date.now() - requestStart;
          statusCode = headers[':status'] as number;
          responseHeaders = headers as Record<string, string | string[]>;
        });

        stream.on('data', (chunk) => {
          responseBody = Buffer.concat([responseBody, chunk]);
        });

        stream.on('end', () => {
          responses.push({
            requestId,
            statusCode,
            headers: responseHeaders,
            body: responseBody,
            bodyText: responseBody.toString(),
            responseTime: Date.now() - requestStart,
            connectionTime: 0,
            ttfb,
            timestamp: new Date(),
          });

          completedCount++;
          if (completedCount === requests.length) {
            client.close();
            resolve(responses);
          }
        });

        stream.on('error', (err) => {
          responses.push({
            requestId,
            statusCode: 0,
            headers: {},
            body: Buffer.alloc(0),
            bodyText: '',
            responseTime: Date.now() - requestStart,
            connectionTime: 0,
            ttfb: 0,
            error: err.message,
            timestamp: new Date(),
          });

          completedCount++;
          if (completedCount === requests.length) {
            client.close();
            resolve(responses);
          }
        });

        if (req.body) {
          stream.write(req.body);
        }
        stream.end();
      }
    });
  }
}

// ============================================
// Main Turbo Intruder Class
// ============================================

export class TurboIntruder extends EventEmitter {
  private singlePacketEngine: SinglePacketEngine;
  private http2Engine: Http2Engine;
  private activeAttacks: Map<string, { cancel: () => void }> = new Map();

  constructor() {
    super();
    this.singlePacketEngine = new SinglePacketEngine();
    this.http2Engine = new Http2Engine();
  }

  // ============================================
  // Race Condition Attack
  // ============================================

  public async raceConditionAttack(
    baseRequest: TurboRequest,
    payloads: string[],
    config: Partial<AttackConfig> = {}
  ): Promise<AttackResult> {
    const attackId = uuidv4();
    const startTime = new Date();

    const fullConfig: AttackConfig = {
      type: 'race',
      concurrency: config.concurrency || payloads.length,
      requestsPerBatch: config.requestsPerBatch || payloads.length,
      delayBetweenBatches: config.delayBetweenBatches || 0,
      timeout: config.timeout || 10000,
      followRedirects: config.followRedirects || false,
      useSinglePacket: config.useSinglePacket !== false,
      useLastByteSync: config.useLastByteSync || false,
      useHttp2: config.useHttp2 || false,
      keepAlive: config.keepAlive !== false,
      maxSockets: config.maxSockets || 100,
    };

    logger.info(
      { attackId, payloadCount: payloads.length, config: fullConfig },
      'Starting race condition attack'
    );

    const responses: TurboResponse[] = [];
    const parsedUrl = new URL(baseRequest.url);
    const host = parsedUrl.hostname;
    const port = parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80);
    const useTls = parsedUrl.protocol === 'https:';

    // Build raw HTTP requests
    const rawRequests = payloads.map((payload, index) => {
      return this.buildRawRequest(baseRequest, payload, index);
    });

    try {
      let result: { responses: string[]; timing: number[] };

      if (fullConfig.useHttp2) {
        // Use HTTP/2 multiplexing
        const http2Requests = payloads.map((payload, index) => ({
          method: baseRequest.method,
          path: this.applyPayload(parsedUrl.pathname + parsedUrl.search, payload),
          headers: this.applyPayloadToHeaders(baseRequest.headers, payload),
          body: baseRequest.body ? this.applyPayload(baseRequest.body.toString(), payload) : undefined,
        }));

        const http2Responses = await this.http2Engine.sendMultiplexed(baseRequest.url, http2Requests);
        responses.push(...http2Responses);
      } else if (fullConfig.useLastByteSync) {
        // Use last-byte synchronization
        result = await this.singlePacketEngine.lastByteSync(host, port, rawRequests, useTls);
        this.parseRawResponses(result, responses, payloads);
      } else if (fullConfig.useSinglePacket) {
        // Use single packet attack
        result = await this.singlePacketEngine.sendSinglePacket(host, port, rawRequests, useTls);
        this.parseRawResponses(result, responses, payloads);
      } else {
        // Parallel requests using standard HTTP
        const parallelResponses = await this.sendParallelRequests(baseRequest, payloads, fullConfig);
        responses.push(...parallelResponses);
      }

      const endTime = new Date();
      const statistics = this.calculateStatistics(responses);

      const attackResult: AttackResult = {
        id: attackId,
        config: fullConfig,
        startTime,
        endTime,
        totalRequests: payloads.length,
        successfulRequests: responses.filter((r) => !r.error).length,
        failedRequests: responses.filter((r) => r.error).length,
        responses,
        statistics,
      };

      this.emit('attack-complete', attackResult);
      return attackResult;
    } catch (error: any) {
      logger.error({ error: error.message, attackId }, 'Race condition attack failed');
      throw error;
    }
  }

  // ============================================
  // Parallel Fuzzing Attack
  // ============================================

  public async parallelFuzz(
    baseRequest: TurboRequest,
    payloadSets: PayloadSet[],
    config: Partial<AttackConfig> = {}
  ): Promise<AttackResult> {
    const attackId = uuidv4();
    const startTime = new Date();

    const fullConfig: AttackConfig = {
      type: config.type || 'parallel',
      concurrency: config.concurrency || 50,
      requestsPerBatch: config.requestsPerBatch || 100,
      delayBetweenBatches: config.delayBetweenBatches || 100,
      timeout: config.timeout || 10000,
      followRedirects: config.followRedirects || false,
      useSinglePacket: false,
      useLastByteSync: false,
      useHttp2: config.useHttp2 || false,
      keepAlive: config.keepAlive !== false,
      maxSockets: config.maxSockets || 100,
    };

    // Generate all payload combinations
    const payloads = this.generatePayloadCombinations(payloadSets, fullConfig.type);

    logger.info(
      { attackId, payloadCount: payloads.length, config: fullConfig },
      'Starting parallel fuzzing attack'
    );

    const responses: TurboResponse[] = [];

    // Process in batches
    for (let i = 0; i < payloads.length; i += fullConfig.requestsPerBatch) {
      const batch = payloads.slice(i, i + fullConfig.requestsPerBatch);
      const batchResponses = await this.sendParallelRequests(
        baseRequest,
        batch.map((p) => p.join('|')),
        fullConfig
      );
      responses.push(...batchResponses);

      this.emit('batch-complete', {
        attackId,
        batchNumber: Math.floor(i / fullConfig.requestsPerBatch) + 1,
        totalBatches: Math.ceil(payloads.length / fullConfig.requestsPerBatch),
        responsesInBatch: batchResponses.length,
      });

      if (fullConfig.delayBetweenBatches > 0) {
        await this.delay(fullConfig.delayBetweenBatches);
      }
    }

    const endTime = new Date();
    const statistics = this.calculateStatistics(responses);

    return {
      id: attackId,
      config: fullConfig,
      startTime,
      endTime,
      totalRequests: payloads.length,
      successfulRequests: responses.filter((r) => !r.error).length,
      failedRequests: responses.filter((r) => r.error).length,
      responses,
      statistics,
    };
  }

  // ============================================
  // Helper Methods
  // ============================================

  private buildRawRequest(baseRequest: TurboRequest, payload: string, index: number): string {
    const parsedUrl = new URL(baseRequest.url);
    const path = this.applyPayload(parsedUrl.pathname + parsedUrl.search, payload);
    const headers = this.applyPayloadToHeaders(baseRequest.headers, payload);
    const body = baseRequest.body ? this.applyPayload(baseRequest.body.toString(), payload) : '';

    let request = `${baseRequest.method} ${path} HTTP/1.1\r\n`;
    request += `Host: ${parsedUrl.host}\r\n`;

    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== 'host') {
        request += `${key}: ${value}\r\n`;
      }
    }

    if (body) {
      request += `Content-Length: ${Buffer.byteLength(body)}\r\n`;
    }

    request += '\r\n';

    if (body) {
      request += body;
    }

    return request;
  }

  private applyPayload(template: string, payload: string): string {
    // Replace payload markers
    return template
      .replace(/§[^§]*§/g, payload)
      .replace(/\{\{payload\}\}/g, payload)
      .replace(/FUZZ/g, payload);
  }

  private applyPayloadToHeaders(
    headers: Record<string, string>,
    payload: string
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      result[key] = this.applyPayload(value, payload);
    }
    return result;
  }

  private parseRawResponses(
    result: { responses: string[]; timing: number[] },
    responses: TurboResponse[],
    payloads: string[]
  ): void {
    for (let i = 0; i < result.responses.length; i++) {
      const raw = result.responses[i];
      const timing = result.timing[i] || 0;

      // Parse HTTP response
      const lines = raw.split('\r\n');
      const statusLine = lines[0] || '';
      const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/);
      const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0;

      // Parse headers
      const headers: Record<string, string> = {};
      let bodyStart = 0;
      for (let j = 1; j < lines.length; j++) {
        if (lines[j] === '') {
          bodyStart = j + 1;
          break;
        }
        const [key, ...valueParts] = lines[j].split(':');
        if (key) {
          headers[key.trim().toLowerCase()] = valueParts.join(':').trim();
        }
      }

      const body = lines.slice(bodyStart).join('\r\n');

      responses.push({
        requestId: uuidv4(),
        statusCode,
        headers,
        body: Buffer.from(body),
        bodyText: body,
        responseTime: timing,
        connectionTime: 0,
        ttfb: timing,
        timestamp: new Date(),
      });
    }
  }

  private async sendParallelRequests(
    baseRequest: TurboRequest,
    payloads: string[],
    config: AttackConfig
  ): Promise<TurboResponse[]> {
    const responses: TurboResponse[] = [];
    const parsedUrl = new URL(baseRequest.url);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    // Create agent with connection pooling
    const agent = new protocol.Agent({
      keepAlive: config.keepAlive,
      maxSockets: config.maxSockets,
    });

    const promises = payloads.map(async (payload) => {
      const requestId = uuidv4();
      const startTime = Date.now();

      return new Promise<TurboResponse>((resolve) => {
        const path = this.applyPayload(parsedUrl.pathname + parsedUrl.search, payload);
        const headers = this.applyPayloadToHeaders(baseRequest.headers, payload);
        const body = baseRequest.body ? this.applyPayload(baseRequest.body.toString(), payload) : undefined;

        const options: http.RequestOptions = {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
          path,
          method: baseRequest.method,
          headers,
          agent,
          timeout: config.timeout,
        };

        const req = protocol.request(options, (res) => {
          const ttfb = Date.now() - startTime;
          const chunks: Buffer[] = [];

          res.on('data', (chunk) => chunks.push(chunk));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks);
            resolve({
              requestId,
              statusCode: res.statusCode || 0,
              headers: res.headers as Record<string, string | string[]>,
              body: responseBody,
              bodyText: responseBody.toString(),
              responseTime: Date.now() - startTime,
              connectionTime: 0,
              ttfb,
              timestamp: new Date(),
            });
          });
        });

        req.on('error', (err) => {
          resolve({
            requestId,
            statusCode: 0,
            headers: {},
            body: Buffer.alloc(0),
            bodyText: '',
            responseTime: Date.now() - startTime,
            connectionTime: 0,
            ttfb: 0,
            error: err.message,
            timestamp: new Date(),
          });
        });

        req.on('timeout', () => {
          req.destroy();
          resolve({
            requestId,
            statusCode: 0,
            headers: {},
            body: Buffer.alloc(0),
            bodyText: '',
            responseTime: Date.now() - startTime,
            connectionTime: 0,
            ttfb: 0,
            error: 'Request timeout',
            timestamp: new Date(),
          });
        });

        if (body) {
          req.write(body);
        }
        req.end();
      });
    });

    const results = await Promise.all(promises);
    responses.push(...results);

    agent.destroy();
    return responses;
  }

  private generatePayloadCombinations(
    payloadSets: PayloadSet[],
    attackType: string
  ): string[][] {
    const payloads: string[][] = payloadSets.map((set) => this.expandPayloadSet(set));

    if (attackType === 'pitchfork') {
      // Pitchfork: Use payloads in parallel (same index)
      const maxLength = Math.max(...payloads.map((p) => p.length));
      const combinations: string[][] = [];
      for (let i = 0; i < maxLength; i++) {
        combinations.push(payloads.map((p) => p[i % p.length]));
      }
      return combinations;
    } else if (attackType === 'clusterbomb') {
      // Cluster bomb: All combinations
      return this.cartesianProduct(payloads);
    } else {
      // Default: Flatten all payloads
      return payloads.flat().map((p) => [p]);
    }
  }

  private expandPayloadSet(set: PayloadSet): string[] {
    switch (set.type) {
      case 'list':
        return set.values || [];

      case 'range':
        const range: string[] = [];
        for (let i = set.start || 0; i <= (set.end || 100); i += set.step || 1) {
          range.push(String(i));
        }
        return range;

      case 'bruteforce':
        return this.generateBruteforce(
          set.charset || 'abcdefghijklmnopqrstuvwxyz',
          set.minLength || 1,
          set.maxLength || 4
        );

      case 'null':
        return [''];

      default:
        return [];
    }
  }

  private generateBruteforce(charset: string, minLength: number, maxLength: number): string[] {
    const results: string[] = [];

    const generate = (current: string, length: number) => {
      if (current.length >= minLength) {
        results.push(current);
      }
      if (current.length < length) {
        for (const char of charset) {
          generate(current + char, length);
        }
      }
    };

    for (let len = minLength; len <= maxLength; len++) {
      generate('', len);
    }

    return results;
  }

  private cartesianProduct(arrays: string[][]): string[][] {
    return arrays.reduce<string[][]>(
      (acc, curr) => acc.flatMap((a) => curr.map((c) => [...a, c])),
      [[]]
    );
  }

  private calculateStatistics(responses: TurboResponse[]): AttackStatistics {
    const times = responses.map((r) => r.responseTime).sort((a, b) => a - b);
    const statusCodes: Record<number, number> = {};
    const bodyHashes = new Set<string>();

    for (const response of responses) {
      statusCodes[response.statusCode] = (statusCodes[response.statusCode] || 0) + 1;
      bodyHashes.add(this.hashBody(response.bodyText));
    }

    const potentialRaceConditions = this.detectRaceConditions(responses, statusCodes, bodyHashes);

    return {
      minResponseTime: times[0] || 0,
      maxResponseTime: times[times.length - 1] || 0,
      avgResponseTime: times.reduce((a, b) => a + b, 0) / times.length || 0,
      medianResponseTime: times[Math.floor(times.length / 2)] || 0,
      p95ResponseTime: times[Math.floor(times.length * 0.95)] || 0,
      p99ResponseTime: times[Math.floor(times.length * 0.99)] || 0,
      requestsPerSecond: responses.length / ((times[times.length - 1] - times[0]) / 1000) || 0,
      statusCodeDistribution: statusCodes,
      uniqueResponses: bodyHashes.size,
      potentialRaceConditions,
    };
  }

  private hashBody(body: string): string {
    // Simple hash for comparison
    let hash = 0;
    for (let i = 0; i < body.length; i++) {
      const char = body.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(16);
  }

  private detectRaceConditions(
    responses: TurboResponse[],
    statusCodes: Record<number, number>,
    bodyHashes: Set<string>
  ): RaceConditionIndicator[] {
    const indicators: RaceConditionIndicator[] = [];

    // Check for status code variations
    const statusVariation = Object.keys(statusCodes).length;
    if (statusVariation > 1) {
      indicators.push({
        type: 'status_variation',
        description: `Multiple status codes observed: ${Object.keys(statusCodes).join(', ')}`,
        affectedRequests: responses.map((r) => r.requestId),
        confidence: Math.min(statusVariation * 0.2, 0.8),
      });
    }

    // Check for body variations
    if (bodyHashes.size > 1 && bodyHashes.size < responses.length) {
      indicators.push({
        type: 'body_variation',
        description: `${bodyHashes.size} unique response bodies observed`,
        affectedRequests: responses.map((r) => r.requestId),
        confidence: 0.6,
      });
    }

    // Check for timing anomalies
    const times = responses.map((r) => r.responseTime);
    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const stdDev = Math.sqrt(
      times.reduce((sum, t) => sum + Math.pow(t - avgTime, 2), 0) / times.length
    );

    if (stdDev > avgTime * 0.5) {
      indicators.push({
        type: 'timing_anomaly',
        description: `High timing variance detected (stddev: ${stdDev.toFixed(2)}ms)`,
        affectedRequests: responses.filter((r) => Math.abs(r.responseTime - avgTime) > stdDev * 2).map((r) => r.requestId),
        confidence: 0.5,
      });
    }

    // Check for duplicate successes (potential race condition win)
    const successResponses = responses.filter((r) => r.statusCode >= 200 && r.statusCode < 300);
    if (successResponses.length > 1) {
      indicators.push({
        type: 'duplicate_success',
        description: `${successResponses.length} successful responses - potential race condition`,
        affectedRequests: successResponses.map((r) => r.requestId),
        confidence: 0.7,
      });
    }

    return indicators;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ============================================
  // Attack Control
  // ============================================

  public cancelAttack(attackId: string): boolean {
    const attack = this.activeAttacks.get(attackId);
    if (attack) {
      attack.cancel();
      this.activeAttacks.delete(attackId);
      return true;
    }
    return false;
  }

  public getActiveAttacks(): string[] {
    return Array.from(this.activeAttacks.keys());
  }
}

export default new TurboIntruder();
