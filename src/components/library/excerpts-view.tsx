import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ShareDialog } from "@/components/library/share-dialog";
import { Modal } from "@/components/library/modal";
import { formatCitation } from "@/lib/corpus/dublin";
import {
  downloadBytes,
  excerptsToEpub,
  excerptsToJson,
  excerptsToPdf,
  excerptsToText,
  type ExportKind,
} from "@/lib/corpus/export-excerpts";
import type { Excerpt, Work } from "@/lib/corpus/types";
import { usePrefs } from "@/lib/prefs";
import { sharePassage } from "@/lib/share-passage";
import { cn } from "@/lib/cn";

function tagsOf(excerpt: Excerpt): string[] {
  return excerpt.tags ?? [];
}

function matchesFilter(excerpt: Excerpt, filter: string): boolean {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [excerpt.text, excerpt.title, excerpt.creator, excerpt.heading, ...tagsOf(excerpt)]
    .join("\n")
    .toLowerCase();
  return haystack.includes(needle);
}

export function ExcerptsView({ works }: { works: Work[] }) {
  const excerpts = usePrefs((s) => s.excerpts);
  const removeExcerpt = usePrefs((s) => s.removeExcerpt);
  const reviseExcerpt = usePrefs((s) => s.reviseExcerpt);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Excerpt | null>(null);
  const [sheet, setSheet] = useState<{ title: string; citation: string } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState<ExportKind | null>(null);
  const [exportError, setExportError] = useState("");

  const used = [...new Set(excerpts.flatMap(tagsOf))].sort((a, b) => a.localeCompare(b));
  const visible = excerpts.filter((excerpt) => matchesFilter(excerpt, filter));

  async function share(excerpt: Excerpt, creator: string, title: string) {
    const citation = formatCitation(excerpt.text, creator, title, excerpt.heading, excerpt.page);
    const result = await sharePassage({ title, text: citation });
    if (result === "unavailable") setSheet({ title, citation });
  }

  async function exportCollection(kind: ExportKind) {
    setExportError("");
    setExporting(kind);
    try {
      if (kind === "text") {
        downloadBytes("foliosift-excerpts.txt", new TextEncoder().encode(excerptsToText(excerpts, works)), "text/plain");
      } else if (kind === "json") {
        downloadBytes(
          "foliosift-excerpts.json",
          new TextEncoder().encode(excerptsToJson(excerpts, works)),
          "application/json",
        );
      } else if (kind === "epub") {
        downloadBytes("foliosift-excerpts.epub", excerptsToEpub(excerpts, works), "application/epub+zip");
      } else {
        downloadBytes("foliosift-excerpts.pdf", await excerptsToPdf(excerpts, works), "application/pdf");
      }
      setExportOpen(false);
    } catch {
      setExportError("That export did not finish.");
    } finally {
      setExporting(null);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-3xl text-ink">Excerpts</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Passages you saved from the reader, with their place in the volume and a citation ready to send.
          </p>
        </div>
        {excerpts.length > 0 ? (
          <button
            type="button"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((open) => !open)}
            className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-3 text-sm text-ink"
          >
            Export collection
          </button>
        ) : null}
      </div>
      {exportOpen ? (
        <div className="mt-3 flex flex-col gap-2">
          <p className="text-sm text-muted">The whole collection, including excerpts hidden by the filter.</p>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["text", "Text"],
                ["json", "JSON"],
                ["epub", "EPUB"],
                ["pdf", "PDF"],
              ] as const
            ).map(([kind, label]) => (
              <button
                key={kind}
                type="button"
                disabled={exporting !== null}
                onClick={() => void exportCollection(kind)}
                className="h-11 rounded-md border border-line bg-surface px-3 text-sm text-ink disabled:text-muted"
              >
                {exporting === kind ? "Preparing…" : label}
              </button>
            ))}
          </div>
          {exportError ? <p className="text-sm text-accent">{exportError}</p> : null}
        </div>
      ) : null}
      {excerpts.length === 0 ? (
        <p className="mt-8 max-w-xl font-serif text-lg text-muted">
          Open a volume, select a passage, and choose Save excerpt.
        </p>
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-3">
            <label className="flex w-full max-w-md flex-col gap-1 text-sm text-muted">
              Search excerpts
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="Words, author, title, or a tag"
                className="h-11 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
              />
            </label>
            {used.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {used.map((tag) => {
                  const on = filter.trim().toLowerCase() === tag.toLowerCase();
                  return (
                    <button
                      key={tag}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFilter(on ? "" : tag)}
                      className={cn(
                        "h-9 rounded-md border px-3 text-sm",
                        on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-ink",
                      )}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
          {visible.length === 0 ? (
            <p className="mt-8 font-serif text-lg text-muted">No excerpt matches that filter.</p>
          ) : (
            <ul className="mt-6 flex flex-col">
              {visible.map((excerpt) => {
                const work = works.find((item) => item.id === excerpt.workId);
                const creator = work?.author || excerpt.creator;
                const title = work?.title || excerpt.title;
                const citation = formatCitation(excerpt.text, creator, title, excerpt.heading, excerpt.page);
                const tags = tagsOf(excerpt);
                return (
                  <li key={excerpt.id} className="border-t border-line py-5">
                    <p className="font-serif text-lg leading-relaxed text-ink">{citation}</p>
                    <p className="mt-2 text-sm text-muted">
                      {excerpt.heading}
                      {excerpt.page ? ` · p. ${excerpt.page}` : ""} · characters {excerpt.start}–{excerpt.end}
                    </p>
                    {tags.length ? <p className="mt-2 text-sm text-muted">{tags.join(" · ")}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Link
                        to="/work/$workId"
                        params={{ workId: excerpt.workId }}
                        search={{ q: "", at: `${excerpt.sectionId}:${excerpt.start}:${excerpt.end}` }}
                        className="inline-flex h-11 items-center text-sm text-accent"
                      >
                        Open in the volume
                      </Link>
                      <button type="button" onClick={() => setEditing(excerpt)} className="h-11 px-2 text-sm text-ink">
                        Edit
                      </button>
                      <button type="button" onClick={() => void share(excerpt, creator, title)} className="h-11 px-2 text-sm text-ink">
                        Share
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void navigator.clipboard.writeText(citation).catch(() => setSheet({ title, citation }))
                        }
                        className="h-11 px-2 text-sm text-ink"
                      >
                        Copy
                      </button>
                      <button type="button" onClick={() => removeExcerpt(excerpt.id)} className="h-11 px-2 text-sm text-muted">
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
      {sheet ? (
        <ShareDialog title={sheet.title} citation={sheet.citation} onClose={() => setSheet(null)} />
      ) : null}
      {editing ? (
        <ExcerptEditor
          excerpt={editing}
          onClose={() => setEditing(null)}
          onSave={(text, tags) => reviseExcerpt(editing.id, { text, tags })}
        />
      ) : null}
    </div>
  );
}

function ExcerptEditor({
  excerpt,
  onClose,
  onSave,
}: {
  excerpt: Excerpt;
  onClose: () => void;
  onSave: (text: string, tags: string[]) => void;
}) {
  const saved = excerpt.original ?? excerpt.text;
  const [text, setText] = useState(excerpt.text);
  const [tags, setTags] = useState<string[]>(tagsOf(excerpt));
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim().replace(/\s+/g, " ");
    if (!tag) return;
    setTags((current) => (current.some((item) => item.toLowerCase() === tag.toLowerCase()) ? current : [...current, tag]));
    setDraft("");
  }

  function save() {
    if (!text.trim()) {
      setError("The quotation needs some text.");
      return;
    }
    onSave(text, draft.trim() ? [...tags, draft] : tags);
    onClose();
  }

  return (
    <Modal labelledBy="edit-excerpt-title" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <h2 id="edit-excerpt-title" className="font-serif text-2xl">
          Edit excerpt
        </h2>
        <p className="mt-2 text-sm text-muted">
          Revise the quotation and its tags. Opening it in the volume still uses the place you saved.
        </p>
        <label className="mt-4 flex flex-col gap-1 text-sm text-muted">
          Quotation
          <textarea
            value={text}
            autoFocus
            rows={8}
            onChange={(event) => {
              setText(event.target.value);
              setError("");
            }}
            className="min-h-40 w-full resize-y rounded-md border border-line bg-surface px-3 py-2 font-serif text-lg leading-relaxed text-ink outline-none"
          />
        </label>
        {text.trim() !== saved.trim() ? (
          <button type="button" onClick={() => setText(saved)} className="mt-2 h-10 text-sm text-accent">
            Restore the saved passage
          </button>
        ) : null}
        <div className="mt-5">
          <p className="text-sm text-muted">Tags</p>
          {tags.length ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                    className="h-9 rounded-md border border-line bg-surface px-3 text-sm text-ink"
                  >
                    {tag}
                    <span className="sr-only">, remove</span>
                    <span aria-hidden="true"> ×</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-muted">None yet.</p>
          )}
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addTag(draft);
            }}
          >
            <label className="sr-only" htmlFor="excerpt-tag">
              Add a tag
            </label>
            <input
              id="excerpt-tag"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a tag"
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
            />
            <button type="submit" className="h-11 shrink-0 rounded-md border border-line px-3 text-sm">
              Add
            </button>
          </form>
        </div>
        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line p-4">
        <button type="button" onClick={save} className="h-11 rounded-md bg-accent px-4 text-sm text-bg">
          Save
        </button>
        <button type="button" onClick={onClose} className="h-11 px-3 text-sm text-muted">
          Cancel
        </button>
      </div>
    </Modal>
  );
}
