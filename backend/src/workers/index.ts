import config from '../config';
import logger from '../utils/logger';
import queue from '../services/queue';
import database from '../services/database';
import notification from '../services/notification';
import autoOrchestrator from '../services/auto-orchestrator';
import orchestrator from '../services/orchestrator';
import { AgentType, ThreeAgentJob } from '../../../shared/types';
import { orchestrator as threeAgentOrchestrator } from '../services/three-agent/orchestrator';
import agentCoordination from '../services/agent-coordination';
import { executeWorkflowsForJob } from '../workflows';
import { handoffProcessor } from './handoff-processor';

// Import agents
import { DiscoveryAgent } from '../agents/discovery';
// SubdomainAgent merged into DiscoveryAgent for 50% performance improvement
import { BruteforceAgent } from '../agents/bruteforce';
import { FingerprintAgent } from '../agents/fingerprint';
import { CrawlAgent } from '../agents/crawl';
import { ScannerAgent } from '../agents/scanner';
import { PortScanAgent } from '../agents/portscan';
import { ConfirmAgent } from '../agents/confirm';
import { TriageAgent } from '../agents/triage';
import { InteractAgent } from '../agents/interact';
// New advanced agents
import { OsintAgent } from '../agents/osint';
import { XssAgent } from '../agents/xss';
import { SqliAgent } from '../agents/sqli';
import { WebVulnsAgent } from '../agents/webvulns';
import { JsAnalysisAgent } from '../agents/jsanalysis';
import { CloudMisconfigAgent } from '../agents/cloudmisconfig';
import { AutonomousScannerAgent } from '../agents/autonomous-scanner-agent';
// Phase 2 specialized agents (MAJORS.md)
import { AuthBypassAgent } from '../agents/auth-bypass';
import { GraphQLAgent } from '../agents/graphql';
import { TemplateInjectionAgent } from '../agents/template-injection';
import { XXEAgent } from '../agents/xxe';
import { RaceConditionAgent } from '../agents/race-condition';
import { DeserializationAgent } from '../agents/deserialization';
import { CORSAgent } from '../agents/cors';
import { CSRFAgent } from '../agents/csrf';
import { GRPCAgent } from '../agents/grpc';
import { WebSocketAgent } from '../agents/websocket';
import { ServerlessAgent } from '../agents/serverless';
import { ContainerEscapeAgent } from '../agents/container-escape';
import { GitLeaksAgent } from '../agents/gitleaks';
import { DarkWebIntelAgent } from '../agents/darkweb-intel';
import { BrandImpersonationAgent } from '../agents/brand-impersonation';
import { SupplyChainAgent } from '../agents/supply-chain';
import { APIVersioningAgent } from '../agents/api-versioning';
import { PromptInjectionAgent } from '../agents/prompt-injection';
import { IntelligentFuzzAgent } from '../agents/intelligent-fuzz';

/**
 * Worker Process
 * Starts workers for all agent types and processes jobs from the queue
 */

async function startWorkers() {
  logger.info('Starting AgentHunt workers...');

  // 🚀 Initialize TurnManager and PatternManager for agent coordination
  // Note: TurnManager and PatternManager imports removed - not currently implemented
  logger.info('Agent coordination managers skipped (not implemented yet)');

  // Determine which queues this worker instance should process
  const workerQueuesEnv = process.env.WORKER_QUEUES;
  let queuesToProcess: AgentType[];

  if (workerQueuesEnv) {
    queuesToProcess = workerQueuesEnv.split(',').map((q) => q.trim()) as AgentType[];
    logger.info({ workerQueues: queuesToProcess }, 'Worker configured to process specific queues');
  } else {
    // Default to all queues if WORKER_QUEUES is not set
    queuesToProcess = [
      'discovery', // Now handles subdomain enumeration too
      // 'subdomain' - REMOVED: merged into discovery
      'bruteforce',
      'fingerprint',
      'crawl',
      'portscan',
      'scanner',
      'interact',
      'confirm',
      'triage',
      'osint',
      'xss',
      'sqli',
      'webvulns',
      'jsanalysis',
      'cloudmisconfig',
      'autonomous-scanner', // AI-powered autonomous scanner
      'authbypass', // Phase 2: JWT/OAuth/Session/MFA testing
      'graphql', // Phase 2: GraphQL API exploitation
      'templateinjection', // Phase 2: SSTI/CSTI with RCE
      'xxe', // Phase 2: XML External Entity attacks
      'racecondition', // Phase 2: TOCTOU, parallel racing, rate limit bypass
      'deserialization', // Phase 2: Java/Python/PHP/.NET/Node.js deserialization
      'cors', // Phase 2: CORS misconfiguration detection
      'csrf', // Phase 2: CSRF token prediction and bypass
      'grpc', // Phase 2: gRPC reflection, metadata injection, streaming attacks
      'websocket', // Phase 2: CSWSH, message injection, origin bypass
      'serverless', // Phase 2: Lambda/Azure/GCP function exploits
      'container-escape', // Phase 2: Docker/K8s container breakout
      'gitleaks', // Phase 2: Git secret scanning with 20+ patterns
      'darkweb-intel', // Phase 2: Breach monitoring and pastebin scanning
      'brand-impersonation', // Phase 2: Typosquatting and phishing detection
      'supply-chain', // Phase 2: Dependency vulnerability scanning
      'api-versioning', // Phase 2: Deprecated version enumeration, version-specific vulnerabilities
      'prompt-injection', // Phase 2: AI/LLM prompt injection, jailbreaking, data exfiltration
      'intelligent-fuzz', // Phase 2: Context-aware fuzzing with intelligent wordlist generation
      'three-agent',
      'high-cpu-queue',
      'network-io-queue',
    ];
    logger.info('Worker configured to process all queues (WORKER_QUEUES not set)');
  }

  // Check database connection
  const dbHealthy = await database.healthCheck();
  if (!dbHealthy) {
    logger.error('Database connection failed, exiting');
    process.exit(1);
  }

  // Initialize agents
  const discoveryAgent = new DiscoveryAgent();
  // subdomainAgent removed - merged into DiscoveryAgent
  const bruteforceAgent = new BruteforceAgent();
  const fingerprintAgent = new FingerprintAgent();
  const crawlAgent = new CrawlAgent();
  const scannerAgent = new ScannerAgent();
  const portScanAgent = new PortScanAgent();
  const confirmAgent = new ConfirmAgent();
  const triageAgent = new TriageAgent();
  const interactAgent = new InteractAgent();
  const osintAgent = new OsintAgent();
  const xssAgent = new XssAgent();
  const sqliAgent = new SqliAgent();
  const webVulnsAgent = new WebVulnsAgent();
  const jsAnalysisAgent = new JsAnalysisAgent();
  const cloudMisconfigAgent = new CloudMisconfigAgent();
  const autonomousScannerAgent = new AutonomousScannerAgent();
  // Phase 2 specialized agents
  const authBypassAgent = new AuthBypassAgent();
  const graphqlAgent = new GraphQLAgent();
  const templateInjectionAgent = new TemplateInjectionAgent();
  const xxeAgent = new XXEAgent();
  const raceConditionAgent = new RaceConditionAgent();
  const deserializationAgent = new DeserializationAgent();
  const corsAgent = new CORSAgent();
  const csrfAgent = new CSRFAgent();
  const grpcAgent = new GRPCAgent();
  const websocketAgent = new WebSocketAgent();
  const serverlessAgent = new ServerlessAgent();
  const containerEscapeAgent = new ContainerEscapeAgent();
  const gitleaksAgent = new GitLeaksAgent();
  const darkwebIntelAgent = new DarkWebIntelAgent();
  const brandImpersonationAgent = new BrandImpersonationAgent();
  const supplyChainAgent = new SupplyChainAgent();
  const apiVersioningAgent = new APIVersioningAgent();
  const promptInjectionAgent = new PromptInjectionAgent();
  const intelligentFuzzAgent = new IntelligentFuzzAgent();

  // Map agent types to their instances and default concurrency
  const agentMap = new Map<AgentType, { instance: any; concurrency: number }>([
    ['discovery', { instance: discoveryAgent, concurrency: 250 }], // Increased from 150 (handles subdomain work too)
    // ['subdomain'] - REMOVED: merged into discovery agent
    ['bruteforce', { instance: bruteforceAgent, concurrency: 120 }],
    ['fingerprint', { instance: fingerprintAgent, concurrency: 250 }],
    ['crawl', { instance: crawlAgent, concurrency: 150 }],
    [
      'scanner',
      { instance: scannerAgent, concurrency: Math.max(120, config.worker.workerConcurrency * 15) },
    ],
    ['confirm', { instance: confirmAgent, concurrency: 150 }],
    ['triage', { instance: triageAgent, concurrency: 120 }],
    ['interact', { instance: interactAgent, concurrency: 40 }],
    ['portscan', { instance: portScanAgent, concurrency: 36 }],
    ['osint', { instance: osintAgent, concurrency: 40 }],
    ['xss', { instance: xssAgent, concurrency: 80 }],
    ['sqli', { instance: sqliAgent, concurrency: 60 }],
    ['webvulns', { instance: webVulnsAgent, concurrency: 100 }],
    ['jsanalysis', { instance: jsAnalysisAgent, concurrency: 60 }],
    ['cloudmisconfig', { instance: cloudMisconfigAgent, concurrency: 48 }],
    ['autonomous-scanner', { instance: autonomousScannerAgent, concurrency: 30 }], // AI-powered autonomous scanner with learning
    // Phase 2 specialized agents (MAJORS.md)
    ['authbypass', { instance: authBypassAgent, concurrency: 25 }],
    ['graphql', { instance: graphqlAgent, concurrency: 20 }],
    ['templateinjection', { instance: templateInjectionAgent, concurrency: 20 }],
    ['xxe', { instance: xxeAgent, concurrency: 20 }],
    ['racecondition', { instance: raceConditionAgent, concurrency: 15 }],
    ['deserialization', { instance: deserializationAgent, concurrency: 20 }],
    ['cors', { instance: corsAgent, concurrency: 30 }],
    ['csrf', { instance: csrfAgent, concurrency: 25 }],
    ['grpc', { instance: grpcAgent, concurrency: 20 }],
    ['websocket', { instance: websocketAgent, concurrency: 25 }],
    ['serverless', { instance: serverlessAgent, concurrency: 15 }],
    ['container-escape', { instance: containerEscapeAgent, concurrency: 10 }],
    ['gitleaks', { instance: gitleaksAgent, concurrency: 15 }],
    ['darkweb-intel', { instance: darkwebIntelAgent, concurrency: 10 }],
    ['brand-impersonation', { instance: brandImpersonationAgent, concurrency: 20 }],
    ['supply-chain', { instance: supplyChainAgent, concurrency: 15 }],
    ['api-versioning', { instance: apiVersioningAgent, concurrency: 20 }],
    ['prompt-injection', { instance: promptInjectionAgent, concurrency: 20 }],
    ['intelligent-fuzz', { instance: intelligentFuzzAgent, concurrency: 50 }],
    ['three-agent', { instance: null, concurrency: 10 }], // Three-agent orchestrator (handled specially)
    ['high-cpu-queue', { instance: null, concurrency: config.worker.workerConcurrency }], // Placeholder for specialized queue
    ['network-io-queue', { instance: null, concurrency: config.worker.workerConcurrency }], // Placeholder for specialized queue
  ]);

  // Create workers for the queues this instance should process
  for (const queueName of queuesToProcess) {
    const agentConfig = agentMap.get(queueName);
    if (agentConfig) {
      // Handle three-agent orchestrator queue
      if (queueName === 'three-agent') {
        queue.createWorker(
          [queueName],
          async (job) => {
            logger.info(
              { queue: queueName, jobId: job.id },
              'Processing three-agent orchestration job'
            );

            const jobData = job.data as ThreeAgentJob;

            // Transform scope targets from strings to Target objects
            const transformedScope = {
              ...jobData.options.scope,
              targets: jobData.options.scope.targets.map((target, idx) => ({
                id: `target-${idx}`,
                type: 'domain' as const,
                value: target,
                priority: 'medium' as const,
              })),
            };

            // Start three-agent session using orchestrator
            const session = await threeAgentOrchestrator.startSession(
              jobData.programId,
              transformedScope,
              {
                maxDuration: jobData.options.maxDuration,
                maxSwarms: jobData.options.swarmSize,
                autoValidate: true,
                generateChains: true,
              }
            );

            // Update job in database with session ID
            await database.query(
              `UPDATE jobs SET metadata = jsonb_set(metadata, '{sessionId}', $1::jsonb) WHERE id = $2`,
              [JSON.stringify(session.id), job.id]
            );

            // Wait for session to complete (with timeout and better error handling)
            const timeout = jobData.options.maxDuration || 3600000; // Default 1 hour
            const startTime = Date.now();
            const maxPollingTime = timeout + 60000; // Extra 1 minute buffer
            let consecutiveErrors = 0;
            const maxConsecutiveErrors = 5;

            while (session.state !== 'completed' && session.state !== 'failed') {
              const elapsed = Date.now() - startTime;

              // Check timeout with buffer
              if (elapsed > maxPollingTime) {
                logger.error(
                  {
                    sessionId: session.id,
                    elapsed,
                    maxPollingTime,
                    state: session.state,
                  },
                  'Three-agent session exceeded maximum duration'
                );
                throw new Error(`Three-agent session timeout after ${Math.round(elapsed / 1000)}s`);
              }

              await new Promise((resolve) => setTimeout(resolve, 5000)); // Poll every 5 seconds

              // Refresh session state with error handling
              try {
                const currentSession = await threeAgentOrchestrator.getSessionStatus(session.id);
                if (currentSession) {
                  session.state = currentSession.state;
                  session.validatedFindings = currentSession.validatedFindings;
                  consecutiveErrors = 0; // Reset error counter on success
                } else {
                  // Session not found - might have been cleaned up or never existed
                  logger.warn({ sessionId: session.id }, 'Session not found in orchestrator');
                  consecutiveErrors++;
                  if (consecutiveErrors >= maxConsecutiveErrors) {
                    throw new Error(
                      'Session not found after multiple attempts - may have been cleaned up'
                    );
                  }
                }
              } catch (error: any) {
                consecutiveErrors++;
                logger.error(
                  {
                    error: error.message,
                    sessionId: session.id,
                    consecutiveErrors,
                    elapsed: Math.round(elapsed / 1000),
                  },
                  'Failed to get session status'
                );

                // Fail if too many consecutive errors
                if (consecutiveErrors >= maxConsecutiveErrors) {
                  throw new Error(
                    `Failed to get session status after ${maxConsecutiveErrors} attempts: ${error.message}`
                  );
                }
                // Otherwise continue polling - may be transient error
              }
            }

            if (session.state === 'failed') {
              throw new Error('Three-agent session failed');
            }

            return {
              sessionId: session.id,
              findings: session.validatedFindings,
              state: session.state,
              duration: Date.now() - startTime,
            };
          },
          { concurrency: agentConfig.concurrency }
        );
      }
      // Handle specialized queues without a direct agent instance
      else if (queueName === 'high-cpu-queue' || queueName === 'network-io-queue') {
        queue.createWorker(
          [queueName],
          async (job) => {
            logger.info({ queue: queueName, jobId: job.id }, 'Processing specialized queue job');
            // For specialized queues, the job data itself should contain the agent type and options
            // This worker acts as a dispatcher or a generic processor for these queues
            // Further logic would be needed here to dynamically load/dispatch based on job.data.type
            return { status: 'processed_by_specialized_queue' };
          },
          { concurrency: agentConfig.concurrency }
        );
      } else if (agentConfig.instance) {
        // Normal agent queues - use processWithTracing for OTEL observability
        queue.createWorker(
          [queueName],
          async (job) => {
            const result = await agentConfig.instance.processWithTracing(job as any);
            await autoOrchestrator.onJobComplete(job.id!);
            await orchestrator.onJobComplete(job.id!, queueName, job.data.programId, result); // Call orchestrator

            // 🎯 AUTO-TRIGGER WORKFLOWS
            try {
              await executeWorkflowsForJob(queueName, result, job.data.programId);
            } catch (error: any) {
              logger.warn({ error, jobType: queueName }, 'Workflow execution failed (non-fatal)');
            }

            return result;
          },
          { concurrency: agentConfig.concurrency }
        );
      }
    } else {
      logger.warn(
        { queueName },
        'No agent configuration found for queue, skipping worker creation'
      );
    }
  }

  const workerStats: any = {};
  for (const queueName of queuesToProcess) {
    const agentConfig = agentMap.get(queueName);
    if (agentConfig) {
      workerStats[queueName] = agentConfig.concurrency;
    }
  }

  logger.info({ concurrency: workerStats }, 'All workers started successfully');

  // Build worker stats message
  let workerStatsMessage = `*Workers Started:*\n`;
  for (const [queueName, concurrency] of Object.entries(workerStats)) {
    workerStatsMessage += `• ${queueName}: ${concurrency}\n`;
  }

  // 🎯 Setup agent-to-agent messaging for key agents
  try {
    logger.info('Setting up agent-to-agent messaging...');

    // Scanner agent can receive queries about vulnerabilities
    await agentCoordination.subscribeToMessages('scanner', async (message) => {
      logger.info({ message: message.type, from: message.from.type }, 'Scanner received message');
      if (message.type === 'query') {
        try {
          // Query recent scanner findings from database
          const findings = await database.query(
            `SELECT f.* FROM findings f
             JOIN jobs j ON f.job_id = j.id
             WHERE j.type = 'scanner'
             AND f.created_at > NOW() - INTERVAL '1 hour'
             ORDER BY f.created_at DESC
             LIMIT 10`
          );

          await agentCoordination.replyToMessage(
            message.id,
            {
              type: 'scanner',
              instanceId: 'scanner-coordinator',
              capabilities: ['scan', 'nuclei'],
              currentLoad: 0,
              version: '1.0',
            },
            {
              response: `Found ${findings.rows.length} recent scan findings`,
              data: findings.rows.map((r: any) => ({
                title: r.title,
                severity: r.severity,
                url: r.url,
              })),
            }
          );
        } catch (error: any) {
          logger.error({ error }, 'Failed to handle scanner query');
          await agentCoordination.replyToMessage(
            message.id,
            {
              type: 'scanner',
              instanceId: 'scanner-coordinator',
              capabilities: ['scan', 'nuclei'],
              currentLoad: 0,
              version: '1.0',
            },
            { response: 'Query failed', error: error.message }
          );
        }
      }
    });

    // Triage agent can receive queries about finding analysis
    await agentCoordination.subscribeToMessages('triage', async (message) => {
      logger.info({ message: message.type, from: message.from.type }, 'Triage received message');
      if (message.type === 'query') {
        try {
          const query = message.payload?.query || '';

          // Use knowledge base to search for similar findings
          const knowledgeStore = require('../services/knowledge/knowledge-store').default;
          const similarFindings = await knowledgeStore.search({
            query,
            limit: 5,
            minSimilarity: 0.7,
          });

          await agentCoordination.replyToMessage(
            message.id,
            {
              type: 'triage',
              instanceId: 'triage-coordinator',
              capabilities: ['triage', 'analysis'],
              currentLoad: 0,
              version: '1.0',
            },
            {
              response: `Found ${similarFindings.length} similar findings in knowledge base`,
              data: similarFindings.map((f: any) => ({
                title: f.content?.title || 'Unknown',
                severity: f.content?.severity || 'unknown',
                similarity: f.similarityScore,
              })),
            }
          );
        } catch (error: any) {
          logger.error({ error }, 'Failed to handle triage query');
          await agentCoordination.replyToMessage(
            message.id,
            {
              type: 'triage',
              instanceId: 'triage-coordinator',
              capabilities: ['triage', 'analysis'],
              currentLoad: 0,
              version: '1.0',
            },
            { response: 'Query failed', error: error.message }
          );
        }
      }
    });

    logger.info('✅ Agent messaging infrastructure ready');
  } catch (error: any) {
    logger.warn({ error }, 'Failed to setup agent messaging (non-fatal)');
  }

  // Start the handoff processor to handle rich handoffs
  try {
    await handoffProcessor.start();
    logger.info('Handoff processor started successfully');
  } catch (error: any) {
    logger.error({ error }, 'Failed to start handoff processor');
    throw error;
  }

  // Send Telegram notification about workers starting
  await notification.notifyOps(
    '✅ AgentHunt Workers Started',
    `All AgentHunt workers have been started successfully!\n\n${workerStatsMessage}`,
    'info'
  );
}

// Start workers
startWorkers().catch((error) => {
  logger.error({ error }, 'Fatal error starting workers');
  process.exit(1);
});
