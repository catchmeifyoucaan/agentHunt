import { DashboardService } from './src/services/dashboard';

async function testDashboardService() {
  const dashboardService = new DashboardService();
  
  try {
    console.log('Testing dashboard service...');
    
    const stats = await dashboardService.getHandoffStats();
    console.log('Handoff stats:', JSON.stringify(stats, null, 2));
    
    const recentHandoffs = await dashboardService.getRecentHandoffs(5);
    console.log('Recent handoffs:', JSON.stringify(recentHandoffs, null, 2));
  } catch (error) {
    console.error('Error testing dashboard service:', error);
  } finally {
    process.exit(0);
  }
}

testDashboardService();