import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Facets } from "@/components/library/facets";
import { Results } from "@/components/library/results";
import { Shelf } from "@/components/library/shelf";
import { Shell } from "@/components/library/shell";
import { cn } from "@/lib/cn";
import { facetCounts, type WorkHit } from "@/lib/search/engine";
import {
  clearFacets,
  facetsFromSearch,
  hasFacets,
  readResultPlace,
  readSearch,
  readLastSearch,
  rememberSearch,
  clearResultPlace,
  searchActive,
  searchWithFacet,
  workMatchesFacets,
  type LibrarySearch,
} from "@/lib/search-state";
import { placeLabel, useLastWork, useStoredPlace } from "@/lib/place";
import { useBackLayer } from "@/lib/back";
import { usePrefs } from "@/lib/prefs";
import { searchStored } from "@/lib/search/stored-search";
import { blendSemantic, ensureSeriesEmbeddings, useSemantic } from "@/lib/search/embedder";
import { readResultCache, writeResultCache } from "@/lib/search/result-cache";
import { bootLibrary, useLibrary } from "@/lib/use-library";
import type { FacetKey } from "@/lib/corpus/types";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => readSearch(search),
  component: Home,
});

function Home() {
  const params = Route.useSearch();
  const [recall, setRecall] = useState<LibrarySearch | null>(null);
  const showing = searchActive(params) ? params : (recall ?? params);
  const navigate = useNavigate({ from: "/" });
  const { works } = useLibrary();
  const worksRef = useRef(works);
  worksRef.current = works;
  const stem = usePrefs((s) => s.stem);
  const fuzzy = usePrefs((s) => s.fuzzy);
  const concept = usePrefs((s) => s.concept);
  const semantic = usePrefs((s) => s.semantic);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [result, setResult] = useState<{ hits: WorkHit[]; error: string | null; active: boolean; note: string | null }>({
    hits: [],
    error: null,
    active: false,
    note: null,
  });
  const [settled, setSettled] = useState("");
  const [progress, setProgress] = useState("");
  const facets = facetsFromSearch(showing);
  const searchKey = `${showing.q}\n${showing.w}\n${stem}\n${fuzzy}\n${concept}\n${semantic}\n${works.length}`;
  const [held, setHeld] = useState(result);

  useEffect(() => {
    if (searchActive(params)) {
      rememberSearch(params);
      return;
    }
    const stored = readLastSearch();
    if (searchActive(stored)) {
      setRecall(stored);
      void navigate({ search: stored, replace: true });
    } else {
      setRecall(null);
    }
  }, [params.q, params.w, params.lang, params.author, params.form, params.period, params.genre, navigate]);

  useEffect(() => {
    let live = true;
    void (async () => {
      const shelf = worksRef.current;
      setProgress(showing.q.trim() || showing.w.trim() ? "Reading the index…" : "");
      const identity = `${showing.q}\n${showing.w}\n${stem}\n${fuzzy}\n${concept}\n${semantic}\nseries`;
      if (showing.q.trim() || showing.w.trim()) {
        const cached = await readResultCache(identity);
        if (!live) return;
        if (cached) {
          setResult(cached);
          setSettled(searchKey);
          setHeld(cached);
          setProgress("");
          return;
        }
      }
      void bootLibrary();
      const next = await searchStored({
        query: showing.q,
        within: showing.w,
        useStem: stem,
        fuzzy,
        concept,
        works: shelf,
        onProgress: (line) => {
          if (live) setProgress(line);
        },
      });
      if (semantic !== "off" && showing.q.trim() && !next.error) {
        await ensureSeriesEmbeddings(semantic, shelf, (line) => {
          if (live) setProgress(line);
        });
        if (!live) return;
        if (live) setProgress("Comparing meanings…");
        const blended = await blendSemantic(semantic, showing.q, next.hits, works, !showing.w.trim());
        next.hits = blended.hits;
        next.note = blended.note ?? next.note;
      }
      if (!live) return;
      const provisional = Boolean(next.note && next.note.includes("still"));
      if ((showing.q.trim() || showing.w.trim()) && !next.error && !provisional) {
        await writeResultCache(identity, next);
      }
      setResult(next);
      setSettled(searchKey);
      setHeld(next);
      setProgress("");
    })();
    return () => {
      live = false;
    };
  }, [searchKey, params.q, params.w, stem, fuzzy, concept, semantic]);

  const baseHits: WorkHit[] = held.active
    ? held.hits
    : works.map((work) => ({ work, score: 0, matchCount: 0, sections: [] }));
  const visible = baseHits.filter((hit) => workMatchesFacets(hit.work, facets));
  const groups = facetCounts(baseHits, facets);
  const pending = searchActive(showing) && settled !== searchKey;
  const searching = held.active && searchActive(showing);
  const showFacets = searching || hasFacets(facets) || works.length > 80;
  useLayoutEffect(() => {
    if (pending || !searching) return;
    const id = readResultPlace();
    if (!id) return;
    let tries = 0;
    let timer = 0;
    let follow = 0;
    const goToPlace = () => {
      const node = document.getElementById(id);
      if (!node) {
        if (tries++ < 10) timer = window.setTimeout(goToPlace, 40);
        return;
      }
      node.scrollIntoView({ block: "center" });
      follow = window.setTimeout(() => node.scrollIntoView({ block: "center" }), 80);
    };
    goToPlace();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(follow);
    };
  }, [pending, searching, settled]);
  const shelfWorks = visible.map((hit) => hit.work);
  useBackLayer(filtersOpen, () => setFiltersOpen(false));

  function go(next: Partial<LibrarySearch>) {
    const merged = { ...showing, ...next };
    clearResultPlace();
    rememberSearch(merged);
    void navigate({ search: merged, replace: true });
  }

  function toggleFacet(key: FacetKey, name: string) {
    const next = searchWithFacet(showing, key, name);
    rememberSearch(next);
    void navigate({ search: next, replace: true });
  }

  const facetPanel = (
    <Facets
      groups={groups}
      selected={facets}
      onToggle={toggleFacet}
      onClear={() => {
        const next = clearFacets(showing);
        rememberSearch(next);
        void navigate({ search: next, replace: true });
      }}
    />
  );

  return (
    <Shell query={showing.q}>
      <SearchBar query={showing.q} onSearch={(q) => go({ q })} />
      {searching ? null : <ContinueReading works={works} />}
      <div className={showFacets ? "lg:grid lg:grid-cols-[15rem_1fr] lg:gap-10" : ""}>
        {showFacets ? <aside className="mb-6 hidden lg:block">{facetPanel}</aside> : null}
        <div className="min-w-0">
          <div className={cn("mb-4 flex items-center justify-between", showFacets && "lg:hidden")}>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="h-11 rounded-md border border-line bg-surface px-3 text-sm"
              >
                Narrow{hasFacets(facets) ? " · on" : ""}
              </button>
          </div>
          {held.error ? <p className="mb-4 text-sm text-accent">{held.error}</p> : null}
          {pending ? (
            <p role="status" className="mb-3 text-sm text-muted">
              {progress || "Searching…"}
            </p>
          ) : null}
          {searching ? (
            <Results
              hits={visible}
              totalMatches={visible.reduce((sum, hit) => sum + hit.matchCount, 0)}
              within={showing.w}
              onWithin={(w) => go({ w })}
              search={showing}
              note={pending ? null : held.note}
            />
          ) : pending ? null : (
            <Shelf works={shelfWorks} />
          )}
        </div>
      </div>
      {filtersOpen ? (
        <div
          className={cn(
            "fixed inset-x-0 z-[60] overflow-auto bg-bg px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]",
            showFacets && "lg:hidden",
          )}
          style={{ top: "var(--vv-top, 0px)", height: "var(--vv-height, 100dvh)" }}
        >
          <div className="mb-4 flex justify-end">
            <button type="button" onClick={() => setFiltersOpen(false)} className="h-11 px-3 text-sm text-accent">
              Done
            </button>
          </div>
          {facetPanel}
        </div>
      ) : null}
    </Shell>
  );
}

function SearchBar({ query, onSearch }: { query: string; onSearch: (query: string) => void }) {
  const [draft, setDraft] = useState(query);
  const stem = usePrefs((s) => s.stem);
  const fuzzy = usePrefs((s) => s.fuzzy);
  const concept = usePrefs((s) => s.concept);
  const semantic = usePrefs((s) => s.semantic);
  const toggle = usePrefs((s) => s.toggle);
  const toggleMeaning = usePrefs((s) => s.toggleMeaning);
  useEffect(() => setDraft(query), [query]);
  return (
    <form
      role="search"
      className="mb-5"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft);
      }}
    >
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="folio-q">
          Search the library
        </label>
        <input
          id="folio-q"
          name="q"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder='Search…  virtue, "wine-dark sea", war NOT city'
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          inputMode="search"
          className="h-12 min-w-0 flex-1 rounded-md border border-line bg-surface px-4 font-serif text-lg text-ink outline-none placeholder:text-muted"
        />
        <button type="submit" className="h-12 shrink-0 rounded-md bg-accent px-4 text-sm text-bg">
          Search
        </button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Option on={stem} label="Stemming" onClick={() => toggle("stem")} />
        <Option on={fuzzy} label="Fuzzy" onClick={() => toggle("fuzzy")} />
        <Option on={concept} label="Concepts" tone="kin" onClick={() => toggle("concept")} />
        <Option
          on={semantic !== "off"}
          label="Meaning"
          tone="mean"
          onClick={() => {
            const next = toggleMeaning();
            void useSemantic(next);
          }}
        />
      </div>
      <p className="mt-3 text-sm text-muted">
        Space means AND. Operators are uppercase: OR, NOT. Quotes, word*, word~. Concepts marks related words in blue.
        Meaning compares the sense of a passage.
      </p>
    </form>
  );
}

function Option({ on, label, onClick, tone }: { on: boolean; label: string; onClick: () => void; tone?: "kin" | "mean" }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "h-9 rounded-md border px-3 text-sm",
        on && tone === "kin" && "border-kin bg-kin text-kin-ink",
        on && tone === "mean" && "border-mean bg-mean text-mean-ink",
        on && tone !== "kin" && tone !== "mean" && "border-accent bg-accent-soft text-accent",
        !on && "border-line bg-surface text-muted",
      )}
    >
      {label}
    </button>
  );
}

function ContinueReading({ works }: { works: { id: string; title: string; author: string }[] }) {
  const id = useLastWork();
  const place = useStoredPlace(id);
  const work = works.find((item) => item.id === id);
  if (!work) return null;
  return (
    <Link
      to="/work/$workId"
      params={{ workId: work.id }}
      search={{ q: "", at: "" }}
      className="mb-5 block rounded-md border border-line bg-surface px-4 py-3"
    >
      <p className="text-xs tracking-wide uppercase text-muted">Continue</p>
      <p className="font-serif text-xl text-ink">{work.title}</p>
      <p className="mt-1 text-sm text-muted">
        {work.author}
        {place ? ` · ${placeLabel(place.heading)}` : ""}
      </p>
    </Link>
  );
}
