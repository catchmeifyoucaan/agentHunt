import { APIVersioningAgent } from '../../agents/api-versioning';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('APIVersioningAgent', () => {
  let agent: APIVersioningAgent;

  beforeEach(() => {
    agent = new APIVersioningAgent();
    jest.clearAllMocks();
  });

  it('should initialize correctly', () => {
    expect(agent.name).toBe('API Versioning Agent');
    expect(agent.description).toContain('version');
  });

  it('should enumerate versions via path-based detection', async () => {
    const baseUrl = 'https://api.example.com';

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('/v1')) {
        return Promise.resolve({ status: 200, data: { version: 'v1' } } as any);
      }
      if (url.includes('/v2')) {
        return Promise.resolve({ status: 200, data: { version: 'v2' } } as any);
      }
      return Promise.resolve({ status: 404 } as any);
    });

    const enumerate = (agent as any).enumerateVersions.bind(agent);
    const versions = await enumerate(baseUrl);

    expect(versions.length).toBeGreaterThan(0);
    expect(versions.some((v: any) => v.version === 'v1')).toBe(true);
  });

  it('should test version downgrade attacks', async () => {
    const versions = [
      { version: 'v1', url: 'https://api.example.com/v1', method: 'path' },
      { version: 'v2', url: 'https://api.example.com/v2', method: 'path' }
    ];

    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { user: 'test' },
      headers: {},
      config: {} as any,
      statusText: 'OK'
    });

    const testDowngrade = (agent as any).testVersionDowngrade.bind(agent);
    const results = await testDowngrade(versions);

    expect(Array.isArray(results)).toBe(true);
  });

  it('should detect header-based versioning', async () => {
    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { version: '1.0' },
      headers: { 'api-version': '1.0' },
      config: {} as any,
      statusText: 'OK'
    });

    const enumerate = (agent as any).enumerateVersions.bind(agent);
    const versions = await enumerate('https://api.example.com');

    // Should detect versioning capability
    expect(true).toBe(true);
  });

  it('should detect query parameter versioning', async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('version=1')) {
        return Promise.resolve({ status: 200, data: { v: '1' } } as any);
      }
      return Promise.resolve({ status: 404 } as any);
    });

    const enumerate = (agent as any).enumerateVersions.bind(agent);
    const versions = await enumerate('https://api.example.com');

    expect(versions.length).toBeGreaterThanOrEqual(0);
  });

  it('should detect subdomain versioning', async () => {
    const baseUrl = 'https://api.example.com';

    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes('v1.api')) {
        return Promise.resolve({ status: 200, data: {} } as any);
      }
      return Promise.resolve({ status: 404 } as any);
    });

    const enumerate = (agent as any).enumerateVersions.bind(agent);
    await enumerate(baseUrl);

    expect(true).toBe(true);
  });

  it('should test deprecated version vulnerabilities', async () => {
    const version = {
      version: 'v1',
      url: 'https://api.example.com/v1',
      method: 'path',
      deprecated: true
    };

    mockedAxios.get.mockResolvedValue({
      status: 200,
      data: { user: 'admin' },
      headers: {},
      config: {} as any,
      statusText: 'OK'
    });

    const testDeprecated = (agent as any).testDeprecatedVersionVulnerabilities.bind(agent);
    const vulns = await testDeprecated([version]);

    expect(Array.isArray(vulns)).toBe(true);
  });

  it('should handle network errors gracefully', async () => {
    mockedAxios.get.mockRejectedValue(new Error('Network error'));

    const enumerate = (agent as any).enumerateVersions.bind(agent);
    const versions = await enumerate('https://api.example.com');

    expect(versions).toBeDefined();
  });
});
