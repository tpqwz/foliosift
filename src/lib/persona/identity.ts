import { listOf, personaSlug } from "../corpus/dublin";
import type { Work } from "../corpus/types";
import type { PublicProfile } from "./load";
import { nameGroupKey, namesCompatible, preferLabel } from "./names";
import { SAMPLE_PERSONAS } from "./samples";

/** Other labels for a shipped person. The key is the sample's stored name. */
const SAMPLE_ALIASES: Record<string, string[]> = {
  homer: ["Homeros", "Homerus"],
  hesiod: ["Hesiodos"],
  thucydides: ["Thoukydides", "Thucydides"],
  plato: ["Platon"],
  aristotle: ["Aristoteles"],
  virgil: ["Vergil", "Publius Vergilius Maro"],
  "marcus aurelius": ["Marcus Aurelius Antoninus"],
  epictetus: ["Epiktetos"],
  lucretius: ["Titus Lucretius Carus"],
  augustine: ["Augustine of Hippo", "Saint Augustine", "St. Augustine", "Aurelius Augustinus"],
  maimonides: ["Moses Maimonides", "Moses ben Maimon", "Rabbi Moses ben Maimon", "Rambam"],
  avicenna: ["Ibn Sina", "Ibn Sīnā", "Abu Ali al-Husayn ibn Sina"],
  "walter b. cannon": ["Walter Bradford Cannon", "W. B. Cannon"],
};

export type PersonaEntity = {
  key: string;
  label: string;
  names: string[];
  aliases: string[];
  works: Work[];
};

function norm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function same(a: string, b: string): boolean {
  return norm(a) === norm(b) || personaSlug(a) === personaSlug(b);
}

function sampleFor(name: string): (typeof SAMPLE_PERSONAS)[keyof typeof SAMPLE_PERSONAS] | null {
  const direct = SAMPLE_PERSONAS[norm(name) as keyof typeof SAMPLE_PERSONAS];
  if (direct) return direct;
  for (const [key, aliases] of Object.entries(SAMPLE_ALIASES)) {
    if (same(key, name) || aliases.some((alias) => same(alias, name))) {
      return SAMPLE_PERSONAS[key as keyof typeof SAMPLE_PERSONAS] ?? null;
    }
  }
  return null;
}

function matchesProfile(profile: PublicProfile, name: string): boolean {
  if (same(profile.name, name) || namesCompatible(profile.name, name)) return true;
  return (profile.aliases ?? []).some((alias) => same(alias, name) || namesCompatible(alias, name));
}

function qidFor(name: string, profiles: PublicProfile[]): string | null {
  const sample = sampleFor(name);
  if (sample?.qid) return sample.qid;
  for (const profile of profiles) {
    if (profile.qid && matchesProfile(profile, name)) return profile.qid;
  }
  return null;
}

function clusterId(name: string, authors: string[], profiles: PublicProfile[]): string {
  const group = nameGroupKey(name, authors);
  const mates = authors.filter((other) => nameGroupKey(other, authors) === group);
  const qids = new Set(mates.map((other) => qidFor(other, profiles)).filter((qid): qid is string => !!qid));
  const own = qidFor(name, profiles);
  if (own && qids.size > 1) return own;
  if (qids.size === 1) return [...qids][0];
  return own ?? group;
}

export function personaEntities(works: Work[], profiles: PublicProfile[]): PersonaEntity[] {
  const authors = [...new Set(works.flatMap((work) => listOf(work.author)))];
  const buckets = new Map<string, { names: Set<string>; works: Map<string, Work> }>();
  for (const work of works) {
    for (const name of listOf(work.author)) {
      const key = clusterId(name, authors, profiles);
      const bucket = buckets.get(key) ?? { names: new Set<string>(), works: new Map<string, Work>() };
      bucket.names.add(name);
      bucket.works.set(work.id, work);
      buckets.set(key, bucket);
    }
  }
  const entities: PersonaEntity[] = [];
  for (const [key, bucket] of buckets) {
    const names = [...bucket.names];
    const sample = names.map((name) => sampleFor(name)).find((item) => item);
    const profile = profiles.find((item) => item.qid === key) ?? profiles.find((item) => names.some((name) => matchesProfile(item, name)));
    const forms = [...names, ...(profile?.name ? [profile.name] : []), ...(profile?.aliases ?? [])];
    const label = sample?.name || preferLabel(forms);
    const aliasSet = new Set<string>();
    for (const name of names) if (!same(name, label)) aliasSet.add(name);
    for (const alias of sample ? (SAMPLE_ALIASES[norm(sample.name)] ?? []) : []) aliasSet.add(alias);
    for (const alias of profile?.aliases ?? []) if (!same(alias, label)) aliasSet.add(alias);
    entities.push({
      key,
      label,
      names,
      aliases: [...aliasSet],
      works: [...bucket.works.values()],
    });
  }
  return entities.sort((a, b) => a.label.localeCompare(b.label));
}

export function entityBySlug(entities: PersonaEntity[], slug: string): PersonaEntity | null {
  return (
    entities.find((entity) => personaSlug(entity.label) === slug) ??
    entities.find(
      (entity) =>
        entity.names.some((name) => personaSlug(name) === slug) ||
        entity.aliases.some((alias) => personaSlug(alias) === slug),
    ) ??
    null
  );
}
