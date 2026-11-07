import { cn } from "@/lib/cn";
import type { Seg } from "@/lib/search/engine";

export function Passage({
  segments,
  lead,
  tail,
  anchors,
  className,
  as: Tag = "div",
  savedId,
  taken,
  pin,
}: {
  segments: Seg[];
  lead?: boolean;
  tail?: boolean;
  anchors?: Map<number, string>;
  className?: string;
  as?: "div" | "h2";
  savedId?: string;
  taken?: Set<string>;
  /** Character offset, within these segments, where a meaning result should land. */
  pin?: { at: number; id: string };
}) {
  let savedPlaced = false;
  let cursor = 0;
  let pinned = false;
  return (
    <Tag className={cn("font-serif text-lg leading-relaxed whitespace-pre-wrap text-ink", className)}>
      {lead ? <span className="text-muted">… </span> : null}
      {segments.map((seg, i) => {
        const from = cursor;
        cursor += seg.text.length;
        const anchor = seg.token != null ? anchors?.get(seg.token) : undefined;
        const pinHere = Boolean(pin && !pinned && pin.at >= from && pin.at < from + seg.text.length);
        if (pinHere && pin) pinned = true;
        if (seg.live) {
          const id = savedPlaced ? undefined : savedId;
          savedPlaced = true;
          // No horizontal padding. Padding makes the highlighted letters wider than the rest of the line.
          return (
            <mark key={i} id={id} className="hit-anchor rounded-sm bg-mark text-ink">
              {seg.text}
            </mark>
          );
        }
        if (seg.excerptId) {
          const domId = seg.markId && !taken?.has(seg.markId) ? seg.markId : undefined;
          if (domId) taken?.add(domId);
          return (
            <mark
              key={i}
              id={domId}
              data-excerpt={seg.excerptId}
              className="rounded-sm bg-mark text-ink"
            >
              {seg.text}
            </mark>
          );
        }
        if (seg.saved) {
          const id = savedPlaced ? undefined : savedId;
          savedPlaced = true;
          return (
            <mark key={i} id={id} className="hit-anchor rounded-sm bg-mark text-ink">
              {seg.text}
            </mark>
          );
        }
        if (!seg.hit) {
          const line = seg.mean ? "folio-mean-line" : undefined;
          if (!pinHere || !pin) return <span key={i} className={line}>{seg.text}</span>;
          const cut = pin.at - from;
          return (
            <span key={i}>
              {cut > 0 ? <span className={line}>{seg.text.slice(0, cut)}</span> : null}
              <span id={pin.id} className={cn("scroll-mt-24", line)}>
                {seg.text.slice(cut)}
              </span>
            </span>
          );
        }
        return (
          <mark key={i} id={anchor} className={cn("rounded-sm", seg.mean && "folio-mean-line", seg.kin && "hit-kin", anchor && "hit-anchor")}>
            {seg.text}
          </mark>
        );
      })}
      {tail ? <span className="text-muted"> …</span> : null}
    </Tag>
  );
}

/** Underline one character window. The line is the meaning match, not a word hit. */
export function withMeanLine(segments: Seg[], start: number, end: number): Seg[] {
  if (end <= start) return segments;
  const out: Seg[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const from = cursor;
    const to = cursor + seg.text.length;
    cursor = to;
    if (to <= start || from >= end) {
      out.push(seg);
      continue;
    }
    const cutA = Math.max(start, from) - from;
    const cutB = Math.min(end, to) - from;
    if (cutA > 0) out.push({ ...seg, text: seg.text.slice(0, cutA) });
    out.push({ ...seg, text: seg.text.slice(cutA, cutB), mean: true, token: undefined });
    if (cutB < seg.text.length) out.push({ ...seg, text: seg.text.slice(cutB), token: undefined });
  }
  return out;
}

/** Keep a character window of segments, for one original page inside a section. */
export function sliceSegments(segments: Seg[], start: number, end: number): Seg[] {
  const out: Seg[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const from = cursor;
    const to = cursor + seg.text.length;
    cursor = to;
    if (to <= start || from >= end) continue;
    const cutA = Math.max(start, from) - from;
    const cutB = Math.min(end, to) - from;
    const text = seg.text.slice(cutA, cutB);
    if (text) out.push({ ...seg, text });
  }
  return out;
}

/** Mark a character range on top of existing search highlights. */
export function withSavedRange(segments: Seg[], start: number, end: number): Seg[] {
  if (end <= start) return segments;
  const out: Seg[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const from = cursor;
    const to = cursor + seg.text.length;
    cursor = to;
    if (to <= start || from >= end) {
      out.push(seg);
      continue;
    }
    const cutA = Math.max(start, from) - from;
    const cutB = Math.min(end, to) - from;
    if (cutA > 0) out.push({ ...seg, text: seg.text.slice(0, cutA), token: seg.token });
    out.push({ ...seg, text: seg.text.slice(cutA, cutB), saved: true, live: true, excerptId: undefined, markId: undefined, token: undefined });
    if (cutB < seg.text.length) out.push({ ...seg, text: seg.text.slice(cutB), token: undefined });
  }
  return out;
}

/** Mark every saved passage. An earlier passage keeps the overlap. */
export function withSavedMarks(segments: Seg[], marks: { start: number; end: number; id: string; anchor: string }[]): Seg[] {
  const sorted = marks.filter((mark) => mark.end > mark.start).sort((a, b) => a.start - b.start || a.end - b.end);
  let out = segments;
  for (const mark of sorted) out = applyMark(out, mark);
  return out;
}

function applyMark(segments: Seg[], mark: { start: number; end: number; id: string; anchor: string }): Seg[] {
  const out: Seg[] = [];
  let cursor = 0;
  let placed = false;
  for (const seg of segments) {
    const from = cursor;
    const to = cursor + seg.text.length;
    cursor = to;
    if (seg.excerptId || seg.live || to <= mark.start || from >= mark.end) {
      out.push(seg);
      continue;
    }
    const cutA = Math.max(mark.start, from) - from;
    const cutB = Math.min(mark.end, to) - from;
    if (cutA > 0) out.push({ ...seg, text: seg.text.slice(0, cutA) });
    out.push({
      ...seg,
      text: seg.text.slice(cutA, cutB),
      excerptId: mark.id,
      markId: placed ? undefined : mark.anchor,
      token: undefined,
    });
    placed = true;
    if (cutB < seg.text.length) out.push({ ...seg, text: seg.text.slice(cutB), token: undefined, excerptId: undefined, markId: undefined });
  }
  return out;
}
