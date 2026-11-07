export type PageMark = { offset: number; label: string };

export type Section = {
  id: string;
  heading: string;
  text: string;
  /** Where an original printed page begins, as a character offset into `text`. */
  pages?: PageMark[];
};

/** Dublin Core elements kept on the work itself. Empty strings mean "not recorded yet". */
export type DublinCore = {
  title: string;
  creator: string;
  subject: string;
  description: string;
  publisher: string;
  contributor: string;
  date: string;
  type: string;
  format: string;
  identifier: string;
  source: string;
  language: string;
  relation: string;
  coverage: string;
  rights: string;
};

/** Publication serials. Empty strings are not stored. */
export const SERIAL_IDS = ["isbn", "issn", "ismn", "isan", "iswc", "isrc", "istc", "doi", "asin", "ean", "oclc", "lccn"] as const;

/** Authority and catalog item numbers, the sort of id Wikidata records. */
export const ITEM_IDS = ["wikidata", "viaf", "isni", "gnd", "openlibrary"] as const;

export const ID_FIELDS = [...SERIAL_IDS, ...ITEM_IDS] as const;

export type CatalogId = (typeof ID_FIELDS)[number];

export type CatalogIds = Partial<Record<CatalogId, string>>;

export type WorkPatch = Partial<DublinCore> & { ids?: CatalogIds };

export type SeriesRef = {
  id: string;
  title: string;
  volume: number;
  of: number;
  /** What this volume covers, such as a date span. */
  label: string;
};

export type Work = {
  id: string;
  title: string;
  author: string;
  /** Language of this text, including a translation, not the language it was first written in. */
  language: string;
  form: string;
  period: string;
  genre: string;
  edition: string;
  description?: string;
  publisher?: string;
  contributor?: string;
  date?: string;
  identifier?: string;
  relation?: string;
  rights?: string;
  format?: string;
  /** ISBN, ISSN, Wikidata, and the other numbers that are not a table column. */
  ids?: CatalogIds;
  /** A picture of the book, when one exists: a shipped page image or a path. */
  cover?: string;
  /** Cover bytes taken from an imported file. Stripped before the record is stored. */
  coverBytes?: Uint8Array;
  coverType?: string;
  sections: Section[];
  imported?: boolean;
  /** Set when this volume is one part of a multi-volume collection. */
  series?: SeriesRef;
};

export type Excerpt = {
  id: string;
  workId: string;
  sectionId: string;
  heading: string;
  text: string;
  start: number;
  end: number;
  created: number;
  title: string;
  creator: string;
  source: string;
  /** Printed page the passage starts on, when the import kept one. */
  page?: string;
  /** Labels the reader attached. Absent on excerpts saved before tags existed. */
  tags?: string[];
  /** The passage as first saved, kept once the quotation is revised. */
  original?: string;
};

export type FacetKey = "language" | "author" | "form" | "period" | "genre";

export type FacetSelection = Record<FacetKey, string[]>;

export const EMPTY_FACETS: FacetSelection = {
  language: [],
  author: [],
  form: [],
  period: [],
  genre: [],
};

export const DUBLIN_FIELDS = [
  "title",
  "creator",
  "subject",
  "description",
  "publisher",
  "contributor",
  "date",
  "type",
  "format",
  "identifier",
  "source",
  "language",
  "relation",
  "coverage",
  "rights",
] as const;

export type DublinField = (typeof DUBLIN_FIELDS)[number];
