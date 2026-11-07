import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Reader } from "@/components/library/reader";
import { Shell } from "@/components/library/shell";
import { applyDublin } from "@/lib/corpus/dublin";
import { loadSampleText } from "@/lib/corpus/works";
import { loadStoredWork } from "@/lib/library-db";
import type { Work } from "@/lib/corpus/types";
import { aimedSection, searchWork, buildIndex, type WorkHit } from "@/lib/search/engine";
import { loadSectionBodies, loadSectionText, indexIfNeeded } from "@/lib/search/disk-index";
import { storedPlace } from "@/lib/place";
import { searchStored } from "@/lib/search/stored-search";
import { usePrefs } from "@/lib/prefs";
import { bootLibrary, useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/work/$workId")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search.q === "string" ? search.q : "",
    at: typeof search.at === "string" ? search.at : "",
  }),
  component: WorkPage,
});

function WorkPage() {
  const { workId } = Route.useParams();
  const { q, at } = Route.useSearch();
  const navigate = useNavigate({ from: "/work/$workId" });
  const { works } = useLibrary();
  const stem = usePrefs((s) => s.stem);
  const fuzzy = usePrefs((s) => s.fuzzy);
  const concept = usePrefs((s) => s.concept);
  const overrides = usePrefs((s) => s.overrides);
  const listed = works.find((item) => item.id === workId) ?? null;
  const [full, setFull] = useState<Work | null>(null);
  const [passage, setPassage] = useState<Work | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "missing">("loading");
  const [found, setFound] = useState<{ hit: WorkHit | null; error: string | null }>({ hit: null, error: null });
  const [progress, setProgress] = useState("");
  const [limitNote, setLimitNote] = useState("");

  const onShelf = Boolean(listed);

  useEffect(() => {
    if (!listed) {
      setFull(null);
      setPassage(null);
      setPhase("missing");
      return;
    }
    if (listed.sections.some((section) => section.text.length > 0)) {
      setFull(listed);
      setPassage(null);
      setPhase("ready");
      return;
    }
    let live = true;
    setFull(null);
    setPassage(null);
    setPhase("loading");
    const id = listed.id;
    const meta = listed;
    if (meta.series) void indexIfNeeded(meta);
    if (meta.sections.length > 4000) {
      const ids = openingIds(meta.sections, at, id);
      void (async () => {
        await bootLibrary();
        const bodies = await loadSectionBodies(id, ids);
        if (!live) return;
        if (bodies.size) {
          setFull(applyBodies(meta, bodies));
          setPassage(null);
          setPhase("ready");
          return;
        }
        const stored = await loadStoredWork(id);
        if (!live) return;
        if (!stored) {
          setFull(null);
          setPhase("missing");
          return;
        }
        setFull(stored);
        setPassage(null);
        setPhase("ready");
      })();
      return () => {
        live = false;
      };
    }
    void (async () => {
      const stored = await loadStoredWork(id);
      const text = stored ?? (await loadSampleText(id));
      if (!live) return;
      if (!text) {
        setFull(null);
        setPhase("missing");
        return;
      }
      setFull(text);
      setPassage(null);
      setPhase("ready");
    })();
    return () => {
      live = false;
    };
    // Reload when the shelf id changes, not when a metadata patch rebuilds the catalog object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onShelf, workId]);

  useEffect(() => {
    if (full || !listed) return;
    const sectionId = aimedSection(at);
    if (!sectionId) return;
    let live = true;
    const meta = listed;
    void (async () => {
      await bootLibrary();
      const section = await loadSectionText(meta.id, sectionId);
      if (!live || !section) return;
      setPassage((current) =>
        current?.id === meta.id && current.sections[0]?.id === section.id && current.sections[0]?.text === section.text
          ? current
          : { ...meta, sections: [section] },
      );
    })();
    return () => {
      live = false;
    };
    // The shelf row follows workId. A metadata refresh should not reload the passage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, onShelf, workId, at]);

  const source = (full?.id === workId ? full : null) ?? (passage?.id === workId ? passage : null);
  const work = useMemo(
    () => (source ? applyDublin(source, overrides[source.id] ?? {}) : null),
    [source, overrides],
  );
  const textReady = Boolean(
    full && full.id === workId && full.sections.length > 0 && full.sections.every((section) => section.text.length > 0),
  );
  const openRef = useRef(full);
  openRef.current = full;

  useEffect(() => {
    let live = true;
    void (async () => {
      if (!q.trim()) {
        if (live) {
          setFound({ hit: null, error: null });
          setProgress("");
          setLimitNote("");
        }
        return;
      }
      const open = openRef.current;
      if (textReady && open && open.id === workId) {
        if (concept) {
          if (live) setProgress("Reading the thesaurus…");
          const { ensureThesaurus } = await import("@/lib/search/concepts");
          await ensureThesaurus();
          if (!live) return;
        }
        if (live) setProgress("Searching this volume…");
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (!live) return;
        const result = searchWork(buildIndex([open]), workId, {
          query: q,
          useStem: stem,
          fuzzy,
          concept,
        });
        if (!live) return;
        setFound({ hit: result.hit, error: result.error });
        setLimitNote("");
        setProgress("");
        return;
      }
      void bootLibrary();
      if (!live) return;
      if (live) setProgress("Reading this volume’s index…");
      const result = await searchStored({
        query: q,
        useStem: stem,
        fuzzy,
        concept,
        works,
        workId,
        bare: true,
        onProgress: (line) => {
          if (live) setProgress(line);
        },
      });
      if (!live) return;
      setFound({ hit: result.hits[0] ?? null, error: result.error });
      setLimitNote(result.note ?? "");
      setProgress("");
    })();
    return () => {
      live = false;
    };
  }, [q, stem, fuzzy, concept, works, workId, textReady]);

  const reachGen = useRef(0);
  function reach(ids: string[]) {
    const current = full?.id === workId ? full : null;
    if (!current || current.sections.length <= 4000) return;
    const missing = ids.filter((id) => current.sections.some((section) => section.id === id && !section.text));
    if (!missing.length) return;
    const gen = ++reachGen.current;
    void loadSectionBodies(current.id, missing).then((bodies) => {
      if (!bodies.size || gen !== reachGen.current) return;
      setFull((item) => (item && item.id === workId ? applyBodies(item, bodies) : item));
    });
  }

  return (
    <Shell query={q}>
      {found.error ? <p className="mb-4 text-sm text-accent">{found.error}</p> : null}
      {progress && q.trim() ? (
        <p role="status" className="mb-4 text-sm text-muted">
          {progress}
        </p>
      ) : null}
      {limitNote ? <p className="mb-4 text-sm text-muted">{limitNote}</p> : null}
      {work ? (
        <>
          {!full ? (
            <p role="status" className="mb-4 text-sm text-muted">
              Opening the rest of this volume…
            </p>
          ) : null}
          <Reader
            key={full ? "book" : "passage"}
            work={work}
            query={q}
            hit={found.hit}
            at={at}
            onReach={reach}
            onFind={(next) => void navigate({ search: { q: next, at: "" }, replace: true })}
          />
        </>
      ) : phase === "loading" ? (
        <p className="font-serif text-xl text-muted">Opening this volume…</p>
      ) : (
        <p className="font-serif text-xl text-muted">That volume is not on the shelf.</p>
      )}
    </Shell>
  );
}

function openingIds(sections: { id: string }[], at: string, workId: string): string[] {
  const aim = aimedSection(at);
  let index = aim ? sections.findIndex((section) => section.id === aim) : -1;
  if (index < 0) {
    const saved = storedPlace(workId);
    index = saved ? sections.findIndex((section) => section.id === saved.sectionId) : 0;
  }
  if (index < 0) index = 0;
  const from = Math.max(0, index - 1);
  return sections.slice(from, Math.min(sections.length, from + 16)).map((section) => section.id);
}

function applyBodies(work: Work, bodies: Map<string, string>): Work {
  let changed = false;
  const sections = work.sections.map((section) => {
    const text = bodies.get(section.id);
    if (!text || section.text) return section;
    changed = true;
    return { ...section, text };
  });
  return changed ? { ...work, sections } : work;
}
