import { createFileRoute } from "@tanstack/react-router";
import { ExcerptsView } from "@/components/library/excerpts-view";
import { Shell } from "@/components/library/shell";
import { useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/excerpts")({
  component: ExcerptsPage,
});

function ExcerptsPage() {
  const { works } = useLibrary();
  return (
    <Shell>
      <ExcerptsView works={works} />
    </Shell>
  );
}
