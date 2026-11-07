import type { SemanticChoice } from "./semantic";

export type VectorRow = {
  key: string;
  model: Exclude<SemanticChoice, "off">;
  workId: string;
  sectionId: string;
  heading: string;
  start: number;
  preview: string;
  v: Float32Array;
};

const DB_NAME = "folio-semantic";
const DB_VERSION = 1;

let opening: Promise<IDBDatabase> | null = null;
let memory: { model: Exclude<SemanticChoice, "off">; rows: VectorRow[] } | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("no idb"));
  if (!opening) {
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("passages")) {
          const passages = db.createObjectStore("passages", { keyPath: "key" });
          passages.createIndex("model", "model");
          passages.createIndex("work", "workId");
        }
        if (!db.objectStoreNames.contains("stamps")) db.createObjectStore("stamps");
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

function stampKey(model: string, workId: string, sectionId: string): string {
  return `${model}\n${workId}\n${sectionId}`;
}

export async function sectionStamp(model: Exclude<SemanticChoice, "off">, workId: string, sectionId: string): Promise<string> {
  const db = await openDb();
  return new Promise((resolve) => {
    const request = db.transaction("stamps").objectStore("stamps").get(stampKey(model, workId, sectionId));
    request.onsuccess = () => resolve(typeof request.result === "string" ? request.result : "");
    request.onerror = () => resolve("");
  });
}

export async function setSectionStamp(model: Exclude<SemanticChoice, "off">, workId: string, sectionId: string, hash: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction("stamps", "readwrite").objectStore("stamps").put(hash, stampKey(model, workId, sectionId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function clearSection(model: Exclude<SemanticChoice, "off">, workId: string, sectionId: string): Promise<void> {
  const rows = await rowsFor(model);
  const keys = rows.filter((row) => row.workId === workId && row.sectionId === sectionId).map((row) => row.key);
  if (!keys.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const store = db.transaction("passages", "readwrite").objectStore("passages");
    let left = keys.length;
    for (const key of keys) {
      const request = store.delete(key);
      request.onsuccess = () => {
        left -= 1;
        if (left === 0) resolve();
      };
      request.onerror = () => reject(request.error);
    }
  });
  memory = null;
}

export async function putRows(rows: VectorRow[]): Promise<void> {
  if (!rows.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const store = db.transaction("passages", "readwrite").objectStore("passages");
    let left = rows.length;
    for (const row of rows) {
      const request = store.put(row);
      request.onsuccess = () => {
        left -= 1;
        if (left === 0) resolve();
      };
      request.onerror = () => reject(request.error);
    }
  });
  memory = null;
}

export async function rowsFor(model: Exclude<SemanticChoice, "off">): Promise<VectorRow[]> {
  if (memory?.model === model) return memory.rows;
  const db = await openDb();
  const rows = await new Promise<VectorRow[]>((resolve, reject) => {
    const request = db.transaction("passages").objectStore("passages").index("model").getAll(model);
    request.onsuccess = () => resolve((request.result as VectorRow[]) ?? []);
    request.onerror = () => reject(request.error);
  });
  memory = { model, rows };
  return rows;
}

export async function forgetVectors(workId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["passages", "stamps"], "readwrite");
      const passages = tx.objectStore("passages");
      const index = passages.index("work");
      const request = index.openCursor(IDBKeyRange.only(workId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      const stamps = tx.objectStore("stamps");
      const stampCursor = stamps.openCursor();
      stampCursor.onsuccess = () => {
        const cursor = stampCursor.result;
        if (!cursor) return;
        const key = String(cursor.key);
        if (key.split("\n")[1] === workId) cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    memory = null;
  } catch {
    /* the volume is already leaving the shelf */
  }
}
