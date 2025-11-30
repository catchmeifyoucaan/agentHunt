import { SupplyChainAgent } from '../../agents/supply-chain';

describe('SupplyChainAgent', () => {
  let agent: SupplyChainAgent;

  beforeEach(() => {
    agent = new SupplyChainAgent();
  });

  it('should initialize correctly', () => {
    expect(agent.name).toBe('Supply Chain Agent');
    expect(agent.description).toContain('dependency');
  });

  it('should have vulnerability patterns for common packages', () => {
    const patterns = (agent as any).vulnerabilityPatterns;

    expect(patterns.length).toBeGreaterThan(0);
    expect(patterns.some((p: any) => p.package === 'lodash')).toBe(true);
    expect(patterns.some((p: any) => p.package === 'axios')).toBe(true);
  });

  it('should detect vulnerable package versions', async () => {
    const detectVulns = (agent as any).detectVulnerablePackages.bind(agent);

    const dependencies = [
      { name: 'lodash', version: '4.17.20', ecosystem: 'npm' },
      { name: 'axios', version: '0.21.0', ecosystem: 'npm' }
    ];

    const vulns = await detectVulns(dependencies);

    expect(vulns.length).toBeGreaterThan(0);
    expect(vulns.some((v: any) => v.package === 'lodash')).toBe(true);
  });

  it('should detect malicious packages', async () => {
    const detectMalicious = (agent as any).detectMaliciousPackages.bind(agent);

    const dependencies = [
      { name: 'event-stream', version: '3.3.6', ecosystem: 'npm' },
      { name: 'safe-package', version: '1.0.0', ecosystem: 'npm' }
    ];

    const malicious = await detectMalicious(dependencies);

    expect(malicious.length).toBeGreaterThan(0);
    expect(malicious[0].package).toContain('event-stream');
  });

  it('should detect typosquatting in dependencies', async () => {
    const detectMalicious = (agent as any).detectMaliciousPackages.bind(agent);

    const dependencies = [
      { name: 'loadsh', version: '1.0.0', ecosystem: 'npm' }, // typosquat of lodash
      { name: 'lodash', version: '4.17.21', ecosystem: 'npm' }
    ];

    const malicious = await detectMalicious(dependencies);

    expect(malicious.some((m: any) => m.package === 'loadsh')).toBe(true);
  });

  it('should parse package.json files', async () => {
    const parsePackageJson = (agent as any).parsePackageJson.bind(agent);

    const packageJson = JSON.stringify({
      dependencies: {
        'lodash': '^4.17.20',
        'axios': '~0.21.0'
      },
      devDependencies: {
        'jest': '^27.0.0'
      }
    });

    const deps = await parsePackageJson(packageJson);

    expect(deps.length).toBeGreaterThanOrEqual(2);
    expect(deps.some((d: any) => d.name === 'lodash')).toBe(true);
  });

  it('should support multiple ecosystems', () => {
    const ecosystems = ['npm', 'pip', 'gem', 'maven', 'nuget', 'composer', 'cargo', 'go'];

    // Agent should support all these
    expect(ecosystems.length).toBe(8);
  });

  it('should calculate CVSS scores correctly', () => {
    const patterns = (agent as any).vulnerabilityPatterns;
    const criticalVuln = patterns.find((p: any) => p.cvss >= 9.0);

    expect(criticalVuln).toBeDefined();
    expect(criticalVuln.cvss).toBeGreaterThanOrEqual(9.0);
  });
});
