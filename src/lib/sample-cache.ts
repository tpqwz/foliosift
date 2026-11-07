import { WORKS } from "./corpus/works";
import { loadCover, readMeta, readPersona, saveCover, writeMeta, writePersona } from "./library-db";
import type { PublicProfile } from "./persona/load";
import { SAMPLE_PERSONAS } from "./persona/samples";

/** Bump when the shipped sample pages change, so the cache is filled again. */
const STAMP = "samples-cached-1";

/**
 * The sample personas and library entries ship with the app.
 * Store them the same way a finished fetch would, and leave a stamp so they are not fetched again.
 */
export async function seedSampleCache(): Promise<void> {
  if ((await readMeta<{ stamp?: string }>("sample-cache"))?.stamp === STAMP) return;

  for (const profile of Object.values(SAMPLE_PERSONAS) as PublicProfile[]) {
    const stored = await readPersona(profile.name);
    if (!stored?.summary) await writePersona(profile.name, profile);
  }

  const covers: string[] = [];
  for (const work of WORKS) {
    if (!work.cover || (await loadCover(work.id))) {
      if (work.cover) covers.push(work.id);
      continue;
    }
    try {
      const response = await fetch(work.cover);
      if (!response.ok) continue;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength) continue;
      const type = (response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
      await saveCover(work.id, bytes, type);
      covers.push(work.id);
    } catch {
      /* the cover path on the entry still shows the picture */
    }
  }

  await writeMeta("sample-cache", {
    stamp: STAMP,
    personas: Object.values(SAMPLE_PERSONAS).map((profile) => profile.name),
    works: WORKS.map((work) => work.id),
    covers,
  });
}
