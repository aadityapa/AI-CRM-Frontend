/** Lightweight subsequence fuzzy score (no deps). Higher = better; -1 = no match. */
export function fuzzyScore(query: string, label: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = label.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - q.length;
  if (t.includes(q)) return 500 - t.indexOf(q);

  let ti = 0;
  let score = 0;
  let consecutive = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = false;
    while (ti < t.length) {
      if (t[ti] === ch) {
        score += 10 + consecutive * 5;
        consecutive += 1;
        ti += 1;
        found = true;
        break;
      }
      consecutive = 0;
      ti += 1;
    }
    if (!found) return -1;
  }
  return score - (t.length - q.length);
}

export function fuzzyFilter<T extends { label: string }>(items: T[], query: string): T[] {
  const scored = items
    .map((item) => ({ item, score: fuzzyScore(query, item.label) }))
    .filter((x) => x.score >= 0);
  scored.sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label));
  return scored.map((x) => x.item);
}
