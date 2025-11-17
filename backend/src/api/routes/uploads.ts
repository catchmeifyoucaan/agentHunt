import { Router, Request, Response, RequestHandler } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import database from '../../services/database';
import fileParser from '../../services/file-parser';
import orchestrator from '../../services/orchestrator';
import logger from '../../utils/logger';
import events from '../../services/events';
import scopeParser from '../../services/scope-parser/scope-parser';

const router = Router();

// Configure multer for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max per file
    files: 100, // Max 100 files
  },
  fileFilter: (req, file, cb) => {
    // Accept txt, json, csv, pdf, docx files
    const allowedTypes = ['.txt', '.json', '.csv', '.pdf', '.docx', '.doc'];
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

    if (allowedTypes.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${ext} not allowed. Allowed types: ${allowedTypes.join(', ')}`));
    }
  },
});

// Type-safe wrapper for multer middleware to resolve type conflicts
const multerMiddleware = upload.array('files', 100) as unknown as RequestHandler;

/**
 * Helper: Detect if file should use intelligent scope parsing
 */
function shouldUseIntelligentParsing(filename: string): boolean {
  const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'));
  // PDF and DOCX always use intelligent parsing
  return ['.pdf', '.docx', '.doc'].includes(ext);
}

/**
 * Helper: Detect if CSV has structured scope format
 */
function isStructuredCSV(content: string): boolean {
  // Check if CSV has headers like: type, value, priority, notes, constraint_details
  const firstLine = content.split('\n')[0]?.toLowerCase() || '';
  return firstLine.includes('type') && firstLine.includes('value');
}

/**
 * Helper: Parse files with intelligent scope parser or legacy file parser
 */
async function parseUploadedFiles(files: multer.File[]): Promise<{
  parsedScope: any;
  intelligentScope?: any;
  usedIntelligentParsing: boolean;
}> {
  // Single file that should use intelligent parsing?
  if (files.length === 1 && shouldUseIntelligentParsing(files[0].originalname)) {
    const file = files[0];
    const ext = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));

    logger.info({ filename: file.originalname, size: file.size }, 'Using intelligent scope parsing (PDF/DOCX)');

    const format = ext === '.pdf' ? 'pdf' : 'docx';
    const intelligentScope = await scopeParser.parseDocument(file.buffer, format, file.originalname);

    // Validate parsed scope
    const validation = scopeParser.validateScope(intelligentScope);
    if (!validation.valid) {
      logger.warn({ errors: validation.errors }, 'Intelligent scope validation failed, using legacy parser');
      // Fall back to legacy parser
      const fileContents = files.map(f => ({
        content: f.buffer.toString('utf-8'),
        filename: f.originalname,
      }));
      const parsedScope = await fileParser.parseFiles(fileContents);
      return { parsedScope, usedIntelligentParsing: false };
    }

    // Convert to format expected by orchestrator
    const parsedScope = {
      domains: intelligentScope.domains,
      subdomains: intelligentScope.subdomains,
      ips: intelligentScope.ips,
      urls: intelligentScope.urls,
      wildcardDomains: intelligentScope.wildcardDomains,
      excludedDomains: intelligentScope.excludedDomains,
    };

    return { parsedScope, intelligentScope, usedIntelligentParsing: true };
  }

  // Check for structured CSV
  if (files.length === 1 && files[0].originalname.toLowerCase().endsWith('.csv')) {
    const content = files[0].buffer.toString('utf-8');
    if (isStructuredCSV(content)) {
      logger.info({ filename: files[0].originalname }, 'Using intelligent scope parsing (structured CSV)');

      const intelligentScope = await scopeParser.parseDocument(files[0].buffer, 'csv', files[0].originalname);

      const parsedScope = {
        domains: intelligentScope.domains,
        subdomains: intelligentScope.subdomains,
        ips: intelligentScope.ips,
        urls: intelligentScope.urls,
        wildcardDomains: intelligentScope.wildcardDomains,
        excludedDomains: intelligentScope.excludedDomains,
      };

      return { parsedScope, intelligentScope, usedIntelligentParsing: true };
    }
  }

  // Use legacy file parser (preserves existing behavior)
  logger.info({ filesCount: files.length }, 'Using legacy file parsing (text/JSON/simple CSV)');
  const fileContents = files.map(file => ({
    content: file.buffer.toString('utf-8'),
    filename: file.originalname,
  }));

  const parsedScope = await fileParser.parseFiles(fileContents);
  return { parsedScope, usedIntelligentParsing: false };
}

/**
 * Upload files and start orchestration
 * POST /api/uploads/scope
 */
router.post('/scope', multerMiddleware, async (req, res) => {
  try {
    const files = req.files as multer.File[];

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

    // Parse all uploaded files (intelligent or legacy parsing)
    const { parsedScope, intelligentScope, usedIntelligentParsing } = await parseUploadedFiles(files);

    logger.info(
      {
        domainsCount: parsedScope.domains.length,
        subdomainsCount: parsedScope.subdomains.length,
        ipsCount: parsedScope.ips.length,
        urlsCount: parsedScope.urls.length,
        intelligentParsing: usedIntelligentParsing,
      },
      'Files parsed successfully'
    );

    // Get or create program
    let finalProgramId: string;

    if (program_id) {
      finalProgramId = program_id;
    } else if (create_program) {
      finalProgramId = await createProgram(
        program_name || `Upload-${Date.now()}`,
        platform,
        parsedScope
      );
    } else {
      return res.status(400).json({
        error: 'Either program_id or create_program=true with program_name is required',
      });
    }

    // Update existing program scope if program_id was provided and a new program was not created
    if (program_id && !create_program) {
      await updateProgramScope(finalProgramId, parsedScope);
    }

    // Store assets in database
    await storeAssets(finalProgramId, parsedScope);

    // Store intelligently parsed scope in database (if available)
    if (usedIntelligentParsing && intelligentScope) {
      await storeParsedScope(finalProgramId, intelligentScope, {
        sourceFilename: files[0].originalname,
        sourceType: shouldUseIntelligentParsing(files[0].originalname)
          ? (files[0].originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx')
          : 'csv',
      });
    }

    // Emit progress event (skip if event logging fails - don't break upload)
    try {
      // Use a valid UUID format for jobId (even though it's not a real job)
      const uploadJobId = uuidv4();
      await events.emitLog({
        jobId: uploadJobId,
        programId: finalProgramId,
        workerId: 'upload-handler',
        tool: 'file-parser',
        context: 'complete',
        level: 'info',
        message: `Parsed ${files.length} files: ${parsedScope.domains.length} domains, ${parsedScope.subdomains.length} subdomains`,
      });
    } catch (eventError) {
      // Don't fail upload if event logging fails
      logger.warn({ error: eventError }, 'Failed to emit upload event (non-critical)');
    }

    // Start orchestration
    const runDiscoveryBool = run_discovery === true || run_discovery === 'true';
    const runSubdomainEnumBool = run_subdomain_enum === true || run_subdomain_enum === 'true';
    const runFingerprintingBool = run_fingerprinting === true || run_fingerprinting === 'true';
    const runPortScanBool = run_port_scan === true || run_port_scan === 'true';
    const runCrawlingBool = run_crawling === true || run_crawling === 'true';
    const runScanningBool = run_scanning === true || run_scanning === 'true';
    const runTriageBool = run_triage === true || run_triage === 'true';

    const orchestrationConfig = {
      runDiscovery: runDiscoveryBool,
      runSubdomainEnum: runSubdomainEnumBool,
      runFingerprinting: runFingerprintingBool,
      runPortScan: runPortScanBool,
      runCrawling: runCrawlingBool,
      runScanning: runScanningBool,
      runTriage: runTriageBool,
      aggressive: runPortScanBool || runCrawlingBool, // Aggressive if port scanning or crawling is enabled
      concurrency: parseInt(concurrency, 10) || 10,
      maxAssets: parseInt(max_assets, 10) || 10000,
      priority: parseInt(priority, 10) || 5,
    };

    // Start orchestration (may fail, but upload should still succeed)
    let orchestrationResult = null;
    try {
      orchestrationResult = await orchestrator.orchestrate({
        programId: finalProgramId,
        domains: parsedScope.domains,
        subdomains: parsedScope.subdomains,
        ips: parsedScope.ips,
        urls: parsedScope.urls,
        config: orchestrationConfig,
      });
      logger.info({ programId: finalProgramId, orchestrationResult }, 'Orchestration started successfully');
    } catch (orchestrationError: any) {
      // Log but don't fail the upload - assets are already stored
      logger.error({ error: orchestrationError }, 'Orchestration failed, but upload succeeded');
      // Continue with response - upload was successful even if orchestration failed
    }

    res.status(200).json({
      success: true,
      message: orchestrationResult
        ? `Files uploaded successfully. ${orchestrationResult.message} (${orchestrationResult.jobsCreated.length} jobs)`
        : 'Files uploaded successfully (orchestration skipped)',
      programId: finalProgramId,
      parsedScope: {
        domains: parsedScope.domains.length,
        subdomains: parsedScope.subdomains.length,
        ips: parsedScope.ips.length,
        urls: parsedScope.urls.length,
        wildcardDomains: parsedScope.wildcardDomains.length,
        excludedDomains: parsedScope.excludedDomains.length,
      },
      // Enhanced: Include intelligent scope data if available
      intelligentParsing: usedIntelligentParsing,
      ...(intelligentScope && {
        intelligentScope: {
          constraints: intelligentScope.constraints,
          credentials: Object.keys(intelligentScope.credentials).length,
          priorities: intelligentScope.priorities,
          deliverables: intelligentScope.deliverables,
          metadata: intelligentScope.metadata,
          attackSurface: intelligentScope.attackSurface,
        },
      }),
      orchestration: orchestrationResult,
      files: files.map(f => ({
        name: f.originalname,
        size: f.size,
        type: f.mimetype,
      })),
    });
  } catch (error: any) {
    logger.error({ error, stack: error.stack }, 'File upload failed');
    // Ensure we always return JSON, even on errors
    const errorMessage = error?.message || error?.toString() || 'Failed to process uploaded files';
    res.status(500).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

/**
 * Upload files for an existing program (without orchestration)
 * POST /api/uploads/assets/:programId
 */
router.post('/assets/:programId', multerMiddleware, async (req: Request<{ programId: string }>, res) => {
  try {
    const files = req.files as multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Check if program exists
    const programResult = await database.query('SELECT id FROM programs WHERE id = $1', [finalProgramId]);
    if (programResult.rows.length === 0) {
      return res.status(404).json({ error: 'Program not found' });
    }

    // Parse files (intelligent or legacy parsing)
    const { parsedScope, intelligentScope, usedIntelligentParsing } = await parseUploadedFiles(files);

    // Store assets
    await storeAssets(finalProgramId, parsedScope);

    // Store intelligently parsed scope in database (if available)
    if (usedIntelligentParsing && intelligentScope) {
      await storeParsedScope(finalProgramId, intelligentScope, {
        sourceFilename: files[0].originalname,
        sourceType: shouldUseIntelligentParsing(files[0].originalname)
          ? (files[0].originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx')
          : 'csv',
      });
    }

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
      intelligentParsing: usedIntelligentParsing,
      ...(intelligentScope && {
        intelligentScope: {
          constraints: intelligentScope.constraints,
          credentials: Object.keys(intelligentScope.credentials).length,
          priorities: intelligentScope.priorities,
        },
      }),
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
router.post('/parse', multerMiddleware, async (req, res) => {
  try {
    const files = req.files as multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    // Parse files (intelligent or legacy parsing)
    const { parsedScope, intelligentScope, usedIntelligentParsing } = await parseUploadedFiles(files);

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
      intelligentParsing: usedIntelligentParsing,
      ...(intelligentScope && {
        intelligentScope: {
          constraints: intelligentScope.constraints,
          credentials: Object.keys(intelligentScope.credentials).length,
          priorities: intelligentScope.priorities,
          deliverables: intelligentScope.deliverables,
          metadata: intelligentScope.metadata,
        },
      }),
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

  // Use batch insert for speed (100-1000x faster)
  try {
    const { batchInsertAssets } = require('../utils/batch-insert');
    const assetsToInsert = assets.map(asset => ({
      programId,
      type: asset.type,
      value: asset.value,
      source: 'file_upload',  // source is string in DB schema
      metadata: {},
    }));
    await batchInsertAssets(assetsToInsert);
    logger.info({ programId, assetsCount: assets.length }, 'Assets stored in database (batch insert)');
  } catch (batchError) {
    // Fallback to individual inserts if batch fails
    logger.warn({ error: batchError }, 'Batch insert failed, using individual inserts');
    for (const asset of assets) {
      try {
        await database.query(
          `INSERT INTO assets (program_id, type, value, source, metadata, discovered_at, last_scanned)
           VALUES ($1, $2, $3, $4, '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT (program_id, type, value_hash) DO UPDATE
           SET last_scanned = CURRENT_TIMESTAMP`,
          [programId, asset.type, asset.value, 'file_upload']  // source is string in DB
        );
      } catch (error) {
        logger.error({ error, asset }, 'Failed to insert asset');
      }
    }
    logger.info({ programId, assetsCount: assets.length }, 'Assets stored in database (individual inserts)');
  }
}

/**
 * Helper: Store parsed scope document in database
 */
async function storeParsedScope(
  programId: string,
  intelligentScope: any,
  sourceInfo: { sourceFilename: string; sourceType: string }
): Promise<string> {
  const scopeId = uuidv4();

  try {
    // Mark any existing primary scopes as non-primary
    await database.query(
      'UPDATE parsed_scopes SET is_primary = false WHERE program_id = $1 AND is_primary = true',
      [programId]
    );

    // Insert main parsed scope record
    await database.query(
      `INSERT INTO parsed_scopes (
        id, program_id, source_type, source_filename, parsed_data,
        confidence, parsing_method, is_primary,
        total_domains, total_ips, total_exclusions,
        has_credentials, has_constraints
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        scopeId,
        programId,
        sourceInfo.sourceType,
        sourceInfo.sourceFilename,
        JSON.stringify(intelligentScope),
        intelligentScope.confidence || 0.9,
        intelligentScope.metadata?.parsingMethod || 'llm',
        true, // is_primary
        (intelligentScope.domains?.length || 0) + (intelligentScope.wildcardDomains?.length || 0),
        (intelligentScope.ips?.length || 0) + (intelligentScope.ipRanges?.length || 0),
        intelligentScope.excludedDomains?.length || 0,
        Object.keys(intelligentScope.credentials || {}).length > 0,
        Object.keys(intelligentScope.constraints || {}).length > 0,
      ]
    );

    logger.info({ scopeId, programId }, 'Parsed scope stored in database');

    // Insert scope targets
    const targets: any[] = [];

    // Domains
    intelligentScope.domains?.forEach((domain: string) => {
      targets.push({
        type: 'domain',
        value: domain,
        priority: 'high',
        is_excluded: false,
      });
    });

    // Wildcard domains
    intelligentScope.wildcardDomains?.forEach((domain: string) => {
      targets.push({
        type: 'wildcard_domain',
        value: domain,
        priority: 'high',
        is_excluded: false,
      });
    });

    // IPs
    intelligentScope.ips?.forEach((ip: string) => {
      targets.push({
        type: 'ip',
        value: ip,
        priority: 'medium',
        is_excluded: false,
      });
    });

    // IP ranges
    intelligentScope.ipRanges?.forEach((range: string) => {
      targets.push({
        type: 'ip_range',
        value: range,
        priority: 'medium',
        is_excluded: false,
      });
    });

    // Excluded domains
    intelligentScope.excludedDomains?.forEach((domain: string) => {
      targets.push({
        type: 'domain',
        value: domain,
        priority: 'high',
        is_excluded: true,
      });
    });

    // Insert all targets
    for (const target of targets) {
      try {
        await database.query(
          `INSERT INTO scope_targets (
            id, parsed_scope_id, program_id, target_type, target_value,
            priority, is_excluded, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (parsed_scope_id, target_type, target_value, is_excluded) DO NOTHING`,
          [
            uuidv4(),
            scopeId,
            programId,
            target.type,
            target.value,
            target.priority,
            target.is_excluded,
            true,
          ]
        );
      } catch (error) {
        logger.error({ error, target }, 'Failed to insert scope target');
      }
    }

    logger.info({ scopeId, targetsCount: targets.length }, 'Scope targets stored');

    // Insert constraints
    const constraints = intelligentScope.constraints || {};
    for (const [constraintType, details] of Object.entries(constraints)) {
      try {
        await database.query(
          `INSERT INTO scope_constraints (
            id, parsed_scope_id, program_id, constraint_type, constraint_details, is_mandatory
          ) VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            uuidv4(),
            scopeId,
            programId,
            constraintType,
            JSON.stringify(details),
            true,
          ]
        );
      } catch (error) {
        logger.error({ error, constraintType }, 'Failed to insert constraint');
      }
    }

    logger.info({ scopeId, constraintsCount: Object.keys(constraints).length }, 'Constraints stored');

    // Insert credentials
    const credentials = intelligentScope.credentials || {};
    for (const [credName, credData] of Object.entries(credentials)) {
      try {
        const cred: any = credData;
        await database.query(
          `INSERT INTO scope_credentials (
            id, parsed_scope_id, program_id, credential_name, credential_type,
            credential_value, username, password, description, is_active
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            uuidv4(),
            scopeId,
            programId,
            credName,
            cred.type || 'custom',
            cred.value || '',
            cred.username || null,
            cred.password || null,
            cred.description || `Credential for ${credName}`,
            true,
          ]
        );
      } catch (error) {
        logger.error({ error, credName }, 'Failed to insert credential');
      }
    }

    logger.info(
      { scopeId, credentialsCount: Object.keys(credentials).length },
      'Credentials stored (WARNING: should be encrypted in production!)'
    );

    return scopeId;
  } catch (error) {
    logger.error({ error, programId }, 'Failed to store parsed scope');
    throw error;
  }
}

export default router;
