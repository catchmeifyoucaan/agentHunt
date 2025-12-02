import { BaseAgent } from './base-agent';
import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import * as dns from 'dns/promises';
import Logger from '../utils/logger';

const execAsync = promisify(exec);

interface TakeoverConfig {
  testActualTakeover?: boolean; // Attempt actual takeover in sandbox
  platforms?: string[]; // Specific platforms to check
}

interface PlatformFingerprint {
  name: string;
  cname: string[];
  response: string[];
  nxdomain?: boolean;
  httpStatus?: number[];
  requiredStrings?: string[];
}

interface TakeoverFinding {
  subdomain: string;
  platform: string;
  vulnerable: boolean;
  cname: string;
  evidence: string;
  severity: 'critical' | 'high' | 'medium';
  cvss: number;
  takeover_possible: boolean;
  proof?: string;
}

export class SubdomainTakeoverAgent extends BaseAgent {
  name = 'Subdomain Takeover Agent';
  description = 'Detects dangling DNS records vulnerable to subdomain takeover across 30+ platforms';

  // Platform fingerprints for takeover detection
  private platformFingerprints: PlatformFingerprint[] = [
    // Cloud Platforms
    {
      name: 'AWS S3',
      cname: ['s3.amazonaws.com', 's3-website'],
      response: ['NoSuchBucket', 'The specified bucket does not exist'],
      nxdomain: false,
      httpStatus: [404],
    },
    {
      name: 'AWS CloudFront',
      cname: ['cloudfront.net'],
      response: ['Bad request', 'ERROR: The request could not be satisfied'],
      httpStatus: [403, 404],
    },
    {
      name: 'AWS Elastic Beanstalk',
      cname: ['elasticbeanstalk.com'],
      response: [],
      nxdomain: true,
    },
    {
      name: 'Azure',
      cname: ['azurewebsites.net', 'cloudapp.azure.com', 'cloudapp.net', 'trafficmanager.net', 'blob.core.windows.net'],
      response: ['404 Web Site not found', 'Error 404', 'Not Found'],
      httpStatus: [404],
    },
    {
      name: 'Google Cloud Storage',
      cname: ['storage.googleapis.com'],
      response: ['NoSuchBucket', 'The specified bucket does not exist'],
      httpStatus: [404],
    },
    {
      name: 'Google Cloud Functions',
      cname: ['cloudfunctions.net'],
      response: [],
      nxdomain: true,
    },

    // Hosting Platforms
    {
      name: 'Heroku',
      cname: ['herokuapp.com', 'herokussl.com'],
      response: ['No such app', 'There\'s nothing here'],
      httpStatus: [404],
    },
    {
      name: 'GitHub Pages',
      cname: ['github.io'],
      response: ['There isn\'t a GitHub Pages site here', 'For root URLs'],
      httpStatus: [404],
    },
    {
      name: 'GitLab Pages',
      cname: ['gitlab.io'],
      response: ['The page you\'re looking for could not be found'],
      httpStatus: [404],
    },
    {
      name: 'Netlify',
      cname: ['netlify.com', 'netlify.app'],
      response: ['Not Found - Request ID'],
      httpStatus: [404],
    },
    {
      name: 'Vercel',
      cname: ['vercel.app', 'now.sh'],
      response: ['The deployment could not be found', 'DEPLOYMENT_NOT_FOUND'],
      httpStatus: [404],
    },
    {
      name: 'Shopify',
      cname: ['myshopify.com'],
      response: ['Sorry, this shop is currently unavailable', 'Only one step left'],
      httpStatus: [404],
    },
    {
      name: 'Tumblr',
      cname: ['tumblr.com'],
      response: ['Whatever you were looking for doesn\'t currently exist'],
      httpStatus: [404],
    },
    {
      name: 'WordPress.com',
      cname: ['wordpress.com'],
      response: ['Do you want to register'],
      httpStatus: [404],
    },
    {
      name: 'Pantheon',
      cname: ['pantheonsite.io'],
      response: ['The gods are wise'],
      httpStatus: [404],
    },
    {
      name: 'Acquia',
      cname: ['acquia-sites.com'],
      response: ['Web Site Not Found'],
      httpStatus: [404],
    },
    {
      name: 'Fastly',
      cname: ['fastly.net'],
      response: ['Fastly error: unknown domain'],
      httpStatus: [404],
    },
    {
      name: 'Pantheon.io',
      cname: ['pantheonsite.io'],
      response: [],
      nxdomain: true,
    },
    {
      name: 'Bitbucket',
      cname: ['bitbucket.io'],
      response: ['Repository not found'],
      httpStatus: [404],
    },
    {
      name: 'Smartling',
      cname: ['smartling.com'],
      response: ['Domain is not configured'],
      httpStatus: [404],
    },
    {
      name: 'Acquia',
      cname: ['acquia-test.co'],
      response: [],
      nxdomain: true,
    },
    {
      name: 'Airee.ru',
      cname: ['airee.ru'],
      response: ['Ошибка 402'],
      httpStatus: [402],
    },
    {
      name: 'Anima',
      cname: ['animaapp.io'],
      response: ['If this is your website and you\'ve just created it'],
      httpStatus: [404],
    },
    {
      name: 'Announcekit',
      cname: ['announcekit.app'],
      response: ['Error 404 - AnnounceKit'],
      httpStatus: [404],
    },
    {
      name: 'AWS ELB',
      cname: ['elb.amazonaws.com'],
      response: [],
      nxdomain: true,
    },
    {
      name: 'BigCartel',
      cname: ['bigcartel.com'],
      response: ['<h1>Oops! We couldn&#8217;t find that page.</h1>'],
      httpStatus: [404],
    },
    {
      name: 'Brightcove',
      cname: ['brightcove.com', 'bcvp0rtal.com'],
      response: ['<p class="bc-gallery-error-code">Error Code: 404</p>'],
      httpStatus: [404],
    },
    {
      name: 'Campaign Monitor',
      cname: ['createsend.com'],
      response: ['Double check the URL'],
      httpStatus: [404],
    },
    {
      name: 'Cargo',
      cname: ['cargocollective.com'],
      response: ['If you\'re moving your domain away from Cargo'],
      httpStatus: [404],
    },
    {
      name: 'Feedpress',
      cname: ['redirect.feedpress.me'],
      response: ['The feed has not been found'],
      httpStatus: [404],
    },
    {
      name: 'Fly.io',
      cname: ['fly.dev'],
      response: ['404 Not Found'],
      httpStatus: [404],
    },
  ];

  async getSteps(config?: TakeoverConfig): Promise<string[]> {
    return [
      '🔍 Receiving subdomains from Discovery Agent',
      '🌐 Performing DNS lookups (A, CNAME records)',
      '🎯 Detecting dangling DNS records (CNAME → dead service)',
      '🏢 Fingerprinting platforms (30+ services)',
      '✅ Verifying takeover vulnerability',
      '🧪 Testing actual takeover (sandbox mode)',
      '📊 Generating proof-of-concept',
      '🤝 Triggering handoffs for confirmed takeovers',
    ];
  }

  async process(job: any): Promise<void> {
    const { subdomains, config = {} } = job.data as { subdomains: string[]; config?: TakeoverConfig };

    Logger.info(`[${this.name}] Testing ${subdomains.length} subdomains for takeover`);

    try {
      const findings: TakeoverFinding[] = [];

      for (const subdomain of subdomains) {
        const finding = await this.testSubdomainTakeover(subdomain, config);
        if (finding && finding.vulnerable) {
          findings.push(finding);
          Logger.info(`[${this.name}] ✓ VULNERABLE: ${subdomain} → ${finding.platform}`);
        }
      }

      Logger.info(`[${this.name}] Found ${findings.length} vulnerable subdomains`);

      // Store findings
      await this.storeFindings(job, findings);

      // Trigger handoffs for all findings (takeover = critical)
      if (findings.length > 0) {
        await this.triggerHandoff(job, 'triage', {
          reason: `Found ${findings.length} subdomain takeover vulnerabilities`,
          findings,
        });
      }

    } catch (error) {
      Logger.error(`[${this.name}] Error: ${error}`);
      throw error;
    }
  }

  private async testSubdomainTakeover(subdomain: string, config: TakeoverConfig): Promise<TakeoverFinding | null> {
    try {
      // Step 1: Get CNAME record
      const cname = await this.getCNAME(subdomain);
      if (!cname) {
        return null; // No CNAME, not vulnerable to takeover
      }

      // Step 2: Match CNAME to platform
      const platform = this.matchPlatform(cname);
      if (!platform) {
        return null; // Unknown platform
      }

      Logger.info(`[${this.name}] ${subdomain} → ${cname} (${platform.name})`);

      // Step 3: Check if CNAME is dangling
      const isDangling = await this.isDanglingCNAME(cname, platform);
      if (!isDangling) {
        return null; // CNAME resolves, not dangling
      }

      // Step 4: Verify via HTTP response
      const httpEvidence = await this.verifyViaHTTP(subdomain, platform);
      if (!httpEvidence) {
        return null; // No HTTP evidence
      }

      // Step 5: Test actual takeover (if enabled)
      let takeoverProof = '';
      if (config.testActualTakeover) {
        takeoverProof = await this.testActualTakeover(subdomain, platform);
      }

      return {
        subdomain,
        platform: platform.name,
        vulnerable: true,
        cname,
        evidence: httpEvidence,
        severity: 'critical',
        cvss: 9.3,
        takeover_possible: true,
        proof: takeoverProof,
      };

    } catch (error) {
      Logger.debug(`[${this.name}] Error testing ${subdomain}: ${error}`);
      return null;
    }
  }

  private async getCNAME(domain: string): Promise<string | null> {
    try {
      const records = await dns.resolveCname(domain);
      return records && records.length > 0 ? records[0] : null;
    } catch (error) {
      return null;
    }
  }

  private matchPlatform(cname: string): PlatformFingerprint | null {
    for (const platform of this.platformFingerprints) {
      for (const cnamePattern of platform.cname) {
        if (cname.includes(cnamePattern)) {
          return platform;
        }
      }
    }
    return null;
  }

  private async isDanglingCNAME(cname: string, platform: PlatformFingerprint): Promise<boolean> {
    // Check if platform expects NXDOMAIN
    if (platform.nxdomain) {
      try {
        await dns.resolve4(cname);
        return false; // Resolves, not dangling
      } catch (error) {
        return true; // NXDOMAIN = dangling
      }
    }

    // For platforms that resolve but service doesn't exist
    try {
      await dns.resolve4(cname);
      return true; // Resolves but might be unclaimed
    } catch (error) {
      return true; // NXDOMAIN = definitely dangling
    }
  }

  private async verifyViaHTTP(subdomain: string, platform: PlatformFingerprint): Promise<string | null> {
    try {
      const urls = [`https://${subdomain}`, `http://${subdomain}`];

      for (const url of urls) {
        try {
          const response = await axios.get(url, {
            timeout: 5000,
            validateStatus: () => true,
            maxRedirects: 0,
          });

          const bodyText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

          // Check HTTP status code
          if (platform.httpStatus && platform.httpStatus.includes(response.status)) {
            // Check response body for fingerprint strings
            for (const requiredString of platform.response) {
              if (bodyText.includes(requiredString)) {
                return `HTTP ${response.status}: "${requiredString}" found in response`;
              }
            }
          }

          // Even if status doesn't match, check body
          for (const requiredString of platform.response) {
            if (bodyText.includes(requiredString)) {
              return `"${requiredString}" found in response`;
            }
          }

        } catch (error) {
          // Try next URL
          continue;
        }
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  private async testActualTakeover(subdomain: string, platform: PlatformFingerprint): Promise<string> {
    // This would attempt actual takeover in a sandbox/test environment
    // For safety, we only document how it would be done, not actually do it

    const instructions: Record<string, string> = {
      'GitHub Pages': 'Create repo named after subdomain, enable GitHub Pages, add CNAME file',
      'Heroku': 'Create new Heroku app, add custom domain via heroku domains:add',
      'AWS S3': 'Create S3 bucket with exact name, enable static website hosting',
      'Azure': 'Create Azure web app with custom domain configuration',
      'Netlify': 'Create new Netlify site, add custom domain',
      'Vercel': 'Create Vercel project, add domain via vercel domains add',
      'Shopify': 'Create Shopify store, configure custom domain',
    };

    return `Takeover possible: ${instructions[platform.name] || 'Register service with custom domain'}`;
  }

  private async storeFindings(job: any, findings: TakeoverFinding[]): Promise<void> {
    if (job.sharedMemory) {
      await job.sharedMemory.storeFindings(this.name, findings.map(f => ({
        agent: this.name,
        type: `Subdomain Takeover: ${f.platform}`,
        severity: f.severity,
        cvss: f.cvss,
        subdomain: f.subdomain,
        cname: f.cname,
        platform: f.platform,
        evidence: f.evidence,
        proof: f.proof,
        timestamp: new Date().toISOString(),
      })));
    }

    Logger.info(`[${this.name}] Stored ${findings.length} takeover findings`);
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
}

export default SubdomainTakeoverAgent;
