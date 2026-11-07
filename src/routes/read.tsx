import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Shell } from "@/components/library/shell";
import { useLastWork } from "@/lib/place";
import { useHydrated } from "@/lib/prefs";
import { useLibrary } from "@/lib/use-library";

export const Route = createFileRoute("/read")({
  component: ReadPage,
});

function ReadPage() {
  const id = useLastWork();
  const hydrated = useHydrated();
  const { works } = useLibrary();
  const navigate = useNavigate();
  const known = Boolean(id) && works.some((work) => work.id === id);
  const waiting = Boolean(id) && !known && !hydrated;

  useEffect(() => {
    if (!known || !id) return;
    void navigate({ to: "/work/$workId", params: { workId: id }, search: { q: "", at: "" }, replace: true });
  }, [known, id, navigate]);

  return (
    <Shell>
      {waiting ? (
        <p className="font-serif text-xl text-muted">Opening the last volume…</p>
      ) : (
        <div className="mx-auto max-w-lg">
          <h1 className="font-serif text-3xl">Reader</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This stays on the last volume you open. It changes only when you choose another, or when a search result jumps somewhere else.
          </p>
          <Link to="/library" className="mt-4 inline-flex h-11 items-center text-sm text-accent">
            Choose from the library
          </Link>
        </div>
      )}
    </Shell>
  );
}
