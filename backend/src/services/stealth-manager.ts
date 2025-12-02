/**
 * Stealth Manager Service
 * Handles IP rotation, proxy chains, WAF evasion, and request throttling profiles
 */

import logger from '../utils/logger';
import cache from './cache';
import { v4 as uuidv4 } from 'uuid';

export interface ProxyConfig {
  id: string;
  type: 'http' | 'https' | 'socks4' | 'socks5' | 'tor';
  host: string;
  port: number;
  username?: string;
  password?: string;
  country?: string;
  lastUsed?: Date;
  failureCount: number;
  avgLatency: number;
  isHealthy: boolean;
}

export interface ThrottleProfile {
  name: string;
  description: string;
  requestsPerSecond: number;
  requestsPerMinute: number;
  burstSize: number;
  delayBetweenRequests: number; // ms
  jitterRange: number; // ms - random delay variance
  respectRobotsTxt: boolean;
  respectRetryAfter: boolean;
  maxConcurrentConnections: number;
}

export interface WAFEvasionConfig {
  enabled: boolean;
  techniques: WAFEvasionTechnique[];
  rotateUserAgent: boolean;
  randomizeHeaders: boolean;
  useEncodingVariations: boolean;
  fragmentRequests: boolean;
  addDecoyParams: boolean;
}

export type WAFEvasionTechnique =
  | 'case-variation'
  | 'url-encoding'
  | 'double-encoding'
  | 'unicode-encoding'
  | 'null-byte-injection'
  | 'comment-injection'
  | 'whitespace-variation'
  | 'http-parameter-pollution'
  | 'header-injection'
  | 'chunked-encoding';

export interface StealthSession {
  id: string;
  programId: string;
  profile: ThrottleProfile;
  proxyChain: ProxyConfig[];
  wafEvasion: WAFEvasionConfig;
  currentProxyIndex: number;
  requestCount: number;
  startTime: Date;
  lastRequestTime?: Date;
}

// Predefined throttle profiles for different scenarios
const THROTTLE_PROFILES: Record<string, ThrottleProfile> = {
  // Ultra-stealth for sensitive targets
  stealth: {
    name: 'stealth',
    description: 'Ultra-low profile for sensitive targets',
    requestsPerSecond: 1,
    requestsPerMinute: 30,
    burstSize: 1,
    delayBetweenRequests: 2000,
    jitterRange: 1000,
    respectRobotsTxt: true,
    respectRetryAfter: true,
    maxConcurrentConnections: 1,
  },

  // Conservative for bug bounty programs
  conservative: {
    name: 'conservative',
    description: 'Safe profile for bug bounty programs',
    requestsPerSecond: 5,
    requestsPerMinute: 200,
    burstSize: 3,
    delayBetweenRequests: 500,
    jitterRange: 200,
    respectRobotsTxt: true,
    respectRetryAfter: true,
    maxConcurrentConnections: 3,
  },

  // Moderate for general scanning
  moderate: {
    name: 'moderate',
    description: 'Balanced speed and stealth',
    requestsPerSecond: 20,
    requestsPerMinute: 800,
    burstSize: 10,
    delayBetweenRequests: 100,
    jitterRange: 50,
    respectRobotsTxt: true,
    respectRetryAfter: true,
    maxConcurrentConnections: 10,
  },

  // Aggressive for authorized pentests
  aggressive: {
    name: 'aggressive',
    description: 'High-speed for authorized testing only',
    requestsPerSecond: 100,
    requestsPerMinute: 5000,
    burstSize: 50,
    delayBetweenRequests: 10,
    jitterRange: 5,
    respectRobotsTxt: false,
    respectRetryAfter: false,
    maxConcurrentConnections: 50,
  },

  // Maximum speed (use with caution)
  turbo: {
    name: 'turbo',
    description: 'Maximum speed - authorized testing only',
    requestsPerSecond: 500,
    requestsPerMinute: 20000,
    burstSize: 200,
    delayBetweenRequests: 0,
    jitterRange: 0,
    respectRobotsTxt: false,
    respectRetryAfter: false,
    maxConcurrentConnections: 200,
  },
};

// Common user agents for rotation
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
];

class StealthManagerService {
  private static instance: StealthManagerService;
  private sessions: Map<string, StealthSession> = new Map();
  private proxyPool: ProxyConfig[] = [];
  private torEnabled: boolean = false;

  private constructor() {
    this.initializeProxyPool();
  }

  public static getInstance(): StealthManagerService {
    if (!StealthManagerService.instance) {
      StealthManagerService.instance = new StealthManagerService();
    }
    return StealthManagerService.instance;
  }

  /**
   * Create a stealth session for a program
   */
  public createSession(
    programId: string,
    profileName: string = 'conservative',
    options: {
      useProxy?: boolean;
      useTor?: boolean;
      wafEvasion?: boolean;
    } = {}
  ): StealthSession {
    const profile = THROTTLE_PROFILES[profileName] || THROTTLE_PROFILES.conservative;

    const session: StealthSession = {
      id: uuidv4(),
      programId,
      profile,
      proxyChain: options.useProxy ? this.selectProxies(3) : [],
      wafEvasion: {
        enabled: options.wafEvasion || false,
        techniques: ['case-variation', 'url-encoding', 'whitespace-variation'],
        rotateUserAgent: true,
        randomizeHeaders: true,
        useEncodingVariations: true,
        fragmentRequests: false,
        addDecoyParams: false,
      },
      currentProxyIndex: 0,
      requestCount: 0,
      startTime: new Date(),
    };

    if (options.useTor) {
      session.proxyChain.push(this.getTorProxy());
    }

    this.sessions.set(session.id, session);
    logger.info({ sessionId: session.id, programId, profile: profileName }, 'Stealth session created');

    return session;
  }

  /**
   * Get throttle profile by name
   */
  public getProfile(name: string): ThrottleProfile {
    return THROTTLE_PROFILES[name] || THROTTLE_PROFILES.conservative;
  }

  /**
   * Get all available profiles
   */
  public getAvailableProfiles(): Record<string, ThrottleProfile> {
    return { ...THROTTLE_PROFILES };
  }

  /**
   * Calculate delay before next request
   */
  public async getRequestDelay(sessionId: string): Promise<number> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return 100; // Default delay
    }

    const { profile } = session;
    const baseDelay = profile.delayBetweenRequests;
    const jitter = Math.random() * profile.jitterRange;

    // Add extra delay if approaching rate limit
    const now = Date.now();
    const sessionDuration = now - session.startTime.getTime();
    const avgRequestsPerSecond = session.requestCount / (sessionDuration / 1000);

    let extraDelay = 0;
    if (avgRequestsPerSecond > profile.requestsPerSecond * 0.8) {
      // Approaching limit, slow down
      extraDelay = 500;
    }

    return baseDelay + jitter + extraDelay;
  }

  /**
   * Record a request and check if we should continue
   */
  public async recordRequest(sessionId: string): Promise<{
    allowed: boolean;
    waitMs?: number;
    reason?: string;
  }> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { allowed: true };
    }

    session.requestCount++;
    session.lastRequestTime = new Date();

    const { profile } = session;

    // Check requests per minute
    const sessionMinutes = (Date.now() - session.startTime.getTime()) / 60000;
    const requestsPerMinute = session.requestCount / Math.max(sessionMinutes, 1);

    if (requestsPerMinute > profile.requestsPerMinute) {
      const waitMs = 60000 - (Date.now() - session.startTime.getTime()) % 60000;
      return {
        allowed: false,
        waitMs,
        reason: `Rate limit: ${profile.requestsPerMinute} requests/minute exceeded`,
      };
    }

    return { allowed: true };
  }

  /**
   * Get next proxy from rotation
   */
  public getNextProxy(sessionId: string): ProxyConfig | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.proxyChain.length === 0) {
      return null;
    }

    const proxy = session.proxyChain[session.currentProxyIndex];
    session.currentProxyIndex = (session.currentProxyIndex + 1) % session.proxyChain.length;

    return proxy;
  }

  /**
   * Get a random user agent
   */
  public getRandomUserAgent(): string {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  }

  /**
   * Generate stealth headers
   */
  public generateStealthHeaders(sessionId?: string): Record<string, string> {
    const session = sessionId ? this.sessions.get(sessionId) : null;
    const headers: Record<string, string> = {
      'User-Agent': this.getRandomUserAgent(),
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Cache-Control': 'max-age=0',
    };

    // Add randomization if WAF evasion is enabled
    if (session?.wafEvasion.randomizeHeaders) {
      // Randomize header order by recreating object
      const entries = Object.entries(headers);
      this.shuffleArray(entries);

      // Add some variation
      if (Math.random() > 0.5) {
        headers['DNT'] = '1';
      }
      if (Math.random() > 0.7) {
        headers['Pragma'] = 'no-cache';
      }
    }

    return headers;
  }

  /**
   * Apply WAF evasion to a payload
   */
  public applyWAFEvasion(
    payload: string,
    techniques: WAFEvasionTechnique[]
  ): string[] {
    const variations: string[] = [payload];

    for (const technique of techniques) {
      const newVariations: string[] = [];

      for (const variant of variations) {
        switch (technique) {
          case 'case-variation':
            newVariations.push(this.randomCase(variant));
            break;

          case 'url-encoding':
            newVariations.push(this.urlEncode(variant));
            break;

          case 'double-encoding':
            newVariations.push(this.doubleEncode(variant));
            break;

          case 'unicode-encoding':
            newVariations.push(this.unicodeEncode(variant));
            break;

          case 'null-byte-injection':
            newVariations.push(variant + '%00');
            newVariations.push('%00' + variant);
            break;

          case 'comment-injection':
            newVariations.push(this.addComments(variant));
            break;

          case 'whitespace-variation':
            newVariations.push(this.varyWhitespace(variant));
            break;

          default:
            newVariations.push(variant);
        }
      }

      variations.push(...newVariations);
    }

    // Remove duplicates
    return [...new Set(variations)];
  }

  /**
   * Add proxy to pool
   */
  public addProxy(proxy: Omit<ProxyConfig, 'id' | 'failureCount' | 'avgLatency' | 'isHealthy'>): void {
    const fullProxy: ProxyConfig = {
      ...proxy,
      id: uuidv4(),
      failureCount: 0,
      avgLatency: 0,
      isHealthy: true,
    };

    this.proxyPool.push(fullProxy);
    logger.info({ proxyId: fullProxy.id, host: proxy.host }, 'Proxy added to pool');
  }

  /**
   * Remove unhealthy proxies
   */
  public pruneUnhealthyProxies(): number {
    const before = this.proxyPool.length;
    this.proxyPool = this.proxyPool.filter((p) => p.isHealthy && p.failureCount < 5);
    const removed = before - this.proxyPool.length;

    if (removed > 0) {
      logger.info({ removed }, 'Pruned unhealthy proxies');
    }

    return removed;
  }

  /**
   * Report proxy failure
   */
  public reportProxyFailure(proxyId: string): void {
    const proxy = this.proxyPool.find((p) => p.id === proxyId);
    if (proxy) {
      proxy.failureCount++;
      if (proxy.failureCount >= 5) {
        proxy.isHealthy = false;
      }
    }
  }

  /**
   * Get proxy statistics
   */
  public getProxyStats(): {
    total: number;
    healthy: number;
    byType: Record<string, number>;
    byCountry: Record<string, number>;
  } {
    const stats = {
      total: this.proxyPool.length,
      healthy: this.proxyPool.filter((p) => p.isHealthy).length,
      byType: {} as Record<string, number>,
      byCountry: {} as Record<string, number>,
    };

    for (const proxy of this.proxyPool) {
      stats.byType[proxy.type] = (stats.byType[proxy.type] || 0) + 1;
      if (proxy.country) {
        stats.byCountry[proxy.country] = (stats.byCountry[proxy.country] || 0) + 1;
      }
    }

    return stats;
  }

  /**
   * End a stealth session
   */
  public endSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      logger.info(
        {
          sessionId,
          programId: session.programId,
          requestCount: session.requestCount,
          duration: Date.now() - session.startTime.getTime(),
        },
        'Stealth session ended'
      );
      this.sessions.delete(sessionId);
    }
  }

  // ============ Private Methods ============

  private initializeProxyPool(): void {
    // Load proxies from environment or config
    const proxyList = process.env.PROXY_LIST;
    if (proxyList) {
      try {
        const proxies = JSON.parse(proxyList);
        for (const proxy of proxies) {
          this.addProxy(proxy);
        }
      } catch (error) {
        logger.warn('Failed to parse PROXY_LIST from environment');
      }
    }

    // Check for Tor
    this.torEnabled = process.env.TOR_ENABLED === 'true';
    if (this.torEnabled) {
      logger.info('Tor proxy support enabled');
    }
  }

  private selectProxies(count: number): ProxyConfig[] {
    const healthy = this.proxyPool.filter((p) => p.isHealthy);
    this.shuffleArray(healthy);
    return healthy.slice(0, count);
  }

  private getTorProxy(): ProxyConfig {
    return {
      id: 'tor-default',
      type: 'socks5',
      host: process.env.TOR_HOST || '127.0.0.1',
      port: parseInt(process.env.TOR_PORT || '9050'),
      failureCount: 0,
      avgLatency: 0,
      isHealthy: true,
    };
  }

  private shuffleArray<T>(array: T[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  private randomCase(str: string): string {
    return str
      .split('')
      .map((c) => (Math.random() > 0.5 ? c.toUpperCase() : c.toLowerCase()))
      .join('');
  }

  private urlEncode(str: string): string {
    return str
      .split('')
      .map((c) => {
        if (/[a-zA-Z0-9]/.test(c)) {
          return Math.random() > 0.7 ? `%${c.charCodeAt(0).toString(16)}` : c;
        }
        return encodeURIComponent(c);
      })
      .join('');
  }

  private doubleEncode(str: string): string {
    return encodeURIComponent(encodeURIComponent(str));
  }

  private unicodeEncode(str: string): string {
    return str
      .split('')
      .map((c) => {
        if (Math.random() > 0.7) {
          return `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
        }
        return c;
      })
      .join('');
  }

  private addComments(str: string): string {
    // Add SQL-style comments for SQL payloads
    if (str.toLowerCase().includes('select') || str.toLowerCase().includes('union')) {
      return str.replace(/ /g, '/**/');
    }
    // Add HTML comments for XSS payloads
    if (str.includes('<') || str.includes('>')) {
      return str.replace(/</g, '<!--><');
    }
    return str;
  }

  private varyWhitespace(str: string): string {
    const whitespaceChars = [' ', '\t', '\n', '\r', '%09', '%0a', '%0d', '%20'];
    return str.replace(/ /g, () => whitespaceChars[Math.floor(Math.random() * whitespaceChars.length)]);
  }
}

export default StealthManagerService.getInstance();
