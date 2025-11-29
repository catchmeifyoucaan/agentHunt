import axios from 'axios';
import { Job } from 'bullmq';
import database from '../services/database';
import logger from '../utils/logger';
import { BaseAgent } from './base';
import eventEmitter from '../services/event-emitter';

/**
 * API Versioning Agent
 *
 * Detects and exploits vulnerabilities in API versioning mechanisms:
 * - Deprecated API version enumeration
 * - Version-specific vulnerability detection
 * - Backward compatibility exploits
 * - API version confusion
 * - Legacy endpoint discovery
 *
 * Attack Vectors:
 * 1. Version Enumeration: /api/v1, /api/v2, /v1, /v2, /1.0, /2.0
 * 2. Header-based versioning: Accept-version, API-Version, X-API-Version
 * 3. Query parameter versioning: ?version=1, ?api_version=2
 * 4. Subdomain versioning: v1.api.example.com, api-v2.example.com
 * 5. Version downgrade attacks
 * 6. Version confusion (mixing v1 auth with v2 endpoints)
 * 7. Deprecated endpoint abuse (weaker security in old versions)
 * 8. Version-specific injection vulnerabilities
 */

interface ApiVersioningJob {
  id: string;
  programId: string;
  domain: string;
  baseUrl: string;
  endpoints: string[];
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}

interface VersionEndpoint {
  version: string;
  url: string;
  method: 'path' | 'header' | 'query' | 'subdomain';
  statusCode?: number;
  responseTime?: number;
  deprecated?: boolean;
}

interface VersionVulnerability {
  version: string;
  endpoint: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  poc?: string;
  evidence?: any;
}

export class APIVersioningAgent extends BaseAgent<ApiVersioningJob> {
  constructor() {
    super('api-versioning' as any);
  }

  protected getSteps() {
    return [
      { name: 'Enumerate API versions', metadata: { phase: 'discovery' } },
      { name: 'Test version-specific vulnerabilities', metadata: { phase: 'vulnerability-testing' } },
      { name: 'Test version downgrade attacks', metadata: { phase: 'downgrade-testing' } },
      { name: 'Test version confusion exploits', metadata: { phase: 'confusion-testing' } },
      { name: 'Test deprecated endpoint security', metadata: { phase: 'deprecated-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<ApiVersioningJob>): Promise<any> {
    const { programId, domain, baseUrl, endpoints, headers = {}, cookies = {} } = job.data;

    logger.info({ domain, baseUrl, job: job.id }, 'Starting API versioning analysis');

    const findings: VersionVulnerability[] = [];

    try {
      // Step 1: Enumerate API versions
      await this.updateProgress(job, 0, 'Enumerating API versions');
      const discoveredVersions = await this.enumerateVersions(baseUrl, endpoints, headers, cookies);
      logger.info({ count: discoveredVersions.length }, 'Discovered API versions');

      // Step 2: Test version-specific vulnerabilities
      await this.updateProgress(job, 1, 'Testing version-specific vulnerabilities');
      const versionVulns = await this.testVersionSpecificVulnerabilities(
        discoveredVersions,
        headers,
        cookies
      );
      findings.push(...versionVulns);

      // Step 3: Test version downgrade attacks
      await this.updateProgress(job, 2, 'Testing version downgrade attacks');
      const downgradeVulns = await this.testVersionDowngrade(discoveredVersions, headers, cookies);
      findings.push(...downgradeVulns);

      // Step 4: Test version confusion exploits
      await this.updateProgress(job, 3, 'Testing version confusion');
      const confusionVulns = await this.testVersionConfusion(discoveredVersions, headers, cookies);
      findings.push(...confusionVulns);

      // Step 5: Test deprecated endpoint security
      await this.updateProgress(job, 4, 'Testing deprecated endpoints');
      const deprecatedVulns = await this.testDeprecatedEndpoints(
        discoveredVersions,
        headers,
        cookies
      );
      findings.push(...deprecatedVulns);

      // Step 6: Store findings in database
      await this.updateProgress(job, 5, 'Storing findings');
      const storedCount = await this.storeFindings(job.id!, programId, findings);

      logger.info(
        { findings: findings.length, stored: storedCount, job: job.id },
        'API versioning analysis complete'
      );

      // Emit event for each critical finding
      const criticalFindings = findings.filter((f) => f.severity === 'critical');
      if (criticalFindings.length > 0) {
        eventEmitter.emit('agent:critical-finding', {
          agent: 'api-versioning',
          jobId: job.id,
          programId,
          count: criticalFindings.length,
        });
      }

      return {
        success: true,
        versionsFound: discoveredVersions.length,
        vulnerabilities: findings.length,
        critical: findings.filter((f) => f.severity === 'critical').length,
        high: findings.filter((f) => f.severity === 'high').length,
        medium: findings.filter((f) => f.severity === 'medium').length,
        low: findings.filter((f) => f.severity === 'low').length,
      };
    } catch (error: any) {
      logger.error({ error, job: job.id }, 'API versioning analysis failed');
      throw error;
    }
  }

  /**
   * Enumerate API versions using multiple detection methods
   */
  private async enumerateVersions(
    baseUrl: string,
    endpoints: string[],
    headers: Record<string, string>,
    cookies: Record<string, string>
  ): Promise<VersionEndpoint[]> {
    const versions: VersionEndpoint[] = [];
    const versionPatterns = ['v1', 'v2', 'v3', 'v4', 'v5', '1.0', '2.0', '3.0', '1', '2', '3'];

    // Method 1: Path-based versioning
    for (const pattern of versionPatterns) {
      const pathVariations = [
        `${baseUrl}/api/${pattern}`,
        `${baseUrl}/${pattern}`,
        `${baseUrl}/${pattern}/api`,
      ];

      for (const url of pathVariations) {
        try {
          const startTime = Date.now();
          const response = await axios.get(url, {
            headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
            timeout: 5000,
            maxRedirects: 0,
            validateStatus: () => true, // Accept all status codes
          });

          const responseTime = Date.now() - startTime;

          if (response.status !== 404 && response.status !== 403) {
            versions.push({
              version: pattern,
              url,
              method: 'path',
              statusCode: response.status,
              responseTime,
              deprecated: this.isDeprecated(response),
            });
          }
        } catch (error: any) {
          // Ignore network errors
        }
      }
    }

    // Method 2: Header-based versioning
    const headerNames = ['Accept-version', 'API-Version', 'X-API-Version', 'Version'];
    for (const endpoint of endpoints.slice(0, 3)) {
      // Test first 3 endpoints
      for (const headerName of headerNames) {
        for (const pattern of versionPatterns) {
          try {
            const response = await axios.get(endpoint, {
              headers: {
                ...headers,
                [headerName]: pattern,
                'User-Agent': 'AgentHunt-API-Scanner',
              },
              timeout: 5000,
              validateStatus: () => true,
            });

            // Check if response differs from default (indicates version support)
            if (response.status !== 404 && response.headers['content-type']) {
              versions.push({
                version: pattern,
                url: endpoint,
                method: 'header',
                statusCode: response.status,
                deprecated: this.isDeprecated(response),
              });
            }
          } catch (error: any) {
            // Ignore errors
          }
        }
      }
    }

    // Method 3: Query parameter versioning
    const queryParams = ['version', 'api_version', 'v', 'ver'];
    for (const endpoint of endpoints.slice(0, 3)) {
      for (const param of queryParams) {
        for (const pattern of versionPatterns) {
          try {
            const separator = endpoint.includes('?') ? '&' : '?';
            const url = `${endpoint}${separator}${param}=${pattern}`;

            const response = await axios.get(url, {
              headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
              timeout: 5000,
              validateStatus: () => true,
            });

            if (response.status !== 404) {
              versions.push({
                version: pattern,
                url,
                method: 'query',
                statusCode: response.status,
                deprecated: this.isDeprecated(response),
              });
            }
          } catch (error: any) {
            // Ignore errors
          }
        }
      }
    }

    // Method 4: Subdomain versioning
    const parsedUrl = new URL(baseUrl);
    const baseDomain = parsedUrl.hostname;

    for (const pattern of versionPatterns) {
      const subdomainVariations = [
        `${pattern}.${baseDomain}`,
        `api-${pattern}.${baseDomain}`,
        `${pattern}.api.${baseDomain}`,
      ];

      for (const subdomain of subdomainVariations) {
        try {
          const url = `${parsedUrl.protocol}//${subdomain}${parsedUrl.pathname}`;
          const response = await axios.get(url, {
            headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
            timeout: 5000,
            validateStatus: () => true,
          });

          if (response.status !== 404 && response.status !== 502 && response.status !== 503) {
            versions.push({
              version: pattern,
              url,
              method: 'subdomain',
              statusCode: response.status,
              deprecated: this.isDeprecated(response),
            });
          }
        } catch (error: any) {
          // Ignore DNS/network errors
        }
      }
    }

    return this.deduplicateVersions(versions);
  }

  /**
   * Check if API version is deprecated based on response indicators
   */
  private isDeprecated(response: any): boolean {
    const deprecatedIndicators = [
      'deprecated',
      'sunset',
      'end-of-life',
      'eol',
      'unsupported',
      'legacy',
    ];

    // Check headers
    const headers = JSON.stringify(response.headers).toLowerCase();
    if (deprecatedIndicators.some((indicator) => headers.includes(indicator))) {
      return true;
    }

    // Check response body
    const body = JSON.stringify(response.data).toLowerCase();
    if (deprecatedIndicators.some((indicator) => body.includes(indicator))) {
      return true;
    }

    return false;
  }

  /**
   * Test version-specific vulnerabilities
   */
  private async testVersionSpecificVulnerabilities(
    versions: VersionEndpoint[],
    headers: Record<string, string>,
    cookies: Record<string, string>
  ): Promise<VersionVulnerability[]> {
    const vulnerabilities: VersionVulnerability[] = [];

    for (const version of versions) {
      // Test 1: Missing authentication in older versions
      try {
        const response = await axios.get(version.url, {
          headers: { 'User-Agent': 'AgentHunt-API-Scanner' }, // No auth headers
          timeout: 5000,
          validateStatus: () => true,
        });

        if (response.status === 200 && response.data) {
          vulnerabilities.push({
            version: version.version,
            endpoint: version.url,
            type: 'missing-authentication',
            severity: 'high',
            description: `API version ${version.version} accessible without authentication`,
            evidence: {
              statusCode: response.status,
              dataReturned: typeof response.data === 'object',
            },
          });
        }
      } catch (error: any) {
        // Ignore
      }

      // Test 2: Sensitive data exposure
      try {
        const response = await axios.get(version.url, {
          headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
          timeout: 5000,
          validateStatus: () => true,
        });

        const sensitivePatterns = [
          /password/i,
          /secret/i,
          /api[_-]?key/i,
          /token/i,
          /ssn/i,
          /credit[_-]?card/i,
        ];

        const responseText = JSON.stringify(response.data);
        for (const pattern of sensitivePatterns) {
          if (pattern.test(responseText)) {
            vulnerabilities.push({
              version: version.version,
              endpoint: version.url,
              type: 'sensitive-data-exposure',
              severity: 'medium',
              description: `API version ${version.version} may expose sensitive data in responses`,
              evidence: { pattern: pattern.source },
            });
            break;
          }
        }
      } catch (error: any) {
        // Ignore
      }

      // Test 3: SQL Injection in older versions
      const sqlPayloads = ["'", "1' OR '1'='1", "1' AND '1'='2"];
      for (const payload of sqlPayloads) {
        try {
          const separator = version.url.includes('?') ? '&' : '?';
          const testUrl = `${version.url}${separator}id=${encodeURIComponent(payload)}`;

          const response = await axios.get(testUrl, {
            headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
            timeout: 5000,
            validateStatus: () => true,
          });

          const errorIndicators = ['sql', 'mysql', 'postgresql', 'syntax error', 'query failed'];
          const responseText = JSON.stringify(response.data).toLowerCase();

          if (errorIndicators.some((indicator) => responseText.includes(indicator))) {
            vulnerabilities.push({
              version: version.version,
              endpoint: version.url,
              type: 'sql-injection',
              severity: 'critical',
              description: `Potential SQL injection vulnerability in API version ${version.version}`,
              poc: testUrl,
              evidence: { payload, statusCode: response.status },
            });
            break;
          }
        } catch (error: any) {
          // Ignore
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test version downgrade attacks
   */
  private async testVersionDowngrade(
    versions: VersionEndpoint[],
    headers: Record<string, string>,
    cookies: Record<string, string>
  ): Promise<VersionVulnerability[]> {
    const vulnerabilities: VersionVulnerability[] = [];

    // Sort versions to identify older ones
    const sortedVersions = versions.sort((a, b) => {
      const versionA = parseFloat(a.version.replace(/[^\d.]/g, ''));
      const versionB = parseFloat(b.version.replace(/[^\d.]/g, ''));
      return versionA - versionB;
    });

    if (sortedVersions.length < 2) {
      return vulnerabilities; // Need at least 2 versions
    }

    const newestVersion = sortedVersions[sortedVersions.length - 1];
    const oldestVersion = sortedVersions[0];

    // Test: Can we downgrade from newest to oldest?
    try {
      // First, authenticate with newest version
      const authResponse = await axios.post(
        `${newestVersion.url}/login`,
        { username: 'test', password: 'test' },
        {
          headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
          timeout: 5000,
          validateStatus: () => true,
        }
      );

      // Try to use the token/session with oldest version
      if (authResponse.status === 200 || authResponse.status === 401) {
        const authHeader = authResponse.headers['authorization'] || authResponse.data?.token;

        if (authHeader) {
          const downgradeResponse = await axios.get(oldestVersion.url, {
            headers: {
              ...headers,
              Authorization: `Bearer ${authHeader}`,
              'User-Agent': 'AgentHunt-API-Scanner',
            },
            timeout: 5000,
            validateStatus: () => true,
          });

          if (downgradeResponse.status === 200) {
            vulnerabilities.push({
              version: oldestVersion.version,
              endpoint: oldestVersion.url,
              type: 'version-downgrade',
              severity: 'high',
              description: `Authentication tokens from ${newestVersion.version} work with older version ${oldestVersion.version}`,
              poc: `1. Authenticate with ${newestVersion.url}\n2. Use token with ${oldestVersion.url}\n3. Older version may have weaker security controls`,
              evidence: { newestVersion: newestVersion.version, oldestVersion: oldestVersion.version },
            });
          }
        }
      }
    } catch (error: any) {
      // Ignore
    }

    return vulnerabilities;
  }

  /**
   * Test version confusion exploits
   */
  private async testVersionConfusion(
    versions: VersionEndpoint[],
    headers: Record<string, string>,
    cookies: Record<string, string>
  ): Promise<VersionVulnerability[]> {
    const vulnerabilities: VersionVulnerability[] = [];

    if (versions.length < 2) {
      return vulnerabilities;
    }

    // Test: Mix version headers
    const pathVersion = versions.find((v) => v.method === 'path');
    const headerVersion = versions.find((v) => v.method === 'header');

    if (pathVersion && headerVersion && pathVersion.version !== headerVersion.version) {
      try {
        // Send request to v1 path with v2 header (or vice versa)
        const response = await axios.get(pathVersion.url, {
          headers: {
            ...headers,
            'API-Version': headerVersion.version,
            'User-Agent': 'AgentHunt-API-Scanner',
          },
          timeout: 5000,
          validateStatus: () => true,
        });

        if (response.status === 200) {
          vulnerabilities.push({
            version: 'mixed',
            endpoint: pathVersion.url,
            type: 'version-confusion',
            severity: 'medium',
            description: `API accepts mixed version indicators (path: ${pathVersion.version}, header: ${headerVersion.version})`,
            poc: `GET ${pathVersion.url}\nAPI-Version: ${headerVersion.version}`,
            evidence: { pathVersion: pathVersion.version, headerVersion: headerVersion.version },
          });
        }
      } catch (error: any) {
        // Ignore
      }
    }

    return vulnerabilities;
  }

  /**
   * Test deprecated endpoint security
   */
  private async testDeprecatedEndpoints(
    versions: VersionEndpoint[],
    headers: Record<string, string>,
    cookies: Record<string, string>
  ): Promise<VersionVulnerability[]> {
    const vulnerabilities: VersionVulnerability[] = [];

    const deprecatedVersions = versions.filter((v) => v.deprecated);

    for (const version of deprecatedVersions) {
      // Test 1: Check if deprecated endpoints still work
      try {
        const response = await axios.get(version.url, {
          headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
          timeout: 5000,
          validateStatus: () => true,
        });

        if (response.status === 200) {
          vulnerabilities.push({
            version: version.version,
            endpoint: version.url,
            type: 'deprecated-endpoint-active',
            severity: 'low',
            description: `Deprecated API version ${version.version} is still accessible`,
            evidence: { statusCode: response.status },
          });
        }
      } catch (error: any) {
        // Ignore
      }

      // Test 2: Check for missing security headers in deprecated versions
      try {
        const response = await axios.get(version.url, {
          headers: { ...headers, 'User-Agent': 'AgentHunt-API-Scanner' },
          timeout: 5000,
          validateStatus: () => true,
        });

        const securityHeaders = [
          'strict-transport-security',
          'x-content-type-options',
          'x-frame-options',
          'content-security-policy',
        ];

        const missingHeaders = securityHeaders.filter(
          (header) => !response.headers[header] && !response.headers[header.toLowerCase()]
        );

        if (missingHeaders.length > 0) {
          vulnerabilities.push({
            version: version.version,
            endpoint: version.url,
            type: 'missing-security-headers',
            severity: 'low',
            description: `Deprecated version ${version.version} missing security headers: ${missingHeaders.join(', ')}`,
            evidence: { missingHeaders },
          });
        }
      } catch (error: any) {
        // Ignore
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database and trigger handoffs
   */
  private async storeFindings(
    jobId: string,
    programId: string,
    vulnerabilities: VersionVulnerability[]
  ): Promise<number> {
    let storedCount = 0;

    for (const vuln of vulnerabilities) {
      try {
        await database.query(
          `INSERT INTO findings (
            job_id, program_id, title, description, severity,
            url, poc, metadata, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [
            jobId,
            programId,
            `API Versioning: ${vuln.type} in ${vuln.version}`,
            vuln.description,
            vuln.severity,
            vuln.endpoint,
            vuln.poc || null,
            JSON.stringify({
              agent: 'api-versioning',
              version: vuln.version,
              type: vuln.type,
              evidence: vuln.evidence,
            }),
          ]
        );
        storedCount++;

        // Trigger handoff to triage for critical/high findings
        if (vuln.severity === 'critical' || vuln.severity === 'high') {
          await this.triggerHandoff('triage', {
            reason: `API versioning ${vuln.type} detected in version ${vuln.version}`,
            context: {
              endpoint: vuln.endpoint,
              version: vuln.version,
              severity: vuln.severity,
              type: vuln.type,
              poc: vuln.poc,
            },
            priority: vuln.severity === 'critical' ? 'high' : 'medium',
          });
        }
      } catch (error: any) {
        logger.error({ error, vuln }, 'Failed to store API versioning finding');
      }
    }

    // Trigger handoff to confirm agent with all findings
    if (vulnerabilities.length > 0) {
      await this.triggerHandoff('confirm', {
        reason: `Found ${vulnerabilities.length} API versioning issues`,
        context: {
          totalFindings: vulnerabilities.length,
          critical: vulnerabilities.filter((v) => v.severity === 'critical').length,
          high: vulnerabilities.filter((v) => v.severity === 'high').length,
        },
        priority: 'low',
      });
    }

    return storedCount;
  }

  /**
   * Deduplicate discovered versions
   */
  private deduplicateVersions(versions: VersionEndpoint[]): VersionEndpoint[] {
    const seen = new Set<string>();
    return versions.filter((version) => {
      const key = `${version.version}-${version.method}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}
