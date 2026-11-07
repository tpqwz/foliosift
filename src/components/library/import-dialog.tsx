import { useRef, useState, type ChangeEvent } from "react";
import { Modal } from "./modal";
import { IMPORT_EXT, importBook } from "@/lib/corpus/convert";
import { parseImport } from "@/lib/corpus/import";
import { fetchImportedUrl } from "@/lib/corpus/fetch-url";
import { commitImport } from "@/lib/prefs";
import { holdImport, importCancelled, importHeld, noteImport, releaseImport } from "@/lib/import-activity";

const SAMPLE = `Title: On gardens
Author: A reader
Language: English
Form: Prose
Period: Imported
Genre: Notes
Edition: Pasted text

---
## First bed
A garden is a small city with a stricter law. The vine does not negotiate, and the fig keeps its own calendar.

## Second bed
Write the names of what you planted. Memory is a poor index compared with a label pushed into the soil.`;

async function snapshotFiles(event: ChangeEvent<HTMLInputElement>): Promise<File[]> {
  const input = event.currentTarget;
  const pending = [...(input.files ?? [])].map(async (file) => {
    const bytes = await file.arrayBuffer();
    return new File([bytes], file.name || "Imported text", { type: file.type, lastModified: file.lastModified });
  });
  try {
    return await Promise.all(pending);
  } finally {
    input.value = "";
  }
}

const FILE_LIMIT = 64 * 1024 * 1024;
const PDF_LIMIT = 512 * 1024 * 1024;

function fileLimit(file: File): number {
  return /\.pdf$/i.test(file.name) || file.type === "application/pdf" ? PDF_LIMIT : FILE_LIMIT;
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const importing = useRef(false);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  function commit(raw: string, title: string) {
    const parsed = parseImport(raw, title);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    if (importHeld()) {
      setError("An import is already running.");
      return;
    }
    holdImport(`Indexing ${parsed.title}…`);
    void commitImport(parsed, noteImport).then(
      () => releaseImport(`Added ${parsed.title}`),
      (error: unknown) =>
        releaseImport(
          error instanceof Error && error.name === "ImportStopped" ? `Stopped. ${parsed.title} is on the shelf.` : `${parsed.title} could not be indexed.`,
          !(error instanceof Error && error.name === "ImportStopped"),
        ),
    );
    setText("");
    setError("");
    onClose();
  }

  async function fromUrl(address: string) {
    const target = address.trim();
    if (!target) {
      setError("Paste a web address.");
      return;
    }
    if (importing.current || importHeld()) {
      setError("An import is already running.");
      return;
    }
    importing.current = true;
    setBusy(true);
    setError("");
    holdImport("Fetching the page…");
    try {
      const parsed = await fetchImportedUrl({ data: { url: target } });
      if ("error" in parsed) {
        setError(parsed.error);
        releaseImport(parsed.error, true);
        return;
      }
      noteImport(`Indexing ${parsed.title}…`);
      await commitImport(parsed, noteImport);
      releaseImport(`Added ${parsed.title}`);
      setUrl("");
      setText("");
      onClose();
    } catch {
      setError("That page could not be fetched.");
      releaseImport("That page could not be fetched.", true);
    } finally {
      importing.current = false;
      setBusy(false);
    }
  }

  async function ingest(files: FileList | File[]) {
    if (importing.current || importHeld()) {
      setError("An import is already running.");
      return;
    }
    const seen = new Set<string>();
    const list = [...files].filter((file) => {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (!list.length) return;
    importing.current = true;
    setBusy(true);
    setError("");
    holdImport(`Reading 1 of ${list.length}: ${list[0]?.name ?? "a file"}`);
    let done = 0;
    const problems: string[] = [];
    let added = "";
    let halted = false;
    try {
      for (const file of list) {
        if (importCancelled()) {
          halted = true;
          break;
        }
        if (file.size > fileLimit(file)) {
          problems.push(
            /\.pdf$/i.test(file.name)
              ? `${file.name} is larger than 512 MB. Split it into volumes.`
              : `${file.name} is too large to open at once. Add one volume per file.`,
          );
          continue;
        }
        const line = `Reading ${done + 1} of ${list.length}: ${file.name}`;
        setStatus(line);
        noteImport(line);
        try {
          const report = (next: string) => {
            setStatus(next);
            noteImport(next);
          };
          const parsed = await importBook(file, report);
          if ("error" in parsed) {
            problems.push(`${file.name}: ${parsed.error}`);
            continue;
          }
          if (importCancelled()) {
            halted = true;
            break;
          }
          await commitImport(parsed, report);
          done += 1;
          added = parsed.title;
        } catch (error) {
          if (error instanceof Error && error.name === "ImportStopped") {
            halted = true;
            break;
          }
          const detail = error instanceof Error ? error.message : "";
          problems.push(detail && detail.length < 140 ? `${file.name}: ${detail}` : `${file.name} could not be indexed.`);
        }
      }
    } finally {
      importing.current = false;
      setBusy(false);
      setStatus("");
      if (halted) {
        releaseImport(done ? "Stopped. Volumes already added stay on the shelf." : "Stopped.");
      } else if (problems.length) {
        const message = problems.slice(0, 2).join(" ");
        setError(message);
        releaseImport(done ? `Added ${done}. ${message}` : message, true);
      } else {
        releaseImport(done === 1 ? `Added ${added}` : `Added ${done} volumes`);
        onClose();
      }
    }
  }

  return (
    <Modal labelledBy="import-title" onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col p-4 sm:p-5">
          <h2 id="import-title" className="font-serif text-2xl">
            Add a text
          </h2>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-accent">How a file is read</summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              PDF, EPUB, Kindle, and Word files are converted on this device into one markup. A PDF may be large, and a
              page with two columns is read one column at a time, so a Greek or Latin text stays apart from its
              translation. A line repeated at the edge of the page is left out. Chapters
              stay headings. A web address is fetched the same way. A Wikisource page keeps the verse lines. Each original page stays a <span className="font-mono text-xs">:::page 12</span> mark, which
              is the same idea as a MyST page directive, and it is not indexed as a word. Plain text and Markdown can
              be pasted below. A locked book is refused. A scan with no text layer cannot be indexed.
            </p>
          </details>
          <label className="mt-4 block text-sm text-muted" htmlFor="import-body">
            Text
          </label>
          <textarea
            id="import-body"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={12}
            disabled={busy}
            className="mt-1 min-h-48 w-full flex-1 rounded-md border border-line bg-surface p-3 font-serif text-base text-ink outline-none"
          />
          <label className="mt-3 block text-sm text-muted" htmlFor="import-url">
            Web address
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id="import-url"
              type="url"
              inputMode="url"
              value={url}
              disabled={busy}
              placeholder="https://en.wikisource.org/…"
              onChange={(event) => setUrl(event.target.value)}
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void fromUrl(url)}
              className="h-11 shrink-0 rounded-md border border-line bg-surface px-4 text-sm disabled:opacity-50"
            >
              Fetch
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-line p-4">
        {status ? <p className="w-full text-sm text-muted">{status}</p> : null}
        {error ? <p className="w-full text-sm text-accent">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const pasted = text.trim();
            if (/^https?:\/\/\S+$/i.test(pasted)) void fromUrl(pasted);
            else commit(text, "Imported text");
          }}
          className="h-11 rounded-md bg-accent px-4 text-sm text-bg disabled:opacity-50"
        >
          Index it
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => filesRef.current?.click()}
          className="h-11 rounded-md border border-line bg-surface px-4 text-sm disabled:opacity-50"
        >
          From files
        </button>
        <input
          ref={filesRef}
          type="file"
          multiple
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            void snapshotFiles(event).then(
              (files) => {
                if (!files.length) {
                  setError("The phone did not hand over a file. Try again, or paste the text.");
                  return;
                }
                void ingest(files);
              },
              () => setError("The file could not be read. Choose it again and wait until the import finishes."),
            );
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => folderRef.current?.click()}
          className="h-11 rounded-md border border-line bg-surface px-4 text-sm disabled:opacity-50"
        >
          From a folder
        </button>
        <input
          ref={(node) => {
            folderRef.current = node;
            node?.setAttribute("webkitdirectory", "");
            node?.setAttribute("directory", "");
          }}
          type="file"
          multiple
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            void snapshotFiles(event).then(
              (files) => {
                if (!files.length) {
                  setError("That folder did not come through. On a phone, use From files.");
                  return;
                }
                const texts = files.filter((file) => IMPORT_EXT.test(file.name));
                if (!texts.length) {
                  setError("No books or text files in that folder.");
                  return;
                }
                void ingest(texts);
              },
              () => setError("That folder could not be read. Choose it again."),
            );
          }}
        />
        <button type="button" disabled={busy} onClick={() => setText(SAMPLE)} className="h-11 px-3 text-sm text-muted">
          Sample
        </button>
        <button type="button" onClick={onClose} className="ml-auto h-11 px-3 text-sm text-muted">
          {busy ? "Continue in background" : "Close"}
        </button>
        </div>
      </div>
    </Modal>
  );
}
