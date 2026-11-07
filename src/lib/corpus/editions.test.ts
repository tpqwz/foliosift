import assert from "node:assert/strict";
import test from "node:test";
import { editionKey, otherEditions } from "./editions.ts";
import type { Work } from "./types.ts";

function book(id: string, title: string, author: string, language = "English"): Work {
  return {
    id,
    title,
    author,
    language,
    form: "Poetry",
    period: "",
    genre: "",
    edition: "",
    sections: [],
  };
}

test("two translations of one book share a key, and a different book does not", () => {
  const homer = book("iliad", "The Iliad", "Homer");
  const other = book("iliad-gr", "Iliad", "Homer", "Greek");
  const odyssey = book("odyssey", "The Odyssey", "Homer");
  const plato = book("republic", "The Republic of Plato", "Plato");
  const cicero = book("republic-c", "Republic", "Cicero");
  assert.equal(editionKey(homer), editionKey(other));
  assert.notEqual(editionKey(homer), editionKey(odyssey));
  assert.notEqual(editionKey(plato), editionKey(cicero));
  assert.deepEqual(
    otherEditions(homer, [homer, other, odyssey]).map((work) => work.id),
    ["iliad-gr"],
  );
  assert.equal(editionKey(book("note", "Notes", "")), "");
});

test("a possessive, a subtitle, and a shared wikidata id are the same work", () => {
  const plain = book("a", "Nicomachean Ethics", "Aristotle");
  const subtitled = book("b", "Aristotle's Nicomachean Ethics: A new translation", "Aristotle");
  const shorter = book("c", "Ethics", "Aristotle");
  const eudemian = book("d", "Eudemian Ethics", "Aristotle");
  assert.equal(editionKey(plain), editionKey(subtitled));
  assert.notEqual(editionKey(plain), editionKey(shorter));
  assert.notEqual(editionKey(plain), editionKey(eudemian));
  const latin = { ...book("e", "Ethica Nicomachea", "Aristotle", "Latin"), ids: { wikidata: "Q192184" } };
  const english = { ...book("f", "Nicomachean Ethics", "Aristotle"), ids: { wikidata: "q192184" } };
  assert.deepEqual(
    otherEditions(latin, [latin, english, shorter]).map((work) => work.id),
    ["f"],
  );
});

test("volumes of one series are not editions, but the same volume in another language is", () => {
  const series = { id: "gandhi-collected", title: "Collected Works", volume: 1, of: 98, label: "1884–1896" };
  const first = { ...book("gandhi-01", "Collected Works, Vol. 1", "Mohandas K. Gandhi"), series };
  const second = {
    ...book("gandhi-02", "Collected Works, Vol. 2", "Mohandas K. Gandhi"),
    series: { ...series, volume: 2, label: "1897–1902" },
  };
  const greek = {
    ...book("gandhi-01-gr", "Collected Works, Vol. 1", "Mohandas K. Gandhi", "Greek"),
    series: { ...series, volume: 1 },
  };
  assert.deepEqual(otherEditions(first, [first, second]).map((work) => work.id), []);
  assert.deepEqual(otherEditions(first, [first, second, greek]).map((work) => work.id), ["gandhi-01-gr"]);
});
