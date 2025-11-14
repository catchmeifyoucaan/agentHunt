/**
 * Code Validator - Validates code safety before sandbox execution
 * Detects potentially dangerous operations and assesses risk
 */

import { CodeValidationResult, SandboxLanguage } from './types';
import logger from '../../utils/logger';

export class CodeValidator {
  /**
   * Validate code before execution
   */
  validate(code: string, language: SandboxLanguage, allowNetwork: boolean = false): CodeValidationResult {
    const result: CodeValidationResult = {
      safe: true,
      errors: [],
      warnings: [],
      detectedImports: [],
      detectedSyscalls: [],
      detectedNetworkCalls: [],
      detectedFileOps: [],
      riskLevel: 'low',
      riskReasons: [],
    };

    // Language-specific validation
    switch (language) {
      case 'python':
        this.validatePython(code, result, allowNetwork);
        break;
      case 'node':
        this.validateNode(code, result, allowNetwork);
        break;
      case 'go':
        this.validateGo(code, result, allowNetwork);
        break;
      case 'bash':
        this.validateBash(code, result, allowNetwork);
        break;
      case 'ruby':
        this.validateRuby(code, result, allowNetwork);
        break;
    }

    // Calculate risk level
    this.assessRisk(result);

    // Determine if safe to execute
    result.safe = result.riskLevel !== 'critical' && result.errors.length === 0;

    logger.debug({ language, riskLevel: result.riskLevel, safe: result.safe }, 'Code validation completed');

    return result;
  }

  /**
   * Validate Python code
   */
  private validatePython(code: string, result: CodeValidationResult, allowNetwork: boolean): void {
    // Dangerous imports
    const dangerousImports = [
      'os.system',
      'subprocess.call',
      'subprocess.run',
      'subprocess.Popen',
      'eval(',
      'exec(',
      '__import__',
      'compile(',
      'open(',
      'file(',
    ];

    dangerousImports.forEach(pattern => {
      if (code.includes(pattern)) {
        result.detectedSyscalls!.push(pattern);
        result.warnings.push(`Potentially dangerous operation detected: ${pattern}`);
      }
    });

    // Network imports
    const networkImports = ['requests', 'urllib', 'http.client', 'socket', 'ftplib', 'smtplib'];
    networkImports.forEach(imp => {
      if (new RegExp(`import\\s+${imp}|from\\s+${imp}`).test(code)) {
        result.detectedNetworkCalls!.push(imp);
        if (!allowNetwork) {
          result.errors.push(`Network access not allowed, but detected: ${imp}`);
        }
      }
    });

    // File operations
    const fileOps = [/open\s*\(/g, /with\s+open/g, /file\s*\(/g];
    fileOps.forEach(pattern => {
      if (pattern.test(code)) {
        result.detectedFileOps!.push(pattern.source);
        result.warnings.push('File operations detected');
      }
    });

    // Dangerous patterns
    if (code.includes('pickle.loads')) {
      result.errors.push('Pickle deserialization is not allowed (arbitrary code execution risk)');
      result.riskLevel = 'critical';
    }

    if (code.includes('__builtins__')) {
      result.errors.push('Access to __builtins__ is not allowed');
      result.riskLevel = 'high';
    }
  }

  /**
   * Validate Node.js code
   */
  private validateNode(code: string, result: CodeValidationResult, allowNetwork: boolean): void {
    // Dangerous requires
    const dangerousRequires = [
      'child_process',
      'fs',
      'process.exec',
      'eval(',
      'Function(',
      'vm.runInNewContext',
      'vm.runInThisContext',
    ];

    dangerousRequires.forEach(pattern => {
      if (code.includes(pattern)) {
        result.detectedSyscalls!.push(pattern);
        result.warnings.push(`Potentially dangerous operation detected: ${pattern}`);
      }
    });

    // Network requires
    const networkRequires = ['http', 'https', 'net', 'axios', 'fetch', 'request'];
    networkRequires.forEach(req => {
      if (new RegExp(`require\\s*\\(\\s*['"\`]${req}['"\`]\\s*\\)`).test(code)) {
        result.detectedNetworkCalls!.push(req);
        if (!allowNetwork) {
          result.errors.push(`Network access not allowed, but detected: ${req}`);
        }
      }
    });

    // File operations
    if (code.includes('require') && code.includes('fs')) {
      result.detectedFileOps!.push('fs module');
      result.warnings.push('File operations detected (fs module)');
    }

    // Dangerous patterns
    if (/require\s*\(\s*process\.env/.test(code)) {
      result.warnings.push('Dynamic require from env variable detected');
      result.riskLevel = 'medium';
    }
  }

  /**
   * Validate Go code
   */
  private validateGo(code: string, result: CodeValidationResult, allowNetwork: boolean): void {
    // Dangerous imports
    const dangerousImports = [
      'os/exec',
      'syscall',
      'unsafe',
    ];

    dangerousImports.forEach(imp => {
      if (new RegExp(`import\\s+["']${imp}["']|\\s+["']${imp}["']\\s+`).test(code)) {
        result.detectedSyscalls!.push(imp);
        result.warnings.push(`Potentially dangerous import detected: ${imp}`);
      }
    });

    // Network imports
    const networkImports = ['net', 'net/http', 'net/url'];
    networkImports.forEach(imp => {
      if (new RegExp(`import\\s+["']${imp}["']`).test(code)) {
        result.detectedNetworkCalls!.push(imp);
        if (!allowNetwork) {
          result.errors.push(`Network access not allowed, but detected: ${imp}`);
        }
      }
    });

    // File operations
    if (code.includes('os.Open') || code.includes('os.Create') || code.includes('ioutil.')) {
      result.detectedFileOps!.push('File I/O operations');
      result.warnings.push('File operations detected');
    }
  }

  /**
   * Validate Bash code
   */
  private validateBash(code: string, result: CodeValidationResult, allowNetwork: boolean): void {
    // Dangerous commands
    const dangerousCommands = [
      'rm -rf /',
      'dd if=',
      'mkfs',
      'fork bomb',
      ':(){ :|:& };:',
    ];

    dangerousCommands.forEach(cmd => {
      if (code.includes(cmd)) {
        result.errors.push(`Dangerous bash command detected: ${cmd}`);
        result.riskLevel = 'critical';
      }
    });

    // Network commands
    const networkCommands = ['curl', 'wget', 'nc ', 'netcat', 'ftp', 'ssh', 'telnet'];
    networkCommands.forEach(cmd => {
      if (new RegExp(`\\b${cmd}\\b`).test(code)) {
        result.detectedNetworkCalls!.push(cmd);
        if (!allowNetwork) {
          result.errors.push(`Network access not allowed, but detected: ${cmd}`);
        }
      }
    });

    // Command injection patterns
    if (/\$\(.*\)/.test(code) || /`.*`/.test(code)) {
      result.warnings.push('Command substitution detected');
    }

    // Privilege escalation
    if (/\bsudo\b|\bsu\b/.test(code)) {
      result.errors.push('Privilege escalation not allowed (sudo/su)');
      result.riskLevel = 'high';
    }
  }

  /**
   * Validate Ruby code
   */
  private validateRuby(code: string, result: CodeValidationResult, allowNetwork: boolean): void {
    // Dangerous methods
    const dangerousMethods = [
      'system(',
      'exec(',
      '`',
      'eval(',
      'instance_eval',
      'class_eval',
      'module_eval',
    ];

    dangerousMethods.forEach(method => {
      if (code.includes(method)) {
        result.detectedSyscalls!.push(method);
        result.warnings.push(`Potentially dangerous operation detected: ${method}`);
      }
    });

    // Network requires
    const networkRequires = ['net/http', 'net/https', 'socket', 'open-uri'];
    networkRequires.forEach(req => {
      if (new RegExp(`require\\s+['"]${req}['"]`).test(code)) {
        result.detectedNetworkCalls!.push(req);
        if (!allowNetwork) {
          result.errors.push(`Network access not allowed, but detected: ${req}`);
        }
      }
    });

    // File operations
    if (/File\.(open|read|write)|IO\.(open|read|write)/.test(code)) {
      result.detectedFileOps!.push('File I/O');
      result.warnings.push('File operations detected');
    }
  }

  /**
   * Assess overall risk level based on findings
   */
  private assessRisk(result: CodeValidationResult): void {
    let riskScore = 0;

    // Count findings
    if (result.errors.length > 0) riskScore += result.errors.length * 10;
    if (result.warnings.length > 0) riskScore += result.warnings.length * 3;
    if (result.detectedSyscalls && result.detectedSyscalls.length > 0) riskScore += result.detectedSyscalls.length * 5;
    if (result.detectedNetworkCalls && result.detectedNetworkCalls.length > 0) riskScore += result.detectedNetworkCalls.length * 2;
    if (result.detectedFileOps && result.detectedFileOps.length > 0) riskScore += result.detectedFileOps.length * 2;

    // Already set to critical?
    if (result.riskLevel === 'critical') {
      result.riskReasons.push('Critical security violation detected');
      return;
    }

    // Calculate risk level from score
    if (riskScore >= 30) {
      result.riskLevel = 'critical';
      result.riskReasons.push(`High risk score: ${riskScore}`);
    } else if (riskScore >= 20) {
      result.riskLevel = 'high';
      result.riskReasons.push(`Elevated risk score: ${riskScore}`);
    } else if (riskScore >= 10) {
      result.riskLevel = 'medium';
      result.riskReasons.push(`Moderate risk score: ${riskScore}`);
    } else {
      result.riskLevel = 'low';
      result.riskReasons.push(`Low risk score: ${riskScore}`);
    }
  }

  /**
   * Quick check if code appears safe (fast path)
   */
  isSafe(code: string, language: SandboxLanguage): boolean {
    const result = this.validate(code, language);
    return result.safe;
  }
}

export default new CodeValidator();
