export const BACKUP_VERSION = 2;

type BackupWork = {
  id: string;
  title: string;
  sections: { id: string; heading: string; text: string }[];
  [key: string]: unknown;
};

export type FolioBackup = {
  folio: 1 | 2;
  app: "FolioSift";
  exported: string;
  prefs: { theme: "paper" | "night"; stem: boolean; fuzzy: boolean; concept: boolean; semantic: "off" | "e5" | "gemma" };
  removed: string[];
  texts: BackupWork[];
  covers: { id: string; type: string; data: string }[];
  overrides: Record<string, Record<string, unknown>>;
  excerpts: { id: string; [key: string]: unknown }[];
  personas: { name: string; profile: unknown }[];
  /** Prepared word index for books that were added, so a restore does not tokenize them. */
  indexes?: { id: string; data: string }[];
  /** Prepared E5 embeddings for those same books. */
  embeddings?: { id: string; data: string }[];
};

function isWork(value: unknown): value is BackupWork {
  if (!value || typeof value !== "object") return false;
  const work = value as BackupWork;
  return typeof work.id === "string" && typeof work.title === "string" && Array.isArray(work.sections);
}

export function parseBackup(raw: string): FolioBackup | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: "That file is not a FolioSift backup." };
  }
  if (!parsed || typeof parsed !== "object") return { error: "That file is not a FolioSift backup." };
  const backup = parsed as Partial<FolioBackup>;
  if ((backup.folio !== 1 && backup.folio !== 2) || backup.app !== "FolioSift") {
    return { error: "That file is not a FolioSift backup." };
  }
  if (!Array.isArray(backup.texts) || !backup.texts.every(isWork)) {
    return { error: "The backup has no readable texts." };
  }
  const prefs = backup.prefs;
  if (!prefs || (prefs.theme !== "paper" && prefs.theme !== "night")) {
    return { error: "The backup is missing its settings." };
  }
  return {
    folio: backup.folio === 2 ? 2 : 1,
    app: "FolioSift",
    exported: typeof backup.exported === "string" ? backup.exported : "",
    prefs: {
      theme: prefs.theme,
      stem: prefs.stem !== false,
      fuzzy: Boolean(prefs.fuzzy),
      concept: Boolean(prefs.concept),
      semantic: prefs.semantic === "e5" || prefs.semantic === "gemma" ? prefs.semantic : "off",
    },
    removed: Array.isArray(backup.removed) ? backup.removed.filter((id) => typeof id === "string") : [],
    texts: backup.texts,
    covers: Array.isArray(backup.covers)
      ? backup.covers.filter((cover) => cover && typeof cover.id === "string" && typeof cover.data === "string")
      : [],
    overrides: backup.overrides && typeof backup.overrides === "object" ? backup.overrides : {},
    excerpts: Array.isArray(backup.excerpts)
      ? backup.excerpts.filter((excerpt) => excerpt && typeof excerpt.id === "string")
      : [],
    personas: Array.isArray(backup.personas)
      ? backup.personas.filter((persona) => persona && typeof persona.name === "string" && persona.profile)
      : [],
    indexes: packs(backup.indexes),
    embeddings: packs(backup.embeddings),
  };
}

function packs(value: unknown): { id: string; data: string }[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item.id === "string" && typeof item.data === "string");
}
