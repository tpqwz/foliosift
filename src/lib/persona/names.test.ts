import assert from "node:assert/strict";
import test from "node:test";
import { lookupQueries, nameGroupKey, namesCompatible, preferLabel } from "./names.ts";

test("honorifics and initials are one person, conflicting middles are not", () => {
  const forms = ["David Hawkins", "David R Hawkins", "David R. Hawkins", "Dr. David R. Hawkins"];
  for (const form of forms) assert.equal(namesCompatible(form, "David R. Hawkins"), true);
  assert.equal(namesCompatible("David Robert Hawkins", "David R. Hawkins"), true);
  assert.equal(namesCompatible("David R. Hawkins", "David J. Hawkins"), false);
  assert.equal(namesCompatible("David Hawkins Jr.", "David Hawkins Sr."), false);
  assert.equal(new Set(forms.map((form) => nameGroupKey(form, forms))).size, 1);
  assert.equal(preferLabel(forms), "Dr. David R. Hawkins");
  assert.equal(preferLabel(["Hawkins, David R."]), "David R. Hawkins");
  assert.equal(preferLabel(["Hawkins, David R.", "Dr. David R. Hawkins"]), "Dr. David R. Hawkins");
});

test("a bare name does not bridge two different middle initials", () => {
  const forms = ["David R. Hawkins", "Dr. David R. Hawkins", "David J. Hawkins", "David Hawkins"];
  assert.equal(nameGroupKey("David R. Hawkins", forms), nameGroupKey("Dr. David R. Hawkins", forms));
  assert.notEqual(nameGroupKey("David R. Hawkins", forms), nameGroupKey("David J. Hawkins", forms));
  assert.notEqual(nameGroupKey("David Hawkins", forms), nameGroupKey("David R. Hawkins", forms));
});

test("a catalog surname keeps the middle initial", () => {
  assert.equal(namesCompatible("Hawkins, David R.", "David R. Hawkins"), true);
  assert.equal(namesCompatible("Hawkins, David R.", "David J. Hawkins"), false);
});

test("lookup drops the title and keeps the initial", () => {
  assert.deepEqual(lookupQueries("Dr. David R. Hawkins"), ["David R. Hawkins", "David Hawkins"]);
});

