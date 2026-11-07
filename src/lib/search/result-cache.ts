import type { WorkHit } from "./engine";

const DB_NAME = "folio-results";
const DB_VERSION = 1;

export type CachedSearch = {
  hits: WorkHit[];
  error: string | null;
  active: boolean;
  note: string | null;
};

type Row = { id: "latest"; key: string; result: CachedSearch };

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no idb"));
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("results")) db.createObjectStore("results", { keyPath: "id" });
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

function pack(result: CachedSearch): CachedSearch {
  return {
    ...result,
    hits: result.hits.map((hit) => ({
      ...hit,
      work: { ...hit.work, sections: [], coverBytes: undefined },
    })),
  };
}

export async function readResultCache(key: string): Promise<CachedSearch | null> {
  try {
    const db = await openDb();
    const row = await new Promise<Row | undefined>((resolve, reject) => {
      const request = db.transaction("results").objectStore("results").get("latest");
      request.onsuccess = () => resolve(request.result as Row | undefined);
      request.onerror = () => reject(request.error);
    });
    if (!row || row.key !== key) return null;
    return row.result;
  } catch {
    return null;
  }
}

export async function writeResultCache(key: string, result: CachedSearch): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction("results", "readwrite").objectStore("results").put({ id: "latest", key, result: pack(result) } satisfies Row);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    /* the search still shows for this visit */
  }
}
