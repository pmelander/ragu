import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config';

/** Lazy-load ESM pdf.js in CJS/Node16 output (tsc-compatible). */
let pdfjsModulePromise: Promise<any> | null = null;

async function getPdfjs(): Promise<any> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((mod) => {
      const pdfjsPath = path.dirname(require.resolve('pdfjs-dist/package.json'));
      mod.GlobalWorkerOptions.workerSrc = path.join(pdfjsPath, 'legacy/build/pdf.worker.mjs');
      return mod;
    });
  }
  return pdfjsModulePromise;
}

export class PDFProcessor {
  /**
   * Extract text per page (PDF) or a single segment (TXT). Used for accurate page metadata when chunking.
   */
  async extractPages(filePath: string, originalFilename?: string): Promise<{ page: number; text: string }[]> {
    const startTime = Date.now();

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const stats = fs.statSync(filePath);
    const maxSizeBytes = config.server.maxFileSizeMb * 1024 * 1024;
    if (stats.size > maxSizeBytes) {
      throw new Error(`File too large: ${stats.size} bytes (max: ${maxSizeBytes})`);
    }

    const isTextFile = originalFilename
      ? originalFilename.toLowerCase().endsWith('.txt') || originalFilename.toLowerCase().endsWith('.md')
      : filePath.toLowerCase().endsWith('.txt') || filePath.toLowerCase().endsWith('.md');

    if (isTextFile) {
      const text = fs.readFileSync(filePath, 'utf-8');
      logger.performance('Text extraction', Date.now() - startTime, { file: filePath });
      return [{ page: 1, text }];
    }

    logger.info(`Starting PDF page extraction: ${filePath}`);
    const { getDocument } = await getPdfjs();
    const data = new Uint8Array(fs.readFileSync(filePath));
    let pdf;
    try {
      pdf = await getDocument({ data }).promise;
    } catch (pdfError) {
      logger.warn('Failed to load PDF document, it may be corrupted or invalid:', pdfError);
      return [];
    }

    logger.info(`PDF loaded: ${pdf.numPages} pages`);
    const out: { page: number; text: string }[] = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        out.push({ page: pageNum, text: pageText });
        if (pageNum % 10 === 0) {
          logger.debug(`Processed ${pageNum}/${pdf.numPages} pages`);
        }
      } catch (pageError) {
        logger.warn(`Failed to extract text from page ${pageNum}:`, pageError);
        out.push({ page: pageNum, text: '' });
      }
    }

    logger.performance('PDF extraction', Date.now() - startTime, {
      file: path.basename(filePath),
      pages: pdf.numPages,
      textLength: out.map((p) => p.text).join('').length
    });

    return out;
  }

  /**
   * Extract text from a PDF or TXT file
   */
  async extractText(filePath: string, originalFilename?: string): Promise<string> {
    try {
      logger.info(`Starting document extraction: ${filePath}`);

      const isTextFile = originalFilename
        ? originalFilename.toLowerCase().endsWith('.txt') || originalFilename.toLowerCase().endsWith('.md')
        : filePath.toLowerCase().endsWith('.txt') || filePath.toLowerCase().endsWith('.md');

      const pages = await this.extractPages(filePath, originalFilename);

      if (!isTextFile && pages.length === 0) {
        return 'This PDF document could not be loaded. It may be corrupted, password-protected, or not a valid PDF file. Please try with a different PDF or use OCR to extract text from image-based PDFs.';
      }

      const fullText = pages
        .map((p) => p.text)
        .filter((t) => t.trim())
        .join('\n\n');

      if (!fullText.trim()) {
        if (isTextFile) {
          return '';
        }
        const n = pages.length || 0;
        logger.warn('No text content found in PDF - it may be image-based or corrupted');
        return `This PDF document appears to be image-based or corrupted. It contains ${n} pages but no extractable text content. You may need to use OCR (Optical Character Recognition) to extract text from this document.`;
      }

      if (isTextFile) {
        logger.info('Processing as text file');
      }

      return fullText.trim();
    } catch (error) {
      logger.error('PDF extraction failed', error as Error);
      throw new Error(`Failed to extract text from PDF: ${(error as Error).message}`);
    }
  }

  /**
   * Get PDF metadata
   */
  async getMetadata(filePath: string): Promise<any> {
    try {
      const { getDocument } = await getPdfjs();
      const data = new Uint8Array(fs.readFileSync(filePath));
      const pdf = await getDocument({ data }).promise;

      const metadata = await pdf.getMetadata();
      const stats = fs.statSync(filePath);

      const info = metadata.info as any;
      return {
        pages: pdf.numPages,
        title: info?.Title || path.basename(filePath, '.pdf'),
        author: info?.Author,
        subject: info?.Subject,
        creator: info?.Creator,
        producer: info?.Producer,
        creationDate: info?.CreationDate,
        modificationDate: info?.ModDate,
        fileSize: stats.size,
        fileName: path.basename(filePath)
      };
    } catch (error) {
      logger.warn(`Could not get PDF metadata: ${filePath}`, error as Error);
      return null;
    }
  }

  /**
   * Validate PDF file by checking magic bytes (more secure than just extension)
   */
  private validatePDFFile(filePath: string): boolean {
    try {
      const buffer = fs.readFileSync(filePath);
      // PDF files start with %PDF-
      return buffer.toString('ascii', 0, 4) === '%PDF';
    } catch (error) {
      logger.warn('Failed to validate PDF file', error);
      return false;
    }
  }

  /**
   * Validate document file (PDF or TXT)
   */
  validateFile(filePath: string, originalFilename?: string): boolean {
    try {
      logger.debug(`Validating file: ${filePath}`);

      // Check file extension (PDF or TXT) - use original filename if provided, otherwise temp path
      const filenameToCheck = originalFilename || filePath;
      const isPdf = filenameToCheck.toLowerCase().endsWith('.pdf');
      const isTxt = filenameToCheck.toLowerCase().endsWith('.txt');
      const isMd = filenameToCheck.toLowerCase().endsWith('.md');
      const isValidType = isPdf || isTxt || isMd;
      
      logger.debug(`File extension check: ${isValidType ? 'PASS' : 'FAIL'} (.pdf, .txt, or .md required) - checked: ${filenameToCheck}`);
      if (!isValidType) {
        return false;
      }

      // Check file exists
      const exists = fs.existsSync(filePath);
      logger.debug(`File exists check: ${exists ? 'PASS' : 'FAIL'}`);
      if (!exists) {
        return false;
      }

      // Check file size
      const stats = fs.statSync(filePath);
      const maxSizeBytes = config.server.maxFileSizeMb * 1024 * 1024;
      const sizeOk = stats.size <= maxSizeBytes;
      logger.debug(`File size check: ${stats.size} bytes <= ${maxSizeBytes} bytes = ${sizeOk ? 'PASS' : 'FAIL'}`);
      if (!sizeOk) {
        return false;
      }

      // For PDF files, validate magic bytes for security
      if (isPdf && !this.validatePDFFile(filePath)) {
        logger.warn(`Invalid PDF file format (magic bytes check failed): ${filePath}`);
        return false;
      }

      logger.debug('Document validation passed');
      return true;
    } catch (error) {
      logger.error('Document validation failed', error);
      return false;
    }
  }
}