/** Turn chapter HTML from an EPUB or Kindle book into markup. Not a browser DOM. */

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
};

const SKIP = new Set(["head", "script", "style", "svg", "math"]);

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, entity: string) => {
    if (entity[0] === "#") {
      const code = entity[1] === "x" || entity[1] === "X" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return all;
      return String.fromCodePoint(code);
    }
    return NAMED[entity.toLowerCase()] ?? all;
  });
}

function readAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!tag.includes("=")) return out;
  for (const match of tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    const key = (match[1].split(":").pop() ?? match[1]).toLowerCase();
    out[key] = decodeEntities(match[2] ?? match[3] ?? "");
  }
  return out;
}

function localName(tag: string): string {
  const raw = (/^<\s*\/?\s*([a-z0-9:-]+)/i.exec(tag)?.[1] ?? "").toLowerCase();
  return raw.split(":").pop() ?? raw;
}

/**
 * `pageLabels` maps an element id to the printed page from an EPUB page-list.
 * A page break with no label is numbered in order, so a Kindle file still keeps its breaks.
 */
export function htmlToMarkup(html: string, pageLabels?: Map<string, string>): string {
  const src = html.replace(/\r\n/g, "\n");
  const out: string[] = [];
  let heading = 0;
  let headingText = "";
  let skip = 0;
  let auto = 0;
  const tocStack: string[] = [];
  const seen = new Set<string>();
  const tokens = src.match(/<\/?[^>]+>|[^<]+/g) ?? [];
  for (const tok of tokens) {
    if (!tok.startsWith("<")) {
      if (skip || tocStack.length) continue;
      const decoded = decodeEntities(tok).replace(/\r\n/g, "\n");
      // A blank line is a paragraph. A single newline inside a tag is just source wrapping.
      const text = decoded
        .replace(/[^\S\n]*\n(?:[^\S\n]*\n)+[^\S\n]*/g, "\u0000")
        .replace(/\s+/g, " ")
        .replace(/\u0000/g, "\n\n");
      if (!text) continue;
      if (heading) headingText += text;
      else out.push(text);
      continue;
    }
    const close = /^<\s*\//.test(tok);
    const name = localName(tok);
    const selfClosing = /\/>\s*$/.test(tok);
    if (SKIP.has(name)) {
      if (!selfClosing && !close) skip += 1;
      else if (close) skip = Math.max(0, skip - 1);
      continue;
    }
    const fields = /[=]/.test(tok) ? readAttrs(tok) : {};
    const type = fields.type ?? "";
    const role = fields.role ?? "";
    const id = fields.id ?? "";
    const tocMarker =
      !/page-list/i.test(type) && (/\btoc\b/i.test(type) || role === "doc-toc" || /^(toc|contents)$/i.test(id));
    if (!close && !selfClosing && tocMarker) {
      tocStack.push(name);
      continue;
    }
    if (close && tocStack.length && name === tocStack[tocStack.length - 1]) {
      tocStack.pop();
      continue;
    }
    if (skip || tocStack.length) continue;
    const level = /^h([1-6])$/.exec(name);
    if (!close && level) {
      heading = Math.min(3, Number(level[1]));
      headingText = "";
      continue;
    }
    if (close && heading && level) {
      const title = headingText.replace(/\s+/g, " ").trim();
      if (title) out.push(`\n\n${"#".repeat(heading)} ${title}\n\n`);
      heading = 0;
      headingText = "";
      continue;
    }
    if (!close && heading && (name === "p" || name === "div" || name === "section" || name === "blockquote")) {
      const title = headingText.replace(/\s+/g, " ").trim();
      if (title) out.push(`\n\n${"#".repeat(heading)} ${title}\n\n`);
      heading = 0;
      headingText = "";
    }
    if (heading) continue;
    if (!close && (name === "p" || name === "li" || name === "blockquote" || name === "pre" || name === "tr")) {
      out.push("\n\n");
    }
    if (!close && (name === "br" || name === "hr")) {
      out.push("\n");
      continue;
    }
    const title = fields.title || fields["aria-label"] || "";
    const pageish =
      name === "pagebreak" || name.endsWith("pagebreak") || /pagebreak/i.test(type) || role === "doc-pagebreak";
    const mapped = id ? pageLabels?.get(id) : undefined;
    if (!close && (pageish || mapped)) {
      const key = id || title || `auto-${auto + 1}`;
      if (!seen.has(key)) {
        seen.add(key);
        let label = (mapped || title).replace(/^page\s+/i, "").trim();
        if (!label) {
          auto += 1;
          label = String(auto);
        }
        out.push(`\n\n:::page ${label}\n\n`);
      }
      if (pageish) continue;
    }
    if (close && (name === "p" || name === "div" || name === "li" || name === "tr" || name === "blockquote" || name === "section")) {
      out.push("\n\n");
    }
  }
  return out.join("");
}

export type PageRef = { file: string; id: string; label: string };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** EPUB 3 page-list and NCX pageList, resolved against the file that holds the nav. */
export function pageRefsFromNav(html: string, navFile: string): PageRef[] {
  const refs: PageRef[] = [];
  const chunks = html.split(/<nav\b/i).slice(1);
  for (const chunk of chunks) {
    const head = chunk.slice(0, 400);
    if (!/page-list/i.test(head)) continue;
    const body = chunk.split(/<\/nav>/i)[0] ?? "";
    for (const anchor of body.matchAll(/<a\b[^>]*href\s*=\s*("([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
      const href = anchor[2] || anchor[3] || "";
      const label = decodeEntities(anchor[4].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
      const ref = resolveHref(navFile, href);
      if (ref?.id && label) refs.push({ ...ref, label });
    }
  }
  for (const target of html.matchAll(/<pageTarget\b[^>]*>([\s\S]*?)<\/pageTarget>/gi)) {
    const block = target[1];
    const label = /<text[^>]*>([\s\S]*?)<\/text>/i.exec(block)?.[1] ?? "";
    const src = /<content\b[^>]*src\s*=\s*("([^"]+)"|'([^']+)')/i.exec(block);
    const href = src?.[2] || src?.[3] || "";
    const clean = decodeEntities(label.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    const ref = resolveHref(navFile, href);
    if (ref?.id && clean) refs.push({ ...ref, label: clean });
  }
  return refs;
}

/** Chapter titles from an EPUB 3 toc nav or an NCX navMap. The page-list is ignored. */
export function tocLabels(html: string, navFile: string): Map<string, string> {
  const labels = new Map<string, string>();
  const remember = (href: string, label: string) => {
    const text = decodeEntities(label.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!text) return;
    const file = resolveFile(navFile, href);
    if (file && !labels.has(file)) labels.set(file, text.slice(0, 180));
  };
  const chunks = html.split(/<nav\b/i).slice(1);
  for (const chunk of chunks) {
    const head = chunk.slice(0, 500);
    if (/page-list/i.test(head)) continue;
    const body = chunk.split(/<\/nav>/i)[0] ?? "";
    for (const anchor of body.matchAll(/<a\b[^>]*href\s*=\s*("([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
      remember(anchor[2] || anchor[3] || "", anchor[4]);
    }
  }
  const navMap = html.replace(/<pageList\b[\s\S]*?<\/pageList>/gi, "");
  for (const point of navMap.matchAll(
    /<navLabel>\s*<text[^>]*>([\s\S]*?)<\/text>[\s\S]*?<content\b[^>]*src\s*=\s*("([^"]+)"|'([^']+)')/gi,
  )) {
    remember(point[3] || point[4] || "", point[1]);
  }
  return labels;
}

export function resolveFile(fromFile: string, href: string): string | null {
  const path = (href.split("#")[0] ?? "").trim();
  if (!path) return null;
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/") + 1) : "";
  return normalizePath(`${dir}${path}`) || null;
}

export function resolveHref(fromFile: string, href: string): { file: string; id: string } | null {
  const [path, id = ""] = href.split("#");
  if (!id) return null;
  const dir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/") + 1) : "";
  const joined = normalizePath(path ? `${dir}${path}` : fromFile);
  return { file: joined, id: safeDecode(id) };
}

export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(safeDecode(part).normalize("NFC"));
  }
  return parts.join("/");
}
