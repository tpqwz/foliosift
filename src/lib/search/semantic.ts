import type { Work } from "../corpus/types";
import type { SectionHit, WorkHit } from "./engine";

export type SemanticChoice = "off" | "e5" | "gemma";

export const SEMANTIC_FLOOR = 0.38;
export const SEMANTIC_KEEP = 8;

export const SEMANTIC_MODELS = {
  e5: {
    label: "Multilingual E5 small",
    repo: "Xenova/multilingual-e5-small",
    dims: 384,
    detail: "The semantic search. The books that came with FolioSift are already embedded. Books you add are embedded on this device.",
  },
  gemma: {
    label: "EmbeddingGemma 2",
    repo: "onnx-community/embeddinggemma-2-ONNX",
    dims: 256,
    detail: "Not prepared, and heavier. Where the smaller file cannot run, this downloads about 540 MB instead.",
  },
} as const;

const WINDOW = 900;
const STEP = 700;

/** A meaning result: the collapsed window, mapped back onto the chapter when it is open. */
export function meaningAt(sectionId: string, start: number): string {
  return `mean:${sectionId}:${start}:${start + WINDOW}`;
}

export function parseMeaning(at?: string): { sectionId: string; start: number; end: number } | null {
  if (!at) return null;
  const match = /^mean:(.*):(\d+):(\d+)$/.exec(at);
  if (!match?.[1]) return null;
  return { sectionId: match[1], start: Number(match[2]), end: Number(match[3]) };
}

/** The embedding window is measured after whitespace is collapsed. Put it back on the original text. */
export function originalSpan(text: string, start: number, end: number): { start: number; end: number } {
  let i = 0;
  while (i < text.length && /\s/.test(text[i] ?? "")) i++;
  let collapsed = 0;
  let origStart = Math.min(i, text.length);
  let origEnd = text.length;
  while (i < text.length && collapsed < end) {
    if (/\s/.test(text[i] ?? "")) {
      let j = i;
      while (j < text.length && /\s/.test(text[j] ?? "")) j++;
      if (j >= text.length) break;
      if (collapsed === start) origStart = i;
      collapsed += 1;
      i = j;
      if (collapsed === end) {
        origEnd = i;
        break;
      }
      continue;
    }
    if (collapsed === start) origStart = i;
    collapsed += 1;
    i += 1;
    if (collapsed === end) {
      origEnd = i;
      break;
    }
  }
  if (origEnd < origStart) origEnd = origStart;
  return { start: origStart, end: Math.max(origStart, origEnd) };
}

/** Short passages the model can actually compare. A whole chapter is too long. */
export function windows(text: string): { start: number; end: number; text: string }[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 80) return [];
  if (clean.length <= WINDOW) return [{ start: 0, end: clean.length, text: clean }];
  const out: { start: number; end: number; text: string }[] = [];
  for (let start = 0; start < clean.length && out.length < 48; start += STEP) {
    const end = Math.min(clean.length, start + WINDOW);
    const slice = clean.slice(start, end).trim();
    if (slice.length >= 80) out.push({ start, end, text: slice });
    if (end >= clean.length) break;
  }
  return out;
}

export function prefixQuery(model: Exclude<SemanticChoice, "off">, text: string): string {
  const body = text.slice(0, 2000);
  return model === "e5" ? `query: ${body}` : body;
}

export function prefixPassage(model: Exclude<SemanticChoice, "off">, text: string): string {
  return model === "e5" ? `passage: ${text}` : text;
}

export function textHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function unit(values: ArrayLike<number>, dims = values.length): Float32Array {
  const width = Math.min(dims, values.length);
  let sum = 0;
  for (let i = 0; i < width; i++) sum += values[i] * values[i];
  const scale = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  const out = new Float32Array(width);
  for (let i = 0; i < width; i++) out[i] = values[i] * scale;
  return out;
}

export function dot(left: ArrayLike<number>, right: ArrayLike<number>): number {
  const width = Math.min(left.length, right.length);
  let sum = 0;
  for (let i = 0; i < width; i++) sum += left[i] * right[i];
  return sum;
}

export type SemanticPassage = {
  work: Work;
  sectionId: string;
  heading: string;
  start: number;
  preview: string;
  score: number;
};

/** Word matches stay ahead of meaning-only matches. A work already found can gain a passage. */
export function foldSemantic(lexical: WorkHit[], found: SemanticPassage[], allowNew: boolean): WorkHit[] {
  const lexicalIds = new Set(lexical.map((hit) => hit.work.id));
  const extra = found.filter((hit) => hit.score >= SEMANTIC_FLOOR && (allowNew || lexicalIds.has(hit.work.id))).slice(0, SEMANTIC_KEEP);
  const byId = new Map<string, WorkHit>(lexical.map((hit) => [hit.work.id, { ...hit, sections: [...hit.sections] }]));
  for (const hit of extra) {
    const section: SectionHit = {
      sectionId: hit.sectionId,
      heading: hit.heading,
      score: hit.score,
      snippets: [
        {
          id: meaningAt(hit.sectionId, hit.start),
          sectionId: hit.sectionId,
          heading: hit.heading,
          segments: [{ text: hit.preview, hit: false }],
          lead: hit.start > 0,
          tail: true,
        },
      ],
      bodyHits: [],
      headingHits: [],
      meaning: true,
    };
    const existing = byId.get(hit.work.id);
    if (!existing) {
      byId.set(hit.work.id, { work: hit.work, score: hit.score, matchCount: 1, sections: [section] });
      continue;
    }
    if (!existing.sections.some((item) => item.sectionId === hit.sectionId)) {
      existing.sections.push(section);
      existing.matchCount += 1;
    }
    existing.score += hit.score;
  }
  return [...byId.values()].sort((left, right) => {
    const leftWords = lexicalIds.has(left.work.id);
    const rightWords = lexicalIds.has(right.work.id);
    if (leftWords !== rightWords) return leftWords ? -1 : 1;
    return right.score - left.score || left.work.title.localeCompare(right.work.title);
  });
}
