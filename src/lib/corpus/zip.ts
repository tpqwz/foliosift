import { unzipSync } from "fflate";

function zipStart(bytes: Uint8Array): Uint8Array {
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b) return bytes;
  const limit = Math.min(bytes.length, 1024 * 1024);
  for (let i = 0; i < limit - 3; i++) {
    if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x03 && bytes[i + 3] === 0x04) {
      return bytes.subarray(i);
    }
  }
  return bytes;
}

export function unzip(bytes: Uint8Array): Map<string, Uint8Array> {
  const raw = unzipSync(zipStart(bytes));
  const out = new Map<string, Uint8Array>();
  for (const [key, value] of Object.entries(raw)) {
    const path = key.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").normalize("NFC");
    if (path) out.set(path, value);
  }
  return out;
}

/** XML and HTML inside an EPUB may be UTF-8, UTF-16, or a declared Latin encoding. */
export function decodeXml(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const head = bytes.subarray(0, Math.min(bytes.length, 240));
  let zeros = 0;
  for (const byte of head) if (byte === 0) zeros += 1;
  if (head.length > 8 && zeros > head.length / 4) {
    return new TextDecoder(head[1] === 0 ? "utf-16le" : "utf-16be").decode(bytes);
  }
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  const encoding = /encoding\s*=\s*["']([A-Za-z0-9._-]+)["']/i.exec(utf8.slice(0, 240))?.[1]?.toLowerCase();
  if (!encoding || encoding === "utf-8" || encoding === "utf8") return utf8;
  const label = encoding === "latin1" || encoding === "iso-8859-1" ? "windows-1252" : encoding;
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return utf8;
  }
}

export function zipText(files: Map<string, Uint8Array>, path: string): string | null {
  const want = path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").normalize("NFC");
  const bytes =
    files.get(want) ?? [...files.entries()].find(([key]) => key.toLowerCase() === want.toLowerCase())?.[1];
  if (!bytes) return null;
  return decodeXml(bytes);
}
