import database from './src/services/database';
import { v4 as uuidv4 } from 'uuid';

async function createProgramWithAssets() {
  try {
    const programName = 'zero';
    const programId = uuidv4();
    const slug = `${programName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${programId.slice(0, 8)}`;

    console.log('Creating program:', programName);
    console.log('Program ID:', programId);

    // Create the program
    await database.query(
      `INSERT INTO programs (id, name, slug, platform, scope, policy, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
      [
        programId,
        programName,
        slug,
        'bugcrowd', // Using bugcrowd as platform
        JSON.stringify({
          domains: ['bugcrowd.com', 'example.com'],
          wildcardDomains: [],
          excludedDomains: [],
          maxAssets: 10000,
        }),
        JSON.stringify({
          allowedActions: {
            passiveDiscovery: true,
            activeDiscovery: true,
            bruteforce: false,
            portScanning: true,
            crawling: true,
            fuzzing: true,
            oobTesting: false,
          },
          allowedSources: ['subfinder', 'chaos', 'httpx'],
          allowedTemplates: {
            tier0: true,
            tier1: true,
            tier2: true,
            tier3: false,
          },
          requireHumanApproval: {
            tier2: false,
            tier3: true,
            highSeverity: false,
            criticalSeverity: true,
          },
          rateLimit: {
            maxConcurrentScans: 10,
            maxRequestsPerSecond: 100,
            respectRateLimit: true,
          },
          notification: {
            telegram: false,
            email: false,
          },
        }),
        JSON.stringify({
          source: 'manual_creation',
          createdFor: 'testing',
        }),
      ]
    );

    // Create assets for the program
    const domains = ['bugcrowd.com', 'example.com'];

    for (const domain of domains) {
      await database.query(
        `INSERT INTO assets (id, program_id, type, value, source, status, discovered_at, last_scanned)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [uuidv4(), programId, 'domain', domain, 'manual', 'active']
      );
    }

    console.log('✅ Program created successfully!');
    console.log('Program ID:', programId);
    console.log('Program Name:', programName);
    console.log('Domains:', domains);

    // Return the program ID for the next step
    return programId;
  } catch (error: any) {
    console.error('❌ Error creating program:', error.message);
    throw error;
  }
}

// Run the function
createProgramWithAssets()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
