/**
 * Reciprocal Rank Fusion — merge multiple ranked ID lists without score normalization.
 * @see https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
 */
export function reciprocalRankFusion(rankedLists: string[][], k: number): { id: string; score: number }[] {
  const acc = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, rank) => {
      acc.set(id, (acc.get(id) ?? 0) + 1 / (k + rank + 1));
    });
  }
  return [...acc.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, score }));
}
