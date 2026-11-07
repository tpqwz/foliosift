import assert from "node:assert/strict";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { excerptsToEpub, excerptsToJson, excerptsToText } from "./export-excerpts.ts";
import type { Excerpt } from "./types.ts";

const excerpt: Excerpt = {
  id: "ex-1",
  workId: "ethics",
  sectionId: "ethics-1",
  heading: "The end",
  text: "The good for a human being has to fit a human work.",
  start: 10,
  end: 60,
  created: 1,
  title: "Nicomachean Ethics",
  creator: "Aristotle",
  source: "Ross",
  page: "12",
  tags: ["virtue"],
};

test("excerpt collection exports text, json, and an epub", () => {
  const text = excerptsToText([excerpt], []);
  assert.match(text, /human work/);
  assert.match(text, /Aristotle, Nicomachean Ethics, The end, p\. 12/);
  assert.match(text, /virtue/);

  const parsed = JSON.parse(excerptsToJson([excerpt], [])) as { excerpts: { tags: string[] }[] };
  assert.equal(parsed.excerpts[0]?.tags[0], "virtue");

  const files = unzipSync(excerptsToEpub([excerpt], []));
  assert.equal(strFromU8(files.mimetype), "application/epub+zip");
  assert.match(strFromU8(files["OEBPS/excerpts.xhtml"]), /human work/);
  assert.match(strFromU8(files["OEBPS/content.opf"]), /FolioSift excerpts/);
});
