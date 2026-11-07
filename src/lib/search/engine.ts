import { conceptFamily } from "./concepts";
import { listOf } from "../corpus/dublin";
import type { FacetKey, FacetSelection, Section, Work } from "../corpus/types";
import { tokenize, normalize, type Token } from "./tokenize";

export type Seg = { text: string; hit: boolean; kin?: boolean; mean?: boolean; token?: number; saved?: boolean; live?: boolean; excerptId?: string; markId?: string };

export type Snippet = {
  id: string;
  sectionId: string;
  heading: string;
  segments: Seg[];
  lead: boolean;
  tail: boolean;
};

export type SectionHit = {
  sectionId: string;
  heading: string;
  score: number;
  snippets: Snippet[];
  /** Body-token indexes that should be marked in the reader. */
  bodyHits: number[];
  headingHits: number[];
  /** Found by meaning, not by the words of the query. */
  meaning?: boolean;
};

export type WorkHit = {
  work: Work;
  score: number;
  matchCount: number;
  sections: SectionHit[];
};

export type FacetCount = { name: string; count: number };

export type FacetGroups = Record<FacetKey, FacetCount[]>;

type Posting = { si: number; pos: number[] };

type SectionRec = {
  work: Work;
  section: Section;
  body: Token[];
  heading: Token[];
};

export type QueryClause =
  | { op: "term"; key: string; where: "stem" | "norm"; prefix?: boolean; fuzz?: number }
  | { op: "phrase"; keys: string[]; where: "stem" | "norm" }
  | { op: "and"; parts: QueryClause[] }
  | { op: "or"; parts: QueryClause[] }
  | { op: "not"; clause: QueryClause };

type Clause = QueryClause;

type Match = { score: number; body: number[]; heading: number[] };

const K1 = 1.2;
const B = 0.75;
const WINDOW_BEFORE = 26;
const WINDOW_AFTER = 34;
const CLUSTER_GAP = 5;

export class QueryError extends Error {}

export type Index = {
  sections: SectionRec[];
  bodyStem: Map<string, Posting[]>;
  bodyNorm: Map<string, Posting[]>;
  headStem: Map<string, Posting[]>;
  headNorm: Map<string, Posting[]>;
  norms: string[];
  stems: string[];
  dl: number[];
  avgdl: number;
};

function pushPosting(map: Map<string, Posting[]>, key: string, si: number, pos: number) {
  let list = map.get(key);
  if (!list) {
    list = [];
    map.set(key, list);
  }
  let last = list[list.length - 1];
  if (!last || last.si !== si) {
    last = { si, pos: [] };
    list.push(last);
  }
  last.pos.push(pos);
}

export function buildIndex(works: Work[]): Index {
  const sections: SectionRec[] = [];
  const bodyStem = new Map<string, Posting[]>();
  const bodyNorm = new Map<string, Posting[]>();
  const headStem = new Map<string, Posting[]>();
  const headNorm = new Map<string, Posting[]>();

  for (const work of works) {
    for (const section of work.sections) {
      const si = sections.length;
      const body = tokenize(section.text);
      const heading = tokenize(section.heading);
      sections.push({ work, section, body, heading });
      body.forEach((tok, i) => {
        pushPosting(bodyStem, tok.stem, si, i);
        pushPosting(bodyNorm, tok.norm, si, i);
      });
      heading.forEach((tok, i) => {
        pushPosting(headStem, tok.stem, si, i);
        pushPosting(headNorm, tok.norm, si, i);
      });
    }
  }

  const dl = sections.map((s) => s.body.length + s.heading.length);
  const avgdl = dl.reduce((a, n) => a + n, 0) / (dl.length || 1);
  return {
    sections,
    bodyStem,
    bodyNorm,
    headStem,
    headNorm,
    norms: [...bodyNorm.keys(), ...headNorm.keys()],
    stems: [...bodyStem.keys(), ...headStem.keys()],
    dl,
    avgdl,
  };
}

type QAtom =
  | { t: "word"; v: string; prefix: boolean; fuzz: number }
  | { t: "phrase"; words: string[] }
  | { t: "op"; v: "AND" | "OR" | "NOT" }
  | { t: "lp" }
  | { t: "rp" };

function scan(input: string): QAtom[] {
  const atoms: QAtom[] = [];
  let i = 0;
  const src = input.replace(/[“”]/g, '"');
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\n" || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "(") {
      atoms.push({ t: "lp" });
      i++;
      continue;
    }
    if (ch === ")") {
      atoms.push({ t: "rp" });
      i++;
      continue;
    }
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      if (end < 0) throw new QueryError("A phrase is missing its closing quote.");
      const words = tokenize(src.slice(i + 1, end)).map((t) => t.norm);
      if (words.length) atoms.push({ t: "phrase", words });
      i = end + 1;
      continue;
    }
    const m = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}]*(?:['’][\p{L}\p{N}][\p{L}\p{N}\p{M}]*)*/u.exec(src.slice(i));
    if (!m) {
      i++;
      continue;
    }
    let raw = m[0];
    i += raw.length;
    let prefix = false;
    let fuzz = 0;
    if (src[i] === "*") {
      prefix = true;
      i++;
    } else if (src[i] === "~") {
      i++;
      const dist = /^[12]/.exec(src.slice(i));
      fuzz = dist ? Number(dist[0]) : 1;
      if (dist) i += dist[0].length;
    }
    const upper = raw.toUpperCase();
    if (!prefix && fuzz === 0 && (upper === "AND" || upper === "OR" || upper === "NOT") && raw === upper) {
      atoms.push({ t: "op", v: upper });
      continue;
    }
    raw = normalize(raw);
    if (raw) atoms.push({ t: "word", v: raw, prefix, fuzz });
  }
  return atoms;
}

type RawTerm = { op: "term"; key: string; where: "stem" | "norm"; prefix?: boolean; fuzz?: number };

function parseRich(input: string, fuzzyDefault: boolean): Clause | null {
  const atoms = scan(input).map((atom) => {
    if (atom.t === "word" && fuzzyDefault && atom.fuzz === 0 && !atom.prefix && atom.v.length >= 4) {
      return { ...atom, fuzz: 1 };
    }
    return atom;
  });
  if (atoms.length === 0) return null;
  let at = 0;
  const peek = () => atoms[at];

  function parseOr(): Clause {
    let left = parseAnd();
    while (peek()?.t === "op" && (peek() as { v: string }).v === "OR") {
      at++;
      const right = parseAnd();
      left = join("or", left, right);
    }
    return left;
  }
  function parseAnd(): Clause {
    let left = parseNot();
    while (at < atoms.length) {
      const pk = peek();
      if (!pk || pk.t === "rp") break;
      if (pk.t === "op" && pk.v === "OR") break;
      if (pk.t === "op" && pk.v === "AND") at++;
      else if (pk.t === "op" && pk.v !== "NOT") break;
      const right = parseNot();
      left = join("and", left, right);
    }
    return left;
  }
  function parseNot(): Clause {
    const pk = peek();
    if (pk?.t === "op" && pk.v === "NOT") {
      at++;
      return { op: "not", clause: parseNot() };
    }
    return parseAtom();
  }
  function parseAtom(): Clause {
    const pk = peek();
    if (!pk) throw new QueryError("The query ended where a word was expected.");
    if (pk.t === "lp") {
      at++;
      const inner = parseOr();
      if (peek()?.t !== "rp") throw new QueryError("A parenthesis was never closed.");
      at++;
      return inner;
    }
    if (pk.t === "phrase") {
      at++;
      if (pk.words.length === 1) {
        return { op: "term", key: pk.words[0], where: "norm" };
      }
      return { op: "phrase", keys: pk.words, where: "norm" };
    }
    if (pk.t === "word") {
      at++;
      return { op: "term", key: pk.v, where: "norm", prefix: pk.prefix, fuzz: pk.fuzz } as Clause;
    }
    throw new QueryError("That operator needs a word beside it.");
  }
  const clause = parseOr();
  if (at < atoms.length) throw new QueryError("The query could not be read. Check parentheses and operators.");
  return clause;
}

function join(op: "and" | "or", left: Clause, right: Clause): Clause {
  if (left.op === op) return { op, parts: [...left.parts, right] };
  return { op, parts: [left, right] };
}

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

export function parseQuery(input: string, fuzzyDefault: boolean): QueryClause | null {
  return parseRich(input, fuzzyDefault);
}

export function isQuietTerm(key: string): boolean {
  return STOP.has(key);
}

function termClause(key: string, where: "stem" | "norm"): Clause {
  return { op: "term", key, where };
}

function rewrite(clause: Clause, index: Index, useStem: boolean, concept: boolean): Clause {
  if (clause.op === "and" || clause.op === "or") {
    return { op: clause.op, parts: clause.parts.map((p) => rewrite(p, index, useStem, concept)) };
  }
  if (clause.op === "not") {
    return { op: "not", clause: rewrite(clause.clause, index, useStem, false) };
  }
  if (clause.op === "phrase") {
    const where = useStem ? "stem" : "norm";
    const keys = clause.keys.map((k) => (useStem ? tokenize(k)[0]?.stem ?? k : k));
    return { op: "phrase", keys, where };
  }
  const raw = clause as RawTerm;
  const norm = raw.key;
  const stemmed = tokenize(norm)[0]?.stem ?? norm;
  const where = useStem ? "stem" : "norm";
  const baseKey = useStem ? stemmed : norm;

  let keys: string[] = [];
  if (raw.prefix) {
    if (norm.length < 2) keys = [baseKey];
    else {
      const vocab = useStem ? index.stems : index.norms;
      keys = vocab.filter((v) => v.startsWith(baseKey)).slice(0, 24);
      if (!keys.length) keys = [baseKey];
    }
  } else if ((raw.fuzz ?? 0) > 0) {
    const dist = raw.fuzz ?? 1;
    const pool = index.norms.filter(
      (v) => v[0] === norm[0] && Math.abs(v.length - norm.length) <= dist && levenshtein(norm, v, dist) <= dist,
    );
    const set = new Set<string>(pool.slice(0, 20));
    set.add(norm);
    keys = [...set].map((k) => (useStem ? tokenize(k)[0]?.stem ?? k : k));
  } else {
    keys = [baseKey];
  }

  if (concept && !raw.prefix && !(raw.fuzz && raw.fuzz > 0)) {
    const family = conceptFamily(norm);
    if (family) {
      for (const word of family) {
        keys.push(useStem ? tokenize(word)[0]?.stem ?? word : word);
      }
    }
  }

  const unique = [...new Set(keys)];
  if (unique.length === 1) return termClause(unique[0], where);
  return { op: "or", parts: unique.map((k) => termClause(k, where)) };
}

function bm25(tf: number, df: number, dl: number, avgdl: number, n: number): number {
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  const denom = tf + K1 * (1 - B + B * (dl / (avgdl || 1)));
  return idf * ((tf * (K1 + 1)) / (denom || 1));
}

function lookup(index: Index, key: string, where: "stem" | "norm", heading: boolean): Posting[] {
  const map = heading
    ? where === "stem"
      ? index.headStem
      : index.headNorm
    : where === "stem"
      ? index.bodyStem
      : index.bodyNorm;
  return map.get(key) ?? [];
}

const STOP = new Set([
  "a",
  "an",
  "the",
  "of",
  "to",
  "and",
  "in",
  "on",
  "for",
  "with",
  "by",
  "from",
  "as",
  "at",
  "it",
  "is",
  "be",
  "was",
  "were",
  "his",
  "her",
  "their",
  "this",
  "that",
  "but",
  "into",
  "over",
]);

function evalTerm(index: Index, key: string, where: "stem" | "norm"): Map<number, Match> {
  const body = lookup(index, key, where, false);
  const head = lookup(index, key, where, true);
  const n = index.sections.length;
  const seen = new Set<number>();
  for (const p of body) seen.add(p.si);
  for (const p of head) seen.add(p.si);
  const df = seen.size || 1;
  const headBy = new Map(head.map((p) => [p.si, p.pos]));
  const bodyBy = new Map(body.map((p) => [p.si, p.pos]));
  const out = new Map<number, Match>();
  const quiet = STOP.has(key);
  for (const si of seen) {
    const bpos = bodyBy.get(si) ?? [];
    const hpos = headBy.get(si) ?? [];
    const tf = bpos.length + hpos.length * 1.8;
    out.set(si, {
      score: bm25(tf, df, index.dl[si] || 1, index.avgdl, n) * (quiet ? 0.15 : 1),
      body: quiet ? [] : bpos,
      heading: quiet ? [] : hpos,
    });
  }
  return out;
}

export function phrasePositions(tokens: Token[], keys: string[], where: "stem" | "norm"): number[] {
  if (!keys.length || tokens.length < keys.length) return [];
  const hits: number[] = [];
  for (let i = 0; i <= tokens.length - keys.length; i++) {
    let ok = true;
    for (let k = 0; k < keys.length; k++) {
      const tok = tokens[i + k];
      if ((where === "stem" ? tok.stem : tok.norm) !== keys[k]) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (let k = 0; k < keys.length; k++) hits.push(i + k);
    }
  }
  return hits;
}

function evalPhrase(index: Index, keys: string[], where: "stem" | "norm"): Map<number, Match> {
  if (keys.length === 0) return new Map();
  // Candidate sections: those containing every key in the body (or heading).
  const lists = keys.map((k) => {
    const set = new Set<number>();
    for (const p of lookup(index, k, where, false)) set.add(p.si);
    for (const p of lookup(index, k, where, true)) set.add(p.si);
    return set;
  });
  let candidates = lists[0] ?? new Set<number>();
  for (const set of lists.slice(1)) {
    candidates = new Set([...candidates].filter((si) => set.has(si)));
  }
  const out = new Map<number, Match>();
  for (const si of candidates) {
    const sec = index.sections[si];
    const body = phrasePositions(sec.body, keys, where);
    const heading = phrasePositions(sec.heading, keys, where);
    if (!body.length && !heading.length) continue;
    // Score from the rarest term, boosted.
    let score = 0;
    for (const key of keys) {
      const alone = evalTerm(index, key, where).get(si);
      if (alone) score += alone.score;
    }
    out.set(si, { score: score * 1.45, body, heading });
  }
  return out;
}

function mergeMatch(a: Match, b: Match, scores: "sum"): Match {
  void scores;
  return {
    score: a.score + b.score,
    body: [...a.body, ...b.body],
    heading: [...a.heading, ...b.heading],
  };
}

function evalClause(index: Index, clause: Clause): Map<number, Match> {
  if (clause.op === "term") return evalTerm(index, clause.key, clause.where);
  if (clause.op === "phrase") return evalPhrase(index, clause.keys, clause.where);
  if (clause.op === "or") {
    const out = new Map<number, Match>();
    for (const part of clause.parts) {
      for (const [si, m] of evalClause(index, part)) {
        const prev = out.get(si);
        out.set(si, prev ? mergeMatch(prev, m, "sum") : m);
      }
    }
    return out;
  }
  if (clause.op === "and") {
    if (!clause.parts.length) return new Map();
    let acc = evalClause(index, clause.parts[0]);
    for (const part of clause.parts.slice(1)) {
      const next = evalClause(index, part);
      const merged = new Map<number, Match>();
      for (const [si, m] of acc) {
        const o = next.get(si);
        if (o) merged.set(si, mergeMatch(m, o, "sum"));
      }
      acc = merged;
    }
    return acc;
  }
  const banned = evalClause(index, clause.clause);
  const out = new Map<number, Match>();
  index.sections.forEach((_, si) => {
    if (!banned.has(si)) out.set(si, { score: 0.15, body: [], heading: [] });
  });
  return out;
}

function uniqSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

export function clusters(positions: number[], gap = CLUSTER_GAP): number[][] {
  const ps = uniqSorted(positions);
  const out: number[][] = [];
  for (const p of ps) {
    const last = out[out.length - 1];
    if (!last || p - last[last.length - 1] > gap) out.push([p]);
    else last.push(p);
  }
  return out;
}

function segmentsBetween(text: string, tokens: Token[], from: number, to: number, hits: Set<number>, kin: Set<number> = new Set()): Seg[] {
  const segs: Seg[] = [];
  let cursor = tokens[from].start;
  for (let i = from; i <= to; i++) {
    const tok = tokens[i];
    if (tok.start > cursor) segs.push({ text: text.slice(cursor, tok.start), hit: false });
    segs.push({ text: text.slice(tok.start, tok.end), hit: hits.has(i), kin: hits.has(i) && kin.has(i), token: i });
    cursor = tok.end;
  }
  return segs;
}

const EMPTY_WORK: Work = {
  id: "",
  title: "",
  author: "",
  language: "",
  form: "",
  period: "",
  genre: "",
  edition: "",
  sections: [],
};

function snippetsFor(sec: SectionRec, bodyHits: number[], kin: Set<number> = new Set()): Snippet[] {
  const groups = bodyHits.length ? clusters(bodyHits) : [];
  const hitSet = new Set(bodyHits);
  const snippets: Snippet[] = [];

  const windows = groups.map((group) => {
    const start = Math.max(0, group[0] - WINDOW_BEFORE);
    const end = Math.min(sec.body.length - 1, group[group.length - 1] + WINDOW_AFTER);
    return { start, end, anchor: group[0] };
  });

  // Merge only windows that actually overlap, so distant hits each keep a snippet.
  const merged: { start: number; end: number; anchor: number }[] = [];
  for (const w of windows) {
    const prev = merged[merged.length - 1];
    if (prev && w.start <= prev.end) prev.end = Math.max(prev.end, w.end);
    else merged.push({ ...w });
  }

  for (const w of merged) {
    if (!sec.body.length) continue;
    snippets.push({
      id: `${sec.section.id}-${w.anchor}`,
      sectionId: sec.section.id,
      heading: sec.section.heading,
      segments: segmentsBetween(sec.section.text, sec.body, w.start, w.end, hitSet, kin),
      lead: w.start > 0,
      tail: w.end < sec.body.length - 1,
    });
  }

  if (!snippets.length && sec.body.length) {
    const end = Math.min(sec.body.length - 1, 48);
    snippets.push({
      id: `${sec.section.id}-open`,
      sectionId: sec.section.id,
      heading: sec.section.heading,
      segments: segmentsBetween(sec.section.text, sec.body, 0, end, new Set()),
      lead: false,
      tail: end < sec.body.length - 1,
    });
  }
  return snippets;
}

export function buildSnippets(sectionId: string, heading: string, text: string, tokens: Token[], bodyHits: number[], kin: Set<number> = new Set()): Snippet[] {
  return snippetsFor(
    { work: EMPTY_WORK, section: { id: sectionId, heading, text }, body: tokens, heading: [] },
    bodyHits,
    kin,
  );
}

function valuesFor(work: Work, key: FacetKey): string[] {
  if (key === "author" || key === "language") return listOf(work[key]);
  return work[key] ? [work[key]] : [];
}

function passesFacets(work: Work, facets: FacetSelection): boolean {
  const keys: FacetKey[] = ["language", "author", "form", "period", "genre"];
  return keys.every((key) => facets[key].length === 0 || facets[key].some((value) => valuesFor(work, key).includes(value)));
}

function groupHits(index: Index, matches: Map<number, Match>): WorkHit[] {
  const byWork = new Map<string, WorkHit>();
  for (const [si, match] of matches) {
    const sec = index.sections[si];
    if (!sec) continue;
    const bodyHits = uniqSorted(match.body);
    const headingHits = uniqSorted(match.heading);
    const snips = snippetsFor(sec, bodyHits);
    const sectionHit: SectionHit = {
      sectionId: sec.section.id,
      heading: sec.section.heading,
      score: match.score,
      snippets: snips,
      bodyHits,
      headingHits,
    };
    let workHit = byWork.get(sec.work.id);
    if (!workHit) {
      workHit = { work: sec.work, score: 0, matchCount: 0, sections: [] };
      byWork.set(sec.work.id, workHit);
    }
    workHit.sections.push(sectionHit);
    workHit.score += match.score;
    workHit.matchCount += clusters(bodyHits).length + (bodyHits.length === 0 && headingHits.length ? 1 : 0);
  }
  for (const hit of byWork.values()) {
    hit.sections.sort((a, b) => {
      const wa = hit.work.sections.findIndex((s) => s.id === a.sectionId);
      const wb = hit.work.sections.findIndex((s) => s.id === b.sectionId);
      return wa - wb;
    });
  }
  return [...byWork.values()].sort((a, b) => b.score - a.score || a.work.title.localeCompare(b.work.title));
}

export function searchLibrary(
  index: Index,
  opts: {
    query: string;
    within?: string;
    useStem: boolean;
    fuzzy: boolean;
    concept: boolean;
  },
): { hits: WorkHit[]; error: string | null; active: boolean } {
  const q = opts.query.trim();
  const w = (opts.within ?? "").trim();
  if (!q && !w) return { hits: [], error: null, active: false };
  try {
    const left = q ? rewrite(must(parseRich(q, opts.fuzzy)), index, opts.useStem, opts.concept) : null;
    const right = w ? rewrite(must(parseRich(w, opts.fuzzy)), index, opts.useStem, opts.concept) : null;
    let clause: Clause | null = left;
    if (left && right) clause = { op: "and", parts: [left, right] };
    else clause = left ?? right;
    if (!clause) return { hits: [], error: null, active: false };
    const matches = evalClause(index, clause);
    return { hits: groupHits(index, matches), error: null, active: true };
  } catch (err) {
    const message = err instanceof QueryError ? err.message : "The query could not be read.";
    return { hits: [], error: message, active: true };
  }
}

function must(clause: Clause | null): Clause {
  if (!clause) throw new QueryError("Enter a word to search.");
  return clause;
}

export function facetCounts(hits: WorkHit[], facets: FacetSelection): FacetGroups {
  const keys: FacetKey[] = ["language", "author", "form", "period", "genre"];
  const groups = {} as FacetGroups;
  for (const key of keys) {
    const base = hits.filter((hit) => passesFacets(hit.work, { ...facets, [key]: [] }));
    const tally = new Map<string, number>();
    for (const hit of base) {
      for (const name of valuesFor(hit.work, key)) tally.set(name, (tally.get(name) ?? 0) + 1);
    }
    for (const name of facets[key]) if (!tally.has(name)) tally.set(name, 0);
    groups[key] = [...tally.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }
  return groups;
}

/** Hits inside one work, ignoring library-wide facet filters. */
export function searchWork(
  index: Index,
  workId: string,
  opts: { query: string; useStem: boolean; fuzzy: boolean; concept: boolean },
): { hit: WorkHit | null; error: string | null } {
  const q = opts.query.trim();
  if (!q) return { hit: null, error: null };
  const result = searchLibrary(index, {
    query: q,
    useStem: opts.useStem,
    fuzzy: opts.fuzzy,
    concept: opts.concept,
  });
  return { hit: result.hits.find((h) => h.work.id === workId) ?? null, error: result.error };
}

export function readerSegments(text: string, tokens: Token[], hits: number[], kin: Set<number> = new Set()): Seg[] {
  if (!tokens.length) return [{ text, hit: false }];
  const hitSet = new Set(hits);
  const segs: Seg[] = [];
  let cursor = 0;
  tokens.forEach((tok, i) => {
    if (tok.start > cursor) segs.push({ text: text.slice(cursor, tok.start), hit: false });
    segs.push({ text: text.slice(tok.start, tok.end), hit: hitSet.has(i), kin: hitSet.has(i) && kin.has(i), token: i });
    cursor = tok.end;
  });
  if (cursor < text.length) segs.push({ text: text.slice(cursor), hit: false });
  return segs;
}

/** Token indexes whose word is a concept-family synonym, not the word that was typed. */
export function kinIndexes(tokens: Token[], hits: number[], query: string, within: string, useStem: boolean, concept: boolean): Set<number> {
  if (!concept || !hits.length) return new Set();
  const keys = synonymKeys(`${query} ${within}`, useStem);
  if (!keys.size) return new Set();
  const out = new Set<number>();
  for (const index of hits) {
    const token = tokens[index];
    if (!token) continue;
    if (keys.has(useStem ? token.stem : token.norm)) out.add(index);
  }
  return out;
}

function synonymKeys(input: string, useStem: boolean): Set<string> {
  const kin = new Set<string>();
  const own = new Set<string>();
  let clause: QueryClause | null = null;
  try {
    clause = parseQuery(input, false);
  } catch {
    return kin;
  }
  if (!clause) return kin;
  const visit = (part: QueryClause) => {
    if (part.op === "term") {
      const base = useStem ? (tokenize(part.key)[0]?.stem ?? part.key) : part.key;
      own.add(base);
      if (part.prefix || (part.fuzz ?? 0) > 0) return;
      const family = conceptFamily(part.key);
      if (!family) return;
      for (const word of family) {
        const key = useStem ? (tokenize(word)[0]?.stem ?? word) : word;
        if (key !== base) kin.add(key);
      }
      return;
    }
    if (part.op === "phrase") {
      for (const key of part.keys) own.add(useStem ? (tokenize(key)[0]?.stem ?? key) : key);
      return;
    }
    if (part.op === "not") return;
    part.parts.forEach(visit);
  };
  visit(clause);
  for (const key of own) kin.delete(key);
  return kin;
}

export function anchorId(sectionId: string, tokenIndex: number): string {
  return `m-${sectionId}-${tokenIndex}`;
}

export { aimedSection, aimedToken } from "./aim";
