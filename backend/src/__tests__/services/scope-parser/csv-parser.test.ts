/**
 * CSV Scope Parser Unit Tests
 */

import { CSVParser } from '../../../services/scope-parser/parsers/csv';

describe('CSV Scope Parser', () => {
  const parser = new CSVParser();

  describe('Basic Parsing', () => {
    it('should parse domains from CSV', async () => {
      const csvContent = `type,value,priority,notes
domain,example.com,high,Main target
domain,api.example.com,high,API endpoint
subdomain,*.example.com,medium,All subdomains`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.domains).toContain('example.com');
      expect(result.domains).toContain('api.example.com');
      expect(result.wildcardDomains).toContain('*.example.com');
    });

    it('should parse IP ranges from CSV', async () => {
      const csvContent = `type,value,priority,notes
ip_range,192.168.1.0/24,medium,Internal network
ip,10.0.0.1,low,Single IP`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.ipRanges).toContain('192.168.1.0/24');
      expect(result.ips).toContain('10.0.0.1');
    });

    it('should parse exclusions from CSV', async () => {
      const csvContent = `type,value,priority,notes
domain,example.com,high,In scope
exclude,example.com/admin,,,Admin panel out of scope
exclude,example.com/logout,,,Logout out of scope`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.excludedDomains.length).toBeGreaterThan(0);
      expect(result.excludedDomains.some(e => e.includes('admin') || e.includes('logout'))).toBe(true);
    });
  });

  describe('Constraints', () => {
    it('should parse no_dos constraint', async () => {
      const csvContent = `type,value,priority,notes,constraint_details
constraint,no_dos,,,,`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.constraints.noDoS).toBe(true);
    });

    it('should parse rate limit constraint', async () => {
      const csvContent = `type,value,priority,notes,constraint_details
constraint,rate_limit,,,,100`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.constraints.maxRateLimit).toBe(100);
    });

    it('should parse testing window constraint', async () => {
      const csvContent = `type,value,priority,notes,constraint_details
constraint,testing_window,,,,09:00-17:00`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.constraints.testingWindow).toBeDefined();
      expect(result.constraints.testingWindow?.start).toBe('09:00');
      expect(result.constraints.testingWindow?.end).toBe('17:00');
    });
  });

  describe('Credentials', () => {
    it('should parse API key credentials', async () => {
      const csvContent = `type,value,priority,notes,constraint_details
credential,api_key,Bearer abc123,,,`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.credentials['api_key']).toBeDefined();
      expect(result.credentials['api_key'].type).toBe('bearer');
      expect(result.credentials['api_key'].value).toBe('abc123');
    });

    it('should parse login credentials', async () => {
      const csvContent = `type,value,priority,notes,constraint_details
credential,admin_login,username:admin password:test123,,,`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.credentials['admin_login']).toBeDefined();
      expect(result.credentials['admin_login'].type).toBe('login');
    });
  });

  describe('Priorities and Deliverables', () => {
    it('should parse priority targets', async () => {
      const csvContent = `type,value,priority,notes
priority,Payment endpoints,critical,
priority,User authentication,high,`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.priorities).toContain('Payment endpoints');
      expect(result.priorities).toContain('User authentication');
    });

    it('should parse deliverables', async () => {
      const csvContent = `type,value,priority,notes
deliverable,Full penetration test report,,,
deliverable,Executive summary,,,
deliverable,Remediation recommendations,,,`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      expect(result.deliverables).toContain('Full penetration test report');
      expect(result.deliverables).toContain('Executive summary');
      expect(result.deliverables).toContain('Remediation recommendations');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed CSV gracefully', async () => {
      const csvContent = `this is not valid CSV
no headers here
just random text`;

      const buffer = Buffer.from(csvContent, 'utf-8');

      // Should not throw, might return empty or partial results
      const result = await parser.parse(buffer);
      expect(result).toBeDefined();
    });

    it('should handle empty CSV', async () => {
      const buffer = Buffer.from('', 'utf-8');

      const result = await parser.parse(buffer);
      expect(result).toBeDefined();
      expect(result.domains).toEqual([]);
    });

    it('should handle CSV with headers only', async () => {
      const csvContent = `type,value,priority,notes`;
      const buffer = Buffer.from(csvContent, 'utf-8');

      const result = await parser.parse(buffer);
      expect(result).toBeDefined();
      expect(result.domains).toEqual([]);
    });
  });

  describe('Complex Scenarios', () => {
    it('should parse comprehensive scope document', async () => {
      const csvContent = `type,value,priority,notes,constraint_details
domain,example.com,high,Main production site,
domain,api.example.com,high,API endpoints,
subdomain,*.staging.example.com,medium,Staging environments,
ip_range,192.168.1.0/24,medium,Internal network,
exclude,example.com/admin,,,Admin panel excluded
exclude,example.com/logout,,,Logout excluded
constraint,no_dos,,,,
constraint,rate_limit,,,,100
constraint,testing_window,,,,09:00-17:00
credential,api_key,Bearer abc123xyz,,,
credential,admin_login,username:admin password:test123,,,
priority,Payment processing,critical,High value target
priority,User authentication,high,Critical functionality
deliverable,Full penetration test report,,,
deliverable,Executive summary,,,
deliverable,Nuclei templates for findings,,,`;

      const buffer = Buffer.from(csvContent, 'utf-8');
      const result = await parser.parse(buffer);

      // Domains
      expect(result.domains).toContain('example.com');
      expect(result.domains).toContain('api.example.com');

      // Wildcards
      expect(result.wildcardDomains).toContain('*.staging.example.com');

      // IP ranges
      expect(result.ipRanges).toContain('192.168.1.0/24');

      // Exclusions
      expect(result.excludedDomains.length).toBeGreaterThan(0);

      // Constraints
      expect(result.constraints.noDoS).toBe(true);
      expect(result.constraints.maxRateLimit).toBe(100);
      expect(result.constraints.testingWindow).toBeDefined();

      // Credentials
      expect(Object.keys(result.credentials).length).toBeGreaterThan(0);

      // Priorities
      expect(result.priorities.length).toBeGreaterThan(0);

      // Deliverables
      expect(result.deliverables.length).toBeGreaterThan(0);

      // Confidence should be high for well-structured CSV
      expect(result.confidence).toBeGreaterThan(0.7);
    });
  });
});
