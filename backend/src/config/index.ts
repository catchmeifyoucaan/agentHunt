import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

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
    maxConcurrentJobs: parseInt(process.env.MAX_CONCURRENT_JOBS || '10', 10),
    workerConcurrency: parseInt(process.env.WORKER_CONCURRENCY || '5', 10),
    jobTimeoutMs: parseInt(process.env.JOB_TIMEOUT_MS || '3600000', 10),
    jobRetryAttempts: parseInt(process.env.JOB_RETRY_ATTEMPTS || '3', 10),
  },

  tools: {
    chaosClient: process.env.CHAOS_CLIENT_PATH || '/usr/local/bin/chaos-client',
    subfinder: process.env.SUBFINDER_PATH || '/usr/local/bin/subfinder',
    amass: process.env.AMASS_PATH || '/usr/local/bin/amass',
    nuclei: process.env.NUCLEI_PATH || '/usr/local/bin/nuclei',
    httpx: process.env.HTTPX_PATH || '/usr/local/bin/httpx',
    katana: process.env.KATANA_PATH || '/usr/local/bin/katana',
    naabu: process.env.NAABU_PATH || '/usr/local/bin/naabu',
    dnsx: process.env.DNSX_PATH || '/usr/local/bin/dnsx',
    tlsx: process.env.TLSX_PATH || '/usr/local/bin/tlsx',
    shuffledns: process.env.SHUFFLEDNS_PATH || '/usr/local/bin/shuffledns',
    massdns: process.env.MASSDNS_PATH || '/usr/local/bin/massdns',
    nucleiTemplates: process.env.NUCLEI_TEMPLATES_PATH || '/app/tools/templates/nuclei',
    wordlists: process.env.WORDLIST_PATH || '/app/tools/wordlists',
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
  },
};

export default config;
