import { logger } from '../utils/logger';
import { config } from '../config';

export interface PageChunk {
  content: string;
  page: number;
}

export class TextChunker {
  /**
   * Chunk per PDF page (or per segment) so metadata.page is exact.
   */
  chunkTextWithPages(
    pages: { page: number; text: string }[],
    chunkSize?: number,
    overlap?: number
  ): PageChunk[] {
    const out: PageChunk[] = [];
    for (const { page, text } of pages) {
      const trimmed = text.trim();
      if (!trimmed) continue;
      const parts = this.chunkText(trimmed, chunkSize, overlap);
      for (const content of parts) {
        out.push({ content, page });
      }
    }
    return out;
  }

  /**
   * Split text into overlapping chunks
   */
  chunkText(text: string, chunkSize?: number, overlap?: number): string[] {
    const size = chunkSize ?? config.rag.chunkSize;
    const overlapSize = overlap ?? config.rag.chunkOverlap;

    if (size <= 0) {
      throw new Error('Chunk size must be positive');
    }

    if (overlapSize >= size) {
      throw new Error('Overlap size must be less than chunk size');
    }

    const chunks: string[] = [];
    const sentences = this.splitIntoSentences(text);

    let currentChunk = '';
    let currentSize = 0;

    for (const sentence of sentences) {
      const sentenceSize = sentence.length;

      // If adding this sentence would exceed chunk size
      if (currentSize + sentenceSize > size && currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        // Start new chunk with overlap from previous chunk
        currentChunk = this.getOverlapText(currentChunk, overlapSize);
        currentSize = currentChunk.length;
      }

      currentChunk += sentence;
      currentSize += sentenceSize;
    }

    // Add remaining chunk
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    logger.debug(`Text chunked: ${chunks.length} chunks from ${text.length} characters`);
    return chunks;
  }

  /**
   * Split text into sentences.
   *
   * Uses a two-pass approach to avoid false splits on common abbreviations
   * (Mr., Dr., Jr., etc.) and single-letter initials (J. Smith):
   *   1. Split on terminal punctuation followed by whitespace.
   *   2. Re-join any fragment whose trailing "word" is a known abbreviation
   *      or a single letter, treating it as a continuation rather than a
   *      sentence boundary.
   */
  private splitIntoSentences(text: string): string[] {
    // Common abbreviations that should not be treated as sentence endings.
    const ABBREVS = new Set([
      'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'etc', 'inc',
      'ltd', 'corp', 'dept', 'est', 'vol', 'approx', 'fig', 'no', 'st',
      'ave', 'blvd', 'rd', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul',
      'aug', 'sep', 'oct', 'nov', 'dec'
    ]);

    // Split on any terminal punctuation followed by whitespace, keeping the
    // punctuation attached to the preceding fragment (lookbehind).
    const raw = text.split(/(?<=[.!?]["'\u2019\u201d]?)\s+/);

    const sentences: string[] = [];
    let pending = '';

    for (const part of raw) {
      pending = pending ? `${pending} ${part}` : part;

      // Inspect the last "word" before the terminal punctuation to decide
      // whether this is a real sentence boundary.
      const lastWord = pending.match(/(\w+)[.!?]["'\u2019\u201d]?\s*$/);
      if (lastWord) {
        const word = lastWord[1].toLowerCase();
        // Single letter (initial) or known abbreviation → not a boundary.
        if (word.length === 1 || ABBREVS.has(word) || /^\d+$/.test(word)) {
          continue;
        }
      }

      sentences.push(`${pending} `);
      pending = '';
    }

    if (pending.trim()) {
      sentences.push(`${pending} `);
    }

    return sentences.filter(s => s.trim().length > 0);
  }

  /**
   * Get overlapping text from the end of a chunk.
   *
   * Scans backwards from `overlapSize` characters from the end to find a
   * word boundary, then returns everything from that boundary to the end of
   * the chunk. This ensures the overlap begins at a clean word start rather
   * than mid-word.
   */
  private getOverlapText(chunk: string, overlapSize: number): string {
    if (chunk.length <= overlapSize) {
      return chunk;
    }

    // Target position: `overlapSize` chars from the end.
    const targetIdx = chunk.length - overlapSize;

    // Walk backwards up to 50 chars to find a space (word boundary).
    for (let i = targetIdx; i > Math.max(0, targetIdx - 50); i--) {
      if (chunk[i] === ' ') {
        return chunk.slice(i + 1);
      }
    }

    // No space found nearby — cut exactly at the target index.
    return chunk.slice(targetIdx);
  }

}
