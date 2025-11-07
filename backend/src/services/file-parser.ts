import logger from '../utils/logger';

/**
 * File Parser Service
 * Parses various file formats to extract domains, subdomains, IPs, and URLs
 */

export interface ParsedScope {
  domains: string[];
  subdomains: string[];
  ips: string[];
  urls: string[];
  wildcardDomains: string[];
  excludedDomains: string[];
}

class FileParserService {
  /**
   * Parse multiple files and extract all assets
   */
  async parseFiles(files: Array<{ content: string; filename: string }>): Promise<ParsedScope> {
    const allAssets: ParsedScope = {
      domains: [],
      subdomains: [],
      ips: [],
      urls: [],
      wildcardDomains: [],
      excludedDomains: [],
    };

    for (const file of files) {
      try {
        const parsed = await this.parseFile(file.content, file.filename);

        // Merge results
        allAssets.domains.push(...parsed.domains);
        allAssets.subdomains.push(...parsed.subdomains);
        allAssets.ips.push(...parsed.ips);
        allAssets.urls.push(...parsed.urls);
        allAssets.wildcardDomains.push(...parsed.wildcardDomains);
        allAssets.excludedDomains.push(...parsed.excludedDomains);
      } catch (error: any) {
        logger.error({ error, filename: file.filename }, 'Failed to parse file');
      }
    }

    // Deduplicate
    return {
      domains: [...new Set(allAssets.domains)],
      subdomains: [...new Set(allAssets.subdomains)],
      ips: [...new Set(allAssets.ips)],
      urls: [...new Set(allAssets.urls)],
      wildcardDomains: [...new Set(allAssets.wildcardDomains)],
      excludedDomains: [...new Set(allAssets.excludedDomains)],
    };
  }

  /**
   * Parse a single file
   */
  private async parseFile(content: string, filename: string): Promise<ParsedScope> {
    // Try to detect format
    const ext = filename.split('.').pop()?.toLowerCase();

    if (ext === 'json') {
      return this.parseJSON(content);
    } else if (ext === 'csv') {
      return this.parseCSV(content);
    } else {
      // Default to plain text
      return this.parseText(content);
    }
  }

  /**
   * Parse JSON files (HackerOne scope, Chaos, custom formats)
   */
  private parseJSON(content: string): ParsedScope {
    try {
      const data = JSON.parse(content);

      // HackerOne scope format
      if (data.targets || data.scope) {
        return this.parseHackerOneScope(data);
      }

      // Chaos format
      if (Array.isArray(data) && data[0]?.domain) {
        return this.parseChaosFormat(data);
      }

      // Simple array format
      if (Array.isArray(data)) {
        return this.parseArrayFormat(data);
      }

      // Custom object format with domains/subdomains keys
      if (data.domains || data.subdomains) {
        return this.parseCustomObjectFormat(data);
      }

      // Try to extract any string values
      return this.extractFromObject(data);
    } catch (error: any) {
      logger.error({ error }, 'Failed to parse JSON, falling back to text parsing');
      return this.parseText(content);
    }
  }

  /**
   * Parse HackerOne scope format
   */
  private parseHackerOneScope(data: any): ParsedScope {
    const result: ParsedScope = {
      domains: [],
      subdomains: [],
      ips: [],
      urls: [],
      wildcardDomains: [],
      excludedDomains: [],
    };

    const targets = data.targets || data.scope || [];

    for (const target of targets) {
      const asset = target.asset_identifier || target.value || target.endpoint || target;
      const isExcluded = target.eligible_for_submission === false || target.out_of_scope === true;

      if (typeof asset === 'string') {
        const parsed = this.categorizeAsset(asset);

        if (isExcluded) {
          if (parsed.type === 'domain' || parsed.type === 'subdomain') {
            result.excludedDomains.push(parsed.value);
          }
        } else {
          this.addToResult(result, parsed);
        }
      }
    }

    return result;
  }

  /**
   * Parse Chaos format
   */
  private parseChaosFormat(data: any[]): ParsedScope {
    const result: ParsedScope = {
      domains: [],
      subdomains: [],
      ips: [],
      urls: [],
      wildcardDomains: [],
      excludedDomains: [],
    };

    for (const entry of data) {
      if (entry.domain) {
        const parsed = this.categorizeAsset(entry.domain);
        this.addToResult(result, parsed);
      }
      if (entry.subdomain) {
        result.subdomains.push(entry.subdomain);
      }
    }

    return result;
  }

  /**
   * Parse simple array format
   */
  private parseArrayFormat(data: any[]): ParsedScope {
    const result: ParsedScope = {
      domains: [],
      subdomains: [],
      ips: [],
      urls: [],
      wildcardDomains: [],
      excludedDomains: [],
    };

    for (const item of data) {
      if (typeof item === 'string') {
        const parsed = this.categorizeAsset(item);
        this.addToResult(result, parsed);
      }
    }

    return result;
  }

  /**
   * Parse custom object format
   */
  private parseCustomObjectFormat(data: any): ParsedScope {
    return {
      domains: data.domains || [],
      subdomains: data.subdomains || [],
      ips: data.ips || data.ip_addresses || [],
      urls: data.urls || [],
      wildcardDomains: data.wildcardDomains || data.wildcard_domains || [],
      excludedDomains: data.excludedDomains || data.excluded_domains || data.out_of_scope || [],
    };
  }

  /**
   * Extract strings from nested object
   */
  private extractFromObject(obj: any): ParsedScope {
    const result: ParsedScope = {
      domains: [],
      subdomains: [],
      ips: [],
      urls: [],
      wildcardDomains: [],
      excludedDomains: [],
    };

    const extract = (o: any) => {
      if (typeof o === 'string') {
        const parsed = this.categorizeAsset(o);
        this.addToResult(result, parsed);
      } else if (Array.isArray(o)) {
        o.forEach(extract);
      } else if (typeof o === 'object' && o !== null) {
        Object.values(o).forEach(extract);
      }
    };

    extract(obj);
    return result;
  }

  /**
   * Parse CSV files
   */
  private parseCSV(content: string): ParsedScope {
    const result: ParsedScope = {
      domains: [],
      subdomains: [],
      ips: [],
      urls: [],
      wildcardDomains: [],
      excludedDomains: [],
    };

    const lines = content.split('\n');

    for (const line of lines) {
      const values = line.split(',').map(v => v.trim());

      for (const value of values) {
        if (value && !value.match(/^(domain|subdomain|url|ip|asset|scope|target)/i)) {
          const parsed = this.categorizeAsset(value);
          this.addToResult(result, parsed);
        }
      }
    }

    return result;
  }

  /**
   * Parse plain text files
   */
  private parseText(content: string): ParsedScope {
    const result: ParsedScope = {
      domains: [],
      subdomains: [],
      ips: [],
      urls: [],
      wildcardDomains: [],
      excludedDomains: [],
    };

    const lines = content.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      // Skip empty lines and comments
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) {
        continue;
      }

      // Remove common prefixes
      const cleaned = trimmed
        .replace(/^[-*•]\s*/, '')
        .replace(/^\d+[\.\)]\s*/, '')
        .trim();

      if (cleaned) {
        const parsed = this.categorizeAsset(cleaned);
        this.addToResult(result, parsed);
      }
    }

    return result;
  }

  /**
   * Categorize an asset string into type and value
   */
  private categorizeAsset(asset: string): { type: string; value: string } {
    // Clean up the asset
    let cleaned = asset.trim()
      .replace(/^https?:\/\//, '') // Remove protocol for analysis
      .replace(/\/$/, ''); // Remove trailing slash

    // Check for wildcard domains
    if (cleaned.startsWith('*.')) {
      return { type: 'wildcard', value: cleaned.substring(2) };
    }

    // Check for URL (has path or query)
    if (asset.match(/^https?:\/\//)) {
      return { type: 'url', value: asset };
    }

    // Check for IP address
    if (this.isIP(cleaned)) {
      return { type: 'ip', value: cleaned };
    }

    // Check for IP CIDR range
    if (cleaned.match(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/)) {
      return { type: 'ip', value: cleaned };
    }

    // Check for domain or subdomain
    if (this.isDomain(cleaned)) {
      // Count dots to determine if subdomain or domain
      const dotCount = (cleaned.match(/\./g) || []).length;
      const parts = cleaned.split('.');

      // Simple heuristic: if > 2 parts or first part is long, likely subdomain
      if (dotCount > 1 || (dotCount === 1 && parts[0].length > 3 && !this.isCommonTLD(parts[1]))) {
        return { type: 'subdomain', value: cleaned };
      }

      return { type: 'domain', value: cleaned };
    }

    // Default to domain if it looks like one
    return { type: 'domain', value: cleaned };
  }

  /**
   * Check if string is a valid IP address
   */
  private isIP(str: string): boolean {
    const parts = str.split('.');
    if (parts.length !== 4) return false;

    return parts.every(part => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255 && part === num.toString();
    });
  }

  /**
   * Check if string is a valid domain
   */
  private isDomain(str: string): boolean {
    // Basic domain validation
    const domainRegex = /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i;
    return domainRegex.test(str);
  }

  /**
   * Check if TLD is common (for better domain/subdomain detection)
   */
  private isCommonTLD(tld: string): boolean {
    const commonTLDs = ['com', 'org', 'net', 'edu', 'gov', 'mil', 'io', 'co', 'ai', 'app'];
    return commonTLDs.includes(tld.toLowerCase());
  }

  /**
   * Add parsed asset to result
   */
  private addToResult(result: ParsedScope, parsed: { type: string; value: string }): void {
    switch (parsed.type) {
      case 'domain':
        result.domains.push(parsed.value);
        break;
      case 'subdomain':
        result.subdomains.push(parsed.value);
        break;
      case 'ip':
        result.ips.push(parsed.value);
        break;
      case 'url':
        result.urls.push(parsed.value);
        break;
      case 'wildcard':
        result.wildcardDomains.push(parsed.value);
        break;
    }
  }

  /**
   * Get all unique domains and subdomains combined
   */
  getAllTargets(scope: ParsedScope): string[] {
    const targets = [
      ...scope.domains,
      ...scope.subdomains,
      ...scope.wildcardDomains,
    ];
    return [...new Set(targets)];
  }
}

export default new FileParserService();
