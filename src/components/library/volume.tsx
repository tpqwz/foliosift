import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { dublinOf, DUBLIN_LABELS, listOf, personaSlug } from "@/lib/corpus/dublin";
import { otherEditions } from "@/lib/corpus/editions";
import { preferLabel } from "@/lib/persona/names";
import { ID_FIELDS, ID_LABELS } from "@/lib/corpus/ids";
import { useStoredPlace } from "@/lib/place";
import { useCover } from "@/lib/use-cover";
import { useLibrary } from "@/lib/use-library";
import type { DublinField, Excerpt, Work } from "@/lib/corpus/types";
import { RemoveButton } from "./remove-button";

const FACTS: DublinField[] = [
  "date",
  "language",
  "type",
  "subject",
  "coverage",
  "publisher",
  "source",
  "format",
  "relation",
  "identifier",
];

export function VolumePage({ work, excerpts }: { work: Work; excerpts: Excerpt[] }) {
  const meta = dublinOf(work);
  const savedCover = useCover(work.cover ? "" : work.id);
  const cover = work.cover || savedCover || "";
  const navigate = useNavigate();
  const facts = FACTS.flatMap((field) => {
    const value = meta[field].trim();
    if (!value) return [];
    return [{ field, value }];
  });
  const numbers = ID_FIELDS.flatMap((field) => {
    const value = work.ids?.[field]?.trim();
    if (!value) return [];
    return [{ field, value }];
  });
  const { works } = useLibrary();
  const editions = otherEditions(work, works);
  const resume = useStoredPlace(work.id);
  const [find, setFind] = useState("");

  return (
    <div className="max-w-3xl">
      <Link to="/library" className="text-sm text-accent">
        Library
      </Link>
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start">
        {cover ? (
          <img
            src={cover}
            alt=""
            className="h-52 w-36 shrink-0 rounded-md border border-line object-cover"
            onError={(event) => event.currentTarget.remove()}
          />
        ) : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-4xl text-ink">{meta.title}</h1>
            {work.series ? (
              <Link to="/series/$seriesId" params={{ seriesId: work.series.id }} className="mt-1 block text-sm text-accent">
                {work.series.title} · volume {work.series.volume} of {works.filter((item) => item.series?.id === work.series?.id).length}
              </Link>
            ) : null}
            <Link
              to="/work/$workId"
              params={{ workId: work.id }}
              search={{ q: "", at: "" }}
              className="inline-flex h-11 max-w-full min-w-0 items-center truncate rounded-md bg-accent px-4 text-sm text-bg"
            >
              Read{resume ? ` · ${resume.heading}` : ""}
            </Link>
            <RemoveButton
              id={work.id}
              title={meta.title}
              className="inline-flex h-11 items-center rounded-md border border-line px-4 text-sm text-accent"
              onRemoved={() => void navigate({ to: "/library" })}
            />
          </div>
          <p className="mt-2 text-sm text-muted">
            {listOf(meta.creator).map((name, index) => (
              <span key={name}>
                {index ? "; " : ""}
                <Link to="/personas/$slug" params={{ slug: personaSlug(name) }} className="text-ink">
                  {preferLabel([name])}
                </Link>
              </span>
            ))}
            {listOf(meta.contributor).length ? ` · edited by ${listOf(meta.contributor).join("; ")}` : ""}
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const q = find.trim();
              if (!q) return;
              void navigate({
                to: "/work/$workId",
                params: { workId: work.id },
                search: { q, at: "" },
              });
            }}
          >
            <label className="sr-only" htmlFor="find-volume">
              Find in this volume
            </label>
            <input
              id="find-volume"
              value={find}
              onChange={(event) => setFind(event.target.value)}
              placeholder="Find in this volume"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="search"
              className="h-11 min-w-0 flex-1 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
            />
            <button type="submit" className="h-11 shrink-0 rounded-md border border-line px-3 text-sm">
              Find
            </button>
          </form>
        </div>
      </div>
      {meta.description ? (
        <p className="mt-5 max-w-2xl font-serif text-lg leading-relaxed text-ink">{meta.description}</p>
      ) : null}
      {facts.length ? (
        <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          {facts.map((fact) => (
            <div key={fact.field}>
              <dt className="text-muted">{DUBLIN_LABELS[fact.field]}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {numbers.length ? (
        <>
          <h2 className="mt-8 font-serif text-2xl">Identifiers</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {numbers.map((item) => (
              <div key={item.field}>
                <dt className="text-muted">{ID_LABELS[item.field]}</dt>
                <dd className="break-all">{item.value}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      {meta.rights ? <p className="mt-4 text-sm text-muted">{meta.rights}</p> : null}
      {editions.length ? (
        <>
          <h2 className="mt-8 font-serif text-2xl">Other editions</h2>
          <ul className="mt-2">
            {editions.map((edition) => (
              <li key={edition.id} className="border-t border-line py-3">
                <Link to="/library/$workId" params={{ workId: edition.id }} className="text-ink">
                  {edition.title}
                </Link>
                <p className="text-sm text-muted">
                  {edition.language}
                  {edition.edition ? ` · ${edition.edition}` : ""}
                  {edition.date ? ` · ${edition.date}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {excerpts.length ? (
        <>
          <h2 className="mt-8 font-serif text-2xl">Excerpts</h2>
          <ul className="mt-2">
            {excerpts.map((excerpt) => (
              <li key={excerpt.id} className="border-t border-line py-3">
                <Link
                  to="/work/$workId"
                  params={{ workId: work.id }}
                  search={{ q: "", at: `${excerpt.sectionId}:${excerpt.start}:${excerpt.end}` }}
                  className="text-sm text-accent"
                >
                  {excerpt.heading}
                  {excerpt.page ? ` · p. ${excerpt.page}` : ""}
                </Link>
                <blockquote className="mt-1 font-serif text-lg leading-relaxed text-ink">“{excerpt.text}”</blockquote>
                {excerpt.tags?.length ? <p className="mt-1 text-sm text-muted">{excerpt.tags.join(" · ")}</p> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
