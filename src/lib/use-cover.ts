import { useEffect, useState } from "react";
import { loadCover } from "./library-db";

/** A cover saved with an import, as an object URL. A shipped cover path is used instead when the work has one. */
export function useCover(workId: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!workId) return;
    let live = true;
    let objectUrl = "";
    void loadCover(workId).then((blob) => {
      if (!blob) return;
      objectUrl = URL.createObjectURL(blob);
      if (live) setUrl(objectUrl);
      else URL.revokeObjectURL(objectUrl);
    });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [workId]);
  return url;
}
