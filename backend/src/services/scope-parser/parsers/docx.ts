/**
 * DOCX Scope Parser
 * Extracts text from DOCX and uses LLM to parse scope information
 */

import mammoth from 'mammoth';
import { ParsedScope } from '../types';
import { PDFParser } from './pdf-stub'; // Use stub to avoid DOMMatrix issues
import logger from '../../../utils/logger';

export class DOCXParser {
  private pdfParser: PDFParser;

  constructor() {
    this.pdfParser = new PDFParser();
  }

  /**
   * Parse DOCX scope document
   */
  async parse(buffer: Buffer): Promise<ParsedScope> {
    try {
      // Extract text from DOCX
      const text = await this.extractText(buffer);

      logger.info({
        textLength: text.length,
      }, 'Extracted text from DOCX');

      // Use same LLM parsing logic as PDF parser
      const scope = await (this.pdfParser as any).llmParse(text);

      // Update metadata
      scope.metadata = {
        ...scope.metadata,
        parsedFrom: 'docx',
        parsedAt: new Date(),
      };

      // Post-processing
      scope.targets = [...new Set([
        ...(scope.domains || []),
        ...(scope.subdomains || []),
        ...(scope.ips || []),
        ...(scope.urls || []),
      ])];

      logger.info({
        domains: scope.domains?.length || 0,
        subdomains: scope.subdomains?.length || 0,
        ips: scope.ips?.length || 0,
        confidence: scope.metadata?.confidence,
      }, 'DOCX scope parsed successfully');

      return scope;
    } catch (error: any) {
      logger.error({ error }, 'Failed to parse DOCX scope');
      throw new Error(`DOCX parsing failed: ${error.message}`);
    }
  }

  /**
   * Extract text from DOCX using mammoth
   */
  private async extractText(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });

      if (result.messages && result.messages.length > 0) {
        logger.warn({ messages: result.messages }, 'DOCX conversion warnings');
      }

      return result.value;
    } catch (error: any) {
      logger.error({ error }, 'Failed to extract text from DOCX');
      throw new Error(`DOCX text extraction failed: ${error.message}`);
    }
  }
}

export default new DOCXParser();
