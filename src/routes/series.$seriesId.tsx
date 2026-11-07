import { createFileRoute, Link } from "@tanstack/react-router";
import { Shell } from "@/components/library/shell";
import { useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/series/$seriesId")({
  component: SeriesPage,
});

function SeriesPage() {
  const { seriesId } = Route.useParams();
  const { works } = useLibrary();
  const volumes = works
    .filter((work) => work.series?.id === seriesId)
    .sort((a, b) => (a.series?.volume ?? 0) - (b.series?.volume ?? 0));
  const series = volumes[0]?.series;

  return (
    <Shell>
      {series ? (
        <div className="max-w-3xl">
          <Link to="/" search={{ q: "", w: "", lang: "", author: "", form: "", period: "", genre: "" }} className="text-sm text-accent">
            Shelf
          </Link>
          <h1 className="mt-3 font-serif text-4xl text-ink">{series.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {volumes[0]?.author} · {volumes.length} {volumes.length === 1 ? "volume" : "volumes"}
          </p>
          <ul className="mt-6">
            {volumes.map((work) => (
              <li key={work.id} className="flex items-baseline justify-between gap-3 border-t border-line py-3">
                <Link to="/work/$workId" params={{ workId: work.id }} search={{ q: "", at: "" }} className="min-w-0 flex-1">
                  <span className="font-serif text-xl text-ink">Volume {work.series?.volume}</span>
                  <span className="mt-1 block text-sm text-muted">{work.series?.label || work.edition}</span>
                </Link>
                <Link to="/library/$workId" params={{ workId: work.id }} className="shrink-0 text-sm text-accent">
                  Record
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div>
          <p className="font-serif text-xl text-muted">That collection is not on the shelf.</p>
          <Link to="/" search={{ q: "", w: "", lang: "", author: "", form: "", period: "", genre: "" }} className="mt-3 inline-flex h-11 items-center text-sm text-accent">
            Shelf
          </Link>
        </div>
      )}
    </Shell>
  );
}
