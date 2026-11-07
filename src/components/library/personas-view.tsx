import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { dublinOf, personaSlug } from "@/lib/corpus/dublin";
import { shelfEntries } from "@/lib/corpus/series";
import type { Work } from "@/lib/corpus/types";
import { listPersonas } from "@/lib/library-db";
import { entityBySlug, personaEntities, type PersonaEntity } from "@/lib/persona/identity";
import { loadPersona, type PublicProfile } from "@/lib/persona/load";
import { samplePersona } from "@/lib/persona/samples";

export function usePersonaEntities(works: Work[]): PersonaEntity[] {
  const [profiles, setProfiles] = useState<PublicProfile[]>([]);
  useEffect(() => {
    void listPersonas().then(setProfiles);
  }, [works]);
  return personaEntities(works, profiles);
}

export function PersonasView({ works }: { works: Work[] }) {
  const people = usePersonaEntities(works);

  return (
    <div>
      <h1 className="font-serif text-3xl text-ink">Personas</h1>
      <p className="mt-1 max-w-xl text-sm text-muted">
        One person, however many names the books use. A book with several authors is listed under each of them.
      </p>
      <ul className="mt-6">
        {people.map((person) => {
          const count = shelfEntries(person.works).length;
          return (
          <li key={person.key} className="border-t border-line py-3">
            <div className="flex items-baseline justify-between gap-3">
              <Link to="/personas/$slug" params={{ slug: personaSlug(person.label) }} className="font-serif text-xl text-ink">
                {person.label}
              </Link>
              <span className="text-sm text-muted">
                {count} {count === 1 ? "work" : "works"}
              </span>
            </div>
            {person.aliases.length ? <p className="text-sm text-muted">Also {person.aliases.slice(0, 4).join(", ")}</p> : null}
          </li>
          );
        })}
      </ul>
    </div>
  );
}

export function PersonaPage({ name, works, aliases = [] }: { name: string; works: Work[]; aliases?: string[] }) {
  const bundled = samplePersona(name);
  const [profile, setProfile] = useState<PublicProfile | null>(bundled);
  const [failed, setFailed] = useState(false);

  const titleKey = works.map((work) => work.title).join("\n");

  useEffect(() => {
    let live = true;
    if (bundled) {
      setProfile(bundled);
      setFailed(false);
      return;
    }
    setProfile(null);
    setFailed(false);
    loadPersona(name, titleKey.split("\n").filter(Boolean))
      .then((next) => {
        if (live) setProfile(next);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [name, titleKey]);

  const localTitles = new Set(works.map((work) => work.title.toLowerCase()));
  const external = (profile?.works ?? [])
    .filter((work) => !localTitles.has(work.title.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.url)) - Number(Boolean(a.url)))
    .slice(0, 8);

  return (
    <div className="max-w-3xl">
      <Link to="/personas" className="text-sm text-accent">
        All personas
      </Link>
      <h1 className="mt-3 font-serif text-4xl text-ink">{name}</h1>
      {aliases.length ? <p className="mt-1 text-sm text-muted">Also known as {aliases.join(", ")}</p> : null}
      {profile?.description ? <p className="mt-2 text-sm text-muted">{profile.description}</p> : null}
      <div className="mt-5 flex flex-col gap-4 sm:flex-row">
        {profile?.image ? (
          <img
            src={profile.image}
            alt=""
            className="h-36 w-28 rounded-md object-cover"
            onError={(event) => {
              event.currentTarget.remove();
            }}
          />
        ) : null}
        <div className="min-w-0">
          {profile?.summary ? (
            <p className="line-clamp-6 font-serif text-lg leading-relaxed text-ink">{profile.summary}</p>
          ) : null}
          {!profile && !failed ? <p className="text-sm text-muted">Looking up a public profile…</p> : null}
          {failed ? <p className="text-sm text-muted">The public profile could not be loaded.</p> : null}
          {profile && !profile.summary && !failed ? (
            <p className="text-sm text-muted">No public profile matched this name. The library bibliography is below.</p>
          ) : null}
        </div>
      </div>
      {profile && (profile.born || profile.died || profile.occupations.length) ? (
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {profile.born ? (
            <div>
              <dt className="text-muted">Born</dt>
              <dd>{profile.born}</dd>
            </div>
          ) : null}
          {profile.died ? (
            <div>
              <dt className="text-muted">Died</dt>
              <dd>{profile.died}</dd>
            </div>
          ) : null}
          {profile.occupations.length ? (
            <div>
              <dt className="text-muted">Occupation</dt>
              <dd>{profile.occupations.join(", ")}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {profile?.wikipedia ? (
        <a href={profile.wikipedia} className="mt-4 inline-flex h-11 items-center text-sm text-accent">
          Wikipedia{profile.qid ? ` · ${profile.qid}` : ""}
        </a>
      ) : null}

      <h2 className="mt-8 font-serif text-2xl">Bibliography</h2>
      <h3 className="mt-4 text-sm font-medium tracking-wide text-muted uppercase">In this library</h3>
      <ul className="mt-2">
        {shelfEntries(works).map((entry) =>
          entry.kind === "series" ? (
            <li key={entry.series.id} className="border-t border-line py-3">
              <Link to="/series/$seriesId" params={{ seriesId: entry.series.id }} className="font-serif text-xl text-ink">
                {entry.series.title}
              </Link>
              <p className="text-sm text-muted">
                {entry.works.length} volumes · {entry.works[0]?.language} · {entry.works[0]?.genre}
              </p>
            </li>
          ) : (
            <li key={entry.work.id} className="border-t border-line py-3">
              <Link to="/library/$workId" params={{ workId: entry.work.id }} className="font-serif text-xl text-ink">
                {entry.work.title}
              </Link>
              <p className="text-sm text-muted">
                {dublinOf(entry.work).date || entry.work.period} · {entry.work.language} · {entry.work.genre}
              </p>
            </li>
          ),
        )}
      </ul>
      {external.length ? (
        <>
          <h3 className="mt-6 text-sm font-medium tracking-wide text-muted uppercase">Also attributed</h3>
          <ul className="mt-2">
            {external.map((work) => (
              <li key={work.title} className="border-t border-line py-3">
                {work.url ? (
                  <a href={work.url} className="font-serif text-lg text-ink">
                    {work.title}
                  </a>
                ) : (
                  <span className="font-serif text-lg text-ink">{work.title}</span>
                )}
                {work.year ? <p className="text-sm text-muted">{work.year}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
