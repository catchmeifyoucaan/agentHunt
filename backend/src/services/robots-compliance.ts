/**
 * Robots.txt Compliance Service
 * 
 * Ensures scanning respects robots.txt directives:
 * - Parses and caches robots.txt files
 * - Checks URL allowance before scanning
 * - Respects crawl-delay directives
 * - Supports user-agent specific rules
 */

import logger from '../utils/logger';
import database from './database';
import axios from 'axios';

interface RobotsRule {
  userAgent: string;
  allow: string[];
  disallow: string[];
  crawlDelay?: number;
  sitemaps: string[];
}

interface RobotsCache {
  rules: RobotsRule[];
  fetchedAt: Date;
  expiresAt: Date;
}

class RobotsComplianceService {
  private cache: Map<string, RobotsCache> = new Map();
  private cacheTTL = 3600000; // 1 hour
  private enabled = true;
  private userAgent = 'AgentHunt-Scanner';

  /**
   * Configure the service
   */
  configure(options: { enabled?: boolean; userAgent?: string; cacheTTL?: number }): void {
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.userAgent) this.userAgent = options.userAgent;
    if (options.cacheTTL) this.cacheTTL = options.cacheTTL;
    logger.info({ enabled: this.enabled, userAgent: this.userAgent }, 'Robots compliance configured');
  }

  /**
   * Check if URL is allowed to be scanned
   */
  async isAllowed(url: string): Promise<{ allowed: boolean; crawlDelay?: number; reason?: string }> {
    if (!this.enabled) {
      return { allowed: true, reason: 'Robots compliance disabled' };
    }

    try {
      const urlObj = new URL(url);
      const baseUrl = `${urlObj.protocol}//${urlObj.host}`;
      const path = urlObj.pathname + urlObj.search;

      // Get robots.txt rules
      const rules = await this.getRobotsTxt(baseUrl);
      if (!rules || rules.length === 0) {
        return { allowed: true, reason: 'No robots.txt found' };
      }

      // Find matching rule (most specific user-agent first)
      const matchingRule = this.findMatchingRule(rules);
      if (!matchingRule) {
        return { allowed: true, reason: 'No matching user-agent rule' };
      }

      // Check disallow rules first
      for (const disallowPattern of matchingRule.disallow) {
        if (this.matchesPattern(path, disallowPattern)) {
          // Check if there's a more specific allow rule
          let explicitlyAllowed = false;
          for (const allowPattern of matchingRule.allow) {
            if (this.matchesPattern(path, allowPattern) && allowPattern.length > disallowPattern.length) {
              explicitlyAllowed = true;
              break;
            }
          }
          if (!explicitlyAllowed) {
            return {
              allowed: false,
              crawlDelay: matchingRule.crawlDelay,
              reason: `Disallowed by pattern: ${disallowPattern}`,
            };
          }
        }
      }

      return {
        allowed: true,
        crawlDelay: matchingRule.crawlDelay,
        reason: 'Allowed by robots.txt',
      };
    } catch (error) {
      logger.debug({ error, url }, 'Error checking robots.txt');
      return { allowed: true, reason: 'Error parsing robots.txt, allowing by default' };
    }
  }

  /**
   * Filter URLs based on robots.txt
   */
  async filterAllowedUrls(urls: string[]): Promise<{ allowed: string[]; blocked: string[] }> {
    const allowed: string[] = [];
    const blocked: string[] = [];

    // Group URLs by host for efficiency
    const urlsByHost: Map<string, string[]> = new Map();
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        const host = `${urlObj.protocol}//${urlObj.host}`;
        if (!urlsByHost.has(host)) {
          urlsByHost.set(host, []);
        }
        urlsByHost.get(host)!.push(url);
      } catch {
        allowed.push(url); // Invalid URLs pass through
      }
    }

    // Check each host's URLs
    for (const [host, hostUrls] of urlsByHost) {
      const rules = await this.getRobotsTxt(host);
      
      for (const url of hostUrls) {
        const result = await this.isAllowed(url);
        if (result.allowed) {
          allowed.push(url);
        } else {
          blocked.push(url);
          logger.debug({ url, reason: result.reason }, 'URL blocked by robots.txt');
        }
      }
    }

    logger.info({ total: urls.length, allowed: allowed.length, blocked: blocked.length }, 'Filtered URLs by robots.txt');
    return { allowed, blocked };
  }

  /**
   * Get crawl delay for a host
   */
  async getCrawlDelay(baseUrl: string): Promise<number> {
    const rules = await this.getRobotsTxt(baseUrl);
    const matchingRule = this.findMatchingRule(rules);
    return matchingRule?.crawlDelay || 0;
  }

  /**
   * Get sitemaps from robots.txt
   */
  async getSitemaps(baseUrl: string): Promise<string[]> {
    const rules = await this.getRobotsTxt(baseUrl);
    const sitemaps: string[] = [];
    for (const rule of rules) {
      sitemaps.push(...rule.sitemaps);
    }
    return [...new Set(sitemaps)];
  }

  /**
   * Fetch and parse robots.txt
   */
  private async getRobotsTxt(baseUrl: string): Promise<RobotsRule[]> {
    // Check cache
    const cached = this.cache.get(baseUrl);
    if (cached && cached.expiresAt > new Date()) {
      return cached.rules;
    }

    try {
      const robotsUrl = `${baseUrl}/robots.txt`;
      const response = await axios.get(robotsUrl, {
        timeout: 10000,
        validateStatus: (status) => status < 500,
        headers: {
          'User-Agent': this.userAgent,
        },
      });

      if (response.status === 200 && response.data) {
        const rules = this.parseRobotsTxt(response.data);
        
        // Cache the result
        this.cache.set(baseUrl, {
          rules,
          fetchedAt: new Date(),
          expiresAt: new Date(Date.now() + this.cacheTTL),
        });

        // Store in database for persistence
        await this.storeRobotsTxt(baseUrl, response.data, rules);

        return rules;
      }

      // No robots.txt or error - cache empty result
      this.cache.set(baseUrl, {
        rules: [],
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + this.cacheTTL),
      });

      return [];
    } catch (error) {
      logger.debug({ error, baseUrl }, 'Failed to fetch robots.txt');
      return [];
    }
  }

  /**
   * Parse robots.txt content
   */
  private parseRobotsTxt(content: string): RobotsRule[] {
    const rules: RobotsRule[] = [];
    let currentRule: RobotsRule | null = null;

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      
      // Skip comments and empty lines
      if (!trimmed || trimmed.startsWith('#')) continue;

      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) continue;

      const directive = trimmed.substring(0, colonIndex).toLowerCase().trim();
      const value = trimmed.substring(colonIndex + 1).trim();

      switch (directive) {
        case 'user-agent':
          // Start new rule
          currentRule = {
            userAgent: value,
            allow: [],
            disallow: [],
            sitemaps: [],
          };
          rules.push(currentRule);
          break;

        case 'disallow':
          if (currentRule && value) {
            currentRule.disallow.push(value);
          }
          break;

        case 'allow':
          if (currentRule && value) {
            currentRule.allow.push(value);
          }
          break;

        case 'crawl-delay':
          if (currentRule) {
            const delay = parseFloat(value);
            if (!isNaN(delay)) {
              currentRule.crawlDelay = delay;
            }
          }
          break;

        case 'sitemap':
          if (value) {
            // Sitemaps are global, add to all rules or create a placeholder
            if (currentRule) {
              currentRule.sitemaps.push(value);
            } else {
              // Create a wildcard rule for sitemaps
              rules.push({
                userAgent: '*',
                allow: [],
                disallow: [],
                sitemaps: [value],
              });
            }
          }
          break;
      }
    }

    return rules;
  }

  /**
   * Find the most specific matching rule
   */
  private findMatchingRule(rules: RobotsRule[]): RobotsRule | null {
    // First, look for exact user-agent match
    for (const rule of rules) {
      if (rule.userAgent.toLowerCase() === this.userAgent.toLowerCase()) {
        return rule;
      }
    }

    // Then look for partial match
    for (const rule of rules) {
      if (this.userAgent.toLowerCase().includes(rule.userAgent.toLowerCase())) {
        return rule;
      }
    }

    // Finally, use wildcard rule
    for (const rule of rules) {
      if (rule.userAgent === '*') {
        return rule;
      }
    }

    return null;
  }

  /**
   * Check if path matches a robots.txt pattern
   */
  private matchesPattern(path: string, pattern: string): boolean {
    if (!pattern) return false;

    // Handle wildcards
    if (pattern.includes('*')) {
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\$/g, '$') + (pattern.endsWith('$') ? '' : '.*'));
      return regex.test(path);
    }

    // Handle end anchor
    if (pattern.endsWith('$')) {
      return path === pattern.slice(0, -1);
    }

    // Simple prefix match
    return path.startsWith(pattern);
  }

  /**
   * Store robots.txt in database
   */
  private async storeRobotsTxt(baseUrl: string, content: string, rules: RobotsRule[]): Promise<void> {
    try {
      await database.query(
        `INSERT INTO robots_txt_cache (host, content, rules, fetched_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
         ON CONFLICT (host) DO UPDATE SET content = $2, rules = $3, fetched_at = CURRENT_TIMESTAMP`,
        [baseUrl, content, JSON.stringify(rules)]
      );
    } catch (error) {
      logger.debug({ error }, 'Failed to store robots.txt');
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
    logger.info('Robots.txt cache cleared');
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; hosts: string[] } {
    return {
      size: this.cache.size,
      hosts: Array.from(this.cache.keys()),
    };
  }
}

export const robotsCompliance = new RobotsComplianceService();
export default robotsCompliance;
