import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load .env file - try multiple locations for flexibility
// 1. Environment variable ENV_FILE_PATH (for production)
// 2. /opt/agenthunt/.env (production default)
// 3. Project root (development)
const envPaths = [
  process.env.ENV_FILE_PATH,
  '/opt/agenthunt/.env',
  path.resolve(__dirname, '../../../.env'),
  path.resolve(process.cwd(), '.env'),
].filter(Boolean) as string[];

let envLoaded = false;
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
    console.log(`Loaded .env from: ${envPath}`);
    envLoaded = true;
    break;
  }
}

if (!envLoaded) {
  console.warn('No .env file found in expected locations. Using environment variables.');
}

const parseList = (value: string | undefined, defaults: string[]): string[] =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    : defaults;

interface Config {
  env: string;
  port: number;
  apiVersion: string;
  logLevel: string;

  database: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };

  redis: {
    host: string;
    port: number;
    url?: string;
    password?: string;
    tls?: boolean;
  };

  s3: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    region: string;
  };

  anthropic: {
    apiKey: string;
    model: string;
    triageTemperature: number;
    managerTemperature: number;
  };

  chaos: {
    apiKey: string;
    apiUrl: string;
  };

  telegram: {
    botToken: string;
    criticalChannel: string;
    highChannel: string;
    opsChannel: string;
  };

  security: {
    jwtSecret: string;
    jwtExpiresIn: string;
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
  };

  worker: {
    maxConcurrentJobs: number;
    workerConcurrency: number;
    jobTimeoutMs: number;
    jobRetryAttempts: number;
  };

  tools: {
    chaosClient: string;
    subfinder: string;
    amass: string;
    nuclei: string;
    httpx: string;
    katana: string;
    naabu: string;
    dnsx: string;
    tlsx: string;
    shuffledns: string;
    massdns: string;
    nucleiTemplates: string;
    wordlists: string;
    // Advanced vulnerability testing tools
    dalfox: string;
    sqlmap: string;
    ghauri: string;
    commix: string;
    corsy: string;
    crlfuzz: string;
    oralyzer: string;
    smuggler: string;
    nomore403: string;
    ppmap: string;
    // JavaScript analysis tools
    subjs: string;
    jsluice: string;
    xnLinkFinder: string;
    gitleaks: string;
    trufflehog: string;
    retireJs: string;
    // OSINT tools
    theHarvester: string;
    metagoofil: string;
    emailfinder: string;
    // Cloud scanning tools
    s3scanner: string;
    cloudHunter: string;
    // Utilities
    ffuf: string;
    dig: string;
    awscli: string;
    googler: string;
  };

  safety: {
    enableTier3Templates: boolean;
    requireHumanApprovalHigh: boolean;
    requireHumanApprovalCritical: boolean;
    maxFuzzingConcurrency: number;
    fpThresholdHigh: number;
    fpThresholdCritical: number;
  };

    interactsh: {
      server: string;
      token?: string;
    };

    monitoring: {
      enableTelemetry: boolean;
      sentryDsn?: string;
      grafanaUrl?: string;
    };

    features: {
      enableBruteforce: boolean;
      enablePortScanning: boolean;
      enableFuzzing: boolean;
      enableAiTriage: boolean;
      enableAutoConfirm: boolean;
      // New advanced features
      enableOsint: boolean;
      enableXssScanning: boolean;
      enableSqliScanning: boolean;
      enableWebVulnScanning: boolean;
      enableJsAnalysis: boolean;
      enableCloudMisconfigScan: boolean;
      enableDistributedScanning: boolean;
      enableFaradayIntegration: boolean;
      enableAmassSecondPass: boolean;
    };

    orchestration: {
      internalTagging: {
        domainSuffixes: string[];
        hostnameRegexes: string[];
        serviceKeywords: string[];
        environmentKeywords: string[];
      };
    };
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  apiVersion: process.env.API_VERSION || 'v1',
  logLevel: process.env.LOG_LEVEL || 'info',

  database: {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'agenthunt',
    password: process.env.POSTGRES_PASSWORD || 'changeme',
    database: process.env.POSTGRES_DB || 'agenthunt',
    readHost: process.env.POSTGRES_READ_HOST,
    readPort: parseInt(process.env.POSTGRES_READ_PORT || process.env.POSTGRES_PORT || '5432', 10),
    readUser: process.env.POSTGRES_READ_USER || process.env.POSTGRES_USER,
    readPassword: process.env.POSTGRES_READ_PASSWORD || process.env.POSTGRES_PASSWORD,
    readDatabase: process.env.POSTGRES_READ_DB || process.env.POSTGRES_DB,
  },

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true',
  },

  s3: {
    endpoint: process.env.S3_ENDPOINT || 'http://localhost:9000',
    accessKey: process.env.S3_ACCESS_KEY || 'minioadmin',
    secretKey: process.env.S3_SECRET_KEY || 'minioadmin',
    bucket: process.env.S3_BUCKET || 'agenthunt-artifacts',
    region: process.env.S3_REGION || 'us-east-1',
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929',
    triageTemperature: parseFloat(process.env.TRIAGE_TEMPERATURE || '0.0'),
    managerTemperature: parseFloat(process.env.MANAGER_TEMPERATURE || '0.3'),
  },

  chaos: {
    apiKey: process.env.CHAOS_API_KEY || '',
    apiUrl: process.env.CHAOS_API_URL || 'https://chaos.projectdiscovery.io',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    criticalChannel: process.env.TELEGRAM_CRITICAL_CHANNEL || '',
    highChannel: process.env.TELEGRAM_HIGH_CHANNEL || '',
    opsChannel: process.env.TELEGRAM_OPS_CHANNEL || '',
  },

  security: {
    jwtSecret: process.env.JWT_SECRET || 'change-me-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },

  worker: {
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '250', 10),
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '20', 10),
    jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || '3600000', 10),
    jobRetryAttempts: parseInt(process.env.JOB_RETRY_ATTEMPTS || '3', 10),
  },

  tools: {
    chaosClient: process.env.CHAOS_CLIENT_PATH || '/usr/local/bin/chaos-client',
    subfinder: process.env.SUBFINDER_PATH || '/usr/local/bin/subfinder',
    amass: process.env.AMASS_PATH || '/usr/local/bin/amass',
    nuclei: process.env.NUCLEI_PATH || '/usr/local/bin/nuclei',
    httpx: process.env.HTTPX_PATH || '/usr/local/bin/httpx',
    httpxThreads: parseInt(process.env.HTTPX_THREADS || '300', 10), // Increased from 200 for better throughput
    httpxRateLimit: parseInt(process.env.HTTPX_RATE_LIMIT || '300', 10), // Increased from 150 (3x faster fingerprinting)
    httpxTimeout: parseInt(process.env.HTTPX_TIMEOUT || '10', 10),
    httpxRetries: parseInt(process.env.HTTPX_RETRIES || '1', 10),
    katana: process.env.KATANA_PATH || '/usr/local/bin/katana',
    naabu: process.env.NAABU_PATH || '/usr/local/bin/naabu',
    masscan: process.env.MASSCAN_PATH || '/usr/local/bin/masscan',
    useMasscan: process.env.USE_MASSCAN === 'true', // Enable Masscan for 10-30x faster port scanning (default: false for compatibility)
    dnsx: process.env.DNSX_PATH || '/usr/local/bin/dnsx',
    tlsx: process.env.TLSX_PATH || '/usr/local/bin/tlsx',
    shuffledns: process.env.SHUFFLEDNS_PATH || '/usr/local/bin/shuffledns',
    massdns: process.env.MASSDNS_PATH || '/usr/local/bin/massdns',
    massdnsResolvers: process.env.MASSDNS_RESOLVERS || '/app/tools/resolvers.txt',
    useMassdns: process.env.USE_MASSDNS === 'true', // Enable Massdns for 32x faster DNS (default: false for compatibility)
    nucleiTemplates: process.env.NUCLEI_TEMPLATES_PATH || '/app/tools/templates/nuclei',
    wordlists: process.env.WORDLIST_PATH || '/app/tools/wordlists',
    // Advanced vulnerability testing tools
    dalfox: process.env.DALFOX_PATH || '/usr/local/bin/dalfox',
    sqlmap: process.env.SQLMAP_PATH || '/usr/local/bin/sqlmap',
    ghauri: process.env.GHAURI_PATH || '/usr/local/bin/ghauri',
    commix: process.env.COMMIX_PATH || '/usr/local/bin/commix',
    corsy: process.env.CORSY_PATH || '/usr/local/bin/corsy',
    crlfuzz: process.env.CRLFUZZ_PATH || '/usr/local/bin/crlfuzz',
    oralyzer: process.env.ORALYZER_PATH || '/usr/local/bin/oralyzer',
    smuggler: process.env.SMUGGLER_PATH || '/opt/tools/smuggler.py',
    nomore403: process.env.NOMORE403_PATH || '/usr/local/bin/nomore403',
    ppmap: process.env.PPMAP_PATH || '/usr/local/bin/ppmap',
    // JavaScript analysis tools
    subjs: process.env.SUBJS_PATH || '/usr/local/bin/subjs',
    jsluice: process.env.JSLUICE_PATH || '/usr/local/bin/jsluice',
    xnLinkFinder: process.env.XNLINKFINDER_PATH || '/opt/tools/xnLinkFinder',
    gitleaks: process.env.GITLEAKS_PATH || '/usr/local/bin/gitleaks',
    trufflehog: process.env.TRUFFLEHOG_PATH || '/usr/local/bin/trufflehog',
    retireJs: process.env.RETIREJS_PATH || '/usr/local/bin/retire',
    // OSINT tools
    theHarvester: process.env.THEHARVESTER_PATH || '/usr/local/bin/theHarvester',
    metagoofil: process.env.METAGOOFIL_PATH || '/usr/local/bin/metagoofil',
    emailfinder: process.env.EMAILFINDER_PATH || '/usr/local/bin/emailfinder',
    // Cloud scanning tools
    s3scanner: process.env.S3SCANNER_PATH || '/usr/local/bin/s3scanner',
    cloudHunter: process.env.CLOUDHUNTER_PATH || '/usr/local/bin/cloudhunter',
    // Utilities
    ffuf: process.env.FFUF_PATH || '/usr/local/bin/ffuf',
    dig: process.env.DIG_PATH || '/usr/bin/dig',
    awscli: process.env.AWS_CLI_PATH || '/usr/local/bin/aws',
    googler: process.env.GOOGLER_PATH || '/usr/local/bin/googler',
  },

  safety: {
    enableTier3Templates: process.env.ENABLE_TIER_3_TEMPLATES === 'true',
    requireHumanApprovalHigh: process.env.REQUIRE_HUMAN_APPROVAL_HIGH !== 'false',
    requireHumanApprovalCritical: process.env.REQUIRE_HUMAN_APPROVAL_CRITICAL !== 'false',
    maxFuzzingConcurrency: parseInt(process.env.MAX_FUZZING_CONCURRENCY || '20', 10),
    fpThresholdHigh: parseFloat(process.env.FP_THRESHOLD_HIGH || '0.02'),
    fpThresholdCritical: parseFloat(process.env.FP_THRESHOLD_CRITICAL || '0.02'),
  },

  interactsh: {
    server: process.env.INTERACTSH_SERVER || 'oast.pro',
    token: process.env.INTERACTSH_TOKEN,
  },

  monitoring: {
    enableTelemetry: process.env.ENABLE_TELEMETRY !== 'false',
    sentryDsn: process.env.SENTRY_DSN,
    grafanaUrl: process.env.GRAFANA_URL,
  },

  features: {
    enableBruteforce: process.env.ENABLE_BRUTEFORCE === 'true',
    enablePortScanning: process.env.ENABLE_PORT_SCANNING === 'true',
    enableFuzzing: process.env.ENABLE_FUZZING !== 'false',
    enableAiTriage: process.env.ENABLE_AI_TRIAGE !== 'false',
    enableAutoConfirm: process.env.ENABLE_AUTO_CONFIRM !== 'false',
    // New advanced features
    enableOsint: process.env.ENABLE_OSINT !== 'false',
    enableXssScanning: process.env.ENABLE_XSS_SCANNING !== 'false',
    enableSqliScanning: process.env.ENABLE_SQLI_SCANNING !== 'false',
    enableWebVulnScanning: process.env.ENABLE_WEBVULN_SCANNING !== 'false',
    enableJsAnalysis: process.env.ENABLE_JS_ANALYSIS !== 'false',
    enableCloudMisconfigScan: process.env.ENABLE_CLOUD_MISCONFIG_SCAN !== 'false',
    enableDistributedScanning: process.env.ENABLE_DISTRIBUTED_SCANNING === 'true',
    enableFaradayIntegration: process.env.ENABLE_FARADAY_INTEGRATION === 'true',
    enableAmassSecondPass: process.env.ENABLE_AMASS_SECOND_PASS === 'true',
  },

  orchestration: {
    internalTagging: {
      domainSuffixes: parseList(process.env.INTERNAL_DOMAIN_SUFFIXES, ['.internal', '.local', '.corp', '.lan']),
      hostnameRegexes: parseList(process.env.INTERNAL_HOSTNAME_REGEXES, ['^.*-internal$', '^.*-corp$', '^.*-lan$']),
      serviceKeywords: parseList(process.env.INTERNAL_SERVICE_KEYWORDS, ['database', 'db', 'internal', 'admin', 'management']),
      environmentKeywords: parseList(process.env.INTERNAL_ENV_KEYWORDS, ['staging', 'dev', 'test', 'internal']),
    },
  },
};

export default config;
