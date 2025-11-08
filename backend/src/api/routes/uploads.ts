import { Router, Request, Response } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import database from '../../services/database';
import fileParser from '../../services/file-parser';
import orchestrator, { OrchestrationConfig } from '../../services/orchestrator';
import logger from '../../utils/logger';
import events from '../../services/events';

const router = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max per file
    files: 100, // Max 100 files
  },
  fileFilter: (req, file, cb) => {
    // Accept txt, json, csv files
    const allowedTypes = ['.txt', '.json', '.csv'];
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`));
    }
  },
});

/**
 * Upload files and start orchestration
 * POST /api/uploads/scope
 */
router.post('/scope', upload.array('files', 100), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Get configuration from request body
    const {
      program_name,
      program_id,
      create_program = true,
      run_discovery = true,
      run_subdomain_enum = true,
      run_fingerprinting = true,
      run_port_scan = true,
      run_crawling = true,
      run_scanning = true,
      run_triage = true,
      concurrency = 10,
      max_assets = 10000,
      priority = 5,
      platform = 'other',
    } = req.body;

    logger.info(
      {
        filesCount: files.length,
        programName: program_name,
        programId: program_id,
      },
      'Processing file uploads'
    );

    // Parse all uploaded files
    const fileContents = files.map(file => ({
      content: file.buffer.toString('utf-8'),
      filename: file.originalname,
    }));

    const parsedScope = await fileParser.parseFiles(fileContents);

    logger.info(
      {
        domainsCount: parsedScope.domains.length,
        subdomainsCount: parsedScope.subdomains.length,
        ipsCount: parsedScope.ips.length,
        urlsCount: parsedScope.urls.length,
      },
      'Files parsed successfully'
    );

    // Get or create program
    let finalProgramId = program_id;

    if (!finalProgramId && create_program) {
      finalProgramId = await createProgram(
        program_name || `Upload-${Date.now()}`,
        platform,
        parsedScope
      );
    } else if (!finalProgramId) {
      return res.status(400).json({
        error: 'Either program_id or create_program=true with program_name is required',
      });
    } else {
      // Update existing program scope
      await updateProgramScope(finalProgramId, parsedScope);
    }

    // Store assets in database
    await storeAssets(finalProgramId, parsedScope);

    // Emit progress event
    await events.emitLog({
      jobId: 'upload',
      programId: finalProgramId,
      workerId: 'upload-handler',
      tool: 'file-parser',
      context: 'complete',
      level: 'info',
      message: `Parsed ${files.length} files: ${parsedScope.domains.length} domains, ${parsedScope.subdomains.length} subdomains`,
    });

    // Start orchestration
    const orchestrationConfig: OrchestrationConfig = {
      runDiscovery: run_discovery === true || run_discovery === 'true',
      runSubdomainEnum: run_subdomain_enum === true || run_subdomain_enum === 'true',
      runFingerprinting: run_fingerprinting === true || run_fingerprinting === 'true',
      runPortScan: run_port_scan === true || run_port_scan === 'true',
      runCrawling: run_crawling === true || run_crawling === 'true',
      runScanning: run_scanning === true || run_scanning === 'true',
      runTriage: run_triage === true || run_triage === 'true',
      concurrency: parseInt(concurrency, 10) || 10,
      maxAssets: parseInt(max_assets, 10) || 10000,
      priority: parseInt(priority, 10) || 5,
    };

    const orchestrationResult = await orchestrator.orchestrate({
      programId: finalProgramId,
      domains: parsedScope.domains,
      subdomains: parsedScope.subdomains,
      ips: parsedScope.ips,
      urls: parsedScope.urls,
      config: orchestrationConfig,
    });

    res.status(200).json({
      success: true,
      message: 'Files uploaded and orchestration started',
      programId: finalProgramId,
      parsedScope: {
        domains: parsedScope.domains.length,
        subdomains: parsedScope.subdomains.length,
        ips: parsedScope.ips.length,
        urls: parsedScope.urls.length,
        wildcardDomains: parsedScope.wildcardDomains.length,
        excludedDomains: parsedScope.excludedDomains.length,
      },
      orchestration: orchestrationResult,
      files: files.map(f => ({
        name: f.originalname,
        size: f.size,
        type: f.mimetype,
      })),
    });
  } catch (error: any) {
    logger.error({ error }, 'File upload failed');
    res.status(500).json({
      error: error.message || 'Failed to process uploaded files',
    });
  }
});

/**
 * Upload files for an existing program (without orchestration)
 * POST /api/uploads/assets/:programId
 */
router.post('/assets/:programId', upload.array('files', 100), async (req: Request, res: Response) => {
  try {
    const { programId } = req.params;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Check if program exists
    const programResult = await database.query('SELECT id FROM programs WHERE id = $1', [programId]);
    if (programResult.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    // Parse files
    const fileContents = files.map(file => ({
      content: file.buffer.toString('utf-8'),
      filename: file.originalname,
    }));

    const parsedScope = await fileParser.parseFiles(fileContents);

    // Store assets
    await storeAssets(programId, parsedScope);

    res.status(200).json({
      success: true,
      message: 'Assets uploaded successfully',
      programId,
      parsedScope: {
        domains: parsedScope.domains.length,
        subdomains: parsedScope.subdomains.length,
        ips: parsedScope.ips.length,
        urls: parsedScope.urls.length,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'Asset upload failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Parse files without creating a program (preview)
 * POST /api/uploads/parse
 */
router.post('/parse', upload.array('files', 100), async (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const fileContents = files.map(file => ({
      content: file.buffer.toString('utf-8'),
      filename: file.originalname,
    }));

    const parsedScope = await fileParser.parseFiles(fileContents);

    res.status(200).json({
      success: true,
      parsedScope: {
        domains: parsedScope.domains,
        subdomains: parsedScope.subdomains,
        ips: parsedScope.ips,
        urls: parsedScope.urls,
        wildcardDomains: parsedScope.wildcardDomains,
        excludedDomains: parsedScope.excludedDomains,
      },
      stats: {
        domains: parsedScope.domains.length,
        subdomains: parsedScope.subdomains.length,
        ips: parsedScope.ips.length,
        urls: parsedScope.urls.length,
        wildcardDomains: parsedScope.wildcardDomains.length,
        excludedDomains: parsedScope.excludedDomains.length,
      },
    });
  } catch (error: any) {
    logger.error({ error }, 'File parsing failed');
    res.status(500).json({ error: error.message });
  }
});

/**
 * Helper: Create a new program
 */
async function createProgram(
  name: string,
  platform: string,
  parsedScope: any
): Promise<string> {
  const programId = uuidv4();
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${programId.slice(0, 8)}`;

  await database.query(
    `INSERT INTO programs (id, name, slug, platform, scope, policy, metadata, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
    [
      programId,
      name,
      slug,
      platform,
      JSON.stringify({
        domains: parsedScope.domains,
        wildcardDomains: parsedScope.wildcardDomains,
        excludedDomains: parsedScope.excludedDomains,
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
        source: 'file_upload',
        filesUploaded: true,
      }),
    ]
  );

  logger.info({ programId, name }, 'Program created from file upload');

  return programId;
}

/**
 * Helper: Update program scope
 */
async function updateProgramScope(programId: string, parsedScope: any): Promise<void> {
  const result = await database.query('SELECT scope FROM programs WHERE id = $1', [programId]);

  if (result.rows.length === 0) {
    throw new Error(`Program ${programId} not found`);
  }

  const currentScope = result.rows[0].scope || {};

  // Merge with existing scope
  const updatedScope = {
    ...currentScope,
    domains: [...new Set([...(currentScope.domains || []), ...parsedScope.domains])],
    wildcardDomains: [...new Set([...(currentScope.wildcardDomains || []), ...parsedScope.wildcardDomains])],
    excludedDomains: [...new Set([...(currentScope.excludedDomains || []), ...parsedScope.excludedDomains])],
  };

  await database.query('UPDATE programs SET scope = $1 WHERE id = $2', [
    JSON.stringify(updatedScope),
    programId,
  ]);

  logger.info({ programId }, 'Program scope updated');
}

/**
 * Helper: Store assets in database
 */
async function storeAssets(programId: string, parsedScope: any): Promise<void> {
  const assets = [
    ...parsedScope.domains.map((d: string) => ({ type: 'domain', value: d })),
    ...parsedScope.subdomains.map((s: string) => ({ type: 'subdomain', value: s })),
    ...parsedScope.ips.map((ip: string) => ({ type: 'ip', value: ip })),
    ...parsedScope.urls.map((url: string) => ({ type: 'url', value: url })),
  ];

  for (const asset of assets) {
    try {
      await database.query(
        `INSERT INTO assets (program_id, type, value, source, status, metadata, first_seen, last_seen)
         VALUES ($1, $2, $3, $4, 'active', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (program_id, value, type) DO UPDATE
         SET last_seen = CURRENT_TIMESTAMP,
             source = array_append(assets.source, 'file_upload')`,
        [programId, asset.type, asset.value, ['file_upload']]
      );
    } catch (error) {
      logger.error({ error, asset }, 'Failed to insert asset');
    }
  }

  logger.info({ programId, assetsCount: assets.length }, 'Assets stored in database');
}

export default router;
