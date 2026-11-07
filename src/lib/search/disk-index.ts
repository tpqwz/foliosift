import type { Work } from "../corpus/types";
import { isSample, loadSampleText, sampleStamp } from "../corpus/works";
import { loadStoredWork } from "../library-db";
import { encodePostings, visitPostings, type Posting } from "./postings";
import type { ShippedWork } from "./shipped";
import { tokenize } from "./tokenize";

/**
 * A Loeb-scale shelf is a few hundred bilingual volumes, on the order of 10^8 tokens.
 * Each posting record is one term in one volume. Indexing a book never rewrites the
 * rest of the library. Startup reads the length table and stamps, not the texts.
 * A search streams only the terms it asked for.
 */
const DB_NAME = "folio-index";
const DB_VERSION = 2;
const SEP = "\u0000";

export type DirEntry = {
  si: number;
  workId: string;
  sectionId: string;
  heading: string;
  ord: number;
  dl: number;
};

type Kind = "bn" | "bs" | "hn" | "hs";

type Meta = {
  id: "meta";
  nextSi: number;
  totalTokens: number;
  live: number;
  stamps: Record<string, string>;
  spans: Record<string, [number, number]>;
  lengths: ArrayBuffer;
  tomb: ArrayBuffer;
};

let lengths = new Uint32Array(0);
let tomb = new Uint8Array(0);
let stamps: Record<string, string> = {};
let spans: Record<string, [number, number]> = {};
let nextSi = 0;
let totalTokens = 0;
let live = 0;
let opening: Promise<IDBDatabase> | null = null;
let loaded: Promise<void> | null = null;
const jobs: Array<() => Promise<void>> = [];
let active = false;
const staged = new Map<string, ShippedWork>();

/** A restored index is applied on the next pass, instead of tokenizing the volume again. */
export function stageWorkPack(id: string, pack: ShippedWork): void {
  if (id && pack.sections.length) staged.set(id, pack);
}

function pump() {
  if (active) return;
  const job = jobs.shift();
  if (!job) return;
  active = true;
  void job().finally(() => {
    active = false;
    pump();
  });
}

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    jobs.push(() => job().then(resolve, reject));
    pump();
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error?: unknown) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (error) reject(error instanceof Error ? error : new Error("The index save was aborted."));
      else resolve();
    };
    const timer = setTimeout(() => {
      try {
        tx.abort();
      } catch {
        /* already closed */
      }
      finish(new Error("Indexing paused because a save did not finish. Try the file again."));
    }, 30000);
    tx.oncomplete = () => finish();
    tx.onabort = () => finish(tx.error ?? new Error("The index save was aborted."));
  });
}

function req<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no idb"));
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        if (event.oldVersion > 0 && event.oldVersion < 2) {
          for (const name of ["meta", "secmeta", "bodies", "postings"]) {
            if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
          }
        }
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "id" });
        if (!db.objectStoreNames.contains("secmeta")) db.createObjectStore("secmeta", { keyPath: "si" });
        if (!db.objectStoreNames.contains("bodies")) db.createObjectStore("bodies");
        if (!db.objectStoreNames.contains("postings")) db.createObjectStore("postings");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        opening = null;
        reject(request.error);
      };
    });
  }
  return opening;
}

function asBuffer(value: unknown): ArrayBuffer | undefined {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return copy.buffer;
  }
  return undefined;
}

/** Read a posting record in place. The cursor keeps it alive until the next continue. */
function postingView(value: unknown): Uint32Array | null {
  if (value instanceof Uint32Array) return value;
  if (value instanceof ArrayBuffer) return value.byteLength >= 4 ? new Uint32Array(value) : null;
  if (ArrayBuffer.isView(value) && value.byteLength >= 4) {
    const length = Math.floor(value.byteLength / 4);
    return new Uint32Array(value.buffer, value.byteOffset, length);
  }
  return null;
}

function stampOf(work: Work): string {
  let chars = 0;
  for (const section of work.sections) chars += section.text.length + section.heading.length;
  return `${work.sections.length}:${chars}`;
}

function ensureCap(n: number) {
  if (lengths.length >= n) return;
  const size = Math.max(n, lengths.length * 2, 1024);
  const next = new Uint32Array(size);
  next.set(lengths);
  lengths = next;
  const bits = new Uint8Array(Math.ceil(size / 8));
  bits.set(tomb);
  tomb = bits;
}

function tombHas(si: number): boolean {
  return ((tomb[si >> 3] ?? 0) & (1 << (si & 7))) !== 0;
}

function tombSet(si: number, on: boolean) {
  ensureCap(si + 1);
  const i = si >> 3;
  const bit = 1 << (si & 7);
  tomb[i] = on ? tomb[i] | bit : tomb[i] & ~bit;
}

async function loadNow(): Promise<void> {
  const db = await openDb();
  const meta = (await req(db.transaction("meta", "readonly").objectStore("meta").get("meta"))) as Meta | undefined;
  lengths = new Uint32Array(0);
  tomb = new Uint8Array(0);
  stamps = {};
  spans = {};
  nextSi = 0;
  totalTokens = 0;
  live = 0;
  if (!meta) return;
  nextSi = meta.nextSi || 0;
  totalTokens = meta.totalTokens || 0;
  live = meta.live || 0;
  stamps = meta.stamps ?? {};
  spans = meta.spans ?? {};
  if (meta.lengths instanceof ArrayBuffer && meta.lengths.byteLength >= 4) {
    lengths = new Uint32Array(meta.lengths.slice(0));
  }
  if (meta.tomb instanceof ArrayBuffer && meta.tomb.byteLength) {
    tomb = new Uint8Array(meta.tomb.slice(0));
  }
  ensureCap(nextSi);
}

function load(): Promise<void> {
  if (!loaded) {
    loaded = loadNow().catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  }
  return loaded;
}

async function saveMeta(db: IDBDatabase): Promise<void> {
  const meta: Meta = {
    id: "meta",
    nextSi,
    totalTokens,
    live,
    stamps,
    spans,
    lengths: lengths.slice(0, nextSi).buffer,
    tomb: tomb.slice(0, Math.ceil(nextSi / 8)).buffer,
  };
  const tx = db.transaction("meta", "readwrite");
  tx.objectStore("meta").put(meta);
  await done(tx);
}

function storeKey(kind: Kind, term: string, workId: string): string {
  return `${kind}:${term}${SEP}${workId}`;
}

function termRange(kind: Kind, term: string, workId?: string): IDBKeyRange {
  const start = `${kind}:${term}${SEP}`;
  if (!workId) return IDBKeyRange.bound(start, `${start}\uffff`);
  const exact = `${start}${workId}`;
  return IDBKeyRange.bound(exact, `${exact}${SEP}\uffff`);
}

function push(map: Map<string, Posting[]>, key: string, si: number, pos: number) {
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

async function writeSegments(workId: string, updates: Map<string, Posting[]>, note?: (line: string) => void): Promise<number> {
  const keys = [...updates.keys()];
  if (!keys.length) return 0;
  const db = await openDb();
  const batch = 200;
  for (let offset = 0; offset < keys.length; offset += batch) {
    const slice = keys.slice(offset, offset + batch);
    note?.(`Saving the index, ${Math.min(keys.length, offset + slice.length)} of ${keys.length}`);
    const tx = db.transaction("postings", "readwrite");
    const store = tx.objectStore("postings");
    for (const key of slice) {
      const extra = updates.get(key);
      if (!extra?.length) continue;
      const kind = key.slice(0, 2) as Kind;
      const term = key.slice(3);
      const bytes = encodePostings(extra).slice(0);
      store.put(bytes, storeKey(kind, term, workId));
    }
    await done(tx);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return keys.length;
}

async function writeDocs(metas: DirEntry[], bodies: { si: number; text: string }[]): Promise<void> {
  if (!metas.length) return;
  const db = await openDb();
  const batch = 20;
  for (let offset = 0; offset < metas.length; offset += batch) {
    const tx = db.transaction(["secmeta", "bodies"], "readwrite");
    const metaStore = tx.objectStore("secmeta");
    const bodyStore = tx.objectStore("bodies");
    metas.slice(offset, offset + batch).forEach((entry) => metaStore.put(entry));
    bodies.slice(offset, offset + batch).forEach((body) => bodyStore.put(body.text, body.si));
    await done(tx);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function appendSegments(
  workId: string,
  part: number,
  updates: Map<string, Posting[]>,
  note?: (line: string) => void,
): Promise<number> {
  const keys = [...updates.keys()];
  if (!keys.length) return 0;
  const db = await openDb();
  const batch = 400;
  const tag = part.toString(36);
  for (let offset = 0; offset < keys.length; offset += batch) {
    const slice = keys.slice(offset, offset + batch);
    note?.(`Saving the index, ${Math.min(keys.length, offset + slice.length)} of ${keys.length} terms in this part`);
    const tx = db.transaction("postings", "readwrite");
    const store = tx.objectStore("postings");
    for (const key of slice) {
      const extra = updates.get(key);
      if (!extra?.length) continue;
      const kind = key.slice(0, 2) as Kind;
      const term = key.slice(3);
      store.put(encodePostings(extra).slice(0), `${storeKey(kind, term, workId)}${SEP}${tag}`);
    }
    await done(tx);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return keys.length;
}

async function clearWorkPostings(workId: string): Promise<void> {
  const suffix = `${SEP}${workId}`;
  const db = await openDb();
  for (const kind of ["bn", "bs", "hn", "hs"] as const) {
    const tx = db.transaction("postings", "readwrite");
    const store = tx.objectStore("postings");
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor(IDBKeyRange.bound(`${kind}:`, `${kind}:\uffff`));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (String(cursor.key).endsWith(suffix) || String(cursor.key).includes(`${suffix}${SEP}`)) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function packFits(work: Work, pack: ShippedWork): boolean {
  if (pack.stamp !== stampOf(work) || pack.sections.length !== work.sections.length) return false;
  for (let i = 0; i < work.sections.length; i++) {
    if (pack.sections[i]?.id !== work.sections[i]?.id) return false;
  }
  return true;
}

async function readShipped(id: string): Promise<ShippedWork | null> {
  if (typeof fetch === "undefined") return null;
  try {
    const response = await fetch(`/shelf-index/${id}.bin`);
    if (!response.ok) return null;
    const { gunzipSync } = await import("fflate");
    const { decodeShelf } = await import("./shipped");
    return decodeShelf(gunzipSync(new Uint8Array(await response.arrayBuffer())));
  } catch {
    return null;
  }
}

function addPrepared(updates: Map<string, Posting[]>, si: number, postings: Map<string, number[]>) {
  for (const [key, positions] of postings) {
    if (!positions.length) continue;
    let list = updates.get(key);
    if (!list) {
      list = [];
      updates.set(key, list);
    }
    list.push({ si, pos: positions });
  }
}

async function dropSpan(span: [number, number]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(["secmeta", "bodies"], "readwrite");
  for (let si = span[0]; si < span[1]; si++) {
    tx.objectStore("secmeta").delete(si);
    tx.objectStore("bodies").delete(si);
  }
  await done(tx);
}

function retire(id: string) {
  const span = spans[id];
  if (!span) return;
  for (let si = span[0]; si < span[1]; si++) {
    if (tombHas(si)) continue;
    tombSet(si, true);
    totalTokens -= lengths[si] || 0;
    live = Math.max(0, live - 1);
  }
  delete spans[id];
}

async function kept(id: string): Promise<boolean> {
  const { usePrefs } = await import("../prefs");
  return !usePrefs.getState().removed.includes(id);
}

async function indexWorkNow(work: Work, note?: (line: string) => void): Promise<void> {
  await load();
  if (!(await kept(work.id))) {
    staged.delete(work.id);
    return;
  }
  const stamp = stampOf(work);
  const waiting = staged.get(work.id) ?? null;
  staged.delete(work.id);
  if (stamps[work.id] === stamp) return;
  let shipped: ShippedWork | null = waiting && packFits(work, waiting) ? waiting : null;
  if (!shipped && isSample(work.id)) {
    const packed = await readShipped(work.id);
    if (packed && packFits(work, packed)) shipped = packed;
  }
  if (!work.sections.length) {
    const old = spans[work.id] ? ([spans[work.id][0], spans[work.id][1]] as [number, number]) : null;
    retire(work.id);
    delete stamps[work.id];
    await saveMeta(await openDb());
    if (old) await dropSpan(old);
    return;
  }

  const huge = work.sections.length > 400;
  if (huge) {
    note?.(`Clearing the old index for ${work.title}…`);
    await clearWorkPostings(work.id);
  }

  const startSi = nextSi;
  nextSi += work.sections.length;
  ensureCap(nextSi);
  for (let si = startSi; si < nextSi; si++) tombSet(si, true);
  await saveMeta(await openDb());

  try {
    let addTokens = 0;
    let savedTerms = 0;
    const parts = Math.ceil(work.sections.length / (huge ? 48 : work.sections.length));
    const batchSize = huge ? 48 : work.sections.length;
    for (let offset = 0; offset < work.sections.length; offset += batchSize) {
      const updates = new Map<string, Posting[]>();
      const metas: DirEntry[] = [];
      const bodies: { si: number; text: string }[] = [];
      const end = Math.min(work.sections.length, offset + batchSize);
      for (let ord = offset; ord < end; ord++) {
        const section = work.sections[ord];
        const prepared = shipped?.sections[ord];
        const si = startSi + ord;
        if (ord % 2 === 0) {
          note?.(`Indexing ${work.title}: ${ord + 1} of ${work.sections.length}`);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (prepared) {
          lengths[si] = prepared.dl;
          addTokens += prepared.dl;
          addPrepared(updates, si, prepared.postings);
          metas.push({ si, workId: work.id, sectionId: section.id, heading: section.heading, ord, dl: prepared.dl });
        } else {
          const body = tokenize(section.text);
          const heading = tokenize(section.heading);
          const dl = body.length + heading.length;
          lengths[si] = dl;
          addTokens += dl;
          body.forEach((token, pos) => {
            if (token.norm.length > 64) return;
            push(updates, `bn:${token.norm}`, si, pos);
            push(updates, `bs:${token.stem}`, si, pos);
          });
          heading.forEach((token, pos) => {
            if (token.norm.length > 64) return;
            push(updates, `hn:${token.norm}`, si, pos);
            push(updates, `hs:${token.stem}`, si, pos);
          });
          metas.push({ si, workId: work.id, sectionId: section.id, heading: section.heading, ord, dl });
        }
        bodies.push({ si, text: section.text });
      }
      if (!(await kept(work.id))) return;
      if (updates.size) {
        const part = Math.floor(offset / batchSize) + 1;
        const wrote = huge
          ? await appendSegments(work.id, part, updates, (line) => note?.(`${line} · part ${part} of ${parts}`))
          : await writeSegments(work.id, updates, note);
        savedTerms += wrote;
        note?.(`Saving the index, ${savedTerms.toLocaleString()} terms written`);
      }
      await writeDocs(metas, bodies);
    }
    if (!(await kept(work.id))) return;

    for (let si = startSi; si < nextSi; si++) tombSet(si, false);
    const old = spans[work.id] ? ([spans[work.id][0], spans[work.id][1]] as [number, number]) : null;
    retire(work.id);
    spans[work.id] = [startSi, nextSi];
    totalTokens += addTokens;
    live += work.sections.length;
    stamps[work.id] = stamp;
    await saveMeta(await openDb());
    if (old) await dropSpan(old).catch(() => undefined);
  } catch (error) {
    loaded = null;
    await load().catch(() => undefined);
    throw error;
  }
}

async function forgetNow(id: string): Promise<void> {
  await load();
  staged.delete(id);
  if (!stamps[id] && !spans[id]) return;
  const old = spans[id] ? ([spans[id][0], spans[id][1]] as [number, number]) : null;
  retire(id);
  delete stamps[id];
  await saveMeta(await openDb());
  if (old) await dropSpan(old);
}

async function resolveWork(work: Work): Promise<Work | null> {
  if (work.sections.some((section) => section.text.length > 0)) return work;
  if (isSample(work.id)) {
    const expected = sampleStamp(work.id);
    if (expected && stamps[work.id] === expected) return null;
    return loadSampleText(work.id);
  }
  if (stamps[work.id]) return null;
  return loadStoredWork(work.id);
}

/** Meta is in memory. Does not wait for another volume to finish indexing. */
export function indexReady(): Promise<void> {
  return load();
}

/** True while a volume is still being tokenized or saved. Search does not wait for it. */
export function indexBusy(): boolean {
  return active || jobs.length > 0;
}

export function ensureIndex(works: Work[], opts?: { deferSeries?: boolean; onProgress?: (line: string) => void }): Promise<void> {
  return enqueue(() => indexShelf(works, false, opts));
}

async function indexShelf(
  works: Work[],
  prepared = false,
  opts?: { deferSeries?: boolean; onProgress?: (line: string) => void },
): Promise<void> {
  await load();
  let list = works;
  if (!prepared) {
    const { usePrefs } = await import("../prefs");
    const { loadRemoved } = await import("../library-db");
    const gone = new Set(await loadRemoved());
    for (const id of usePrefs.getState().removed) gone.add(id);
    const liveIds = new Map<string, Work>();
    for (const work of works) {
      if (!gone.has(work.id)) liveIds.set(work.id, work);
    }
    for (const extra of usePrefs.getState().imports) {
      if (!gone.has(extra.id) && !liveIds.has(extra.id)) liveIds.set(extra.id, extra);
    }
    for (const id of Object.keys(stamps)) {
      if (!liveIds.has(id)) await forgetNow(id);
    }
    list = [...liveIds.values()];
  }
  for (let i = 0; i < list.length; i++) {
    if (jobs.length) {
      const rest = list.slice(i);
      jobs.push(() => indexShelf(rest, true, opts));
      return;
    }
    const work = list[i];
    if (!(await kept(work.id))) {
      await forgetNow(work.id);
      continue;
    }
    if (opts?.deferSeries && work.series) continue;
    const full = await resolveWork(work);
    if (!full) continue;
    if (!(await kept(work.id))) {
      await forgetNow(work.id);
      continue;
    }
    if (work.series) {
      opts?.onProgress?.(`Indexing ${work.series.title}, volume ${work.series.volume} of ${work.series.of}…`);
    }
    await indexWorkNow(full, opts?.onProgress);
  }
}

/** Index one volume if its stamp is not already stored. Does not drop the rest of the shelf. */
export function indexIfNeeded(work: Work, note?: (line: string) => void): Promise<void> {
  return enqueue(async () => {
    await load();
    if (!(await kept(work.id))) return;
    const full = await resolveWork(work);
    if (!full || !(await kept(work.id))) return;
    if (work.series) note?.(`Indexing ${work.series.title}, volume ${work.series.volume} of ${work.series.of}…`);
    await indexWorkNow(full, note);
  });
}

export function indexWork(work: Work, note?: (line: string) => void): Promise<void> {
  return enqueue(() => indexWorkNow(work, note));
}

export function forgetWork(id: string): Promise<void> {
  return enqueue(() => forgetNow(id));
}

export function indexStats(): { sections: number; tokens: number } {
  return { sections: live, tokens: totalTokens };
}

export function averageLength(): number {
  return live ? totalTokens / live : 1;
}

export function sectionCount(): number {
  return live;
}

export function sectionLength(si: number): number {
  return lengths[si] || 1;
}

export async function segmentCount(kind: Kind, term: string, workId?: string): Promise<number> {
  const db = await openDb();
  const tx = db.transaction("postings", "readonly");
  return req(tx.objectStore("postings").count(termRange(kind, term, workId)));
}

export async function scanTerm(
  kind: Kind,
  term: string,
  visit: (si: number, pos: Uint32Array) => boolean | void,
  workId?: string,
): Promise<void> {
  const db = await openDb();
  const tx = db.transaction("postings", "readonly");
  const range = termRange(kind, term, workId);
  await new Promise<void>((resolve, reject) => {
    const request = tx.objectStore("postings").openCursor(range);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const view = postingView(cursor.value);
      let stop = false;
      if (view) {
        visitPostings(view, (si, pos) => {
          if (tombHas(si)) return;
          if (visit(si, pos) === false) {
            stop = true;
            return false;
          }
        });
      }
      if (stop) return resolve();
      cursor.continue();
    };
  });
}

export async function termsExist(kind: Kind, terms: string[]): Promise<Set<string>> {
  const unique = [...new Set(terms)].slice(0, 800);
  const db = await openDb();
  const tx = db.transaction("postings", "readonly");
  const store = tx.objectStore("postings");
  const requests = unique.map((term) => store.count(termRange(kind, term)));
  const counts = await Promise.all(requests.map((request) => req(request)));
  const hit = new Set<string>();
  unique.forEach((term, index) => {
    if (counts[index] > 0) hit.add(term);
  });
  return hit;
}

export async function prefixTerms(kind: Kind, prefix: string, limit = 24): Promise<string[]> {
  if (prefix.length < 1) return [];
  const db = await openDb();
  const tx = db.transaction("postings", "readonly");
  const start = `${kind}:${prefix}`;
  const range = IDBKeyRange.bound(start, `${start}\uffff`);
  const found: string[] = [];
  const seen = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    const request = tx.objectStore("postings").openKeyCursor(range);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || seen.size >= limit) return resolve();
      const key = String(cursor.key);
      const term = key.slice(kind.length + 1).split(SEP)[0] ?? "";
      if (term.startsWith(prefix) && !seen.has(term)) {
        seen.add(term);
        found.push(term);
      }
      cursor.continue();
    };
  });
  return found;
}

export async function loadBodies(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const slice = ids.slice(offset, offset + 200);
    const db = await openDb();
    const tx = db.transaction("bodies", "readonly");
    const store = tx.objectStore("bodies");
    const texts = await Promise.all(slice.map((id) => req(store.get(id) as IDBRequest<string | undefined>)));
    slice.forEach((id, index) => {
      if (typeof texts[index] === "string") out.set(id, texts[index]);
    });
  }
  return out;
}

export async function loadEntries(ids: number[]): Promise<Map<number, DirEntry>> {
  const out = new Map<number, DirEntry>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const slice = ids.slice(offset, offset + 200);
    const db = await openDb();
    const tx = db.transaction("secmeta", "readonly");
    const store = tx.objectStore("secmeta");
    const rows = await Promise.all(slice.map((id) => req(store.get(id) as IDBRequest<DirEntry | undefined>)));
    slice.forEach((id, index) => {
      const row = rows[index];
      if (row && !tombHas(id)) out.set(id, row);
    });
  }
  return out;
}

/** One indexed section, so a result can open before the rest of the volume is read. */
export async function loadSectionText(
  workId: string,
  sectionId: string,
): Promise<{ id: string; heading: string; text: string } | null> {
  if (!workId || !sectionId) return null;
  try {
    await load();
    const span = spans[workId];
    if (!span || span[1] <= span[0]) return null;
    const db = await openDb();
    const tx = db.transaction(["secmeta", "bodies"], "readonly");
    return await new Promise((resolve, reject) => {
      const request = tx.objectStore("secmeta").openCursor(IDBKeyRange.bound(span[0], span[1] - 1));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const row = cursor.value as DirEntry;
        if (row.workId !== workId || row.sectionId !== sectionId || tombHas(row.si)) {
          cursor.continue();
          return;
        }
        const body = tx.objectStore("bodies").get(row.si) as IDBRequest<string | undefined>;
        body.onerror = () => reject(body.error);
        body.onsuccess = () => {
          const text = body.result;
          resolve(typeof text === "string" && text ? { id: row.sectionId, heading: row.heading, text } : null);
        };
      };
    });
  } catch {
    return null;
  }
}

/** The section texts a reader is about to show. One pass, and it stops once they are all requested. */
export async function loadSectionBodies(workId: string, sectionIds: string[]): Promise<Map<string, string>> {
  const want = new Set(sectionIds.filter(Boolean));
  const out = new Map<string, string>();
  if (!workId || !want.size) return out;
  try {
    await load();
    const span = spans[workId];
    if (!span || span[1] <= span[0]) return out;
    const db = await openDb();
    const tx = db.transaction(["secmeta", "bodies"], "readonly");
    const bodies = tx.objectStore("bodies");
    const pending: Promise<void>[] = [];
    let asked = 0;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        void Promise.all(pending).then(() => resolve(), reject);
      };
      const request = tx.objectStore("secmeta").openCursor(IDBKeyRange.bound(span[0], span[1] - 1));
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          finish();
          return;
        }
        const row = cursor.value as DirEntry;
        if (row.workId === workId && want.has(row.sectionId) && !tombHas(row.si)) {
          asked += 1;
          const body = bodies.get(row.si) as IDBRequest<string | undefined>;
          pending.push(
            req(body).then((text) => {
              if (typeof text === "string") out.set(row.sectionId, text);
            }),
          );
          if (asked >= want.size) {
            finish();
            return;
          }
        }
        cursor.continue();
      };
    });
    return out;
  } catch {
    return out;
  }
}
