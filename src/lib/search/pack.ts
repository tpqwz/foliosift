import type { Work } from "../corpus/types";
import type { ShippedSection, ShippedWork } from "./shipped";
import { tokenize } from "./tokenize";

export function workStamp(work: Work): string {
  let chars = 0;
  for (const section of work.sections) chars += section.text.length + section.heading.length;
  return `${work.sections.length}:${chars}`;
}

/** The same posting pack the shelf index writes, without asking the device to tokenize again on restore. */
export function packWork(work: Work): ShippedWork {
  const sections: ShippedSection[] = work.sections.map((section) => {
    const body = tokenize(section.text);
    const heading = tokenize(section.heading);
    const postings = new Map<string, number[]>();
    const add = (kind: string, word: string, pos: number) => {
      if (word.length > 64) return;
      const key = `${kind}:${word}`;
      const list = postings.get(key);
      if (list) list.push(pos);
      else postings.set(key, [pos]);
    };
    body.forEach((token, pos) => {
      add("bn", token.norm, pos);
      add("bs", token.stem, pos);
    });
    heading.forEach((token, pos) => {
      add("hn", token.norm, pos);
      add("hs", token.stem, pos);
    });
    return { id: section.id, heading: section.heading, dl: body.length + heading.length, postings };
  });
  return { stamp: workStamp(work), sections };
}
