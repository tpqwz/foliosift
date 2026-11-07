const HONORIFICS = new Set([
  "dr",
  "doctor",
  "mr",
  "mrs",
  "ms",
  "miss",
  "prof",
  "professor",
  "sir",
  "dame",
  "rev",
  "reverend",
  "fr",
  "hon",
  "honorable",
]);

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "phd", "md", "esq"]);

const PARTICLES = new Set(["de", "da", "del", "della", "di", "van", "von", "der", "den", "la", "le", "du"]);

export type ParsedName = {
  honorific: string;
  first: string;
  middles: string[];
  last: string;
  suffix: string;
};

function clean(token: string): string {
  return token.toLowerCase().replace(/\./g, "");
}

function tokensOf(raw: string): string[] {
  return raw
    .replace(/,/g, " ")
    .split(/\s+/)
    .flatMap((token) => (/^(?:[A-Za-z]\.){2,}$/.test(token) ? token.split(".").filter(Boolean) : [token]))
    .map((token) => token.trim())
    .filter(Boolean);
}

/** Split a personal name into the parts that decide whether two strings are the same person. */
export function parsePersonName(raw: string): ParsedName {
  const comma = raw.split(",");
  if (comma.length >= 2 && comma[0].trim() && !HONORIFICS.has(clean(comma[0].trim().split(/\s+/).at(-1) ?? ""))) {
    const last = tokensOf(comma[0]).map(clean).join(" ");
    const given = stripEnds(tokensOf(comma.slice(1).join(" ")));
    return {
      honorific: given.honorific,
      first: clean(given.body[0] ?? ""),
      middles: given.body.slice(1).map(clean),
      last,
      suffix: given.suffix,
    };
  }
  const stripped = stripEnds(tokensOf(raw));
  const body = stripped.body;
  if (body.length === 0) return { honorific: stripped.honorific, first: "", middles: [], last: "", suffix: stripped.suffix };
  if (body.length === 1) return { honorific: stripped.honorific, first: "", middles: [], last: clean(body[0]), suffix: stripped.suffix };
  let lastStart = body.length - 1;
  while (lastStart > 1 && PARTICLES.has(clean(body[lastStart - 1]))) lastStart -= 1;
  return {
    honorific: stripped.honorific,
    first: clean(body[0]),
    middles: body.slice(1, lastStart).map(clean),
    last: body.slice(lastStart).map(clean).join(" "),
    suffix: stripped.suffix,
  };
}

function stripEnds(tokens: string[]): { honorific: string; body: string[]; suffix: string } {
  let start = 0;
  let honorific = "";
  while (start < tokens.length && HONORIFICS.has(clean(tokens[start]))) {
    honorific = honorific || tokens[start];
    start += 1;
  }
  let end = tokens.length;
  let suffix = "";
  while (end > start && SUFFIXES.has(clean(tokens[end - 1]))) {
    suffix = clean(tokens[end - 1]);
    end -= 1;
  }
  return { honorific, body: tokens.slice(start, end), suffix };
}

function initial(token: string): string {
  return token[0] ?? "";
}

function givenMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length === 1 && b.startsWith(a)) return true;
  if (b.length === 1 && a.startsWith(b)) return true;
  return false;
}

function middlesMatch(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  const count = Math.min(a.length, b.length);
  for (let i = 0; i < count; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) continue;
    if (left.length === 1 && right.startsWith(left)) continue;
    if (right.length === 1 && left.startsWith(right)) continue;
    return false;
  }
  return true;
}

function middleMark(name: ParsedName): string {
  return name.middles.map(initial).join("");
}

/** True when the strings can be the same person. Conflicting middle names stay apart. */
export function namesCompatible(a: string, b: string): boolean {
  const left = parsePersonName(a);
  const right = parsePersonName(b);
  if (!left.first || !left.last || !right.first || !right.last) return false;
  if (left.last !== right.last) return false;
  if (!givenMatch(left.first, right.first)) return false;
  if (left.suffix && right.suffix && left.suffix !== right.suffix) return false;
  return middlesMatch(left.middles, right.middles);
}

/** Names with no middle join the group only when every longer form agrees. */
export function sameNameGroup(name: string, names: string[]): boolean {
  const mine = parsePersonName(name);
  if (!mine.first || !mine.last) return false;
  const family = names.filter((other) => {
    const parsed = parsePersonName(other);
    return (
      parsed.first &&
      parsed.last === mine.last &&
      givenMatch(parsed.first, mine.first) &&
      (!mine.suffix || !parsed.suffix || mine.suffix === parsed.suffix)
    );
  });
  const marks = new Set(family.map((other) => middleMark(parsePersonName(other))).filter(Boolean));
  if (marks.size <= 1) return true;
  const mark = middleMark(mine);
  return Boolean(mark) && marks.has(mark);
}

export function nameGroupKey(name: string, names: string[]): string {
  const parsed = parsePersonName(name);
  if (!parsed.first || !parsed.last || !sameNameGroup(name, names)) return `solo:${name.trim().toLowerCase()}`;
  const family = names.filter((other) => {
    const next = parsePersonName(other);
    return next.last === parsed.last && givenMatch(next.first, parsed.first);
  });
  const marks = new Set(family.map((other) => middleMark(parsePersonName(other))).filter(Boolean));
  const mark = marks.size === 1 ? [...marks][0] : middleMark(parsed);
  return `name:${parsed.first}|${parsed.last}|${mark}|${parsed.suffix}`;
}

function plain(parsed: ParsedName): string {
  const middles = parsed.middles.map((token) => (token.length === 1 ? `${token.toUpperCase()}.` : token[0].toUpperCase() + token.slice(1)));
  const first = parsed.first ? parsed.first[0].toUpperCase() + parsed.first.slice(1) : "";
  const last = parsed.last
    .split(" ")
    .map((token) => (PARTICLES.has(token) ? token : token[0].toUpperCase() + token.slice(1)))
    .join(" ");
  return [first, ...middles, last].filter(Boolean).join(" ");
}

const STRONG_TITLES = new Set(["dr", "doctor", "prof", "professor", "sir", "dame", "rev", "reverend", "fr"]);

const TITLE_LABEL: Record<string, string> = {
  dr: "Dr.",
  doctor: "Dr.",
  mr: "Mr.",
  mrs: "Mrs.",
  ms: "Ms.",
  miss: "Miss",
  prof: "Prof.",
  professor: "Prof.",
  sir: "Sir",
  dame: "Dame",
  rev: "Rev.",
  reverend: "Rev.",
  fr: "Fr.",
  hon: "Hon.",
  honorable: "Hon.",
};

function titleLabel(raw: string): string {
  const key = clean(raw);
  return TITLE_LABEL[key] ?? raw.replace(/\.$/, "") + (raw.endsWith(".") ? "." : "");
}

/** Natural order, with a real title such as Dr. kept when any form of the name has it. */
export function spokenName(name: string, hints: string[] = []): string {
  const parsed = parsePersonName(name);
  const body = plain(parsed);
  if (!parsed.first || !parsed.last || !body) return name.trim();
  const pool = [name, ...hints];
  const titled = pool.map(parsePersonName).find((item) => {
    if (!item.honorific || !STRONG_TITLES.has(clean(item.honorific))) return false;
    return namesCompatible(plain(item), body) || namesCompatible(plain({ ...item, honorific: "" }), body);
  });
  const honorific =
    titled?.honorific ||
    (parsed.honorific && STRONG_TITLES.has(clean(parsed.honorific)) ? parsed.honorific : "") ||
    (parsed.suffix === "md" || parsed.suffix === "phd" ? "dr" : "");
  if (!honorific) return body;
  return `${titleLabel(honorific)} ${body}`;
}

/** The name as a reader would say it, not as a catalog files it. */
export function preferLabel(names: string[]): string {
  const fullest = names.slice().sort((a, b) => richness(b) - richness(a))[0] || "Unknown";
  return spokenName(fullest, names);
}

function richness(name: string): number {
  const parsed = parsePersonName(name);
  let score = parsed.middles.reduce((sum, token) => sum + (token.length > 1 ? 5 : 2), 0);
  if (parsed.honorific && STRONG_TITLES.has(clean(parsed.honorific))) score += 4;
  if (/[A-Za-z]\./.test(name)) score += 1;
  return score + parsed.first.length + parsed.last.length;
}

/** Queries to try, fullest first. The short form is only a fallback. */
export function lookupQueries(raw: string): string[] {
  const parsed = parsePersonName(raw);
  const full = plain(parsed);
  const short = plain({ ...parsed, middles: [], honorific: "" });
  const queries = [full || raw.trim()];
  if (short && short.toLowerCase() !== full.toLowerCase()) queries.push(short);
  return [...new Set(queries.filter(Boolean))];
}
