import { stem } from "./stem.ts";

export type Token = {
  /** Accent-folded lowercase, apostrophes removed. Offsets refer to the original text. */
  norm: string;
  stem: string;
  start: number;
  end: number;
};

/** Letters plus combining marks, so polytonic Greek stays one word before folding. */
const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/gu;

/** Fold accents and macrons so ἄνδρα and ανδρα, or ā and a, share an index key. */
export function normalize(raw: string): string {
  return raw.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’]/g, "");
}

export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  WORD.lastIndex = 0;
  for (const match of text.matchAll(WORD)) {
    const raw = match[0];
    const norm = normalize(raw);
    if (!norm) continue;
    const index = match.index ?? 0;
    out.push({
      norm,
      stem: stem(norm),
      start: index,
      end: index + raw.length,
    });
  }
  return out;
}
