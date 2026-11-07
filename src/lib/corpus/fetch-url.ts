import { createServerFn } from "@tanstack/react-start";
import { parseImport, yamlValue } from "./markup.ts";
import type { Work } from "./types";
import { pageHtmlToMarkup, pageLooksLikeVerse, plainTitle, publicHttpUrl, wikiAuthor, wikiPage } from "./url-page.ts";

const MAX_BYTES = 2_500_000;

export type FetchedPage = Work | { error: string };

async function readChecked(start: URL): Promise<{ url: URL; body: string; type: string } | { error: string }> {
  let current = start;
  for (let hop = 0; hop < 4; hop++) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: AbortSignal.timeout(20000),
        headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1", "User-Agent": "FolioSift (text import)" },
      });
    } catch {
      return { error: "That page could not be fetched." };
    }
    if (response.status >= 300 && response.status < 400) {
      const loc = response.headers.get("location");
      if (!loc) return { error: "That page redirected nowhere." };
      const next = publicHttpUrl(new URL(loc, current).href);
      if ("error" in next) return next;
      current = next;
      continue;
    }
    if (!response.ok) return { error: "That page did not answer." };
    const announced = Number(response.headers.get("content-length") ?? 0);
    if (announced > MAX_BYTES) return { error: "That page is too large to take in one pass." };
    const body = await response.text();
    if (body.length > MAX_BYTES) return { error: "That page is too large to take in one pass." };
    return { url: current, body, type: response.headers.get("content-type") ?? "" };
  }
  return { error: "That page redirected too many times." };
}

function asWork(body: string, fields: { title: string; author: string; source: string; form?: string }): FetchedPage {
  const markup = [
    "---",
    `title: ${yamlValue(fields.title)}`,
    `creator: ${yamlValue(fields.author || "Unknown")}`,
    "language: English",
    `type: ${yamlValue(fields.form || "Prose")}`,
    `source: ${yamlValue(fields.source)}`,
    "format: text/markdown",
    "---",
    "",
    body,
  ].join("\n");
  return parseImport(markup, fields.title || "Imported page");
}

/** Fetch a page and turn it into a work. A Wikisource article keeps the verse lines. */
export async function importFromUrl(raw: string): Promise<FetchedPage> {
  const target = publicHttpUrl(raw);
  if ("error" in target) return target;
  const wiki = wikiPage(target);
  try {
    if (wiki) {
      const api = new URL(wiki.api);
      api.searchParams.set("action", "parse");
      api.searchParams.set("page", wiki.title);
      api.searchParams.set("prop", "text|displaytitle");
      api.searchParams.set("format", "json");
      api.searchParams.set("formatversion", "2");
      const fetched = await readChecked(api);
      if ("error" in fetched) return fetched;
      const payload = JSON.parse(fetched.body) as { error?: { info?: string }; parse?: { displaytitle?: string; text?: string } };
      if (payload.error || !payload.parse?.text) return { error: "That page had no prose." };
      const html = payload.parse.text;
      const body = pageHtmlToMarkup(html);
      const title = plainTitle(payload.parse.displaytitle ?? "", wiki.title);
      return asWork(body, { title, author: wikiAuthor(html), source: target.href, form: pageLooksLikeVerse(html) ? "Verse" : "Prose" });
    }
    const fetched = await readChecked(target);
    if ("error" in fetched) return fetched;
    const type = fetched.type.toLowerCase();
    if (type.includes("html") || /<!doctype html|<html[\s>]/i.test(fetched.body.slice(0, 500))) {
      const title = plainTitle(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(fetched.body)?.[1] ?? "", target.hostname);
      return asWork(pageHtmlToMarkup(fetched.body), {
        title,
        author: "",
        source: fetched.url.href,
        form: pageLooksLikeVerse(fetched.body) ? "Verse" : "Prose",
      });
    }
    if (type.includes("text/") || type.includes("json") || !type) {
      return asWork(fetched.body, { title: plainTitle("", target.pathname.split("/").pop() || "Imported page"), author: "", source: fetched.url.href });
    }
    return { error: "That page is not a text." };
  } catch {
    return { error: "That page could not be read." };
  }
}

export const fetchImportedUrl = createServerFn({ method: "POST" })
  .validator((data: { url?: string }) => {
    const url = String(data?.url ?? "");
    if (url.length > 2000) throw new Error("That address is too long.");
    return { url };
  })
  .handler(({ data }) => importFromUrl(data.url));
