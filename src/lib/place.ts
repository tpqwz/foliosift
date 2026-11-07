import { useSyncExternalStore } from "react";

export type ReadingPlace = { sectionId: string; heading: string };

const EMPTY: ReadingPlace = { sectionId: "", heading: "" };
const KEY = "folio-places";

let place = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function readPlaces(): Record<string, ReadingPlace> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, ReadingPlace>;
  } catch {
    return {};
  }
}

const placeCache = new Map<string, ReadingPlace | null>();

export function storedPlace(workId: string): ReadingPlace | null {
  const item = readPlaces()[workId];
  const next: ReadingPlace | null =
    item?.sectionId && item.heading ? { sectionId: item.sectionId, heading: item.heading } : null;
  const prev = placeCache.get(workId) ?? null;
  if (prev?.sectionId === next?.sectionId && prev?.heading === next?.heading) return prev;
  placeCache.set(workId, next);
  return next;
}

function writePlace(workId: string, next: ReadingPlace) {
  if (!workId || !next.sectionId || !next.heading) return;
  try {
    const all = readPlaces();
    if (all[workId]?.sectionId === next.sectionId && all[workId]?.heading === next.heading) return;
    all[workId] = { sectionId: next.sectionId, heading: next.heading };
    localStorage.setItem(KEY, JSON.stringify(all));
    emit();
  } catch {
    /* private mode */
  }
}

export function setReadingPlace(next: ReadingPlace, workId = "") {
  if (next.sectionId === place.sectionId && next.heading === place.heading) {
    if (workId) writePlace(workId, next);
    return;
  }
  place = next.heading ? next : EMPTY;
  if (workId && place.sectionId) writePlace(workId, place);
  emit();
}

const LAST = "folio-reading";
let lastId = "";
let lastKnown = false;

function readLastId(): string {
  if (lastKnown) return lastId;
  lastKnown = true;
  if (typeof localStorage === "undefined") return "";
  try {
    const stored = localStorage.getItem(LAST);
    if (stored) {
      lastId = stored;
      return lastId;
    }
    const keys = Object.keys(readPlaces());
    lastId = keys[keys.length - 1] ?? "";
  } catch {
    lastId = "";
  }
  return lastId;
}

/** The volume the reader should reopen. It changes only when another volume is opened. */
export function setLastWork(id: string) {
  if (!id) return;
  readLastId();
  if (lastId === id) return;
  lastId = id;
  try {
    localStorage.setItem(LAST, id);
  } catch {
    /* private mode */
  }
  emit();
}

export function useLastWork(): string {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => readLastId(),
    () => "",
  );
}

export function clearReadingPlace() {
  if (!place.heading) return;
  place = EMPTY;
  emit();
}

export function useReadingPlace(): ReadingPlace {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => place,
    () => EMPTY,
  );
}

export function useStoredPlace(workId: string): ReadingPlace | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => storedPlace(workId),
    () => null,
  );
}

/** A section titled only "Text" or "Text · 2" is a split, not a chapter. */
export function isPlainTextHeading(heading: string): boolean {
  return /^text(?:\s·\s\d+)?$/i.test(heading.trim());
}

/** Number plain splits as Text 1, Text 2, … so each can be a breadcrumb. Real chapters stay as they are. */
export function withTextParts<T extends { heading: string }>(sections: T[]): T[] {
  if (sections.length < 2 || !sections.every((section) => isPlainTextHeading(section.heading))) return sections;
  return sections.map((section, index) => ({ ...section, heading: `Text ${index + 1}` }));
}

/** Breadcrumb label. Chapter chunks collapse to the chapter; plain splits stay numbered. */
export function placeLabel(heading: string): string {
  const trimmed = heading.trim();
  const plain = /^text(?:\s·\s(\d+))?$/i.exec(trimmed);
  if (plain) return `Text ${plain[1] ?? "1"}`;
  return trimmed.replace(/\s·\s\d+$/, "");
}

export type ChapterStop = { id: string; heading: string };

let wheelWork = "";
let wheelChapters: ChapterStop[] = [];
const wheelListeners = new Set<() => void>();

function emitWheel() {
  wheelListeners.forEach((listener) => listener());
}

/** Chapters of the open volume, one stop per heading. Chunk splits stay inside the chapter. */
export function setChapterWheel(workId: string, sections: { id: string; heading: string }[]) {
  const stops: ChapterStop[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    const heading = section.heading.replace(/\s·\s\d+$/, "").trim() || section.heading;
    if (!heading || seen.has(heading)) continue;
    seen.add(heading);
    stops.push({ id: section.id, heading });
  }
  if (wheelWork === workId && wheelChapters.length === stops.length && wheelChapters.every((stop, index) => stop.id === stops[index]?.id)) {
    return;
  }
  wheelWork = workId;
  wheelChapters = stops;
  emitWheel();
}

export function clearChapterWheel(workId: string) {
  if (wheelWork !== workId) return;
  wheelWork = "";
  wheelChapters = [];
  emitWheel();
}

const NO_CHAPTERS: ChapterStop[] = [];

export function useChapterWheel(workId: string): ChapterStop[] {
  return useSyncExternalStore(
    (listener) => {
      wheelListeners.add(listener);
      return () => wheelListeners.delete(listener);
    },
    () => (wheelWork === workId ? wheelChapters : NO_CHAPTERS),
    () => NO_CHAPTERS,
  );
}