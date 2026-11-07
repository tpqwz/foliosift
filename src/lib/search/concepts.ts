import { stem } from "./stem";

/** Classical families, searched ahead of WordNet. Greek and Latin terms stay here. */
const FAMILIES: string[][] = [
  ["virtue", "excellence", "arete", "noble"],
  ["soul", "mind", "psyche", "spirit"],
  ["god", "gods", "divine", "deity", "zeus"],
  ["death", "die", "dying", "mortal", "mortality"],
  ["war", "battle", "fight", "fighting", "strife"],
  ["love", "beloved", "eros", "desire"],
  ["wisdom", "wise", "philosophy", "philosopher"],
  ["city", "polis", "state", "citizen", "citizens"],
  ["justice", "just", "injustice", "righteous"],
  ["fate", "destiny", "doom"],
  ["sea", "ocean", "wave", "waves", "sail", "sailing"],
  ["anger", "wrath", "rage"],
  ["friend", "friendship", "companion", "companions"],
  ["nature", "natural", "physis"],
  ["reason", "rational", "logos"],
  ["happiness", "flourishing", "eudaimonia", "happy"],
  ["courage", "brave", "bravery", "coward", "cowardice"],
  ["pleasure", "pain"],
  ["law", "custom", "nomos"],
  ["fear", "afraid", "terror"],
  ["honor", "honour", "glory", "fame"],
  ["home", "household", "return", "nostos"],
];

const byStem = new Map<string, string[]>();
for (const family of FAMILIES) {
  const norms = family.map((w) => w.toLowerCase());
  for (const word of norms) {
    byStem.set(stem(word), norms);
  }
}

/** Related words actually searched, after the word itself. Classical families come first. */
const CAP = 12;

let net: Map<string, string[]> | null = null;
let loading: Promise<void> | null = null;

export function thesaurusReady(): boolean {
  return net !== null;
}

/** Load the shipped WordNet list once. A failure leaves the classical families in place. */
export function ensureThesaurus(): Promise<void> {
  if (net) return Promise.resolve();
  if (!loading) {
    loading = fetch("/wordnet-syn.txt")
      .then((res) => (res.ok ? res.text() : ""))
      .then((text) => {
        const map = new Map<string, string[]>();
        for (const line of text.split("\n")) {
          if (!line || line.startsWith("#")) continue;
          const tab = line.indexOf("\t");
          if (tab < 1) continue;
          const word = line.slice(0, tab);
          const syns = line.slice(tab + 1).split(",").filter(Boolean);
          if (word && syns.length) map.set(word, syns);
        }
        net = map;
      })
      .catch(() => {
        net = new Map();
      });
  }
  return loading;
}

function wordnetOf(norm: string): string[] {
  if (!net?.size) return [];
  const direct = net.get(norm);
  if (direct) return direct;
  const stemmed = stem(norm);
  return stemmed === norm ? [] : (net.get(stemmed) ?? []);
}

export function conceptFamily(norm: string): string[] | null {
  const key = norm.toLowerCase();
  const classical = byStem.get(stem(key));
  const extra = wordnetOf(key);
  if (!classical && !extra.length) return null;
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (word: string) => {
    const next = word.toLowerCase();
    if (!next || seen.has(next) || out.length >= CAP + 1) return;
    seen.add(next);
    out.push(next);
  };
  add(key);
  for (const word of classical ?? []) add(word);
  for (const word of extra) add(word);
  return out.length > 1 ? out : null;
}
