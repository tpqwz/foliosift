import { asCatalog } from "./corpus/catalog";
import type { Excerpt, Work, WorkPatch } from "./corpus/types";
import { WORKS } from "./corpus/works";
import { readLibraryArchive, replaceLibraryArchive, type LibraryArchive, type StoredCover } from "./library-db";
import { usePrefs } from "./prefs";
import type { PublicProfile } from "./persona/load";
import { ensureIndex, stageWorkPack } from "./search/disk-index";
import { restoreWorkEmbeddings } from "./search/embedder";
import { packWork } from "./search/pack";
import { encodeShelf, decodeShelf } from "./search/shipped";
import { encodeEmbeddings } from "./search/shipped-embed";
import { textHash, windows } from "./search/semantic";
import { rowsFor, sectionStamp, type VectorRow } from "./search/vectors";
import { BACKUP_VERSION, parseBackup, type FolioBackup } from "./backup-format";
import { planSync } from "./sync";
import { gzipSync, gunzipSync } from "fflate";

export { BACKUP_VERSION, parseBackup, type FolioBackup };

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) {
    binary += String.fromCharCode(...bytes.subarray(i, i + size));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

async function embeddingPack(work: Work, rows: VectorRow[]) {
  const mine = rows.filter((row) => row.workId === work.id && row.model === "e5");
  const sections = [];
  for (const section of work.sections) {
    const hash = textHash(section.text);
    if ((await sectionStamp("e5", work.id, section.id)) !== hash) continue;
    const pieces = windows(section.text);
    if (!pieces.length) continue;
    const byStart = new Map(mine.filter((row) => row.sectionId === section.id).map((row) => [row.start, row]));
    if (!pieces.every((piece) => (byStart.get(piece.start)?.v.length ?? 0) > 0)) continue;
    sections.push({
      id: section.id,
      hash,
      windows: pieces.map((piece) => {
        const row = byStart.get(piece.start);
        return { start: piece.start, preview: row?.preview ?? "", v: row?.v ?? new Float32Array() };
      }),
    });
  }
  return sections;
}

export async function buildBackup(): Promise<FolioBackup> {
  const archive = await readLibraryArchive();
  const prefs = usePrefs.getState();
  const texts = archive.texts.map((work) => {
    const { coverBytes: _bytes, coverType: _type, ...clean } = work;
    return clean;
  });
  let stored: VectorRow[] = [];
  try {
    stored = await rowsFor("e5");
  } catch {
    stored = [];
  }
  const indexes = texts.map((work) => ({
    id: work.id,
    data: bytesToBase64(gzipSync(encodeShelf(packWork(work)))),
  }));
  const embeddings = [];
  for (const work of texts) {
    const sections = await embeddingPack(work, stored);
    if (!sections.length) continue;
    embeddings.push({ id: work.id, data: bytesToBase64(gzipSync(encodeEmbeddings({ model: "e5", sections }))) });
  }
  return {
    folio: BACKUP_VERSION,
    app: "FolioSift",
    exported: new Date().toISOString(),
    prefs: {
      theme: prefs.theme,
      stem: prefs.stem,
      fuzzy: prefs.fuzzy,
      concept: prefs.concept,
      semantic: prefs.semantic,
    },
    removed: [...new Set([...archive.removed, ...prefs.removed])],
    texts,
    covers: archive.covers.map((cover: StoredCover) => ({
      id: cover.id,
      type: cover.type,
      data: bytesToBase64(cover.bytes),
    })),
    overrides: archive.overrides,
    excerpts: archive.excerpts,
    personas: archive.personas,
    indexes,
    embeddings,
  };
}

export function downloadBackup(backup: FolioBackup): void {
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const day = backup.exported.slice(0, 10) || "backup";
  link.href = url;
  link.download = `foliosift-${day}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function restoreBackup(backup: FolioBackup): Promise<void> {
  const texts = backup.texts as Work[];
  const covers: StoredCover[] = backup.covers.map((cover) => ({
    id: cover.id,
    type: cover.type || "image/jpeg",
    bytes: base64ToBytes(cover.data),
  }));
  const archive: LibraryArchive = {
    texts,
    covers,
    overrides: backup.overrides as Record<string, WorkPatch>,
    excerpts: backup.excerpts as Excerpt[],
    personas: backup.personas as { name: string; profile: PublicProfile }[],
    removed: backup.removed,
  };
  await replaceLibraryArchive(archive);
  for (const item of backup.indexes ?? []) {
    const work = texts.find((entry) => entry.id === item.id);
    if (!work) continue;
    try {
      stageWorkPack(work.id, decodeShelf(gunzipSync(base64ToBytes(item.data))));
    } catch {
      /* this book is indexed from its text */
    }
  }
  for (const item of backup.embeddings ?? []) {
    const work = texts.find((entry) => entry.id === item.id);
    if (!work) continue;
    await restoreWorkEmbeddings(work, base64ToBytes(item.data));
  }
  const prefs = usePrefs.getState();
  prefs.setTheme(backup.prefs.theme);
  usePrefs.setState({
    stem: backup.prefs.stem,
    fuzzy: backup.prefs.fuzzy,
    concept: backup.prefs.concept,
    semantic: backup.prefs.semantic,
    semanticPick: backup.prefs.semantic === "gemma" ? "gemma" : backup.prefs.semantic === "e5" ? "e5" : prefs.semanticPick,
    imports: texts.map((work) => asCatalog(work)),
    overrides: archive.overrides,
    excerpts: archive.excerpts,
    removed: backup.removed,
  });
  const gone = new Set(backup.removed);
  await ensureIndex([...WORKS, ...texts].filter((work) => !gone.has(work.id)));
}

/** Bring in what another device exported. This device's books, excerpts, and deletions stay. */
export async function syncBackup(backup: FolioBackup): Promise<{ addedTexts: number; addedExcerpts: number; joinedTags: number }> {
  const archive = await readLibraryArchive();
  const plan = planSync(
    {
      texts: archive.texts,
      excerpts: archive.excerpts,
      overrides: archive.overrides,
      personas: archive.personas,
      coverIds: archive.covers.map((cover) => cover.id),
    },
    backup,
  );
  const known = new Set(archive.texts.map((work) => work.id));
  const covers: StoredCover[] = [
    ...archive.covers,
    ...backup.covers
      .filter((cover) => plan.coverIds.includes(cover.id))
      .map((cover) => ({ id: cover.id, type: cover.type || "image/jpeg", bytes: base64ToBytes(cover.data) })),
  ];
  await replaceLibraryArchive({
    texts: plan.texts,
    covers,
    overrides: plan.overrides,
    excerpts: plan.excerpts,
    personas: plan.personas as { name: string; profile: PublicProfile }[],
    removed: archive.removed,
  });
  const added = plan.texts.filter((work) => !known.has(work.id));
  for (const item of backup.indexes ?? []) {
    const work = added.find((entry) => entry.id === item.id);
    if (!work) continue;
    try {
      stageWorkPack(work.id, decodeShelf(gunzipSync(base64ToBytes(item.data))));
    } catch {
      /* this book is indexed from its text */
    }
  }
  for (const item of backup.embeddings ?? []) {
    const work = added.find((entry) => entry.id === item.id);
    if (!work) continue;
    await restoreWorkEmbeddings(work, base64ToBytes(item.data));
  }
  const prefs = usePrefs.getState();
  usePrefs.setState({
    imports: plan.texts.map((work) => asCatalog(work)),
    overrides: plan.overrides,
    excerpts: plan.excerpts,
  });
  const gone = new Set(prefs.removed);
  await ensureIndex([...WORKS, ...plan.texts].filter((work) => !gone.has(work.id)));
  return { addedTexts: plan.addedTexts, addedExcerpts: plan.addedExcerpts, joinedTags: plan.joinedTags };
}
