import { htmlToMarkup } from "./html-text.ts";
import { parseImport, titleFromName, yamlValue } from "./markup.ts";
import type { Work } from "./types";

function viewOf(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length && offset + i < bytes.length; i++) out += String.fromCharCode(bytes[offset + i]);
  return out;
}

/** PalmDOC LZ77. Each text record is decompressed on its own. */
export function palmdocDecompress(array: Uint8Array): Uint8Array {
  const output: number[] = [];
  for (let i = 0; i < array.length; i++) {
    const byte = array[i];
    if (byte === 0) output.push(0);
    else if (byte <= 8) {
      for (let n = 0; n < byte && i + 1 < array.length; n++) output.push(array[++i]);
    } else if (byte < 0x80) output.push(byte);
    else if (byte < 0xc0) {
      if (i + 1 >= array.length) break;
      const pair = (byte << 8) | array[++i];
      const distance = (pair >>> 3) & 0x7ff;
      const length = (pair & 7) + 3;
      if (distance < 1 || distance > output.length) {
        for (let n = 0; n < length; n++) output.push(32);
      } else {
        for (let n = 0; n < length; n++) output.push(output[output.length - distance]);
      }
    } else output.push(32, byte ^ 0x80);
  }
  return Uint8Array.from(output);
}

function varLenFromEnd(data: Uint8Array): number {
  let value = 0;
  const start = Math.max(0, data.length - 4);
  for (let i = start; i < data.length; i++) {
    const byte = data[i];
    if (byte & 0x80) value = 0;
    value = (value << 7) | (byte & 0x7f);
  }
  return value;
}

function bitsSet(value: number): number {
  let count = 0;
  for (let n = value; n > 0; n >>= 1) if (n & 1) count += 1;
  return count;
}

/** Trailing index bytes Kindle appends to each text record. They are not part of the prose. */
export function stripTrail(data: Uint8Array, flags: number): Uint8Array {
  if (!flags || !data.length) return data;
  let view = data;
  const entries = bitsSet(flags >>> 1);
  for (let i = 0; i < entries && view.length; i++) {
    const length = varLenFromEnd(view);
    if (length <= 0 || length >= view.length) break;
    view = view.subarray(0, view.length - length);
  }
  if ((flags & 1) && view.length) {
    const length = (view[view.length - 1] & 3) + 1;
    if (length < view.length) view = view.subarray(0, view.length - length);
  }
  return view;
}

function decode(bytes: Uint8Array, codepage: number): string {
  const label = codepage === 65001 ? "utf-8" : "windows-1252";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

type MobiBook = { title: string; author: string; publisher: string; language: string; description: string; text: string };

export function readMobi(bytes: Uint8Array): MobiBook | { error: string } {
  if (bytes.length < 80) return { error: "That Kindle file is too small to be a book." };
  const magic = ascii(bytes, 60, 8);
  if (magic !== "BOOKMOBI" && magic !== "TEXtREAd") return { error: "That file is not a MOBI or AZW book." };
  const view = viewOf(bytes);
  const records = view.getUint16(76);
  const recOff = (index: number) => view.getUint32(78 + index * 8);
  const rec0 = recOff(0);
  if (rec0 + 16 > bytes.length) return { error: "That Kindle file is missing its header." };
  const compression = view.getUint16(rec0);
  const textLength = view.getUint32(rec0 + 4);
  const textRecords = view.getUint16(rec0 + 8);
  const encryption = view.getUint16(rec0 + 12);
  if (encryption) return { error: "This Kindle file is locked. Export an EPUB and add that." };
  if (compression !== 1 && compression !== 2) {
    return { error: "This Kindle file uses a compression FolioSift can’t open. Export an EPUB and add that." };
  }

  let codepage = 65001;
  let title = "";
  let trail = 0;
  let exthAt = 0;
  if (ascii(bytes, rec0 + 0x10, 4) === "MOBI") {
    const headerLen = view.getUint32(rec0 + 0x14);
    codepage = view.getUint32(rec0 + 0x1c);
    const nameOff = view.getUint32(rec0 + 0x54);
    const nameLen = view.getUint32(rec0 + 0x58);
    if (nameLen > 0 && nameLen < 2000 && rec0 + nameOff + nameLen <= bytes.length) {
      title = decode(bytes.subarray(rec0 + nameOff, rec0 + nameOff + nameLen), codepage).replace(/\0/g, "").trim();
    }
    if (headerLen >= 0xe4) {
      const flags = view.getUint16(rec0 + 0xf2);
      if (flags && bitsSet(flags) <= 6) trail = flags;
    }
    exthAt = rec0 + 16 + headerLen;
  }

  const exth = readExth(bytes, exthAt, codepage);
  const author = (exth[100] ?? []).join(", ");
  const updated = exth[503]?.[0];
  const pieces: Uint8Array[] = [];
  for (let i = 1; i <= textRecords; i++) {
    if (i >= records) break;
    const start = recOff(i);
    const end = i + 1 < records ? recOff(i + 1) : bytes.length;
    if (end < start || start > bytes.length) continue;
    let chunk = bytes.subarray(start, Math.min(end, bytes.length));
    chunk = stripTrail(chunk, trail);
    pieces.push(compression === 2 ? palmdocDecompress(chunk) : chunk);
  }
  const merged = concat(pieces);
  const text = decode(merged.subarray(0, Math.min(textLength || merged.length, merged.length)), codepage);
  return {
    title: (updated || title).trim(),
    author,
    publisher: exth[101]?.[0] ?? "",
    language: exth[524]?.[0] ?? "",
    description: exth[103]?.[0] ?? "",
    text,
  };
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function readExth(bytes: Uint8Array, start: number, codepage: number): Record<number, string[]> {
  if (!start || start + 12 > bytes.length || ascii(bytes, start, 4) !== "EXTH") return {};
  const view = viewOf(bytes);
  const count = view.getUint32(start + 8);
  const out: Record<number, string[]> = {};
  let pos = start + 12;
  for (let i = 0; i < count && pos + 8 <= bytes.length; i++) {
    const type = view.getUint32(pos);
    const length = view.getUint32(pos + 4);
    if (length < 8 || pos + length > bytes.length) break;
    const text = decode(bytes.subarray(pos + 8, pos + length), codepage).replace(/\0+$/g, "").trim();
    if (text) (out[type] ??= []).push(text);
    pos += length;
  }
  return out;
}

export function mobiToWork(bytes: Uint8Array, filename: string): Work | { error: string } {
  const book = readMobi(bytes);
  if ("error" in book) return book;
  const looksHtml = /<\s*(html|p|h[1-3]|div)\b/i.test(book.text);
  const body = looksHtml ? htmlToMarkup(book.text) : book.text;
  const lines = [
    "---",
    `title: ${yamlValue(book.title || titleFromName(filename))}`,
    `creator: ${yamlValue(book.author || "Unknown")}`,
    `language: ${yamlValue(book.language)}`,
    `publisher: ${yamlValue(book.publisher)}`,
    `description: ${yamlValue(book.description)}`,
    `source: ${yamlValue(filename)}`,
    "format: text/markdown",
    "relation: converted from application/x-mobipocket-ebook",
    "---",
    "",
    body,
  ];
  return parseImport(lines.join("\n"), filename);
}
