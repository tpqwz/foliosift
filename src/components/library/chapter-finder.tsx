import { useState } from "react";

const SHOWN = 40;

export function ChapterFinder({
  chapters,
  onOpen,
}: {
  chapters: { id: string; heading: string }[];
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches: { id: string; heading: string }[] = [];
  let rest = 0;
  for (const chapter of chapters) {
    if (needle && !chapter.heading.toLowerCase().includes(needle)) continue;
    if (matches.length >= SHOWN) {
      rest += 1;
      continue;
    }
    matches.push({ id: chapter.id, heading: chapter.heading });
  }
  return (
    <div>
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Find a chapter"
        aria-label="Find a chapter"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className="h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
      />
      <p className="mt-2 text-xs text-muted">
        {chapters.length.toLocaleString()} {chapters.length === 1 ? "chapter" : "chapters"}
        {needle && rest > 0 ? ` · ${rest.toLocaleString()} more match` : ""}
      </p>
      <ol className="mt-1 max-h-64 overflow-auto">
        {matches.map((chapter) => (
          <li key={chapter.id}>
            <button type="button" className="flex h-10 w-full items-center text-left text-sm text-ink" onClick={() => onOpen(chapter.id)}>
              <span className="truncate">{chapter.heading}</span>
            </button>
          </li>
        ))}
      </ol>
      {!needle && chapters.length > SHOWN ? <p className="text-xs text-muted">Type to find one. The first {SHOWN} are listed.</p> : null}
      {needle && matches.length === 0 ? <p className="mt-2 text-sm text-muted">No chapter with that name.</p> : null}
    </div>
  );
}
