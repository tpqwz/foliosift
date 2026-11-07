import { useState } from "react";
import { sharePassage } from "@/lib/share-passage";
import { Modal } from "./modal";

export function ShareDialog({
  title,
  citation,
  onClose,
}: {
  title: string;
  citation: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const mail = `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(citation)}`;

  async function send() {
    const result = await sharePassage({ title, text: citation });
    if (result === "shared" || result === "cancelled") onClose();
    else setNote("This browser has no share sheet. Email or copy the passage.");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(citation);
      setNote("Copied");
    } catch {
      setNote("Select the passage and copy it.");
    }
  }

  return (
    <Modal labelledBy="share-title" onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-5">
        <h2 id="share-title" className="font-serif text-2xl">
          Share
        </h2>
        <p className="mt-3 font-serif text-lg leading-relaxed text-ink">{citation}</p>
        {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2 border-t border-line p-4">
        {typeof navigator.share === "function" ? (
          <button type="button" onClick={() => void send()} className="h-11 rounded-md bg-accent px-4 text-sm text-bg">
            Share
          </button>
        ) : null}
        <a href={mail} className="inline-flex h-11 items-center rounded-md border border-line bg-surface px-4 text-sm text-ink">
          Email
        </a>
        <button type="button" onClick={() => void copy()} className="h-11 px-3 text-sm text-ink">
          Copy
        </button>
        <button type="button" onClick={onClose} className="h-11 px-3 text-sm text-muted">
          Close
        </button>
      </div>
    </Modal>
  );
}
