import type { Excerpt, Work, WorkPatch } from "./corpus/types";
import { asCatalog } from "./corpus/catalog";
import type { PublicProfile } from "./persona/load";

/**
 * IndexedDB holds the library. The `works` store is the shelf list (no prose).
 * Full texts live in `texts`, one volume at a time. The search index is a
 * separate database and is not rebuilt into memory.
 */
const DB_NAME = "folio";
const DB_VERSION = 3;

export type DurableLibrary = {
  imports: Work[];
  overrides: Record<string, WorkPatch>;
  excerpts: Excerpt[];
};

const EMPTY: DurableLibrary = { imports: [], overrides: {}, excerpts: [] };

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no idb"));
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = request.result;
        const tx = request.transaction;
        if (!db.objectStoreNames.contains("works")) db.createObjectStore("works", { keyPath: "id" });
        if (!db.objectStoreNames.contains("overrides")) db.createObjectStore("overrides");
        if (!db.objectStoreNames.contains("excerpts")) db.createObjectStore("excerpts", { keyPath: "id" });
        if (!db.objectStoreNames.contains("personas")) db.createObjectStore("personas");
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("covers")) db.createObjectStore("covers");
        if (!db.objectStoreNames.contains("texts")) {
          const texts = db.createObjectStore("texts");
          if (event.oldVersion >= 1 && tx) {
            const works = tx.objectStore("works");
            const cursorReq = works.openCursor();
            cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) return;
              const work = cursor.value as Work;
              if (work?.sections?.some((section) => section.text.length > 0)) {
                texts.put(work, work.id);
                cursor.update(asCatalog(work));
              }
              cursor.continue();
            };
          }
        }
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

function storeError(error: unknown): Error {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: string }).name) : "";
  if (name === "QuotaExceededError") {
    return new Error("This device is out of room for the library. Export a backup, then free some space.");
  }
  return new Error("The library could not be saved on this device.");
}

let kept = false;

/** Ask the browser not to evict this origin when disk space runs low. A refresh never needs this. */
export function keepLibrary(): void {
  if (kept || typeof navigator === "undefined" || !navigator.storage?.persist) return;
  void navigator.storage
    .persist()
    .then((ok) => {
      kept = ok;
    })
    .catch(() => undefined);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readLegacy(): DurableLibrary | null {
  try {
    const raw = localStorage.getItem("folio-prefs");
    if (!raw) return null;
    const state = (JSON.parse(raw) as { state?: Partial<DurableLibrary> }).state;
    if (!state) return null;
    const imports = Array.isArray(state.imports) ? state.imports : [];
    const excerpts = Array.isArray(state.excerpts) ? state.excerpts : [];
    const overrides = state.overrides && typeof state.overrides === "object" ? state.overrides : {};
    if (!imports.length && !excerpts.length && !Object.keys(overrides).length) return null;
    return { imports, overrides, excerpts };
  } catch {
    return null;
  }
}

const legacySnapshot: DurableLibrary | null = typeof window === "undefined" ? null : readLegacy();

async function readAll(db: IDBDatabase): Promise<DurableLibrary> {
  const tx = db.transaction(["works", "overrides", "excerpts"], "readonly");
  const importsReq = tx.objectStore("works").getAll() as IDBRequest<Work[]>;
  const overrideReq = tx.objectStore("overrides").getAll() as IDBRequest<WorkPatch[]>;
  const overrideKeysReq = tx.objectStore("overrides").getAllKeys() as IDBRequest<IDBValidKey[]>;
  const excerptsReq = tx.objectStore("excerpts").getAll() as IDBRequest<Excerpt[]>;
  const [imports, overrideRows, keys, excerpts] = await Promise.all([
    requestToPromise(importsReq),
    requestToPromise(overrideReq),
    requestToPromise(overrideKeysReq),
    requestToPromise(excerptsReq),
  ]);
  const overrides: Record<string, WorkPatch> = {};
  keys.forEach((key, index) => {
    overrides[String(key)] = overrideRows[index] ?? {};
  });
  return { imports, overrides, excerpts };
}

export async function loadDurable(): Promise<DurableLibrary> {
  try {
    const db = await openDb();
    const migrated = await requestToPromise(
      db.transaction("meta", "readonly").objectStore("meta").get("migrated") as IDBRequest<boolean | undefined>,
    );
    if (!migrated && legacySnapshot) {
      const tx = db.transaction(["works", "overrides", "excerpts", "meta"], "readwrite");
      for (const work of legacySnapshot.imports) tx.objectStore("works").put(work);
      for (const [id, patch] of Object.entries(legacySnapshot.overrides)) tx.objectStore("overrides").put(patch, id);
      for (const excerpt of legacySnapshot.excerpts) tx.objectStore("excerpts").put(excerpt);
      tx.objectStore("meta").put(true, "migrated");
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else if (!migrated) {
      await requestToPromise(db.transaction("meta", "readwrite").objectStore("meta").put(true, "migrated"));
    }
    return await readAll(db);
  } catch {
    return legacySnapshot ?? EMPTY;
  }
}

export async function saveWork(work: Work): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(["works", "texts"], "readwrite");
    if (work.sections.some((section) => section.text.length > 0)) {
      tx.objectStore("texts").put(work, work.id);
    }
    tx.objectStore("works").put(asCatalog(work));
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (error) {
    throw storeError(error);
  }
  keepLibrary();
}

export async function loadStoredWork(id: string): Promise<Work | null> {
  try {
    const db = await openDb();
    const text = await requestToPromise(
      db.transaction("texts", "readonly").objectStore("texts").get(id) as IDBRequest<Work | undefined>,
    );
    if (text?.sections?.some((section) => section.text.length > 0)) return text;
    const work = await requestToPromise(
      db.transaction("works", "readonly").objectStore("works").get(id) as IDBRequest<Work | undefined>,
    );
    if (work?.sections?.some((section) => section.text.length > 0)) return work;
    return null;
  } catch {
    return null;
  }
}

export async function saveCover(id: string, bytes: Uint8Array, type: string): Promise<void> {
  try {
    const db = await openDb();
    const blob = new Blob([Uint8Array.from(bytes)], { type });
    await requestToPromise(db.transaction("covers", "readwrite").objectStore("covers").put(blob, id));
  } catch {
    /* the text is already stored */
  }
}

export async function loadCover(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const blob = await requestToPromise(
      db.transaction("covers", "readonly").objectStore("covers").get(id) as IDBRequest<Blob | undefined>,
    );
    return blob ?? null;
  } catch {
    return null;
  }
}

export async function deleteWork(id: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(["works", "texts", "covers"], "readwrite");
    tx.objectStore("works").delete(id);
    tx.objectStore("texts").delete(id);
    tx.objectStore("covers").delete(id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* ignore */
  }
}

export async function saveOverride(workId: string, patch: WorkPatch): Promise<void> {
  try {
    const db = await openDb();
    const current =
      (await requestToPromise(
        db.transaction("overrides", "readonly").objectStore("overrides").get(workId) as IDBRequest<
          WorkPatch | undefined
        >,
      )) ?? {};
    await requestToPromise(
      db.transaction("overrides", "readwrite").objectStore("overrides").put({ ...current, ...patch }, workId),
    );
  } catch {
    /* ignore */
  }
}

export async function saveExcerpt(excerpt: Excerpt): Promise<void> {
  try {
    const db = await openDb();
    await requestToPromise(db.transaction("excerpts", "readwrite").objectStore("excerpts").put(excerpt));
  } catch (error) {
    throw storeError(error);
  }
  keepLibrary();
}

export async function deleteExcerpt(id: string): Promise<void> {
  try {
    const db = await openDb();
    await requestToPromise(db.transaction("excerpts", "readwrite").objectStore("excerpts").delete(id));
  } catch {
    /* ignore */
  }
}

export async function listPersonas(): Promise<PublicProfile[]> {
  try {
    const db = await openDb();
    const rows = await requestToPromise(
      db.transaction("personas", "readonly").objectStore("personas").getAll() as IDBRequest<PublicProfile[]>,
    );
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function readPersona(name: string): Promise<PublicProfile | null> {
  try {
    const db = await openDb();
    const row = await requestToPromise(
      db.transaction("personas", "readonly").objectStore("personas").get(name.toLowerCase()) as IDBRequest<
        PublicProfile | undefined
      >,
    );
    return row ?? null;
  } catch {
    return null;
  }
}

export async function readMeta<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    const value = await requestToPromise(
      db.transaction("meta", "readonly").objectStore("meta").get(key) as IDBRequest<T | undefined>,
    );
    return value ?? null;
  } catch {
    return null;
  }
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  try {
    const db = await openDb();
    await requestToPromise(db.transaction("meta", "readwrite").objectStore("meta").put(value, key));
  } catch {
    /* the page still has the shipped copy */
  }
}

export async function writePersona(name: string, profile: PublicProfile): Promise<void> {
  try {
    const db = await openDb();
    await requestToPromise(
      db.transaction("personas", "readwrite").objectStore("personas").put(profile, name.toLowerCase()),
    );
  } catch {
    /* a missed cache is not fatal */
  }
}

const REMOVED_MIRROR = "folio-removed";

export function readRemovedMirror(): string[] {
  try {
    const raw = localStorage.getItem(REMOVED_MIRROR);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeRemovedMirror(ids: string[]): void {
  try {
    localStorage.setItem(REMOVED_MIRROR, JSON.stringify(ids));
  } catch {
    /* private mode */
  }
}

export async function loadRemoved(): Promise<string[]> {
  try {
    const db = await openDb();
    const stored = await requestToPromise(
      db.transaction("meta", "readonly").objectStore("meta").get("removed") as IDBRequest<string[] | undefined>,
    );
    const removed = Array.isArray(stored) ? stored.filter((id) => typeof id === "string") : [];
    const mirror = readRemovedMirror();
    const union = [...new Set([...removed, ...mirror])];
    if (union.length !== removed.length) {
      await requestToPromise(db.transaction("meta", "readwrite").objectStore("meta").put(union, "removed"));
    }
    return union;
  } catch {
    return readRemovedMirror();
  }
}

export function noteRemoved(id: string): void {
  const removed = [...new Set([...readRemovedMirror(), id])];
  writeRemovedMirror(removed);
}

export async function rememberRemoved(id: string): Promise<void> {
  const removed = [...new Set([...(await loadRemoved()), id])];
  writeRemovedMirror(removed);
  try {
    const db = await openDb();
    await requestToPromise(db.transaction("meta", "readwrite").objectStore("meta").put(removed, "removed"));
  } catch {
    /* the mirror still hides it on the next visit */
  }
}

/** Replace the removed list. Used when a built-in volume is put back. */
export async function setRemovedList(ids: string[]): Promise<void> {
  const removed = [...new Set(ids.filter((id) => typeof id === "string"))];
  writeRemovedMirror(removed);
  try {
    const db = await openDb();
    await requestToPromise(db.transaction("meta", "readwrite").objectStore("meta").put(removed, "removed"));
  } catch {
    /* the mirror is what the next visit reads if the write failed */
  }
}

export async function deleteExcerptsForWork(workId: string): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction("excerpts", "readwrite");
    const store = tx.objectStore("excerpts");
    await new Promise<void>((resolve, reject) => {
      const request = store.openCursor();
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const excerpt = cursor.value as Excerpt;
        if (excerpt.workId === workId) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    /* the shelf copy is already gone */
  }
}

export async function deleteOverride(workId: string): Promise<void> {
  try {
    const db = await openDb();
    await requestToPromise(db.transaction("overrides", "readwrite").objectStore("overrides").delete(workId));
  } catch {
    /* ignore */
  }
}

export type StoredCover = { id: string; type: string; bytes: Uint8Array };
export type StoredPersona = { name: string; profile: PublicProfile };

export type LibraryArchive = {
  texts: Work[];
  covers: StoredCover[];
  overrides: Record<string, WorkPatch>;
  excerpts: Excerpt[];
  personas: StoredPersona[];
  removed: string[];
};

function cursorEntries<T>(store: IDBObjectStore): Promise<{ key: string; value: T }[]> {
  return new Promise((resolve, reject) => {
    const out: { key: string; value: T }[] = [];
    const request = store.openCursor();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      out.push({ key: String(cursor.key), value: cursor.value as T });
      cursor.continue();
    };
    store.transaction.oncomplete = () => resolve(out);
    store.transaction.onerror = () => reject(store.transaction.error);
  });
}

/** Everything this device has added or changed. Built-in volumes stay in the app. */
export async function readLibraryArchive(): Promise<LibraryArchive> {
  const db = await openDb();
  const tx = db.transaction(["texts", "covers", "overrides", "excerpts", "personas", "meta"], "readonly");
  const [texts, covers, overrides, excerpts, personas, removed] = await Promise.all([
    cursorEntries<Work>(tx.objectStore("texts")),
    cursorEntries<Blob>(tx.objectStore("covers")),
    cursorEntries<WorkPatch>(tx.objectStore("overrides")),
    cursorEntries<Excerpt>(tx.objectStore("excerpts")),
    cursorEntries<PublicProfile>(tx.objectStore("personas")),
    requestToPromise(tx.objectStore("meta").get("removed") as IDBRequest<string[] | undefined>),
  ]);
  const coverBytes: StoredCover[] = [];
  for (const cover of covers) {
    if (!(cover.value instanceof Blob)) continue;
    coverBytes.push({
      id: cover.key,
      type: cover.value.type || "image/jpeg",
      bytes: new Uint8Array(await cover.value.arrayBuffer()),
    });
  }
  const patch: Record<string, WorkPatch> = {};
  for (const row of overrides) patch[row.key] = row.value ?? {};
  return {
    texts: texts.map((row) => row.value).filter((work) => work?.id && Array.isArray(work.sections)),
    covers: coverBytes,
    overrides: patch,
    excerpts: excerpts.map((row) => row.value).filter((excerpt) => excerpt?.id),
    personas: personas
      .filter((row) => row.value && typeof row.value === "object")
      .map((row) => ({ name: row.key, profile: row.value })),
    removed: Array.isArray(removed) ? removed.filter((id) => typeof id === "string") : [],
  };
}

/** Replace the device library with a backup. The caller rebuilds the search index. */
export async function replaceLibraryArchive(archive: LibraryArchive): Promise<void> {
  const removed = [...new Set(archive.removed.filter((id) => typeof id === "string"))];
  const db = await openDb();
  const tx = db.transaction(["works", "texts", "covers", "excerpts", "overrides", "personas", "meta"], "readwrite");
  tx.objectStore("works").clear();
  tx.objectStore("texts").clear();
  tx.objectStore("covers").clear();
  tx.objectStore("excerpts").clear();
  tx.objectStore("overrides").clear();
  tx.objectStore("personas").clear();
  for (const work of archive.texts) {
    const { coverBytes: _bytes, coverType: _type, ...clean } = work;
    tx.objectStore("texts").put(clean, clean.id);
    tx.objectStore("works").put(asCatalog(clean));
  }
  for (const cover of archive.covers) {
    const bytes = new Uint8Array(cover.bytes);
    tx.objectStore("covers").put(new Blob([bytes], { type: cover.type || "image/jpeg" }), cover.id);
  }
  for (const excerpt of archive.excerpts) tx.objectStore("excerpts").put(excerpt);
  for (const [id, patch] of Object.entries(archive.overrides)) tx.objectStore("overrides").put(patch, id);
  for (const persona of archive.personas) tx.objectStore("personas").put(persona.profile, persona.name.toLowerCase());
  tx.objectStore("meta").put(removed, "removed");
  tx.objectStore("meta").put(true, "migrated");
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  writeRemovedMirror(removed);
}

