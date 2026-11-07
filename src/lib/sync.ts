import type { Excerpt, Work, WorkPatch } from "./corpus/types";
import type { FolioBackup } from "./backup-format";

export type SyncSide = {
  texts: Work[];
  excerpts: Excerpt[];
  overrides: Record<string, WorkPatch>;
  personas: { name: string; profile: unknown }[];
  coverIds: string[];
};

export type SyncPlan = {
  texts: Work[];
  excerpts: Excerpt[];
  overrides: Record<string, WorkPatch>;
  personas: { name: string; profile: unknown }[];
  coverIds: string[];
  addedTexts: number;
  addedExcerpts: number;
  addedPersonas: number;
  addedCovers: number;
  joinedTags: number;
};

function asExcerpt(value: { id: string; [key: string]: unknown }): Excerpt | null {
  if (typeof value.workId !== "string" || typeof value.text !== "string") return null;
  return value as Excerpt;
}

function sameTags(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = left ?? [];
  const b = right ?? [];
  return a.length === b.length && a.every((tag) => b.includes(tag));
}

/** Add what the other device has. Keep this device's copies, including deletions. */
export function planSync(local: SyncSide, incoming: FolioBackup): SyncPlan {
  const have = new Set(local.texts.map((work) => work.id));
  const added = incoming.texts.filter((work) => !have.has(work.id)) as Work[];
  const excerpts = [...local.excerpts];
  const byId = new Map(excerpts.map((excerpt) => [excerpt.id, excerpt]));
  let addedExcerpts = 0;
  let joinedTags = 0;
  for (const item of incoming.excerpts) {
    const excerpt = asExcerpt(item);
    if (!excerpt) continue;
    const mine = byId.get(excerpt.id);
    if (!mine) {
      excerpts.push(excerpt);
      byId.set(excerpt.id, excerpt);
      addedExcerpts += 1;
      continue;
    }
    const tags = [...new Set([...(mine.tags ?? []), ...(excerpt.tags ?? [])])];
    if (!sameTags(mine.tags, tags)) {
      const next = { ...mine, tags };
      const index = excerpts.indexOf(mine);
      excerpts[index] = next;
      byId.set(excerpt.id, next);
      joinedTags += 1;
    }
  }
  const names = new Set(local.personas.map((persona) => persona.name.toLowerCase()));
  const personas = [...local.personas];
  let addedPersonas = 0;
  for (const persona of incoming.personas) {
    if (names.has(persona.name.toLowerCase())) continue;
    personas.push(persona);
    names.add(persona.name.toLowerCase());
    addedPersonas += 1;
  }
  const overrides = { ...local.overrides };
  for (const [id, patch] of Object.entries(incoming.overrides)) {
    if (!overrides[id]) overrides[id] = patch as WorkPatch;
  }
  const covers = new Set(local.coverIds);
  const coverIds = incoming.covers.map((cover) => cover.id).filter((id) => !covers.has(id));
  return {
    texts: [...local.texts, ...added],
    excerpts,
    overrides,
    personas,
    coverIds,
    addedTexts: added.length,
    addedExcerpts,
    addedPersonas,
    addedCovers: coverIds.length,
    joinedTags,
  };
}
