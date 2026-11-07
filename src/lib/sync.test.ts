import assert from "node:assert/strict";
import test from "node:test";
import type { Excerpt, Work } from "./corpus/types";
import type { FolioBackup } from "./backup-format";
import { planSync } from "./sync.ts";

function work(id: string, text: string): Work {
  return {
    id,
    title: id,
    author: "A",
    language: "English",
    form: "Prose",
    period: "Imported",
    genre: "Notes",
    edition: "Imported text",
    sections: [{ id: `${id}-s1`, heading: id, text }],
  };
}

function excerpt(id: string, tags?: string[]): Excerpt {
  return {
    id,
    workId: "local",
    sectionId: "local-s1",
    heading: "Note",
    text: id,
    start: 0,
    end: 4,
    created: 1,
    title: "Note",
    creator: "A",
    source: "Note",
    tags,
  };
}

function file(partial: Partial<FolioBackup>): FolioBackup {
  return {
    folio: 2,
    app: "FolioSift",
    exported: "2026-10-20",
    prefs: { theme: "night", stem: true, fuzzy: false, concept: false, semantic: "off" },
    removed: ["iliad"],
    texts: [],
    covers: [],
    overrides: {},
    excerpts: [],
    personas: [],
    ...partial,
  };
}

test("sync adds the other device's books and excerpts and keeps this device's copies", () => {
  const local = {
    texts: [work("local", "here")],
    excerpts: [excerpt("e1", ["a"])],
    overrides: { local: { title: "Here" } },
    personas: [{ name: "Acton", profile: { name: "Acton" } }],
    coverIds: ["local"],
  };
  const plan = planSync(
    local,
    file({
      texts: [work("local", "replaced"), work("phone", "from the phone")],
      excerpts: [excerpt("e1", ["b"]), excerpt("e2")],
      personas: [
        { name: "acton", profile: { name: "Other" } },
        { name: "Creighton", profile: { name: "Creighton" } },
      ],
      covers: [{ id: "local", type: "image/jpeg", data: "aaa" }, { id: "phone", type: "image/jpeg", data: "bbb" }],
      overrides: { local: { title: "No" }, phone: { title: "Phone" } },
    }),
  );
  assert.deepEqual(plan.texts.map((item) => item.id), ["local", "phone"]);
  assert.equal(plan.texts[0]?.sections[0]?.text, "here");
  assert.equal(plan.addedTexts, 1);
  assert.equal(plan.addedExcerpts, 1);
  assert.deepEqual(plan.excerpts[0]?.tags, ["a", "b"]);
  assert.equal(plan.joinedTags, 1);
  assert.equal(plan.addedPersonas, 1);
  assert.deepEqual(plan.coverIds, ["phone"]);
  assert.equal(plan.overrides.local?.title, "Here");
  assert.equal(plan.overrides.phone?.title, "Phone");
});
