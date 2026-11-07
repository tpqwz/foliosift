/** Token named by a result link (`m-section-12`), before this volume is open. */
export function aimedToken(at?: string): { sectionId: string; token: number } | null {
  if (!at?.startsWith("m-")) return null;
  const body = at.slice(2);
  const cut = body.lastIndexOf("-");
  if (cut <= 0 || !/^\d+$/.test(body.slice(cut + 1))) return null;
  return { sectionId: body.slice(0, cut), token: Number(body.slice(cut + 1)) };
}

/** Section a result or excerpt link points at. Empty when the link does not name one. */
export function aimedSection(at?: string): string {
  const meaning = at ? /^mean:(.*):(\d+):(\d+)$/.exec(at) : null;
  if (meaning?.[1]) return meaning[1];
  const aimed = aimedToken(at);
  if (aimed) return aimed.sectionId;
  if (!at) return "";
  const excerpt = /^(.*):(\d+):(\d+)$/.exec(at);
  if (excerpt?.[1]) return excerpt[1];
  if (at.startsWith("m-")) return "";
  return at;
}
