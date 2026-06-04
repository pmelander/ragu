import { TextChunker } from './chunker';

describe('TextChunker.chunkTextWithPages', () => {
  it('preserves page numbers per chunk', () => {
    const chunker = new TextChunker();
    const long = 'Sentence one. Sentence two. Sentence three. Sentence four. ';
    const parts = chunker.chunkTextWithPages(
      [
        { page: 2, text: long.repeat(20) },
        { page: 5, text: 'Only page five.' }
      ],
      80,
      15
    );
    expect(parts.length).toBeGreaterThan(0);
    expect(parts.every((p) => p.page === 2 || p.page === 5)).toBe(true);
    expect(parts.some((p) => p.page === 5)).toBe(true);
  });
});
