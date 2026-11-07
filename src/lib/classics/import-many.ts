import { yamlValue } from "../corpus/markup";
import { parseImport } from "../corpus/import";
import { WORKS } from "../corpus/works";
import { loadPersona } from "../persona/load";
import { commitImport, usePrefs } from "../prefs";
import { BETTER_SHELVES, fetchBetterBook, listBetterBooks, type BetterBook } from "./better";
import { CLASSICS, type ClassicWork } from "./shelf";
import { fetchClassicText } from "./fetch";
import type { Work } from "../corpus/types";

const CURSOR = "folio-classics-next";

export type ClassicProgress = {
  running: boolean;
  index: number;
  total: number;
  done: number;
  skipped: number;
  failed: number;
  author: string;
  title: string;
  note: string;
};

const listeners = new Set<() => void>();
let progress: ClassicProgress = {
  running: false,
  index: 0,
  total: CLASSICS.length,
  done: 0,
  skipped: 0,
  failed: 0,
  author: "",
  title: "",
  note: "",
};
let stop = false;
let task: Promise<void> | null = null;

const VERSE = new Set([
  "Homer",
  "Hesiod",
  "Pindar",
  "Aeschylus",
  "Sophocles",
  "Euripides",
  "Aristophanes",
  "Apollonius of Rhodes",
  "Theocritus",
  "Virgil",
  "Horace",
  "Ovid",
  "Catullus",
  "Lucretius",
  "Juvenal",
  "Martial",
  "Persius",
  "Statius",
  "Tibullus",
  "Propertius",
  "Lucan",
]);

const LATE = new Set([
  "Augustine",
  "Boethius",
  "Ammianus Marcellinus",
  "Origen",
  "Clement of Alexandria",
  "Plotinus",
]);

function emit(patch: Partial<ClassicProgress>) {
  progress = { ...progress, ...patch };
  listeners.forEach((listener) => listener());
}

export function classicsSnapshot(): ClassicProgress {
  return progress;
}

export function subscribeClassics(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readPlace(): { shelf: number; page: number; skip: number; classics: number } {
  const start = { shelf: 0, page: 1, skip: 0, classics: 0 };
  try {
    const raw = localStorage.getItem(CURSOR);
    if (!raw) return start;
    const parsed = JSON.parse(raw) as { shelf?: number; page?: number; skip?: number; classics?: number };
    const shelf = Number(parsed.shelf);
    const page = Number(parsed.page);
    const skip = Number(parsed.skip);
    const classics = Number(parsed.classics);
    if (!Number.isInteger(shelf) || shelf < 0 || shelf > BETTER_SHELVES.length) return start;
    return {
      shelf,
      page: Number.isInteger(page) && page >= 1 ? page : 1,
      skip: Number.isInteger(skip) && skip >= 0 ? skip : 0,
      classics: Number.isInteger(classics) && classics >= 0 ? classics : 0,
    };
  } catch {
    return start;
  }
}

function writePlace(place: { shelf: number; page: number; skip: number; classics: number }) {
  try {
    localStorage.setItem(CURSOR, JSON.stringify(place));
  } catch {
    /* the run still continues in this session */
  }
}

function plainTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function onShelf(entry: ClassicWork): boolean {
  const id = `gutenberg-${entry.gutenberg}`;
  const title = plainTitle(entry.title);
  const surname = entry.author.split(" ").at(-1)?.toLowerCase() ?? "";
  const works = [...WORKS, ...usePrefs.getState().imports];
  return works.some((work) => {
    if (work.id === id || work.identifier === `gutenberg:${entry.gutenberg}`) return true;
    const have = plainTitle(work.title);
    const sameAuthor = work.author.toLowerCase().includes(surname);
    if (!sameAuthor || title.length < 6 || have.length < 6) return false;
    return have === title || have.startsWith(title) || title.startsWith(have);
  });
}

function markup(entry: ClassicWork, text: string): string {
  return [
    "---",
    `title: ${yamlValue(entry.title)}`,
    `creator: ${yamlValue(entry.author)}`,
    "language: English",
    `type: ${VERSE.has(entry.author) ? "Verse" : "Prose"}`,
    `coverage: ${LATE.has(entry.author) ? "Late antiquity" : "Classical"}`,
    "subject: Classical",
    `source: ${yamlValue(`Project Gutenberg ${entry.gutenberg}`)}`,
    "publisher: Project Gutenberg",
    "rights: Public domain.",
    `identifier: gutenberg:${entry.gutenberg}`,
    "relation: fetched from Project Gutenberg",
    "---",
    "",
    text,
  ].join("\n");
}

async function take(entry: { author: string; title: string; gutenberg: number }, work: Work): Promise<boolean> {
  const id = entry.gutenberg > 0 ? `gutenberg-${entry.gutenberg}` : work.id;
  if (entry.gutenberg > 0) {
    work.identifier = `gutenberg:${entry.gutenberg}`;
    work.id = id;
  }
  work.sections = work.sections.map((section, sectionIndex) => ({
    ...section,
    id: `${work.id}-s${sectionIndex + 1}`,
  }));
  emit({ note: `Indexing ${entry.title}…` });
  try {
    await commitImport(work);
    emit({ done: progress.done + 1 });
    return true;
  } catch {
    emit({ failed: progress.failed + 1, note: `${entry.title} could not be indexed.` });
    return false;
  }
}

async function run() {
  const seenAuthors = new Set<string>();
  const seen = new Set<string>();
  let failures = 0;
  let place = readPlace();

  while (place.shelf < BETTER_SHELVES.length) {
    if (stop) {
      emit({ running: false, note: `Paused on ${BETTER_SHELVES[place.shelf]}.` });
      return;
    }
    const slug = BETTER_SHELVES[place.shelf];
    emit({
      running: true,
      index: place.shelf,
      author: "Better Gutenberg",
      title: slug,
      note: `Better Gutenberg · ${slug.replace(/-/g, " ")} · page ${place.page}`,
    });
    let listed: { books: BetterBook[]; pages: number };
    try {
      listed = await listBetterBooks({ data: { slug, page: place.page } });
    } catch {
      listed = { books: [], pages: -1 };
    }
    if (listed.pages < 0) {
      failures += 1;
      emit({ failed: progress.failed + 1, note: "Better Gutenberg did not answer." });
      if (failures >= 5) {
        emit({ running: false, note: "Paused after Better Gutenberg did not answer." });
        return;
      }
      place = { ...place, page: place.page + 1, skip: 0 };
      writePlace(place);
      continue;
    }
    failures = 0;
    if (!listed.books.length || place.page > listed.pages) {
      place = { shelf: place.shelf + 1, page: 1, skip: 0, classics: place.classics };
      writePlace(place);
      continue;
    }
    const books = listed.books.slice(place.skip);
    for (let i = 0; i < books.length; i++) {
      if (stop) {
        emit({ running: false, note: `Paused on ${slug.replace(/-/g, " ")}.` });
        return;
      }
      const book = books[i];
      const key = book.gutenberg > 0 ? `gutenberg-${book.gutenberg}` : book.epub;
      emit({ author: book.author, title: book.title, note: `${book.author}, ${book.title}` });
      if (!seenAuthors.has(book.author)) {
        seenAuthors.add(book.author);
        await loadPersona(book.author, [book.title]).catch(() => null);
      }
      if (seen.has(key) || onShelf({ author: book.author, title: book.title, gutenberg: book.gutenberg || -1 })) {
        emit({ skipped: progress.skipped + 1, note: `Already on the shelf: ${book.title}` });
      } else {
        seen.add(key);
        let fetched: { work: Work } | { error: string };
        try {
          fetched = await fetchBetterBook({ data: { epub: book.epub } });
        } catch {
          fetched = { error: "That book could not be fetched." };
        }
        if ("error" in fetched) {
          failures += 1;
          emit({ failed: progress.failed + 1, note: fetched.error });
        } else {
          failures = 0;
          if (!fetched.work.author || fetched.work.author === "Unknown") fetched.work.author = book.author;
          if (!fetched.work.language) fetched.work.language = book.language;
          fetched.work.relation = "fetched from Better Gutenberg";
          await take({ author: book.author, title: book.title, gutenberg: book.gutenberg }, fetched.work);
        }
      }
      place = { ...place, skip: place.skip + 1 };
      writePlace(place);
      if (failures >= 5) {
        emit({ running: false, note: "Paused after several books could not be fetched." });
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    place = { ...place, page: place.page + 1, skip: 0 };
    writePlace(place);
  }

  let index = place.classics;
  while (index < CLASSICS.length) {
    if (stop) {
      emit({ running: false, note: `Paused at ${index} of ${CLASSICS.length} specialist texts.` });
      return;
    }
    const entry = CLASSICS[index];
    emit({
      running: true,
      index,
      author: entry.author,
      title: entry.title,
      note: `${index + 1} of ${CLASSICS.length} still fetched from Project Gutenberg: ${entry.title}`,
    });
    if (!seenAuthors.has(entry.author)) {
      seenAuthors.add(entry.author);
      await loadPersona(entry.author, [entry.title]).catch(() => null);
    }
    if (onShelf(entry)) {
      index += 1;
      place = { ...place, classics: index };
      writePlace(place);
      emit({ index, skipped: progress.skipped + 1, note: `Already on the shelf: ${entry.title}` });
      continue;
    }
    let fetched: { text: string } | { error: string };
    try {
      fetched = await fetchClassicText({ data: { gutenberg: entry.gutenberg } });
    } catch {
      fetched = { error: "The text could not be fetched." };
    }
    if ("error" in fetched) {
      failures += 1;
      index += 1;
      place = { ...place, classics: index };
      writePlace(place);
      emit({ index, failed: progress.failed + 1, note: fetched.error });
      if (failures >= 5) {
        emit({ running: false, note: "Paused after several texts could not be fetched." });
        return;
      }
      continue;
    }
    failures = 0;
    const parsed = parseImport(markup(entry, fetched.text), entry.title);
    if ("error" in parsed) {
      index += 1;
      place = { ...place, classics: index };
      writePlace(place);
      emit({ index, failed: progress.failed + 1, note: parsed.error });
      continue;
    }
    await take(entry, parsed);
    index += 1;
    place = { ...place, classics: index };
    writePlace(place);
    emit({ index });
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  emit({
    running: false,
    index: CLASSICS.length,
    total: CLASSICS.length,
    author: "",
    title: "",
    note: `Finished. ${progress.done} added, ${progress.skipped} already on the shelf, ${progress.failed} not fetched.`,
  });
}

export function startClassics(): void {
  if (progress.running) return;
  stop = false;
  const place = readPlace();
  const finished = place.shelf >= BETTER_SHELVES.length && place.classics >= CLASSICS.length;
  const next = finished ? { shelf: 0, page: 1, skip: 0, classics: 0 } : place;
  if (finished) writePlace(next);
  emit({
    running: true,
    index: next.shelf < BETTER_SHELVES.length ? next.shelf : next.classics,
    total: CLASSICS.length + BETTER_SHELVES.length,
    done: finished ? 0 : progress.done,
    skipped: finished ? 0 : progress.skipped,
    failed: finished ? 0 : progress.failed,
    note: "Starting from Better Gutenberg…",
  });
  task = run().finally(() => {
    task = null;
  });
}

export function pauseClassics(): void {
  stop = true;
  if (progress.running) emit({ note: "Stopping after this volume…" });
}
