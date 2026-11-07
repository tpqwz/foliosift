import type { Work } from "../corpus/types";
import { conceptFamily, ensureThesaurus, thesaurusReady } from "./concepts";
import {
  averageLength,
  loadBodies,
  loadEntries,
  scanTerm,
  sectionCount,
  sectionLength,
  segmentCount,
  termsExist,
  prefixTerms,
  indexReady,
  indexBusy,
  ensureIndex,
  indexIfNeeded,
  type DirEntry,
} from "./disk-index";
import {
  buildSnippets,
  clusters,
  isQuietTerm,
  kinIndexes,
  parseQuery,
  phrasePositions,
  QueryError,
  searchLibrary,
  buildIndex,
  type QueryClause,
  type WorkHit,
} from "./engine";
import { tokenize } from "./tokenize";

type Match = { score: number; body: number[]; heading: number[] };
type Kind = "bn" | "bs" | "hn" | "hs";

const K1 = 1.2;
const B = 0.75;
const LIBRARY_CAP = 2000;
const QUIET_CAP = 80;
const WORK_CAP = 5000;

type Pack = {
  ids: Set<number>;
  df: number;
  body: Map<number, number[]>;
  head: Map<number, number[]>;
};

type Ctx = {
  workId?: string;
  n: number;
  avgdl: number;
  capped: boolean;
  onProgress?: SearchProgress;
  seenTerms: number;
};

function bm25(tf: number, df: number, dl: number, avgdl: number, n: number): number {
  const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
  const denom = tf + K1 * (1 - B + B * (dl / (avgdl || 1)));
  return idf * ((tf * (K1 + 1)) / (denom || 1));
}

function edits(word: string): string[] {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const out = new Set<string>();
  for (let i = 0; i <= word.length; i++) {
    if (i < word.length) out.add(word.slice(0, i) + word.slice(i + 1));
    if (i < word.length - 1) out.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
    for (const letter of letters) {
      if (i < word.length) out.add(word.slice(0, i) + letter + word.slice(i + 1));
      out.add(word.slice(0, i) + letter + word.slice(i));
    }
  }
  out.delete(word);
  return [...out];
}

function kinds(where: "stem" | "norm"): [Kind, Kind] {
  return where === "stem" ? ["bs", "hs"] : ["bn", "hn"];
}

function hasNot(clause: QueryClause): boolean {
  if (clause.op === "not") return true;
  if (clause.op === "and" || clause.op === "or") return clause.parts.some(hasNot);
  return false;
}

function quietClause(clause: QueryClause): boolean {
  if (clause.op === "term") return isQuietTerm(clause.key);
  if (clause.op === "phrase") return clause.keys.every((key) => isQuietTerm(key));
  if (clause.op === "and" || clause.op === "or") return clause.parts.every(quietClause);
  return false;
}

async function bindTerms(clause: QueryClause, useStem: boolean, concept: boolean): Promise<QueryClause> {
  if (clause.op === "and" || clause.op === "or") {
    return { op: clause.op, parts: await Promise.all(clause.parts.map((part) => bindTerms(part, useStem, concept))) };
  }
  if (clause.op === "not") return { op: "not", clause: await bindTerms(clause.clause, useStem, false) };
  if (clause.op === "phrase") {
    const where = useStem ? "stem" : "norm";
    const keys = clause.keys.map((key) => (useStem ? (tokenize(key)[0]?.stem ?? key) : key));
    return { op: "phrase", keys, where };
  }
  const where = useStem ? "stem" : "norm";
  const norm = clause.key;
  const stemmed = tokenize(norm)[0]?.stem ?? norm;
  const base = useStem ? stemmed : norm;
  let keys: string[] = [];
  if (clause.prefix) {
    if (norm.length < 2) keys = [base];
    else {
      const [body, head] = await Promise.all([
        prefixTerms(useStem ? "bs" : "bn", base, 24),
        prefixTerms(useStem ? "hs" : "hn", base, 24),
      ]);
      keys = [...new Set([...body, ...head])].slice(0, 24);
      if (!keys.length) keys = [base];
    }
  } else if ((clause.fuzz ?? 0) > 0) {
    const candidates = edits(norm).slice(0, 700);
    const probed = candidates.map((word) => (useStem ? (tokenize(word)[0]?.stem ?? word) : word));
    const [body, head] = await Promise.all([
      termsExist(useStem ? "bs" : "bn", probed),
      termsExist(useStem ? "hs" : "hn", probed),
    ]);
    keys = [...new Set([...body, ...head])].slice(0, 20);
    if (!keys.includes(base)) keys.unshift(base);
  } else {
    keys = [base];
  }
  if (concept && !clause.prefix && !(clause.fuzz && clause.fuzz > 0)) {
    for (const word of conceptFamily(norm) ?? []) {
      keys.push(useStem ? (tokenize(word)[0]?.stem ?? word) : word);
    }
  }
  const unique = [...new Set(keys)];
  if (unique.length === 1) return { op: "term", key: unique[0], where };
  return { op: "or", parts: unique.map((key) => ({ op: "term" as const, key, where })) };
}

async function rarity(key: string, where: "stem" | "norm", workId?: string): Promise<number> {
  const [body, head] = kinds(where);
  const [a, b] = await Promise.all([segmentCount(body, key, workId), segmentCount(head, key, workId)]);
  return a + b;
}

async function cost(clause: QueryClause, workId?: string): Promise<number> {
  if (clause.op === "term") return rarity(clause.key, clause.where, workId);
  if (clause.op === "phrase") {
    const loud = clause.keys.filter((key) => !isQuietTerm(key));
    const keys = loud.length ? loud : clause.keys;
    const counts = await Promise.all(keys.map((key) => rarity(key, clause.where, workId)));
    return counts.length ? Math.min(...counts) : 0;
  }
  if (clause.op === "or") {
    const counts = await Promise.all(clause.parts.map((part) => cost(part, workId)));
    return counts.reduce((sum, n) => sum + n, 0);
  }
  if (clause.op === "and") {
    const positives = clause.parts.filter((part) => part.op !== "not");
    const counts = await Promise.all(positives.map((part) => cost(part, workId)));
    return counts.length ? Math.min(...counts) : 1e9;
  }
  return 1e9;
}

async function collect(key: string, where: "stem" | "norm", ctx: Ctx, restrict?: Set<number>): Promise<Pack> {
  const [bodyKind, headKind] = kinds(where);
  const cap = restrict ? Number.POSITIVE_INFINITY : ctx.workId ? WORK_CAP : isQuietTerm(key) ? QUIET_CAP : LIBRARY_CAP;
  ctx.seenTerms += 1;
  ctx.onProgress?.(`Matching “${key}”${ctx.seenTerms > 1 ? `, word ${ctx.seenTerms}` : ""}…`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const ids = new Set<number>();
  const body = new Map<number, number[]>();
  const head = new Map<number, number[]>();
  const seen = new Set<number>();
  let df = 0;
  let capped = false;

  const take = (si: number, pos: Uint32Array, dest: Map<number, number[]>) => {
    if (!seen.has(si)) {
      seen.add(si);
      df += 1;
    }
    if (restrict && !restrict.has(si)) return;
    if (!restrict && ids.size >= cap && !ids.has(si)) {
      capped = true;
      return;
    }
    ids.add(si);
    const extra = Array.from(pos);
    const prev = dest.get(si);
    dest.set(si, prev ? prev.concat(extra) : extra);
  };

  const stop = () => capped && !restrict;
  await scanTerm(
    bodyKind,
    key,
    (si, pos) => {
      take(si, pos, body);
      if (stop()) return false;
    },
    ctx.workId,
  );
  if (!stop()) {
    await scanTerm(
      headKind,
      key,
      (si, pos) => {
        take(si, pos, head);
        if (stop()) return false;
      },
      ctx.workId,
    );
  }
  if (capped) {
    ctx.capped = true;
    if (!ctx.workId) df = Math.max(df, sectionCount());
  }
  return { ids, df: df || 1, body, head };
}

function fromPack(key: string, pack: Pack, ctx: Ctx): Map<number, Match> {
  const quiet = isQuietTerm(key);
  const out = new Map<number, Match>();
  for (const si of pack.ids) {
    const bpos = pack.body.get(si) ?? [];
    const hpos = pack.head.get(si) ?? [];
    const tf = bpos.length + hpos.length * 1.8;
    out.set(si, {
      score: bm25(tf, pack.df, sectionLength(si), ctx.avgdl, ctx.n) * (quiet ? 0.15 : 1),
      body: quiet ? [] : bpos,
      heading: quiet ? [] : hpos,
    });
  }
  return out;
}

function mergeMatch(a: Match, b: Match): Match {
  return { score: a.score + b.score, body: [...a.body, ...b.body], heading: [...a.heading, ...b.heading] };
}

async function scorePhrase(
  clause: { keys: string[]; where: "stem" | "norm" },
  ctx: Ctx,
  restrict?: Set<number>,
): Promise<Map<number, Match>> {
  const loud = clause.keys.filter((key) => !isQuietTerm(key));
  const use = loud.length ? loud : clause.keys;
  const weights = await Promise.all(use.map((key) => rarity(key, clause.where, ctx.workId)));
  const ordered = use
    .map((key, index) => ({ key, n: weights[index] ?? 0 }))
    .sort((a, b) => a.n - b.n)
    .map((item) => item.key);
  let current = restrict ? new Set(restrict) : undefined;
  const packs: Pack[] = [];
  for (const key of ordered) {
    if (current && current.size === 0) break;
    const pack = await collect(key, clause.where, ctx, current);
    packs.push(pack);
    current = pack.ids;
  }
  const ids = [...(current ?? [])];
  if (!ids.length) return new Map();
  const [bodies, entries] = await Promise.all([loadBodies(ids), loadEntries(ids)]);
  const out = new Map<number, Match>();
  for (const si of ids) {
    const entry = entries.get(si);
    const text = bodies.get(si);
    if (!entry || text == null) continue;
    const body = phrasePositions(tokenize(text), clause.keys, clause.where);
    const heading = phrasePositions(tokenize(entry.heading), clause.keys, clause.where);
    if (!body.length && !heading.length) continue;
    let score = 0;
    for (const pack of packs) {
      const bpos = pack.body.get(si) ?? [];
      const hpos = pack.head.get(si) ?? [];
      if (!bpos.length && !hpos.length) continue;
      const tf = bpos.length + hpos.length * 1.8;
      score += bm25(tf, pack.df, sectionLength(si), ctx.avgdl, ctx.n);
    }
    out.set(si, { score: score * 1.45, body, heading });
  }
  return out;
}

async function evalClause(clause: QueryClause, ctx: Ctx, restrict?: Set<number>): Promise<Map<number, Match>> {
  if (clause.op === "term") return fromPack(clause.key, await collect(clause.key, clause.where, ctx, restrict), ctx);
  if (clause.op === "phrase") return scorePhrase(clause, ctx, restrict);
  if (clause.op === "or") {
    if (clause.parts.some(hasNot)) throw new QueryError("Use NOT to narrow a search, as in death NOT fear.");
    const out = new Map<number, Match>();
    for (const part of clause.parts) {
      for (const [si, match] of await evalClause(part, ctx, restrict)) {
        const prev = out.get(si);
        out.set(si, prev ? mergeMatch(prev, match) : match);
      }
    }
    return out;
  }
  if (clause.op === "and") {
    const negatives = clause.parts.filter((part) => part.op === "not");
    let positives = clause.parts.filter((part) => part.op !== "not");
    if (positives.some((part) => !quietClause(part))) positives = positives.filter((part) => !quietClause(part));
    const ranked = await Promise.all(positives.map(async (part) => ({ part, n: await cost(part, ctx.workId) })));
    ranked.sort((a, b) => a.n - b.n);
    let acc: Map<number, Match> | null = null;
    for (const { part } of ranked) {
      const nextRestrict = acc ? new Set(acc.keys()) : restrict;
      const next = await evalClause(part, ctx, nextRestrict);
      if (!acc) acc = next;
      else {
        const merged = new Map<number, Match>();
        for (const [si, match] of next) {
          const prev = acc.get(si);
          if (prev) merged.set(si, mergeMatch(prev, match));
        }
        acc = merged;
      }
      if (acc.size === 0) break;
    }
    if (!acc) throw new QueryError("Use NOT to narrow a search, as in death NOT fear.");
    for (const part of negatives) {
      if (part.op !== "not") continue;
      const banned = await evalClause(part.clause, ctx, new Set(acc.keys()));
      for (const si of banned.keys()) acc.delete(si);
    }
    return acc;
  }
  throw new QueryError("Use NOT to narrow a search, as in death NOT fear.");
}

export type SearchProgress = (line: string) => void;

async function group(
  matches: Map<number, Match>,
  works: Map<string, Work>,
  onProgress?: SearchProgress,
  bare = false,
  mark?: { query: string; within: string; useStem: boolean; concept: boolean },
): Promise<WorkHit[]> {
  const total = matches.size;
  if (total > 40) onProgress?.(`Matched ${total.toLocaleString()} places. Choosing the strongest passages…`);
  const entries = await loadEntries([...matches.keys()]);
  const ranked = new Map<string, { si: number; match: Match; entry: DirEntry }[]>();
  for (const [si, match] of matches) {
    const entry = entries.get(si);
    const work = entry ? works.get(entry.workId) : undefined;
    if (!entry || !work) continue;
    const list = ranked.get(work.id) ?? [];
    list.push({ si, match, entry });
    ranked.set(work.id, list);
  }
  const snippetFor = new Set<number>();
  for (const list of ranked.values()) {
    list.sort((a, b) => b.match.score - a.match.score);
    for (const row of list.slice(0, bare ? 1 : 6)) snippetFor.add(row.si);
  }
  const bodies = bare ? null : await loadBodies([...snippetFor]);
  const byWork = new Map<string, WorkHit>();
  let built = 0;
  const opening = snippetFor.size;
  for (const [workId, list] of ranked) {
    const work = works.get(workId);
    if (!work) continue;
    const hit: WorkHit = { work, score: 0, matchCount: 0, sections: [] };
    for (const { si, match, entry } of list) {
      const bodyHits = [...new Set(match.body)].sort((a, b) => a - b);
      const headingHits = [...new Set(match.heading)].sort((a, b) => a - b);
      const text = bodies?.get(si);
      const tokens = text != null && snippetFor.has(si) ? tokenize(text) : [];
      const kin = mark ? kinIndexes(tokens, bodyHits, mark.query, mark.within, mark.useStem, mark.concept) : new Set<number>();
      const snippets = tokens.length ? buildSnippets(entry.sectionId, entry.heading, text ?? "", tokens, bodyHits, kin) : [];
      hit.score += match.score;
      hit.matchCount += clusters(bodyHits).length + (bodyHits.length === 0 && headingHits.length ? 1 : 0);
      if (snippets.length || headingHits.length) {
        hit.sections.push({
          sectionId: entry.sectionId,
          heading: entry.heading,
          score: match.score,
          snippets,
          bodyHits,
          headingHits,
        });
      }
      built += 1;
      if (built % 12 === 0 && opening > 12) {
        onProgress?.(`Opening passages, ${Math.min(built, opening).toLocaleString()} of ${opening.toLocaleString()}…`);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    const order = new Map(work.sections.map((section, index) => [section.id, index]));
    hit.sections.sort((a, b) => (order.get(a.sectionId) ?? 0) - (order.get(b.sectionId) ?? 0) || b.score - a.score);
    byWork.set(workId, hit);
  }
  return [...byWork.values()].sort((a, b) => b.score - a.score || a.work.title.localeCompare(b.work.title));
}

async function searchDisk(opts: {
  query: string;
  within?: string;
  useStem: boolean;
  fuzzy: boolean;
  concept: boolean;
  works: Work[];
  workId?: string;
  bare?: boolean;
  onProgress?: SearchProgress;
}): Promise<{ hits: WorkHit[]; error: string | null; active: boolean; note: string | null }> {
  const query = opts.query.trim();
  const within = (opts.within ?? "").trim();
  if (!query && !within) return { hits: [], error: null, active: false, note: null };
  if (opts.concept && !thesaurusReady()) {
    opts.onProgress?.("Reading the thesaurus…");
    await ensureThesaurus();
  }
  const series = opts.works.filter((work) => work.series && (!opts.workId || work.id === opts.workId));
  if (!opts.workId && series.length) {
    await ensureIndex(opts.works, { onProgress: opts.onProgress });
  } else if (opts.workId && series.length === 1) {
    await indexIfNeeded(series[0], opts.onProgress);
  }
  opts.onProgress?.("Reading the index…");
  await indexReady();
  const waiting = !opts.workId && indexBusy();
  if (waiting) opts.onProgress?.("A volume is still being indexed. Searching what is already saved…");
  const left = query ? parseQuery(query, opts.fuzzy) : null;
  const right = within ? parseQuery(within, opts.fuzzy) : null;
  if (query && !left) throw new QueryError("Enter a word to search.");
  if (within && !right) throw new QueryError("Enter a word to search.");
  let clause = left;
  if (left && right) clause = { op: "and", parts: [left, right] };
  else clause = left ?? right;
  if (!clause) return { hits: [], error: null, active: false, note: null };
  const bound = await bindTerms(clause, opts.useStem, opts.concept);
  const ctx: Ctx = {
    workId: opts.workId,
    n: sectionCount() || 1,
    avgdl: averageLength(),
    capped: false,
    onProgress: opts.onProgress,
    seenTerms: 0,
  };
  opts.onProgress?.(waiting ? "Matching the shelf already saved…" : "Matching the shelf…");
  let matches = await evalClause(bound, ctx);
  const byId = new Map(opts.works.map((work) => [work.id, work]));
  const hits = await group(matches, byId, opts.onProgress, opts.bare, {
    query,
    within,
    useStem: opts.useStem,
    concept: opts.concept,
  });
  const note = waiting
    ? "A volume is still being indexed, so these matches are from what is already saved."
    : ctx.capped
      ? "Showing the strongest matches. Narrow the query to list every remaining one."
      : null;
  return { hits, error: null, active: true, note };
}

export async function searchStored(opts: {
  query: string;
  within?: string;
  useStem: boolean;
  fuzzy: boolean;
  concept: boolean;
  works: Work[];
  workId?: string;
  bare?: boolean;
  onProgress?: SearchProgress;
}): Promise<{ hits: WorkHit[]; error: string | null; active: boolean; note: string | null }> {
  try {
    return await searchDisk(opts);
  } catch (error) {
    if (error instanceof QueryError) return { hits: [], error: error.message, active: true, note: null };
    try {
    opts.onProgress?.("Reading the volumes on this device…");
    const index = buildIndex(opts.works.filter((work) => work.sections.some((section) => section.text.length > 0)));
      const result = searchLibrary(index, opts);
      const hits = opts.workId ? result.hits.filter((hit) => hit.work.id === opts.workId) : result.hits;
      return { ...result, hits, note: null };
    } catch (err) {
      const message = err instanceof QueryError ? err.message : "The query could not be read.";
      return { hits: [], error: message, active: true, note: null };
    }
  }
}
