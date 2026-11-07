import { Link } from "@tanstack/react-router";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { formatCitation, listOf, personaSlug } from "@/lib/corpus/dublin";
import { preferLabel } from "@/lib/persona/names";
import { omitContentsEcho, pageRange, pageSpans } from "@/lib/corpus/markup";
import type { Excerpt, Work } from "@/lib/corpus/types";
import { aimedToken, anchorId, clusters, kinIndexes, readerSegments, type WorkHit } from "@/lib/search/engine";
import { parseMeaning, originalSpan } from "@/lib/search/semantic";
import { ensureThesaurus, thesaurusReady } from "@/lib/search/concepts";
import { tokenize } from "@/lib/search/tokenize";
import { usePrefs } from "@/lib/prefs";
import { clearChapterWheel, clearReadingPlace, setChapterWheel, setLastWork, setReadingPlace, storedPlace, withTextParts } from "@/lib/place";
import { sharePassage } from "@/lib/share-passage";
import { useCover } from "@/lib/use-cover";
import { cn } from "@/lib/cn";
import { Passage, sliceSegments, withMeanLine, withSavedMarks, withSavedRange } from "./passage";
import { ShareDialog } from "./share-dialog";
import { ChapterFinder } from "./chapter-finder";

type Pick = {
  sectionId: string;
  heading: string;
  text: string;
  start: number;
  end: number;
  top: number;
  bottom: number;
  left: number;
  /** Ours, not the browser's. Hidden until the finger lifts. */
  held?: boolean;
  choosing?: boolean;
  page?: string;
};

export function Reader({
  work,
  query,
  hit,
  at,
  onFind,
  onReach,
}: {
  work: Work;
  query: string;
  hit: WorkHit | null;
  at?: string;
  onFind: (query: string) => void;
  /** Sections about to be shown. A very long book loads only these. */
  onReach?: (sectionIds: string[]) => void;
}) {
  const addExcerpt = usePrefs((s) => s.addExcerpt);
  const stem = usePrefs((s) => s.stem);
  const concept = usePrefs((s) => s.concept);
  const [wordsReady, setWordsReady] = useState(thesaurusReady);
  useEffect(() => {
    if (!concept) return;
    if (thesaurusReady()) {
      setWordsReady(true);
      return;
    }
    let live = true;
    void ensureThesaurus().then(() => {
      if (live) setWordsReady(true);
    });
    return () => {
      live = false;
    };
  }, [concept]);
  const removeExcerpt = usePrefs((s) => s.removeExcerpt);
  const savedExcerpts = usePrefs((s) => s.excerpts);
  const mine = useMemo(() => savedExcerpts.filter((excerpt) => excerpt.workId === work.id), [savedExcerpts, work.id]);
  const storedCover = useCover(work.cover ? "" : work.id);
  const cover = work.cover || storedCover || "";
  const bySection = new Map(hit?.sections.map((section) => [section.sectionId, section]) ?? []);
  const aim = aimedToken(at);
  const sections = useMemo(
    () => withTextParts(work.sections.length > 4000 ? work.sections : omitContentsEcho(work.sections)),
    [work],
  );
  const focus = parseAt(at);
  const placed = locate(at);
  const placedIndex = placed ? sections.findIndex((section) => section.id === placed.sectionId) : -1;
  const [boundsFor, setBoundsFor] = useState(work.id);
  const [bounds, setBounds] = useState(() => spanAround(sections.length, placedIndex >= 0 ? placedIndex : savedIndex(work.id, sections)));
  if (boundsFor !== work.id) {
    setBoundsFor(work.id);
    setBounds(spanAround(sections.length, placedIndex >= 0 ? placedIndex : savedIndex(work.id, sections)));
  }
  const visible = sections.slice(bounds.from, bounds.to);
  const onReachRef = useRef(onReach);
  onReachRef.current = onReach;
  useEffect(() => {
    if (!onReachRef.current) return;
    const from = Math.max(0, bounds.from - 1);
    const to = Math.min(sections.length, bounds.to + 8);
    onReachRef.current(sections.slice(from, to).map((section) => section.id));
  }, [bounds.from, bounds.to, work.id, sections]);
  const [pick, setPick] = useState<Pick | null>(null);
  const [note, setNote] = useState("");
  const [sheet, setSheet] = useState<{ title: string; citation: string } | null>(null);
  const [opened, setOpened] = useState<Excerpt | null>(null);
  const [openedAt, setOpenedAt] = useState<{ top: number; bottom: number; left: number } | null>(null);
  const [toast, setToast] = useState("");
  const [fading, setFading] = useState(false);
  const fadeTimer = useRef(0);
  const resumed = useRef("");
  const pending = useRef("");
  const stick = useRef<{ id: string; top: number } | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const pickRef = useRef<Pick | null>(null);
  pickRef.current = pick;
  const known = new Set(sections.map((section) => section.id));
  const jumps =
    hit?.sections
      .filter((section) => known.has(section.sectionId))
      .flatMap((section) => {
        const groups = clusters(section.bodyHits);
        if (groups.length) {
          return groups.map((group) => ({
            id: anchorId(section.sectionId, group[0]),
            sectionId: section.sectionId,
            heading: section.heading,
          }));
        }
        if (section.headingHits.length) {
          return [{ id: section.sectionId, sectionId: section.sectionId, heading: section.heading }];
        }
        return [];
      }) ?? [];
  const [matchKey, setMatchKey] = useState("");
  const [matchPick, setMatchPick] = useState<number | null>(null);
  const sought = useRef("");
  const matchName = `${work.id}\n${query}`;
  if (matchKey !== matchName) {
    setMatchKey(matchName);
    setMatchPick(null);
  }
  const placedMatch = placed ? jumps.findIndex((jump) => jump.id === placed.anchor) : -1;
  const matchAt = jumps.length
    ? Math.min(matchPick ?? (placedMatch >= 0 ? placedMatch : 0), jumps.length - 1)
    : 0;
  const currentJump = jumps[matchAt];

  function reveal(index: number, anchor: string) {
    if (index < 0) return;
    const around = spanAround(sections.length, index);
    const inView = index >= bounds.from && index < bounds.to;
    const mark = document.getElementById(anchor);
    if (inView && mark) {
      pending.current = "";
      mark.scrollIntoView({ block: "start" });
      return;
    }
    pending.current = anchor;
    if (inView) {
      document.getElementById(sections[index]?.id ?? "")?.scrollIntoView({ block: "start" });
      return;
    }
    setBounds((current) => (current.from === around.from && current.to === around.to ? current : around));
  }

  useEffect(() => {
    setLastWork(work.id);
  }, [work.id]);

  useEffect(() => {
    setChapterWheel(work.id, sections);
    return () => clearChapterWheel(work.id);
  }, [work.id, sections]);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight) * 0.3;
      const nodes = document.querySelectorAll("article section[data-section]");
      let best: Element | null = null;
      for (const node of nodes) {
        if (node.getBoundingClientRect().top <= line) best = node;
        else break;
      }
      const current = best ?? nodes[0];
      if (!(current instanceof HTMLElement)) return;
      const sectionId = current.getAttribute("data-section") ?? "";
      const heading = current.getAttribute("data-heading") ?? "";
      if (!sectionId || !heading) return;
      setReadingPlace({ sectionId, heading }, work.id);
    };
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.visualViewport?.addEventListener("scroll", onScroll);
    window.visualViewport?.addEventListener("resize", onScroll);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.visualViewport?.removeEventListener("scroll", onScroll);
      window.visualViewport?.removeEventListener("resize", onScroll);
    };
  }, [work.id, bounds.from, bounds.to]);

  useLayoutEffect(() => {
    const held = stick.current;
    if (held) {
      stick.current = null;
      const node = document.getElementById(held.id);
      if (node) {
        const delta = node.getBoundingClientRect().top - held.top;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      }
    }
    const anchor = pending.current;
    if (!anchor) return;
    const node = document.getElementById(anchor);
    if (!node) return;
    pending.current = "";
    node.scrollIntoView({ block: "start" });
  }, [bounds.from, bounds.to, sections]);

  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    const head = article.querySelector("[data-read-head]");
    const tail = article.querySelector("[data-read-tail]");
    if (!head && !tail) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (entry.target === tail) {
            if (sections.length > 4000) {
              const viewBottom = (window.visualViewport?.offsetTop ?? 0) + (window.visualViewport?.height ?? window.innerHeight);
              if (entry.boundingClientRect.top > viewBottom + 120) continue;
            }
            setBounds((current) => {
              if (current.to >= sections.length) return current;
              const to = Math.min(sections.length, current.to + 3);
              if (sections.length <= 4000) return { ...current, to };
              const height = article.getBoundingClientRect().height;
              const view = window.visualViewport?.height ?? window.innerHeight;
              const fills = height > view * 0.9;
              const cap = fills ? 12 : 48;
              if (to - current.from <= cap) return { ...current, to };
              if (!fills) return current;
              const from = to - cap;
              const id = sections[from]?.id ?? "";
              const node = id ? document.getElementById(id) : null;
              if (node) stick.current = { id, top: node.getBoundingClientRect().top };
              return { from, to };
            });
          } else {
            setBounds((current) => {
              if (current.from === 0) return current;
              const firstId = sections[current.from]?.id ?? "";
              const node = firstId ? document.getElementById(firstId) : null;
              if (node) stick.current = { id: firstId, top: node.getBoundingClientRect().top };
              const from = Math.max(0, current.from - 3);
              if (sections.length <= 4000) return { ...current, from };
              const to = Math.min(current.to, from + 12);
              return { from, to };
            });
          }
        }
      },
      { rootMargin: "240px 0px 720px 0px" },
    );
    if (head) observer.observe(head);
    if (tail) observer.observe(tail);
    return () => observer.disconnect();
  }, [bounds.from, bounds.to, sections]);

  useEffect(() => {
    if (placed || query || window.location.hash) return;
    if (resumed.current === work.id) return;
    resumed.current = work.id;
    const saved = storedPlace(work.id);
    if (!saved) return;
    const index = sections.findIndex((section) => section.id === saved.sectionId);
    if (index < 0) return;
    const node = document.getElementById(saved.sectionId);
    if (node) {
      node.scrollIntoView({ block: "start" });
      return;
    }
    pending.current = saved.sectionId;
    const around = spanAround(sections.length, index);
    setBounds((current) => (current.from === around.from && current.to === around.to ? current : around));
  }, [work.id, at, query, sections, placed]);

  useLayoutEffect(() => {
    const targetId = placed && matchPick == null ? placed.sectionId : currentJump?.sectionId ?? "";
    const anchor = placed && matchPick == null ? placed.anchor : currentJump?.id ?? "";
    if ((!placed && !query) || !targetId) return;
    if (!placed && !currentJump) return;
    const token = `${work.id}:${query}:${anchor}`;
    if (sought.current === token) return;
    const index = sections.findIndex((section) => section.id === targetId);
    if (index < 0) return;
    if (index < bounds.from || index >= bounds.to) {
      pending.current = anchor || targetId;
      const around = spanAround(sections.length, index);
      setBounds((current) => (current.from === around.from && current.to === around.to ? current : around));
      return;
    }
    const mark = anchor ? document.getElementById(anchor) : null;
    if (mark) {
      sought.current = token;
      pending.current = "";
      mark.scrollIntoView({ block: "start" });
      return;
    }
    const section = document.getElementById(targetId);
    if (!section) return;
    if ((sections[index]?.text.length ?? 0) > 0) sought.current = token;
    pending.current = anchor || targetId;
    section.scrollIntoView({ block: "start" });
  }, [work.id, query, placed?.anchor, placed?.sectionId, matchPick, currentJump?.id, currentJump?.sectionId, sections, bounds.from, bounds.to]);

  useEffect(() => () => clearReadingPlace(), []);

  useEffect(() => {
    const coarse = () => window.matchMedia("(any-pointer: coarse)").matches;
    const article = articleRef.current;
    let timer = 0;
    let originX = 0;
    let originY = 0;
    let press = 0;
    let pointerId = -1;
    let selecting = false;
    let edge: "anchor" | "start" | "end" | null = null;
    let sectionId = "";
    let anchorStart = 0;
    let anchorEnd = 0;
    let currentStart = 0;
    let currentEnd = 0;
    let frame = 0;
    let pointX = 0;
    let pointY = 0;
    let pendingMark = "";

    const capture = (selected: Pick): Pick => {
      const section = work.sections.find((item) => item.id === selected.sectionId);
      selected.page = pageRange(section?.pages, selected.start, selected.end);
      return selected;
    };

    const paint = (range: Range, choosing: boolean) => {
      const described = describeRange(range);
      if (!described) return;
      const next = capture(described);
      next.held = true;
      next.choosing = choosing;
      setPick(next);
      setNote("");
    };

    const extend = () => {
      frame = 0;
      if (!sectionId) return;
      const handle = edge === "start" || edge === "end" ? edge : null;
      const spot = handle ? spotForHandle(handle, pointX, pointY) : spotAt(pointX, pointY);
      if (!spot || spot.sectionId !== sectionId) return;
      const section = work.sections.find((item) => item.id === sectionId);
      if (!section) return;
      let start = currentStart;
      let end = currentEnd;
      if (edge === "start") {
        const next = Math.max(0, Math.min(spot.offset, section.text.length));
        if (next >= currentEnd) {
          start = currentEnd;
          end = Math.min(section.text.length, Math.max(next + 1, currentEnd + 1));
          edge = "end";
        } else {
          start = next;
          end = currentEnd;
        }
      } else if (edge === "end") {
        const next = Math.max(0, Math.min(spot.offset + 1, section.text.length));
        if (next <= currentStart) {
          end = currentStart;
          start = Math.max(0, Math.min(spot.offset, currentStart - 1));
          edge = "start";
        } else {
          start = currentStart;
          end = next;
        }
      } else {
        const word = wordSpan(section.text, spot.offset);
        if (spot.offset >= anchorStart) {
          start = anchorStart;
          end = Math.max(word.end, anchorEnd);
        } else {
          start = word.start;
          end = anchorEnd;
        }
      }
      if (end <= start) return;
      const range = rangeForOffsets(sectionId, start, end);
      if (!range) return;
      currentStart = start;
      currentEnd = end;
      paint(range, true);
    };

    if (article && coarse()) {
      article.style.userSelect = "none";
      article.style.setProperty("-webkit-user-select", "none");
      article.style.setProperty("-webkit-touch-callout", "none");
    }

    const onSelection = () => {
      if (coarse()) return;
      const selected = readSelection();
      if (!selected) return;
      const next = capture(selected);
      setPick((current) =>
        current &&
        current.sectionId === next.sectionId &&
        current.start === next.start &&
        current.end === next.end &&
        !current.held
          ? current
          : next,
      );
      setNote("");
    };

    const finish = (event: Event) => {
      if (coarse()) return;
      const target = event.target;
      if (target instanceof Element && target.closest("[data-selection-menu]")) return;
      const point = event instanceof PointerEvent ? event : null;
      const moved = point ? Math.hypot(point.clientX - originX, point.clientY - originY) > 10 : false;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const selected = readSelection();
        if (selected) {
          setPick(capture(selected));
          setNote("");
          return;
        }
        if (moved) return;
        setPick(null);
        setNote("");
      }, 60);
    };

    const onPointerDown = (event: Event) => {
      if (coarse()) return;
      window.clearTimeout(timer);
      if (event instanceof PointerEvent) {
        originX = event.clientX;
        originY = event.clientY;
      }
    };

    const onArticleDown = (event: PointerEvent) => {
      if (!coarse()) return;
      const target = event.target;
      if (target instanceof Element && (target.closest("[data-selection-menu]") || target.closest("[data-excerpt-menu]"))) return;
      const savedMark = target instanceof Element ? target.closest("[data-excerpt]") : null;
      const handle = target instanceof Element ? target.closest("[data-selection-handle]") : null;
      window.clearTimeout(press);
      originX = event.clientX;
      originY = event.clientY;
      pointX = originX;
      pointY = originY;
      pointerId = event.pointerId;
      if (handle) {
        event.preventDefault();
        const heldPick = pickRef.current;
        sectionId = heldPick?.sectionId ?? "";
        currentStart = heldPick?.start ?? 0;
        currentEnd = heldPick?.end ?? 0;
        anchorStart = currentStart;
        anchorEnd = currentEnd;
        edge = handle.getAttribute("data-selection-handle") === "start" ? "start" : "end";
        selecting = true;
        if (article) {
          article.style.touchAction = "none";
          try {
            article.setPointerCapture(pointerId);
          } catch {
            /* the pointer may already be gone */
          }
        }
        return;
      }
      if (!(target instanceof Node) || !article?.contains(target)) return;
      selecting = false;
      edge = null;
      pendingMark = savedMark?.getAttribute("data-excerpt") ?? "";
      press = window.setTimeout(() => {
        pendingMark = "";
        setOpened(null);
        const spot = spotAt(originX, originY);
        if (!spot) return;
        const section = work.sections.find((item) => item.id === spot.sectionId);
        if (!section) return;
        const word = wordSpan(section.text, spot.offset);
        if (word.end <= word.start) return;
        sectionId = spot.sectionId;
        anchorStart = word.start;
        anchorEnd = word.end;
        currentStart = word.start;
        currentEnd = word.end;
        edge = "anchor";
        selecting = true;
        if (article) {
          article.style.touchAction = "none";
          try {
            article.setPointerCapture(pointerId);
          } catch {
            /* the pointer may already be gone */
          }
        }
        window.getSelection()?.removeAllRanges();
        const range = rangeForOffsets(sectionId, word.start, word.end);
        if (range) paint(range, true);
      }, 320);
    };

    const onArticleMove = (event: PointerEvent) => {
      if (!coarse()) return;
      pointX = event.clientX;
      pointY = event.clientY;
      if (!selecting) {
        if (Math.hypot(pointX - originX, pointY - originY) > 10) window.clearTimeout(press);
        return;
      }
      event.preventDefault();
      if (frame) return;
      frame = window.requestAnimationFrame(extend);
    };

    const onArticleUp = (event: PointerEvent) => {
      if (!coarse()) return;
      window.clearTimeout(press);
      if (article) article.style.touchAction = "";
      const moved = Math.hypot(event.clientX - originX, event.clientY - originY) > 10;
      const wasSelecting = selecting;
      selecting = false;
      if (wasSelecting) {
        pendingMark = "";
        setPick((current) => (current?.held ? { ...current, choosing: false } : current));
        return;
      }
      if (pendingMark && !moved) {
        const id = pendingMark;
        pendingMark = "";
        const node = document.querySelector(`[data-excerpt="${CSS.escape(id)}"]`);
        const rect = node?.getBoundingClientRect();
        const excerpt = usePrefs.getState().excerpts.find((item) => item.id === id) ?? null;
        setPick(null);
        setOpened(excerpt);
        setOpenedAt(excerpt && rect ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null);
        return;
      }
      pendingMark = "";
      if (moved) return;
      if (event.target instanceof Element && (event.target.closest("[data-selection-menu]") || event.target.closest("[data-excerpt-menu]") || event.target.closest("[data-selection-handle]") || event.target.closest("#live-excerpt"))) return;
      setPick(null);
      setOpened(null);
      setOpenedAt(null);
    };

    const blockMenu = (event: Event) => {
      if (coarse()) event.preventDefault();
    };

    const blockScroll = (event: TouchEvent) => {
      if (selecting) event.preventDefault();
    };

    document.addEventListener("selectionchange", onSelection);
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("pointerdown", onArticleDown);
    document.addEventListener("pointermove", onArticleMove);
    document.addEventListener("pointerup", onArticleUp);
    document.addEventListener("pointercancel", onArticleUp);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
    article?.addEventListener("contextmenu", blockMenu);
    article?.addEventListener("selectstart", blockMenu);
    const onClick = (event: MouseEvent) => {
      if (coarse()) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const mark = target.closest("[data-excerpt]");
      if (!mark || window.getSelection()?.toString().trim()) return;
      const id = mark.getAttribute("data-excerpt") ?? "";
      const excerpt = usePrefs.getState().excerpts.find((item) => item.id === id) ?? null;
      if (!excerpt) return;
      event.preventDefault();
      const rect = mark.getBoundingClientRect();
      setPick(null);
      setOpened(excerpt);
      setOpenedAt({ top: rect.top, bottom: rect.bottom, left: rect.left });
    };
    article?.addEventListener("click", onClick);
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(press);
      window.cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointerdown", onArticleDown);
      document.removeEventListener("pointermove", onArticleMove);
      document.removeEventListener("pointerup", onArticleUp);
      document.removeEventListener("pointercancel", onArticleUp);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      article?.removeEventListener("contextmenu", blockMenu);
      article?.removeEventListener("selectstart", blockMenu);
      article?.removeEventListener("click", onClick);
      document.removeEventListener("touchmove", blockScroll);
      if (article) article.style.touchAction = "";
    };
  }, [work]);

  useEffect(() => {
    if (!pick?.held) return;
    const sectionId = pick.sectionId;
    const start = pick.start;
    const end = pick.end;
    const move = () => {
      const rects = selectionRects(sectionId, start, end);
      if (!rects.length) return;
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      const left = rects[0].left;
      setPick((current) => (current?.held ? { ...current, top, bottom, left } : current));
    };
    window.addEventListener("scroll", move, true);
    window.visualViewport?.addEventListener("scroll", move);
    window.visualViewport?.addEventListener("resize", move);
    return () => {
      window.removeEventListener("scroll", move, true);
      window.visualViewport?.removeEventListener("scroll", move);
      window.visualViewport?.removeEventListener("resize", move);
    };
  }, [pick?.held, pick?.sectionId, pick?.start, pick?.end]);

  useEffect(() => () => window.clearTimeout(fadeTimer.current), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function fadeMenus() {
    setFading(true);
    window.clearTimeout(fadeTimer.current);
    fadeTimer.current = window.setTimeout(() => {
      setPick(null);
      setOpened(null);
      setOpenedAt(null);
      setNote("");
      setFading(false);
    }, 180);
  }

  async function copyText(text: string) {
    fadeMenus();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.left = "-9999px";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } catch {
        area.remove();
        setToast("Could not copy");
        return;
      }
      area.remove();
    }
    setToast("Copied");
  }

  async function share(text: string, heading = pick?.heading, page = pick?.page) {
    fadeMenus();
    const citation = formatCitation(text, work.author, work.title, heading, page);
    const result = await sharePassage({ title: work.title, text: citation });
    if (result === "unavailable") setSheet({ title: work.title, citation });
  }

  function save(current: Pick) {
    const excerpt: Excerpt = {
      id: `ex-${Date.now().toString(36)}`,
      workId: work.id,
      sectionId: current.sectionId,
      heading: current.heading,
      text: current.text,
      start: current.start,
      end: current.end,
      created: Date.now(),
      title: work.title,
      creator: work.author,
      source: work.edition,
      page: current.page,
    };
    void addExcerpt(excerpt).then(
      () => {
        fadeMenus();
        setToast("Excerpt saved");
      },
      () => {
        fadeMenus();
        setToast("Could not save the excerpt");
      },
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" search={{ q: query, w: "", lang: "", author: "", form: "", period: "", genre: "" }} className="text-sm text-accent">
          / Whole library
        </Link>
        <div className="mt-3 flex items-start gap-4">
          {cover ? (
            <img
              src={cover}
              alt=""
              className="h-40 w-28 shrink-0 rounded-md border border-line object-cover sm:h-48 sm:w-32"
              onError={(event) => event.currentTarget.remove()}
            />
          ) : null}
          <div className="min-w-0">
            <Link to="/library/$workId" params={{ workId: work.id }} className="block font-serif text-3xl text-ink">
              {work.title}
            </Link>
            <p className="mt-1 text-sm text-muted">
              {listOf(work.author).map((name, index) => (
                <span key={name}>
                  {index ? "; " : ""}
                  <Link to="/personas/$slug" params={{ slug: personaSlug(name) }} className="text-ink">
                    {preferLabel([name])}
                  </Link>
                </span>
              ))}
              {" · "}
              {work.genre} · {work.form} · {work.period} · {work.language}
            </p>
            <p className="mt-1 text-sm text-muted">{work.edition}</p>
            {work.series ? (
              <Link to="/series/$seriesId" params={{ seriesId: work.series.id }} className="mt-1 block text-sm text-accent">
                {work.series.title}, volume {work.series.volume}
              </Link>
            ) : null}
            <FindInVolume id="find-reader" query={query} onFind={onFind} />
          </div>
        </div>
      </div>
      {sections.length > 80 ? (
        <details className="border-b border-line">
          <summary className="flex h-11 cursor-pointer items-center text-sm text-ink">Contents</summary>
          <div className="pb-3">
            <ChapterFinder
              chapters={sections}
              onOpen={(id) => {
                const index = sections.findIndex((item) => item.id === id);
                reveal(index, id);
              }}
            />
          </div>
        </details>
      ) : sections.length > 1 ? (
        <details className="border-b border-line">
          <summary className="flex h-11 cursor-pointer items-center text-sm text-ink">Contents</summary>
          <ol className="max-h-64 overflow-auto pb-3">
            {sections.map((section) => (
              <li key={section.id}>
                <button
                  type="button"
                  className="flex h-10 w-full items-center text-left text-sm text-ink"
                  onClick={() => {
                    const index = sections.findIndex((item) => item.id === section.id);
                    reveal(index, section.id);
                  }}
                >
                  {section.heading}
                </button>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className={jumps.length || query ? "flex flex-col gap-6 lg:grid lg:grid-cols-[16rem_1fr] lg:items-start" : ""}>
      {jumps.length || query ? (
      <aside className="lg:sticky lg:top-20">
        {jumps.length ? (
          <JumpList
            jumps={jumps}
            current={currentJump?.id ?? ""}
            onPick={(index) => {
              sought.current = "";
              setMatchPick(index);
            }}
          />
        ) : (
          <p className="text-sm text-muted">{hit ? "No match in this volume." : "Searching this volume…"}</p>
        )}
      </aside>
      ) : (
        <p className="text-sm text-muted">Select any passage to save or share it.</p>
      )}
      <article
        ref={articleRef}
        className={cn("folio-read mx-auto w-full max-w-[42rem] min-w-0 select-text", jumps.length > 0 && "pb-16")}
      >
        {bounds.from > 0 ? <div data-read-head className="h-px" /> : null}
        {visible.map((section) => {
          const found = bySection.get(section.id);
          const known = found?.bodyHits ?? [];
          const bodyHits =
            aim && aim.sectionId === section.id && !known.includes(aim.token)
              ? [...known, aim.token].sort((a, b) => a - b)
              : known;
          const headingHits = found?.headingHits ?? [];
          const saved = focus?.sectionId === section.id;
          const live = Boolean(pick?.held && pick.sectionId === section.id);
          const tokens = bodyHits.length ? tokenize(section.text) : [];
          const headingTokens = headingHits.length ? tokenize(section.heading) : [];
          const meaning = parseMeaning(at);
          const landed =
            meaning && meaning.sectionId === section.id && section.text
              ? originalSpan(section.text, meaning.start, meaning.end)
              : null;
          const headingKin = kinIndexes(headingTokens, headingHits, query, "", stem, concept && wordsReady);
          const kin = kinIndexes(tokens, bodyHits, query, "", stem, concept && wordsReady);
          const anchors = new Map<number, string>();
          for (const group of clusters(bodyHits)) {
            anchors.set(group[0], anchorId(section.id, group[0]));
          }
          if (aim && aim.sectionId === section.id) anchors.set(aim.token, anchorId(section.id, aim.token));
          const taken = new Set<string>();
          // A held selection is drawn by SelectionHighlight, not spliced into the
          // line. Wrapping the words in a <mark> (or giving that mark padding)
          // changes their width, so the letters jump while the finger moves.
          const marked = withSavedRange(
            withSavedMarks(
              readerSegments(section.text, tokens, bodyHits, kin),
              mine
                .filter((excerpt) => excerpt.sectionId === section.id)
                .map((excerpt) => ({
                  start: excerpt.start,
                  end: excerpt.end,
                  id: excerpt.id,
                  anchor: `saved-${excerpt.sectionId}-${excerpt.start}-${excerpt.end}`,
                })),
            ),
            !live && saved && focus ? focus.start : 0,
            !live && saved && focus ? focus.end : 0,
          );
          const spans = pageSpans(section.text, section.pages);
          const lined = landed ? withMeanLine(marked, landed.start, landed.end) : marked;
          const laidOut =
            work.format === "text/x-folio-lines" ||
            work.format === "text/x-folio-code" ||
            work.format === "text/x-folio-table";
          const verse = work.form === "Verse" || work.format === "text/x-folio-lines";
          const mono = work.format === "text/x-folio-code" || work.format === "text/x-folio-table";
          return (
            <section key={section.id} id={section.id} data-section={section.id} data-heading={section.heading} className="hit-anchor scroll-mt-20 border-t border-line py-6">
              <Passage
                as="h2"
                segments={readerSegments(section.heading, headingTokens, headingHits, headingKin)}
                className="text-xl"
              />
              <div data-body>
                {section.text ? (
                spans.map((span) => (
                  <div key={`${section.id}-${span.start}`}>
                    {span.label ? (
                      <p data-page-chrome className="mt-6 mb-2 select-none text-xs tracking-wide text-muted">
                        p. {span.label}
                      </p>
                    ) : null}
                    <div data-part className={mono ? "overflow-x-auto" : undefined}>
                      <Passage
                        segments={sliceSegments(lined, span.start, span.end)}
                        anchors={anchors}
                        taken={taken}
                        pin={
                          at && landed && landed.start >= span.start && landed.start < span.end
                            ? { at: landed.start - span.start, id: at }
                            : undefined
                        }
                        savedId={
                          live && pick && pick.start >= span.start && pick.start < span.end
                            ? "live-excerpt"
                            : saved && focus.start >= span.start && focus.start < span.end
                              ? `saved-${section.id}`
                              : undefined
                        }
                        className={cn(
                          laidOut
                            ? mono
                              ? "mt-3 whitespace-pre-wrap font-mono text-sm leading-relaxed"
                              : "mt-3 whitespace-pre-wrap"
                            : "mt-3",
                          verse && "leading-8",
                        )}
                      />
                    </div>
                  </div>
                ))
                ) : (
                  <p className="mt-3 font-serif text-lg text-muted">Opening this part…</p>
                )}
              </div>
            </section>
          );
        })}
        {bounds.to < sections.length ? <div data-read-tail className="h-px" /> : null}
      </article>
      </div>
      {pick?.held ? <SelectionHighlight sectionId={pick.sectionId} start={pick.start} end={pick.end} /> : null}
      {pick?.held && !fading ? <SelectionHandles sectionId={pick.sectionId} start={pick.start} end={pick.end} /> : null}
      {pick && !pick.choosing ? (
        <SelectionMenu
          pick={pick}
          note={note}
          fading={fading}
          onSave={() => save(pick)}
          onCopy={() =>
            void copyText(formatCitation(pick.text, work.author, work.title, pick.heading, pick.page))
          }
          onShare={() => void share(pick.text)}
        />
      ) : null}
      {opened && openedAt ? (
        <div
          data-excerpt-menu
          className={cn(
            "fixed z-[70] flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-1 transition-opacity duration-200",
            fading ? "pointer-events-none opacity-0" : "opacity-100",
          )}
          style={menuStyle(
            {
              sectionId: opened.sectionId,
              heading: opened.heading,
              text: opened.text,
              start: opened.start,
              end: opened.end,
              top: openedAt.top,
              bottom: openedAt.bottom,
              left: openedAt.left,
              held: true,
            },
            280,
            52,
          )}
          onPointerDown={(event) => event.preventDefault()}
        >
          <button
            type="button"
            onClick={() =>
              void copyText(formatCitation(opened.text, work.author, work.title, opened.heading, opened.page))
            }
            className="h-11 px-3 text-sm text-ink"
          >
            Copy
          </button>
          <button type="button" onClick={() => void share(opened.text, opened.heading, opened.page)} className="h-11 px-3 text-sm text-accent">
            Share
          </button>
          <button
            type="button"
            onClick={() => {
              removeExcerpt(opened.id);
              fadeMenus();
            }}
            className="h-11 px-3 text-sm text-muted"
          >
            Remove
          </button>
        </div>
      ) : null}
      {sheet ? (
        <ShareDialog title={sheet.title} citation={sheet.citation} onClose={() => setSheet(null)} />
      ) : null}
      {jumps.length ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4">
          <div className="pointer-events-auto flex items-center gap-1 rounded-md border border-line bg-surface p-1">
            <button
              type="button"
              disabled={matchAt <= 0}
              onClick={() => {
                sought.current = "";
                setMatchPick(matchAt - 1);
              }}
              className="h-11 px-3 text-sm text-ink disabled:text-muted"
            >
              Previous
            </button>
            <span className="px-2 text-sm text-muted">
              {matchAt + 1} of {jumps.length}
            </span>
            <button
              type="button"
              disabled={matchAt >= jumps.length - 1}
              onClick={() => {
                sought.current = "";
                setMatchPick(matchAt + 1);
              }}
              className="h-11 px-3 text-sm text-ink disabled:text-muted"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
      {toast ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-[calc(8.5rem+env(safe-area-inset-bottom))] z-[80] flex justify-center px-4">
          <p role="status" className="folio-toast rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink">
            {toast}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function FindInVolume({ id, query, onFind }: { id: string; query: string; onFind: (query: string) => void }) {
  const [draft, setDraft] = useState(query);
  useEffect(() => setDraft(query), [query]);
  return (
    <form
      className="mt-3 flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        onFind(draft.trim());
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Find in this volume
      </label>
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Find in this volume"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
      />
      <button type="submit" className="h-11 shrink-0 rounded-md border border-line px-3 text-sm">
        Find
      </button>
    </form>
  );
}

function selectionRects(sectionId: string, start: number, end: number): DOMRect[] {
  const range = rangeForOffsets(sectionId, start, end);
  if (!range) return [];
  return [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
}

/** Highlight rects over the glyphs. The text nodes stay whole, so the line does not reflow. */
function SelectionHighlight({ sectionId, start, end }: { sectionId: string; start: number; end: number }) {
  const [rects, setRects] = useState<DOMRect[]>([]);
  useLayoutEffect(() => {
    const measure = () => {
      const next = selectionRects(sectionId, start, end);
      setRects((current) =>
        current.length === next.length &&
        current.every((rect, index) => {
          const other = next[index];
          return (
            !!other &&
            Math.abs(rect.top - other.top) < 0.5 &&
            Math.abs(rect.left - other.left) < 0.5 &&
            Math.abs(rect.width - other.width) < 0.5 &&
            Math.abs(rect.height - other.height) < 0.5
          );
        })
          ? current
          : next,
      );
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("scroll", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("scroll", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [sectionId, start, end]);
  return rects.map((rect, index) => (
    <div
      key={index}
      aria-hidden
      className="pointer-events-none fixed z-[1] bg-mark/45"
      style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
    />
  ));
}

function SelectionHandles({ sectionId, start, end }: { sectionId: string; start: number; end: number }) {
  const [boxes, setBoxes] = useState<{ first: DOMRect; last: DOMRect } | null>(null);
  const place = () => {
    const rects = selectionRects(sectionId, start, end);
    if (!rects.length) return;
    const first = rects[0];
    const last = rects[rects.length - 1];
    setBoxes((current) =>
      current &&
      Math.abs(current.first.left - first.left) < 0.5 &&
      Math.abs(current.first.bottom - first.bottom) < 0.5 &&
      Math.abs(current.last.right - last.right) < 0.5 &&
      Math.abs(current.last.bottom - last.bottom) < 0.5
        ? current
        : { first, last },
    );
  };
  useLayoutEffect(() => {
    place();
  }, [sectionId, start, end]);
  useEffect(() => {
    const measure = () => place();
    window.addEventListener("scroll", measure, true);
    window.visualViewport?.addEventListener("scroll", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.visualViewport?.removeEventListener("scroll", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [sectionId, start, end]);
  if (!boxes) return null;
  const knob = (edge: "start" | "end", rect: DOMRect, side: "left" | "right") => (
    <div
      data-selection-handle={edge}
      className="fixed z-[71] h-11 w-11 touch-none"
      style={{ top: rect.bottom - 6, left: side === "left" ? rect.left - 22 : rect.right - 22 }}
    >
      <span className="pointer-events-none absolute left-1/2 top-1 h-3.5 w-0.5 -translate-x-1/2 bg-accent" />
      <span className="pointer-events-none absolute left-1/2 top-4 h-5 w-5 -translate-x-1/2 rounded-full border-2 border-accent bg-accent" />
    </div>
  );
  return (
    <>
      {knob("start", boxes.first, "left")}
      {knob("end", boxes.last, "right")}
    </>
  );
}
function SelectionActions({
  note,
  page,
  onCopy,
  onSave,
  onShare,
}: {
  note: string;
  page?: string;
  onCopy: () => void;
  onSave: () => void;
  onShare: () => void;
}) {
  return (
    <>
      {page ? <span className="px-2 text-sm text-muted">p. {page}</span> : null}
      <button type="button" onClick={onCopy} className="h-11 px-3 text-sm text-ink">
        Copy
      </button>
      <button type="button" onClick={onSave} className="h-11 px-3 text-sm text-ink">
        Save excerpt
      </button>
      <button type="button" onClick={onShare} className="h-11 px-3 text-sm text-accent">
        Share
      </button>
      {note ? <span className="px-2 text-sm text-muted">{note}</span> : null}
    </>
  );
}

function SelectionMenu({
  pick,
  note,
  fading,
  onCopy,
  onSave,
  onShare,
}: {
  pick: Pick;
  note: string;
  fading?: boolean;
  onCopy: () => void;
  onSave: () => void;
  onShare: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    setBox((current) => (current.width === width && current.height === height ? current : { width, height }));
  });
  return (
    <div
      ref={ref}
      data-selection-menu
      className={cn(
        "fixed z-[70] flex max-w-[calc(100vw-1rem)] flex-wrap items-center gap-1 rounded-md border border-line bg-surface p-1 transition-opacity duration-200",
        fading ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      style={menuStyle(pick, box.width, box.height)}
      onPointerDown={(event) => event.preventDefault()}
    >
      <SelectionActions note={note} page={pick.page} onCopy={onCopy} onSave={onSave} onShare={onShare} />
    </div>
  );
}

function viewportPads(): { top: number; right: number; bottom: number; left: number } {
  const probe = document.getElementById("folio-safe") ?? document.body.appendChild(document.createElement("div"));
  probe.id = "folio-safe";
  probe.style.cssText =
    "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;width:env(safe-area-inset-left);height:env(safe-area-inset-top);border-style:solid;border-color:transparent;border-right-width:env(safe-area-inset-right);border-bottom-width:env(safe-area-inset-bottom)";
  const rect = probe.getBoundingClientRect();
  const style = getComputedStyle(probe);
  return {
    top: rect.height,
    left: rect.width,
    right: Number.parseFloat(style.borderRightWidth) || 0,
    bottom: Number.parseFloat(style.borderBottomWidth) || 0,
  };
}

function menuStyle(pick: Pick, width: number, height: number): { top: number; left: number } {
  const vv = window.visualViewport;
  const originTop = vv?.offsetTop ?? 0;
  const originLeft = vv?.offsetLeft ?? 0;
  const viewW = vv?.width ?? window.innerWidth;
  const viewH = vv?.height ?? window.innerHeight;
  const nav = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--vv-nav") || "56") || 56;
  const safe = viewportPads();
  const pad = 8;
  const menuWidth = width || Math.min(280, viewW - pad * 2);
  const menuHeight = height || 52;
  const minLeft = originLeft + Math.max(pad, safe.left);
  const maxLeft = originLeft + viewW - menuWidth - Math.max(pad, safe.right);
  const left = Math.max(minLeft, Math.min(pick.left, Math.max(minLeft, maxLeft)));
  const minTop = originTop + Math.max(pad, safe.top);
  const maxTop = Math.max(minTop, originTop + viewH - nav - Math.max(pad, safe.bottom) - menuHeight);
  const above = pick.top - menuHeight - pad;
  const below = pick.bottom + pad;
  const fits = (value: number) => value >= minTop && value <= maxTop;
  let top = pick.held ? below : above;
  if (!fits(top)) {
    const other = top === below ? above : below;
    top = fits(other) ? other : top;
  }
  if (top > maxTop) top = maxTop;
  if (top < minTop) top = minTop;
  return { top, left };
}

function JumpList({
  jumps,
  current,
  onPick,
}: {
  jumps: { id: string; sectionId: string; heading: string }[];
  current: string;
  onPick: (index: number) => void;
}) {
  const found = current ? jumps.findIndex((jump) => jump.id === current) : 0;
  const origin = found >= 0 ? found : 0;
  const [before, setBefore] = useState(8);
  const [after, setAfter] = useState(32);
  const from = Math.max(0, origin - before);
  const to = Math.min(jumps.length, origin + after);
  return (
    <div>
      <p className="mb-1 text-xs text-muted">
        {jumps.length} {jumps.length === 1 ? "match" : "matches"}
      </p>
      {from > 0 ? (
        <button type="button" className="h-10 text-sm text-accent" onClick={() => setBefore((count) => count + 40)}>
          {from} earlier
        </button>
      ) : null}
      <ol className="flex max-h-64 flex-col gap-1 overflow-auto lg:max-h-[70vh]">
        {jumps.slice(from, to).map((jump, offset) => (
          <li key={jump.id}>
            <button
              type="button"
              className={cn(
                "flex h-10 w-full items-center gap-2 text-left text-sm",
                jump.id === current ? "text-accent" : "text-ink",
              )}
              onClick={() => onPick(from + offset)}
            >
              <span className="text-muted">{from + offset + 1}</span>
              <span className="truncate">{jump.heading}</span>
            </button>
          </li>
        ))}
      </ol>
      {to < jumps.length ? (
        <button type="button" className="h-10 text-sm text-accent" onClick={() => setAfter((count) => count + 40)}>
          {jumps.length - to} later
        </button>
      ) : null}
    </div>
  );
}

function locate(at?: string): { sectionId: string; anchor: string } | null {
  if (!at) return null;
  const meaning = parseMeaning(at);
  if (meaning) return { sectionId: meaning.sectionId, anchor: at };
  const excerpt = parseAt(at);
  if (excerpt) return { sectionId: excerpt.sectionId, anchor: `saved-${excerpt.sectionId}-${excerpt.start}-${excerpt.end}` };
  if (at.startsWith("m-")) {
    const body = at.slice(2);
    const cut = body.lastIndexOf("-");
    if (cut > 0 && /^\d+$/.test(body.slice(cut + 1))) {
      return { sectionId: body.slice(0, cut), anchor: at };
    }
  }
  return { sectionId: at, anchor: at };
}

function spanAround(length: number, index: number): { from: number; to: number } {
  const origin = index >= 0 ? index : 0;
  return { from: Math.max(0, origin), to: Math.min(length, origin + 3) };
}

function savedIndex(workId: string, sections: { id: string }[]): number {
  const saved = storedPlace(workId);
  if (!saved) return -1;
  return sections.findIndex((section) => section.id === saved.sectionId);
}

function parseAt(at?: string): { sectionId: string; start: number; end: number } | null {
  if (!at) return null;
  const match = /^(.*):(\d+):(\d+)$/.exec(at);
  if (!match) return null;
  return { sectionId: match[1], start: Number(match[2]), end: Number(match[3]) };
}

function readSelection(): Pick | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  return describeRange(selection.getRangeAt(0));
}

function describeRange(range: Range): Pick | null {
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  const section = element?.closest("section[data-section]");
  const body = section?.querySelector("[data-body]");
  if (!section || !body) return null;
  const measured = measureParts(body, range);
  if (!measured) return null;
  const raw = measured.text;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 1) return null;
  const leading = raw.length - raw.trimStart().length;
  const trimmed = raw.trim();
  const rect = range.getBoundingClientRect();
  return {
    sectionId: section.getAttribute("data-section") ?? "",
    heading: section.getAttribute("data-heading") ?? "",
    text: text.length === trimmed.replace(/\s+/g, " ").length ? trimmed : text,
    start: measured.start + leading,
    end: measured.start + leading + trimmed.length,
    top: rect.top,
    bottom: rect.bottom,
    left: rect.left,
  };
}

function spotAt(x: number, y: number): { sectionId: string; offset: number } | null {
  const stack = document.elementsFromPoint(x, y);
  let hit: Element | null = null;
  for (const node of stack) {
    if (node.closest("[data-selection-handle], [data-selection-menu], [data-excerpt-menu]")) continue;
    hit = node;
    break;
  }
  const part = hit?.closest("[data-part]");
  const section = part?.closest("section[data-section]");
  const body = section?.querySelector("[data-body]");
  if (!part || !section || !body) return null;
  let base = 0;
  for (const item of body.querySelectorAll("[data-part]")) {
    if (item === part) break;
    base += item.textContent?.length ?? 0;
  }
  const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let node: Node | null = walker.nextNode();
  while (node) {
    const text = node as Text;
    const full = document.createRange();
    full.selectNodeContents(text);
    const onLine = [...full.getClientRects()].some((rect) => y >= rect.top - 8 && y <= rect.bottom + 8 && x >= rect.left - 16 && x <= rect.right + 16);
    if (onLine) {
      return { sectionId: section.getAttribute("data-section") ?? "", offset: base + cursor + offsetInText(text, x, y) };
    }
    cursor += text.data.length;
    node = walker.nextNode();
  }
  return null;
}

/** The finger sits on the knob, below the line. Sample the letters above it. */
function spotForHandle(edge: "start" | "end", x: number, y: number): { sectionId: string; offset: number } | null {
  const dx = edge === "start" ? 16 : -16;
  for (const lift of [32, 18, 48, 6]) {
    const spot = spotAt(x + dx, y - lift);
    if (spot) return spot;
  }
  return spotAt(x, y);
}

function offsetInText(text: Text, x: number, y: number): number {
  let lo = 0;
  let hi = text.data.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const probe = document.createRange();
    probe.setStart(text, mid);
    probe.collapse(true);
    const rect = probe.getBoundingClientRect();
    if (rect.top > y + 2) hi = mid;
    else if (rect.bottom < y - 2) lo = mid + 1;
    else if (rect.left <= x) lo = mid + 1;
    else hi = mid;
  }
  return Math.max(0, Math.min(text.data.length - 1, lo > 0 ? lo - 1 : 0));
}

function wordSpan(text: string, offset: number): { start: number; end: number } {
  let start = Math.min(Math.max(offset, 0), text.length);
  let end = start;
  const word = (ch: string) => /[\p{L}\p{N}'’]/u.test(ch);
  while (start > 0 && word(text[start - 1] ?? "")) start -= 1;
  while (end < text.length && word(text[end] ?? "")) end += 1;
  return { start, end };
}

function rangeForOffsets(sectionId: string, start: number, end: number): Range | null {
  const section = document.getElementById(sectionId);
  const body = section?.querySelector("[data-body]");
  if (!body) return null;
  const from = Math.max(0, Math.min(start, end));
  const to = Math.max(start, end);
  let cursor = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  for (const part of body.querySelectorAll("[data-part]")) {
    const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const text = node as Text;
      const next = cursor + text.data.length;
      if (!startNode && from <= next) {
        startNode = text;
        startOff = Math.max(0, from - cursor);
      }
      if (to <= next) {
        endNode = text;
        endOff = Math.max(0, to - cursor);
        break;
      }
      cursor = next;
      node = walker.nextNode();
    }
    if (endNode) break;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  try {
    range.setStart(startNode, Math.min(startOff, startNode.data.length));
    range.setEnd(endNode, Math.min(endOff, endNode.data.length));
  } catch {
    return null;
  }
  return range.collapsed ? null : range;
}

function measureParts(body: Element, range: Range): { text: string; start: number; end: number } | null {
  const parts = [...body.querySelectorAll("[data-part]")];
  if (!parts.length) return null;
  let offset = 0;
  let start: number | null = null;
  let end: number | null = null;
  let text = "";
  for (const part of parts) {
    const content = part.textContent ?? "";
    let intersects = false;
    try {
      intersects = range.intersectsNode(part);
    } catch {
      intersects = false;
    }
    if (!intersects) {
      if (start == null) offset += content.length;
      continue;
    }
    let from = 0;
    let to = content.length;
    if (part.contains(range.startContainer)) {
      const before = document.createRange();
      before.selectNodeContents(part);
      before.setEnd(range.startContainer, range.startOffset);
      from = before.toString().length;
    }
    if (part.contains(range.endContainer)) {
      const before = document.createRange();
      before.selectNodeContents(part);
      before.setEnd(range.endContainer, range.endOffset);
      to = before.toString().length;
    }
    if (to < from) to = from;
    if (start == null) start = offset + from;
    end = offset + to;
    text += content.slice(from, to);
    offset += content.length;
  }
  if (start == null || end == null) return null;
  return { text, start, end };
}
