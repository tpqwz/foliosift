import { storedIds } from "./ids.ts";
import type { DublinCore, DublinField, Work, WorkPatch } from "./types";

const DEFAULT_DATES: Record<string, string> = {
  iliad: "c. 8th century BCE",
  odyssey: "c. 8th century BCE",
  "works-and-days": "c. 700 BCE",
  histories: "c. 430 BCE",
  peloponnesian: "c. 400 BCE",
  apology: "c. 399 BCE",
  republic: "c. 375 BCE",
  ethics: "c. 340 BCE",
  aeneid: "19 BCE",
  meditations: "c. 170 CE",
  enchiridion: "c. 125 CE",
  letters: "c. 65 CE",
  rerum: "c. 55 BCE",
};

function firstSentence(work: Work): string {
  const text = work.sections[0]?.text ?? "";
  const cut = text.split(/(?<=\.)\s/)[0] ?? "";
  return cut.length > 220 ? `${cut.slice(0, 217).trim()}…` : cut;
}

export function dublinOf(work: Work): DublinCore {
  return {
    title: work.title,
    creator: work.author,
    subject: work.genre,
    description: work.description ?? firstSentence(work),
    publisher: work.publisher ?? "",
    contributor: work.contributor ?? "",
    date: work.date || DEFAULT_DATES[work.id] || "",
    type: work.form,
    format: work.format || "text",
    identifier: work.identifier || `foliosift:${work.id}`,
    source: work.edition,
    language: work.language,
    relation: work.relation ?? "",
    coverage: work.period,
    rights: work.rights || (work.imported ? "" : "Public domain."),
  };
}

export function applyDublin(work: Work, patch: WorkPatch): Work {
  const next = { ...dublinOf(work), ...patch };
  const ids = patch.ids ? storedIds(patch.ids) : work.ids;
  return {
    ...work,
    title: next.title || work.title,
    author: next.creator || work.author,
    genre: next.subject,
    description: next.description,
    publisher: next.publisher,
    contributor: next.contributor,
    date: next.date,
    form: next.type || work.form,
    format: next.format,
    identifier: next.identifier,
    edition: next.source,
    language: next.language || work.language,
    relation: next.relation,
    period: next.coverage,
    rights: next.rights,
    ...(ids ? { ids } : { ids: undefined }),
  };
}

/** Several creators, contributors, or languages are separated by a semicolon. A comma stays inside one name. */
export function listOf(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export const DUBLIN_LABELS: Record<DublinField, string> = {
  title: "Title",
  creator: "Creator",
  subject: "Subject",
  description: "Description",
  publisher: "Publisher",
  contributor: "Contributor",
  date: "Date",
  type: "Type",
  format: "Format",
  identifier: "Identifier",
  source: "Source",
  language: "Language",
  relation: "Relation",
  coverage: "Coverage",
  rights: "Rights",
};

/** Passage in quotation marks, then an em dash, the creator, the work, and the printed page when one was kept. */
export function formatCitation(
  text: string,
  creator: string,
  title?: string,
  heading?: string,
  page?: string,
): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const printed = page ? (/^p\.?\s/i.test(page) ? page : `p. ${page}`) : "";
  const place = [heading, printed].filter((part) => part && part.trim()).join(", ");
  const tail = [creator, title, place].filter((part) => part && part.trim()).join(", ");
  return `“${clean}” — ${tail}`;
}

export function personaSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "unknown";
}
