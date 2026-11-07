import { createFileRoute } from "@tanstack/react-router";
import { PersonasView } from "@/components/library/personas-view";
import { Shell } from "@/components/library/shell";
import { useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/personas/")({
  component: PersonasIndex,
});

function PersonasIndex() {
  const { works } = useLibrary();
  return (
    <Shell>
      <PersonasView works={works} />
    </Shell>
  );
}
