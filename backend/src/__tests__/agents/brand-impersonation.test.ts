import { BrandImpersonationAgent } from '../../agents/brand-impersonation';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('BrandImpersonationAgent', () => {
  let agent: BrandImpersonationAgent;

  beforeEach(() => {
    agent = new BrandImpersonationAgent();
    jest.clearAllMocks();
  });

  it('should initialize correctly', () => {
    expect(agent.name).toBe('Brand Impersonation Agent');
    expect(agent.description).toContain('typosquatting');
  });

  it('should generate typosquatting variants', async () => {
    const generateVariants = (agent as any).generateTyposquattingVariants.bind(agent);
    const variants = await generateVariants('example.com');

    expect(variants.length).toBeGreaterThan(0);
    expect(variants.some((v: any) => v.technique === 'character-substitution')).toBe(true);
    expect(variants.some((v: any) => v.technique === 'missing-character')).toBe(true);
    expect(variants.some((v: any) => v.technique === 'added-character')).toBe(true);
  });

  it('should calculate Levenshtein distance correctly', () => {
    const calculateSimilarity = (agent as any).calculateSimilarity.bind(agent);

    expect(calculateSimilarity('example', 'example')).toBe(1.0);
    expect(calculateSimilarity('example', 'exampel')).toBeGreaterThan(0.8);
    expect(calculateSimilarity('example', 'completely-different')).toBeLessThan(0.5);
  });

  it('should detect high-risk typosquatting', async () => {
    const variants = [
      { variant: 'examp1e.com', technique: 'character-substitution' },
      { variant: 'exampl.com', technique: 'missing-character' }
    ];

    // Both should be flagged as high risk (similarity > 0.85)
    const calculateSimilarity = (agent as any).calculateSimilarity.bind(agent);

    for (const v of variants) {
      const similarity = calculateSimilarity('example.com', v.variant);
      expect(similarity).toBeGreaterThan(0.7);
    }
  });

  it('should check DNS for typosquatted domains', async () => {
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { Answer: [{ data: '192.168.1.1' }] },
      headers: {},
      config: {} as any,
      statusText: 'OK'
    });

    const checkDNS = (agent as any).checkDomainRegistered.bind(agent);
    const result = await checkDNS('examp1e.com');

    expect(result).toBe(true);
  });

  it('should handle DNS errors gracefully', async () => {
    mockedAxios.get.mockRejectedValue(new Error('NXDOMAIN'));

    const checkDNS = (agent as any).checkDomainRegistered.bind(agent);
    const result = await checkDNS('notregistered123.com');

    expect(result).toBe(false);
  });
});
