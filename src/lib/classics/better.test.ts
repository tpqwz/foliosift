import assert from "node:assert/strict";
import test from "node:test";
import { parseBetterBook } from "./better.ts";

test("a Better Gutenberg page is the epub, the author, and the Gutenberg number", () => {
  const html = `<div class="bg-book"><p class="bg-author">by Petronius</p><p class="bg-actions"><a class="bg-dl" href="/wp-content/uploads/2026/10/the-satyricon-1.zip" download="The Satyricon.epub">Download</a></p><p class="bg-filemeta">EPUB · 166 KB · Project Gutenberg #5611</p><p>Note that this volume is written in Latin.</p></div>`;
  assert.deepEqual(parseBetterBook(html, "The Satyricon"), {
    title: "The Satyricon",
    author: "Petronius",
    gutenberg: 5611,
    epub: "/wp-content/uploads/2026/10/the-satyricon-1.zip",
    language: "Latin",
  });
  assert.equal(parseBetterBook("<p>No file</p>", "Untitled"), null);
});
