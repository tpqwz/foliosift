import { decodeEntities, htmlToMarkup } from "./html-text.ts";
import { parseImport, titleFromName, yamlValue } from "./markup.ts";
import type { Work } from "./types";
import { decodeXml, unzip, zipText } from "./zip.ts";

const MAX_ROWS = 4000;
const MAX_COLS = 16;

function plain(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function asWork(
  filename: string,
  body: string,
  fields: Record<string, string>,
  min = 40,
): Work | { error: string } {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) if (value) lines.push(`${key}: ${yamlValue(value)}`);
  lines.push("---", "", body);
  return parseImport(lines.join("\n"), filename, min);
}

export function htmlFileToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  const html = decodeXml(bytes);
  const title = plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") || titleFromName(filename);
  const body = htmlToMarkup(html);
  return asWork(filename, body, {
    title,
    creator: "Unknown",
    source: filename,
    format: "text/markdown",
    relation: "converted from text/html",
  });
}

export function fb2ToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  let xml = decodeXml(bytes);
  if (xml.charCodeAt(0) === 0x50) {
    try {
      const files = unzip(bytes);
      const inner = [...files.keys()].find((key) => key.toLowerCase().endsWith(".fb2"));
      xml = inner ? (zipText(files, inner) ?? "") : "";
    } catch {
      xml = "";
    }
  }
  if (!/<fictionbook[\s>]/i.test(xml)) return { error: `${filename} is not a FictionBook file.` };
  const title = plain(/<book-title\b[^>]*>([\s\S]*?)<\/book-title>/i.exec(xml)?.[1] ?? "") || titleFromName(filename);
  const first = plain(/<first-name\b[^>]*>([\s\S]*?)<\/first-name>/i.exec(xml)?.[1] ?? "");
  const last = plain(/<last-name\b[^>]*>([\s\S]*?)<\/last-name>/i.exec(xml)?.[1] ?? "");
  const author = [first, last].filter(Boolean).join(" ") || "Unknown";
  const bodyXml = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(xml)?.[1] ?? xml;
  const chunks: string[] = [];
  const sections = bodyXml.split(/<section\b/i).slice(1);
  const pieces = sections.length ? sections : [bodyXml];
  for (const section of pieces) {
    const head = plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(section)?.[1] ?? "");
    if (head) chunks.push(`\n\n# ${head}\n\n`);
    const paras = [...section.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => plain(match[1])).filter(Boolean);
    if (paras.length) chunks.push(paras.join("\n\n"));
  }
  return asWork(filename, chunks.join("\n\n"), {
    title,
    creator: author,
    source: filename,
    format: "text/markdown",
    relation: "converted from application/x-fictionbook+xml",
  });
}

export function odtToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  let files: Map<string, Uint8Array>;
  try {
    files = unzip(bytes);
  } catch {
    return { error: `${filename} is not a readable OpenDocument file.` };
  }
  const xml = zipText(files, "content.xml");
  if (!xml) return { error: `${filename} has no document body.` };
  const blocks = xml.match(/<text:(h|p)\b[^>]*>[\s\S]*?<\/text:\1>/gi) ?? [];
  const out: string[] = [];
  for (const block of blocks) {
    const text = plain(block);
    if (!text) continue;
    const level = /^<text:h\b/i.test(block) ? Math.min(3, Number(/text:outline-level\s*=\s*"(\d)"/i.exec(block)?.[1] ?? "1")) : 0;
    out.push(level ? `\n\n${"#".repeat(level)} ${text}\n\n` : `\n\n${text}\n\n`);
  }
  return asWork(filename, out.join(""), {
    title: titleFromName(filename),
    creator: "Unknown",
    source: filename,
    format: "text/markdown",
    relation: "converted from application/vnd.oasis.opendocument.text",
  });
}

/** Enough of RTF to keep paragraphs and letters. Pictures and font tables are dropped. */
export function rtfToText(src: string): string {
  const skipDest = new Set([
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "datastore",
    "themedata",
    "xmlnstbl",
    "listtable",
    "listoverridetable",
    "revtbl",
    "rsidtbl",
    "generator",
    "header",
    "footer",
    "headerl",
    "headerr",
    "footerl",
    "footerr",
  ]);
  let i = 0;
  let skip = 0;
  const out: string[] = [];
  const stack: number[] = [];
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      stack.push(skip);
      i += 1;
      continue;
    }
    if (ch === "}") {
      skip = stack.pop() ?? 0;
      i += 1;
      continue;
    }
    if (ch === "\\") {
      if (src[i + 1] === "\\") {
        if (!skip) out.push("\\");
        i += 2;
        continue;
      }
      if (src[i + 1] === "{" || src[i + 1] === "}") {
        if (!skip) out.push(src[i + 1]);
        i += 2;
        continue;
      }
      if (src[i + 1] === "'") {
        const hex = src.slice(i + 2, i + 4);
        if (!skip && /^[0-9a-f]{2}$/i.test(hex)) out.push(String.fromCharCode(parseInt(hex, 16)));
        i += 4;
        continue;
      }
      if (src[i + 1] === "u" && /-?\d/.test(src[i + 2] ?? "")) {
        const match = /^-?\d+/.exec(src.slice(i + 2));
        const num = Number(match?.[0] ?? "0");
        const code = num < 0 ? num + 65536 : num;
        if (!skip && code > 0 && code < 0x110000) out.push(String.fromCharCode(code));
        i += 2 + (match?.[0].length ?? 0);
        if (src[i] === "?" || src[i] === " ") i += 1;
        continue;
      }
      const word = /^[a-z]+/i.exec(src.slice(i + 1));
      if (!word) {
        i += 2;
        continue;
      }
      let j = i + 1 + word[0].length;
      if (src[j] === "-") j += 1;
      while (/[0-9]/.test(src[j] ?? "")) j += 1;
      if (src[j] === " ") j += 1;
      const name = word[0].toLowerCase();
      if (!skip && (name === "par" || name === "line" || name === "sect")) out.push("\n\n");
      else if (!skip && name === "tab") out.push("\t");
      if (skipDest.has(name) && src[i - 1] !== "\\") skip = stack.length;
      i = j;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (!skip) out.push(ch);
    i += 1;
  }
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function rtfToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  const text = rtfToText(decodeXml(bytes));
  return asWork(filename, text, {
    title: titleFromName(filename),
    creator: "Unknown",
    source: filename,
    format: "text/markdown",
    relation: "converted from application/rtf",
  });
}

export function teiToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  const xml = decodeXml(bytes);
  const tokens = xml.match(/<\/?[^>]+>|[^<]+/g) ?? [];
  const out: string[] = [];
  let skip = 0;
  let heading = 0;
  let headingText = "";
  const header = /<teiheader\b[\s\S]*?<\/teiheader>/i.exec(xml)?.[0] ?? "";
  const title = plain(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(header)?.[1] ?? "") || titleFromName(filename);
  const author = plain(/<author\b[^>]*>([\s\S]*?)<\/author>/i.exec(header)?.[1] ?? "") || "Unknown";
  for (const tok of tokens) {
    if (!tok.startsWith("<")) {
      if (skip) continue;
      const value = decodeEntities(tok).replace(/[ \t]+/g, " ");
      if (!value.trim()) continue;
      if (heading) headingText += value;
      else out.push(value);
      continue;
    }
    const close = /^<\s*\//.test(tok);
    const name = (/^<\s*\/?\s*(?:[a-z0-9]+:)?([a-z0-9]+)/i.exec(tok)?.[1] ?? "").toLowerCase();
    const selfClosing = /\/>\s*$/.test(tok);
    if (name === "teiheader" || name === "note" || name === "figdesc" || name === "graphic") {
      if (!selfClosing && !close) skip += 1;
      else if (close) skip = Math.max(0, skip - 1);
      continue;
    }
    if (skip) continue;
    if (!close && name === "pb") {
      const n = plain(/n\s*=\s*"([^"]*)"/i.exec(tok)?.[1] ?? "");
      if (n) out.push(`\n\n:::page ${n}\n\n`);
      continue;
    }
    if (!close && name === "head") {
      heading = 2;
      headingText = "";
      continue;
    }
    if (close && name === "head" && heading) {
      const text = headingText.replace(/\s+/g, " ").trim();
      if (text) out.push(`\n\n## ${text}\n\n`);
      heading = 0;
      headingText = "";
      continue;
    }
    if (heading) continue;
    if (close && (name === "p" || name === "div" || name === "lg" || name === "sp" || name === "ab")) out.push("\n\n");
    if (close && (name === "l" || name === "lb")) out.push("\n");
  }
  return asWork(filename, out.join(""), {
    title,
    creator: author,
    source: filename,
    format: "text/markdown",
    relation: "converted from application/tei+xml",
  });
}

export function isTei(xml: string): boolean {
  return /<tei[\s>]|xmlns(?::\w+)?\s*=\s*"http:\/\/www\.tei-c\.org/i.test(xml);
}

export function isTtml(xml: string): boolean {
  return /<tt\b|http:\/\/www\.w3\.org\/ns\/ttml/i.test(xml);
}

function cueLine(start: string, text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  const when = start.replace(",", ".").trim();
  return when ? `${when}  ${clean}` : clean;
}

export function subtitlesToText(src: string, kind: string): string {
  const text = src.replace(/\r\n/g, "\n").replace(/^\uFEFF/, "");
  if (kind === "vtt") {
    const cues: string[] = [];
    for (const block of text.split(/\n{2,}/)) {
      if (/^(WEBVTT|NOTE|STYLE|REGION)\b/.test(block)) continue;
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const time = lines.find((line) => /-->/.test(line));
      const words = lines.filter((line) => line !== time && !/^\d+$/.test(line)).join(" ");
      if (words) cues.push(cueLine(time?.split("-->")[0] ?? "", words));
    }
    return cues.join("\n");
  }
  if (kind === "ass" || kind === "ssa") {
    const cues: string[] = [];
    for (const line of text.split("\n")) {
      if (!/^dialogue:/i.test(line)) continue;
      const parts = line.split(",");
      const start = parts[1] ?? "";
      const words = parts.slice(9).join(",").replace(/\{[^}]*\}/g, "").replace(/\\N/gi, " ");
      if (words.trim()) cues.push(cueLine(start, words));
    }
    return cues.join("\n");
  }
  if (kind === "sbv") {
    const cues: string[] = [];
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
      const time = lines[0] ?? "";
      if (!/,/.test(time)) continue;
      const words = lines.slice(1).join(" ");
      if (words) cues.push(cueLine(time.split(",")[0] ?? "", words));
    }
    return cues.join("\n");
  }
  if (kind === "lrc") {
    return text
      .split("\n")
      .map((line) => {
        const match = /^\[(\d+:\d+(?:\.\d+)?)\]\s*(.*)$/.exec(line.trim());
        return match?.[2] ? cueLine(match[1], match[2]) : "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (kind === "ttml" || kind === "dfxp") {
    const cues: string[] = [];
    for (const paragraph of text.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
      const begin = /begin\s*=\s*"([^"]*)"/i.exec(paragraph[1])?.[1] ?? "";
      const words = plain(paragraph[2]);
      if (words) cues.push(cueLine(begin, words));
    }
    return cues.join("\n");
  }
  const cues: string[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const micro = /^\{(\d+)\}\{(\d+)\}(.*)$/.exec(lines.join(" "));
    if (micro?.[3]) {
      cues.push(cueLine(micro[1], micro[3]));
      continue;
    }
    const time = lines.find((line) => /-->/.test(line));
    const words = lines.filter((line) => line !== time && !/^\d+$/.test(line)).join(" ");
    if (words) cues.push(cueLine(time?.split("-->")[0] ?? "", words));
  }
  return cues.join("\n");
}

export function subtitlesToWork(bytes: Uint8Array, filename: string, kind: string): Work | { error: string } {
  const body = subtitlesToText(decodeXml(bytes), kind);
  return asWork(
    filename,
    body,
    {
      title: titleFromName(filename),
      creator: "Unknown",
      source: filename,
      format: "text/x-folio-lines",
      relation: `converted from subtitles/${kind}`,
    },
    1,
  );
}

export function codeToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  const text = decodeXml(bytes).replace(/\r\n/g, "\n").replace(/\n+$/, "");
  const title = titleFromName(filename);
  return asWork(
    filename,
    `# ${title}\n\n\`\`\`\n${text}\n\`\`\`\n`,
    {
      title,
      creator: "Unknown",
      source: filename,
      format: "text/x-folio-code",
      type: "Code",
      relation: "converted from source code",
    },
    1,
  );
}

function splitCsv(src: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quote = false;
  const text = src.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quote = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quote = true;
      continue;
    }
    if (ch === sep) {
      row.push(cell.trim());
      cell = "";
      continue;
    }
    if (ch === "\n") {
      row.push(cell.trim());
      if (row.some((item) => item)) rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += ch;
  }
  row.push(cell.trim());
  if (row.some((item) => item)) rows.push(row);
  return rows;
}

export function staticTable(rows: string[][]): string {
  const limited = rows.slice(0, MAX_ROWS).map((row) => row.slice(0, MAX_COLS).map((cell) => cell.replace(/\s+/g, " ").trim()));
  const width = Math.max(1, ...limited.map((row) => row.length));
  const cols = Array.from({ length: width }, (_, index) =>
    Math.min(28, Math.max(3, ...limited.map((row) => (row[index] ?? "").length))),
  );
  const lines = limited.map((row) =>
    cols.map((size, index) => (row[index] ?? "").slice(0, size).padEnd(size)).join("  "),
  );
  if (rows.length > MAX_ROWS) lines.push(`… ${rows.length - MAX_ROWS} more rows`);
  return lines.join("\n");
}

export function delimitedToWork(bytes: Uint8Array, filename: string, sep: string): Work | { error: string } {
  const rows = splitCsv(decodeXml(bytes), sep);
  const title = titleFromName(filename);
  return asWork(
    filename,
    `# ${title}\n\n\`\`\`\n${staticTable(rows)}\n\`\`\`\n`,
    {
      title,
      creator: "Unknown",
      source: filename,
      format: "text/x-folio-table",
      type: "Table",
      relation: "converted from a delimited table",
    },
    1,
  );
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const item of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    out.push(
      [...item[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)]
        .map((match) => decodeEntities(match[1]))
        .join(""),
    );
  }
  return out;
}

function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0] ?? "";
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const cell of row[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const inner = cell[2] ?? "";
      const ref = /r\s*=\s*"([A-Z]+)\d+"/i.exec(attrs)?.[1] ?? "";
      const index = ref ? columnIndex(ref) : next;
      const type = /t\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? "";
      let value = "";
      if (type === "s") {
        const at = Number(/<v>(\d+)<\/v>/.exec(inner)?.[1] ?? "-1");
        value = shared[at] ?? "";
      } else if (type === "inlineStr") value = plain(inner);
      else value = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1]?.trim() ?? "";
      while (cells.length < index) cells.push("");
      cells[index] = value;
      next = index + 1;
    }
    if (cells.some((item) => item)) rows.push(cells);
    if (rows.length > MAX_ROWS) break;
  }
  return rows;
}

export function xlsxToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  let files: Map<string, Uint8Array>;
  try {
    files = unzip(bytes);
  } catch {
    return { error: `${filename} is not a readable spreadsheet.` };
  }
  const shared = sharedStrings(zipText(files, "xl/sharedStrings.xml") ?? "");
  const sheets = [...files.keys()]
    .filter((key) => /xl\/worksheets\/sheet\d+\.xml$/i.test(key))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!sheets.length) return { error: `${filename} has no worksheet.` };
  const parts: string[] = [];
  sheets.forEach((path, index) => {
    const rows = sheetRows(zipText(files, path) ?? "", shared);
    if (!rows.length) return;
    const title = `Sheet ${index + 1}`;
    parts.push(`# ${title}\n\n\`\`\`\n${staticTable(rows)}\n\`\`\``);
  });
  return asWork(
    filename,
    parts.join("\n\n"),
    {
      title: titleFromName(filename),
      creator: "Unknown",
      source: filename,
      format: "text/x-folio-table",
      type: "Table",
      relation: "converted from a spreadsheet",
    },
    1,
  );
}

export function odsToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  let files: Map<string, Uint8Array>;
  try {
    files = unzip(bytes);
  } catch {
    return { error: `${filename} is not a readable spreadsheet.` };
  }
  const xml = zipText(files, "content.xml");
  if (!xml) return { error: `${filename} has no sheets.` };
  const parts: string[] = [];
  for (const table of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/gi)) {
    const name = /table:name\s*=\s*"([^"]*)"/i.exec(table[1])?.[1] || "Sheet";
    const rows: string[][] = [];
    for (const raw of table[2].matchAll(/<table:table-row\b([^>]*)>([\s\S]*?)<\/table:table-row>/gi)) {
      const repeatRow = Math.min(20, Number(/table:number-rows-repeated\s*=\s*"(\d+)"/i.exec(raw[1])?.[1] ?? "1") || 1);
      const cells: string[] = [];
      for (const cell of raw[2].matchAll(/<table:table-cell\b([^>]*)(?:\/>|>([\s\S]*?)<\/table:table-cell>)/gi)) {
        const repeat = Math.min(8, Number(/table:number-columns-repeated\s*=\s*"(\d+)"/i.exec(cell[1])?.[1] ?? "1") || 1);
        const value = plain(cell[2] ?? "") || /office:value\s*=\s*"([^"]*)"/i.exec(cell[1])?.[1] || "";
        for (let i = 0; i < repeat && cells.length < MAX_COLS; i++) cells.push(value);
      }
      if (!cells.some(Boolean)) continue;
      for (let i = 0; i < repeatRow && rows.length < MAX_ROWS; i++) rows.push(cells);
    }
    if (rows.length) parts.push(`# ${plain(name) || "Sheet"}\n\n\`\`\`\n${staticTable(rows)}\n\`\`\``);
  }
  return asWork(
    filename,
    parts.join("\n\n"),
    {
      title: titleFromName(filename),
      creator: "Unknown",
      source: filename,
      format: "text/x-folio-table",
      type: "Table",
      relation: "converted from application/vnd.oasis.opendocument.spreadsheet",
    },
    1,
  );
}

/** Last resort for a binary .xls: keep the readable letter runs, not the formula engine. */
export function xlsStringsToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  const parts: string[] = [];
  let buf = "";
  const flush = () => {
    if (buf.length > 2) parts.push(buf);
    buf = "";
  };
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const code = bytes[i] | (bytes[i + 1] << 8);
    if ((code >= 32 && code < 127) || (code > 160 && code < 0xfff0)) buf += String.fromCharCode(code);
    else flush();
  }
  flush();
  const unique = [...new Set(parts.map((part) => part.trim()).filter((part) => part.length > 2 && /[A-Za-z]/.test(part)))];
  return asWork(
    filename,
    unique.join("\n"),
    {
      title: titleFromName(filename),
      creator: "Unknown",
      source: filename,
      format: "text/x-folio-lines",
      type: "Table",
      relation: "strings taken from a binary spreadsheet",
    },
    1,
  );
}
