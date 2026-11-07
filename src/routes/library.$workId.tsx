import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { VolumePage } from "@/components/library/volume";
import { Shell } from "@/components/library/shell";
import { usePrefs } from "@/lib/prefs";
import { useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/library/$workId")({
  component: VolumeRoute,
});

function VolumeRoute() {
  const { workId } = Route.useParams();
  const { works } = useLibrary();
  const excerpts = usePrefs((s) => s.excerpts);
  const saved = useMemo(() => excerpts.filter((excerpt) => excerpt.workId === workId), [excerpts, workId]);
  const work = works.find((item) => item.id === workId);

  return (
    <Shell>
      {work ? (
        <VolumePage work={work} excerpts={saved} />
      ) : (
        <div>
          <p className="font-serif text-xl text-muted">That volume is not on the shelf.</p>
          <Link to="/library" className="mt-3 inline-flex h-11 items-center text-sm text-accent">
            Library
          </Link>
        </div>
      )}
    </Shell>
  );
}