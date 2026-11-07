import { readPersona, writePersona } from "../library-db";
import { lookupQueries, namesCompatible } from "./names";
import { samplePersona } from "./samples";

export type PublicWork = { title: string; year: string | null; url: string | null };

export type PublicProfile = {
  name: string;
  qid: string | null;
  summary: string;
  description: string;
  image: string | null;
  wikipedia: string | null;
  born: string | null;
  died: string | null;
  occupations: string[];
  /** Other labels for this same person, as Wikidata keeps aliases. */
  aliases?: string[];
  works: PublicWork[];
};

const cache = new Map<string, Promise<PublicProfile>>();

type SearchHit = { id: string; label: string; description?: string };

function scoreHit(hit: SearchHit, name: string): number {
  let score = 0;
  if (namesCompatible(hit.label, name)) score += 8;
  else if (hit.label.toLowerCase() === name.toLowerCase()) score += 6;
  else if (hit.label.toLowerCase().includes(name.toLowerCase())) score += 2;
  const description = (hit.description ?? "").toLowerCase();
  if (/poet|philosoph|histor|writer|author|dramat|emperor|stoic|orator|psychiatr|physician|teacher/.test(description)) score += 3;
  if (/disambiguation|crater|surname|given name/.test(description)) score -= 6;
  return score;
}

function yearOf(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^([+-])0*(\d+)-(\d{2})/.exec(value);
  if (!match) return null;
  const year = Number(match[2]);
  if (!year) return null;
  return match[1] === "-" ? `${year} BCE` : String(year);
}

async function wikiJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

type AuthorClaim = { mainsnak?: { datavalue?: { value?: { id?: string } } } };

function titleQueries(title: string): string[] {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length < 3) return [];
  const head = clean.split(/[:;—–]/)[0]?.trim() ?? clean;
  return [...new Set([clean, head].filter((part) => part.length >= 3))].slice(0, 2);
}

/** The person who is credited on these titles, when the name still fits. */
async function authorFromTitles(name: string, titles: string[]): Promise<string | null> {
  const votes = new Map<string, number>();
  for (const title of titles.slice(0, 2)) {
    for (const query of titleQueries(title).slice(0, 1)) {
      const search = await wikiJson<{ search?: { id: string }[] }>(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&type=item&limit=4&format=json&origin=*`,
      );
      const workIds = (search?.search ?? []).map((hit) => hit.id).filter((id) => /^Q\d+$/.test(id)).slice(0, 3);
      if (!workIds.length) continue;
      const works = await wikiJson<{ entities?: Record<string, { claims?: { P50?: AuthorClaim[] } }> }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${workIds.join("|")}&props=claims&format=json&origin=*`,
      );
      const authorIds = new Set<string>();
      for (const id of workIds) {
        for (const claim of works?.entities?.[id]?.claims?.P50 ?? []) {
          const authorId = claim.mainsnak?.datavalue?.value?.id;
          if (authorId && /^Q\d+$/.test(authorId)) authorIds.add(authorId);
        }
      }
      if (!authorIds.size) continue;
      const authors = await wikiJson<{ entities?: Record<string, { labels?: { en?: { value?: string } } }> }>(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${[...authorIds].slice(0, 8).join("|")}&props=labels&languages=en&format=json&origin=*`,
      );
      for (const [authorId, record] of Object.entries(authors?.entities ?? {})) {
        const label = record.labels?.en?.value ?? "";
        if (label && namesCompatible(label, name)) votes.set(authorId, (votes.get(authorId) ?? 0) + 1);
      }
    }
  }
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function fetchPersona(name: string, titles: string[] = []): Promise<PublicProfile> {
  const empty: PublicProfile = {
    name,
    qid: null,
    summary: "",
    description: "",
    image: null,
    wikipedia: null,
    born: null,
    died: null,
    occupations: [],
    works: [],
  };
  let best: SearchHit | undefined;
  const fromTitles = titles.length ? await authorFromTitles(name, titles) : null;
  if (fromTitles) best = { id: fromTitles, label: name };
  for (const query of fromTitles ? [] : lookupQueries(name)) {
    const search = await wikiJson<{ search?: SearchHit[] }>(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(query)}&language=en&type=item&limit=8&format=json&origin=*`,
    );
    const found = search?.search ?? [];
    const compatible = found.filter((hit) => namesCompatible(hit.label, name) && /^Q\d+$/.test(hit.id) && scoreHit(hit, name) > 2);
    if (compatible.length) {
      best = compatible.sort((a, b) => scoreHit(b, name) - scoreHit(a, name))[0];
      break;
    }
  }
  if (!best) return empty;

  const entity = await wikiJson<{
    entities?: Record<
      string,
      {
        sitelinks?: { enwiki?: { title?: string } };
        labels?: Record<string, { value?: string }>;
        aliases?: Record<string, { value?: string }[]>;
      }
    >;
  }>(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${best.id}&props=sitelinks|labels|aliases&languages=en|la|el&sitefilter=enwiki&format=json&origin=*`,
  );
  const record = entity?.entities?.[best.id];
  const wikiTitle = record?.sitelinks?.enwiki?.title ?? best.label;
  const labels = Object.values(record?.labels ?? {})
    .map((item) => item.value?.trim() ?? "")
    .filter(Boolean);
  const aliasValues = Object.values(record?.aliases ?? [])
    .flat()
    .map((item) => item.value?.trim() ?? "")
    .filter(Boolean);
  const aliases = [...new Set([...labels, ...aliasValues, best.label])].filter((label) => label.toLowerCase() !== name.toLowerCase());
  const summary = await wikiJson<{
    extract?: string;
    description?: string;
    thumbnail?: { source?: string };
    content_urls?: { desktop?: { page?: string } };
  }>(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`);

  const query = `
    SELECT ?birth ?death ?occLabel ?work ?workLabel ?date ?article WHERE {
      OPTIONAL { wd:${best.id} wdt:P569 ?birth }
      OPTIONAL { wd:${best.id} wdt:P570 ?death }
      OPTIONAL { wd:${best.id} wdt:P106 ?occ }
      OPTIONAL {
        ?work wdt:P50 wd:${best.id} .
        OPTIONAL { ?work wdt:P577 ?date }
        OPTIONAL { ?article schema:about ?work ; schema:isPartOf <https://en.wikipedia.org/> }
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 40`;
  const sparql = await wikiJson<{
    results?: {
      bindings: {
        birth?: { value: string };
        death?: { value: string };
        occLabel?: { value: string };
        workLabel?: { value: string };
        date?: { value: string };
        article?: { value: string };
      }[];
    };
  }>(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`);

  const rows = sparql?.results?.bindings ?? [];
  const occupations = [...new Set(rows.map((row) => row.occLabel?.value).filter((v): v is string => !!v && !v.startsWith("Q")))];
  const seen = new Set<string>();
  const works = rows.flatMap((row) => {
    const title = row.workLabel?.value;
    if (!title || title.startsWith("Q") || seen.has(title.toLowerCase())) return [];
    seen.add(title.toLowerCase());
    return [{ title, year: yearOf(row.date?.value), url: row.article?.value ?? null }];
  });

  return {
    name,
    qid: best.id,
    summary: summary?.extract ?? "",
    description: summary?.description || best.description || "",
    image: summary?.thumbnail?.source ?? null,
    wikipedia: summary?.content_urls?.desktop?.page ?? null,
    born: yearOf(rows.find((row) => row.birth)?.birth?.value),
    died: yearOf(rows.find((row) => row.death)?.death?.value),
    occupations: occupations.slice(0, 4),
    aliases,
    works: works.slice(0, 24),
  };
}

async function resolvePersona(name: string, titles: string[]): Promise<PublicProfile> {
  const cached = await readPersona(name);
  if (typeof navigator !== "undefined" && navigator.onLine === false) return cached ?? emptyProfile(name);
  try {
    const fresh = await fetchPersona(name, titles);
    if (fresh.qid || fresh.summary) {
      await writePersona(name, fresh);
      return fresh;
    }
    return cached ?? fresh;
  } catch {
    return cached ?? emptyProfile(name);
  }
}

function emptyProfile(name: string): PublicProfile {
  return {
    name,
    qid: null,
    summary: "",
    description: "",
    image: null,
    wikipedia: null,
    born: null,
    died: null,
    occupations: [],
    works: [],
  };
}

export function loadPersona(name: string, titles: string[] = []): Promise<PublicProfile> {
  const bundled = samplePersona(name) as PublicProfile | null;
  const hint = titles.map((title) => title.trim().toLowerCase()).filter(Boolean).slice(0, 2).join("|");
  const key = hint ? `${name.toLowerCase()}|${hint}` : name.toLowerCase();
  let pending = cache.get(key);
  if (!pending) {
    pending = (bundled ? cachedSample(name, bundled) : resolvePersona(name, titles)).catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return pending;
}

/** A shipped persona is already fetched. Read the stored copy, or write the shipped one into the cache. */
async function cachedSample(name: string, bundled: PublicProfile): Promise<PublicProfile> {
  const stored = await readPersona(name);
  if (stored?.summary) return stored;
  await writePersona(name, bundled);
  return bundled;
}
