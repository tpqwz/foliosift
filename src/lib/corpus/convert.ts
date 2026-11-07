import { parseImport } from "./markup.ts";
import {
  codeToWork,
  delimitedToWork,
  fb2ToWork,
  htmlFileToWork,
  isTei,
  isTtml,
  odsToWork,
  odtToWork,
  rtfToWork,
  subtitlesToWork,
  teiToWork,
  xlsStringsToWork,
  xlsxToWork,
} from "./more.ts";
import type { Work } from "./types";
import { decodeXml, unzip, zipText } from "./zip.ts";

const KINDLE = new Set(["mobi", "azw", "azw3", "prc"]);
const SUBS = new Set(["srt", "vtt", "sbv", "ass", "ssa", "sub", "lrc", "ttml", "dfxp"]);
const CODE = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "vue", "svelte",
  "py", "pyw", "rb", "php", "java", "kt", "kts", "scala", "go", "rs",
  "c", "h", "hh", "hpp", "hxx", "cc", "cpp", "cs", "swift", "m", "mm",
  "sh", "bash", "zsh", "fish", "ps1", "bat", "cmd",
  "json", "yaml", "yml", "toml", "ini", "cfg", "conf",
  "sql", "css", "scss", "less", "lua", "r", "pl", "pm", "ex", "exs",
  "clj", "cljs", "hs", "elm", "dart", "erl", "fs", "vb",
  "tex", "bib", "gradle", "properties",
]);
const KNOWN = new Set([
  "pdf", "epub", "mobi", "azw", "azw3", "prc", "docx", "txt", "md", "markdown",
  "html", "htm", "xhtml", "fb2", "odt", "ods", "rtf", "xml", "tei",
  "csv", "tsv", "tab", "psv", "xlsx", "xlsm", "xls",
  ...SUBS,
  ...CODE,
]);

export type ImportNote = (line: string) => void;

function extension(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isMobi(bytes: Uint8Array): boolean {
  if (bytes.length < 68) return false;
  const magic = new TextDecoder().decode(bytes.subarray(60, 68));
  return magic === "BOOKMOBI" || magic === "TEXtREAd";
}

function sniff(name: string, bytes: Uint8Array): string {
  const ext = extension(name);
  if (CODE.has(ext)) return "code";
  if (SUBS.has(ext)) return ext;
  if (KNOWN.has(ext) && ext !== "xml") return ext;
  if (bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (isMobi(bytes)) return "mobi";
  const head = decodeXml(bytes.subarray(0, Math.min(bytes.length, 800))).trimStart();
  if (/^\{\\rtf/i.test(head)) return "rtf";
  if (isZip(bytes)) {
    try {
      const files = unzip(bytes);
      const mime = (zipText(files, "mimetype") ?? "").trim();
      if (/epub/i.test(mime) || files.has("META-INF/container.xml")) return "epub";
      if (files.has("word/document.xml")) return "docx";
      if (/opendocument\.text/i.test(mime) || files.has("content.xml") && /opendocument\.text/i.test(mime)) return "odt";
      if (/opendocument\.spreadsheet/i.test(mime)) return "ods";
      if ([...files.keys()].some((key) => key.toLowerCase().startsWith("xl/workbook"))) return "xlsx";
      if ([...files.keys()].some((key) => key.toLowerCase().endsWith(".fb2"))) return "fb2";
      if (files.has("content.xml")) return "odt";
    } catch {
      /* fall through */
    }
  }
  if (ext === "xml" || ext === "tei" || head.startsWith("<")) {
    if (/<fictionbook[\s>]/i.test(head) || /<fictionbook[\s>]/i.test(decodeXml(bytes).slice(0, 2000))) return "fb2";
    const sample = head.length > 400 ? head : decodeXml(bytes).slice(0, 2500);
    if (isTei(sample)) return "tei";
    if (isTtml(sample)) return "ttml";
    if (ext === "xml" || ext === "tei") return "code";
  }
  if (/^<!doctype html/i.test(head) || /^<html[\s>]/i.test(head)) return "html";
  if (bytes.length > 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf) return "xls";
  return ext && KNOWN.has(ext) ? ext : "txt";
}

function labelOf(kind: string): string {
  if (kind === "code") return "source code";
  if (SUBS.has(kind)) return "subtitles";
  return kind.toUpperCase();
}

/** Read one volume and turn it into one markup before it is stored. */
export async function importBook(file: File, note?: ImportNote): Promise<Work | { error: string }> {
  const name = file.name || "Imported text";
  try {
    note?.(`Opening ${name}…`);
    if (/\.pdf$/i.test(name) || file.type === "application/pdf") {
      const { pdfToWork } = await import("./pdf.ts");
      const result = await pdfToWork(file, name, (page, total) => note?.(`${name}: page ${page} of ${total}`));
      if (!("error" in result)) {
        note?.(`${name}: ${result.sections.length} sections ready.${result.description ? ` ${result.description}` : ""}`);
      }
      return result;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const kind = sniff(name, bytes);
    note?.(`Reading ${name} as ${labelOf(kind)}…`);
    let result: Work | { error: string };
    if (kind === "pdf") {
      const { pdfToWork } = await import("./pdf.ts");
      result = await pdfToWork(bytes, name, (page, total) => note?.(`${name}: page ${page} of ${total}`));
    } else if (kind === "epub") {
      const { epubToWork } = await import("./epub.ts");
      result = await epubToWork(bytes, name, note);
      if ("error" in result && /not a readable EPUB/.test(result.error) && isMobi(bytes)) {
        return { error: `${name} is a Kindle book with an EPUB name. Add the original, or export an EPUB.` };
      }
    } else if (KINDLE.has(kind)) {
      const { mobiToWork } = await import("./mobi.ts");
      result = mobiToWork(bytes, name);
    } else if (kind === "docx") {
      const { docxToWork } = await import("./docx.ts");
      result = docxToWork(bytes, name);
    } else if (kind === "html" || kind === "htm" || kind === "xhtml") {
      result = htmlFileToWork(bytes, name);
    } else if (kind === "fb2") {
      result = fb2ToWork(bytes, name);
    } else if (kind === "odt") {
      result = odtToWork(bytes, name);
    } else if (kind === "ods") {
      result = odsToWork(bytes, name);
    } else if (kind === "rtf") {
      result = rtfToWork(bytes, name);
    } else if (kind === "tei") {
      result = teiToWork(bytes, name);
    } else if (kind === "xlsx" || kind === "xlsm") {
      result = xlsxToWork(bytes, name);
    } else if (kind === "xls") {
      result = xlsStringsToWork(bytes, name);
    } else if (kind === "csv" || kind === "psv") {
      result = delimitedToWork(bytes, name, kind === "psv" ? "|" : ",");
    } else if (kind === "tsv" || kind === "tab") {
      result = delimitedToWork(bytes, name, "\t");
    } else if (SUBS.has(kind)) {
      result = subtitlesToWork(bytes, name, kind);
    } else if (kind === "code") {
      result = codeToWork(bytes, name);
    } else {
      result = parseImport(decodeXml(bytes), name);
    }
    if (!("error" in result)) {
      result = { ...result, id: fileIdentity(name, bytes) };
      note?.(`${name}: ${result.sections.length} sections ready.${result.description ? ` ${result.description}` : ""}`);
    }
    return result;
  } catch (error) {
    if (error instanceof Error && error.name === "ImportStopped") throw error;
    const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : "";
    const short = detail.replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
    if (/notreadable|could not be read|permission problems/i.test(detail)) {
      return { error: `${name} could not be read. Choose the file again and leave it on the device until it finishes.` };
    }
    return { error: short ? `${name} could not be converted. ${short}` : `${name} could not be converted.` };
  }
}

function fileIdentity(name: string, bytes: Uint8Array): string {
  let hash = 2166136261;
  const step = Math.max(1, Math.floor(bytes.length / 48));
  for (let i = 0; i < bytes.length; i += step) hash = Math.imul(hash ^ bytes[i], 16777619);
  const slug = name
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "text";
  return `import-${slug}-${(hash >>> 0).toString(36)}`;
}

const IMPORT_EXTS = [...KNOWN].map((ext) => ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
export const IMPORT_EXT = new RegExp(`\\.(${IMPORT_EXTS.join("|")})$`, "i");
