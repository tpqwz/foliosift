import { useSyncExternalStore } from "react";

export class ImportStopped extends Error {
  constructor() {
    super("Stopped");
    this.name = "ImportStopped";
  }
}

type Activity = { line: string; problem: boolean; running: boolean };

const IDLE: Activity = { line: "", problem: false, running: false };

let depth = 0;
let stopped = false;
let activity: Activity = IDLE;
let timer = 0;
const listeners = new Set<() => void>();

function emit(next: Activity) {
  activity = next;
  listeners.forEach((listener) => listener());
}

function live(line: string, problem = false): Activity {
  return { line, problem, running: depth > 0 };
}

export function importHeld(): boolean {
  return depth > 0;
}

export function importCancelled(): boolean {
  return stopped;
}

export function holdImport(line: string) {
  if (depth === 0) stopped = false;
  depth += 1;
  window.clearTimeout(timer);
  emit(live(line));
}

export function noteImport(line: string) {
  if (stopped) throw new ImportStopped();
  if (!line || depth === 0) return;
  window.clearTimeout(timer);
  emit(live(line));
}

/** Ask the running import to stop at its next step. */
export function requestImportCancel() {
  if (depth === 0) return;
  stopped = true;
  window.clearTimeout(timer);
  emit(live("Stopping…"));
}

/** Drop one running import. A closing line lingers, then goes away. */
export function releaseImport(line = "", problem = false) {
  depth = Math.max(0, depth - 1);
  if (depth > 0) {
    if (line) emit(live(line, problem));
    return;
  }
  stopped = false;
  if (!line) {
    emit(IDLE);
    return;
  }
  emit({ line, problem, running: false });
  const shown = line;
  timer = window.setTimeout(() => {
    if (activity.line === shown) emit(IDLE);
  }, problem ? 7000 : 2800);
}

export function useImportActivity(): Activity {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => activity,
    () => IDLE,
  );
}
