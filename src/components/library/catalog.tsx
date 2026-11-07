import { Link } from "@tanstack/react-router";
import { BookPlus } from "lucide-react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { dublinOf, DUBLIN_LABELS, listOf, personaSlug } from "@/lib/corpus/dublin";
import { shelfEntries } from "@/lib/corpus/series";
import { preferLabel } from "@/lib/persona/names";
import { ID_FIELDS, ID_HINTS, ID_LABELS, ITEM_IDS, SERIAL_IDS, idsOf, storedIds } from "@/lib/corpus/ids";
import { DUBLIN_FIELDS, type DublinCore, type Work, type WorkPatch } from "@/lib/corpus/types";
import { usePrefs } from "@/lib/prefs";
import { ImportDialog } from "./import-dialog";
import { Modal } from "./modal";
import { RemoveButton } from "./remove-button";

const COLUMNS: { field: keyof DublinCore; id: string }[] = [
  { field: "title", id: "title" },
  { field: "creator", id: "creator" },
  { field: "date", id: "date" },
  { field: "language", id: "language" },
  { field: "type", id: "type" },
  { field: "subject", id: "subject" },
  { field: "coverage", id: "coverage" },
  { field: "source", id: "source" },
];

export function Catalog({ works }: { works: Work[] }) {
  const setMeta = usePrefs((s) => s.setMeta);
  const [sorting, setSorting] = useState<SortingState>([{ id: "creator", desc: false }]);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState<Work | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const rows = useMemo(
    () =>
      shelfEntries(works).map((entry) => {
        if (entry.kind === "work") return { work: entry.work, meta: dublinOf(entry.work), volumes: null as Work[] | null, haystack: "" };
        const first = entry.works[0];
        const meta = dublinOf(first);
        return {
          work: first,
          meta: { ...meta, title: entry.series.title, date: `${entry.works.length} volumes` },
          volumes: entry.works,
          haystack: entry.works.map((work) => `${work.title} ${work.edition} ${work.series?.label ?? ""}`).join("\n"),
        };
      }),
    [works],
  );

  const columns = useMemo<ColumnDef<(typeof rows)[number]>[]>(
    () => [
      ...COLUMNS.map((column) => ({
        id: column.id,
        accessorFn: (row: (typeof rows)[number]) => row.meta[column.field],
        header: DUBLIN_LABELS[column.field],
        cell: ({ row }: { row: { original: (typeof rows)[number] } }) => {
          const value = row.original.meta[column.field] || "—";
          if (column.field === "title") {
            if (row.original.volumes?.[0]?.series) {
              const seriesId = row.original.volumes[0].series.id;
              return (
                <Link to="/series/$seriesId" params={{ seriesId }} className="font-serif text-base text-ink">
                  {value}
                </Link>
              );
            }
            return (
              <Link
                to="/library/$workId"
                params={{ workId: row.original.work.id }}
                className="font-serif text-base text-ink"
              >
                {value}
              </Link>
            );
          }
          if (column.field === "creator" && row.original.meta.creator) {
            const names = listOf(row.original.meta.creator);
            return (
              <span>
                {names.map((name, index) => (
                  <span key={name}>
                    {index ? "; " : ""}
                    <Link to="/personas/$slug" params={{ slug: personaSlug(name) }} className="text-ink">
                      {preferLabel([name])}
                    </Link>
                  </span>
                ))}
              </span>
            );
          }
          return <span className="text-muted">{value}</span>;
        },
      })),
      {
        id: "edit",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex justify-end">
            {row.original.volumes ? null : (
              <button type="button" onClick={() => setEditing(row.original.work)} className="h-10 px-2 text-sm text-accent">
                Edit
              </button>
            )}
            <RemoveButton
              id={row.original.work.id}
              ids={row.original.volumes?.map((work) => work.id)}
              title={row.original.meta.title || row.original.work.title}
              className="h-10 px-2 text-sm text-accent"
            />
          </div>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting, globalFilter: filter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setFilter,
    globalFilterFn: (row, _columnId, value: string) => {
      const needle = value.toLowerCase();
      return (
        DUBLIN_FIELDS.some((field) => row.original.meta[field].toLowerCase().includes(needle)) ||
        row.original.haystack.toLowerCase().includes(needle) ||
        ID_FIELDS.some((field) => (row.original.work.ids?.[field] ?? "").toLowerCase().includes(needle))
      );
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row) => row.volumes?.[0]?.series?.id ?? row.work.id,
  });

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-serif text-3xl text-ink">Library</h1>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex h-11 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm text-ink"
            >
              <BookPlus className="size-4" aria-hidden="true" />
              Add text
            </button>
          </div>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Each volume is a Dublin Core record. Sort any column, filter the catalog, and edit the metadata.
            Serial and item numbers stay on the record, not in this table.
          </p>
        </div>
        <label className="flex w-full flex-col gap-1 text-sm text-muted sm:w-72">
          Filter records
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Creator, subject, ISBN…"
            className="h-11 rounded-md border border-line bg-surface px-3 text-base text-ink outline-none"
          />
        </label>
      </div>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-line">
                {group.headers.map((header) => {
                  const sorted = header.column.getIsSorted();
                  return (
                    <th key={header.id} className="px-2 py-2 text-sm font-medium text-muted" aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : "none"}>
                      {header.column.getCanSort() ? (
                        <button type="button" onClick={header.column.getToggleSortingHandler()} className="h-10 text-left">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === "asc" ? " ↑" : sorted === "desc" ? " ↓" : ""}
                        </button>
                      ) : null}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-line align-top">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-2 py-3 text-sm">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {table.getRowModel().rows.length === 0 ? (
          <p className="py-8 font-serif text-lg text-muted">No record matches that filter.</p>
        ) : null}
      </div>
      {editing ? (
        <MetaEditor
          work={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            setMeta(editing.id, patch);
            setEditing(null);
          }}
        />
      ) : null}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

function MetaEditor({
  work,
  onClose,
  onSave,
}: {
  work: Work;
  onClose: () => void;
  onSave: (patch: WorkPatch) => void;
}) {
  const [meta, setMeta] = useState<DublinCore>(() => dublinOf(work));
  const [ids, setIds] = useState(() => idsOf(work));
  const [extended, setExtended] = useState(() => ID_FIELDS.some((key) => Boolean(work.ids?.[key]?.trim())));
  return (
    <Modal labelledBy="meta-title" onClose={onClose}>
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault();
          onSave({ ...meta, ids: storedIds(ids) ?? {} });
        }}
      >
        <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
          <h2 id="meta-title" className="font-serif text-2xl">
            Dublin Core
          </h2>
          <p className="mt-1 text-sm text-muted">Fifteen elements. A semicolon separates several creators, contributors, or languages.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {DUBLIN_FIELDS.map((field) => (
              <label key={field} className={field === "description" || field === "rights" ? "sm:col-span-2" : ""}>
                <span className="text-sm text-muted">{DUBLIN_LABELS[field]}</span>
                {field === "description" || field === "rights" ? (
                  <textarea
                    value={meta[field]}
                    rows={3}
                    onChange={(event) => setMeta({ ...meta, [field]: event.target.value })}
                    className="mt-1 w-full rounded-md border border-line bg-surface p-2 text-base text-ink outline-none"
                  />
                ) : (
                  <input
                    value={meta[field]}
                    onChange={(event) => setMeta({ ...meta, [field]: event.target.value })}
                    className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-2 text-base text-ink outline-none"
                  />
                )}
              </label>
            ))}
          </div>
          <button
            type="button"
            aria-expanded={extended}
            onClick={() => setExtended((open) => !open)}
            className="mt-4 h-11 text-sm text-accent"
          >
            {extended ? "Hide serial and item numbers" : "Serial and item numbers"}
          </button>
          {extended ? (
            <div className="mt-2 flex flex-col gap-4">
              <IdGroup
                title="Serial numbers"
                fields={SERIAL_IDS}
                ids={ids}
                onChange={(key, value) => setIds({ ...ids, [key]: value })}
              />
              <IdGroup
                title="Item numbers"
                fields={ITEM_IDS}
                ids={ids}
                onChange={(key, value) => setIds({ ...ids, [key]: value })}
              />
            </div>
          ) : null}
        </div>
        <div className="flex gap-2 border-t border-line p-4">
          <button type="submit" className="h-11 rounded-md bg-accent px-4 text-sm text-bg">
            Save record
          </button>
          <button type="button" onClick={onClose} className="h-11 px-3 text-sm text-muted">
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

function IdGroup({
  title,
  fields,
  ids,
  onChange,
}: {
  title: string;
  fields: readonly (keyof typeof ID_LABELS)[];
  ids: Record<keyof typeof ID_LABELS, string>;
  onChange: (key: keyof typeof ID_LABELS, value: string) => void;
}) {
  return (
    <fieldset>
      <legend className="text-sm font-medium tracking-wide text-muted uppercase">{title}</legend>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field}>
            <span className="text-sm text-muted">{ID_LABELS[field]}</span>
            <input
              value={ids[field]}
              placeholder={ID_HINTS[field]}
              onChange={(event) => onChange(field, event.target.value)}
              className="mt-1 h-11 w-full rounded-md border border-line bg-surface px-2 text-base text-ink outline-none"
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
}

