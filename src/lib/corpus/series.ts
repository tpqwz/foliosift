import type { SeriesRef, Work } from "./types";

export type ShelfEntry =
  | { kind: "work"; work: Work }
  | { kind: "series"; series: SeriesRef; works: Work[] };

/** Another volume of the same collection, not another printing of this one. */
export function seriesSiblings(a: Pick<Work, "series">, b: Pick<Work, "series">): boolean {
  if (!a.series || !b.series) return false;
  return a.series.id === b.series.id && a.series.volume !== b.series.volume;
}

/** Standalone works stay as they are. Volumes that share a series id become one entry. */
export function shelfEntries(works: Work[]): ShelfEntry[] {
  const out: ShelfEntry[] = [];
  const seen = new Set<string>();
  for (const work of works) {
    const id = work.series?.id;
    if (!id) {
      out.push({ kind: "work", work });
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    const members = works
      .filter((item) => item.series?.id === id)
      .sort((a, b) => (a.series?.volume ?? 0) - (b.series?.volume ?? 0));
    const series = members[0]?.series;
    if (!series) continue;
    out.push({ kind: "series", series: { ...series, of: members.length }, works: members });
  }
  return out;
}
