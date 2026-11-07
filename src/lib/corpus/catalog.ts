import type { Work } from "./types";

/** Shelf record. Section prose stays in IndexedDB; headings stay here for navigation. */
export function asCatalog(work: Work): Work {
  const text = work.sections[0]?.text ?? "";
  const sentence = text.split(/(?<=\.)\s/)[0] ?? "";
  const brief = sentence.length > 220 ? `${sentence.slice(0, 217).trim()}…` : sentence;
  const next: Work = {
    ...work,
    description: work.description || brief,
    sections: work.sections.map((section) => ({ id: section.id, heading: section.heading, text: "" })),
  };
  delete next.coverBytes;
  delete next.coverType;
  return next;
}
