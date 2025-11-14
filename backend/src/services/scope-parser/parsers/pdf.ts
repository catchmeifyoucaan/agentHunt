/**
 * PDF Scope Parser
 * Extracts text from PDF and uses LLM to parse scope information
 */

import * as pdfjsLib from 'pdfjs-dist';
import { ParsedScope } from '../types';
import llm from '../../llm/llm-engine';
import logger from '../../../utils/logger';

// Disable worker for Node.js environment (not needed in Node.js)
if (typeof pdfjsLib.GlobalWorkerOptions !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

export class PDFParser {
  /**
   * Parse PDF scope document
   */
  async parse(buffer: Buffer): Promise<ParsedScope> {
    try {
      // Extract text from PDF
      const text = await this.extractText(buffer);

      logger.info({
        textLength: text.length,
        pages: text.split('\n\n').length,
      }, 'Extracted text from PDF');

      // Use LLM to intelligently parse the scope
      const parsedData = await this.llmParse(text);

      const scope: ParsedScope = {
        targets: parsedData.targets || [],
        domains: parsedData.domains || [],
        subdomains: parsedData.subdomains || [],
        wildcardDomains: parsedData.wildcardDomains || [],
        ipRanges: parsedData.ipRanges || [],
        ips: parsedData.ips || [],
        urls: parsedData.urls || [],
        outOfScope: parsedData.outOfScope || [],
        excludedDomains: parsedData.excludedDomains || [],
        excludedPaths: parsedData.excludedPaths || [],
        constraints: {
          noDoS: parsedData.constraints?.noDoS || false,
          maxRateLimit: parsedData.constraints?.maxRateLimit,
          testingWindow: parsedData.constraints?.testingWindow,
          requireAuth: parsedData.constraints?.requireAuth || false,
          prohibitedActions: parsedData.constraints?.prohibitedActions,
        },
        credentials: parsedData.credentials || {},
        priorities: parsedData.priorities || [],
        deliverables: parsedData.deliverables || [],
        metadata: {
          parsedFrom: 'pdf',
          parsedAt: new Date(),
          totalPages: text.split('\n\n').length,
          confidence: parsedData.confidence,
        },
      };

      // Post-processing
      scope.targets = [...new Set([
        ...scope.domains,
        ...scope.subdomains,
        ...scope.ips,
        ...scope.urls,
      ])];

      logger.info({
        domains: scope.domains.length,
        subdomains: scope.subdomains.length,
        ips: scope.ips.length,
        credentials: Object.keys(scope.credentials).length,
        confidence: scope.metadata.confidence,
      }, 'PDF scope parsed successfully');

      return scope;
    } catch (error: any) {
      logger.error({ error }, 'Failed to parse PDF scope');
      throw new Error(`PDF parsing failed: ${error.message}`);
    }
  }

  /**
   * Extract text from PDF using pdf.js
   */
  private async extractText(buffer: Buffer): Promise<string> {
    try {
      // Load PDF document
      const loadingTask = pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        standardFontDataUrl: undefined,
      });

      const pdf = await loadingTask.promise;
      const numPages = pdf.numPages;

      logger.info({ numPages }, 'PDF loaded successfully');

      // Extract text from all pages
      const textParts: string[] = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');

        textParts.push(`\n\n--- Page ${pageNum} ---\n\n${pageText}`);
      }

      return textParts.join('\n\n');
    } catch (error: any) {
      logger.error({ error }, 'Failed to extract text from PDF');
      throw new Error(`PDF text extraction failed: ${error.message}`);
    }
  }

  /**
   * Use LLM to parse scope from extracted text
   */
  private async llmParse(text: string): Promise<any> {
    const prompt = `Parse this penetration testing scope document and extract structured information.

SCOPE DOCUMENT:
${text.substring(0, 15000)} ${text.length > 15000 ? '...(truncated)' : ''}

Extract the following information in JSON format:
{
  "domains": ["example.com", ...],
  "subdomains": ["api.example.com", ...],
  "wildcardDomains": ["*.example.com", ...],
  "ipRanges": ["192.168.1.0/24", ...],
  "ips": ["192.168.1.1", ...],
  "urls": ["https://example.com/api", ...],
  "outOfScope": ["example.com/logout", ...],
  "excludedDomains": ["admin.example.com", ...],
  "excludedPaths": ["/logout", "/admin/delete", ...],
  "constraints": {
    "noDoS": true/false,
    "maxRateLimit": 100,
    "testingWindow": { "start": "6pm EST", "end": "6am EST" },
    "requireAuth": true/false,
    "prohibitedActions": ["DoS attacks", ...]
  },
  "credentials": {
    "api_key": { "type": "api_key", "value": "Bearer xxx", "notes": "..." },
    "admin_login": { "type": "login", "value": "admin:password", "notes": "..." }
  },
  "priorities": ["payment gateway", "admin panel", ...],
  "deliverables": ["Full report", "Video POCs", ...],
  "confidence": 0.0-1.0
}

Important:
- Extract ALL domains, IPs, and URLs mentioned
- Identify in-scope vs out-of-scope clearly
- Look for testing constraints (DoS, rate limits, time windows)
- Extract any credentials if mentioned (API keys, logins)
- Identify priority targets mentioned in the document
- Extract deliverable requirements
- Return confidence score (0-1) based on how clear the document is
- If information is not found, use empty arrays/objects
- Be thorough - security scope documents are detailed`;

    try {
      const response = await llm.complete(prompt, 'You are an expert at parsing security scope documents. Extract structured data in valid JSON format.');

      // Parse JSON response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn('LLM did not return valid JSON, using fallback parsing');
        return this.fallbackParse(text);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return parsed;
    } catch (error: any) {
      logger.error({ error }, 'LLM parsing failed, using fallback');
      return this.fallbackParse(text);
    }
  }

  /**
   * Fallback parsing using regex (if LLM fails)
   */
  private fallbackParse(text: string): any {
    logger.info('Using fallback regex-based parsing');

    const scope: any = {
      domains: [],
      subdomains: [],
      wildcardDomains: [],
      ipRanges: [],
      ips: [],
      urls: [],
      outOfScope: [],
      excludedDomains: [],
      excludedPaths: [],
      constraints: {
        noDoS: text.toLowerCase().includes('no dos') || text.toLowerCase().includes('denial of service'),
        requireAuth: text.toLowerCase().includes('authenticated') || text.toLowerCase().includes('login required'),
      },
      credentials: {},
      priorities: [],
      deliverables: [],
      confidence: 0.3, // Low confidence for regex parsing
    };

    // Extract domains (simple regex)
    const domainRegex = /([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}/gi;
    const domains = text.match(domainRegex) || [] as string[];
    scope.domains = [...new Set(domains.filter((d: string) => !d.startsWith('www.')))];

    // Extract IPs
    const ipRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
    const ips = text.match(ipRegex) || [] as string[];
    scope.ips = [...new Set(ips)];

    // Extract IP ranges
    const ipRangeRegex = /\b(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}\b/g;
    const ipRanges = text.match(ipRangeRegex) || [] as string[];
    scope.ipRanges = [...new Set(ipRanges)];

    // Extract URLs
    const urlRegex = /https?:\/\/[^\s]+/g;
    const urls = text.match(urlRegex) || [] as string[];
    scope.urls = [...new Set(urls)];

    // Look for out-of-scope section
    const outOfScopeMatch = text.match(/out[- ]of[- ]scope:?\s*([^\n]+)/i);
    if (outOfScopeMatch) {
      scope.outOfScope = outOfScopeMatch[1].split(/[,;]/).map(s => s.trim()).filter(Boolean);
    }

    return scope;
  }
}

export default new PDFParser();
