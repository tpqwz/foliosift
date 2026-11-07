import { decodeEntities } from "./html-text.ts";
import { parseImport, titleFromName, yamlValue } from "./markup.ts";
import type { Work } from "./types";
import { unzip, zipText } from "./zip.ts";

/** Word’s saved page breaks, not a fresh layout. Headings stay headings. */
export function docxToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  let files: Map<string, Uint8Array>;
  try {
    files = unzip(bytes);
  } catch {
    return { error: `${filename} is not a readable Word file.` };
  }
  const xml = zipText(files, "word/document.xml");
  if (!xml) return { error: `${filename} has no document body.` };
  const rendered = xml.includes("lastRenderedPageBreak");
  const paras = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  const out: string[] = [];
  let page = 0;
  for (const para of paras) {
    const broke = rendered
      ? /<w:lastRenderedPageBreak\b/.test(para)
      : /<w:br\b[^>]*w:type\s*=\s*"page"/.test(para);
    if (broke) {
      page += 1;
      out.push(`\n\n:::page ${page}\n\n`);
    }
    const style = /<w:pStyle\b[^>]*w:val\s*=\s*"([^"]+)"/i.exec(para)?.[1] ?? "";
    const text = [...para.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeEntities(match[1]))
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const level = /^heading\s*([1-3])$/i.exec(style)?.[1];
    out.push(level ? `\n\n${"#".repeat(Number(level))} ${text}\n\n` : `\n\n${text}\n\n`);
  }
  const body = out.join("");
  if (body.trim().length < 40) return { error: "That Word file has no readable text." };
  const raw = [
    "---",
    `title: ${yamlValue(titleFromName(filename))}`,
    "creator: Unknown",
    `source: ${yamlValue(filename)}`,
    "format: text/markdown",
    "relation: converted from application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "---",
    "",
    body,
  ].join("\n");
  return parseImport(raw, filename);
}
