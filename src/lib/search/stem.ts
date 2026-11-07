/** Porter stemmer. Non-alphabetic tokens pass through unchanged. */

const VOWELS = "aeiou";

function isConsonant(word: string, i: number): boolean {
  const ch = word[i];
  if (!ch) return false;
  if (VOWELS.includes(ch)) return false;
  if (ch === "y") {
    if (i === 0) return true;
    return !isConsonant(word, i - 1);
  }
  return true;
}

/** Measure: number of VC sequences. */
function measure(stem: string): number {
  let i = 0;
  let m = 0;
  const n = stem.length;
  while (i < n && isConsonant(stem, i)) i++;
  while (i < n) {
    while (i < n && !isConsonant(stem, i)) i++;
    if (i >= n) break;
    m++;
    while (i < n && isConsonant(stem, i)) i++;
  }
  return m;
}

function hasVowel(stem: string): boolean {
  for (let i = 0; i < stem.length; i++) {
    if (!isConsonant(stem, i)) return true;
  }
  return false;
}

function endsDoubleConsonant(stem: string): boolean {
  const n = stem.length;
  if (n < 2) return false;
  return stem[n - 1] === stem[n - 2] && isConsonant(stem, n - 1);
}

function cvc(stem: string): boolean {
  const n = stem.length;
  if (n < 3) return false;
  if (!isConsonant(stem, n - 1) || isConsonant(stem, n - 2) || !isConsonant(stem, n - 3)) return false;
  const ch = stem[n - 1];
  return ch !== "w" && ch !== "x" && ch !== "y";
}

function replaceSuffix(
  word: string,
  suffix: string,
  replacement: string,
  minMeasure: number,
): string | null {
  if (!word.endsWith(suffix)) return null;
  const stem = word.slice(0, -suffix.length);
  if (measure(stem) <= minMeasure) return null;
  return stem + replacement;
}

const STEP2: [string, string][] = [
  ["ational", "ate"],
  ["tional", "tion"],
  ["enci", "ence"],
  ["anci", "ance"],
  ["izer", "ize"],
  ["abli", "able"],
  ["alli", "al"],
  ["entli", "ent"],
  ["eli", "e"],
  ["ousli", "ous"],
  ["ization", "ize"],
  ["ation", "ate"],
  ["ator", "ate"],
  ["alism", "al"],
  ["iveness", "ive"],
  ["fulness", "ful"],
  ["ousness", "ous"],
  ["aliti", "al"],
  ["iviti", "ive"],
  ["biliti", "ble"],
];

const STEP3: [string, string][] = [
  ["icate", "ic"],
  ["ative", ""],
  ["alize", "al"],
  ["iciti", "ic"],
  ["ical", "ic"],
  ["ful", ""],
  ["ness", ""],
];

const STEP4 = [
  "al",
  "ance",
  "ence",
  "er",
  "ic",
  "able",
  "ible",
  "ant",
  "ement",
  "ment",
  "ent",
  "ou",
  "ism",
  "ate",
  "iti",
  "ous",
  "ive",
  "ize",
];

function step1a(word: string): string {
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("ies")) return word.slice(0, -2);
  if (word.endsWith("ss")) return word;
  if (word.endsWith("s")) return word.slice(0, -1);
  return word;
}

function step1b(word: string): string {
  if (word.endsWith("eed")) {
    const stem = word.slice(0, -3);
    return measure(stem) > 0 ? stem + "ee" : word;
  }
  let stem = "";
  if (word.endsWith("ed")) stem = word.slice(0, -2);
  else if (word.endsWith("ing")) stem = word.slice(0, -3);
  else return word;
  if (!hasVowel(stem)) return word;
  if (stem.endsWith("at") || stem.endsWith("bl") || stem.endsWith("iz")) return stem + "e";
  if (endsDoubleConsonant(stem) && !/[lsz]$/.test(stem)) return stem.slice(0, -1);
  if (measure(stem) === 1 && cvc(stem)) return stem + "e";
  return stem;
}

function step1c(word: string): string {
  if (!word.endsWith("y")) return word;
  const stem = word.slice(0, -1);
  return hasVowel(stem) ? stem + "i" : word;
}

function stepList(word: string, table: [string, string][], minM: number): string {
  for (const [suffix, repl] of table) {
    const next = replaceSuffix(word, suffix, repl, minM);
    if (next !== null) return next;
  }
  return word;
}

function step4(word: string): string {
  for (const suffix of STEP4) {
    if (!word.endsWith(suffix)) continue;
    const stem = word.slice(0, -suffix.length);
    if (measure(stem) > 1) return stem;
  }
  if (word.endsWith("ion")) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 1 && /[st]$/.test(stem)) return stem;
  }
  return word;
}

function step5(word: string): string {
  if (word.endsWith("e")) {
    const stem = word.slice(0, -1);
    const m = measure(stem);
    if (m > 1 || (m === 1 && !cvc(stem))) word = stem;
  }
  if (measure(word) > 1 && endsDoubleConsonant(word) && word.endsWith("l")) {
    word = word.slice(0, -1);
  }
  return word;
}

export function stem(word: string): string {
  if (!/^[a-z]+$/.test(word) || word.length < 3) return word;
  let w = step1a(word);
  w = step1b(w);
  w = step1c(w);
  w = stepList(w, STEP2, 0);
  w = stepList(w, STEP3, 0);
  w = step4(w);
  w = step5(w);
  return w;
}
