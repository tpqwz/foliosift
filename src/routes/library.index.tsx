import { createFileRoute } from "@tanstack/react-router";
import { Catalog } from "@/components/library/catalog";
import { Shell } from "@/components/library/shell";
import { useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/library/")({
  component: LibraryPage,
});

function LibraryPage() {
  const { works } = useLibrary();
  return (
    <Shell>
      <Catalog works={works} />
    </Shell>
  );
}
