import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { buildBackup, downloadBackup, parseBackup, restoreBackup, syncBackup, type FolioBackup } from "@/lib/backup";
import { classicsSnapshot, pauseClassics, startClassics, subscribeClassics } from "@/lib/classics/import-many";
import { WORKS } from "@/lib/corpus/works";
import { formatBytes, measureLibrary, roughBytes, type LibraryStats, type StoredKind } from "@/lib/library-stats";
import { isInstalled, promptInstall, subscribeInstall } from "@/lib/install";
import { restoreBuiltins, usePrefs } from "@/lib/prefs";
import { semanticSnapshot, subscribeSemantic, useSemantic } from "@/lib/search/embedder";
import { SEMANTIC_MODELS, type SemanticChoice } from "@/lib/search/semantic";
import { Modal } from "./modal";

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const theme = usePrefs((s) => s.theme);
  const setTheme = usePrefs((s) => s.setTheme);
  const stem = usePrefs((s) => s.stem);
  const fuzzy = usePrefs((s) => s.fuzzy);
  const concept = usePrefs((s) => s.concept);
  const semantic = usePrefs((s) => s.semantic);
  const setSemantic = usePrefs((s) => s.setSemantic);
  const toggle = usePrefs((s) => s.toggle);
  const removed = usePrefs((s) => s.removed);
  const imports = usePrefs((s) => s.imports);
  const excerpts = usePrefs((s) => s.excerpts);
  const overrides = usePrefs((s) => s.overrides);
  const classics = useSyncExternalStore(subscribeClassics, classicsSnapshot, classicsSnapshot);
  const meaning = useSyncExternalStore(subscribeSemantic, semanticSnapshot, semanticSnapshot);
  const [stats, setStats] = useState<Partial<LibraryStats> | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [pending, setPending] = useState<FolioBackup | null>(null);
  const hidden = WORKS.filter((work) => removed.includes(work.id));
  const fileRef = useRef<HTMLInputElement>(null);
  const [installed, setInstalled] = useState(false);
  function chooseSemantic(choice: SemanticChoice) {
    setSemantic(choice);
    void useSemantic(choice);
  }
  useEffect(() => {
    setInstalled(isInstalled());
    return subscribeInstall(() => setInstalled(isInstalled()));
  }, []);
  const builtin = WORKS.length - hidden.length;
  const imported = imports.filter((work) => !removed.includes(work.id)).length;
  const excerptBytes = useMemo(() => roughBytes(excerpts), [excerpts]);
  const editBytes = useMemo(() => roughBytes(overrides), [overrides]);

  useEffect(() => {
    if (!open) return;
    return measureLibrary((patch) => {
      setStats((current) => ({ ...(current ?? {}), ...patch }));
    });
  }, [open]);

  useEffect(() => {
    if (!open || typeof navigator === "undefined" || !navigator.storage?.persisted) return;
    void navigator.storage.persisted().then(setPersisted).catch(() => setPersisted(null));
  }, [open]);

  if (!open) return null;

  async function onExport() {
    setBusy(true);
    setError("");
    setPending(null);
    setNote("Collecting texts, indexes, and excerpts…");
    try {
      const backup = await buildBackup();
      downloadBackup(backup);
      setNote(
        `Backup saved. ${backup.texts.length} converted ${backup.texts.length === 1 ? "text" : "texts"}, ${backup.excerpts.length} excerpts. The search index is rebuilt when this file is restored.`,
      );
    } catch {
      setError("The backup could not be written.");
      setNote("");
    }
    setBusy(false);
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) {
      setError("The phone did not hand over a file.");
      return;
    }
    setBusy(true);
    setError("");
    setNote(`Reading ${file.name}…`);
    void file.text().then((raw) => {
      const parsed = parseBackup(raw);
      setBusy(false);
      if ("error" in parsed) {
        setPending(null);
        setNote("");
        setError(parsed.error);
        return;
      }
      setPending(parsed);
      setNote(
        `This file has ${parsed.texts.length} converted ${parsed.texts.length === 1 ? "text" : "texts"} and ${parsed.excerpts.length} excerpts. Restore replaces this device. Sync adds what this device does not have yet.`,
      );
    });
  }

  async function onRestore() {
    if (!pending) return;
    setBusy(true);
    setError("");
    setNote("Restoring the library and rebuilding the index…");
    try {
      await restoreBackup(pending);
      setPending(null);
      setNote("Restored. The shelf and the search index now match the backup.");
    } catch {
      setError("The backup could not be restored.");
    }
    setBusy(false);
  }

  async function onSync() {
    if (!pending) return;
    setBusy(true);
    setError("");
    setNote("Syncing books, excerpts, indexes, and embeddings…");
    try {
      const result = await syncBackup(pending);
      setPending(null);
      const tags = result.joinedTags ? ` Tags were joined on ${result.joinedTags}.` : "";
      setNote(`Synced. ${result.addedTexts} new ${result.addedTexts === 1 ? "text" : "texts"} and ${result.addedExcerpts} new excerpts. Nothing already here was removed.${tags}`);
    } catch {
      setError("The sync could not be applied.");
    }
    setBusy(false);
  }

  async function putBack(ids: string[]) {
    setBusy(true);
    setError("");
    setPending(null);
    setNote(ids.length === 1 ? "Putting the volume back on the shelf…" : "Putting the volumes back…");
    try {
      await restoreBuiltins(ids);
      setNote("Back on the shelf. The search index includes them again.");
    } catch {
      setError("That volume could not be put back.");
    }
    setBusy(false);
  }

  return (
    <Modal labelledBy="settings-title" onClose={onClose}>
      {typeof document !== "undefined"
        ? createPortal(
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="fixed top-0 left-0 -z-10 h-12 w-12 opacity-0"
              onChange={onFile}
            />,
            document.body,
          )
        : null}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
          <h2 id="settings-title" className="font-serif text-2xl">
            Settings
          </h2>
          {installed ? null : (
            <>
              <h3 className="mt-5 text-sm font-medium tracking-wide text-muted uppercase">App</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Install FolioSift to open it from the home screen. The library stays on this device.
              </p>
              <button
                type="button"
                className="mt-3 h-11 rounded-md bg-accent px-4 text-sm text-bg"
                onClick={() => {
                  void promptInstall().then((result) => {
                    if (result === "manual") {
                      setNote("Open the browser menu and choose Install app, or Add to Home Screen.");
                    }
                  });
                }}
              >
                Install
              </button>
            </>
          )}
          <h3 className="mt-5 text-sm font-medium tracking-wide text-muted uppercase">Appearance</h3>
          <div className="mt-2 flex gap-2">
            <ThemeChoice label="Paper" on={theme === "paper"} onClick={() => setTheme("paper")} />
            <ThemeChoice label="Night" on={theme === "night"} onClick={() => setTheme("night")} />
          </div>
          <h3 className="mt-6 text-sm font-medium tracking-wide text-muted uppercase">Search</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <Toggle on={stem} label="Stemming" onClick={() => toggle("stem")} />
            <Toggle on={fuzzy} label="Fuzzy" onClick={() => toggle("fuzzy")} />
            <Toggle on={concept} label="Concepts" tone="kin" onClick={() => toggle("concept")} />
          </div>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Stemming matches inflections. Fuzzy allows one edit on longer words, the same as word~. Concepts adds a
            short classical family, such as virtue and arete, then the closest WordNet synonyms, twelve related words
            at most. These are not a separate index.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Meaning, on the search bar, compares passages and keeps word matches first. It uses the engine chosen
            here. Multilingual E5 is ready: the books that came with FolioSift are already embedded, and a backup keeps
            the embeddings of books you add. Concepts is not this. It only adds related words, and marks them in blue.
          </p>
          <div className="mt-2 flex flex-col gap-2">
            <SemanticChoiceButton
              label="Off"
              detail="Word index only."
              on={semantic === "off"}
              onClick={() => chooseSemantic("off")}
            />
            <SemanticChoiceButton
              label={SEMANTIC_MODELS.e5.label}
              detail={SEMANTIC_MODELS.e5.detail}
              on={semantic === "e5"}
              onClick={() => chooseSemantic("e5")}
            />
            <SemanticChoiceButton
              label={SEMANTIC_MODELS.gemma.label}
              detail={SEMANTIC_MODELS.gemma.detail}
              on={semantic === "gemma"}
              onClick={() => chooseSemantic("gemma")}
            />
          </div>
          {meaning.note ? <p className="mt-2 text-sm text-muted">{meaning.note}</p> : null}
          <h3 className="mt-6 text-sm font-medium tracking-wide text-muted uppercase">Library</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Import many classics fetches cleaned public-domain EPUBs from Better Gutenberg, one volume at a time:
            classic literature, epics, drama, novels, poetry, and the French, German, and American shelves. A specialist
            text that is not on those shelves is still fetched from Project Gutenberg. Volumes already on the shelf are
            skipped. You can pause and continue.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => (classics.running ? pauseClassics() : startClassics())}
            className="mt-3 h-11 rounded-md border border-line bg-surface px-4 text-sm disabled:opacity-50"
          >
            {classics.running ? "Pause import" : classics.index > 0 && classics.index < classics.total ? "Continue importing classics" : "Import many classics"}
          </button>
          {classics.note ? <p className="mt-2 text-sm text-muted">{classics.note}</p> : null}
          <p className="mt-4 text-sm leading-relaxed text-muted">
            Export/Backup Folio keeps the converted texts, their word index, their E5 embeddings, covers, excerpts, and
            edits. Import/Restore Folio puts an added book back the way the prepared classics open: the index is copied
            in, not built again. An older backup, without that index, is still restored and then indexed.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            To use the same library on another phone, computer, or installed app, export the file here and choose Sync
            on the other device. Sync adds books, excerpts, indexes, and embeddings that device does not have. It does
            not delete what is already there. There is no account in between: the file is the whole transfer, and it
            works in any browser.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void onExport()}
              className="h-11 rounded-md bg-accent px-4 text-sm text-bg disabled:opacity-50"
            >
              Export/Backup Folio
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
              className="h-11 rounded-md border border-line bg-surface px-4 text-sm"
            >
              Import/Restore Folio
            </button>
          </div>
          {pending ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void onSync()}
                className="h-11 rounded-md bg-accent px-4 text-sm text-bg disabled:opacity-50"
              >
                Sync into this library
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onRestore()}
                className="h-11 rounded-md border border-accent px-4 text-sm text-accent disabled:opacity-50"
              >
                Replace this library
              </button>
            </div>
          ) : null}
          {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
          {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
          <h3 className="mt-6 text-sm font-medium tracking-wide text-muted uppercase">On this device</h3>
          <ul className="mt-2 border-t border-line text-sm">
            <Stat label="Volumes" value={String(builtin + imported)} hint={`${builtin} built-in · ${imported} imported`} />
            <Stat label="Personas" {...kindFigure(stats?.personas)} />
            <Stat label="Excerpts" value={String(excerpts.length)} hint={formatBytes(excerptBytes)} />
            <Stat label="Full texts" {...kindFigure(stats?.texts, String(imported))} />
            <Stat label="Covers" {...kindFigure(stats?.covers)} />
            <Stat label="Edits" value={String(Object.keys(overrides).length)} hint={formatBytes(editBytes)} />
            <Stat
              label="Search index"
              value={stats?.index ? `${stats.index.count.toLocaleString()} records` : "—"}
              hint={sizeHint(stats?.index)}
            />
            <Stat label="Indexed sections" value={stats?.sections ? String(stats.sections.count) : "—"} hint={sizeHint(stats?.indexedText)} />
            <Stat
              label="Device"
              value={stats?.usage != null ? formatBytes(stats.usage) : "—"}
              hint={
                stats?.quota
                  ? `of ${formatBytes(stats.quota)}${persisted === false ? " · may be cleared if storage runs low" : ""}`
                  : persisted === false
                    ? "May be cleared if storage runs low"
                    : ""
              }
            />
          </ul>
          {hidden.length ? (
            <>
              <h3 className="mt-6 text-sm font-medium tracking-wide text-muted uppercase">Removed built-in volumes</h3>
              <ul className="mt-2">
                {hidden.map((work) => (
                  <li key={work.id} className="flex items-center gap-3 border-t border-line py-2">
                    <span className="min-w-0 flex-1 font-serif text-lg">{work.title}</span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void putBack([work.id])}
                      className="h-11 shrink-0 px-2 text-sm text-accent disabled:opacity-50"
                    >
                      Put back
                    </button>
                  </li>
                ))}
              </ul>
              {hidden.length > 1 ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void putBack(hidden.map((work) => work.id))}
                  className="mt-2 h-11 px-2 text-sm text-accent disabled:opacity-50"
                >
                  Put them all back
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        <div className="flex border-t border-line p-4">
          <button type="button" onClick={onClose} className="ml-auto h-11 px-3 text-sm text-muted">
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

function SemanticChoiceButton({ label, detail, on, onClick }: { label: string; detail: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-md border px-3 py-2 text-left",
        on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink",
      )}
    >
      <span className="block text-sm">{label}</span>
      <span className="mt-0.5 block text-sm text-muted">{detail}</span>
    </button>
  );
}

function ThemeChoice({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-11 rounded-md border px-4 text-sm",
        on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted",
      )}
    >
      {label}
    </button>
  );
}

function sizeHint(kind: StoredKind | undefined): string {
  if (!kind || kind.bytes < 0) return "";
  return formatBytes(kind.bytes);
}

function kindFigure(kind: StoredKind | undefined, fallback = "—"): { value: string; hint: string } {
  if (!kind) return { value: fallback, hint: "" };
  return { value: String(kind.count), hint: sizeHint(kind) };
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-line py-2">
      <span>{label}</span>
      <span className="text-right text-muted">
        {value}
        {hint ? <span className="text-muted"> · {hint}</span> : null}
      </span>
    </li>
  );
}

function Toggle({ on, label, onClick, tone }: { on: boolean; label: string; onClick: () => void; tone?: "kin" }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-9 rounded-md border px-3 text-sm",
        on && tone === "kin" && "border-kin bg-kin text-kin-ink",
        on && tone !== "kin" && "border-accent bg-accent-soft text-accent",
        !on && "border-line bg-surface text-muted",
      )}
    >
      {label}
    </button>
  );
}
