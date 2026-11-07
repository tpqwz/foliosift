import { useState } from "react";
import { createPortal } from "react-dom";
import { beginRemoval, endRemoval, usePrefs } from "@/lib/prefs";
import { Modal } from "./modal";

export function RemoveButton({
  id,
  ids,
  title,
  className,
  label = "Remove",
  onRemoved,
}: {
  id: string;
  /** When set, every id leaves together. `id` is only the fallback. */
  ids?: string[];
  title: string;
  className?: string;
  label?: string;
  onRemoved?: () => void;
}) {
  const removeWork = usePrefs((s) => s.removeWork);
  const [ask, setAsk] = useState(false);
  const targets = ids?.length ? ids : [id];
  const many = targets.length > 1;

  return (
    <>
      <button type="button" className={className} onClick={() => setAsk(true)}>
        {label}
      </button>
      {ask && typeof document !== "undefined"
        ? createPortal(
            <Modal labelledBy="remove-volume-title" onClose={() => setAsk(false)}>
              <div className="p-5">
                <h2 id="remove-volume-title" className="font-serif text-2xl">
                  {many ? `Remove these ${targets.length} volumes?` : "Remove this volume?"}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  “{title}” will leave this device. Its text, search index, and saved excerpts are deleted. A large
                  volume can take a moment.
                </p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="h-11 rounded-md bg-accent px-4 text-sm text-bg"
                    onClick={() => {
                      setAsk(false);
                      beginRemoval(title);
                      onRemoved?.();
                      void (async () => {
                        for (const target of targets) await removeWork(target);
                      })().finally(() => {
                        window.setTimeout(endRemoval, 500);
                      });
                    }}
                  >
                    Remove
                  </button>
                  <button type="button" onClick={() => setAsk(false)} className="h-11 px-3 text-sm text-muted">
                    Cancel
                  </button>
                </div>
              </div>
            </Modal>,
            document.body,
          )
        : null}
    </>
  );
}
