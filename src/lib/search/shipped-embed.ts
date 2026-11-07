const MAGIC = "FSEM";
const DIMS = { e5: 384, gemma: 256 } as const;

export type ShippedWindow = { start: number; preview: string; v: Float32Array };
export type ShippedEmbedSection = { id: string; hash: string; windows: ShippedWindow[] };
export type ShippedEmbed = { model: "e5" | "gemma"; sections: ShippedEmbedSection[] };

function writeFloat16(view: DataView, offset: number, value: number) {
  const float = new Float32Array(1);
  const bits = new Uint32Array(float.buffer);
  float[0] = value;
  const raw = bits[0];
  const sign = (raw >> 16) & 0x8000;
  let exponent = ((raw >> 23) & 0xff) - 127 + 15;
  let mantissa = raw & 0x7fffff;
  if (exponent <= 0) {
    view.setUint16(offset, sign, true);
    return;
  }
  if (exponent >= 31) {
    view.setUint16(offset, sign | 0x7c00, true);
    return;
  }
  view.setUint16(offset, sign | (exponent << 10) | (mantissa >> 13), true);
}

function readFloat16(view: DataView, offset: number): number {
  const raw = view.getUint16(offset, true);
  const sign = (raw & 0x8000) << 16;
  const exponent = (raw >> 10) & 0x1f;
  const mantissa = raw & 0x3ff;
  const bits = new Uint32Array(1);
  const out = new Float32Array(bits.buffer);
  if (exponent === 0) {
    bits[0] = sign;
    return out[0];
  }
  if (exponent === 31) {
    bits[0] = sign | 0x7f800000 | (mantissa << 13);
    return out[0];
  }
  bits[0] = sign | ((exponent - 15 + 127) << 23) | (mantissa << 13);
  return out[0];
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function encodeEmbeddings(pack: ShippedEmbed): Uint8Array {
  const dims = DIMS[pack.model];
  const parts: Uint8Array[] = [];
  const push = (part: Uint8Array) => parts.push(part);
  const u32 = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    push(bytes);
  };
  const text = (value: string) => {
    const data = textBytes(value);
    u32(data.length);
    push(data);
  };
  push(textBytes(MAGIC));
  text(pack.model);
  u32(dims);
  u32(pack.sections.length);
  for (const section of pack.sections) {
    text(section.id);
    text(section.hash);
    u32(section.windows.length);
    for (const piece of section.windows) {
      if (piece.v.length !== dims) throw new Error("Embedding width does not match the model.");
      u32(piece.start);
      text(piece.preview);
      const row = new Uint8Array(dims * 2);
      const view = new DataView(row.buffer);
      for (let i = 0; i < dims; i++) writeFloat16(view, i * 2, piece.v[i]);
      push(row);
    }
  }
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function decodeEmbeddings(data: Uint8Array): ShippedEmbed {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 0;
  const magic = new TextDecoder().decode(data.subarray(0, 4));
  at = 4;
  if (magic !== MAGIC) throw new Error("Not a FolioSift embedding.");
  const readText = () => {
    const length = view.getUint32(at, true);
    at += 4;
    const value = new TextDecoder().decode(data.subarray(at, at + length));
    at += length;
    return value;
  };
  const model = readText();
  if (model !== "e5" && model !== "gemma") throw new Error("Unknown embedding model.");
  const dims = view.getUint32(at, true);
  at += 4;
  const count = view.getUint32(at, true);
  at += 4;
  const sections: ShippedEmbedSection[] = [];
  for (let i = 0; i < count; i++) {
    const id = readText();
    const hash = readText();
    const windows = view.getUint32(at, true);
    at += 4;
    const pieces: ShippedWindow[] = [];
    for (let w = 0; w < windows; w++) {
      const start = view.getUint32(at, true);
      at += 4;
      const preview = readText();
      const vector = new Float32Array(dims);
      for (let d = 0; d < dims; d++) {
        vector[d] = readFloat16(view, at);
        at += 2;
      }
      pieces.push({ start, preview, v: vector });
    }
    sections.push({ id, hash, windows: pieces });
  }
  return { model, sections };
}
