import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { LibrarySearch } from "@/lib/search-state";
import { readResultPlace, rememberResultPlace, resultDomId } from "@/lib/search-state";
import type { WorkHit } from "@/lib/search/engine";
import { Passage } from "./passage";

export function Results({
  hits,
  totalMatches,
  within,
  onWithin,
  search,
  note,
}: {
  hits: WorkHit[];
  totalMatches: number;
  within: string;
  onWithin: (value: string) => void;
  search: LibrarySearch;
  note?: string | null;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <p className="font-serif text-xl text-ink">
          {hits.length} {hits.length === 1 ? "work" : "works"}
          <span className="text-muted"> · {totalMatches} {totalMatches === 1 ? "match" : "matches"}</span>
        </p>
        <WithinField within={within} onWithin={onWithin} />
      </div>
      {note ? <p className="-mt-3 text-sm text-muted">{note}</p> : null}
      {hits.length === 0 ? (
        <p className="max-w-xl font-serif text-lg text-muted">
          No passage contains that. Try stemming, a trailing *, or concept search for a wider net.
        </p>
      ) : (
        <ol className="flex flex-col gap-8">
          {hits.map((hit) => (
            <li key={hit.work.id}>
              <WorkBlock hit={hit} search={search} reveal={readResultPlace()} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MeaningBrace() {
  return (
    <span aria-hidden className="flex w-3.5 shrink-0 self-stretch text-mean">
      <svg viewBox="0 0 14 48" preserveAspectRatio="none" className="h-full w-full">
        <path
          d="M11 1.2C7 1.2 7 6 7 12v8c0 3-3 4.2-5.2 4.8 2.2.6 5.2 1.8 5.2 4.8v8c0 6 0 10.8 4 10.8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </span>
  );
}

function WithinField({ within, onWithin }: { within: string; onWithin: (value: string) => void }) {
  const [draft, setDraft] = useState(within);
  useEffect(() => setDraft(within), [within]);
  return (
    <form
      className="flex w-full items-end gap-2 sm:w-auto"
      onSubmit={(event) => {
        event.preventDefault();
        onWithin(draft);
      }}
    >
      <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-muted sm:w-72">
        Search within results
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="AND this as well"
          enterKeyHint="search"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-11 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
        />
      </label>
      <button type="submit" className="h-11 shrink-0 rounded-md border border-line px-3 text-sm text-ink">
        Search
      </button>
    </form>
  );
}

function jumpAt(snippet: { id: string; sectionId: string }, meaning: boolean | undefined): string {
  if (snippet.id.startsWith("mean:")) return snippet.id;
  if (meaning) return snippet.sectionId;
  if (snippet.id.endsWith("-open")) return snippet.sectionId;
  return `m-${snippet.id}`;
}

function WorkBlock({ hit, search, reveal }: { hit: WorkHit; search: LibrarySearch; reveal: string }) {
  const snippets = hit.sections.flatMap((section) =>
    section.snippets.map((snippet) => ({ snippet, section })),
  );
  const revealed = snippets.findIndex(({ snippet }) => resultDomId(hit.work.id, snippet.id) === reveal);
  const [shown, setShown] = useState(revealed >= 0 ? Math.max(2, revealed + 1) : 2);
  const visible = snippets.slice(0, shown);
  const first = visible[0];
  const firstAt = first ? jumpAt(first.snippet, first.section.meaning) : "";
  const firstId = first ? resultDomId(hit.work.id, first.snippet.id) : "";

  return (
    <article className="border-t border-line pt-4">
      <header className="mb-3">
        <Link
          to="/work/$workId"
          params={{ workId: hit.work.id }}
          search={{ q: search.q, at: "" }}
          className="font-serif text-2xl text-ink"
        >
          {hit.work.title}
        </Link>
        {first ? (
          <Link
            id={firstId}
            to="/work/$workId"
            params={{ workId: hit.work.id }}
            search={{ q: search.q, at: firstAt }}
            hash={firstAt}
            onClick={() => rememberResultPlace(firstId)}
            className="mt-1 block scroll-mt-24 py-1 text-sm text-muted underline decoration-line underline-offset-4"
          >
            {hit.work.author} · {hit.work.genre} · {hit.work.language} · {hit.matchCount}{" "}
            {hit.matchCount === 1 ? "match" : "matches"}
          </Link>
        ) : (
          <p className="mt-1 text-sm text-muted">
            {hit.work.author} · {hit.work.genre} · {hit.work.language} · {hit.matchCount}{" "}
            {hit.matchCount === 1 ? "match" : "matches"}
          </p>
        )}
      </header>
      <div className="flex flex-col gap-4">
        {visible.map(({ snippet, section }, index) => {
          const at = jumpAt(snippet, section.meaning);
          const domId = resultDomId(hit.work.id, snippet.id);
          const place = (
            <p className="text-xs tracking-wide text-muted uppercase">
              {snippet.heading}
              {section.meaning ? " · by meaning" : ""}
            </p>
          );
          return (
            <div key={snippet.id}>
              {index === 0 ? (
                place
              ) : (
                <Link
                  id={domId}
                  to="/work/$workId"
                  params={{ workId: hit.work.id }}
                  search={{ q: search.q, at }}
                  hash={at}
                  onClick={() => rememberResultPlace(domId)}
                  className="block scroll-mt-24 py-1 text-xs tracking-wide text-muted uppercase underline decoration-line underline-offset-4"
                >
                  {snippet.heading}
                  {section.meaning ? " · by meaning" : ""}
                </Link>
              )}
              <div className={section.meaning ? "mt-1 flex items-stretch gap-2" : undefined}>
                {section.meaning ? <MeaningBrace /> : null}
                <div className="min-w-0 flex-1">
                  <Passage segments={snippet.segments} lead={snippet.lead} tail={snippet.tail} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {snippets.length > shown ? (
        <button type="button" onClick={() => setShown((count) => Math.min(snippets.length, count + 20))} className="mt-3 h-10 text-sm text-accent">
          Show more ({snippets.length - shown} left)
        </button>
      ) : snippets.length > 2 ? (
        <button type="button" onClick={() => setShown(2)} className="mt-3 h-10 text-sm text-accent">
          Show fewer
        </button>
      ) : null}
    </article>
  );
}
