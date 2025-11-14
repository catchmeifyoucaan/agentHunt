/**
 * PDF Scope Parser Stub
 * Minimal stub to avoid DOMMatrix issues in Node.js
 * PDF parsing is not required for core functionality
 */

import { ParsedScope } from '../types';
import logger from '../../../utils/logger';

export class PDFParser {
  /**
   * Parse PDF scope document (stubbed for now)
   */
  async parse(buffer: Buffer): Promise<ParsedScope> {
    logger.warn('PDF parsing is not currently available in this environment');

    return {
      targets: [],
      domains: [],
      subdomains: [],
      wildcardDomains: [],
      ipRanges: [],
      ips: [],
      urls: [],
      outOfScope: [],
      metadata: {
        source: 'pdf',
        confidence: 0,
        notes: 'PDF parsing unavailable - please use CSV, DOCX, or text format',
      },
    };
  }
}

export default new PDFParser();
