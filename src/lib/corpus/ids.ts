import { ID_FIELDS, ITEM_IDS, SERIAL_IDS, type CatalogId, type CatalogIds, type Work } from "./types.ts";

export { ID_FIELDS, ITEM_IDS, SERIAL_IDS };

export const ID_LABELS: Record<CatalogId, string> = {
  isbn: "ISBN",
  issn: "ISSN",
  ismn: "ISMN",
  isan: "ISAN",
  iswc: "ISWC",
  isrc: "ISRC",
  istc: "ISTC",
  doi: "DOI",
  asin: "ASIN",
  ean: "EAN",
  oclc: "OCLC",
  lccn: "LCCN",
  wikidata: "Wikidata",
  viaf: "VIAF",
  isni: "ISNI",
  gnd: "GND",
  openlibrary: "Open Library",
};

export const ID_HINTS: Record<CatalogId, string> = {
  isbn: "978…",
  issn: "1234-567X",
  ismn: "979-0-…",
  isan: "ISAN",
  iswc: "T-345…",
  isrc: "CC-XXX-YY-NNNNN",
  istc: "ISTC",
  doi: "10.…",
  asin: "B0…",
  ean: "EAN",
  oclc: "OCLC",
  lccn: "LCCN",
  wikidata: "Q42",
  viaf: "VIAF",
  isni: "ISNI",
  gnd: "GND",
  openlibrary: "OL…W",
};

const SCHEMES: Record<string, CatalogId> = {
  isbn: "isbn",
  issn: "issn",
  ismn: "ismn",
  isan: "isan",
  iswc: "iswc",
  isrc: "isrc",
  istc: "istc",
  doi: "doi",
  asin: "asin",
  ean: "ean",
  upc: "ean",
  oclc: "oclc",
  lccn: "lccn",
  wikidata: "wikidata",
  viaf: "viaf",
  isni: "isni",
  gnd: "gnd",
  openlibrary: "openlibrary",
  ol: "openlibrary",
};

export function emptyIds(): Record<CatalogId, string> {
  return {
    isbn: "",
    issn: "",
    ismn: "",
    isan: "",
    iswc: "",
    isrc: "",
    istc: "",
    doi: "",
    asin: "",
    ean: "",
    oclc: "",
    lccn: "",
    wikidata: "",
    viaf: "",
    isni: "",
    gnd: "",
    openlibrary: "",
  };
}

export function idsOf(work: Work): Record<CatalogId, string> {
  const ids = emptyIds();
  for (const key of ID_FIELDS) ids[key] = work.ids?.[key]?.trim() ?? "";
  return ids;
}

export function storedIds(ids: CatalogIds | undefined): CatalogIds | undefined {
  if (!ids) return undefined;
  const next: CatalogIds = {};
  for (const key of ID_FIELDS) {
    const value = ids[key]?.trim();
    if (value) next[key] = value;
  }
  return Object.keys(next).length ? next : undefined;
}

function schemeKey(scheme: string): CatalogId | undefined {
  const key = scheme.toLowerCase().replace(/[^a-z]/g, "");
  return SCHEMES[key];
}

/** Pull a known serial or item number out of a raw identifier. Ambiguous strings are left alone. */
export function classifyIdentifier(raw: string, scheme = ""): CatalogIds {
  const value = raw.trim();
  if (!value) return {};
  const hinted = schemeKey(scheme);
  if (hinted) return { [hinted]: value.replace(new RegExp(`^(?:urn:)?${hinted}:`, "i"), "").trim() || value };

  const urn = /^urn:([a-z0-9]+):(.+)$/i.exec(value);
  if (urn) {
    const key = schemeKey(urn[1]);
    if (key) return { [key]: urn[2].trim() };
  }

  const labeled = /^(isbn|issn|ismn|isan|iswc|isrc|istc|isni|doi|asin|ean|oclc|lccn|wikidata|viaf|gnd)\b[:\s-]*(.+)$/i.exec(value);
  if (labeled) {
    const key = schemeKey(labeled[1]);
    if (key) return { [key]: labeled[2].trim() };
  }

  if (/doi\.org\//i.test(value) || /^10\.\d{4,}\/\S+/.test(value)) {
    return { doi: value.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, "") };
  }
  const wiki = /wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i.exec(value);
  if (wiki) return { wikidata: wiki[1] };
  const viaf = /viaf\.org\/(?:viaf\/)?(\d+)/i.exec(value);
  if (viaf) return { viaf: viaf[1] };
  const gnd = /d-nb\.info\/gnd\/([^/\s]+)/i.exec(value);
  if (gnd) return { gnd: gnd[1] };
  const ol = /openlibrary\.org\/(?:works|books)\/(OL\d+[WAM])/i.exec(value);
  if (ol) return { openlibrary: ol[1] };

  const compact = value.replace(/[\s-]/g, "");
  if (/^9790\d{9}$/.test(compact)) return { ismn: value };
  if (/^(?:97[89]\d{10}|\d{9}[\dX])$/i.test(compact)) return { isbn: value };
  if (/^\d{4}-\d{3}[\dX]$/i.test(value)) return { issn: value };
  return {};
}
