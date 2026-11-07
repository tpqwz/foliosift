const MAGIC = "FSIX";

export type ShippedSection = {
  id: string;
  heading: string;
  dl: number;
  postings: Map<string, number[]>;
};

export type ShippedWork = {
  stamp: string;
  sections: ShippedSection[];
};

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function putText(parts: Uint8Array[], value: string) {
  const data = bytes(value);
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, data.length, true);
  parts.push(head, data);
}

function putU32(parts: Uint8Array[], value: number) {
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, value, true);
  parts.push(head);
}

export function encodeShelf(work: ShippedWork): Uint8Array {
  const parts: Uint8Array[] = [bytes(MAGIC)];
  putText(parts, work.stamp);
  putU32(parts, work.sections.length);
  for (const section of work.sections) {
    putText(parts, section.id);
    putText(parts, section.heading);
    putU32(parts, section.dl);
    const kinds = ["bn", "bs", "hn", "hs"] as const;
    for (const kind of kinds) {
      const terms = [...section.postings.entries()].filter(([key]) => key.startsWith(`${kind}:`));
      putU32(parts, terms.length);
      for (const [key, positions] of terms) {
        putText(parts, key.slice(3));
        putU32(parts, positions.length);
        const row = new Uint8Array(positions.length * 4);
        const view = new DataView(row.buffer);
        positions.forEach((pos, index) => view.setUint32(index * 4, pos, true));
        parts.push(row);
      }
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

class Reader {
  at = 0;
  private readonly data: Uint8Array;
  constructor(data: Uint8Array) {
    this.data = data;
  }
  text(): string {
    const length = this.u32();
    const slice = this.data.subarray(this.at, this.at + length);
    this.at += length;
    return new TextDecoder().decode(slice);
  }
  u32(): number {
    const value = new DataView(this.data.buffer, this.data.byteOffset + this.at, 4).getUint32(0, true);
    this.at += 4;
    return value;
  }
  positions(count: number): number[] {
    const out = new Array<number>(count);
    const view = new DataView(this.data.buffer, this.data.byteOffset + this.at, count * 4);
    for (let i = 0; i < count; i++) out[i] = view.getUint32(i * 4, true);
    this.at += count * 4;
    return out;
  }
}

export function decodeShelf(data: Uint8Array): ShippedWork {
  const reader = new Reader(data);
  const magic = new TextDecoder().decode(data.subarray(0, 4));
  reader.at = 4;
  if (magic !== MAGIC) throw new Error("Not a FolioSift index.");
  const stamp = reader.text();
  const count = reader.u32();
  const sections: ShippedSection[] = [];
  for (let i = 0; i < count; i++) {
    const id = reader.text();
    const heading = reader.text();
    const dl = reader.u32();
    const postings = new Map<string, number[]>();
    for (const kind of ["bn", "bs", "hn", "hs"]) {
      const terms = reader.u32();
      for (let term = 0; term < terms; term++) {
        const word = reader.text();
        const positions = reader.positions(reader.u32());
        postings.set(`${kind}:${word}`, positions);
      }
    }
    sections.push({ id, heading, dl, postings });
  }
  return { stamp, sections };
}
