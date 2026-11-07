import assert from "node:assert/strict";
import test from "node:test";
import { parseBackup } from "./backup-format.ts";

test("a folio backup is accepted and a random file is not", () => {
  const raw = JSON.stringify({
    folio: 1,
    app: "FolioSift",
    exported: "2026-10-14",
    prefs: { theme: "night", stem: true, fuzzy: false, concept: true },
    removed: ["iliad"],
    texts: [
      {
        id: "import-note",
        title: "Note",
        author: "A reader",
        language: "English",
        form: "Prose",
        period: "Imported",
        genre: "Notes",
        edition: "Imported text",
        sections: [{ id: "import-note-s1", heading: "Note", text: "A garden is a small city with a stricter law." }],
      },
    ],
    covers: [],
    overrides: {},
    excerpts: [],
    personas: [],
  });
  const backup = parseBackup(raw);
  assert.ok(!("error" in backup));
  if ("error" in backup) return;
  assert.equal(backup.texts[0]?.title, "Note");
  assert.equal(backup.prefs.theme, "night");
  assert.deepEqual(backup.removed, ["iliad"]);
  const bad = parseBackup('{"folio":2}');
  assert.ok("error" in bad);
  if ("error" in bad) assert.match(bad.error, /not a FolioSift backup/);
});
