export type StoredKind = { count: number; bytes: number };

export type LibraryStats = {
  texts: StoredKind;
  covers: StoredKind;
  personas: StoredKind;
  excerpts: StoredKind;
  edits: StoredKind;
  index: StoredKind;
  sections: StoredKind;
  indexedText: StoredKind;
  usage: number | null;
  quota: number | null;
};

const EMPTY: StoredKind = { count: 0, bytes: 0 };

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function roughBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

function recordBytes(value: unknown): number {
  if (value == null) return 0;
  if (value instanceof Blob) return value.size;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (typeof value === "string") return value.length;
  if (typeof value === "object" && value !== null && "sections" in value) {
    const sections = (value as { sections?: { text?: string; heading?: string }[] }).sections;
    if (Array.isArray(sections)) {
      let bytes = 160;
      for (const section of sections) bytes += (section.text?.length ?? 0) + (section.heading?.length ?? 0) + 16;
      return bytes;
    }
  }
  return roughBytes(value);
}

function openDb(name: string, ms = 1500): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), ms);
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(name);
    } catch {
      clearTimeout(timer);
      finish(null);
      return;
    }
    request.onupgradeneeded = () => {
      try {
        request.transaction?.abort();
      } catch {
        /* missing database */
      }
      clearTimeout(timer);
      finish(null);
    };
    request.onsuccess = () => {
      clearTimeout(timer);
      finish(request.result);
    };
    request.onerror = () => {
      clearTimeout(timer);
      finish(null);
    };
    request.onblocked = () => {
      clearTimeout(timer);
      finish(null);
    };
  });
}

function countOf(store: IDBObjectStore, ms = 1500): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    try {
      const request = store.count();
      request.onsuccess = () => {
        clearTimeout(timer);
        resolve(request.result);
      };
      request.onerror = () => {
        clearTimeout(timer);
        resolve(null);
      };
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function sizeOf(store: IDBObjectStore, ms = 4000): Promise<number | null> {
  return new Promise((resolve) => {
    let bytes = 0;
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const timer = setTimeout(() => finish(bytes > 0 ? bytes : null), ms);
    try {
      const request = store.openCursor();
      request.onerror = () => {
        clearTimeout(timer);
        finish(bytes);
      };
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          clearTimeout(timer);
          finish(bytes);
          return;
        }
        try {
          bytes += recordBytes(cursor.value);
        } catch {
          /* one bad record should not hide the rest */
        }
        if (!settled) cursor.continue();
      };
    } catch {
      clearTimeout(timer);
      finish(null);
    }
  });
}

async function measureDb(
  name: string,
  stores: string[],
  update: (name: string, kind: StoredKind) => void,
): Promise<void> {
  const db = await openDb(name);
  if (!db) {
    for (const store of stores) update(store, EMPTY);
    return;
  }
  try {
    const present = stores.filter((store) => db.objectStoreNames.contains(store));
    for (const store of stores) {
      if (!present.includes(store)) update(store, EMPTY);
    }
    if (!present.length) return;
    const counts = await Promise.all(
      present.map(async (store) => {
        const count = await countOf(db.transaction(store, "readonly").objectStore(store));
        return [store, count] as const;
      }),
    );
    for (const [store, count] of counts) {
      if (count != null) update(store, { count, bytes: count === 0 ? 0 : -1 });
    }
    await Promise.all(
      present.map(async (store) => {
        const count = counts.find(([name]) => name === store)?.[1];
        if (count == null) {
          update(store, EMPTY);
          return;
        }
        const bytes = await sizeOf(db.transaction(store, "readonly").objectStore(store));
        update(store, { count, bytes: bytes ?? -1 });
      }),
    );
  } finally {
    db.close();
  }
}

/** Counts and stored size. `update` fires as each figure arrives so one slow store cannot blank the list. */
export function measureLibrary(update: (patch: Partial<LibraryStats>) => void): () => void {
  let stopped = false;
  const emit = (patch: Partial<LibraryStats>) => {
    if (!stopped) update(patch);
  };

  void (async () => {
    const report = (key: keyof LibraryStats) => (_store: string, kind: StoredKind) => emit({ [key]: kind });
    await Promise.all([
      (async () => {
        try {
          const estimate =
            typeof navigator !== "undefined" && navigator.storage?.estimate ? await navigator.storage.estimate() : null;
          emit({ usage: estimate?.usage ?? null, quota: estimate?.quota ?? null });
        } catch {
          emit({ usage: null, quota: null });
        }
      })(),
      measureDb("folio", ["texts", "covers", "personas", "excerpts", "overrides"], (store, kind) => {
        if (store === "texts") report("texts")(store, kind);
        else if (store === "covers") report("covers")(store, kind);
        else if (store === "personas") report("personas")(store, kind);
        else if (store === "excerpts") report("excerpts")(store, kind);
        else if (store === "overrides") report("edits")(store, kind);
      }),
      measureDb("folio-index", ["postings", "secmeta", "bodies"], (store, kind) => {
        if (store === "postings") report("index")(store, kind);
        else if (store === "secmeta") report("sections")(store, kind);
        else if (store === "bodies") report("indexedText")(store, kind);
      }),
    ]);
  })();

  return () => {
    stopped = true;
  };
}
