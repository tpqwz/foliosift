import { classifyIdentifier, ID_FIELDS, storedIds } from "./ids.ts";
import type { PageMark, Section, Work } from "./types";

/** A section longer than this is cut on paragraph boundaries so one hit does not load a whole volume. */
const SECTION_CHARS = 6000;

const HEAD = /^\s{0,3}(#{1,3})\s+(.+?)\s*#*\s*$/;
const PAGE = /^(?::::+\s*\{?\s*page\s*\}?\s+|<!--\s*page:\s*)(\S(?:.*\S)?)\s*(?:-->)?\s*$/i;

const LANG: Record<string, string> = {
  en: "English",
  eng: "English",
  el: "Greek",
  gr: "Greek",
  grc: "Greek",
  la: "Latin",
  lat: "Latin",
  fr: "French",
  de: "German",
  it: "Italian",
  es: "Spanish",
};

function slug(value: string): string {
  const s = value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return s || "text";
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "string") return parsed;
    } catch {
      /* keep the slice below */
    }
    return trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1);
  return trimmed;
}

function parseFields(block: string): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    meta[match[1].toLowerCase()] = unquote(match[2]);
  }
  return meta;
}

function splitMeta(text: string): { meta: Record<string, string>; body: string } {
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").trim();
  if (src.startsWith("---\n")) {
    const end = src.indexOf("\n---", 3);
    if (end !== -1) return { meta: parseFields(src.slice(4, end)), body: src.slice(end + 4).trim() };
  }
  const fence = src.split("\n---\n");
  if (fence.length >= 2 && /^[A-Za-z][A-Za-z0-9_-]*:/m.test(fence[0]) && !fence[0].includes("\n\n")) {
    return { meta: parseFields(fence[0]), body: fence.slice(1).join("\n---\n").trim() };
  }
  return { meta: {}, body: src };
}

function pick(meta: Record<string, string>, ...keys: string[]): string {
  for (const key of keys) {
    const value = meta[key];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

function identifierFields(meta: Record<string, string>): { ids?: Work["ids"] } {
  const explicit: Work["ids"] = {};
  for (const key of ID_FIELDS) {
    const value = pick(meta, key === "openlibrary" ? "openlibrary" : key, key === "openlibrary" ? "ol" : key);
    if (value) explicit[key] = value;
  }
  if (pick(meta, "ol")) explicit.openlibrary = pick(meta, "openlibrary", "ol");
  const ids = storedIds({ ...classifyIdentifier(pick(meta, "identifier")), ...explicit });
  return ids ? { ids } : {};
}

function languagesFrom(raw: string): string {
  const parts = raw
    .split(/\s*;\s*/)
    .map((part) => labelLanguage(part))
    .filter(Boolean);
  return [...new Set(parts)].join("; ");
}

const TONGUES: [string, string[]][] = [
  ["English", ["the", "and", "of", "to", "a", "in", "that", "is", "for", "with", "was", "his", "not", "this", "from", "be"]],
  ["Latin", ["et", "non", "est", "cum", "sed", "qui", "quae", "quod", "nec", "per", "aut", "sunt", "hoc"]],
  ["French", ["les", "des", "une", "dans", "que", "pas", "pour", "avec", "sur", "sont", "dans"]],
  ["German", ["und", "der", "die", "das", "nicht", "eine", "ist", "mit", "auf", "den", "von"]],
  ["Italian", ["che", "della", "una", "sono", "come", "del", "nel", "per"]],
  ["Spanish", ["los", "las", "del", "una", "por", "para", "como", "sus"]],
];

function tongue(sample: string): string {
  const words = sample.toLowerCase().match(/[a-zà-öø-ÿ]+/g) ?? [];
  if (words.length < 12) return "";
  let best = "";
  let bestN = 0;
  let second = 0;
  for (const [name, list] of TONGUES) {
    const set = new Set(list);
    let n = 0;
    for (const word of words) if (set.has(word)) n += 1;
    if (n > bestN) {
      second = bestN;
      bestN = n;
      best = name;
    } else if (n > second) second = n;
  }
  if (bestN < 3 || bestN < second + 2) return "";
  return best;
}

/** Language of the words in the file. A tag for the language a work was first written in is dropped when the text is a translation. */
export function publicationLanguage(declared: string, prose: string): string {
  const sample = prose.slice(0, 12000);
  let greek = 0;
  let letters = 0;
  for (const ch of sample) {
    const code = ch.codePointAt(0) ?? 0;
    const isGreek = (code >= 0x0370 && code <= 0x03ff) || (code >= 0x1f00 && code <= 0x1fff);
    const isLatin = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || (code >= 0x00c0 && code <= 0x024f);
    if (isGreek) greek += 1;
    if (isGreek || isLatin) letters += 1;
  }
  const parts = declared.split(/\s*;\s*/).map((part) => part.trim()).filter(Boolean);
  if (letters < 40) return declared || "English";
  const latinShare = (letters - greek) / letters;
  if (greek / letters > 0.2 && latinShare > 0.2) {
    const other = tongue(sample) || parts.find((part) => part !== "Greek" && part !== "Ancient Greek") || "";
    return other && other !== "Greek" ? `${other}; Greek` : "Greek";
  }
  if (greek / letters > 0.2) return "Greek";
  const spoken = tongue(sample);
  if (spoken) return spoken;
  const kept = parts.filter((part) => part !== "Greek" && part !== "Ancient Greek");
  if (kept.length) return [...new Set(kept)].join("; ");
  return "English";
}

export function labelLanguage(raw: string): string {
  const code = raw.trim().toLowerCase().replace(/_/g, "-").split("-")[0] ?? "";
  if (!code) return "";
  return LANG[code] ?? raw.trim();
}

export function titleFromName(name: string): string {
  const base = (name.split(/[/\\]/).pop() ?? name).replace(/\.[a-z0-9]+$/i, "");
  const spaced = base.replace(/[_]+/g, " ").trim();
  return spaced || "Imported text";
}

export function yamlValue(value: string): string {
  if (!value) return '""';
  if (/[:#"'&{}\[\],\n\r]|^\s|\s$/.test(value)) return JSON.stringify(value);
  return value;
}

export function pageAt(pages: PageMark[] | undefined, offset: number): string | undefined {
  if (!pages?.length) return undefined;
  let label: string | undefined;
  for (const mark of pages) {
    if (mark.offset <= offset) label = mark.label;
    else break;
  }
  return label;
}

/** The printed page at the start of a selection, or a range when the selection crosses one. */
export function pageRange(pages: PageMark[] | undefined, start: number, end: number): string | undefined {
  const first = pageAt(pages, start);
  const last = pageAt(pages, Math.max(start, end - 1));
  if (!first) return last;
  if (!last || first === last) return first;
  return `${first}–${last}`;
}

export function pageSpans(
  text: string,
  pages?: PageMark[],
): { label?: string; start: number; end: number }[] {
  const marks = (pages ?? [])
    .filter((mark) => mark.offset >= 0 && mark.offset < text.length)
    .sort((a, b) => a.offset - b.offset);
  if (!marks.length) return [{ start: 0, end: text.length }];
  const bounds = [0];
  for (const mark of marks) if (mark.offset > 0 && bounds[bounds.length - 1] !== mark.offset) bounds.push(mark.offset);
  bounds.push(text.length);
  const labelAt = new Map<number, string>();
  for (const mark of marks) labelAt.set(mark.offset <= 0 ? 0 : mark.offset, mark.label);
  const spans: { label?: string; start: number; end: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const start = bounds[i];
    const end = bounds[i + 1];
    if (end <= start) continue;
    spans.push({ start, end, label: labelAt.get(start) });
  }
  return spans.length ? spans : [{ start: 0, end: text.length }];
}

type Draft = { heading: string; parts: string[]; length: number; pages: PageMark[] };

function finish(draft: Draft): Section | null {
  const raw = draft.parts.join("");
  const lead = raw.length - raw.trimStart().length;
  const text = raw.trim();
  if (!text) return null;
  const pages = draft.pages
    .map((mark) => ({ label: mark.label, offset: mark.offset - lead }))
    .filter((mark) => mark.offset >= 0 && mark.offset <= text.length)
    .sort((a, b) => a.offset - b.offset);
  return { id: "", heading: draft.heading, text, ...(pages.length ? { pages } : {}) };
}

function pushPart(draft: Draft, chunk: string) {
  if (!chunk) return;
  draft.parts.push(chunk);
  draft.length += chunk.length;
}

/** Collapse trailing blank lines, then keep one paragraph break. Copies only the last piece. */
function breakParagraph(draft: Draft) {
  if (!draft.length) return;
  let last = draft.parts[draft.parts.length - 1] ?? "";
  const trimmed = last.replace(/\n+$/, "");
  if (trimmed !== last) {
    draft.length -= last.length - trimmed.length;
    if (trimmed) draft.parts[draft.parts.length - 1] = trimmed;
    else draft.parts.pop();
    last = trimmed;
  }
  if (!draft.length) return;
  pushPart(draft, "\n\n");
}

function parseBody(body: string): { heading: string; text: string; pages?: PageMark[] }[] {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  let book = "";
  let draft: Draft = { heading: "Text", parts: [], length: 0, pages: [] };
  let fence = false;
  const sections: Section[] = [];
  const commit = () => {
    const done = finish(draft);
    if (done) sections.push(done);
  };
  const begin = (heading: string) => {
    const last = draft.pages[draft.pages.length - 1];
    commit();
    draft = { heading, parts: [], length: 0, pages: last ? [{ label: last.label, offset: 0 }] : [] };
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/g, "");
    if (/^(```|~~~)/.test(line.trim())) {
      fence = !fence;
      continue;
    }
    if (fence) {
      pushPart(draft, `${draft.length ? "\n" : ""}${line}`);
      continue;
    }
    const heading = HEAD.exec(line);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].trim();
      if (level === 1) book = title;
      const named = level > 1 && book && !title.startsWith(book) ? `${book} · ${title}` : title;
      begin(named || "Text");
      continue;
    }
    const page = PAGE.exec(line.trim());
    if (page) {
      const label = page[1].replace(/^page\s+/i, "").trim().slice(0, 40);
      if (!label) continue;
      if (draft.length) breakParagraph(draft);
      draft.pages.push({ offset: draft.length, label });
      continue;
    }
    if (!line.trim()) {
      if (draft.length) {
        const last = draft.parts[draft.parts.length - 1] ?? "";
        if (!last.endsWith("\n\n")) breakParagraph(draft);
      }
      continue;
    }
    if (draft.length) {
      const last = draft.parts[draft.parts.length - 1] ?? "";
      if (!last.endsWith("\n")) pushPart(draft, "\n");
    }
    pushPart(draft, line);
  }
  commit();
  return sections;
}

function carryPages(pages: PageMark[], start: number, end: number): PageMark[] {
  let carry = "";
  const out: PageMark[] = [];
  for (const mark of [...pages].sort((a, b) => a.offset - b.offset)) {
    if (mark.offset < start) carry = mark.label;
    else if (mark.offset < end) out.push({ label: mark.label, offset: mark.offset - start });
  }
  if (carry && (out.length === 0 || out[0].offset > 0)) out.unshift({ label: carry, offset: 0 });
  return out;
}

function chunkSection(text: string, pages: PageMark[] = []): { text: string; pages: PageMark[] }[] {
  if (text.length <= SECTION_CHARS) return [{ text, pages }];
  const spans: { start: number; end: number }[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text.length - cursor <= SECTION_CHARS) {
      spans.push({ start: cursor, end: text.length });
      break;
    }
    let end = cursor + SECTION_CHARS;
    const window = text.slice(cursor, end);
    const para = window.lastIndexOf("\n\n");
    if (para > 800) end = cursor + para;
    else {
      const sentence = Math.max(window.lastIndexOf(". "), window.lastIndexOf("? "), window.lastIndexOf("! "));
      if (sentence > 800) end = cursor + sentence + 1;
    }
    spans.push({ start: cursor, end });
    cursor = end;
    while (cursor < text.length && /\s/.test(text[cursor] ?? "")) cursor += 1;
  }
  return spans
    .map(({ start, end }) => {
      const raw = text.slice(start, end);
      const lead = raw.length - raw.trimStart().length;
      const slice = raw.trim();
      return { text: slice, pages: carryPages(pages, start + lead, start + lead + slice.length) };
    })
    .filter((part) => part.text.length > 0);
}

/** Break oversized sections. Page marks travel with the prose they govern. Small works are unchanged. */
export function chunkWork(work: Work): Work {
  let changed = false;
  const sections = work.sections.flatMap((section) => {
    const parts = chunkSection(section.text, section.pages ?? []);
    if (parts.length === 1 && parts[0].text === section.text) return [section];
    changed = true;
    return parts.map((part, index) => ({
      id: parts.length === 1 ? section.id : `${section.id}-p${index + 1}`,
      heading: index === 0 ? section.heading : `${section.heading} · ${index + 1}`,
      text: part.text,
      ...(part.pages.length ? { pages: part.pages } : {}),
    }));
  });
  return changed ? { ...work, sections } : work;
}

function contentsKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A contents page that only repeats the chapter titles is already the contents list.
 * Drop that echo so it is not also the text in front of the book.
 */
export function omitContentsEcho(sections: Section[]): Section[] {
  if (sections.length < 3) return sections;
  const keys = sections.map((section) => contentsKey(section.heading)).filter((key) => key.length > 1);
  const known = new Set(keys);
  return sections.filter((section, index) => {
    const titled = /^(table of )?contents$|^toc$|^index$/i.test(section.heading.trim());
    if (!titled && index !== 0) return true;
    const lines = section.text
      .split(/\n+/)
      .map((line) => contentsKey(line))
      .filter((line) => line.length > 1);
    const lineHits = lines.filter((line) => known.has(line)).length;
    const flat = contentsKey(section.text);
    let named = 0;
    let leftover = ` ${flat} `;
    for (const key of keys) {
      if (key.length < 3) continue;
      const at = leftover.indexOf(` ${key} `);
      if (at < 0) continue;
      named += 1;
      leftover = `${leftover.slice(0, at)} ${leftover.slice(at + key.length + 1)}`;
    }
    const leftoverWords = leftover.trim().split(/\s+/).filter(Boolean).length;
    const listLike = (lines.length >= 4 && lineHits >= Math.ceil(lines.length * 0.6)) || (named >= 4 && leftoverWords < 12);
    if (!listLike) return true;
    return !(titled || index === 0);
  });
}

/**
 * Folio Markdown: YAML metadata, Markdown headings for the book’s own sections,
 * and a MyST-style `:::page 12` line wherever the source kept a printed page.
 * The page line is removed from the indexed text and kept as an offset.
 */
export function parseImport(raw: string, fallbackTitle: string, min = 40): Work | { error: string } {
  const { meta, body } = splitMeta(raw);
  const parsed = parseBody(body);
  const prose = parsed.map((section) => section.text).join("\n");
  if (prose.trim().length < min) {
    return { error: "That text is too short to index. Paste at least a paragraph." };
  }
  if (!parsed.length) return { error: "No prose found under the headings." };

  const title = pick(meta, "title") || titleFromName(fallbackTitle);
  const id = `import-${slug(title)}-${Date.now().toString(36)}`;
  const work: Work = {
    id,
    title,
    author: pick(meta, "creator", "author") || "Unknown",
    language: publicationLanguage(languagesFrom(pick(meta, "language")), prose) || "English",
    form: pick(meta, "type", "form") || "Prose",
    period: pick(meta, "coverage", "period") || "Imported",
    genre: pick(meta, "subject", "genre") || "Notes",
    edition: pick(meta, "source", "edition") || "Imported text",
    description: pick(meta, "description") || undefined,
    publisher: pick(meta, "publisher") || undefined,
    contributor: pick(meta, "contributor") || undefined,
    date: pick(meta, "date") || undefined,
    identifier: pick(meta, "identifier") || undefined,
    relation: pick(meta, "relation") || undefined,
    rights: pick(meta, "rights") || undefined,
    format: pick(meta, "format") || "text/markdown",
    imported: true,
    ...identifierFields(meta),
    sections: parsed.map((section, index) => ({
      id: `${id}-s${index + 1}`,
      heading: section.heading,
      text: section.text,
      ...(section.pages?.length ? { pages: section.pages } : {}),
    })),
  };
  return chunkWork(work);
}

/** Serialize a work back to Folio Markdown. Page marks stay on their own lines. */
export function toFolioMarkup(work: Work): string {
  const lines = [
    "---",
    `title: ${yamlValue(work.title)}`,
    `creator: ${yamlValue(work.author)}`,
    `language: ${yamlValue(work.language)}`,
    `type: ${yamlValue(work.form)}`,
    `coverage: ${yamlValue(work.period)}`,
    `subject: ${yamlValue(work.genre)}`,
    `source: ${yamlValue(work.edition)}`,
    ...ID_FIELDS.flatMap((key) => {
      const value = work.ids?.[key]?.trim();
      return value ? [`${key}: ${yamlValue(value)}`] : [];
    }),
    "format: text/markdown",
    "---",
    "",
  ];
  for (const section of work.sections) {
    lines.push(`## ${section.heading}`, "");
    const marks = [...(section.pages ?? [])].sort((a, b) => a.offset - b.offset);
    let cursor = 0;
    for (const mark of marks) {
      const at = Math.max(cursor, Math.min(mark.offset, section.text.length));
      if (at > cursor) lines.push(section.text.slice(cursor, at).trimEnd(), "");
      lines.push(`:::page ${mark.label}`, "");
      cursor = at;
    }
    const rest = section.text.slice(cursor).trimEnd();
    if (rest) lines.push(rest, "");
  }
  return `${lines.join("\n").trim()}\n`;
}
