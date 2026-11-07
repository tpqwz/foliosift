import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import { once } from "node:events";
import { createGzip } from "node:zlib";
import { chunkWork } from "../src/lib/corpus/markup.ts";
import { SAMPLE_STAMPS } from "../src/lib/corpus/sample-stamps.ts";
import { WORKS } from "../src/lib/corpus/works.ts";
import type { Section, Work } from "../src/lib/corpus/types.ts";
import { tokenize } from "../src/lib/search/tokenize.ts";

function u32(value: number): Buffer {
  const head = Buffer.allocUnsafe(4);
  head.writeUInt32LE(value >>> 0, 0);
  return head;
}

function text(value: string): Buffer {
  const data = Buffer.from(value);
  return Buffer.concat([u32(data.length), data]);
}

function sectionBytes(section: { id: string; heading: string; text: string }): Buffer {
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
  const parts: Buffer[] = [text(section.id), text(section.heading), u32(body.length + heading.length)];
  for (const kind of ["bn", "bs", "hn", "hs"]) {
    const terms = [...postings.entries()].filter(([key]) => key.startsWith(`${kind}:`));
    parts.push(u32(terms.length));
    for (const [key, positions] of terms) {
      parts.push(text(key.slice(3)), u32(positions.length));
      const row = Buffer.allocUnsafe(positions.length * 4);
      for (let i = 0; i < positions.length; i++) row.writeUInt32LE(positions[i] >>> 0, i * 4);
      parts.push(row);
    }
  }
  return Buffer.concat(parts);
}

function prepared(meta: Work): { stamp: string; sections: Section[] } {
  const data = JSON.parse(readFileSync(`public/samples/${meta.id}.json`, "utf8")) as {
    sections?: { heading?: string; text?: string }[];
  };
  const sections: Section[] = [];
  for (const [index, section] of (data.sections ?? []).entries()) {
    const body = section.text ?? "";
    if (!body.trim()) continue;
    sections.push({
      id: `${meta.id}-${sections.length + 1}`,
      heading: section.heading?.trim() || `Section ${index + 1}`,
      text: body,
    });
  }
  const work = chunkWork({ ...meta, sections });
  let chars = 0;
  for (const section of work.sections) chars += section.text.length + section.heading.length;
  const stamp = `${work.sections.length}:${chars}`;
  if (stamp !== SAMPLE_STAMPS[meta.id]) console.log(`stamp ${meta.id} ${SAMPLE_STAMPS[meta.id]} -> ${stamp}`);
  return { stamp, sections: work.sections };
}

mkdirSync("public/shelf-index", { recursive: true });
const stamps: Record<string, string> = {};
const only = new Set(process.argv.slice(2));
for (const meta of WORKS) {
  if (only.size && !only.has(meta.id)) continue;
  const work = prepared(meta);
  stamps[meta.id] = work.stamp;
  const file = `public/shelf-index/${meta.id}.bin`;
  const gzip = createGzip({ level: 6 });
  const out = createWriteStream(file);
  gzip.pipe(out);
  gzip.write(Buffer.from("FSIX"));
  gzip.write(text(work.stamp));
  gzip.write(u32(work.sections.length));
  for (const section of work.sections) {
    if (!gzip.write(sectionBytes(section))) await once(gzip, "drain");
  }
  gzip.end();
  await once(out, "finish");
  console.log(`${meta.id} ${work.sections.length} sections`);
}
console.log(JSON.stringify(stamps, null, 2));
