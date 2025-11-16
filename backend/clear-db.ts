import database from './src/services/database';
import logger from './src/utils/logger';

async function clearDatabase() {
  console.log('🧹 Clearing database for fresh test...\n');

  try {
    const tables = [
      { name: 'job_progress', desc: 'Job progress tracking' },
      { name: 'job_execution_log', desc: 'Job execution logs' },
      { name: 'findings', desc: 'Vulnerability findings' },
      { name: 'jobs', desc: 'All jobs' },
      { name: 'assets', desc: 'All discovered assets' },
      { name: 'validation_results', desc: 'Three-agent validation results' },
      { name: 'swarm_results', desc: 'Three-agent swarm results' },
      { name: 'three_agent_sessions', desc: 'Three-agent sessions' },
      { name: 'testing_plans', desc: 'Three-agent testing plans' },
    ];

    let totalDeleted = 0;

    for (const table of tables) {
      try {
        const result = await database.query(`DELETE FROM ${table.name}`);
        const count = result.rowCount || 0;
        totalDeleted += count;
        console.log(`✓ Cleared ${table.name}: ${count} rows (${table.desc})`);
      } catch (err: any) {
        if (err.code === '42P01') {
          console.log(`  ℹ Table ${table.name} does not exist (skipped)`);
        } else {
          console.error(`  ✗ Error clearing ${table.name}:`, err.message);
        }
      }
    }

    console.log(`\n✅ Database cleared successfully! Deleted ${totalDeleted} total rows.`);

    const jobCount = await database.query('SELECT COUNT(*) FROM jobs');
    const assetCount = await database.query('SELECT COUNT(*) FROM assets');
    const findingCount = await database.query('SELECT COUNT(*) FROM findings');

    console.log('\n📊 Database state:');
    console.log(`   Jobs: ${jobCount.rows[0].count}`);
    console.log(`   Assets: ${assetCount.rows[0].count}`);
    console.log(`   Findings: ${findingCount.rows[0].count}`);
    console.log('\n✅ Database is ready for fresh test!\n');

    process.exit(0);
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

clearDatabase();
