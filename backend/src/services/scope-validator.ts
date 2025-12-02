/**
 * Advanced Scope Validator
 * Prevents out-of-scope (OOS) testing with strict validation
 */

import { URL } from 'url';
import dns from 'dns';
import { promisify } from 'util';
import logger from '../utils/logger';
import database from './database';
import cache from './cache';

const dnsResolve = promisify(dns.resolve4);
const dnsReverse = promisify(dns.reverse);

export interface ScopeDefinition {
  domains: string[];
  wildcardDomains: string[];
  ipRanges: string[];
  excludedDomains: string[];
  excludedIPs: string[];
  excludedPaths: string[];
  allowedPorts: number[];
  excludedPorts: number[];
}

export interface ScopeValidationResult {
  inScope: boolean;
  reason: string;
  matchedRule?: string;
  riskLevel: 'safe' | 'warning' | 'critical';
  suggestions?: string[];
}

class ScopeValidatorService {
  private static instance: ScopeValidatorService;
  private scopeCache: Map<string, ScopeDefinition> = new Map();
  private readonly CACHE_TTL = 300; // 5 minutes

  // Known dangerous targets that should NEVER be scanned
  private readonly GLOBAL_BLACKLIST = [
    // Government domains
    '.gov', '.mil', '.gov.uk', '.gov.au', '.gc.ca',
    // Critical infrastructure
    'localhost', '127.0.0.1', '0.0.0.0',
    // Internal networks
    '10.', '172.16.', '172.17.', '172.18.', '172.19.',
    '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
    '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
    '172.30.', '172.31.', '192.168.',
    // Cloud metadata endpoints
    '169.254.169.254', 'metadata.google.internal',
    'metadata.azure.com', '100.100.100.200',
  ];

  // Common bug bounty platform domains (should not scan the platforms themselves)
  private readonly PLATFORM_DOMAINS = [
    'hackerone.com', 'bugcrowd.com', 'intigriti.com',
    'yeswehack.com', 'synack.com', 'cobalt.io',
  ];

  private constructor() {}

  public static getInstance(): ScopeValidatorService {
    if (!ScopeValidatorService.instance) {
      ScopeValidatorService.instance = new ScopeValidatorService();
    }
    return ScopeValidatorService.instance;
  }

  /**
   * Comprehensive scope validation
   */
  public async validateTarget(
    programId: string,
    target: string,
    options: {
      checkDNS?: boolean;
      checkRedirects?: boolean;
      strictMode?: boolean;
    } = {}
  ): Promise<ScopeValidationResult> {
    const { checkDNS = true, checkRedirects = false, strictMode = true } = options;

    try {
      // Step 1: Global blacklist check (CRITICAL)
      const blacklistCheck = this.checkGlobalBlacklist(target);
      if (!blacklistCheck.inScope) {
        return blacklistCheck;
      }

      // Step 2: Platform domain check
      const platformCheck = this.checkPlatformDomains(target);
      if (!platformCheck.inScope) {
        return platformCheck;
      }

      // Step 3: Get program scope
      const scope = await this.getProgramScope(programId);
      if (!scope) {
        return {
          inScope: false,
          reason: 'Program scope not found',
          riskLevel: 'critical',
        };
      }

      // Step 4: Parse target
      const parsed = this.parseTarget(target);

      // Step 5: Check excluded domains first (takes priority)
      if (this.matchesExcludedDomain(parsed.hostname, scope)) {
        return {
          inScope: false,
          reason: `Domain ${parsed.hostname} is explicitly excluded from scope`,
          matchedRule: 'excluded_domain',
          riskLevel: 'critical',
        };
      }

      // Step 6: Check excluded paths
      if (parsed.path && this.matchesExcludedPath(parsed.path, scope)) {
        return {
          inScope: false,
          reason: `Path ${parsed.path} is excluded from scope`,
          matchedRule: 'excluded_path',
          riskLevel: 'warning',
        };
      }

      // Step 7: Check excluded ports
      if (parsed.port && scope.excludedPorts?.includes(parsed.port)) {
        return {
          inScope: false,
          reason: `Port ${parsed.port} is excluded from scope`,
          matchedRule: 'excluded_port',
          riskLevel: 'warning',
        };
      }

      // Step 8: Check allowed ports (if specified)
      if (scope.allowedPorts?.length > 0 && parsed.port) {
        if (!scope.allowedPorts.includes(parsed.port)) {
          return {
            inScope: false,
            reason: `Port ${parsed.port} is not in allowed ports list`,
            matchedRule: 'port_not_allowed',
            riskLevel: 'warning',
          };
        }
      }

      // Step 9: Check explicit domains
      if (this.matchesExplicitDomain(parsed.hostname, scope)) {
        return {
          inScope: true,
          reason: `Domain ${parsed.hostname} is explicitly in scope`,
          matchedRule: 'explicit_domain',
          riskLevel: 'safe',
        };
      }

      // Step 10: Check wildcard domains
      const wildcardMatch = this.matchesWildcardDomain(parsed.hostname, scope);
      if (wildcardMatch) {
        return {
          inScope: true,
          reason: `Domain ${parsed.hostname} matches wildcard ${wildcardMatch}`,
          matchedRule: 'wildcard_domain',
          riskLevel: 'safe',
        };
      }

      // Step 11: Check IP ranges
      if (parsed.isIP && this.matchesIPRange(parsed.hostname, scope)) {
        return {
          inScope: true,
          reason: `IP ${parsed.hostname} is in allowed IP range`,
          matchedRule: 'ip_range',
          riskLevel: 'safe',
        };
      }

      // Step 12: DNS resolution check (detect CNAME to OOS)
      if (checkDNS && !parsed.isIP) {
        const dnsCheck = await this.checkDNSScope(parsed.hostname, scope);
        if (!dnsCheck.inScope) {
          return dnsCheck;
        }
      }

      // Not in scope
      return {
        inScope: false,
        reason: `Target ${target} is not in program scope`,
        riskLevel: strictMode ? 'critical' : 'warning',
        suggestions: [
          'Verify the target is listed in the program scope',
          'Check for typos in the domain name',
          'Contact program owner if you believe this is an error',
        ],
      };
    } catch (error: any) {
      logger.error({ error: error.message, target, programId }, 'Scope validation error');
      return {
        inScope: false,
        reason: `Scope validation error: ${error.message}`,
        riskLevel: 'critical',
      };
    }
  }

  /**
   * Batch validate multiple targets
   */
  public async validateTargets(
    programId: string,
    targets: string[]
  ): Promise<Map<string, ScopeValidationResult>> {
    const results = new Map<string, ScopeValidationResult>();

    // Pre-fetch scope once
    await this.getProgramScope(programId);

    // Validate in parallel with concurrency limit
    const batchSize = 50;
    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (target) => ({
          target,
          result: await this.validateTarget(programId, target, { checkDNS: false }),
        }))
      );

      for (const { target, result } of batchResults) {
        results.set(target, result);
      }
    }

    return results;
  }

  /**
   * Filter targets to only in-scope ones
   */
  public async filterInScope(programId: string, targets: string[]): Promise<string[]> {
    const results = await this.validateTargets(programId, targets);
    return targets.filter((t) => results.get(t)?.inScope === true);
  }

  /**
   * Get out-of-scope targets with reasons
   */
  public async getOutOfScope(
    programId: string,
    targets: string[]
  ): Promise<Array<{ target: string; reason: string }>> {
    const results = await this.validateTargets(programId, targets);
    return targets
      .filter((t) => results.get(t)?.inScope === false)
      .map((t) => ({
        target: t,
        reason: results.get(t)?.reason || 'Unknown',
      }));
  }

  // ============ Private Methods ============

  private checkGlobalBlacklist(target: string): ScopeValidationResult {
    const lowerTarget = target.toLowerCase();

    for (const blocked of this.GLOBAL_BLACKLIST) {
      if (lowerTarget.includes(blocked) || lowerTarget.startsWith(blocked)) {
        return {
          inScope: false,
          reason: `Target contains globally blocked pattern: ${blocked}`,
          matchedRule: 'global_blacklist',
          riskLevel: 'critical',
        };
      }
    }

    return { inScope: true, reason: '', riskLevel: 'safe' };
  }

  private checkPlatformDomains(target: string): ScopeValidationResult {
    const lowerTarget = target.toLowerCase();

    for (const platform of this.PLATFORM_DOMAINS) {
      if (lowerTarget.includes(platform)) {
        return {
          inScope: false,
          reason: `Cannot scan bug bounty platform: ${platform}`,
          matchedRule: 'platform_protection',
          riskLevel: 'critical',
        };
      }
    }

    return { inScope: true, reason: '', riskLevel: 'safe' };
  }

  private async getProgramScope(programId: string): Promise<ScopeDefinition | null> {
    // Check cache
    const cacheKey = `scope:${programId}`;
    const cached = this.scopeCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const result = await database.query(
        `SELECT scope FROM programs WHERE id = $1`,
        [programId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const rawScope = result.rows[0].scope;
      const scope: ScopeDefinition = {
        domains: rawScope.domains || [],
        wildcardDomains: rawScope.wildcardDomains || rawScope.wildcard_domains || [],
        ipRanges: rawScope.ipRanges || rawScope.ip_ranges || [],
        excludedDomains: rawScope.excludedDomains || rawScope.excluded_domains || [],
        excludedIPs: rawScope.excludedIPs || rawScope.excluded_ips || [],
        excludedPaths: rawScope.excludedPaths || rawScope.excluded_paths || [],
        allowedPorts: rawScope.allowedPorts || rawScope.allowed_ports || [],
        excludedPorts: rawScope.excludedPorts || rawScope.excluded_ports || [],
      };

      this.scopeCache.set(cacheKey, scope);

      // Auto-expire cache
      setTimeout(() => this.scopeCache.delete(cacheKey), this.CACHE_TTL * 1000);

      return scope;
    } catch (error) {
      logger.error({ error, programId }, 'Failed to fetch program scope');
      return null;
    }
  }

  private parseTarget(target: string): {
    hostname: string;
    port?: number;
    path?: string;
    isIP: boolean;
  } {
    try {
      // Handle URLs
      if (target.includes('://')) {
        const url = new URL(target);
        return {
          hostname: url.hostname,
          port: url.port ? parseInt(url.port) : undefined,
          path: url.pathname,
          isIP: this.isIPAddress(url.hostname),
        };
      }

      // Handle host:port format
      if (target.includes(':') && !target.includes('/')) {
        const [hostname, portStr] = target.split(':');
        return {
          hostname,
          port: parseInt(portStr),
          isIP: this.isIPAddress(hostname),
        };
      }

      // Plain hostname/IP
      return {
        hostname: target,
        isIP: this.isIPAddress(target),
      };
    } catch {
      return {
        hostname: target,
        isIP: this.isIPAddress(target),
      };
    }
  }

  private isIPAddress(value: string): boolean {
    // IPv4
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (ipv4Regex.test(value)) {
      return true;
    }

    // IPv6 (simplified check)
    if (value.includes(':') && !value.includes('.')) {
      return true;
    }

    return false;
  }

  private matchesExplicitDomain(hostname: string, scope: ScopeDefinition): boolean {
    const lowerHostname = hostname.toLowerCase();
    return scope.domains.some((d) => d.toLowerCase() === lowerHostname);
  }

  private matchesWildcardDomain(hostname: string, scope: ScopeDefinition): string | null {
    const lowerHostname = hostname.toLowerCase();

    for (const wildcard of scope.wildcardDomains) {
      if (wildcard.startsWith('*.')) {
        const baseDomain = wildcard.substring(2).toLowerCase();
        // Match exact base domain or any subdomain
        if (lowerHostname === baseDomain || lowerHostname.endsWith(`.${baseDomain}`)) {
          return wildcard;
        }
      }
    }

    return null;
  }

  private matchesExcludedDomain(hostname: string, scope: ScopeDefinition): boolean {
    const lowerHostname = hostname.toLowerCase();

    for (const excluded of scope.excludedDomains) {
      const lowerExcluded = excluded.toLowerCase();

      // Exact match
      if (lowerHostname === lowerExcluded) {
        return true;
      }

      // Wildcard exclusion
      if (excluded.startsWith('*.')) {
        const baseDomain = lowerExcluded.substring(2);
        if (lowerHostname === baseDomain || lowerHostname.endsWith(`.${baseDomain}`)) {
          return true;
        }
      }
    }

    return false;
  }

  private matchesExcludedPath(path: string, scope: ScopeDefinition): boolean {
    const lowerPath = path.toLowerCase();

    for (const excluded of scope.excludedPaths) {
      const lowerExcluded = excluded.toLowerCase();

      // Exact match
      if (lowerPath === lowerExcluded) {
        return true;
      }

      // Prefix match (e.g., /admin/* excludes /admin/users)
      if (excluded.endsWith('*')) {
        const prefix = lowerExcluded.slice(0, -1);
        if (lowerPath.startsWith(prefix)) {
          return true;
        }
      }

      // Contains match
      if (lowerPath.includes(lowerExcluded)) {
        return true;
      }
    }

    return false;
  }

  private matchesIPRange(ip: string, scope: ScopeDefinition): boolean {
    for (const range of scope.ipRanges) {
      if (this.ipInRange(ip, range)) {
        return true;
      }
    }
    return false;
  }

  private ipInRange(ip: string, range: string): boolean {
    // Handle CIDR notation
    if (range.includes('/')) {
      return this.ipInCIDR(ip, range);
    }

    // Handle range notation (e.g., 192.168.1.1-192.168.1.255)
    if (range.includes('-')) {
      const [start, end] = range.split('-');
      return this.ipBetween(ip, start.trim(), end.trim());
    }

    // Exact match
    return ip === range;
  }

  private ipInCIDR(ip: string, cidr: string): boolean {
    const [rangeIP, bits] = cidr.split('/');
    const mask = ~(2 ** (32 - parseInt(bits)) - 1);

    const ipNum = this.ipToNumber(ip);
    const rangeNum = this.ipToNumber(rangeIP);

    return (ipNum & mask) === (rangeNum & mask);
  }

  private ipBetween(ip: string, start: string, end: string): boolean {
    const ipNum = this.ipToNumber(ip);
    const startNum = this.ipToNumber(start);
    const endNum = this.ipToNumber(end);

    return ipNum >= startNum && ipNum <= endNum;
  }

  private ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number);
    return (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  }

  private async checkDNSScope(
    hostname: string,
    scope: ScopeDefinition
  ): Promise<ScopeValidationResult> {
    try {
      // Resolve hostname to IPs
      const ips = await dnsResolve(hostname);

      // Check if any resolved IP is in excluded list
      for (const ip of ips) {
        if (scope.excludedIPs?.includes(ip)) {
          return {
            inScope: false,
            reason: `Domain ${hostname} resolves to excluded IP ${ip}`,
            matchedRule: 'dns_excluded_ip',
            riskLevel: 'warning',
          };
        }

        // Check if IP is internal
        if (this.isInternalIP(ip)) {
          return {
            inScope: false,
            reason: `Domain ${hostname} resolves to internal IP ${ip}`,
            matchedRule: 'dns_internal_ip',
            riskLevel: 'critical',
          };
        }
      }

      return { inScope: true, reason: '', riskLevel: 'safe' };
    } catch (error) {
      // DNS resolution failed - might be valid (host down) or invalid
      return { inScope: true, reason: '', riskLevel: 'safe' };
    }
  }

  private isInternalIP(ip: string): boolean {
    const parts = ip.split('.').map(Number);

    // 10.0.0.0/8
    if (parts[0] === 10) return true;

    // 172.16.0.0/12
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;

    // 192.168.0.0/16
    if (parts[0] === 192 && parts[1] === 168) return true;

    // 127.0.0.0/8 (loopback)
    if (parts[0] === 127) return true;

    // 169.254.0.0/16 (link-local / cloud metadata)
    if (parts[0] === 169 && parts[1] === 254) return true;

    return false;
  }

  /**
   * Clear scope cache (call when program scope is updated)
   */
  public clearCache(programId?: string): void {
    if (programId) {
      this.scopeCache.delete(`scope:${programId}`);
    } else {
      this.scopeCache.clear();
    }
  }
}

export default ScopeValidatorService.getInstance();
