import { orchestrator as threeAgentOrchestrator } from './src/services/three-agent/orchestrator';
import logger from './src/utils/logger';

async function testThreeAgent() {
  console.log('🚀 Testing three-agent directly...\n');

  const targets = [
    {
      id: 't1',
      type: 'domain' as const,
      value: 'https://www.premiumdelights.byspotify.com',
      priority: 'high' as const,
    },
    {
      id: 't2',
      type: 'domain' as const,
      value: 'https://podcastcharts.byspotify.com',
      priority: 'medium' as const,
    },
  ];

  const programId = '233e16c6-6dcc-43b9-b21c-861fe7eba282';

  try {
    console.log('Starting session...');
    const session = await threeAgentOrchestrator.startSession(
      programId,
      {
        targets,
        constraints: { noDoS: true, rateLimit: 50 },
      },
      {
        maxSwarms: 2,
        maxAgents: 20,
        maxDuration: 60000, // 1 minute test
        autoValidate: true,
      }
    );

    console.log('✅ Session started!');
    console.log('Session ID:', session.id);
    console.log('State:', session.state);
    console.log('Plan phases:', session.plan?.phases?.length || 0);

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testThreeAgent();
