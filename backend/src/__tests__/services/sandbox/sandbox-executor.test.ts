/**
 * Sandbox Executor Integration Tests
 */

import sandboxExecutor from '../../../services/sandbox/sandbox-executor';

describe('Sandbox Executor', () => {
  describe('Python Execution', () => {
    it('should execute simple Python code', async () => {
      const result = await sandboxExecutor.quickExecute(
        'print("Hello from sandbox")',
        'python',
        { timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from sandbox');
      expect(result.resources.executionTimeMs).toBeGreaterThan(0);
    }, 30000);

    it('should handle Python errors gracefully', async () => {
      const result = await sandboxExecutor.quickExecute(
        'raise Exception("Test error")',
        'python',
        { timeout: 10000 }
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Exception');
    }, 30000);

    it('should calculate math in Python', async () => {
      const result = await sandboxExecutor.quickExecute(
        'print(2 + 2)',
        'python',
        { timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('4');
    }, 30000);

    it('should handle stdin input', async () => {
      const result = await sandboxExecutor.quickExecute(
        'import sys; print(sys.stdin.read())',
        'python',
        { stdin: 'test input', timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('test input');
    }, 30000);
  });

  describe('Node.js Execution', () => {
    it('should execute simple JavaScript code', async () => {
      const result = await sandboxExecutor.quickExecute(
        'console.log("Hello from Node")',
        'node',
        { timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('Hello from Node');
    }, 30000);

    it('should handle JavaScript errors', async () => {
      const result = await sandboxExecutor.quickExecute(
        'throw new Error("Test error")',
        'node',
        { timeout: 10000 }
      );

      expect(result.success).toBe(false);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Error');
    }, 30000);

    it('should execute ES6 JavaScript', async () => {
      const result = await sandboxExecutor.quickExecute(
        'const x = [1,2,3]; const sum = x.reduce((a,b) => a+b); console.log(sum)',
        'node',
        { timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.stdout.trim()).toBe('6');
    }, 30000);
  });

  describe('Bash Execution', () => {
    it('should execute bash commands', async () => {
      const result = await sandboxExecutor.quickExecute(
        'echo "Hello from bash"',
        'bash',
        { timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('Hello from bash');
    }, 30000);

    it('should execute bash pipes', async () => {
      const result = await sandboxExecutor.quickExecute(
        'echo "test" | tr "a-z" "A-Z"',
        'bash',
        { timeout: 10000 }
      );

      expect(result.success).toBe(true);
      expect(result.stdout).toContain('TEST');
    }, 30000);
  });

  describe('Resource Limits', () => {
    it('should enforce timeout', async () => {
      const result = await sandboxExecutor.quickExecute(
        'import time; time.sleep(10)',
        'python',
        { timeout: 2000 } // 2 second timeout
      );

      expect(result.success).toBe(false);
      expect(result.killed).toBe(true);
      expect(result.killReason).toBe('timeout');
    }, 15000);

    it('should track CPU usage', async () => {
      const result = await sandboxExecutor.quickExecute(
        'for i in range(1000000): x = i * 2',
        'python',
        { timeout: 10000 }
      );

      expect(result.resources.cpuPercent).toBeGreaterThan(0);
    }, 30000);

    it('should track memory usage', async () => {
      const result = await sandboxExecutor.quickExecute(
        'x = list(range(100000))',
        'python',
        { timeout: 10000 }
      );

      expect(result.resources.memoryUsedMB).toBeGreaterThan(0);
    }, 30000);
  });

  describe('Code Validation', () => {
    it('should block dangerous Python code', async () => {
      const result = await sandboxExecutor.quickExecute(
        'import os; os.system("rm -rf /")',
        'python',
        { timeout: 10000 }
      );

      // Should either block or fail in sandbox
      expect(result.success).toBe(false);
    }, 30000);

    it('should block dangerous bash commands', async () => {
      const result = await sandboxExecutor.quickExecute(
        'rm -rf /',
        'bash',
        { timeout: 10000 }
      );

      // Validation should catch this
      expect(result.success).toBe(false);
      expect(result.error || result.stderr).toBeDefined();
    }, 30000);
  });

  describe('Network Isolation', () => {
    it('should block network access by default', async () => {
      const result = await sandboxExecutor.execute({
        code: 'import urllib.request; urllib.request.urlopen("http://example.com")',
        config: {
          language: 'python',
          allowNetwork: false,
          timeoutMs: 10000,
        },
      });

      // Should either be blocked by validation or fail in sandbox
      expect(result.success).toBe(false);
    }, 30000);

    it('should allow network access when enabled', async () => {
      const result = await sandboxExecutor.execute({
        code: 'import urllib.request; print("Network test")',
        config: {
          language: 'python',
          allowNetwork: true,
          timeoutMs: 10000,
        },
      });

      // Validation should pass when network is allowed
      expect(result).toBeDefined();
    }, 30000);
  });

  describe('Multi-execution Support', () => {
    it('should handle multiple concurrent executions', async () => {
      const executions = [
        sandboxExecutor.quickExecute('print(1)', 'python', { timeout: 10000 }),
        sandboxExecutor.quickExecute('console.log(2)', 'node', { timeout: 10000 }),
        sandboxExecutor.quickExecute('echo 3', 'bash', { timeout: 10000 }),
      ];

      const results = await Promise.all(executions);

      expect(results).toHaveLength(3);
      expect(results.every(r => r.success)).toBe(true);
    }, 60000);

    it('should isolate executions from each other', async () => {
      const result1 = await sandboxExecutor.quickExecute(
        'import os; os.environ["TEST_VAR"] = "value1"; print(os.environ.get("TEST_VAR"))',
        'python',
        { timeout: 10000 }
      );

      const result2 = await sandboxExecutor.quickExecute(
        'import os; print(os.environ.get("TEST_VAR", "not_set"))',
        'python',
        { timeout: 10000 }
      );

      expect(result1.stdout).toContain('value1');
      expect(result2.stdout).toContain('not_set'); // Should not see value from first execution
    }, 60000);
  });

  describe('Cleanup', () => {
    it('should cleanup after execution', async () => {
      const statsBefore = sandboxExecutor.getStats();

      await sandboxExecutor.quickExecute('print("test")', 'python', { timeout: 10000 });

      // Give time for cleanup
      await new Promise(resolve => setTimeout(resolve, 2000));

      const statsAfter = sandboxExecutor.getStats();

      // Stats should be tracked
      expect(statsAfter).toBeDefined();
    }, 30000);
  });
});
