import { parseImport, titleFromName, yamlValue } from "./markup.ts";
import type { Work } from "./types";

type Pdfjs = typeof import("pdfjs-dist");

type Glyph = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

async function workerSrc(): Promise<string> {
  if (typeof window === "undefined") {
    const { createRequire } = await import(/* @vite-ignore */ "node:module");
    const { pathToFileURL } = await import(/* @vite-ignore */ "node:url");
    const require = createRequire(import.meta.url);
    return pathToFileURL(require.resolve("pdfjs-dist/build/pdf.worker.min.mjs")).href;
  }
  const mod = await import("./pdf-worker-url.ts");
  return mod.pdfWorkerUrl;
}

async function loadPdfjs(): Promise<Pdfjs> {
  const pdfjs = await import("pdfjs-dist");
  if (!pdfjs.GlobalWorkerOptions.workerSrc) pdfjs.GlobalWorkerOptions.workerSrc = await workerSrc();
  return pdfjs;
}

function isGlyph(item: unknown): item is Glyph {
  return !!item && typeof item === "object" && "str" in item && typeof (item as Glyph).str === "string";
}

function collapseOverprint(raw: string): string {
  const str = raw.normalize("NFKC");
  if (str.length < 2 || str.length % 2 !== 0) return str;
  const half = str.length / 2;
  if (str.length >= 4 && str.slice(0, half) === str.slice(half)) return str.slice(0, half);
  for (let i = 0; i < str.length; i += 2) {
    if (str[i] !== str[i + 1]) return str;
  }
  return [...str].filter((_, i) => i % 2 === 0).join("");
}

function sameInk(a: string, b: string): boolean {
  const left = a.replace(/\s+/g, "").toLowerCase();
  const right = b.replace(/\s+/g, "").toLowerCase();
  if (!left || !right) return false;
  if (left === right) return true;
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  if (short.length < 2) return false;
  return long.startsWith(short) || long.endsWith(short) || (short.length >= 3 && long.includes(short));
}

/** Drop glyphs the PDF painted again on top of the same letters (a fill plus a stroke, or a fake bold). */
function visibleGlyphs(glyphs: Glyph[]): Glyph[] {
  const placed = glyphs
    .map((glyph) => {
      const x = glyph.transform[4] ?? 0;
      const y = glyph.transform[5] ?? 0;
      const scale = Math.hypot(glyph.transform[0] ?? 0, glyph.transform[1] ?? 0) || glyph.height || 12;
      return { glyph, str: collapseOverprint(glyph.str), x, y, scale, width: glyph.width || 0 };
    })
    .filter((item) => item.str)
    .sort((a, b) => a.x - b.x || b.y - a.y);
  const kept: typeof placed = [];
  for (const item of placed) {
    const hit = kept.find((prev) => {
      if (Math.abs(prev.y - item.y) > Math.max(prev.scale, item.scale) * 0.45) return false;
      const prevWidth = prev.width || Math.max(prev.scale, item.str.length * prev.scale * 0.45);
      const nextWidth = item.width || Math.max(item.scale, item.str.length * item.scale * 0.45);
      const overlap = Math.min(prev.x + prevWidth, item.x + nextWidth) - Math.max(prev.x, item.x);
      return overlap > Math.max(1, Math.min(prevWidth, nextWidth)) * 0.45 && sameInk(prev.str, item.str);
    });
    if (hit) {
      if (item.str.length > hit.str.length) hit.str = item.str;
      continue;
    }
    kept.push({ ...item });
  }
  return kept.map((item) => ({ ...item.glyph, str: item.str }));
}

function lineOf(glyphs: Glyph[]): { text: string; size: number; y: number; x: number; width: number } | null {
  let text = "";
  let size = 0;
  let endX: number | null = null;
  let y = 0;
  let x = 0;
  let seen = false;
  for (const glyph of visibleGlyphs(glyphs)) {
    const scale = Math.hypot(glyph.transform[0] ?? 0, glyph.transform[1] ?? 0) || glyph.height || 12;
    size = Math.max(size, scale);
    y = glyph.transform[5] ?? y;
    const gx = glyph.transform[4] ?? 0;
    if (!seen || gx < x) x = gx;
    seen = true;
    if (text && endX != null && gx - endX > scale * 0.2 && !text.endsWith(" ") && !glyph.str.startsWith(" ")) {
      text += " ";
    }
    text += glyph.str;
    endX = gx + (glyph.width || 0);
  }
  const clean = text
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? part : collapseOverprint(part)))
    .join("")
    .replace(/[ \t]+/g, " ")
    .trim();
  if (!clean) return null;
  return { text: clean, size, y, x, width: endX != null ? Math.max(0, endX - x) : 0 };
}

function bodySize(lines: { text: string; size: number }[]): number {
  const samples: number[] = [];
  for (const line of lines) {
    if (line.text.length < 20) continue;
    for (let i = 0; i < line.text.length; i++) samples.push(line.size);
  }
  if (!samples.length) {
    for (const line of lines) samples.push(line.size);
  }
  if (!samples.length) return 12;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)] || 12;
}

type Placed = { str: string; x: number; y: number; scale: number; width: number };

function placedGlyphs(items: unknown[]): Placed[] {
  return visibleGlyphs(items.filter(isGlyph)).map((glyph) => {
    const scale = Math.hypot(glyph.transform[0] ?? 0, glyph.transform[1] ?? 0) || glyph.height || 12;
    return {
      str: glyph.str,
      x: glyph.transform[4] ?? 0,
      y: glyph.transform[5] ?? 0,
      scale,
      width: glyph.width || 0,
    };
  });
}

/** A wide empty band with text on both sides is a second column, as in a Loeb page. */
function columnCut(glyphs: Placed[], pageWidth: number): number | null {
  if (glyphs.length < 4 || pageWidth < 240) return null;
  const centers = glyphs.map((glyph) => glyph.x + glyph.width / 2).sort((a, b) => a - b);
  let best = 0;
  let mid = 0;
  for (let i = 1; i < centers.length; i++) {
    const gap = centers[i] - centers[i - 1];
    if (gap > best) {
      best = gap;
      mid = (centers[i] + centers[i - 1]) / 2;
    }
  }
  if (best < Math.max(36, pageWidth * 0.08)) return null;
  const left = centers.filter((x) => x < mid).length;
  if (left < centers.length * 0.25 || left > centers.length * 0.75) return null;
  return mid;
}

function linesFrom(glyphs: Placed[]): { text: string; size: number; y: number; x: number; width: number }[] {
  const rows: { y: number; size: number; items: Placed[] }[] = [];
  const ordered = glyphs.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  for (const glyph of ordered) {
    const row = rows.find((item) => Math.abs(item.y - glyph.y) <= Math.max(item.size, glyph.scale) * 0.45);
    if (row) {
      row.items.push(glyph);
      row.size = Math.max(row.size, glyph.scale);
    } else rows.push({ y: glyph.y, size: glyph.scale, items: [glyph] });
  }
  const lines: { text: string; size: number; y: number; x: number; width: number }[] = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    const line = lineOf(
      row.items.map((item) => ({
        str: item.str,
        transform: [item.scale, 0, 0, item.scale, item.x, item.y],
        width: item.width,
        height: item.scale,
        hasEOL: false,
      })),
    );
    if (line) lines.push(line);
  }
  return lines;
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Prose has a measure. Verse and lists do not, so a short line there is not a paragraph ending. */
function proseMeasure(lines: { text: string; x: number; width: number }[]): { wide: number } | null {
  const long = lines.filter((line) => line.text.length >= 45 && line.width > 0);
  if (long.length < 4) return null;
  const wide = median(long.map((line) => line.width));
  if (wide < 80) return null;
  const short = long.filter((line) => line.width < wide * 0.8).length;
  if (short > long.length * 0.5) return null;
  return { wide };
}

function paragraphKey(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

/** A site address painted on the page, including the Gandhi Media footer with a missing w. */
function scrubSites(text: string): string {
  const cleaned = text
    .replace(/(?:https?:\/\/)?w{2,3}\.gandhimedia\.org/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  if (/^[0-9ivxlcdm]{1,8}$/i.test(cleaned)) return "";
  return cleaned;
}

function siteLine(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  if (compact.length < 6 || compact.length > 80) return false;
  return /gandhimedia/i.test(compact) || /^(?:https?:\/\/)?(?:w{2,3}\.)?[a-z0-9][a-z0-9.-]*\.(?:org|com|net|edu)(?:\/\S*)?$/i.test(compact);
}

type Line = { text: string; size: number; y: number; x: number; width: number };

/** A page of short, left-aligned lines is verse. Justified prose reaches across the measure. */
function looksLikeVerse(lines: Line[], pageWidth: number): boolean {
  const body = lines.filter((line) => {
    const text = line.text.trim();
    return text.length >= 2 && !/^(?:\d{1,4}|[ivxlcdm]{1,6})$/i.test(text);
  });
  if (body.length < 10 || pageWidth < 200) return false;
  const widths = body.map((line) => line.width).filter((width) => width > 24).sort((a, b) => a - b);
  if (widths.length < 10) return false;
  const wide = widths[Math.floor(widths.length * 0.8)] ?? 0;
  if (wide < 70) return false;
  if (body.filter((line) => line.width > pageWidth * 0.62).length > body.length * 0.45) return false;
  const ragged = widths.filter((width) => width < wide * 0.78).length >= widths.length * 0.28;
  const shortColumn = wide < pageWidth * 0.55;
  if (!ragged && !shortColumn) return false;
  const xs = body.map((line) => line.x).sort((a, b) => a - b);
  const left = xs[Math.floor(xs.length * 0.2)] ?? 0;
  return body.filter((line) => Math.abs(line.x - left) < 18).length >= body.length * 0.55;
}

/** A short line in a smaller fount, low on the page, is a note rather than the next sentence. */
function noteLine(line: Line, body: number, pageHeight: number): boolean {
  if (pageHeight <= 0 || line.y > pageHeight * 0.22 || line.y < pageHeight * 0.045) return false;
  if (line.size > body * 0.92) return false;
  if (line.text.length > 280) return false;
  return line.size <= body * 0.86 || /^(?:\d{1,3}|[*†‡§])\s+\S/.test(line.text);
}

function emitVerse(lines: Line[], label: string, pageHeight: number, chunks: string[], repeats: string[]) {
  let stanza: string[] = [];
  let prev: Line | null = null;
  const flush = () => {
    if (stanza.length) chunks.push(stanza.join("\n"));
    stanza = [];
  };
  for (const line of lines) {
    const cleaned = scrubSites(line.text);
    if (!cleaned || cleaned === label || (/^[0-9ivxlcdm]{1,8}$/i.test(cleaned) && cleaned.length < 8)) continue;
    const marginal = pageHeight > 0 && (line.y < pageHeight * 0.07 || line.y > pageHeight * 0.93);
    if (marginal || siteLine(line.text)) {
      flush();
      repeats.push(paragraphKey(cleaned));
      continue;
    }
    const gap = prev ? prev.y - line.y : 0;
    if (prev && gap > Math.max(line.size, prev.size) * 1.9) flush();
    stanza.push(cleaned);
    prev = line;
  }
  flush();
}
/** One PDF page → Folio Markdown. Verse stays in lines, notes stay off the paragraph, and a printed page keeps its number. */
function pageMarkup(
  items: unknown[],
  label: string,
  seen: Set<string>,
  headings: Set<string>,
  pageWidth: number,
  pageHeight: number,
): { text: string; repeats: string[]; verse: boolean; notes: number } {
  const placed = placedGlyphs(items);
  const cut = columnCut(placed, pageWidth);
  const columns =
    cut == null
      ? [placed]
      : [placed.filter((glyph) => glyph.x + glyph.width / 2 < cut), placed.filter((glyph) => glyph.x + glyph.width / 2 >= cut)];
  const repeats: string[] = [];
  const chunks: string[] = [];
  let verse = false;
  let notes = 0;
  for (const column of columns) {
    const lines = linesFrom(column);
    const body = bodySize(lines);
    const noted = lines.filter((line) => noteLine(line, body, pageHeight));
    const notedSet = new Set(noted);
    const rest = lines.filter((line) => !notedSet.has(line));
    if (looksLikeVerse(rest, pageWidth)) {
      verse = true;
      emitVerse(rest, label, pageHeight, chunks, repeats);
    } else {
      const measure = proseMeasure(rest);
      let para = "";
      let paraSize = 0;
      let paraY = 0;
      let paraX = 0;
      let paraWidth = 0;
      const flushPara = () => {
        const text = scrubSites(para);
        para = "";
        paraWidth = 0;
        if (text) chunks.push(text);
      };
      for (const line of rest) {
        const marginal = pageHeight > 0 && (line.y < pageHeight * 0.07 || line.y > pageHeight * 0.93);
        const cleaned = scrubSites(line.text);
        if (!cleaned || cleaned === label || (/^[0-9ivxlcdm]{1,8}$/i.test(cleaned) && cleaned.length < 8 && line.size < body * 1.15)) {
          continue;
        }
        if (marginal || siteLine(line.text)) {
          flushPara();
          repeats.push(paragraphKey(cleaned));
          chunks.push(cleaned);
          continue;
        }
        const named = headings.has(cleaned.toLowerCase());
        const heading =
          named ||
          (line.size >= body * 1.28 && cleaned.length <= 90 && cleaned.split(/\s+/).length <= 16 && !/[.!?]$/.test(cleaned));
        if (heading) {
          flushPara();
          const key = cleaned.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          chunks.push(`${!named && line.size >= body * 1.65 ? "#" : "##"} ${cleaned}`);
          continue;
        }
        const gap = para ? paraY - line.y : 0;
        if (para && Math.abs(gap) < Math.max(line.size, paraSize) * 0.35 && (para === cleaned || para.endsWith(` ${cleaned}`))) {
          continue;
        }
        const wrapped = para && gap > 0 && gap < Math.max(line.size, paraSize) * 1.45 && Math.abs(line.size - paraSize) < 1.25;
        const indented = Boolean(measure && para && line.x > paraX + line.size * 0.8 && line.width > measure.wide * 0.55);
        const ended = Boolean(measure && para && paraWidth > 0 && paraWidth < measure.wide * 0.82 && !/[-–—]$/.test(para));
        if (wrapped && !indented && !ended && para.endsWith("-") && /^[a-z\u00c0-\u024f\u0370-\u03ff\u0400-\u04ff\u0590-\u05ff\u0600-\u06ff\u0900-\u097f]/.test(cleaned)) {
          para = `${para.slice(0, -1)}${cleaned}`;
        } else if (wrapped && !indented && !ended) para = `${para} ${cleaned}`;
        else {
          flushPara();
          para = cleaned;
          paraSize = line.size;
        }
        paraY = line.y;
        paraX = line.x;
        paraWidth = line.width;
      }
      flushPara();
    }
    for (const line of noted) {
      const cleaned = scrubSites(line.text);
      if (!cleaned || siteLine(cleaned)) continue;
      notes += 1;
      chunks.push(cleaned);
    }
  }
  const text = chunks.join("\n\n").trim();
  return { text: text ? `:::page ${label}\n\n${text}` : "", repeats, verse, notes };
}

function withoutRunningMatter(pages: { text: string; repeats: string[] }[]): string {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const key of new Set(page.repeats)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const drop = new Set([...counts].filter(([, count]) => count >= 3).map(([key]) => key));
  const kept: string[] = [];
  for (const page of pages) {
    const parts = page.text.split("\n\n").filter((part, index) => {
      if (index === 0 && part.startsWith(":::page")) return true;
      return !drop.has(paragraphKey(part.replace(/^#+\s+/, "")));
    });
    if (parts.length > 1) kept.push(parts.join("\n\n"));
  }
  return kept.join("\n\n");
}

function metaString(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function outlineTitles(outline: unknown): Set<string> {
  const titles = new Set<string>();
  const walk = (items: unknown) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const title = metaString((item as { title?: unknown }).title);
      if (title.length >= 3 && title.length <= 90) titles.add(title.toLowerCase());
      walk((item as { items?: unknown }).items);
    }
  };
  walk(outline);
  return titles;
}

function conversionNote(versePages: number, noteCount: number, columnPages: number): string {
  const parts: string[] = [];
  if (columnPages) parts.push(columnPages === 1 ? "One page was read down each column." : `${columnPages} pages were read down each column.`);
  if (versePages) parts.push(versePages === 1 ? "One page was kept as verse." : `${versePages} pages were kept as verse.`);
  if (noteCount) parts.push(noteCount === 1 ? "One note was set apart." : `${noteCount} notes were set apart.`);
  return parts.join(" ");
}

function isBlob(source: Uint8Array | Blob): source is Blob {
  return typeof Blob !== "undefined" && source instanceof Blob;
}

/** PDF → markup. Printed labels are kept when the file has them; otherwise the page index. */
export async function pdfToWork(
  source: Uint8Array | Blob,
  filename: string,
  onPage?: (page: number, total: number) => void,
): Promise<Work | { error: string }> {
  const pdfjs = await loadPdfjs();
  let doc: Awaited<ReturnType<Pdfjs["getDocument"]>["promise"]>;
  let url = "";
  try {
    const params = { verbosity: 0, isEvalSupported: false, disableFontFace: true } as const;
    if (isBlob(source)) {
      if (source.size > 8_000_000 && typeof URL !== "undefined" && URL.createObjectURL) {
        url = URL.createObjectURL(source);
        doc = await pdfjs.getDocument({ ...params, url, disableAutoFetch: true, rangeChunkSize: 65536 }).promise;
      } else {
        doc = await pdfjs.getDocument({ ...params, data: new Uint8Array(await source.arrayBuffer()) }).promise;
      }
    } else {
      doc = await pdfjs.getDocument({ ...params, data: source }).promise;
    }
  } catch (error) {
    if (url) URL.revokeObjectURL(url);
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") return { error: "That PDF is locked. Export an unlocked copy." };
    return { error: "That PDF could not be read." };
  }
  try {
    const info = (await doc.getMetadata().catch(() => null))?.info as { Title?: string; Author?: string } | undefined;
    const labels = await doc.getPageLabels().catch(() => null);
    const headings = outlineTitles(await doc.getOutline().catch(() => null));
    const seen = new Set<string>();
    const pages: { text: string; repeats: string[] }[] = [];
    let versePages = 0;
    let noteCount = 0;
    let columnPages = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      if (onPage && (i === 1 || i === doc.numPages || i % 5 === 0)) onPage(i, doc.numPages);
      if (i % 8 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const view = page.getViewport({ scale: 1 });
      const label = (labels?.[i - 1] || String(i)).trim().slice(0, 40) || String(i);
      const placed = placedGlyphs(content.items);
      if (columnCut(placed, view.width) != null) columnPages += 1;
      const markup = pageMarkup(content.items, label, seen, headings, view.width, view.height);
      if (markup.verse) versePages += 1;
      noteCount += markup.notes;
      if (markup.text) pages.push(markup);
      page.cleanup();
    }
    const body = withoutRunningMatter(pages);
    if (!body) {
      return { error: "That PDF has no text layer. A scan needs a text version before it can be indexed." };
    }
    const title = metaString(info?.Title) || titleFromName(filename);
    const author = metaString(info?.Author) || "Unknown";
    const verse = versePages > 0 && versePages * 2 >= pages.length;
    const note = conversionNote(versePages, noteCount, columnPages);
    const raw = [
      "---",
      `title: ${yamlValue(title)}`,
      `creator: ${yamlValue(author)}`,
      `source: ${yamlValue(filename)}`,
      `type: ${verse ? "Verse" : "Prose"}`,
      `format: ${verse ? "text/x-folio-lines" : "text/markdown"}`,
      ...(note ? [`description: ${yamlValue(note)}`] : []),
      "relation: converted from application/pdf",
      "---",
      "",
      body,
    ].join("\n");
    return parseImport(raw, filename);
  } finally {
    await doc.destroy();
    if (url) URL.revokeObjectURL(url);
  }
}
