/**
 * Discovery Agent Unit Tests
 * Target: 80%+ code coverage
 */

// Mock dependencies FIRST before any imports
jest.mock('../../utils/logger', () => ({
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    })),
  },
}));

jest.mock('../../config', () => ({
  default: {
    database: { url: 'test', poolMin: 1, poolMax: 5 },
    redis: { host: 'localhost', port: 6379, password: '' },
    llm: { provider: 'anthropic', model: 'claude' },
    s3: {
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'test-bucket',
      accessKey: 'test-key',
      secretKey: 'test-secret',
    },
    telegram: {
      botToken: '',
      chatId: '',
    },
    server: {
      port: 3000,
      env: 'test',
    },
  },
}));

jest.mock('../../services/database', () => ({
  default: {
    query: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
  },
}));

jest.mock('../../services/knowledge/knowledge-store');
jest.mock('../../services/three-agent/shared-memory');
jest.mock('../../utils/batch-insert');
jest.mock('../../services/storage', () => ({
  default: {
    uploadFile: jest.fn(),
    getFile: jest.fn(),
    deleteFile: jest.fn(),
  },
}));

jest.mock('../../services/rate-limiter', () => ({
  default: {
    checkLimit: jest.fn().mockResolvedValue(true),
    increment: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    quit: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
  }));
});

import { Job } from 'bullmq';
import { DiscoveryAgent } from '../../agents/discovery';
import { DiscoveryJob } from '../../../../shared/types';
import database from '../../services/database';
import { mockRedis, mockBullMQQueue } from '../../../tests/utils/redis-helper';
import { mockDatabase } from '../../../tests/utils/db-helper';

describe('DiscoveryAgent', () => {
  let agent: DiscoveryAgent;
  let mockJob: Job<DiscoveryJob>;
  let mockDb: any;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create agent instance
    agent = new DiscoveryAgent();

    // Mock database
    mockDb = mockDatabase();
    (database.query as jest.Mock) = mockDb.query;

    // Mock job
    mockJob = {
      id: 'test-job-123',
      data: {
        programId: 'test-program-456',
        options: {
          sources: ['chaosdb', 'subfinder'],
          maxAssets: 1000,
        },
      },
      progress: jest.fn(),
      log: jest.fn(),
      updateProgress: jest.fn(),
    } as any;
  });

  describe('Constructor and Initialization', () => {
    it('should create agent with correct name', () => {
      expect(agent).toBeInstanceOf(DiscoveryAgent);
      expect((agent as any).agentName).toBe('discovery');
    });

    it('should have correct steps defined', () => {
      const steps = (agent as any).getSteps();
      expect(steps).toHaveLength(4);
      expect(steps[0].name).toBe('Load domains and scope');
      expect(steps[1].name).toBe('Parallel subdomain discovery across all sources');
      expect(steps[2].name).toBe('Batch process and deduplicate results');
      expect(steps[3].name).toBe('Store results and trigger fingerprinting');
    });
  });

  describe('process() - Main Workflow', () => {
    beforeEach(() => {
      // Mock database query for program scope
      mockDb.query.mockResolvedValue({
        rows: [
          {
            scope: {
              domains: ['example.com'],
              wildcardDomains: ['*.example.com'],
            },
          },
        ],
      });

      // Mock agent methods
      jest.spyOn(agent as any, 'heartbeat').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobStatus').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'logExecution').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobProgress').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'runSource').mockResolvedValue([
        'sub1.example.com',
        'sub2.example.com',
      ]);

      // Mock batch insert
      const batchInsert = require('../../utils/batch-insert');
      batchInsert.batchInsertAssets = jest.fn().mockResolvedValue(2);
    });

    it('should successfully process discovery job', async () => {
      const result = await agent.process(mockJob);

      expect(result).toEqual({
        totalFound: 2,
        inserted: 2,
        truncated: false,
        subdomains: expect.arrayContaining(['sub1.example.com', 'sub2.example.com']),
        sources: {
          chaosdb: 2,
          subfinder: 2,
        },
      });
    });

    it('should load program scope from database', async () => {
      await agent.process(mockJob);

      expect(mockDb.query).toHaveBeenCalledWith(
        'SELECT scope FROM programs WHERE id = $1',
        ['test-program-456']
      );
    });

    it('should throw error if program not found', async () => {
      mockDb.query.mockResolvedValue({ rows: [] });

      await expect(agent.process(mockJob)).rejects.toThrow(
        'Program test-program-456 not found'
      );
    });

    it('should run all sources in parallel', async () => {
      const runSourceSpy = jest.spyOn(agent as any, 'runSource');

      await agent.process(mockJob);

      expect(runSourceSpy).toHaveBeenCalledTimes(2);
      expect(runSourceSpy).toHaveBeenCalledWith(
        'chaosdb',
        expect.any(Array),
        'test-job-123',
        'test-program-456'
      );
      expect(runSourceSpy).toHaveBeenCalledWith(
        'subfinder',
        expect.any(Array),
        'test-job-123',
        'test-program-456'
      );
    });

    it('should deduplicate subdomains from multiple sources', async () => {
      jest.spyOn(agent as any, 'runSource')
        .mockResolvedValueOnce(['sub1.example.com', 'sub2.example.com'])
        .mockResolvedValueOnce(['sub2.example.com', 'sub3.example.com']);

      const result = await agent.process(mockJob);

      expect(result.totalFound).toBe(3);
      expect(result.subdomains).toHaveLength(3);
      expect(new Set(result.subdomains)).toEqual(
        new Set(['sub1.example.com', 'sub2.example.com', 'sub3.example.com'])
      );
    });

    it('should respect maxAssets limit', async () => {
      const largeSet = Array.from({ length: 2000 }, (_, i) => `sub${i}.example.com`);
      jest.spyOn(agent as any, 'runSource').mockResolvedValue(largeSet);

      mockJob.data.options.maxAssets = 100;
      const result = await agent.process(mockJob);

      expect(result.totalFound).toBe(2000);
      expect(result.subdomains).toHaveLength(100);
      expect(result.truncated).toBe(true);
    });

    it('should update job progress during execution', async () => {
      await agent.process(mockJob);

      expect((agent as any).updateJobProgress).toHaveBeenCalled();
      expect((agent as any).updateJobProgress).toHaveBeenCalledWith(
        'test-job-123',
        expect.objectContaining({
          percentage: expect.any(Number),
          currentTool: expect.any(String),
          toolStatus: expect.stringMatching(/running|completed/),
        })
      );
    });

    it('should log execution events', async () => {
      await agent.process(mockJob);

      expect((agent as any).logExecution).toHaveBeenCalledWith(
        'test-job-123',
        'test-program-456',
        'discovery',
        'start',
        'info',
        expect.stringContaining('Starting discovery')
      );

      expect((agent as any).logExecution).toHaveBeenCalledWith(
        'test-job-123',
        'test-program-456',
        'discovery',
        'complete',
        'success',
        expect.any(String)
      );
    });

    it('should batch insert assets efficiently', async () => {
      const batchInsert = require('../../utils/batch-insert');
      await agent.process(mockJob);

      expect(batchInsert.batchInsertAssets).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            programId: 'test-program-456',
            type: 'subdomain',
            value: expect.stringContaining('.example.com'),
          }),
        ])
      );
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            scope: {
              domains: ['example.com'],
              wildcardDomains: [],
            },
          },
        ],
      });

      jest.spyOn(agent as any, 'heartbeat').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobStatus').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'logExecution').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobProgress').mockResolvedValue(undefined);
    });

    it('should handle source failures gracefully', async () => {
      jest
        .spyOn(agent as any, 'runSource')
        .mockResolvedValueOnce(['sub1.example.com'])
        .mockRejectedValueOnce(new Error('Subfinder timeout'));

      const result = await agent.process(mockJob);

      // Should still return results from successful source
      expect(result.totalFound).toBe(1);
      expect(result.subdomains).toContain('sub1.example.com');

      // Should log error
      expect((agent as any).logExecution).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'subfinder',
        'error',
        'error',
        expect.stringContaining('Failed')
      );
    });

    it('should handle complete failure of all sources', async () => {
      jest.spyOn(agent as any, 'runSource').mockRejectedValue(new Error('Network error'));

      const result = await agent.process(mockJob);

      expect(result.totalFound).toBe(0);
      expect(result.inserted).toBe(0);
      expect(result.subdomains).toHaveLength(0);
    });

    it('should handle database insertion errors', async () => {
      jest.spyOn(agent as any, 'runSource').mockResolvedValue(['sub1.example.com']);

      const batchInsert = require('../../utils/batch-insert');
      batchInsert.batchInsertAssets = jest
        .fn()
        .mockRejectedValue(new Error('DB connection lost'));

      await expect(agent.process(mockJob)).rejects.toThrow('DB connection lost');
    });
  });

  describe('Three-Agent Integration', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            scope: {
              domains: ['example.com'],
              wildcardDomains: [],
            },
          },
        ],
      });

      jest.spyOn(agent as any, 'heartbeat').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobStatus').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'logExecution').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobProgress').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'runSource').mockResolvedValue(['sub1.example.com']);

      const batchInsert = require('../../utils/batch-insert');
      batchInsert.batchInsertAssets = jest.fn().mockResolvedValue(1);
    });

    it('should share findings with swarm when enabled', async () => {
      const { sharedMemory } = require('../../services/three-agent/shared-memory');
      sharedMemory.storeFindings = jest.fn().mockResolvedValue(undefined);
      sharedMemory.shareSuccess = jest.fn().mockResolvedValue(undefined);

      mockJob.data = {
        ...mockJob.data,
        swarmId: 'swarm-123',
        enableSharedMemory: true,
      } as any;

      await agent.process(mockJob);

      expect(sharedMemory.storeFindings).toHaveBeenCalledWith(
        'swarm-123',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'subdomain-discovery',
            severity: 'info',
            url: expect.stringContaining('sub1.example.com'),
          }),
        ])
      );

      expect(sharedMemory.shareSuccess).toHaveBeenCalled();
    });

    it('should not share findings when swarm is disabled', async () => {
      const { sharedMemory } = require('../../services/three-agent/shared-memory');
      sharedMemory.storeFindings = jest.fn();

      await agent.process(mockJob);

      expect(sharedMemory.storeFindings).not.toHaveBeenCalled();
    });

    it('should handle shared memory failures gracefully', async () => {
      const { sharedMemory } = require('../../services/three-agent/shared-memory');
      sharedMemory.storeFindings = jest
        .fn()
        .mockRejectedValue(new Error('Redis connection failed'));

      mockJob.data = {
        ...mockJob.data,
        swarmId: 'swarm-123',
        enableSharedMemory: true,
      } as any;

      // Should not throw, just log error
      const result = await agent.process(mockJob);
      expect(result).toBeDefined();
    });
  });

  describe('Performance Optimizations', () => {
    beforeEach(() => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            scope: {
              domains: ['example.com'],
              wildcardDomains: [],
            },
          },
        ],
      });

      jest.spyOn(agent as any, 'heartbeat').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobStatus').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'logExecution').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobProgress').mockResolvedValue(undefined);
    });

    it('should execute sources in parallel, not sequentially', async () => {
      const executionOrder: string[] = [];

      jest.spyOn(agent as any, 'runSource').mockImplementation(async (source: string) => {
        executionOrder.push(`${source}-start`);
        await new Promise(resolve => setTimeout(resolve, 100));
        executionOrder.push(`${source}-end`);
        return [`${source}.example.com`];
      });

      await agent.process(mockJob);

      // Both should start before either finishes (parallel execution)
      expect(executionOrder.indexOf('chaosdb-start')).toBeLessThan(
        executionOrder.indexOf('subfinder-end')
      );
      expect(executionOrder.indexOf('subfinder-start')).toBeLessThan(
        executionOrder.indexOf('chaosdb-end')
      );
    });

    it('should use efficient deduplication with Set', async () => {
      // Test with large overlapping datasets
      const set1 = Array.from({ length: 5000 }, (_, i) => `sub${i}.example.com`);
      const set2 = Array.from({ length: 5000 }, (_, i) => `sub${i + 2500}.example.com`);

      jest
        .spyOn(agent as any, 'runSource')
        .mockResolvedValueOnce(set1)
        .mockResolvedValueOnce(set2);

      const batchInsert = require('../../utils/batch-insert');
      batchInsert.batchInsertAssets = jest.fn().mockResolvedValue(7500);

      const result = await agent.process(mockJob);

      // Should deduplicate: 5000 + 5000 - 2500 overlap = 7500 unique
      expect(result.totalFound).toBe(7500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty scope', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            scope: {
              domains: [],
              wildcardDomains: [],
            },
          },
        ],
      });

      jest.spyOn(agent as any, 'heartbeat').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobStatus').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'logExecution').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'runSource').mockResolvedValue([]);

      const batchInsert = require('../../utils/batch-insert');
      batchInsert.batchInsertAssets = jest.fn().mockResolvedValue(0);

      const result = await agent.process(mockJob);

      expect(result.totalFound).toBe(0);
      expect(result.inserted).toBe(0);
    });

    it('should handle no sources specified', async () => {
      mockDb.query.mockResolvedValue({
        rows: [
          {
            scope: {
              domains: ['example.com'],
              wildcardDomains: [],
            },
          },
        ],
      });

      mockJob.data.options.sources = [];

      jest.spyOn(agent as any, 'heartbeat').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'updateJobStatus').mockResolvedValue(undefined);
      jest.spyOn(agent as any, 'logExecution').mockResolvedValue(undefined);

      const batchInsert = require('../../utils/batch-insert');
      batchInsert.batchInsertAssets = jest.fn().mockResolvedValue(0);

      const result = await agent.process(mockJob);

      expect(result.totalFound).toBe(0);
    });
  });
});
