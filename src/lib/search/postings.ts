export type Posting = { si: number; pos: number[] };

export function encodePostings(list: Posting[]): ArrayBuffer {
  let cells = 1;
  for (const posting of list) cells += 2 + posting.pos.length;
  const view = new Uint32Array(cells);
  view[0] = list.length;
  let at = 1;
  for (const posting of list) {
    view[at++] = posting.si;
    view[at++] = posting.pos.length;
    for (const pos of posting.pos) view[at++] = pos;
  }
  return view.buffer;
}

/** Append one volume's postings without turning the stored list into JS objects. */
export function concatPostings(previous: ArrayBuffer | undefined, extra: Posting[]): ArrayBuffer {
  const extraBuf = encodePostings(extra);
  if (!previous || previous.byteLength < 4) return extraBuf;
  const prevLen = previous.byteLength >>> 2;
  const add = new Uint32Array(extraBuf);
  const out = new Uint32Array(prevLen + add.length - 1);
  out.set(new Uint32Array(previous), 0);
  out.set(add.subarray(1), prevLen);
  out[0] = out[0] + add[0];
  return out.buffer;
}

export function visitPostings(
  buffer: ArrayBuffer | Uint32Array,
  visit: (si: number, pos: Uint32Array) => boolean | void,
): void {
  const view = buffer instanceof Uint32Array ? buffer : new Uint32Array(buffer);
  if (view.length < 1) return;
  let at = 1;
  while (at + 1 < view.length) {
    const si = view[at++];
    const count = view[at++];
    if (count < 0 || at + count > view.length) break;
    const pos = view.subarray(at, at + count);
    at += count;
    if (visit(si, pos) === false) return;
  }
}
