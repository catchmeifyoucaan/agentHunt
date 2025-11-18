import { DashboardService } from '../../src/services/dashboard';
import database from '../../src/services/database'; // Import the default export

// Mock the database module
jest.mock('../../src/services/database', () => ({
  query: jest.fn(),
}));

describe('DashboardService', () => {
  let dashboardService: DashboardService;

  beforeEach(() => {
    dashboardService = new DashboardService();
    // Clear all mocks before each test
    (database.query as jest.Mock).mockClear();
  });

  describe('getHandoffStats', () => {
    it('should return handoff statistics from rich_handoffs table', async () => {
      // Mock successful rich_handoffs query results
      (database.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '10' }] }) // total
        .mockResolvedValueOnce({ rows: [{ count: '7' }] })  // successful
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })  // failed
        .mockResolvedValueOnce({ rows: [{ count: '5' }] })  // inProgress
        .mockResolvedValueOnce({ // byFromAgentType
          rows: [
            { from_agent_type: 'AgentA', count: '6', completed_count: '4', failed_count: '2', avg_duration_seconds: '100' },
            { from_agent_type: 'AgentB', count: '4', completed_count: '3', failed_count: '1', avg_duration_seconds: '150' },
          ],
        })
        .mockResolvedValueOnce({ // byToAgentType
          rows: [
            { to_agent_type: 'AgentC', count: '5', completed_count: '3', failed_count: '2', avg_duration_seconds: '120' },
            { to_agent_type: 'AgentD', count: '5', completed_count: '4', failed_count: '1', avg_duration_seconds: '180' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ avg_duration_seconds: '135' }] }); // overallAvgDuration

      const stats = await dashboardService.getHandoffStats();

      expect(stats).toEqual({
        total: 10,
        successful: 7,
        failed: 3,
        inProgress: 5,
        overallAvgDurationSeconds: 135,
        byFromAgentType: [
          { agentType: 'AgentA', count: 6, completed: 4, failed: 2, successRate: 4 / 6, avgDurationSeconds: 100 },
          { agentType: 'AgentB', count: 4, completed: 3, failed: 1, successRate: 3 / 4, avgDurationSeconds: 150 },
        ],
        byToAgentType: [
          { agentType: 'AgentC', count: 5, completed: 3, failed: 2, successRate: 3 / 5, avgDurationSeconds: 120 },
          { agentType: 'AgentD', count: 5, completed: 4, failed: 1, successRate: 4 / 5, avgDurationSeconds: 180 },
        ],
      });
      expect(database.query).toHaveBeenCalledTimes(7);
    });

    it('should fall back to handoffs table if rich_handoffs query fails', async () => {
      // Mock the first query to rich_handoffs to throw an error
      (database.query as jest.Mock).mockRejectedValueOnce(new Error('rich_handoffs table not found'));

      // Mock subsequent successful handoffs query results for the fallback
      (database.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [{ count: '8' }] })  // total (handoffs)
        .mockResolvedValueOnce({ rows: [{ count: '8' }] })  // successful (handoffs)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })  // failed (handoffs)
        .mockResolvedValueOnce({ rows: [{ count: '2' }] })  // inProgress (handoffs)
        .mockResolvedValueOnce({ // byFromAgentType (handoffs)
          rows: [
            { from_agent_type: 'OldAgentX', count: '5', completed_count: '5', failed_count: '0', avg_duration_seconds: '0' },
            { from_agent_type: 'OldAgentY', count: '3', completed_count: '3', failed_count: '0', avg_duration_seconds: '0' },
          ],
        })
        .mockResolvedValueOnce({ // byToAgentType (handoffs)
          rows: [
            { to_agent_type: 'OldAgentZ', count: '4', completed_count: '4', failed_count: '0', avg_duration_seconds: '0' },
            { to_agent_type: 'OldAgentW', count: '4', completed_count: '4', failed_count: '0', avg_duration_seconds: '0' },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ avg_duration_seconds: '0' }] }); // overallAvgDuration (handoffs)


      const stats = await dashboardService.getHandoffStats();

      expect(stats).toEqual({
        total: 8,
        successful: 8,
        failed: 0,
        inProgress: 2,
        overallAvgDurationSeconds: 0,
        byFromAgentType: [
          { agentType: 'OldAgentX', count: 5, completed: 5, failed: 0, successRate: 1, avgDurationSeconds: 0 },
          { agentType: 'OldAgentY', count: 3, completed: 3, failed: 0, successRate: 1, avgDurationSeconds: 0 },
        ],
        byToAgentType: [
          { agentType: 'OldAgentZ', count: 4, completed: 4, failed: 0, successRate: 1, avgDurationSeconds: 0 },
          { agentType: 'OldAgentW', count: 4, completed: 4, failed: 0, successRate: 1, avgDurationSeconds: 0 },
        ],
      });
      expect(database.query).toHaveBeenCalledTimes(8); // 1 failed + 7 fallback queries
    });
  });

  describe('getRecentHandoffs', () => {
    it('should return recent handoffs from rich_handoffs table', async () => {
      const mockHandoffs = [
        { id: '1', from_agent_type: 'A', to_agent_type: 'B', status: 'completed', created_at: new Date(), completed_at: new Date(), rejection_reason: null, to_job_id: 'job1', reasoning: {}, objectives: {}, output_contract: {}, parentResult: null },
        { id: '2', from_agent_type: 'C', to_agent_type: 'D', status: 'pending', created_at: new Date(), completed_at: null, rejection_reason: null, to_job_id: 'job2', reasoning: {}, objectives: {}, output_contract: {}, parentResult: null },
      ];
      (database.query as jest.Mock).mockResolvedValueOnce({ rows: mockHandoffs });

      const handoffs = await dashboardService.getRecentHandoffs(2);

      expect(handoffs).toEqual(mockHandoffs);
      expect(database.query).toHaveBeenCalledTimes(1);
      expect(database.query).toHaveBeenCalledWith(expect.any(String), [2]);
    });

    it('should fall back to handoffs table if rich_handoffs query fails', async () => {
        // Mock the first query to rich_handoffs to throw an error
        (database.query as jest.Mock).mockRejectedValueOnce(new Error('rich_handoffs table not found'));
  
        const mockFallbackHandoffs = [
          { id: '3', from_agent: 'X', to_agent: 'Y', created_at: new Date(), next_job_id: 'job3', reason: 'reasonX', context: 'contextX' },
          { id: '4', from_agent: 'W', to_agent: 'Z', created_at: new Date(), next_job_id: null, reason: 'reasonY', context: 'contextY' },
        ];
        (database.query as jest.Mock).mockResolvedValueOnce({ rows: mockFallbackHandoffs });
  
        const handoffs = await dashboardService.getRecentHandoffs(2);
  
        expect(handoffs.length).toBe(2);
        expect(handoffs[0].id).toBe('3');
        expect(handoffs[0].from_agent_type).toBe('X');
        expect(handoffs[0].status).toBe('completed'); // Fallback status is always 'completed'
        expect(handoffs[0].to_job_id).toBe('job3');
        expect(handoffs[1].id).toBe('4');
        expect(handoffs[1].from_agent_type).toBe('W');
        expect(handoffs[1].status).toBe('completed');
        expect(handoffs[1].to_job_id).toBeNull();
  
        expect(database.query).toHaveBeenCalledTimes(2); // 1 failed + 1 fallback query
        expect(database.query).toHaveBeenCalledWith(expect.any(String), [2]);
      });
  });
});
