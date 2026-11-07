import { pauseClassics, type ClassicProgress } from "@/lib/classics/import-many";
import { requestImportCancel } from "@/lib/import-activity";
import { Modal } from "./modal";

export function ImportStatus({
  line,
  running,
  classics,
  onClose,
}: {
  line: string;
  running: boolean;
  classics: ClassicProgress;
  onClose: () => void;
}) {
  const classicsOn = classics.running;
  const canCancel = running || classicsOn;

  function cancel() {
    if (running) requestImportCancel();
    if (classicsOn) pauseClassics();
  }

  return (
    <Modal labelledBy="import-status-title" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <h2 id="import-status-title" className="font-serif text-2xl">
          Adding
        </h2>
        <p className="mt-3 font-serif text-lg leading-relaxed text-ink">{line}</p>
        {classicsOn ? (
          <p className="mt-3 text-sm text-muted">
            {classics.done} added
            {classics.skipped ? `, ${classics.skipped} already on the shelf` : ""}
            {classics.failed ? `, ${classics.failed} not fetched` : ""}
            {classics.title ? `. ${classics.author ? `${classics.author}, ` : ""}${classics.title}` : ""}
          </p>
        ) : null}
        {canCancel ? (
          <p className="mt-3 text-sm text-muted">
            {classicsOn && !running
              ? "Cancel stops after the volume now being fetched."
              : "Cancel stops at the next step. A volume already stored stays on the shelf."}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line p-4">
        {canCancel ? (
          <button type="button" onClick={cancel} className="h-11 rounded-md border border-line px-4 text-sm text-accent">
            Cancel
          </button>
        ) : null}
        <button type="button" onClick={onClose} className="h-11 px-3 text-sm text-ink">
          Hide
        </button>
      </div>
    </Modal>
  );
}
