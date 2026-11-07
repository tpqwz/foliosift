import { personaSlug } from "./corpus/dublin";
import { WORKS } from "./corpus/works";
import { SAMPLE_PERSONAS } from "./persona/samples";
import { usePrefs } from "./prefs";
import { bootLibrary } from "./use-library";

const CACHE = "folio-v3";

async function cacheMissing(urls: string[]) {
  const cache = await caches.open(CACHE);
  const missing: string[] = [];
  for (const url of urls) {
    if (!(await cache.match(url))) missing.push(url);
  }
  await Promise.all(missing.map((url) => fetch(url).catch(() => undefined)));
}

async function warmDocuments() {
  const removed = new Set(usePrefs.getState().removed);
  const shelf = WORKS.filter((work) => !removed.has(work.id));
  const authors = [...new Set(shelf.map((work) => work.author))];
  const front = shelf.filter((work) => !work.series);
  const seriesIds = [...new Set(shelf.flatMap((work) => (work.series ? [work.series.id] : [])))];
  const paths = [
    "/",
    "/library",
    "/personas",
    "/excerpts",
    ...seriesIds.map((id) => `/series/${id}`),
    ...front.map((work) => `/work/${work.id}`),
    ...front.map((work) => `/library/${work.id}`),
    ...front.map((work) => `/samples/${work.id}.json`),
    ...shelf.flatMap((work) => (work.cover ? [work.cover] : [])),
    ...authors.map((author) => `/personas/${personaSlug(author)}`),
    ...Object.values(SAMPLE_PERSONAS).flatMap((profile) => (profile.image ? [profile.image] : [])),
  ];
  await cacheMissing(paths);
  const urls = performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => name.startsWith(location.origin));
  await cacheMissing(urls);
}

export async function startOffline(preload: () => Promise<void>): Promise<void> {
  await bootLibrary();
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
      });
    }
    await preload();
    await warmDocuments();
    await preload();
    const urls = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => name.startsWith(location.origin));
    await cacheMissing(urls);
  } catch {
    /* install still works online without a worker */
  }
}
