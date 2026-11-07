import { decodeEntities } from "./html-text.ts";

const SKIP_TAGS = new Set(["head", "script", "style", "svg", "math", "noscript", "nav", "footer", "form", "aside"]);
const SKIP_CLASS = new Set([
  "ws-noexport",
  "ws-header",
  "mw-editsection",
  "reference",
  "mwe-math-element",
  "ws-poem-linenum",
  "noprint",
  "navbox",
  "catlinks",
  "mw-references-wrap",
  "mw-cite-backlink",
  "sistersite",
]);

type Frame = { name: string; skip: boolean; poem: boolean; stanza: boolean; drop: boolean };

function readAttrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
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

function classesOf(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(/\s+/).filter(Boolean));
}

/** A page the user named, and not a loopback or private address. */
export function publicHttpUrl(raw: string): URL | { error: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { error: "That is not a web address." };
  }
  if (url.username || url.password) return { error: "That address cannot be fetched." };
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only a web address can be fetched." };
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return { error: "That address cannot be fetched." };
  }
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ip) {
    const parts = ip.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return { error: "That address cannot be fetched." };
    const [a, b] = parts;
    const privateNet =
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127);
    if (privateNet) return { error: "That address cannot be fetched." };
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return { error: "That address cannot be fetched." };
  }
  return url;
}

/** A MediaWiki article, if this address is one. The API is on the same host. */
export function wikiPage(url: URL): { api: string; title: string } | null {
  const host = url.hostname.toLowerCase();
  if (!/(^|\.)wikisource\.org$|(^|\.)wikipedia\.org$|(^|\.)wikibooks\.org$/.test(host)) return null;
  const path = decodeURIComponent(url.pathname);
  const match = /^\/wiki\/(.+)$/.exec(path);
  if (!match || match[1].includes(":") && !match[1].startsWith("Author:")) return null;
  if (match[1].startsWith("Special:") || match[1].startsWith("File:") || match[1].startsWith("Category:")) return null;
  const title = match[1].replace(/_/g, " ");
  return { api: `${url.protocol}//${url.host}/w/api.php`, title };
}

export function plainTitle(htmlOrText: string, fallback: string): string {
  const stripped = decodeEntities(htmlOrText.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  const last = (stripped || fallback).split("/").pop()?.trim() || fallback;
  return last.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function pageLooksLikeVerse(html: string): boolean {
  return /class="[^"]*\bws-poem-line\b/.test(html);
}

export function wikiAuthor(html: string): string {
  const named = /class="fn"[^>]*>([\s\S]*?)<\/span>/i.exec(html)?.[1] ?? "";
  const fromName = decodeEntities(named.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
  if (fromName) return fromName;
  const linked = /\/wiki\/Author:[^"]*"[^>]*>([^<]+)/i.exec(html)?.[1] ?? "";
  return decodeEntities(linked).replace(/\s+/g, " ").trim();
}

/**
 * Readable Folio markup from a page. Wikisource verse keeps its lines.
 * Running headers, line numbers, and citation markers are left out.
 */
export function pageHtmlToMarkup(html: string): string {
  const src = html.replace(/\r\n/g, "\n");
  const out: string[] = [];
  const stack: Frame[] = [];
  let skip = 0;
  let heading = 0;
  let headingText = "";
  const tokens = src.match(/<\/?[^>]+>|[^<]+/g) ?? [];
  const emit = (value: string) => {
    if (heading) headingText += value;
    else out.push(value);
  };
  for (const tok of tokens) {
    if (!tok.startsWith("<")) {
      if (skip) continue;
      if (!tok.trim()) {
        if (!tok.includes("\n")) emit(" ");
        continue;
      }
      const text = decodeEntities(tok).replace(/[ \t\n\r]+/g, " ");
      emit(text);
      continue;
    }
    const close = /^<\s*\//.test(tok);
    const name = localName(tok);
    const selfClosing = /\/>\s*$/.test(tok);
    if (close) {
      const frame = stack.pop();
      if (frame?.skip) skip = Math.max(0, skip - 1);
      if (skip || !frame) continue;
      if (heading && name === frame.name && /^h[1-6]$/.test(name)) {
        const title = headingText.replace(/\s+/g, " ").trim();
        if (title) out.push(`\n\n${"#".repeat(heading)} ${title}\n\n`);
        heading = 0;
        headingText = "";
      }
      if (frame.poem) out.push("\n");
      else if (frame.stanza) out.push("\n\n");
      else if (name === "p" || name === "div" || name === "li" || name === "blockquote" || name === "section" || name === "tr") {
        out.push("\n\n");
      }
      continue;
    }
    const fields = readAttrs(tok);
    const classes = classesOf(fields.class);
    const skipThis = SKIP_TAGS.has(name) || [...classes].some((item) => SKIP_CLASS.has(item));
    const frame: Frame = {
      name,
      skip: skipThis && !selfClosing,
      poem: classes.has("ws-poem-line"),
      stanza: classes.has("ws-poem-stanza"),
      drop: classes.has("dropinitial"),
    };
    if (!selfClosing) {
      if (skipThis) skip += 1;
      stack.push(frame);
    }
    if (skip) continue;
    if (name === "img") {
      const alt = (fields.alt ?? "").trim();
      const inDrop = frame.drop || stack.some((item) => item.drop);
      if (inDrop && alt.length === 1) emit(alt);
      continue;
    }
    const page = classes.has("pagenum") || classes.has("ws-pagenum") ? (fields["data-page-number"] ?? "").trim() : "";
    if (page) out.push(`\n\n:::page ${page}\n\n`);
    const level = /^h([1-6])$/.exec(name);
    if (level) {
      heading = Math.min(3, Number(level[1]));
      headingText = "";
      continue;
    }
    if (name === "br" || name === "hr") {
      if (!stack.some((item) => item.poem)) out.push("\n");
    } else if (name === "p" || name === "li" || name === "blockquote" || name === "pre") out.push("\n\n");
  }
  const joined = out
    .join("")
    .replace(/\u200b|\u00ad|\ufeff/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n");
  return joined.replace(/^\uFEFF?Tis /gm, "'Tis ").trim();
}
