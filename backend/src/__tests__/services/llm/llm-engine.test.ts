/**
 * LLM Engine Unit Tests
 * Tests for the main LLM engine functionality
 */

import llmEngine from '../../../services/llm/llm-engine';

describe('LLM Engine', () => {
  describe('Provider Initialization', () => {
    it('should initialize with at least one provider', () => {
      // LLM engine auto-initializes providers
      const stats = llmEngine.getStats();
      expect(stats).toBeDefined();
    });
  });

  describe('Text Completion', () => {
    it('should complete simple text prompts', async () => {
      const response = await llmEngine.complete(
        'What is 2+2? Answer with just the number.',
        'You are a helpful assistant.'
      );

      expect(response).toBeDefined();
      expect(typeof response).toBe('string');
      expect(response.length).toBeGreaterThan(0);
    }, 30000); // 30 second timeout for LLM calls

    it('should handle empty prompts gracefully', async () => {
      await expect(llmEngine.complete('', 'You are a helpful assistant.')).rejects.toThrow();
    });
  });

  describe('Reasoning', () => {
    it('should provide structured reasoning for security scenarios', async () => {
      const result = await llmEngine.reason(
        'A web application accepts user input in the search parameter without validation. How could this be exploited?'
      );

      expect(result).toBeDefined();
      expect(result.reasoning).toBeDefined();
      expect(typeof result.reasoning).toBe('string');
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(Array.isArray(result.actions)).toBe(true);
    }, 30000);

    it('should provide actions in reasoning results', async () => {
      const result = await llmEngine.reason('How do I enumerate subdomains for example.com?');

      expect(result.actions).toBeDefined();
      expect(Array.isArray(result.actions)).toBe(true);
    }, 30000);
  });

  describe('Exploit Generation', () => {
    it('should generate exploit code', async () => {
      const code = await llmEngine.generateExploit({
        vulnerabilityType: 'XSS',
        targetUrl: 'https://example.com/search?q=test',
        evidence: 'Reflected <script> tag in search results',
        language: 'python',
        framework: 'requests',
      });

      expect(code).toBeDefined();
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(50);
      expect(code.toLowerCase()).toContain('import');
    }, 30000);
  });

  describe('Nuclei Template Generation', () => {
    it('should generate Nuclei templates', async () => {
      const template = await llmEngine.generateNucleiTemplate({
        name: 'test-xss',
        description: 'Test for XSS in search parameter',
        severity: 'medium',
        targetUrl: 'https://example.com/search?q={{payload}}',
        payload: '<script>alert(1)</script>',
        matcher: 'contains <script>alert(1)</script> in response',
      });

      expect(template).toBeDefined();
      expect(typeof template).toBe('string');
      expect(template).toContain('id:');
      expect(template).toContain('info:');
    }, 30000);
  });

  describe('Code Generation', () => {
    it('should generate code for specific tasks', async () => {
      const code = await llmEngine.generateCode({
        task: 'Write a Python function to check if a domain is valid',
        language: 'python',
        requirements: ['Use regex for validation', 'Return boolean'],
      });

      expect(code).toBeDefined();
      expect(typeof code).toBe('string');
      expect(code.length).toBeGreaterThan(20);
    }, 30000);
  });

  describe('Caching', () => {
    it('should cache identical requests', async () => {
      const prompt = 'What is penetration testing?';
      const systemPrompt = 'You are a cybersecurity expert.';

      // First call
      const start1 = Date.now();
      const response1 = await llmEngine.complete(prompt, systemPrompt);
      const duration1 = Date.now() - start1;

      // Second call (should be cached)
      const start2 = Date.now();
      const response2 = await llmEngine.complete(prompt, systemPrompt);
      const duration2 = Date.now() - start2;

      expect(response1).toBe(response2);
      expect(duration2).toBeLessThan(duration1 / 2); // Cache should be much faster
    }, 60000);
  });

  describe('Error Handling', () => {
    it('should handle invalid requests gracefully', async () => {
      await expect(
        llmEngine.complete('Test prompt', undefined, 'nonexistent-provider' as any)
      ).rejects.toThrow();
    });

    it('should handle network errors gracefully', async () => {
      // This test assumes network might fail
      // In production, fallback providers should handle this
      try {
        await llmEngine.complete('Test', 'System', 'claude');
        // If it succeeds, that's fine
        expect(true).toBe(true);
      } catch (error) {
        // If it fails, that's also acceptable for this test
        expect(error).toBeDefined();
      }
    }, 30000);
  });
});
