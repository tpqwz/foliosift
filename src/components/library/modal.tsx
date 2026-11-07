import { useEffect, useRef, type ReactNode } from "react";
import { useBackLayer } from "@/lib/back";

export function Modal({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useBackLayer(true, () => closeRef.current());

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="sheet">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-ink/40" onClick={() => closeRef.current()} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="sheet-panel relative rounded-md border border-line bg-bg text-ink"
      >
        {children}
      </div>
    </div>
  );
}
