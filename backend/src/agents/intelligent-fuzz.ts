import { BaseAgent } from './base-agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
import Logger from '../utils/logger';

const execAsync = promisify(exec);

interface FuzzConfig {
  mode?: 'directory' | 'subdomain' | 'vhost' | 'parameter' | 'all';
  threads?: number;
  wordlistSize?: 'small' | 'medium' | 'large' | 'intelligent';
  depth?: number;
  extensions?: string[];
  filterStatusCodes?: number[];
  intelligentMutation?: boolean;
}

interface TargetFingerprint {
  cms?: string;
  framework?: string;
  language?: string;
  server?: string;
  technologies: string[];
  customPaths: string[];
}

interface FuzzResult {
  url: string;
  statusCode: number;
  size: number;
  words: number;
  lines: number;
  redirectLocation?: string;
  contentType?: string;
}

export class IntelligentFuzzAgent extends BaseAgent {
  name = 'Intelligent Fuzz Agent';
  description = 'Context-aware web fuzzing with intelligent wordlist generation, target fingerprinting, and ffuf integration';

  private seclistsPath = '/usr/share/seclists'; // Default SecLists path
  private tempDir = '/tmp/agenthunt-fuzz';

  // Technology-specific paths for intelligent wordlist generation
  private techSpecificPaths: Record<string, string[]> = {
    'WordPress': [
      'wp-admin', 'wp-content', 'wp-includes', 'wp-json', 'xmlrpc.php',
      'wp-login.php', 'wp-config.php', 'wp-cron.php', 'readme.html',
      'wp-content/uploads', 'wp-content/plugins', 'wp-content/themes',
      'wp-admin/admin-ajax.php', 'wp-admin/install.php'
    ],
    'Drupal': [
      'admin', 'user', 'node', 'sites/default', 'modules', 'themes',
      'core', 'profiles', 'CHANGELOG.txt', 'install.php', 'update.php',
      'sites/default/files', 'sites/default/settings.php'
    ],
    'Joomla': [
      'administrator', 'components', 'modules', 'plugins', 'templates',
      'images', 'includes', 'language', 'libraries', 'configuration.php',
      'htaccess.txt', 'web.config.txt'
    ],
    'Laravel': [
      'api', 'storage', 'public', 'bootstrap', 'vendor', 'routes',
      'app', 'config', 'database', 'resources', '.env', 'artisan',
      'storage/logs', 'storage/framework', 'public/index.php'
    ],
    'Django': [
      'admin', 'api', 'static', 'media', 'manage.py', 'settings.py',
      'urls.py', 'wsgi.py', 'asgi.py', '__pycache__', 'migrations',
      'templates', 'staticfiles'
    ],
    'Express': [
      'api', 'routes', 'public', 'views', 'node_modules', 'package.json',
      'server.js', 'app.js', 'index.js', 'config', 'middleware',
      'controllers', 'models'
    ],
    'Spring': [
      'actuator', 'api', 'swagger-ui', 'h2-console', 'admin',
      'management', 'health', 'metrics', 'env', 'mappings',
      'WEB-INF', 'META-INF', 'static', 'templates'
    ],
    'ASP.NET': [
      'api', 'Account', 'Admin', 'bin', 'Content', 'Scripts',
      'Views', 'App_Data', 'App_Start', 'web.config', 'Global.asax',
      'packages.config', 'Web.Debug.config'
    ],
    'Ruby on Rails': [
      'admin', 'api', 'assets', 'public', 'config', 'db', 'log',
      'tmp', 'vendor', 'Gemfile', 'config.ru', 'Rakefile',
      'app/controllers', 'app/models', 'app/views'
    ],
    'React': [
      'static', 'assets', 'public', 'build', 'dist', 'node_modules',
      'manifest.json', 'robots.txt', 'sitemap.xml', 'favicon.ico',
      'index.html', '/_next', '/static/js', '/static/css'
    ],
    'Angular': [
      'assets', 'main.js', 'polyfills.js', 'runtime.js', 'styles.css',
      'index.html', 'favicon.ico', 'manifest.webmanifest', '3rdpartylicenses.txt'
    ],
    'Vue.js': [
      'js', 'css', 'img', 'fonts', 'static', 'dist', 'index.html',
      'manifest.json', 'service-worker.js'
    ],
    'Generic API': [
      'api', 'v1', 'v2', 'v3', 'graphql', 'rest', 'swagger',
      'openapi.json', 'api-docs', 'docs', 'health', 'status',
      'version', 'ping', 'metrics', 'admin', 'debug'
    ]
  };

  // Common file extensions by technology
  private techExtensions: Record<string, string[]> = {
    'PHP': ['php', 'php3', 'php4', 'php5', 'phtml', 'inc'],
    'ASP.NET': ['aspx', 'asp', 'ashx', 'asmx', 'cshtml'],
    'JSP': ['jsp', 'jspx', 'jsw', 'jsv', 'jspf'],
    'Python': ['py', 'pyc', 'pyo', 'pyw'],
    'Ruby': ['rb', 'erb', 'rhtml'],
    'JavaScript': ['js', 'jsx', 'mjs', 'json'],
    'Config': ['conf', 'config', 'cfg', 'ini', 'yaml', 'yml', 'toml', 'env'],
    'Backup': ['bak', 'backup', 'old', 'orig', 'save', 'swp', '~'],
    'Database': ['sql', 'db', 'sqlite', 'sqlite3', 'mdb'],
    'Archive': ['zip', 'tar', 'gz', 'bz2', '7z', 'rar']
  };

  async getSteps(config?: FuzzConfig): Promise<string[]> {
    return [
      '🔍 Fingerprinting target (CMS, framework, language, server)',
      '📝 Generating intelligent wordlists based on detected technologies',
      '🎯 Mutating wordlists with millions of variations',
      '📚 Loading SecLists base wordlists',
      '⚡ Running ffuf with optimized settings',
      '🔎 Directory fuzzing with context-aware paths',
      '🌐 Subdomain/vhost enumeration (if enabled)',
      '🔧 Parameter fuzzing (if enabled)',
      '🧹 Filtering false positives and noise',
      '🤝 Triggering handoff to relevant agents',
    ];
  }

  async process(job: any): Promise<void> {
    const { target, config = {} } = job.data as { target: string; config?: FuzzConfig };

    Logger.info(`[${this.name}] Starting intelligent fuzzing on ${target}`);

    try {
      // Step 1: Fingerprint target
      const fingerprint = await this.fingerprintTarget(target);
      Logger.info(`[${this.name}] Detected technologies: ${fingerprint.technologies.join(', ')}`);

      // Step 2: Generate intelligent wordlist
      const wordlistPath = await this.generateIntelligentWordlist(target, fingerprint, config);
      Logger.info(`[${this.name}] Generated wordlist: ${wordlistPath}`);

      // Step 3: Run fuzzing based on mode
      const results: FuzzResult[] = [];

      const mode = config.mode || 'all';

      if (mode === 'directory' || mode === 'all') {
        const dirResults = await this.fuzzDirectories(target, wordlistPath, fingerprint, config);
        results.push(...dirResults);
      }

      if (mode === 'subdomain' || mode === 'all') {
        const subdomainResults = await this.fuzzSubdomains(target, wordlistPath, config);
        results.push(...subdomainResults);
      }

      if (mode === 'vhost' || mode === 'all') {
        const vhostResults = await this.fuzzVhosts(target, wordlistPath, config);
        results.push(...vhostResults);
      }

      if (mode === 'parameter' || mode === 'all') {
        const paramResults = await this.fuzzParameters(target, wordlistPath, config);
        results.push(...paramResults);
      }

      Logger.info(`[${this.name}] Found ${results.length} fuzzing results`);

      // Step 4: Analyze and categorize results
      const analyzed = await this.analyzeResults(results, fingerprint);

      // Step 5: Store findings
      await this.storeFindings(job, analyzed);

      // Step 6: Trigger handoffs for interesting findings
      const criticalPaths = analyzed.filter(r =>
        r.statusCode === 200 ||
        r.statusCode === 403 ||
        r.url.includes('admin') ||
        r.url.includes('api') ||
        r.url.includes('config')
      );

      if (criticalPaths.length > 0) {
        await this.triggerHandoff(job, 'scanner', {
          reason: `Found ${criticalPaths.length} interesting paths via intelligent fuzzing`,
          findings: criticalPaths,
        });
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error during fuzzing: ${error}`);
      throw error;
    } finally {
      // Cleanup temp files
      await this.cleanup();
    }
  }

  private async fingerprintTarget(target: string): Promise<TargetFingerprint> {
    const fingerprint: TargetFingerprint = {
      technologies: [],
      customPaths: []
    };

    try {
      const response = await axios.get(target, {
        timeout: 10000,
        validateStatus: () => true,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgentHunt/1.0)' }
      });

      const headers = response.headers;
      const body = response.data;

      // Detect server
      if (headers['server']) {
        fingerprint.server = headers['server'];
        if (headers['server'].toLowerCase().includes('apache')) {
          fingerprint.technologies.push('Apache');
        } else if (headers['server'].toLowerCase().includes('nginx')) {
          fingerprint.technologies.push('Nginx');
        }
      }

      // Detect CMS
      if (body.includes('wp-content') || body.includes('wp-includes')) {
        fingerprint.cms = 'WordPress';
        fingerprint.technologies.push('WordPress');
      } else if (body.includes('/sites/default') || body.includes('Drupal')) {
        fingerprint.cms = 'Drupal';
        fingerprint.technologies.push('Drupal');
      } else if (body.includes('/administrator') && body.includes('Joomla')) {
        fingerprint.cms = 'Joomla';
        fingerprint.technologies.push('Joomla');
      }

      // Detect framework
      if (headers['x-powered-by']) {
        const poweredBy = headers['x-powered-by'].toLowerCase();
        if (poweredBy.includes('php')) {
          fingerprint.language = 'PHP';
          fingerprint.technologies.push('PHP');
        } else if (poweredBy.includes('asp.net')) {
          fingerprint.framework = 'ASP.NET';
          fingerprint.technologies.push('ASP.NET');
        } else if (poweredBy.includes('express')) {
          fingerprint.framework = 'Express';
          fingerprint.technologies.push('Express');
        }
      }

      // Detect JavaScript frameworks
      if (body.includes('_next') || body.includes('Next.js')) {
        fingerprint.technologies.push('Next.js');
        fingerprint.technologies.push('React');
      } else if (body.includes('__NUXT__')) {
        fingerprint.technologies.push('Nuxt.js');
        fingerprint.technologies.push('Vue.js');
      } else if (body.includes('ng-version') || body.includes('Angular')) {
        fingerprint.technologies.push('Angular');
      } else if (body.includes('react')) {
        fingerprint.technologies.push('React');
      } else if (body.includes('vue')) {
        fingerprint.technologies.push('Vue.js');
      }

      // Detect API patterns
      if (body.includes('graphql') || body.includes('GraphQL')) {
        fingerprint.technologies.push('GraphQL');
      }
      if (body.includes('swagger') || body.includes('openapi')) {
        fingerprint.technologies.push('OpenAPI');
      }

      // Detect cloud platforms
      if (headers['x-amz-cf-id'] || headers['x-amz-request-id']) {
        fingerprint.technologies.push('AWS');
      } else if (headers['x-goog-'] || body.includes('googleapis')) {
        fingerprint.technologies.push('GCP');
      } else if (headers['x-azure-'] || body.includes('azurewebsites')) {
        fingerprint.technologies.push('Azure');
      }

    } catch (error) {
      Logger.warn(`[${this.name}] Error fingerprinting target: ${error}`);
    }

    // If no specific tech detected, add generic
    if (fingerprint.technologies.length === 0) {
      fingerprint.technologies.push('Generic API');
    }

    return fingerprint;
  }

  private async generateIntelligentWordlist(
    target: string,
    fingerprint: TargetFingerprint,
    config: FuzzConfig
  ): Promise<string> {
    await fs.mkdir(this.tempDir, { recursive: true });

    const wordlistPath = path.join(this.tempDir, `wordlist-${Date.now()}.txt`);
    const words = new Set<string>();

    // 1. Add technology-specific paths
    for (const tech of fingerprint.technologies) {
      const techPaths = this.techSpecificPaths[tech] || [];
      techPaths.forEach(p => words.add(p));
    }

    // 2. Add SecLists base wordlists
    const seclistsWords = await this.loadSecLists(config);
    seclistsWords.forEach(w => words.add(w));

    // 3. Generate mutations if enabled
    if (config.intelligentMutation !== false) {
      const mutations = await this.generateMutations(Array.from(words), fingerprint);
      mutations.forEach(m => words.add(m));
    }

    // 4. Add common paths
    const commonPaths = [
      'admin', 'api', 'backup', 'config', 'dashboard', 'login', 'logout',
      'upload', 'uploads', 'download', 'test', 'dev', 'staging', 'prod',
      'old', 'new', 'tmp', 'temp', 'debug', 'secret', 'private', 'internal',
      'assets', 'static', 'public', 'images', 'img', 'css', 'js', 'vendor',
      'data', 'db', 'database', 'sql', 'backup', 'bak', '.git', '.env'
    ];
    commonPaths.forEach(p => words.add(p));

    // Write to file
    await fs.writeFile(wordlistPath, Array.from(words).join('\n'));

    Logger.info(`[${this.name}] Generated ${words.size} unique paths in wordlist`);

    return wordlistPath;
  }

  private async loadSecLists(config: FuzzConfig): Promise<string[]> {
    const words: string[] = [];

    try {
      const wordlistSize = config.wordlistSize || 'medium';
      let seclistFile: string;

      switch (wordlistSize) {
        case 'small':
          seclistFile = `${this.seclistsPath}/Discovery/Web-Content/common.txt`;
          break;
        case 'large':
          seclistFile = `${this.seclistsPath}/Discovery/Web-Content/directory-list-2.3-big.txt`;
          break;
        case 'intelligent':
          seclistFile = `${this.seclistsPath}/Discovery/Web-Content/raft-large-directories.txt`;
          break;
        default:
          seclistFile = `${this.seclistsPath}/Discovery/Web-Content/directory-list-2.3-medium.txt`;
      }

      const content = await fs.readFile(seclistFile, 'utf-8');
      const lines = content.split('\n').filter(l => l && !l.startsWith('#'));
      words.push(...lines);

    } catch (error) {
      Logger.warn(`[${this.name}] Could not load SecLists: ${error}`);
      // Fallback to basic wordlist
      words.push('admin', 'api', 'test', 'backup', 'config', 'login');
    }

    return words;
  }

  private async generateMutations(words: string[], fingerprint: TargetFingerprint): Promise<string[]> {
    const mutations = new Set<string>();
    const maxMutations = 100000; // Limit to prevent explosion

    for (const word of words.slice(0, 1000)) { // Mutate first 1000 words
      if (mutations.size >= maxMutations) break;

      // Add common suffixes
      ['2', '1', 'old', 'new', 'bak', 'backup', 'tmp', 'test', 'dev', 'prod'].forEach(suffix => {
        mutations.add(`${word}${suffix}`);
        mutations.add(`${word}-${suffix}`);
        mutations.add(`${word}_${suffix}`);
      });

      // Add common prefixes
      ['old', 'new', 'test', 'dev', 'backup'].forEach(prefix => {
        mutations.add(`${prefix}${word}`);
        mutations.add(`${prefix}-${word}`);
        mutations.add(`${prefix}_${word}`);
      });

      // Case variations
      mutations.add(word.toUpperCase());
      mutations.add(word.charAt(0).toUpperCase() + word.slice(1));

      // Add year suffixes (for versioning)
      ['2023', '2024', '2025', 'v1', 'v2', 'v3'].forEach(version => {
        mutations.add(`${word}${version}`);
        mutations.add(`${word}-${version}`);
      });
    }

    return Array.from(mutations);
  }

  private async fuzzDirectories(
    target: string,
    wordlistPath: string,
    fingerprint: TargetFingerprint,
    config: FuzzConfig
  ): Promise<FuzzResult[]> {
    const results: FuzzResult[] = [];

    try {
      const threads = config.threads || 100;
      const extensions = config.extensions || this.getExtensions(fingerprint);
      const filterCodes = config.filterStatusCodes || [404];

      const extString = extensions.length > 0 ? `-e ${extensions.join(',')}` : '';
      const filterString = `-fc ${filterCodes.join(',')}`;

      const command = `ffuf -u ${target}/FUZZ ${extString} -w ${wordlistPath} -t ${threads} ${filterString} -o ${this.tempDir}/ffuf-results.json -of json -s 2>&1`;

      Logger.info(`[${this.name}] Running: ${command}`);

      const { stdout } = await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });

      // Parse results
      const resultFile = `${this.tempDir}/ffuf-results.json`;
      const resultData = await fs.readFile(resultFile, 'utf-8');
      const ffufResults = JSON.parse(resultData);

      if (ffufResults.results) {
        for (const result of ffufResults.results) {
          results.push({
            url: result.url,
            statusCode: result.status,
            size: result.length,
            words: result.words,
            lines: result.lines,
            redirectLocation: result.redirectlocation,
            contentType: result['content-type']
          });
        }
      }

    } catch (error) {
      Logger.error(`[${this.name}] Directory fuzzing error: ${error}`);
    }

    return results;
  }

  private async fuzzSubdomains(target: string, wordlistPath: string, config: FuzzConfig): Promise<FuzzResult[]> {
    const results: FuzzResult[] = [];

    try {
      const domain = new URL(target).hostname;
      const threads = config.threads || 100;

      const command = `ffuf -u https://FUZZ.${domain} -w ${wordlistPath} -t ${threads} -mc 200,301,302,403 -o ${this.tempDir}/subdomain-results.json -of json -s 2>&1`;

      await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });

      const resultFile = `${this.tempDir}/subdomain-results.json`;
      const resultData = await fs.readFile(resultFile, 'utf-8');
      const ffufResults = JSON.parse(resultData);

      if (ffufResults.results) {
        for (const result of ffufResults.results) {
          results.push({
            url: result.url,
            statusCode: result.status,
            size: result.length,
            words: result.words,
            lines: result.lines
          });
        }
      }

    } catch (error) {
      Logger.error(`[${this.name}] Subdomain fuzzing error: ${error}`);
    }

    return results;
  }

  private async fuzzVhosts(target: string, wordlistPath: string, config: FuzzConfig): Promise<FuzzResult[]> {
    const results: FuzzResult[] = [];

    try {
      const domain = new URL(target).hostname;
      const threads = config.threads || 100;

      const command = `ffuf -u ${target} -H "Host: FUZZ.${domain}" -w ${wordlistPath} -t ${threads} -mc 200,301,302,403 -o ${this.tempDir}/vhost-results.json -of json -s 2>&1`;

      await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });

      const resultFile = `${this.tempDir}/vhost-results.json`;
      const resultData = await fs.readFile(resultFile, 'utf-8');
      const ffufResults = JSON.parse(resultData);

      if (ffufResults.results) {
        for (const result of ffufResults.results) {
          results.push({
            url: result.url,
            statusCode: result.status,
            size: result.length,
            words: result.words,
            lines: result.lines
          });
        }
      }

    } catch (error) {
      Logger.error(`[${this.name}] Vhost fuzzing error: ${error}`);
    }

    return results;
  }

  private async fuzzParameters(target: string, wordlistPath: string, config: FuzzConfig): Promise<FuzzResult[]> {
    const results: FuzzResult[] = [];

    try {
      const threads = config.threads || 100;

      const command = `ffuf -u "${target}?FUZZ=test" -w ${wordlistPath} -t ${threads} -mc 200,301,302,403,500 -o ${this.tempDir}/param-results.json -of json -s 2>&1`;

      await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });

      const resultFile = `${this.tempDir}/param-results.json`;
      const resultData = await fs.readFile(resultFile, 'utf-8');
      const ffufResults = JSON.parse(resultData);

      if (ffufResults.results) {
        for (const result of ffufResults.results) {
          results.push({
            url: result.url,
            statusCode: result.status,
            size: result.length,
            words: result.words,
            lines: result.lines
          });
        }
      }

    } catch (error) {
      Logger.error(`[${this.name}] Parameter fuzzing error: ${error}`);
    }

    return results;
  }

  private getExtensions(fingerprint: TargetFingerprint): string[] {
    const extensions = new Set<string>();

    for (const tech of fingerprint.technologies) {
      const techExts = this.techExtensions[tech] || [];
      techExts.forEach(ext => extensions.add(ext));
    }

    // Add common extensions
    ['html', 'htm', 'txt', 'xml', 'json'].forEach(ext => extensions.add(ext));

    return Array.from(extensions);
  }

  private async analyzeResults(results: FuzzResult[], fingerprint: TargetFingerprint): Promise<any[]> {
    return results.map(result => ({
      agent: this.name,
      type: 'Fuzzing Discovery',
      url: result.url,
      statusCode: result.statusCode,
      size: result.size,
      severity: this.calculateSeverity(result),
      technologies: fingerprint.technologies,
      timestamp: new Date().toISOString()
    }));
  }

  private calculateSeverity(result: FuzzResult): 'info' | 'low' | 'medium' | 'high' | 'critical' {
    if (result.url.includes('admin') || result.url.includes('config') || result.url.includes('.env')) {
      return 'high';
    }
    if (result.statusCode === 403) {
      return 'medium';
    }
    if (result.statusCode === 200) {
      return 'low';
    }
    return 'info';
  }

  private async storeFindings(job: any, findings: any[]): Promise<void> {
    if (job.sharedMemory) {
      await job.sharedMemory.storeFindings(this.name, findings);
    }
    Logger.info(`[${this.name}] Stored ${findings.length} findings`);
  }

  private async triggerHandoff(job: any, targetAgent: string, context: any): Promise<void> {
    Logger.info(`[${this.name}] Triggering handoff to ${targetAgent}`);
    if (job.handoff) {
      await job.handoff(targetAgent, {
        sourceAgent: this.name,
        reason: context.reason,
        findings: context.findings,
        timestamp: new Date().toISOString(),
      });
    }
  }

  private async cleanup(): Promise<void> {
    try {
      await fs.rm(this.tempDir, { recursive: true, force: true });
    } catch (error) {
      Logger.warn(`[${this.name}] Cleanup failed: ${error}`);
    }
  }
}

export default IntelligentFuzzAgent;
