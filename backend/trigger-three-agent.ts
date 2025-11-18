import database from './src/services/database';
import queue from './src/services/queue';
import { v4 as uuidv4 } from 'uuid';
import { ThreeAgentJob } from '../../shared/types';

async function triggerThreeAgent() {
  try {
    console.log('🚀 Manually triggering three-agent for existing assets...\n');
    
    // Get program ID
    const programs = await database.query('SELECT id FROM programs LIMIT 1');
    if (programs.rows.length === 0) {
      console.log('❌ No programs found');
      process.exit(1);
    }
    
    const programId = programs.rows[0].id;
    console.log(`📋 Program ID: ${programId}\n`);
    
    // Get high-value targets
    const highValueTargets = await database.query(`
      SELECT value, metadata
      FROM assets 
      WHERE program_id = $1
        AND type = 'url'
        AND metadata IS NOT NULL
        AND metadata::text != '{}'
        AND (
          (metadata->>'httpStatus')::int >= 200 AND 
          (metadata->>'httpStatus')::int < 400
        )
        AND (
          jsonb_array_length(COALESCE(metadata->'technologies', '[]'::jsonb)) > 3
          OR LOWER(metadata->>'title') LIKE '%admin%'
          OR LOWER(metadata->>'title') LIKE '%login%'
          OR value LIKE '%api.%'
          OR value LIKE '%admin.%'
        )
      LIMIT 50
    `, [programId]);
    
    if (highValueTargets.rows.length < 5) {
      console.log(`❌ Not enough high-value targets: ${highValueTargets.rows.length} (need >= 5)`);
      process.exit(1);
    }
    
    const targets = highValueTargets.rows.map(row => row.value);
    
    console.log(`🎯 Found ${targets.length} high-value targets`);
    console.log('   Examples:');
    targets.slice(0, 5).forEach((t, i) => console.log(`      ${i+1}. ${t}`));
    
    // Create three-agent job
    const threeAgentJobId = uuidv4();
    const threeAgentJob: ThreeAgentJob = {
      id: threeAgentJobId,
      type: 'three-agent',
      programId,
      priority: 8,
      status: 'pending',
      attempts: 0,
      maxAttempts: 2,
      options: {
        scope: {
          targets: targets,
          constraints: {
            noDoS: true,
            rateLimit: 50,
          },
        },
        objectives: [
          'Comprehensive vulnerability assessment',
          'Attack chain discovery',
          'Multi-reviewer validation',
        ],
        maxDuration: 3600000, // 1 hour
        swarmSize: Math.min(targets.length * 2, 100),
        autonomyLevel: 'high',
      },
      metadata: {
        requestedBy: 'manual-trigger',
        tags: ['manually-triggered', 'advanced-testing', 'fix-missing-handoff'],
      },
      createdAt: new Date(),
    };
    
    console.log('\n📝 Creating three-agent job...');
    
    // Save to database
    await database.query(
      `INSERT INTO jobs (id, type, program_id, priority, status, attempts, max_attempts, options, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        threeAgentJob.id,
        threeAgentJob.type,
        threeAgentJob.programId,
        threeAgentJob.priority,
        threeAgentJob.status,
        threeAgentJob.attempts,
        threeAgentJob.maxAttempts,
        JSON.stringify(threeAgentJob.options),
        JSON.stringify(threeAgentJob.metadata),
        threeAgentJob.createdAt,
      ]
    );
    
    // Add to queue
    await queue.addJob('three-agent', threeAgentJob);
    
    console.log(`\n✅ Three-agent job created and queued!`);
    console.log(`   Job ID: ${threeAgentJobId}`);
    console.log(`   Targets: ${targets.length}`);
    console.log(`   Swarm Size: ${threeAgentJob.options.swarmSize}`);
    console.log(`   Max Duration: ${threeAgentJob.options.maxDuration / 1000}s`);
    
    console.log('\n🔍 Monitor with:');
    console.log(`   tail -f logs/backend.log | grep -i "three-agent\\|${threeAgentJobId}"`);
    
    process.exit(0);
  } catch (e: any) {
    console.error('❌ Error:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

triggerThreeAgent();
