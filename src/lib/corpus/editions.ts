import { parsePersonName } from "../persona/names.ts";
import { seriesSiblings } from "./series.ts";
import type { Work } from "./types.ts";

function titleKey(title: string, authorLast: string): string {
  let text = title.toLowerCase().replace(/['’]/g, "");
  text = (text.split(/[:—–]|\s+-\s+/)[0] ?? text).replace(/\([^)]*\)/g, " ");
  text = text
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(the|a|an)\s+/, "");
  if (authorLast) {
    text = text.replace(new RegExp(`^${authorLast}s?\\s+`), "");
    text = text.replace(new RegExp(`\\s+(?:of|by)\\s+${authorLast}$`), "");
  }
  text = text
    .replace(/\s+(a new translation|translated by [a-z ]+|translation|volume\s+\d+|vol\s+\d+|books?\s+[ivx0-9][a-z0-9\- ]*)$/, "")
    .trim();
  return text;
}

function lastName(name: string): string {
  const parsed = parsePersonName(name);
  return parsed.last.toLowerCase().replace(/[^a-z]+/g, "");
}

/** People named as authors, not a translator stuffed into the same string. */
function authorKey(author: string): string {
  const names = author
    .split(/;|\band\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
  const lasts = names.map(lastName).filter(Boolean);
  return [...new Set(lasts)].sort().join(" ");
}

/** Same work, another printing or translation. An unnamed author never groups by title. */
export function editionKey(work: Pick<Work, "title" | "author">): string {
  const author = authorKey(work.author);
  if (!author) return "";
  const title = titleKey(work.title, author.split(" ")[0] ?? "");
  if (!title) return "";
  return `${author}\n${title}`;
}

/** Title key, plus a shared Wikidata id when two editions name the same work. */
export function editionKeys(work: Pick<Work, "title" | "author" | "ids">): string[] {
  const keys: string[] = [];
  const title = editionKey(work);
  if (title) keys.push(title);
  const wiki = work.ids?.wikidata?.replace(/\s+/g, "").toUpperCase();
  if (wiki) keys.push(`wikidata:${wiki}`);
  return keys;
}

export function otherEditions(work: Work, shelf: Work[]): Work[] {
  const keys = new Set(editionKeys(work));
  if (!keys.size) return [];
  return shelf
    .filter((item) => item.id !== work.id && !seriesSiblings(work, item) && editionKeys(item).some((key) => keys.has(key)))
    .sort((a, b) => a.language.localeCompare(b.language) || a.title.localeCompare(b.title));
}
