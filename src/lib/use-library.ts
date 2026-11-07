import { useEffect, useMemo } from "react";
import { asCatalog } from "./corpus/catalog";
import { applyDublin } from "./corpus/dublin";
import { publicationLanguage } from "./corpus/markup";
import { WORKS } from "./corpus/works";
import { ensureIndex } from "./search/disk-index";
import { deleteExcerptsForWork, deleteOverride, deleteWork, keepLibrary, loadDurable, loadRemoved, loadStoredWork, saveWork, type DurableLibrary } from "./library-db";
import { forgetWork } from "./search/disk-index";
import { seedSampleCache } from "./sample-cache";
import type { Excerpt, Work } from "./corpus/types";
import { useHydrated, usePrefs } from "./prefs";

let bootPromise: Promise<void> | null = null;

function mergeWorks(saved: Work[], current: Work[]): Work[] {
  const byId = new Map(saved.map((work) => [work.id, work]));
  for (const work of current) byId.set(work.id, work);
  return [...byId.values()];
}

function mergeExcerpts(saved: Excerpt[], current: Excerpt[]): Excerpt[] {
  const byId = new Map(saved.map((excerpt) => [excerpt.id, excerpt]));
  for (const excerpt of current) byId.set(excerpt.id, excerpt);
  return [...byId.values()].sort((a, b) => b.created - a.created);
}

/** Books imported before language meant the publication, not the original work. */
async function alignStoredLanguages(imports: Work[]): Promise<Work[]> {
  const next: Work[] = [];
  for (const work of imports) {
    if (!/\b(Greek|Latin)\b/.test(work.language) || work.sections.length > 4000) {
      next.push(work);
      continue;
    }
    const full = await loadStoredWork(work.id);
    const prose = full?.sections.map((section) => section.text).join("\n") ?? "";
    const language = prose ? publicationLanguage(work.language, prose) : work.language;
    if (!full || language === work.language) {
      next.push(work);
      continue;
    }
    const fixed = { ...full, language };
    try {
      await saveWork(fixed);
    } catch {
      next.push(work);
      continue;
    }
    next.push(asCatalog(fixed));
  }
  return next;
}

async function collapseRepeatImports(imports: Work[]): Promise<Work[]> {
  const groups = new Map<string, Work[]>();
  const kept: Work[] = [];
  for (const work of imports) {
    const edition = work.edition?.trim() ?? "";
    if (!/\.[a-z0-9]{2,5}$/i.test(edition)) {
      kept.push(work);
      continue;
    }
    const key = `${work.title.trim().toLowerCase()}|${edition.toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push(work);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    kept.push(list[0]);
    for (const extra of list.slice(1)) {
      await deleteWork(extra.id);
      await deleteExcerptsForWork(extra.id);
      await deleteOverride(extra.id);
      await forgetWork(extra.id);
    }
  }
  return kept;
}

export function bootLibrary(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      const data: DurableLibrary = await loadDurable();
      const removed = await loadRemoved();
      await seedSampleCache().catch(() => undefined);
      const gone = new Set(removed);
      const imports = await collapseRepeatImports((await alignStoredLanguages(data.imports)).filter((work) => !gone.has(work.id)));
      try {
        await ensureIndex([...WORKS, ...imports].filter((work) => !gone.has(work.id)), { deferSeries: true });
      } catch {
        /* search falls back to the texts already in memory */
      }
      usePrefs.setState((current) => {
        const hidden = new Set([...gone, ...current.removed]);
        const overrides = { ...data.overrides, ...current.overrides };
        for (const id of hidden) delete overrides[id];
        return {
          removed: [...hidden],
          imports: mergeWorks(imports, current.imports)
            .filter((work) => !hidden.has(work.id))
            .map(asCatalog),
          excerpts: mergeExcerpts(data.excerpts, current.excerpts).filter((excerpt) => !hidden.has(excerpt.workId)),
          overrides,
        };
      });
      if (data.imports.length || data.excerpts.length) keepLibrary();
      await usePrefs.persist.rehydrate();
    })().catch(() => undefined);
  }
  return bootPromise;
}

export function useLibrary(): { works: Work[] } {
  const hydrated = useHydrated();
  const imports = usePrefs((s) => s.imports);
  const overrides = usePrefs((s) => s.overrides);
  const removed = usePrefs((s) => s.removed);

  useEffect(() => {
    void bootLibrary();
  }, []);

  const works = useMemo(() => {
    const hidden = new Set(removed);
    const base = (hydrated ? [...WORKS, ...imports] : WORKS).filter((work) => !hidden.has(work.id));
    return base.map((work) => {
      const patch = overrides[work.id];
      return patch ? applyDublin(work, patch) : work;
    });
  }, [hydrated, imports, overrides, removed]);
  return { works };
}