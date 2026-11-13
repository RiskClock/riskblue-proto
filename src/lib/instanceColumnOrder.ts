/** Orders Instances view columns: saved project order first, then the Count tab class order. */
export function orderInstanceEntries<T extends { key: string; canonicalName: string }>(
  entries: T[],
  classOrder: string[],
  savedOrder: string[],
): T[] {
  const saved = new Map(savedOrder.map((k, i) => [k, i]));
  const cls = new Map(classOrder.map((n, i) => [n, i]));
  const idx = new Map(entries.map((e, i) => [e.key, i]));
  const classRank = (e: T) => cls.get(e.canonicalName) ?? Number.MAX_SAFE_INTEGER;
  return [...entries].sort((a, b) => {
    const sa = saved.get(a.key), sb = saved.get(b.key);
    if (sa != null && sb != null) return sa - sb;
    if (sa != null) return -1;
    if (sb != null) return 1;
    return classRank(a) - classRank(b) || idx.get(a.key)! - idx.get(b.key)!;
  });
}

/** Moves `from` into the position of `to`. */
export function moveEntryKey(keys: string[], from: string, to: string): string[] {
  const rest = keys.filter((k) => k !== from);
  const at = rest.indexOf(to);
  const targetIdx = keys.indexOf(to) > keys.indexOf(from) ? at + 1 : at;
  rest.splice(targetIdx, 0, from);
  return rest;
}
