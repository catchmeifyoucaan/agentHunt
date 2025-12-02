/**
 * Visual Regression Testing Agent
 * Purpose: Screenshot diffing for detecting UI/endpoint changes
 * 
 * Features:
 * - Screenshot baseline creation
 * - Periodic re-screenshots
 * - Image diffing algorithm
 * - Change detection
 * - Alert on significant changes
 * - Detect new admin panels
 * - Find removed endpoints
 */

import { Job } from 'bullmq';
import { BaseAgent } from './base';
import { BaseJob } from '../../../shared/types';
import database from '../services/database';
import logger from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

interface VisualRegressionJob extends BaseJob {
  type: 'visual-regression';
  options: {
    programId: string;
    urls: string[];
    action: 'baseline' | 'compare' | 'full';
    threshold?: number; // Percentage difference threshold (default 5%)
  };
}

interface VisualChange {
  url: string;
  changeType: 'new' | 'removed' | 'modified' | 'error';
  diffPercentage: number;
  description: string;
  screenshotPath?: string;
  diffPath?: string;
}

export class VisualRegressionAgent extends BaseAgent<VisualRegressionJob> {
  constructor() {
    super('visual-regression');
  }

  protected getSteps() {
    return [
      { name: 'Load baseline screenshots' },
      { name: 'Capture current screenshots' },
      { name: 'Compare images' },
      { name: 'Detect changes' },
      { name: 'Generate alerts' },
      { name: 'Update baseline' },
    ];
  }

  async process(job: Job<VisualRegressionJob>): Promise<any> {
    const { programId, options } = job.data;
    const { urls, action, threshold = 5 } = options;

    await this.heartbeat();
    await this.updateJobStatus(job.id!, 'active');

    const changes: VisualChange[] = [];

    try {
      // Step 1: Load baseline
      await this.updateJobProgress(job.id!, {
        current: 1,
        total: 6,
        percentage: 10,
        currentTool: 'baseline-loader',
        toolStatus: 'running',
        message: 'Loading baseline screenshots',
      });

      const baseline = await this.loadBaseline(programId);

      // Step 2: Capture current screenshots
      await this.updateJobProgress(job.id!, {
        current: 2,
        total: 6,
        percentage: 30,
        currentTool: 'screenshot-capture',
        toolStatus: 'running',
        message: `Capturing ${urls.length} screenshots`,
      });

      const currentScreenshots = await this.captureScreenshots(urls, programId);

      // Step 3: Compare images
      await this.updateJobProgress(job.id!, {
        current: 3,
        total: 6,
        percentage: 50,
        currentTool: 'image-compare',
        toolStatus: 'running',
        message: 'Comparing screenshots',
      });

      if (action === 'compare' || action === 'full') {
        const comparisonResults = await this.compareScreenshots(baseline, currentScreenshots, threshold);
        changes.push(...comparisonResults);
      }

      // Step 4: Detect changes
      await this.updateJobProgress(job.id!, {
        current: 4,
        total: 6,
        percentage: 65,
        currentTool: 'change-detector',
        toolStatus: 'running',
        message: 'Analyzing changes',
      });

      // Detect new/removed URLs
      const urlChanges = this.detectUrlChanges(baseline, currentScreenshots);
      changes.push(...urlChanges);

      // Step 5: Generate alerts
      await this.updateJobProgress(job.id!, {
        current: 5,
        total: 6,
        percentage: 80,
        currentTool: 'alert-generator',
        toolStatus: 'running',
        message: 'Generating alerts',
      });

      const significantChanges = changes.filter(c => c.diffPercentage >= threshold || c.changeType === 'new');
      for (const change of significantChanges) {
        await this.storeChange(programId, change, job.id!);
      }

      // Step 6: Update baseline
      if (action === 'baseline' || action === 'full') {
        await this.updateJobProgress(job.id!, {
          current: 6,
          total: 6,
          percentage: 95,
          currentTool: 'baseline-update',
          toolStatus: 'running',
          message: 'Updating baseline',
        });

        await this.updateBaseline(programId, currentScreenshots);
      }

      // Trigger handoffs for significant changes
      if (significantChanges.length > 0) {
        await this.triggerHandoffs(programId, significantChanges, job.id!);
      }

      await this.updateJobProgress(job.id!, {
        current: 6,
        total: 6,
        percentage: 100,
        currentTool: 'complete',
        toolStatus: 'completed',
        message: `Detected ${changes.length} changes`,
      });

      const result = {
        programId,
        urlsProcessed: urls.length,
        totalChanges: changes.length,
        significantChanges: significantChanges.length,
        changes,
      };

      await this.updateJobStatus(job.id!, 'completed', result);
      return result;

    } catch (error: any) {
      logger.error({ error }, 'Visual regression testing failed');
      await this.updateJobStatus(job.id!, 'failed', null, error.message);
      throw error;
    }
  }

  /**
   * Load baseline screenshots from database
   */
  private async loadBaseline(programId: string): Promise<Map<string, any>> {
    const baseline = new Map<string, any>();

    try {
      const result = await database.query(
        'SELECT url, screenshot_path, hash, captured_at FROM visual_baselines WHERE program_id = $1',
        [programId]
      );

      for (const row of result.rows) {
        baseline.set(row.url, {
          path: row.screenshot_path,
          hash: row.hash,
          capturedAt: row.captured_at,
        });
      }
    } catch (error) {
      logger.debug({ error }, 'Failed to load baseline');
    }

    return baseline;
  }

  /**
   * Capture screenshots using Playwright/Puppeteer
   */
  private async captureScreenshots(urls: string[], programId: string): Promise<Map<string, any>> {
    const screenshots = new Map<string, any>();
    const fs = require('fs/promises');
    const path = require('path');
    const os = require('os');
    const crypto = require('crypto');

    const screenshotDir = path.join(os.tmpdir(), 'agenthunt-screenshots', programId);
    await fs.mkdir(screenshotDir, { recursive: true });

    for (const url of urls) {
      try {
        const filename = `${crypto.createHash('md5').update(url).digest('hex')}.png`;
        const screenshotPath = path.join(screenshotDir, filename);

        // Use Playwright for screenshots
        const result = await this.executeCommand(
          `npx playwright screenshot --full-page "${url}" "${screenshotPath}"`,
          { timeout: 30000 }
        );

        if (result.exitCode === 0) {
          // Calculate hash of screenshot
          const content = await fs.readFile(screenshotPath);
          const hash = crypto.createHash('sha256').update(content).digest('hex');

          screenshots.set(url, {
            path: screenshotPath,
            hash,
            capturedAt: new Date(),
            size: content.length,
          });
        } else {
          // Fallback: try with puppeteer
          const puppeteerResult = await this.captureWithPuppeteer(url, screenshotPath);
          if (puppeteerResult) {
            screenshots.set(url, puppeteerResult);
          }
        }
      } catch (error) {
        logger.debug({ error, url }, 'Screenshot capture failed');
        screenshots.set(url, { error: true, message: 'Capture failed' });
      }
    }

    return screenshots;
  }

  /**
   * Capture screenshot with Puppeteer fallback
   */
  private async captureWithPuppeteer(url: string, outputPath: string): Promise<any | null> {
    try {
      const result = await this.executeCommand(
        `node -e "
          const puppeteer = require('puppeteer');
          (async () => {
            const browser = await puppeteer.launch({ headless: 'new' });
            const page = await browser.newPage();
            await page.goto('${url}', { waitUntil: 'networkidle2', timeout: 30000 });
            await page.screenshot({ path: '${outputPath}', fullPage: true });
            await browser.close();
          })();
        "`,
        { timeout: 60000 }
      );

      if (result.exitCode === 0) {
        const fs = require('fs/promises');
        const crypto = require('crypto');
        const content = await fs.readFile(outputPath);
        return {
          path: outputPath,
          hash: crypto.createHash('sha256').update(content).digest('hex'),
          capturedAt: new Date(),
          size: content.length,
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Compare screenshots with baseline
   */
  private async compareScreenshots(
    baseline: Map<string, any>,
    current: Map<string, any>,
    threshold: number
  ): Promise<VisualChange[]> {
    const changes: VisualChange[] = [];

    for (const [url, currentData] of current) {
      if (currentData.error) continue;

      const baselineData = baseline.get(url);
      if (!baselineData) continue;

      // Quick hash comparison
      if (currentData.hash === baselineData.hash) {
        continue; // No change
      }

      // Detailed pixel comparison
      const diffResult = await this.compareImages(baselineData.path, currentData.path);

      if (diffResult.diffPercentage >= threshold) {
        changes.push({
          url,
          changeType: 'modified',
          diffPercentage: diffResult.diffPercentage,
          description: `Visual change detected: ${diffResult.diffPercentage.toFixed(2)}% difference`,
          screenshotPath: currentData.path,
          diffPath: diffResult.diffPath,
        });
      }
    }

    return changes;
  }

  /**
   * Compare two images and calculate difference
   */
  private async compareImages(
    baselinePath: string,
    currentPath: string
  ): Promise<{ diffPercentage: number; diffPath?: string }> {
    try {
      const fs = require('fs/promises');
      const path = require('path');

      // Use pixelmatch or similar for comparison
      const result = await this.executeCommand(
        `npx pixelmatch "${baselinePath}" "${currentPath}" diff.png 0.1`,
        { timeout: 30000 }
      );

      if (result.exitCode === 0) {
        // Parse diff percentage from output
        const match = result.stdout.match(/(\d+\.?\d*)/);
        const diffPixels = match ? parseFloat(match[1]) : 0;
        
        // Estimate percentage (assuming average image size)
        const diffPercentage = Math.min(100, diffPixels / 1000);

        return { diffPercentage, diffPath: 'diff.png' };
      }

      // Fallback: hash-based comparison
      const baselineContent = await fs.readFile(baselinePath);
      const currentContent = await fs.readFile(currentPath);

      // Simple size-based difference estimation
      const sizeDiff = Math.abs(baselineContent.length - currentContent.length);
      const diffPercentage = (sizeDiff / Math.max(baselineContent.length, currentContent.length)) * 100;

      return { diffPercentage };
    } catch (error) {
      logger.debug({ error }, 'Image comparison failed');
      return { diffPercentage: 100 }; // Assume significant change on error
    }
  }

  /**
   * Detect new/removed URLs
   */
  private detectUrlChanges(
    baseline: Map<string, any>,
    current: Map<string, any>
  ): VisualChange[] {
    const changes: VisualChange[] = [];

    // New URLs
    for (const [url, data] of current) {
      if (!baseline.has(url) && !data.error) {
        changes.push({
          url,
          changeType: 'new',
          diffPercentage: 100,
          description: 'New endpoint discovered',
          screenshotPath: data.path,
        });
      }
    }

    // Removed URLs
    for (const [url] of baseline) {
      if (!current.has(url)) {
        changes.push({
          url,
          changeType: 'removed',
          diffPercentage: 100,
          description: 'Endpoint no longer accessible',
        });
      }
    }

    return changes;
  }

  /**
   * Store visual change in database
   */
  private async storeChange(programId: string, change: VisualChange, jobId: string): Promise<void> {
    try {
      await database.query(
        `INSERT INTO visual_changes (id, program_id, job_id, url, change_type, diff_percentage, description, screenshot_path, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)`,
        [
          uuidv4(),
          programId,
          jobId,
          change.url,
          change.changeType,
          change.diffPercentage,
          change.description,
          change.screenshotPath,
        ]
      );
    } catch (error) {
      logger.error({ error, change }, 'Failed to store visual change');
    }
  }

  /**
   * Update baseline with current screenshots
   */
  private async updateBaseline(programId: string, screenshots: Map<string, any>): Promise<void> {
    for (const [url, data] of screenshots) {
      if (data.error) continue;

      try {
        await database.query(
          `INSERT INTO visual_baselines (id, program_id, url, screenshot_path, hash, captured_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
           ON CONFLICT (program_id, url) DO UPDATE SET screenshot_path = $4, hash = $5, captured_at = CURRENT_TIMESTAMP`,
          [uuidv4(), programId, url, data.path, data.hash]
        );
      } catch (error) {
        logger.error({ error, url }, 'Failed to update baseline');
      }
    }
  }

  /**
   * Trigger handoffs for significant changes
   */
  private async triggerHandoffs(programId: string, changes: VisualChange[], jobId: string): Promise<void> {
    // New endpoints might be interesting
    const newEndpoints = changes.filter(c => c.changeType === 'new');
    
    if (newEndpoints.length > 0) {
      await this.handoff('scanner', {
        toAgent: 'scanner',
        reason: `${newEndpoints.length} new endpoints discovered via visual regression`,
        data: {
          urls: newEndpoints.map(c => c.url),
          source: 'visual-regression',
        },
        priority: 7,
        metadata: { programId, parentJobId: jobId, source: 'visual-regression' },
      });
    }

    // Significant changes might indicate new features/vulns
    const significantChanges = changes.filter(c => c.diffPercentage >= 20);
    
    if (significantChanges.length > 0) {
      await this.handoff('crawl', {
        toAgent: 'crawl',
        reason: `${significantChanges.length} significant UI changes detected`,
        data: {
          urls: significantChanges.map(c => c.url),
          source: 'visual-regression',
        },
        priority: 6,
        metadata: { programId, parentJobId: jobId, source: 'visual-regression' },
      });
    }
  }
}

export default new VisualRegressionAgent();
