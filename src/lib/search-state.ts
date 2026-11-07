import type { FacetKey, FacetSelection, Work } from "./corpus/types";
import { EMPTY_FACETS } from "./corpus/types";

export type LibrarySearch = {
  q: string;
  w: string;
  lang: string;
  author: string;
  form: string;
  period: string;
  genre: string;
};

const FACET_PARAM: Record<FacetKey, keyof LibrarySearch> = {
  language: "lang",
  author: "author",
  form: "form",
  period: "period",
  genre: "genre",
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function readSearch(search: Record<string, unknown>): LibrarySearch {
  return {
    q: str(search.q),
    w: str(search.w),
    lang: str(search.lang),
    author: str(search.author),
    form: str(search.form),
    period: str(search.period),
    genre: str(search.genre),
  };
}

function list(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function facetsFromSearch(search: LibrarySearch): FacetSelection {
  return {
    language: list(search.lang),
    author: list(search.author),
    form: list(search.form),
    period: list(search.period),
    genre: list(search.genre),
  };
}

export function searchWithFacet(search: LibrarySearch, key: FacetKey, name: string): LibrarySearch {
  const current = facetsFromSearch(search);
  const has = current[key].includes(name);
  const next = has ? current[key].filter((item) => item !== name) : [...current[key], name];
  return { ...search, [FACET_PARAM[key]]: next.join(",") };
}

export function clearFacets(search: LibrarySearch): LibrarySearch {
  return { ...search, lang: "", author: "", form: "", period: "", genre: "" };
}

export function hasFacets(facets: FacetSelection): boolean {
  return (Object.keys(EMPTY_FACETS) as FacetKey[]).some((key) => facets[key].length > 0);
}

export function workMatchesFacets(work: Work, facets: FacetSelection): boolean {
  const keys = Object.keys(EMPTY_FACETS) as FacetKey[];
  return keys.every((key) => facets[key].length === 0 || facets[key].includes(work[key]));
}

const LAST_SEARCH = "folio-last-search";
const RESULT_PLACE = "folio-result-place";

export function resultDomId(workId: string, snippetId: string): string {
  return `result-${workId}-${snippetId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

/** The snippet a result link opened, so Back can return to it. */
export function rememberResultPlace(id: string) {
  try {
    sessionStorage.setItem(RESULT_PLACE, id);
  } catch {
    /* private mode */
  }
}

export function readResultPlace(): string {
  try {
    return sessionStorage.getItem(RESULT_PLACE) ?? "";
  } catch {
    return "";
  }
}

export function clearResultPlace() {
  try {
    sessionStorage.removeItem(RESULT_PLACE);
  } catch {
    /* private mode */
  }
}

export function searchActive(search: LibrarySearch): boolean {
  return Boolean(
    search.q.trim() || search.w.trim() || search.lang || search.author || search.form || search.period || search.genre,
  );
}

export function readLastSearch(): LibrarySearch {
  if (typeof localStorage === "undefined") return { q: "", w: "", lang: "", author: "", form: "", period: "", genre: "" };
  try {
    const raw = localStorage.getItem(LAST_SEARCH);
    if (!raw) return { q: "", w: "", lang: "", author: "", form: "", period: "", genre: "" };
    return readSearch(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return { q: "", w: "", lang: "", author: "", form: "", period: "", genre: "" };
  }
}

export function rememberSearch(search: LibrarySearch): void {
  try {
    if (!searchActive(search)) localStorage.removeItem(LAST_SEARCH);
    else localStorage.setItem(LAST_SEARCH, JSON.stringify(search));
  } catch {
    /* private mode */
  }
}
