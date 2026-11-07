import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";
import { asCatalog } from "./catalog.ts";
import { docxToWork } from "./docx.ts";
import { epubToWork } from "./epub.ts";
import { htmlToMarkup } from "./html-text.ts";
import { chunkWork, omitContentsEcho, pageAt, pageRange, parseImport, toFolioMarkup } from "./markup.ts";
import { mobiToWork, palmdocDecompress, stripTrail } from "./mobi.ts";
import { pdfToWork } from "./pdf.ts";
import { WORKS } from "./works.ts";

const enc = new TextEncoder();

test("folio markdown keeps chapters and printed pages out of the indexed text", () => {
  const raw = `---
title: "On gardens"
creator: "A reader"
language: English
---

# Gardens

## First bed

The vine does not negotiate, and the fig keeps its own calendar through the year.

:::page 12

Write the names of what you planted, because memory is a poor index.
`;
  const work = parseImport(raw, "gardens.md");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.title, "On gardens");
  assert.equal(work.author, "A reader");
  assert.match(work.sections[0]?.heading ?? "", /First bed/);
  assert.equal(work.sections[0]?.pages?.[0]?.label, "12");
  assert.ok(!work.sections.some((section) => section.text.includes(":::page") || section.text.includes("page 12")));
  assert.equal(pageAt(work.sections[0]?.pages, work.sections[0]?.pages?.[0]?.offset ?? 0), "12");
  const again = parseImport(toFolioMarkup(work), "gardens.md");
  assert.ok(!("error" in again));
  if ("error" in again) return;
  assert.equal(again.sections[0]?.text, work.sections[0]?.text);
  assert.equal(again.sections[0]?.pages?.[0]?.label, "12");
  assert.equal(again.sections[0]?.pages?.[0]?.offset, work.sections[0]?.pages?.[0]?.offset);
});

test("a page mark stays with the prose after a long chapter is split", () => {
  const early = "The vine does not negotiate. ".repeat(220);
  const late = "The fig keeps its calendar. ".repeat(220);
  const work = chunkWork({
    id: "bulk",
    title: "Bulk",
    author: "Homer",
    language: "Greek",
    form: "Verse",
    period: "Archaic",
    genre: "Epic",
    edition: "Test",
    sections: [
      {
        id: "bulk-1",
        heading: "Book 1",
        text: `${early}${late}`,
        pages: [
          { offset: 0, label: "4" },
          { offset: early.length, label: "5" },
        ],
      },
    ],
  });
  assert.ok(work.sections.length > 1);
  assert.ok(work.sections.every((section) => section.text.length <= 6000));
  const labels = work.sections.flatMap((section) => section.pages?.map((page) => page.label) ?? []);
  assert.ok(labels.includes("4"));
  assert.ok(labels.includes("5"));
  const second = work.sections.find((section) => section.pages?.some((page) => page.label === "5"));
  assert.equal(pageAt(second?.pages, 0), "4");
});

test("the old header block still imports", () => {
  const work = parseImport(
    `Title: On gardens\nAuthor: A reader\n\n---\n## First bed\nA garden is a small city with a stricter law. The vine does not negotiate, and the fig keeps its own calendar.\n`,
    "note.md",
  );
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.title, "On gardens");
  assert.match(work.sections[0]?.text ?? "", /stricter law/);
});

test("html keeps a heading and a printed page", () => {
  const markup = htmlToMarkup(
    `<h1>Book 1</h1><p>Sing, goddess, the wrath of Achilles and the ruin it dragged.</p><span epub:type="pagebreak" id="p14" title="14"></span><p>The hero laid his hand upon the sword and held it.</p>`,
    new Map([["p14", "14"]]),
  );
  const work = parseImport(markup, "iliad.html");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.match(work.sections[0]?.heading ?? "", /Book 1/);
  assert.equal(work.sections[0]?.pages?.[0]?.label, "14");
  assert.match(work.sections[0]?.text ?? "", /dragged\.\n\nThe hero/);
  assert.ok(!work.sections[0]?.text.includes("pagebreak"));
});

test("epub spine becomes chapters with the page-list", async () => {
  const chapter = `<html><body><h1>First bed</h1><p>A garden is a small city with a stricter law, and the vine does not negotiate.</p><span epub:type="pagebreak" id="pg2" title="2"></span><p>Write the names of what you planted beside the row.</p></body></html>`;
  const nav = `<html><body><nav epub:type="page-list"><ol><li><a href="chap.xhtml#pg2">2</a></li></ol></nav></body></html>`;
  const opf = `<?xml version="1.0"?><package><metadata><dc:title>On gardens</dc:title><dc:creator>A reader</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="c" href="chap.xhtml" media-type="application/xhtml+xml"/><item id="n" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`;
  const zip = zipSync({
    "META-INF/container.xml": enc.encode(container),
    "OEBPS/content.opf": enc.encode(opf),
    "OEBPS/chap.xhtml": enc.encode(chapter),
    "OEBPS/nav.xhtml": enc.encode(nav),
  });
  const work = await epubToWork(zip, "gardens.epub");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.title, "On gardens");
  assert.equal(work.author, "A reader");
  assert.equal(work.language, "English");
  assert.equal(work.sections[0]?.pages?.[0]?.label, "2");
  assert.match(work.sections[0]?.text ?? "", /stricter law/);
});

test("a prefixed package, a font obfuscation file, and a contents entry still open", async () => {
  const chapter = `<html><head><title>SHOULD NOT APPEAR AS PROSE</title></head><body><p>A garden is a small city with a stricter law, and the vine does not negotiate with the weather at all.</p></body></html>`;
  const ncx = `<?xml version="1.0"?><ncx><navMap><navPoint><navLabel><text>First bed</text></navLabel><content src="chap%20one.xhtml"/></navPoint></navMap></ncx>`;
  const opf = `<?xml version="1.0"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <opf:metadata><dc:title>On gardens</dc:title><dc:creator>A reader</dc:creator><dc:language>en</dc:language></opf:metadata>
  <opf:manifest>
    <opf:item opf:id="c" opf:href="chap%20one.xhtml" opf:media-type="application/xhtml+xml"/>
    <opf:item opf:id="n" opf:href="toc.ncx" opf:media-type="application/x-dtbncx+xml"/>
  </opf:manifest>
  <opf:spine><opf:itemref opf:idref="c"/></opf:spine>
</opf:package>`;
  const encryption = `<?xml version="1.0"?><encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/Fonts/Serif.otf"/></enc:CipherData></enc:EncryptedData></encryption>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`;
  const zip = zipSync({
    "META-INF/container.xml": enc.encode(container),
    "META-INF/encryption.xml": enc.encode(encryption),
    "OEBPS/content.opf": enc.encode(opf),
    "OEBPS/chap one.xhtml": enc.encode(chapter),
    "OEBPS/toc.ncx": enc.encode(ncx),
  });
  const work = await epubToWork(zip, "gardens.epub");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.title, "On gardens");
  assert.match(work.sections.map((section) => section.heading).join(" "), /First bed/);
  assert.match(work.sections.map((section) => section.text).join("\n"), /stricter law/);
  assert.ok(!work.sections.some((section) => section.text.includes("SHOULD NOT")));
});

test("a utf-16 package document still opens", async () => {
  const chapter = `<html><body><h1>First bed</h1><p>A garden is a small city with a stricter law, and the vine does not negotiate.</p></body></html>`;
  const opf = `<?xml version="1.0"?><package><metadata><dc:title>On gardens</dc:title><dc:creator>A reader</dc:creator><dc:language>en</dc:language></metadata><manifest><item id="c" href="chap.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
  const utf16 = new Uint8Array(Buffer.from(`\uFEFF${container}`, "utf16le"));
  const zip = zipSync({
    "META-INF/container.xml": utf16,
    "content.opf": enc.encode(opf),
    "chap.xhtml": enc.encode(chapter),
  });
  const work = await epubToWork(zip, "gardens.epub");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.title, "On gardens");
  assert.match(work.sections[0]?.text ?? "", /stricter law/);
});

test("an encrypted chapter is refused and a font is not", async () => {
  const chapter = `<html><body><p>A garden is a small city with a stricter law, and the vine does not negotiate with anyone.</p></body></html>`;
  const opf = `<?xml version="1.0"?><package><metadata><dc:title>Locked</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c" href="chap.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const encryption = `<?xml version="1.0"?><encryption xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/chap.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`;
  const zip = zipSync({
    "META-INF/container.xml": enc.encode(container),
    "META-INF/encryption.xml": enc.encode(encryption),
    "OEBPS/content.opf": enc.encode(opf),
    "OEBPS/chap.xhtml": enc.encode(chapter),
  });
  const work = await epubToWork(zip, "locked.epub");
  assert.ok("error" in work);
  if (!("error" in work)) return;
  assert.match(work.error, /locked/i);
});

test("a wrapped epub, a root href, and a multiline description still open", async () => {
  const chapter = `<html><body><h1>First bed</h1><p>A garden is a small city with a stricter law, and the vine does not negotiate.</p></body></html>`;
  const opf = `<?xml version="1.0"?><package><metadata><dc:title>On gardens</dc:title><dc:creator>A reader</dc:creator><dc:language>en</dc:language><dc:description>A note\nabout beds.</dc:description></metadata><manifest><item id="c" href="/OEBPS/chap.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`;
  const inner = zipSync({
    "META-INF/container.xml": enc.encode(container),
    "OEBPS/content.opf": enc.encode(opf),
    "OEBPS/chap.xhtml": enc.encode(chapter),
  });
  const wrapped = zipSync({ "On gardens.epub": inner });
  const work = await epubToWork(wrapped, "gardens.epub");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.title, "On gardens");
  assert.match(work.description ?? "", /about beds/);
  assert.match(work.sections[0]?.text ?? "", /stricter law/);
});

function kindle(html: string): Uint8Array {
  const text = enc.encode(html);
  const rec0 = new Uint8Array(16);
  const head = new DataView(rec0.buffer);
  head.setUint16(0, 1);
  head.setUint32(4, text.length);
  head.setUint16(8, 1);
  head.setUint16(10, 4096);
  const rec0At = 78 + 16;
  const textAt = rec0At + rec0.length;
  const out = new Uint8Array(textAt + text.length);
  const view = new DataView(out.buffer);
  out.set(enc.encode("BOOKMOBI"), 60);
  view.setUint16(76, 2);
  view.setUint32(78, rec0At);
  view.setUint32(86, textAt);
  out.set(rec0, rec0At);
  out.set(text, textAt);
  return out;
}

test("palmdoc round trip and a kindle html book", () => {
  const compressed = palmdocDecompress(Uint8Array.of(0x61, 0x62, 0x63, 0x80, 0x18));
  assert.equal(new TextDecoder().decode(compressed), "abcabc");
  const hello = enc.encode("hello");
  const flagged = stripTrail(Uint8Array.of(...hello, 0x81), 0x2);
  assert.equal(new TextDecoder().decode(flagged), "hello");

  const html = `<html><body><h1>First bed</h1><p>A garden is a small city with a stricter law. The vine does not negotiate with the weather.</p><mbp:pagebreak title="9"/><p>Write the names of what you planted in the row.</p></body></html>`;
  const work = mobiToWork(kindle(html), "gardens.mobi");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.match(work.sections[0]?.heading ?? "", /First bed/);
  assert.equal(work.sections[0]?.pages?.[0]?.label, "9");
  assert.match(work.sections[0]?.text ?? "", /stricter law/);
});

test("a word file keeps its heading and a saved page break", () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>First bed</w:t></w:r></w:p><w:p><w:r><w:t>A garden is a small city with a stricter law. The vine does not negotiate.</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/><w:t>Write the names of what you planted beside the row today.</w:t></w:r></w:p></w:body></w:document>`;
  const work = docxToWork(zipSync({ "word/document.xml": enc.encode(xml) }), "gardens.docx");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.match(work.sections.map((section) => section.heading).join(" "), /First bed/);
  assert.ok(work.sections.some((section) => section.pages?.some((page) => page.label === "1")));
  assert.match(work.sections.map((section) => section.text).join("\n"), /stricter law/);
});

test("a typeset pdf keeps spaces, the heading, and the page", async () => {
  const stream = "BT /F1 24 Tf 72 700 Td (First bed) Tj /F1 12 Tf 0 -40 Td (A garden is a small city with a stricter law.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
  ];
  let pdf = "%PDF-1.4\n";
  const xref = [0];
  objects.forEach((body, index) => {
    xref.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${xref.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i++) pdf += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const work = await pdfToWork(enc.encode(pdf), "gardens.pdf");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.match(work.sections.map((section) => section.heading).join(" "), /First bed/);
  assert.match(work.sections.map((section) => section.text).join(" "), /small city/);
  assert.ok(work.sections.some((section) => section.pages?.some((page) => page.label === "1")));
});

test("overprinted pdf text is kept once", async () => {
  const once = "A garden is a small city with a stricter law.";
  const other = "The vine does not negotiate with the weather at all.";
  const doubled = [...other].map((ch) => (ch === " " ? " " : ch + ch)).join("");
  const stream = `BT /F1 24 Tf 72 700 Td (First bed) Tj /F1 12 Tf 0 -40 Td (${once}) Tj 0 0 Td (${once}) Tj 0 -20 Td (${doubled}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>",
  ];
  let pdf = "%PDF-1.4\n";
  const xref = [0];
  objects.forEach((body, index) => {
    xref.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${xref.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i++) pdf += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  const work = await pdfToWork(enc.encode(pdf), "gardens.pdf");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  const prose = work.sections.map((section) => section.text).join(" ");
  assert.equal(prose.match(/small city/g)?.length ?? 0, 1);
  assert.match(prose, /vine does not negotiate/);
  assert.doesNotMatch(prose, /TThhee|vviinnee|nneeggoo/);
});

function pdfOf(streams: string[]): string {
  const font = "<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>";
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", font];
  const kids: string[] = [];
  streams.forEach((stream, index) => {
    const pageId = objects.length + 1;
    const contentsId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentsId} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    void index;
  });
  objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${streams.length} >>`;
  let pdf = "%PDF-1.4\n";
  const xref = [0];
  objects.forEach((body, index) => {
    xref.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const start = pdf.length;
  pdf += `xref\n0 ${xref.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < xref.length; i++) pdf += `${String(xref[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${xref.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return pdf;
}

test("a typeset pdf keeps a short last line as its own paragraph", async () => {
  const full = "This is one full line of a paragraph that runs across the measure of the page.";
  const more = "This is another full line of that same paragraph, still reaching the measure.";
  const again = "This is a third full line of that same paragraph, still reaching the measure.";
  const end = "It ends here.";
  const next = "This is the next paragraph, and it should not stick to the one that ended above.";
  const stream = `BT /F1 12 Tf 72 700 Td (${full}) Tj 0 -14 Td (${more}) Tj 0 -14 Td (${again}) Tj 0 -14 Td (${end}) Tj 0 -14 Td (${next}) Tj ET`;
  const work = await pdfToWork(enc.encode(pdfOf([stream])), "paras.pdf");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  const prose = work.sections.map((section) => section.text).join("\n");
  assert.match(prose, /measure\. It ends here\./);
  assert.match(prose, /here\.\n\nThis is the next paragraph/);
});

test("a footer printed on every page is left out of the text", async () => {
  const page = "BT /F1 12 Tf 72 700 Td (A garden is a small city with a stricter law.) Tj ET BT /F1 9 Tf 180 24 Td (ww.gandhimedia.org) Tj ET";
  const work = await pdfToWork(enc.encode(pdfOf([page, page, page])), "gandhi.pdf");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  const prose = work.sections.map((section) => section.text).join("\n");
  assert.match(prose, /small city/);
  assert.doesNotMatch(prose, /gandhimedia/i);
});

test("two columns are read one after the other", async () => {
  const left = "BT /F1 12 Tf 72 700 Td (aei) Tj 0 -18 Td (de) Tj 0 -18 Td (kai) Tj 0 -18 Td (psyche) Tj ET";
  const right = "BT /F1 12 Tf 380 700 Td (always) Tj 0 -18 Td (and) Tj 0 -18 Td (the) Tj 0 -18 Td (soul) Tj ET";
  const work = await pdfToWork(enc.encode(pdfOf([left + right])), "loeb.pdf");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  const prose = work.sections.map((section) => section.text).join("\n");
  assert.ok(prose.includes("psyche") && prose.indexOf("psyche") < prose.indexOf("always"));
  assert.doesNotMatch(prose, /aei\s+always/);
});

test("a page of verse stays in lines, and a smaller note stays off the stanza", async () => {
  const lines = [
    "'Tis hard to say, if greater want of skill",
    "Appear in writing or in judging ill;",
    "But, of the two, less dang'rous is th' offence",
    "To tire our patience, than mislead our sense:",
    "Some few in that, but numbers err in this,",
    "Ten censure wrong for one who writes amiss;",
    "A fool might once himself alone expose,",
    "Now one in verse makes many more in prose.",
    "Yet if we look more closely, we shall find",
    "Most have the seeds of judgment in their mind:",
    "Nature affords at least a glimm'ring light;",
    "The lines, tho' touch'd but faintly, are drawn right.",
  ];
  let body = "BT /F1 11 Tf 72 700 Td";
  lines.forEach((line, index) => {
    body += `${index === 0 ? "" : " 0 -16 Td"} (${line}) Tj`;
  });
  body += " ET BT /F1 8 Tf 72 90 Td (1 The vine keeps its own calendar.) Tj ET";
  const work = await pdfToWork(enc.encode(pdfOf([body])), "essay.pdf");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  const prose = work.sections.map((section) => section.text).join("\n");
  assert.match(prose, /judging ill;\nBut,/);
  assert.match(prose, /own calendar/);
  assert.doesNotMatch(prose, /drawn right\. 1 The vine/);
  assert.equal(work.form, "Verse");
});

test("serial and item numbers survive a round trip", () => {
  const raw = `---
title: On gardens
creator: A reader
identifier: urn:isbn:9780140449112
issn: 1234-567X
ismn: 979-0-2600-0043-8
isan: ISAN 0000-0000-3AB4-0000-0-0000-0000-0
asin: B00TEST123
wikidata: Q42
---

## First bed

The vine does not negotiate, and the fig keeps its own calendar through the year of planting.
`;
  const work = parseImport(raw, "gardens.md");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.ids?.isbn, "9780140449112");
  assert.equal(work.ids?.issn, "1234-567X");
  assert.equal(work.ids?.ismn, "979-0-2600-0043-8");
  assert.equal(work.ids?.asin, "B00TEST123");
  assert.equal(work.ids?.wikidata, "Q42");
  assert.match(work.ids?.isan ?? "", /ISAN/);
  const again = parseImport(toFolioMarkup(work), "gardens.md");
  assert.ok(!("error" in again));
  if ("error" in again) return;
  assert.equal(again.ids?.isbn, work.ids?.isbn);
  assert.equal(again.ids?.wikidata, "Q42");
  assert.equal(again.ids?.asin, "B00TEST123");
});

test("an epub identifier with a scheme is filed", async () => {
  const chapter = `<html><body><p>A garden is a small city with a stricter law, and the vine does not negotiate with the weather at all.</p></body></html>`;
  const opf = `<?xml version="1.0"?><package><metadata><dc:title>On gardens</dc:title><dc:creator>A reader</dc:creator><dc:language>en</dc:language><dc:identifier opf:scheme="ISBN">978-0-14-044911-2</dc:identifier><dc:identifier>urn:issn:0028-0836</dc:identifier></metadata><manifest><item id="c" href="chap.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
  const zip = zipSync({
    "META-INF/container.xml": enc.encode(container),
    "content.opf": enc.encode(opf),
    "chap.xhtml": enc.encode(chapter),
  });
  const work = await epubToWork(zip, "gardens.epub");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.ids?.isbn, "978-0-14-044911-2");
  assert.equal(work.ids?.issn, "0028-0836");
});

test("several creators, an editor, and two languages stay distinct", async () => {
  const chapter = `<html><body><p>A garden is a small city with a stricter law, and the vine does not negotiate with the weather at all.</p></body></html>`;
  const opf = `<?xml version="1.0"?><package><metadata><dc:title>On gardens</dc:title><dc:creator>Homer</dc:creator><dc:creator opf:role="aut">Hesiod</dc:creator><dc:contributor opf:role="edt">A reader</dc:contributor><dc:language>grc</dc:language><dc:language>en</dc:language></metadata><manifest><item id="c" href="chap.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
  const zip = zipSync({
    "META-INF/container.xml": enc.encode(container),
    "content.opf": enc.encode(opf),
    "chap.xhtml": enc.encode(chapter),
  });
  const work = await epubToWork(zip, "gardens.epub");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.author, "Homer; Hesiod");
  assert.equal(work.contributor, "A reader");
  assert.equal(work.language, "English");
});

test("the sample shelf carries the work's item numbers", () => {
  const iliad = WORKS.find((work) => work.id === "iliad");
  assert.equal(iliad?.ids?.wikidata, "Q8275");
  assert.equal(iliad?.ids?.openlibrary, "OL34610657W");
  assert.equal(iliad?.language, "English");
  assert.equal(WORKS.every((work) => work.language === "English"), true);
  assert.equal(WORKS.find((work) => work.id === "peloponnesian")?.ids?.wikidata, "Q639493");
  assert.equal(WORKS.every((work) => work.ids?.wikidata || work.ids?.lccn || work.ids?.openlibrary), true);
  assert.equal(WORKS.find((work) => work.id === "iliad")?.cover, "/covers/iliad.jpg");
  assert.equal(WORKS.find((work) => work.id === "apology")?.cover, "/covers/apology.jpg");
  assert.equal(iliad?.sections.length, 0);
  assert.match(iliad?.edition ?? "", /Butler/);
  assert.match(WORKS.find((work) => work.id === "letters")?.edition ?? "", /Gummere/);
});

test("an epub cover image is kept off the text", async () => {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const chapter = `<html><body><p>A garden is a small city with a stricter law, and the vine does not negotiate with the weather at all.</p></body></html>`;
  const opf = `<?xml version="1.0"?><package><metadata><dc:title>On gardens</dc:title><dc:language>en</dc:language><meta name="cover" content="img"/></metadata><manifest><item id="c" href="chap.xhtml" media-type="application/xhtml+xml"/><item id="img" href="cover.png" media-type="image/png"/></manifest><spine><itemref idref="c"/></spine></package>`;
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>`;
  const zip = zipSync({
    "META-INF/container.xml": enc.encode(container),
    "content.opf": enc.encode(opf),
    "chap.xhtml": enc.encode(chapter),
    "cover.png": new Uint8Array(png),
  });
  const work = await epubToWork(zip, "gardens.epub");
  assert.ok(!("error" in work));
  if ("error" in work) return;
  assert.equal(work.coverType, "image/png");
  assert.equal(work.coverBytes?.[0], 0x89);
  assert.equal(asCatalog(work).coverBytes, undefined);
  assert.ok(!work.sections.some((section) => section.text.includes("cover.png")));
});

test("a translation keeps the language of the publication", () => {
  const english = parseImport(
    "---\nlanguage: Greek\n---\n\n# The end\n\nThe good for a human being has to fit a human work, not the work of a horse or a knife, and the city judges a life by what it does with the years it is given.\n",
    "ethics.md",
  );
  assert.ok(!("error" in english));
  if (!("error" in english)) assert.equal(english.language, "English");
  const greek = parseImport(
    "---\nlanguage: Greek\n---\n\n# Opening\n\nμῆνιν ἄειδε θεὰ Πηληϊάδεω Ἀχιλῆος οὐλομένην ἣ μυρί Ἀχαιοῖς ἄλγε ἔθηκε πολλὰς δ ἰφθίμους ψυχὰς Ἄϊδι προΐαψεν ἡρώων αὐτοὺς δὲ ἑλώρια τεῦχε κύνεσσιν\n",
    "iliad.md",
  );
  assert.ok(!("error" in greek));
  if (!("error" in greek)) assert.equal(greek.language, "Greek");
});

test("a selection that crosses a printed page keeps both labels", () => {
  const pages = [
    { offset: 0, label: "12" },
    { offset: 40, label: "13" },
  ];
  assert.equal(pageAt(pages, 10), "12");
  assert.equal(pageRange(pages, 10, 20), "12");
  assert.equal(pageRange(pages, 30, 50), "12–13");
});

test("a contents list that only repeats the chapters is not also the opening text", () => {
  const chapter = (heading: string, text: string) => ({ id: heading, heading, text });
  const kept = omitContentsEcho([
    chapter("Contents", "Book I\nBook II\nBook III\nBook IV"),
    chapter("Book I", "Sing, O goddess, the anger of Achilles son of Peleus, that brought countless ills upon the Achaeans."),
    chapter("Book II", "Now the rest of the gods, and all the men who were chiefs and princes, were asleep."),
    chapter("Book III", "When the companies were thus arrayed, the Trojans advanced as a flight of wild fowl."),
    chapter("Book IV", "Now the gods were sitting in the hall of Jove discussing the matter."),
  ]);
  assert.deepEqual(kept.map((section) => section.heading), ["Book I", "Book II", "Book III", "Book IV"]);
  const prose = omitContentsEcho([
    chapter("Book I", "Sing, O goddess, the anger of Achilles son of Peleus, that brought countless ills upon the Achaeans and the city."),
    chapter("Book II", "Now the rest of the gods were asleep throughout the night, but Jove was awake."),
  ]);
  assert.equal(prose.length, 2);
});



