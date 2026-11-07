import assert from "node:assert/strict";
import test from "node:test";
import { gunzipSync, gzipSync } from "fflate";
import { decodeShelf, encodeShelf } from "./shipped.ts";
import { decodeEmbeddings, encodeEmbeddings } from "./shipped-embed.ts";

test("a prepared index round-trips", () => {
  const work = {
    stamp: "2:40",
    sections: [
      {
        id: "iliad-1",
        heading: "Book I",
        dl: 3,
        postings: new Map([
          ["bn:wrath", [0]],
          ["bs:wrath", [0]],
          ["hn:book", [0]],
          ["hs:book", [0]],
        ]),
      },
    ],
  };
  const back = decodeShelf(gunzipSync(gzipSync(encodeShelf(work))));
  assert.equal(back.stamp, "2:40");
  assert.equal(back.sections[0]?.id, "iliad-1");
  assert.deepEqual(back.sections[0]?.postings.get("bn:wrath"), [0]);
});

test("a prepared embedding keeps its direction", () => {
  const vector = new Float32Array(384);
  vector[0] = 0.6;
  vector[1] = -0.8;
  const back = decodeEmbeddings(encodeEmbeddings({
    model: "e5",
    sections: [{ id: "iliad-1", hash: "abc", windows: [{ start: 4, preview: "wrath", v: vector }] }],
  }));
  const got = back.sections[0]?.windows[0]?.v;
  assert.ok(got);
  assert.ok(Math.abs((got?.[0] ?? 0) - 0.6) < 0.002);
  assert.ok(Math.abs((got?.[1] ?? 0) + 0.8) < 0.002);
});
