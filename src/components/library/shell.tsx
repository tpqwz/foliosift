import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import { BookOpen, Library, Menu, Quote, Search, Settings, Users } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { listOf, personaSlug } from "@/lib/corpus/dublin";
import type { Work } from "@/lib/corpus/types";
import { placeLabel, useChapterWheel, useLastWork, useReadingPlace } from "@/lib/place";
import { useHydrated, usePrefs, useRemovalLabel } from "@/lib/prefs";
import { useImportActivity } from "@/lib/import-activity";
import { classicsSnapshot, subscribeClassics } from "@/lib/classics/import-many";
import { useBackLayer } from "@/lib/back";
import { readLastSearch, searchActive, type LibrarySearch } from "@/lib/search-state";
import { useSemantic } from "@/lib/search/embedder";
import { ensureThesaurus } from "@/lib/search/concepts";
import { startOffline } from "@/lib/pwa";
import { useLibrary } from "@/lib/use-library";
import { useVisualViewport } from "@/lib/visual-viewport";
import { SettingsDialog } from "./settings-dialog";
import { ImportStatus } from "./import-status";
import { ChapterFinder } from "./chapter-finder";

const EMPTY_SEARCH = { q: "", w: "", lang: "", author: "", form: "", period: "", genre: "" };

export function Shell({
  query = "",
  children,
}: {
  query?: string;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState(false);
  const [menu, setMenu] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [homeSearch, setHomeSearch] = useState<LibrarySearch>(EMPTY_SEARCH);
  const excerptCount = usePrefs((s) => s.excerpts.length);
  const path = useRouterState({ select: (s) => s.location.pathname });
  const workId = useRouterState({
    select: (s) => {
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const params = s.matches[i]?.params;
        if (params && "workId" in params && typeof params.workId === "string") return params.workId;
      }
      return "";
    },
  });
  const slug = useRouterState({
    select: (s) => {
      for (let i = s.matches.length - 1; i >= 0; i--) {
        const params = s.matches[i]?.params;
        if (params && "slug" in params && typeof params.slug === "string") return params.slug;
      }
      return "";
    },
  });
  const { works } = useLibrary();
  const hydrated = useHydrated();
  const remembered = useLastWork();
  const readerId = remembered && (works.some((work) => work.id === remembered) || !hydrated) ? remembered : "";
  const removing = useRemovalLabel();
  const incoming = useImportActivity();
  const classics = useSyncExternalStore(subscribeClassics, classicsSnapshot, classicsSnapshot);
  const importLine = incoming.line || (classics.running ? classics.note : "");
  const router = useRouter();
  useVisualViewport();

  useEffect(() => {
    void startOffline(async () => {
      await router.preloadRoute({ to: "/library" });
      await router.preloadRoute({ to: "/read" });
      await router.preloadRoute({ to: "/personas" });
      await router.preloadRoute({ to: "/excerpts" });
      await router.preloadRoute({ to: "/personas/$slug", params: { slug: "homer" } });
      await router.preloadRoute({ to: "/library/$workId", params: { workId: "iliad" } });
      await router.preloadRoute({
        to: "/work/$workId",
        params: { workId: "iliad" },
        search: { q: "", at: "" },
      });
    });
  }, [router]);

  useEffect(() => {
    void Promise.resolve(usePrefs.persist.rehydrate()).then(() => {
      const state = usePrefs.getState();
      if ((state.semantic === "e5" || state.semantic === "gemma") && state.semanticPick !== state.semantic) {
        usePrefs.setState({ semanticPick: state.semantic });
      }
      if (state.semantic === "e5" || state.semantic === "gemma") void useSemantic(state.semantic);
      if (state.concept) void ensureThesaurus();
    });
    return usePrefs.subscribe((state, previous) => {
      if (state.concept && !previous.concept) void ensureThesaurus();
      if (state.semantic !== "e5" && state.semantic !== "gemma") return;
      if (state.imports.length === previous.imports.length && state.removed === previous.removed) return;
      void useSemantic(state.semantic);
    });
  }, []);

  useBackLayer(menu, () => setMenu(false));

  const readerOn = path === "/read" || path.startsWith("/work/");
  const menuOn = menu || settings || path.startsWith("/personas") || path === "/library" || path.startsWith("/library/") || path.startsWith("/series/");

  function openReader() {
    setMenu(false);
    if (readerId) {
      if (path === `/work/${readerId}`) return;
      void router.navigate({ to: "/work/$workId", params: { workId: readerId }, search: { q: "", at: "" } });
      return;
    }
    if (path !== "/read") void router.navigate({ to: "/read" });
  }
  useEffect(() => setHomeSearch(readLastSearch()), [path, query]);

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link to="/" search={searchActive(homeSearch) ? homeSearch : EMPTY_SEARCH} aria-label="FolioSift" className="flex shrink-0 items-center gap-2">
            <img src="/favicon.svg" alt="" width="32" height="32" className="size-8 shrink-0" />
            <span className={cn("font-serif text-2xl tracking-wide text-ink", path !== "/" && "hidden lg:inline")}>FolioSift</span>
            {path !== "/" ? <span className="font-serif text-2xl tracking-wide text-ink lg:hidden">FS</span> : null}
          </Link>
          <Crumbs path={path} workId={workId} slug={slug} works={works} query={query} />
        </div>
        {removing ? (
          <p role="status" className="border-t border-line px-4 py-2 text-center text-sm text-muted">
            Removing “{removing}”…
          </p>
        ) : null}
      </header>
      {importLine ? (
        <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-16 z-30 flex justify-center px-4">
          <button
            type="button"
            onClick={() => setImportOpen(true)}
            className="pointer-events-auto max-w-md truncate rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted"
          >
            {importLine}
          </button>
        </div>
      ) : null}
      {importOpen && importLine ? (
        <ImportStatus
          line={importLine}
          running={incoming.running}
          classics={classics}
          onClose={() => setImportOpen(false)}
        />
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-6 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-bg pb-[env(safe-area-inset-bottom)]">
        <ul className="mx-auto grid max-w-6xl grid-cols-4">
          <li>
            <Link
              to="/"
              search={searchActive(homeSearch) ? homeSearch : EMPTY_SEARCH}
              className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-xs", path === "/" ? "text-accent" : "text-muted")}
            >
              <Search className="size-5" aria-hidden="true" />
              Search
            </Link>
          </li>
          <li>
            <button
              type="button"
              onClick={openReader}
              className={cn("flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs", readerOn ? "text-accent" : "text-muted")}
            >
              <BookOpen className="size-5" aria-hidden="true" />
              Reader
            </button>
          </li>
          <li>
            <Link
              to="/excerpts"
              className={cn(
                "flex h-14 flex-col items-center justify-center gap-0.5 text-xs",
                path === "/excerpts" || path.startsWith("/excerpts/") ? "text-accent" : "text-muted",
              )}
            >
              <span className="relative">
                <Quote className="size-5" aria-hidden="true" />
                {excerptCount > 0 ? (
                  <span className="absolute -top-2 -right-3 rounded-sm bg-accent px-1 text-xs leading-4 text-bg">{excerptCount}</span>
                ) : null}
              </span>
              Excerpts
            </Link>
          </li>
          <li>
            <button
              type="button"
              aria-label="Menu"
              aria-expanded={menu}
              onClick={() => setMenu((open) => !open)}
              className={cn("flex h-14 w-full flex-col items-center justify-center gap-0.5 text-xs", menuOn ? "text-accent" : "text-muted")}
            >
              <Menu className="size-5" aria-hidden="true" />
              Menu
            </button>
          </li>
        </ul>
      </nav>
      {menu ? (
        <div className="fixed inset-0 z-[60]" onClick={() => setMenu(false)}>
          <div
            role="menu"
            aria-label="More views"
            className="absolute right-2 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] w-56 rounded-md border border-line bg-bg p-1"
            onClick={(event) => event.stopPropagation()}
          >
            <Link
              role="menuitem"
              to="/library"
              onClick={() => setMenu(false)}
              className={cn(
                "flex h-11 items-center gap-2 rounded-md px-3 text-sm",
                path === "/library" || path.startsWith("/library/") ? "text-accent" : "text-ink",
              )}
            >
              <Library className="size-4" aria-hidden="true" />
              Library
            </Link>
            <Link
              role="menuitem"
              to="/personas"
              onClick={() => setMenu(false)}
              className={cn(
                "flex h-11 items-center gap-2 rounded-md px-3 text-sm",
                path.startsWith("/personas") ? "text-accent" : "text-ink",
              )}
            >
              <Users className="size-4" aria-hidden="true" />
              Personas
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setSettings(true);
              }}
              className="flex h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm text-ink"
            >
              <Settings className="size-4" aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
      ) : null}
      {settings ? <SettingsDialog open onClose={() => setSettings(false)} /> : null}
    </div>
  );
}

function Crumbs({
  path,
  workId,
  slug,
  works,
  query,
}: {
  path: string;
  workId: string;
  slug: string;
  works: Work[];
  query: string;
}) {
  const reading = useReadingPlace();
  const chapters = useChapterWheel(path.startsWith("/work/") ? workId : "");
  const router = useRouter();
  const [wheel, setWheel] = useState(false);
  useBackLayer(wheel, () => setWheel(false));
  const work = workId ? works.find((item) => item.id === workId) : undefined;
  const title = work?.title || workId;
  const persona =
    (slug && works.flatMap((item) => listOf(item.author)).find((name) => personaSlug(name) === slug)) || slug;
  const here =
    chapters.find((chapter) => chapter.id === reading.sectionId)?.heading ||
    placeLabel(reading.heading) ||
    "Chapters";

  type Crumb = { key: string; label: string; to?: "/" | "/library" | "/library/$workId" | "/personas" | "/work/$workId"; wheel?: boolean };
  const crumbs: Crumb[] = [];
  if (path === "/library") crumbs.push({ key: "library", label: "Library" });
  else if (path.startsWith("/library/") && workId) {
    crumbs.push({ key: "library", label: "Library", to: "/library" });
    crumbs.push({ key: "volume", label: title });
  } else if (path.startsWith("/work/") && workId) {
    crumbs.push({ key: "work", label: title, wheel: true });
    crumbs.push({ key: "section", label: here || "Chapters", wheel: true });
  } else if (path === "/personas") crumbs.push({ key: "personas", label: "Personas" });
  else if (path.startsWith("/personas/") && slug) {
    crumbs.push({ key: "personas", label: "Personas", to: "/personas" });
    crumbs.push({ key: "persona", label: persona });
  } else if (path === "/excerpts") crumbs.push({ key: "excerpts", label: "Excerpts" });
  else if (path === "/read") crumbs.push({ key: "reader", label: "Reader" });

  function openChapter(sectionId: string) {
    setWheel(false);
    void router.navigate({
      to: "/work/$workId",
      params: { workId },
      search: { q: query, at: sectionId },
      replace: true,
      resetScroll: false,
    });
  }

  if (!crumbs.length) {
    return <span className="hidden min-w-0 truncate text-sm text-muted sm:inline">a private library</span>;
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center overflow-hidden text-sm text-muted">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            const className = cn("min-w-0 truncate", last ? "text-ink" : "hover:text-ink");
            let node: ReactNode;
            if (crumb.wheel) {
              node = (
                <button
                  type="button"
                  className={className}
                  aria-haspopup="dialog"
                  aria-expanded={wheel}
                  onClick={() => chapters.length && setWheel(true)}
                >
                  {crumb.label}
                </button>
              );
            } else if (crumb.to === "/library") {
              node = (
                <Link to="/library" className={className}>
                  {crumb.label}
                </Link>
              );
            } else if (crumb.to === "/library/$workId") {
              node = (
                <Link to="/library/$workId" params={{ workId }} className={className}>
                  {crumb.label}
                </Link>
              );
            } else if (crumb.to === "/personas") {
              node = (
                <Link to="/personas" className={className}>
                  {crumb.label}
                </Link>
              );
            } else {
              node = <span className={className}>{crumb.label}</span>;
            }
            return (
              <li
                key={crumb.key}
                className={cn(
                  "flex min-w-0 items-center",
                  crumb.key === "section"
                    ? "max-w-[46%] shrink-0"
                    : crumb.key === "work" || crumb.key === "volume" || crumb.key === "persona"
                      ? "shrink"
                      : "shrink-0",
                )}
              >
                <span className="shrink-0 px-1.5" aria-hidden="true">
                  /
                </span>
                {node}
              </li>
            );
          })}
        </ol>
      </nav>
      {wheel && chapters.length ? (
        <ChapterWheel
          chapters={chapters}
          current={here}
          onClose={() => setWheel(false)}
          onOpen={openChapter}
        />
      ) : null}
    </>
  );
}

function ChapterWheel({
  chapters,
  current,
  onClose,
  onOpen,
}: {
  chapters: { id: string; heading: string }[];
  current: string;
  onClose: () => void;
  onOpen: (sectionId: string) => void;
}) {
  useEffect(() => {
    if (chapters.length <= 80) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chapters.length, onClose]);
  if (chapters.length > 80) {
    return (
      <div className="fixed inset-0 z-[60]" onClick={onClose}>
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Chapters"
          className="absolute inset-x-3 top-[4.25rem] mx-auto w-full max-w-sm rounded-md border border-line bg-bg p-3"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="px-1 text-xs tracking-wide text-muted uppercase">Jump to a chapter</p>
          <div className="mt-2">
            <ChapterFinder chapters={chapters} onOpen={onOpen} />
          </div>
        </div>
      </div>
    );
  }
  return <ChapterSnap chapters={chapters} current={current} onClose={onClose} onOpen={onOpen} />;
}

function ChapterSnap({
  chapters,
  current,
  onClose,
  onOpen,
}: {
  chapters: { id: string; heading: string }[];
  current: string;
  onClose: () => void;
  onOpen: (sectionId: string) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const follow = useRef(false);
  const start = Math.max(0, chapters.findIndex((chapter) => chapter.heading === current));
  const [selected, setSelected] = useState(start);

  function centerRow(index: number) {
    const root = listRef.current;
    const row = root?.querySelector<HTMLElement>(`[data-index="${index}"]`);
    if (!root || !row) return;
    root.scrollTop = row.offsetTop - root.clientHeight / 2 + row.clientHeight / 2;
  }

  useLayoutEffect(() => {
    centerRow(start);
  }, [start]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        follow.current = true;
        setSelected((index) => {
          const next = event.key === "ArrowDown" ? index + 1 : index - 1;
          return Math.min(chapters.length - 1, Math.max(0, next));
        });
      }
      if (event.key === "Enter") {
        const chapter = chapters[selected];
        if (chapter) onOpen(chapter.id);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [chapters, onClose, onOpen, selected]);

  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    centerRow(selected);
  }, [selected]);

  function pickFromScroll() {
    const root = listRef.current;
    if (!root) return;
    const mid = root.getBoundingClientRect().top + root.clientHeight / 2;
    let best = 0;
    let dist = Number.POSITIVE_INFINITY;
    root.querySelectorAll<HTMLElement>("[data-index]").forEach((node) => {
      const box = node.getBoundingClientRect();
      const gap = Math.abs(box.top + box.height / 2 - mid);
      if (gap < dist) {
        dist = gap;
        best = Number(node.dataset.index);
      }
    });
    setSelected((current) => (current === best ? current : best));
  }

  return (
    <div className="fixed inset-0 z-[60]" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Chapters"
        className="absolute inset-x-3 top-[4.25rem] mx-auto w-full max-w-sm rounded-md border border-line bg-bg p-3"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="px-1 text-xs tracking-wide text-muted uppercase">Jump to a chapter</p>
        <div className="relative mt-2">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 h-11 -translate-y-1/2 rounded-md border border-accent/40 bg-accent-soft" />
          <div
            ref={listRef}
            className="relative h-56 snap-y snap-mandatory overflow-y-auto overscroll-contain py-[5.625rem]"
            onScroll={pickFromScroll}
          >
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                type="button"
                data-index={index}
                className={cn(
                  "flex h-11 w-full snap-center items-center px-3 text-left text-sm",
                  index === selected ? "text-ink" : "text-muted",
                )}
                onClick={() => onOpen(chapter.id)}
              >
                <span className="truncate">{chapter.heading}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
