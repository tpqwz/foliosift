import type { FacetGroups } from "@/lib/search/engine";
import type { FacetKey, FacetSelection } from "@/lib/corpus/types";
import { cn } from "@/lib/cn";

const ORDER: FacetKey[] = ["language", "author", "form", "period", "genre"];

const LABELS: Record<FacetKey, string> = {
  language: "Language",
  author: "Author",
  form: "Form",
  period: "Period",
  genre: "Genre",
};

export function Facets({
  groups,
  selected,
  onToggle,
  onClear,
}: {
  groups: FacetGroups;
  selected: FacetSelection;
  onToggle: (key: FacetKey, name: string) => void;
  onClear: () => void;
}) {
  const active = ORDER.some((key) => selected[key].length > 0);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-medium tracking-wide text-muted uppercase">Narrow</h2>
        {active ? (
          <button type="button" onClick={onClear} className="text-sm text-accent">
            Clear
          </button>
        ) : null}
      </div>
      {ORDER.map((key) => {
        const rows = groups[key];
        if (!rows.length) return null;
        return (
          <fieldset key={key} className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium text-ink">{LABELS[key]}</legend>
            {rows.map((row) => {
              const pressed = selected[key].includes(row.name);
              return (
                <button
                  key={row.name}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => onToggle(key, row.name)}
                  className={cn(
                    "flex h-10 items-center justify-between gap-3 rounded-md px-2 text-left text-sm",
                    pressed ? "bg-accent-soft text-accent" : "text-ink hover:bg-surface",
                  )}
                >
                  <span className="truncate">{row.name}</span>
                  <span className="text-muted">{row.count}</span>
                </button>
              );
            })}
          </fieldset>
        );
      })}
    </div>
  );
}
