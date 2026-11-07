import { createServerFn } from "@tanstack/react-start";
import { decodeEntities } from "../corpus/html-text.ts";
import { epubToWork } from "../corpus/epub.ts";
import type { Work } from "../corpus/types";

/** Literary shelves. Child pages of these are the books, not the whole site. */
export const BETTER_SHELVES = [
  "classic-literature",
  "epics-legends",
  "mythology-folklore",
  "plays-dramas",
  "historical-ancient-medieval",
  "novels",
  "victorian-fiction",
  "british-literature",
  "british-poetry",
  "american-literature",
  "american-poetry",
  "french-literature",
  "german-literature",
  "short-stories",
  "biographies",
] as const;

export type BetterBook = {
  title: string;
  author: string;
  gutenberg: number;
  epub: string;
  language: string;
};

const EPUB = /href="(\/wp-content\/uploads\/\d{4}\/\d{2}\/[a-z0-9._-]+\.zip)"/i;

export function parseBetterBook(html: string, title: string): BetterBook | null {
  const epub = html.match(EPUB)?.[1];
  if (!epub) return null;
  const author = decodeEntities(html.match(/class="bg-author"[^>]*>\s*by\s+([^<]+)/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const gutenberg = Number(html.match(/Project Gutenberg #(\d+)/)?.[1] ?? 0);
  const written = html.match(/written in ([A-Za-z][A-Za-z]+)/i)?.[1];
  const language = written ? written[0].toUpperCase() + written.slice(1).toLowerCase() : "English";
  return {
    title: decodeEntities(title).replace(/\s+/g, " ").trim() || "Untitled",
    author: author || "Unknown",
    gutenberg: Number.isInteger(gutenberg) ? gutenberg : 0,
    epub,
    language,
  };
}

async function shelfId(slug: string): Promise<number | null> {
  const response = await fetch(`https://bettergutenberg.org/wp-json/wp/v2/pages?slug=${slug}&_fields=id,parent`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return null;
  const rows = (await response.json()) as { id?: number; parent?: number }[];
  const page = rows.find((row) => row.parent === 0 && row.id);
  return page?.id ?? null;
}

export const listBetterBooks = createServerFn({ method: "POST" })
  .validator((data: { slug?: string; page?: number }) => {
    const slug = String(data?.slug ?? "");
    if (!BETTER_SHELVES.includes(slug as (typeof BETTER_SHELVES)[number])) throw new Error("Unknown shelf.");
    const page = Number(data?.page);
    if (!Number.isInteger(page) || page < 1 || page > 500) throw new Error("Unknown page.");
    return { slug, page };
  })
  .handler(async ({ data }): Promise<{ books: BetterBook[]; pages: number }> => {
    try {
      const parent = await shelfId(data.slug);
      if (!parent) return { books: [], pages: 0 };
      const response = await fetch(
        `https://bettergutenberg.org/wp-json/wp/v2/pages?parent=${parent}&per_page=20&page=${data.page}&_fields=title,content`,
        { signal: AbortSignal.timeout(25000) },
      );
      if (response.status === 400) return { books: [], pages: 0 };
      if (!response.ok) return { books: [], pages: -1 };
      const pages = Number(response.headers.get("X-WP-TotalPages") ?? response.headers.get("x-wp-totalpages") ?? 1);
      const rows = (await response.json()) as { title?: { rendered?: string }; content?: { rendered?: string } }[];
      const books = rows.flatMap((row) => {
        const book = parseBetterBook(row.content?.rendered ?? "", row.title?.rendered ?? "");
        return book ? [book] : [];
      });
      return { books, pages: Number.isFinite(pages) && pages > 0 ? pages : 1 };
    } catch {
      return { books: [], pages: -1 };
    }
  });

export const fetchBetterBook = createServerFn({ method: "POST" })
  .validator((data: { epub?: string }) => {
    const epub = String(data?.epub ?? "");
    if (!/^\/wp-content\/uploads\/\d{4}\/\d{2}\/[a-z0-9._-]+\.zip$/.test(epub)) {
      throw new Error("Unknown Better Gutenberg file.");
    }
    return { epub };
  })
  .handler(async ({ data }): Promise<{ work: Work } | { error: string }> => {
    try {
      const response = await fetch(`https://bettergutenberg.org${data.epub}`, {
        redirect: "follow",
        signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) return { error: "Better Gutenberg did not answer." };
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > 12_000_000) return { error: "That book is too large to take in one pass." };
      const parsed = await epubToWork(bytes, `${data.epub.split("/").pop() ?? "book"}.epub`);
      if ("error" in parsed) return parsed;
      const { coverBytes: _cover, coverType: _type, ...work } = parsed;
      return { work };
    } catch {
      return { error: "That book could not be fetched." };
    }
  });
