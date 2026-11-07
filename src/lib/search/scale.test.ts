import assert from "node:assert/strict";
import test from "node:test";
import { chunkWork } from "../corpus/import.ts";
import { aimedSection, aimedToken } from "./aim.ts";
import { concatPostings, encodePostings, visitPostings } from "./postings.ts";
import { normalize, tokenize } from "./tokenize.ts";

test("greek and latin accents share an index key", () => {
  assert.equal(normalize("Ἄνδρα"), "ανδρα");
  assert.equal(normalize("ἄνδρα"), normalize("ανδρα"));
  assert.equal(normalize("Āeneid"), "aeneid");
  const tokens = tokenize("μῆνιν ἄειδε θεὰ");
  assert.equal(tokens[0]?.norm, "μηνιν");
  assert.equal(tokens[0]?.start, 0);
  assert.ok((tokens[0]?.end ?? 0) > tokens[0]!.start);
});

test("posting blobs append without decoding the previous volume", () => {
  const first = encodePostings([{ si: 1, pos: [0, 4] }]);
  const next = concatPostings(first, [{ si: 9, pos: [2] }]);
  const seen: [number, number[]][] = [];
  visitPostings(next, (si, pos) => {
    seen.push([si, Array.from(pos)]);
  });
  assert.deepEqual(seen, [
    [1, [0, 4]],
    [9, [2]],
  ]);
  assert.ok(next.byteLength > first.byteLength);
});

test("a long book is split into sections a search can load one at a time", () => {
  const paragraph = "The wrath of Achilles filled the camp. ";
  const work = chunkWork({
    id: "bulk",
    title: "Bulk",
    author: "Homer",
    language: "Greek",
    form: "Verse",
    period: "Archaic",
    genre: "Epic",
    edition: "Test",
    sections: [{ id: "bulk-1", heading: "Book 1", text: paragraph.repeat(400) }],
  });
  assert.ok(work.sections.length > 1);
  assert.ok(work.sections.every((section) => section.text.length <= 6000));
  assert.equal(work.sections[0]?.heading, "Book 1");
  assert.match(work.sections[1]?.heading ?? "", /Book 1/);
});

test("a result link names its section and token before the volume is open", () => {
  const at = "m-acton-12-p3-842";
  assert.deepEqual(aimedToken(at), { sectionId: "acton-12-p3", token: 842 });
  assert.equal(aimedSection(at), "acton-12-p3");
  assert.equal(aimedSection("ethics-1:462:549"), "ethics-1");
  assert.equal(aimedSection("ethics-1"), "ethics-1");
  assert.equal(aimedSection("mean:ethics-1:120:1020"), "ethics-1");
  assert.equal(aimedToken("ethics-1"), null);
});
