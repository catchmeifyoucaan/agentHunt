/**
 * Advanced IDOR (Insecure Direct Object Reference) Agent
 * Purpose: Intelligent object ID enumeration and access control testing
 * 
 * Techniques:
 * - Sequential ID prediction (1, 2, 3...)
 * - UUID/GUID enumeration
 * - Base64 encoded IDs
 * - Hash-based IDs (pattern detection)
 * - GraphQL nested IDOR
 * - API endpoint IDOR (all HTTP methods)
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import config from '../config';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface IDORJob extends BaseJob {
  type: 'idor';
  options: {
    targetUrl: string;
    programId: string;
    idParameter: string;
    idType?: 'sequential' | 'uuid' | 'base64' | 'hash' | 'auto';
    knownIds?: string[];
    httpMethods?: string[];
    authToken?: string;
    testPrivilegeEscalation?: boolean;
    maxEnumerations?: number;
  };
}

interface IDORFinding {
  url: string;
  method: string;
  parameter: string;
  originalId: string;
  accessedId: string;
  idType: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  accessType: 'read' | 'write' | 'delete';
  dataExposed?: string;
  privilegeEscalation?: boolean;
}

export class IDORAgent extends BaseAgent<IDORJob> {
  private readonly UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  private readonly BASE64_PATTERN = /^[A-Za-z0-9+/]+=*$/;
  private readonly HASH_PATTERNS = {
    md5: /^[a-f0-9]{32}$/i,
    sha1: /^[a-f0-9]{40}$/i,
    sha256: /^[a-f0-9]{64}$/i,
  };

  constructor() {
    super('idor');
  }

  protected getSteps() {
    return [
      { name: 'Analyze ID format and type' },
      { name: 'Generate ID candidates' },
      { name: 'Test horizontal privilege escalation' },
      { name: 'Test vertical privilege escalation' },
      { name: 'Test all HTTP methods' },
      { name: 'Analyze and store findings' },
    ];
  }

  async process(job: Job<IDORJob>): Promise<any> {
    const { programId, options } = job.data;
    const {
      targetUrl,
      idParameter,
      idType = 'auto',
      knownIds = [],
      httpMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      authToken,
      testPrivilegeEscalation = true,
      maxEnumerations = 1000,
    } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const findings: IDORFinding[] = [];

    try {
      // Step 1: Analyze ID format
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'id-analyzer',
        toolStatus: 'running',
        message: 'Analyzing ID format',
      });

      const detectedIdType = idType === 'auto' 
        ? this.detectIdType(knownIds[0] || this.extractIdFromUrl(targetUrl, idParameter))
        : idType;

      logger.info({ detectedIdType, parameter: idParameter }, 'ID type detected');

      // Step 2: Generate ID candidates
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 25,
        currentTool: 'id-generator',
        toolStatus: 'running',
        message: `Generating ${detectedIdType} ID candidates`,
      });

      const idCandidates = this.generateIdCandidates(
        detectedIdType,
        knownIds,
        maxEnumerations
      );

      logger.info({ candidateCount: idCandidates.length }, 'Generated ID candidates');

      // Step 3: Test horizontal privilege escalation (accessing other users' data)
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 40,
        currentTool: 'horizontal-test',
        toolStatus: 'running',
        message: 'Testing horizontal privilege escalation',
      });

      const horizontalFindings = await this.testHorizontalIDOR(
        targetUrl,
        idParameter,
        idCandidates,
        httpMethods,
        authToken,
        job.id!,
        programId
      );
      findings.push(...horizontalFindings);

      // Step 4: Test vertical privilege escalation (accessing admin resources)
      if (testPrivilegeEscalation) {
        await this.updateJobProgress(job.id!, {
          current: 4,
          total: 6,
          percentage: 60,
          currentTool: 'vertical-test',
          toolStatus: 'running',
          message: 'Testing vertical privilege escalation',
        });

        const verticalFindings = await this.testVerticalIDOR(
          targetUrl,
          idParameter,
          authToken,
          job.id!,
          programId
        );
        findings.push(...verticalFindings);
      }

      // Step 5: Test all HTTP methods
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 75,
        currentTool: 'method-test',
        toolStatus: 'running',
        message: 'Testing all HTTP methods for IDOR',
      });

      const methodFindings = await this.testAllMethods(
        targetUrl,
        idParameter,
        idCandidates.slice(0, 10), // Test first 10 IDs with all methods
        httpMethods,
        authToken,
        job.id!,
        programId
      );
      findings.push(...methodFindings);

      // Step 6: Store findings
      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 90,
        currentTool: 'storage',
        toolStatus: 'running',
        message: 'Storing findings',
      });

      // Deduplicate findings
      const uniqueFindings = this.deduplicateFindings(findings);

      // Store in database
      for (const finding of uniqueFindings) {
        await this.storeFinding(programId, finding, job.id!);
      }

      // Trigger handoffs for critical findings
      if (uniqueFindings.some(f => f.severity === 'critical' || f.severity === 'high')) {
        await this.triggerHandoffs(programId, uniqueFindings, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Found ${uniqueFindings.length} IDOR vulnerabilities`,
      });

      const result = {
        targetUrl,
        idParameter,
        idType: detectedIdType,
        candidatesTested: idCandidates.length,
        findingsCount: uniqueFindings.length,
        criticalCount: uniqueFindings.filter(f => f.severity === 'critical').length,
        highCount: uniqueFindings.filter(f => f.severity === 'high').length,
        findings: uniqueFindings,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error, targetUrl }, 'IDOR testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Detect the type of ID being used
   */
  private detectIdType(id: string): 'sequential' | 'uuid' | 'base64' | 'hash' | 'unknown' {
    if (!id) return 'sequential';

    // Check for UUID
    if (this.UUID_PATTERN.test(id)) {
      return 'uuid';
    }

    // Check for hash patterns
    for (const [hashType, pattern] of Object.entries(this.HASH_PATTERNS)) {
      if (pattern.test(id)) {
        return 'hash';
      }
    }

    // Check for Base64
    if (this.BASE64_PATTERN.test(id) && id.length > 10) {
      try {
        const decoded = Buffer.from(id, 'base64').toString();
        if (decoded && decoded.length > 0) {
          return 'base64';
        }
      } catch {}
    }

    // Check for sequential (numeric)
    if (/^\d+$/.test(id)) {
      return 'sequential';
    }

    return 'unknown';
  }

  /**
   * Extract ID from URL based on parameter name
   */
  private extractIdFromUrl(url: string, parameter: string): string {
    try {
      const urlObj = new URL(url);
      
      // Check query parameters
      const queryId = urlObj.searchParams.get(parameter);
      if (queryId) return queryId;

      // Check path parameters (e.g., /users/123)
      const pathMatch = url.match(new RegExp(`/${parameter}/([^/]+)`));
      if (pathMatch) return pathMatch[1];

      // Check for common patterns like /api/users/123
      const numericMatch = url.match(/\/(\d+)(?:\/|$|\?)/);
      if (numericMatch) return numericMatch[1];

      return '';
    } catch {
      return '';
    }
  }

  /**
   * Generate ID candidates based on type
   */
  private generateIdCandidates(
    idType: string,
    knownIds: string[],
    maxCount: number
  ): string[] {
    const candidates: string[] = [];

    switch (idType) {
      case 'sequential':
        // Generate sequential IDs around known IDs
        if (knownIds.length > 0) {
          const numericIds = knownIds.map(id => parseInt(id, 10)).filter(n => !isNaN(n));
          const baseId = Math.min(...numericIds);
          
          // Generate IDs before and after
          for (let i = Math.max(1, baseId - 100); i < baseId + maxCount; i++) {
            candidates.push(i.toString());
          }
        } else {
          // Start from 1
          for (let i = 1; i <= maxCount; i++) {
            candidates.push(i.toString());
          }
        }
        break;

      case 'uuid':
        // For UUIDs, we can try:
        // 1. Increment last segment
        // 2. Common test UUIDs
        // 3. Null UUID
        candidates.push('00000000-0000-0000-0000-000000000000');
        candidates.push('00000000-0000-0000-0000-000000000001');
        candidates.push('11111111-1111-1111-1111-111111111111');
        candidates.push('ffffffff-ffff-ffff-ffff-ffffffffffff');
        
        // Generate variations of known UUIDs
        for (const knownId of knownIds) {
          if (this.UUID_PATTERN.test(knownId)) {
            const parts = knownId.split('-');
            const lastPart = parseInt(parts[4], 16);
            for (let i = 0; i < 100; i++) {
              const newLast = (lastPart + i).toString(16).padStart(12, '0');
              candidates.push(`${parts[0]}-${parts[1]}-${parts[2]}-${parts[3]}-${newLast}`);
            }
          }
        }
        break;

      case 'base64':
        // Decode known IDs, modify, re-encode
        for (const knownId of knownIds) {
          try {
            const decoded = Buffer.from(knownId, 'base64').toString();
            // Try numeric increments
            const numMatch = decoded.match(/(\d+)/);
            if (numMatch) {
              const num = parseInt(numMatch[1], 10);
              for (let i = 0; i < 100; i++) {
                const modified = decoded.replace(numMatch[1], (num + i).toString());
                candidates.push(Buffer.from(modified).toString('base64'));
              }
            }
          } catch {}
        }
        break;

      case 'hash':
        // For hashes, we can't easily enumerate
        // But we can try common patterns
        candidates.push('0'.repeat(32)); // MD5 of empty
        candidates.push('d41d8cd98f00b204e9800998ecf8427e'); // MD5 of empty string
        candidates.push('da39a3ee5e6b4b0d3255bfef95601890afd80709'); // SHA1 of empty
        break;

      default:
        // Try sequential as fallback
        for (let i = 1; i <= Math.min(maxCount, 100); i++) {
          candidates.push(i.toString());
        }
    }

    return [...new Set(candidates)].slice(0, maxCount);
  }

  /**
   * Test for horizontal IDOR (accessing other users' resources)
   */
  private async testHorizontalIDOR(
    targetUrl: string,
    idParameter: string,
    idCandidates: string[],
    methods: string[],
    authToken: string | undefined,
    jobId: string,
    programId: string
  ): Promise<IDORFinding[]> {
    const findings: IDORFinding[] = [];
    const batchSize = 50;

    for (let i = 0; i < idCandidates.length; i += batchSize) {
      const batch = idCandidates.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(id => this.testIdAccess(targetUrl, idParameter, id, 'GET', authToken))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled' && result.value.accessible) {
          findings.push({
            url: targetUrl,
            method: 'GET',
            parameter: idParameter,
            originalId: 'unknown',
            accessedId: batch[j],
            idType: this.detectIdType(batch[j]),
            severity: result.value.sensitiveData ? 'critical' : 'high',
            accessType: 'read',
            dataExposed: result.value.dataPreview,
            privilegeEscalation: false,
          });
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    return findings;
  }

  /**
   * Test for vertical IDOR (privilege escalation)
   */
  private async testVerticalIDOR(
    targetUrl: string,
    idParameter: string,
    authToken: string | undefined,
    jobId: string,
    programId: string
  ): Promise<IDORFinding[]> {
    const findings: IDORFinding[] = [];

    // Common admin/privileged IDs to test
    const privilegedIds = [
      '1', '0', 'admin', 'root', 'administrator',
      '00000000-0000-0000-0000-000000000001',
      'system', 'superuser', 'owner',
    ];

    for (const id of privilegedIds) {
      const result = await this.testIdAccess(targetUrl, idParameter, id, 'GET', authToken);
      
      if (result.accessible) {
        findings.push({
          url: targetUrl,
          method: 'GET',
          parameter: idParameter,
          originalId: 'user',
          accessedId: id,
          idType: this.detectIdType(id),
          severity: 'critical',
          accessType: 'read',
          dataExposed: result.dataPreview,
          privilegeEscalation: true,
        });
      }
    }

    return findings;
  }

  /**
   * Test all HTTP methods for IDOR
   */
  private async testAllMethods(
    targetUrl: string,
    idParameter: string,
    idCandidates: string[],
    methods: string[],
    authToken: string | undefined,
    jobId: string,
    programId: string
  ): Promise<IDORFinding[]> {
    const findings: IDORFinding[] = [];

    for (const method of methods) {
      if (method === 'GET') continue; // Already tested

      for (const id of idCandidates) {
        const result = await this.testIdAccess(targetUrl, idParameter, id, method, authToken);
        
        if (result.accessible) {
          const accessType = method === 'DELETE' ? 'delete' : 
                            ['POST', 'PUT', 'PATCH'].includes(method) ? 'write' : 'read';
          
          findings.push({
            url: targetUrl,
            method,
            parameter: idParameter,
            originalId: 'unknown',
            accessedId: id,
            idType: this.detectIdType(id),
            severity: accessType === 'delete' ? 'critical' : 
                     accessType === 'write' ? 'high' : 'medium',
            accessType,
            dataExposed: result.dataPreview,
            privilegeEscalation: false,
          });
        }
      }
    }

    return findings;
  }

  /**
   * Test if an ID is accessible
   */
  private async testIdAccess(
    targetUrl: string,
    idParameter: string,
    testId: string,
    method: string,
    authToken?: string
  ): Promise<{ accessible: boolean; sensitiveData: boolean; dataPreview?: string }> {
    try {
      // Build URL with test ID
      const url = this.buildUrlWithId(targetUrl, idParameter, testId);

      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json, text/html, */*',
      };

      if (authToken) {
        headers['Authorization'] = `Bearer ${authToken}`;
      }

      const response = await fetch(url, {
        method,
        headers,
        body: ['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined,
      });

      // Check for successful access
      if (response.status >= 200 && response.status < 300) {
        const text = await response.text();
        
        // Check for sensitive data patterns
        const sensitivePatterns = [
          /password/i,
          /secret/i,
          /api[_-]?key/i,
          /token/i,
          /credit[_-]?card/i,
          /ssn/i,
          /social[_-]?security/i,
          /email/i,
          /phone/i,
          /address/i,
        ];

        const sensitiveData = sensitivePatterns.some(p => p.test(text));
        const dataPreview = text.substring(0, 200);

        return { accessible: true, sensitiveData, dataPreview };
      }

      return { accessible: false, sensitiveData: false };
    } catch (error) {
      return { accessible: false, sensitiveData: false };
    }
  }

  /**
   * Build URL with test ID
   */
  private buildUrlWithId(baseUrl: string, parameter: string, id: string): string {
    try {
      const url = new URL(baseUrl);

      // Check if parameter is in query string
      if (url.searchParams.has(parameter)) {
        url.searchParams.set(parameter, id);
        return url.toString();
      }

      // Check if parameter is in path
      const pathPattern = new RegExp(`(/${parameter}/)([^/]+)`);
      if (pathPattern.test(url.pathname)) {
        url.pathname = url.pathname.replace(pathPattern, `$1${id}`);
        return url.toString();
      }

      // Try replacing numeric path segments
      const numericPattern = /\/(\d+)(\/|$)/;
      if (numericPattern.test(url.pathname)) {
        url.pathname = url.pathname.replace(numericPattern, `/${id}$2`);
        return url.toString();
      }

      // Fallback: add as query parameter
      url.searchParams.set(parameter, id);
      return url.toString();
    } catch {
      return baseUrl;
    }
  }

  /**
   * Deduplicate findings
   */
  private deduplicateFindings(findings: IDORFinding[]): IDORFinding[] {
    const seen = new Set<string>();
    return findings.filter(f => {
      const key = `${f.url}:${f.method}:${f.parameter}:${f.accessedId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Store finding in database
   */
  private async storeFinding(programId: string, finding: IDORFinding, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO findings (id, program_id, job_id, type, severity, title, url, description, evidence, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'new', CURRENT_TIMESTAMP)
         ON CONFLICT (id) DO NOTHING`,
        [
          uuidv4(),
          programId,
          jobId,
          'idor',
          finding.severity,
          `IDOR: ${finding.accessType.toUpperCase()} access via ${finding.parameter}`,
          finding.url,
          `Insecure Direct Object Reference found. Able to ${finding.accessType} resource with ID ${finding.accessedId} using ${finding.method} method.${finding.privilegeEscalation ? ' This appears to be a privilege escalation vulnerability.' : ''}`,
          JSON.stringify(finding),
        ]
      );
    } catch (error) {
      logger.error({ error, finding }, 'Failed to save IDOR finding');
    }
  }

  /**
   * Trigger handoffs for critical findings
   */
  private async triggerHandoffs(programId: string, findings: IDORFinding[], jobId: string): Promise<void> {
    const criticalFindings = findings.filter(f => f.severity === 'critical');
    
    if (criticalFindings.length > 0) {
      await this.handoff('triage', {
        toAgent: 'triage',
        reason: `Found ${criticalFindings.length} critical IDOR vulnerabilities requiring immediate triage`,
        data: {
          findings: criticalFindings,
          urgency: 'high',
        },
        priority: 9,
        metadata: {
          programId,
          parentJobId: jobId,
          source: 'idor',
        },
      });
    }
  }
}

export default new IDORAgent();
