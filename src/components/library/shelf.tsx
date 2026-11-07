import { Link } from "@tanstack/react-router";
import { authorSortKey } from "@/lib/corpus/works";
import { listOf, personaSlug } from "@/lib/corpus/dublin";
import { shelfEntries } from "@/lib/corpus/series";
import type { Work } from "@/lib/corpus/types";
import { preferLabel } from "@/lib/persona/names";
import { RemoveButton } from "./remove-button";

function seriesSpan(works: Work[]): string {
  const first = works[0]?.date?.split(/[–-]/)[0]?.trim();
  const last = works[works.length - 1]?.date?.split(/[–-]/).pop()?.trim();
  if (first && last) return `${first}–${last}`;
  return "";
}

function shelfLine(work: Work): string {
  const bits = [work.date, work.language].filter(Boolean);
  if (work.imported) bits.push("imported");
  return bits.join(" · ");
}

export function Shelf({ works }: { works: Work[] }) {
  const grouped = new Map<string, Work[]>();
  for (const work of works) {
    for (const author of listOf(work.author)) {
      const list = grouped.get(author) ?? [];
      list.push(work);
      grouped.set(author, list);
    }
  }
  const authors = [...grouped.keys()].sort(
    (a, b) => authorSortKey(a).localeCompare(authorSortKey(b)) || a.localeCompare(b),
  );

  return (
    <div className="flex flex-col gap-8">
      {works.length === 0 ? (
        <p className="font-serif text-lg text-muted">Nothing on the shelf matches those limits.</p>
      ) : (
      <div className="flex flex-col">
        {authors.map((author) => {
          const list = shelfEntries(grouped.get(author) ?? []);
          return (
          <section key={author} className="border-t border-line py-4">
            <h2 className="text-sm font-medium tracking-wide uppercase">
              <Link to="/personas/$slug" params={{ slug: personaSlug(author) }} className="text-muted">
                {preferLabel([author])}
              </Link>
            </h2>
            <ul className="mt-2">
              {list.map((entry) =>
                entry.kind === "series" ? (
                  <li key={entry.series.id} className="flex items-baseline gap-3 border-b border-line/70 py-3">
                    <Link to="/series/$seriesId" params={{ seriesId: entry.series.id }} className="min-w-0 flex-1">
                      <span className="font-serif text-xl text-ink">{entry.series.title}</span>
                      <span className="mt-1 block text-sm text-muted">
                        {entry.works.length} volumes{seriesSpan(entry.works) ? ` · ${seriesSpan(entry.works)}` : ""} · {entry.works[0]?.language}
                      </span>
                    </Link>
                    <RemoveButton
                      id={entry.works[0]?.id ?? entry.series.id}
                      ids={entry.works.map((work) => work.id)}
                      title={entry.series.title}
                      className="h-11 shrink-0 px-2 text-sm text-accent"
                    />
                  </li>
                ) : (
                  <li key={entry.work.id} className="flex items-start gap-3 border-b border-line/70 py-3">
                    {entry.work.cover ? (
                      <img src={entry.work.cover} alt="" className="mt-1 size-12 shrink-0 rounded-sm object-cover" />
                    ) : null}
                    <Link
                      to="/work/$workId"
                      params={{ workId: entry.work.id }}
                      search={{ q: "", at: "" }}
                      className="min-w-0 flex-1"
                    >
                      <span className="font-serif text-xl text-ink">{entry.work.title}</span>
                      {entry.work.description ? (
                        <span className="mt-1 line-clamp-3 block text-sm leading-relaxed text-muted">{entry.work.description}</span>
                      ) : null}
                      <span className="mt-1 block text-sm text-muted">{shelfLine(entry.work)}</span>
                    </Link>
                    <RemoveButton id={entry.work.id} title={entry.work.title} className="h-11 shrink-0 px-2 text-sm text-accent" />
                  </li>
                ),
              )}
            </ul>
          </section>
          );
        })}
      </div>
      )}
      <p className="max-w-2xl text-sm leading-relaxed text-muted">
        These volumes are already indexed. Add a file or a web address and it is searched the same way. Remove takes a volume off this device.
      </p>
    </div>
  );
}
