import assert from "node:assert/strict";
import test from "node:test";
import { pageHtmlToMarkup, publicHttpUrl, wikiAuthor, wikiPage } from "./url-page.ts";

test("a private address is refused", () => {
  assert.equal("error" in publicHttpUrl("http://127.0.0.1/secret"), true);
  assert.equal("error" in publicHttpUrl("https://192.168.1.9/book"), true);
  assert.equal("error" in publicHttpUrl("file:///etc/passwd"), true);
  assert.equal(publicHttpUrl("https://en.wikisource.org/wiki/An_Essay_on_Criticism").hostname, "en.wikisource.org");
});

test("a Wikisource article is recognized", () => {
  const url = new URL("https://en.wikisource.org/wiki/The_Works_of_Alexander_Pope_(1717)/Essay_on_Criticism");
  const page = wikiPage(url);
  assert.equal(page?.title, "The Works of Alexander Pope (1717)/Essay on Criticism");
  assert.match(page?.api ?? "", /\/w\/api\.php$/);
  assert.equal(wikiPage(new URL("https://example.com/wiki/Essay")), null);
});

test("verse lines stay lines and the page furniture is left out", () => {
  const html = `
    <div class="ws-noexport">For other versions, see elsewhere.</div>
    <div class="ws-poem">
      <div class="ws-poem-stanza">
        <span class="ws-poem-line"><span class="dropinitial"><img alt="T" /></span>is hard to say.<span class="ws-poem-break"><br /></span><span class="ws-poem-linenum">10</span></span>
        <span class="ws-poem-line">Appear in writing or in judging ill;<span class="ws-poem-break"><br /></span></span>
      </div>
    </div>
    <span class="pagenum" data-page-number="77"></span>
    <p><i>ediderunt.</i> <a href="/wiki/Author:Marcus_Fabius_Quintilianus">Quintil</a>.</p>
  `;
  const text = pageHtmlToMarkup(html);
  assert.match(text, /'Tis hard to say\.\nAppear in writing or in judging ill;/);
  assert.match(text, /:::page 77/);
  assert.match(text, /ediderunt\. Quintil/);
  assert.doesNotMatch(text, /other versions/);
  assert.doesNotMatch(text, /linenum|10/);
});

test("the contributor line names the author", () => {
  const html = `<span class="fn"><a href="/wiki/Author:Alexander_Pope">Alexander Pope</a></span>`;
  assert.equal(wikiAuthor(html), "Alexander Pope");
});
