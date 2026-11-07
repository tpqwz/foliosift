import assert from "node:assert/strict";
import test from "node:test";
import type { Work } from "../corpus/types";
import type { WorkHit } from "./engine";
import { dot, foldSemantic, originalSpan, parseMeaning, prefixPassage, prefixQuery, textHash, unit, windows } from "./semantic.ts";

function work(id: string, title: string): Work {
  return {
    id,
    title,
    author: "A",
    language: "English",
    form: "Prose",
    period: "Classical",
    genre: "Philosophy",
    edition: "Test",
    sections: [],
  };
}

function hit(id: string, title: string, score: number): WorkHit {
  return { work: work(id, title), score, matchCount: 1, sections: [] };
}

test("windows stay short enough for the embedding models", () => {
  assert.equal(windows("too short").length, 0);
  const one = windows("a".repeat(200));
  assert.equal(one.length, 1);
  const many = windows("word ".repeat(500));
  assert.ok(many.length > 1);
  assert.ok(many.every((piece) => piece.text.length <= 900));
});

test("only the E5 model is told which text is the query", () => {
  assert.equal(prefixQuery("e5", "the good life"), "query: the good life");
  assert.equal(prefixPassage("e5", "eudaimonia"), "passage: eudaimonia");
  assert.equal(prefixQuery("gemma", "the good life"), "the good life");
});

test("a normalized vector dotted with itself is one", () => {
  const vector = unit([3, 4]);
  assert.ok(Math.abs(dot(vector, vector) - 1) < 1e-6);
  assert.equal(textHash("same"), textHash("same"));
  assert.notEqual(textHash("same"), textHash("other"));
});

test("a meaning window maps back onto the original paragraph", () => {
  const text = "Hello   world and more";
  assert.deepEqual(originalSpan(text, 0, 5), { start: 0, end: 5 });
  assert.deepEqual(originalSpan(text, 6, 11), { start: 8, end: 13 });
  const at = "mean:ethics-1:120:1020";
  assert.equal(parseMeaning(at)?.sectionId, "ethics-1");
  assert.equal(parseMeaning(at)?.start, 120);
});

test("word matches stay ahead of meaning-only matches", () => {
  const lexical = [hit("ethics", "Ethics", 2)];
  const found = [
    { work: work("iliad", "Iliad"), sectionId: "iliad-1", heading: "Book I", start: 0, preview: "wrath", score: 0.9 },
    { work: work("ethics", "Ethics"), sectionId: "ethics-1", heading: "Book I", start: 12, preview: "the good", score: 0.5 },
  ];
  const folded = foldSemantic(lexical, found, true);
  assert.equal(folded[0]?.work.id, "ethics");
  assert.equal(folded[1]?.work.id, "iliad");
  assert.equal(foldSemantic(lexical, found, false).some((item) => item.work.id === "iliad"), false);
});
