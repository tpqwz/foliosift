import { strToU8, zipSync } from "fflate";
import { formatCitation } from "./dublin.ts";
import type { Excerpt, Work } from "./types.ts";

export type ExportKind = "text" | "json" | "epub" | "pdf";

function workOf(excerpt: Excerpt, works: Work[]): { creator: string; title: string } {
  const work = works.find((item) => item.id === excerpt.workId);
  return { creator: work?.author || excerpt.creator, title: work?.title || excerpt.title };
}

export function citeExcerpt(excerpt: Excerpt, works: Work[]): string {
  const place = workOf(excerpt, works);
  return formatCitation(excerpt.text, place.creator, place.title, excerpt.heading, excerpt.page);
}

export function excerptsToText(excerpts: Excerpt[], works: Work[]): string {
  if (!excerpts.length) return "";
  return excerpts
    .map((excerpt) => {
      const tags = excerpt.tags?.length ? `\n${excerpt.tags.join(", ")}` : "";
      return `${citeExcerpt(excerpt, works)}${tags}`;
    })
    .join("\n\n");
}

export function excerptsToJson(excerpts: Excerpt[], works: Work[]): string {
  return JSON.stringify(
    {
      name: "FolioSift excerpts",
      exported: new Date().toISOString(),
      excerpts: excerpts.map((excerpt) => {
        const place = workOf(excerpt, works);
        return {
          text: excerpt.text,
          creator: place.creator,
          title: place.title,
          heading: excerpt.heading,
          page: excerpt.page ?? "",
          tags: excerpt.tags ?? [],
          workId: excerpt.workId,
          sectionId: excerpt.sectionId,
          start: excerpt.start,
          end: excerpt.end,
          created: excerpt.created,
          source: excerpt.source,
        };
      }),
    },
    null,
    2,
  );
}

function xml(value: string): string {
  return value
    .replace(/&/g, "&" + "amp;")
    .replace(/</g, "&" + "lt;")
    .replace(/>/g, "&" + "gt;")
    .replace(/"/g, "&" + "quot;");
}

export function excerptsToEpub(excerpts: Excerpt[], works: Work[]): Uint8Array {
  const sections = excerpts
    .map((excerpt, index) => {
      const citation = citeExcerpt(excerpt, works);
      const tags = excerpt.tags?.length ? `<p class="tags">${xml(excerpt.tags.join(", "))}</p>` : "";
      return `<section id="e${index + 1}"><blockquote><p>${xml(excerpt.text)}</p></blockquote><p>${xml(citation.replace(/^“[^”]*” — /, ""))}</p>${tags}</section>`;
    })
    .join("\n");
  const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">
<head><title>FolioSift excerpts</title>
<style>body{font-family:serif;line-height:1.45;margin:1.2em}blockquote{margin:0}section{margin:0 0 1.6em}p.tags{color:#555;font-size:0.9em}</style>
</head>
<body>
<h1>FolioSift excerpts</h1>
${sections || "<p>No excerpts.</p>"}
</body>
</html>`;
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">urn:foliosift:excerpts</dc:identifier>
<dc:title>FolioSift excerpts</dc:title>
<dc:language>en</dc:language>
<meta property="dcterms:modified">${modified}</meta>
</metadata>
<manifest>
<item id="excerpts" href="excerpts.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine>
<itemref idref="excerpts"/>
</spine>
</package>`;
  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`;
  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(container),
    "OEBPS/content.opf": strToU8(opf),
    "OEBPS/excerpts.xhtml": strToU8(xhtml),
  });
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function pdfFromJpegs(pages: { data: Uint8Array; width: number; height: number }[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  let cursor = 0;
  const offsets = new Map<number, number>();
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    cursor += bytes.length;
  };
  const text = (value: string) => strToU8(value);
  const startObj = (n: number) => {
    offsets.set(n, cursor);
    push(text(`${n} 0 obj\n`));
  };
  const endObj = () => push(text("\nendobj\n"));

  push(text("%PDF-1.4\n"));
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  startObj(1);
  push(text("<< /Type /Catalog /Pages 2 0 R >>"));
  endObj();
  startObj(2);
  push(text(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`));
  endObj();

  pages.forEach((page, index) => {
    const pageObj = 3 + index * 3;
    const contentObj = pageObj + 1;
    const imageObj = pageObj + 2;
    const content = `q\n612 0 0 792 0 0 cm\n/Im${index} Do\nQ\n`;
    startObj(pageObj);
    push(
      text(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /XObject << /Im${index} ${imageObj} 0 R >> >> >>`,
      ),
    );
    endObj();
    startObj(contentObj);
    push(text(`<< /Length ${content.length} >>\nstream\n${content}endstream`));
    endObj();
    startObj(imageObj);
    push(
      text(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n`,
      ),
    );
    push(page.data);
    push(text("\nendstream"));
    endObj();
  });

  const size = 2 + pages.length * 3;
  const xrefAt = cursor;
  let xref = `xref\n0 ${size + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= size; n++) {
    xref += `${String(offsets.get(n) ?? 0).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${size + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  push(text(xref));
  return concat(chunks);
}

function wrapLines(ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

/** Pages are drawn in the browser so Greek and other scripts use the installed fonts. */
export async function excerptsToPdf(excerpts: Excerpt[], works: Work[]): Promise<Uint8Array> {
  const scale = 2;
  const width = 612 * scale;
  const height = 792 * scale;
  const margin = 54 * scale;
  const maxWidth = width - margin * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not draw the PDF.");
  await document.fonts?.ready;

  const pages: { data: Uint8Array; width: number; height: number }[] = [];
  let y = margin;

  const fresh = () => {
    ctx.fillStyle = "#f7f4ee";
    ctx.fillRect(0, 0, width, height);
    y = margin;
    ctx.fillStyle = "#5c564c";
    ctx.font = `${12 * scale}px Outfit, sans-serif`;
    ctx.fillText("FolioSift excerpts", margin, y);
    y += 28 * scale;
  };

  const snapshot = async () => {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.84));
    if (!blob) throw new Error("Could not draw the PDF.");
    pages.push({ data: new Uint8Array(await blob.arrayBuffer()), width, height });
  };

  const ensure = async (need: number) => {
    if (y + need <= height - margin) return;
    await snapshot();
    fresh();
  };

  fresh();
  if (!excerpts.length) {
    ctx.fillStyle = "#1c1915";
    ctx.font = `${16 * scale}px Newsreader, Georgia, serif`;
    ctx.fillText("No excerpts.", margin, y);
  }

  for (const excerpt of excerpts) {
    const citation = citeExcerpt(excerpt, works);
    ctx.font = `${16 * scale}px Newsreader, Georgia, serif`;
    const quote = wrapLines(ctx, `“${excerpt.text}”`, maxWidth);
    ctx.font = `${13 * scale}px Outfit, sans-serif`;
    const credit = wrapLines(ctx, citation.replace(/^“[\s\S]*” — /, ""), maxWidth);
    const tags = excerpt.tags?.length ? wrapLines(ctx, excerpt.tags.join(" · "), maxWidth) : [];
    const block = quote.length * 24 * scale + credit.length * 18 * scale + tags.length * 18 * scale + 22 * scale;
    await ensure(block);
    ctx.fillStyle = "#1c1915";
    ctx.font = `${16 * scale}px Newsreader, Georgia, serif`;
    for (const line of quote) {
      ctx.fillText(line, margin, y);
      y += 24 * scale;
    }
    ctx.fillStyle = "#5c564c";
    ctx.font = `${13 * scale}px Outfit, sans-serif`;
    for (const line of credit) {
      ctx.fillText(line, margin, y);
      y += 18 * scale;
    }
    for (const line of tags) {
      ctx.fillText(line, margin, y);
      y += 18 * scale;
    }
    y += 16 * scale;
  }
  await snapshot();
  return pdfFromJpegs(pages);
}

export function downloadBytes(filename: string, bytes: Uint8Array, type: string) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
