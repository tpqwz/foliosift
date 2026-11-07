export type ShareResult = "shared" | "cancelled" | "unavailable";

export async function sharePassage(data: { title: string; text: string }): Promise<ShareResult> {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return "unavailable";
  const attempts: ShareData[] = [{ text: data.text }];
  let cancelled = false;
  for (const attempt of attempts) {
    if (typeof navigator.canShare === "function" && !navigator.canShare(attempt)) continue;
    try {
      await navigator.share(attempt);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        cancelled = true;
        break;
      }
    }
  }
  return cancelled ? "cancelled" : "unavailable";
}
