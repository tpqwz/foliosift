import { decodeEntities, htmlToMarkup, normalizePath, pageRefsFromNav, tocLabels, type PageRef } from "./html-text.ts";
import { classifyIdentifier } from "./ids.ts";
import { labelLanguage, parseImport, titleFromName, yamlValue } from "./markup.ts";
import type { Work } from "./types";
import { unzip, zipText } from "./zip.ts";

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of tag.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const key = (match[1].split(":").pop() ?? match[1]).toLowerCase();
    out[key] = decodeEntities(match[3] ?? match[4] ?? "");
  }
  return out;
}

function dc(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${name}>`, "gi");
  return [...xml.matchAll(re)]
    .map((match) => decodeEntities(match[1].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function dcPeople(xml: string, name: string): { name: string; role: string }[] {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z0-9]+:)?${name}>`, "gi");
  return [...xml.matchAll(re)].flatMap((match) => {
    const value = decodeEntities(match[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!value) return [];
    return [{ name: value, role: (attrs(`<person${match[1]}>`).role ?? "").toLowerCase() }];
  });
}

const EDITOR_ROLES = new Set(["edt", "ed", "editor", "trl", "translator", "ill", "illustrator", "ctb", "contributor"]);
const AUTHOR_ROLES = new Set(["aut", "author", "cre", "creator"]);

function cast(xml: string): { creators: string[]; editors: string[] } {
  const creators: string[] = [];
  const editors: string[] = [];
  const add = (list: string[], name: string) => {
    if (name && !list.includes(name)) list.push(name);
  };
  for (const person of dcPeople(xml, "creator")) {
    if (EDITOR_ROLES.has(person.role)) add(editors, person.name);
    else add(creators, person.name);
  }
  for (const person of dcPeople(xml, "contributor")) {
    if (AUTHOR_ROLES.has(person.role)) add(creators, person.name);
    else add(editors, person.name);
  }
  return { creators, editors };
}

function dcIdentifiers(xml: string): { value: string; scheme: string }[] {
  const re = /<(?:[A-Za-z0-9]+:)?identifier\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z0-9]+:)?identifier>/gi;
  return [...xml.matchAll(re)].flatMap((match) => {
    const value = decodeEntities(match[2].replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
    if (!value) return [];
    return [{ value, scheme: attrs(`<identifier${match[1]}>`).scheme ?? "" }];
  });
}

function identifierFields(xml: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const item of dcIdentifiers(xml)) {
    for (const [key, value] of Object.entries(classifyIdentifier(item.value, item.scheme))) {
      if (value && !found[key]) found[key] = value;
    }
  }
  return found;
}

function front(fields: Record<string, string>, body: string): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) if (value) lines.push(`${key}: ${yamlValue(value)}`);
  lines.push("---", "", body);
  return lines.join("\n");
}

/** Font obfuscation is not a lock. Only a cipher over the chapters themselves is. */
function contentLocked(xml: string): boolean {
  for (const ref of xml.matchAll(/CipherReference\b[^>]*URI\s*=\s*("([^"]+)"|'([^']+)')/gi)) {
    const uri = (ref[2] || ref[3] || "").split("?")[0]?.split("#")[0] ?? "";
    if (!/\.(xhtml|html|htm|opf|ncx)$/i.test(uri)) continue;
    const around = xml.slice(Math.max(0, (ref.index ?? 0) - 800), Math.min(xml.length, (ref.index ?? 0) + 800));
    if (/idpf\.org\/2008\/embedding/i.test(around)) continue;
    return true;
  }
  return false;
}

function proseLen(markup: string): number {
  return markup
    .replace(/^#{1,3} .+$/gm, "")
    .replace(/^:::page\s+\S.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim().length;
}

function tags(xml: string, name: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9]+:)?${name}\\b[^>]*>`, "gi");
  return [...xml.matchAll(re)].map((match) => match[0]);
}

type Item = { id: string; href: string; type: string; props: string };

function itemHref(dir: string, raw: string): string {
  const clean = (raw.split("#")[0] ?? "").split("?")[0] ?? "";
  if (!clean || /^(?:[a-z]+:|\/\/)/i.test(clean)) return "";
  if (clean.startsWith("/")) return normalizePath(clean.slice(1));
  return normalizePath(`${dir}${clean}`);
}

function readPackage(opf: string, opfPath: string): { manifest: Map<string, Item>; spine: string[]; navHref: string } {
  const dir = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const manifest = new Map<string, Item>();
  let navHref = "";
  for (const tag of tags(opf, "item")) {
    const attr = attrs(tag);
    const href = attr.href ? itemHref(dir, attr.href) : "";
    if (!attr.id || !href) continue;
    const item = { id: attr.id, href, type: attr["media-type"] ?? "", props: attr.properties ?? "" };
    manifest.set(attr.id, item);
    if (!navHref && /\bnav\b/.test(item.props)) navHref = href;
    if (!navHref && /ncx/i.test(item.type)) navHref = href;
  }
  const spine = tags(opf, "itemref")
    .map((tag) => attrs(tag).idref)
    .filter((id): id is string => Boolean(id));
  return { manifest, spine, navHref };
}

function coverOf(files: Map<string, Uint8Array>, opf: string, manifest: Map<string, Item>): { bytes: Uint8Array; type: string } | null {
  let href = "";
  let type = "";
  for (const item of manifest.values()) {
    if (/\bcover-image\b/.test(item.props) && /^image\//i.test(item.type)) {
      href = item.href;
      type = item.type;
      break;
    }
  }
  if (!href) {
    for (const tag of tags(opf, "meta")) {
      const attr = attrs(tag);
      const item = attr.name?.toLowerCase() === "cover" ? manifest.get(attr.content ?? "") : undefined;
      if (item && /^image\//i.test(item.type)) {
        href = item.href;
        type = item.type;
        break;
      }
    }
  }
  if (!href) return null;
  const bytes = files.get(href) ?? [...files.entries()].find(([key]) => key.toLowerCase() === href.toLowerCase())?.[1];
  if (!bytes || bytes.length < 32 || bytes.length > 1_500_000) return null;
  const sniffed =
    bytes[0] === 0xff && bytes[1] === 0xd8
      ? "image/jpeg"
      : bytes[0] === 0x89 && bytes[1] === 0x50
        ? "image/png"
        : bytes[0] === 0x47 && bytes[1] === 0x49
          ? "image/gif"
          : bytes[0] === 0x52 && bytes[1] === 0x49
            ? "image/webp"
            : "";
  const mime = sniffed || type.toLowerCase();
  if (!/^image\/(jpeg|png|gif|webp)$/.test(mime)) return null;
  return { bytes, type: mime };
}

function pagesByFile(refs: PageRef[]): Map<string, Map<string, string>> {
  const byFile = new Map<string, Map<string, string>>();
  for (const ref of refs) {
    const map = byFile.get(ref.file) ?? new Map<string, string>();
    if (!map.has(ref.id)) map.set(ref.id, ref.label);
    byFile.set(ref.file, map);
  }
  return byFile;
}

/** Read an EPUB into Folio Markdown. A locked chapter is refused; a font cipher is not. */
export async function epubToWork(
  bytes: Uint8Array,
  filename: string,
  note?: (line: string) => void,
  depth = 0,
): Promise<Work | { error: string }> {
  let files: Map<string, Uint8Array>;
  try {
    files = unzip(bytes);
  } catch (error) {
    const why = error instanceof Error ? error.message : "";
    return { error: why ? `That file is not a readable EPUB (${why}).` : "That file is not a readable EPUB." };
  }
  const containerKey = [...files.keys()].find((key) => /(^|\/)meta-inf\/container\.xml$/i.test(key)) ?? "";
  const container = containerKey ? zipText(files, containerKey) : null;
  const pointed = /full-path\s*=\s*("([^"]+)"|'([^']+)')/i.exec(container ?? "");
  const root = containerKey.includes("/") ? containerKey.slice(0, containerKey.toLowerCase().lastIndexOf("meta-inf/")) : "";
  const pointedPath = itemHref(root, pointed?.[2] || pointed?.[3] || "");
  const pointedOk =
    pointedPath &&
    (files.has(pointedPath) || [...files.keys()].some((key) => key.toLowerCase() === pointedPath.toLowerCase()));
  const opfPath = (pointedOk ? pointedPath : "") || [...files.keys()].find((key) => key.toLowerCase().endsWith(".opf")) || "";
  const opf = opfPath ? zipText(files, opfPath) : null;
  if (!opf) {
    if (depth < 1) {
      const nested = [...files.entries()].filter(([key]) => /\.epub$/i.test(key));
      if (nested.length === 1) return epubToWork(nested[0][1], filename, note, depth + 1);
    }
    return { error: "That file is not a readable EPUB." };
  }

  const encryptionKey = [...files.keys()].find((key) => /(^|\/)meta-inf\/encryption\.xml$/i.test(key)) ?? "";
  const encryptionXml = encryptionKey ? zipText(files, encryptionKey) : null;
  if (encryptionXml && contentLocked(encryptionXml)) {
    return { error: "That EPUB is locked. FolioSift will not break the lock." };
  }

  const { manifest, spine, navHref } = readPackage(opf, opfPath);
  const navXml = navHref ? zipText(files, navHref) : null;
  const pageMap = pagesByFile(navXml ? pageRefsFromNav(navXml, navHref) : []);
  const toc = navXml ? tocLabels(navXml, navHref) : new Map<string, string>();

  const htmlish = (item: Item) => /html|xml/i.test(item.type) || /\.x?html?$/i.test(item.href);
  const chosen = spine.flatMap((id) => {
    const item = manifest.get(id);
    return item && htmlish(item) ? [item] : [];
  });
  const reading = chosen.length ? chosen : [...manifest.values()].filter(htmlish);

  const blocks: string[] = [];
  let chapter = 0;
  for (const item of reading) {
    if (navHref && item.href === navHref) continue;
    chapter += 1;
    note?.(`${filename}: chapter ${chapter} of ${reading.length}`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const xml = zipText(files, item.href);
    if (!xml) continue;
    let markup = "";
    try {
      markup = htmlToMarkup(xml, pageMap.get(item.href));
    } catch {
      continue;
    }
    const label = toc.get(item.href);
    if (label && !/^\s*#{1,3}\s/m.test(markup)) markup = `# ${label}\n\n${markup}`;
    if (markup.trim()) blocks.push(markup);
  }
  const usable = blocks.filter((block) => proseLen(block) >= 40);
  note?.(`Joining ${usable.length || blocks.length} chapters…`);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const body = (usable.length ? usable : blocks).join("\n\n");
  if (proseLen(body) < 40) return { error: "That EPUB has no readable chapter text." };

  const people = cast(opf);
  const languages = [...new Set(dc(opf, "language").map((code) => labelLanguage(code)).filter(Boolean))];
  const raw = front(
    {
      title: dc(opf, "title")[0] || titleFromName(filename),
      creator: people.creators.join("; "),
      contributor: people.editors.join("; "),
      language: languages.join("; "),
      publisher: dc(opf, "publisher")[0] ?? "",
      date: dc(opf, "date")[0] ?? "",
      identifier: dc(opf, "identifier")[0] ?? "",
      ...identifierFields(opf),
      rights: dc(opf, "rights")[0] ?? "",
      description: dc(opf, "description")[0] ?? "",
      subject: dc(opf, "subject").slice(0, 4).join(", "),
      source: filename,
      format: "text/markdown",
      relation: "converted from application/epub+zip",
    },
    body,
  );
  const parsed = parseImport(raw, filename);
  if ("error" in parsed) return parsed;
  const cover = coverOf(files, opf, manifest);
  return cover ? { ...parsed, coverBytes: cover.bytes, coverType: cover.type } : parsed;
}
