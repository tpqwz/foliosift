import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useSyncExternalStore } from "react";
import { asCatalog } from "./corpus/catalog";
import { editionKey } from "./corpus/editions";
import { chunkWork } from "./corpus/import";
import type { Excerpt, Work, WorkPatch } from "./corpus/types";
import { deleteExcerpt, deleteExcerptsForWork, deleteOverride, deleteWork, noteRemoved, readRemovedMirror, rememberRemoved, saveCover, saveExcerpt, saveOverride, saveWork, setRemovedList } from "./library-db";
import { forgetWork, indexWork } from "./search/disk-index";
import type { SemanticChoice } from "./search/semantic";
import { forgetVectors } from "./search/vectors";
import { isSample, loadSampleText } from "./corpus/works";

type Theme = "paper" | "night";

type Prefs = {
  theme: Theme;
  stem: boolean;
  fuzzy: boolean;
  concept: boolean;
  semantic: SemanticChoice;
  /** Engine restored when Meaning is turned back on. */
  semanticPick: "e5" | "gemma";
  imports: Work[];
  overrides: Record<string, WorkPatch>;
  excerpts: Excerpt[];
  removed: string[];
  setTheme: (theme: Theme) => void;
  setSemantic: (semantic: SemanticChoice) => void;
  toggleMeaning: () => SemanticChoice;
  toggle: (key: "stem" | "fuzzy" | "concept") => void;
  addImport: (work: Work) => void;
  removeWork: (id: string) => Promise<void>;
  setMeta: (workId: string, patch: WorkPatch) => void;
  addExcerpt: (excerpt: Excerpt) => Promise<void>;
  removeExcerpt: (id: string) => void;
  setExcerptTags: (id: string, tags: string[]) => void;
  reviseExcerpt: (id: string, patch: { text: string; tags: string[] }) => void;
};

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      theme: "paper",
      stem: true,
      fuzzy: false,
      concept: false,
      semantic: "off",
      semanticPick: "e5",
      imports: [],
      overrides: {},
      excerpts: [],
      removed: typeof window === "undefined" ? [] : readRemovedMirror(),
      setTheme: (theme) => {
        try {
          localStorage.setItem("folio-theme", theme === "night" ? "night" : "paper");
        } catch {
          /* private mode */
        }
        document.documentElement.dataset.theme = theme === "night" ? "night" : "paper";
        set({ theme });
      },
      setSemantic: (semantic) =>
        set((state) => ({
          semantic,
          semanticPick: semantic === "off" ? state.semanticPick : semantic,
        })),
      toggleMeaning: () => {
        let next: SemanticChoice = "off";
        set((state) => {
          next = state.semantic === "off" ? state.semanticPick : "off";
          return { semantic: next };
        });
        return next;
      },
      toggle: (key) => set((s) => ({ [key]: !s[key] })),
      addImport: (work) => {
        void commitImport(work);
      },
      removeWork: (id) => {
        noteRemoved(id);
        set((s) => ({
          removed: s.removed.includes(id) ? s.removed : [...s.removed, id],
          imports: s.imports.filter((work) => work.id !== id),
          excerpts: s.excerpts.filter((excerpt) => excerpt.workId !== id),
          overrides: Object.fromEntries(Object.entries(s.overrides).filter(([key]) => key !== id)),
        }));
        return purgeWork(id);
      },
      setMeta: (workId, patch) => {
        set((s) => ({
          overrides: { ...s.overrides, [workId]: { ...s.overrides[workId], ...patch } },
        }));
        void saveOverride(workId, patch);
      },
      addExcerpt: async (excerpt) => {
        await saveExcerpt(excerpt);
        set((s) => {
          const same = s.excerpts.some(
            (item) =>
              item.workId === excerpt.workId &&
              item.sectionId === excerpt.sectionId &&
              item.start === excerpt.start &&
              item.end === excerpt.end,
          );
          if (same) return s;
          return { excerpts: [excerpt, ...s.excerpts] };
        });
      },
      removeExcerpt: (id) => {
        set((s) => ({ excerpts: s.excerpts.filter((item) => item.id !== id) }));
        void deleteExcerpt(id);
      },
      setExcerptTags: (id, tags) => {
        const current = usePrefs.getState().excerpts.find((item) => item.id === id);
        if (!current) return;
        const next = { ...current, tags };
        set((s) => ({ excerpts: s.excerpts.map((item) => (item.id === id ? next : item)) }));
        void saveExcerpt(next).catch(() => {
          set((s) => ({ excerpts: s.excerpts.map((item) => (item.id === id ? current : item)) }));
        });
      },
      reviseExcerpt: (id, patch) => {
        const current = usePrefs.getState().excerpts.find((item) => item.id === id);
        if (!current) return;
        const text = patch.text.trim();
        if (!text) return;
        const tags: string[] = [];
        const seen = new Set<string>();
        for (const raw of patch.tags) {
          const tag = raw.trim().replace(/\s+/g, " ");
          const key = tag.toLowerCase();
          if (!tag || seen.has(key)) continue;
          seen.add(key);
          tags.push(tag);
        }
        const saved = current.original ?? current.text;
        const next: Excerpt = { ...current, text, tags };
        if (text === saved) delete next.original;
        else if (!current.original) next.original = current.text;
        set((s) => ({ excerpts: s.excerpts.map((item) => (item.id === id ? next : item)) }));
        void saveExcerpt(next).catch(() => {
          set((s) => ({ excerpts: s.excerpts.map((item) => (item.id === id ? current : item)) }));
        });
      },
    }),
    {
      name: "folio-prefs",
      skipHydration: true,
      partialize: (state) => ({
        theme: state.theme,
        stem: state.stem,
        fuzzy: state.fuzzy,
        concept: state.concept,
        semantic: state.semantic,
        semanticPick: state.semanticPick,
      }),
    },
  ),
);

let importTail: Promise<void> = Promise.resolve();

async function forgetTwin(id: string): Promise<void> {
  await deleteWork(id);
  await deleteExcerptsForWork(id);
  await deleteOverride(id);
  await forgetWork(id);
  await forgetVectors(id);
}

async function purgeWork(id: string): Promise<void> {
  await rememberRemoved(id);
  await deleteWork(id);
  await deleteExcerptsForWork(id);
  await deleteOverride(id);
  await forgetWork(id);
  await forgetVectors(id);
}

/** Store and index one volume, then release it. Callers should await this so the next file is not opened early. */
export function commitImport(work: Work, note?: (line: string) => void): Promise<void> {
  const run = importTail.then(async () => {
    const stored = chunkWork(work);
    const { coverBytes, coverType, ...clean } = stored;
    usePrefs.setState((current) => {
      const twins = current.imports.filter((item) => {
        if (item.id === clean.id) return false;
        const file = item.edition || "";
        if (!/\.[a-z0-9]{2,5}$/i.test(file) || file.toLowerCase() !== (clean.edition || "").toLowerCase()) return false;
        if (item.title === clean.title) return true;
        const key = editionKey(item);
        return Boolean(key) && key === editionKey(clean);
      });
      for (const twin of twins) void forgetTwin(twin.id);
      return {
        imports: [...current.imports.filter((item) => item.id !== clean.id && !twins.some((twin) => twin.id === item.id)), asCatalog(clean)],
      };
    });
    try {
      await saveWork(clean);
    } catch (error) {
      usePrefs.setState((current) => ({ imports: current.imports.filter((item) => item.id !== clean.id) }));
      throw error;
    }
    if (coverBytes?.byteLength) await saveCover(clean.id, coverBytes, coverType || "image/jpeg");
    note?.(`Indexing ${clean.title}…`);
    await indexWork(clean, note);
  });
  importTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/** Put built-in volumes back on the shelf and index them again. Imports stay removed. */
export async function restoreBuiltins(ids: string[]): Promise<void> {
  const drop = new Set(ids.filter((id) => isSample(id)));
  if (!drop.size) return;
  usePrefs.setState((current) => ({ removed: current.removed.filter((id) => !drop.has(id)) }));
  await setRemovedList(usePrefs.getState().removed);
  for (const id of drop) {
    const text = await loadSampleText(id);
    if (text) await indexWork(text);
  }
}

let removalLabel = "";
let removalDepth = 0;
const removalListeners = new Set<() => void>();

function emitRemoval() {
  removalListeners.forEach((listener) => listener());
}

/** Shown until the volume, its index, and its excerpts are actually gone. */
export function beginRemoval(title: string) {
  removalDepth += 1;
  removalLabel = title;
  emitRemoval();
}

export function endRemoval() {
  removalDepth = Math.max(0, removalDepth - 1);
  if (removalDepth === 0) removalLabel = "";
  emitRemoval();
}

export function useRemovalLabel(): string {
  return useSyncExternalStore(
    (listener) => {
      removalListeners.add(listener);
      return () => removalListeners.delete(listener);
    },
    () => removalLabel,
    () => "",
  );
}

function subscribe() {
  return () => {};
}

export function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
