import { reciprocalRankFusion } from './hybrid-rrf';

describe('reciprocalRankFusion', () => {
  it('ranks ids appearing in multiple lists higher', () => {
    const merged = reciprocalRankFusion(
      [
        ['doc-b', 'doc-a', 'doc-c'],
        ['doc-b', 'doc-d', 'doc-a']
      ],
      60
    );
    expect(merged[0].id).toBe('doc-b');
    expect(merged.find((m) => m.id === 'doc-b')!.score).toBeGreaterThan(
      merged.find((m) => m.id === 'doc-d')!.score
    );
  });

  it('handles a single list', () => {
    const merged = reciprocalRankFusion([['x', 'y']], 60);
    expect(merged.map((m) => m.id)).toEqual(['x', 'y']);
  });
});
