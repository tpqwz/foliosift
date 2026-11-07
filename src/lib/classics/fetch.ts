import { createServerFn } from "@tanstack/react-start";

export type ClassicText = { text: string } | { error: string };

/** Drop the Gutenberg banner so the prose is what gets indexed. */
export function stripGutenberg(raw: string): string {
  const text = raw.replace(/^\uFEFF/, "");
  const start = text.search(/\*\*\*\s*START OF THE PROJECT GUTENBERG/i);
  const end = text.search(/\*\*\*\s*END OF THE PROJECT GUTENBERG/i);
  const from = start >= 0 ? text.indexOf("\n", start) + 1 : 0;
  const to = end > from ? end : text.length;
  return text.slice(from, to).replace(/\r\n/g, "\n").trim();
}

export const fetchClassicText = createServerFn({ method: "POST" })
  .validator((data: { gutenberg: number }) => {
    const gutenberg = Number(data?.gutenberg);
    if (!Number.isInteger(gutenberg) || gutenberg < 1 || gutenberg > 200000) {
      throw new Error("Unknown Gutenberg text.");
    }
    return { gutenberg };
  })
  .handler(async ({ data }): Promise<ClassicText> => {
    const url = `https://www.gutenberg.org/cache/epub/${data.gutenberg}/pg${data.gutenberg}.txt`;
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(45000) });
      if (!response.ok) return { error: `Gutenberg ${data.gutenberg} did not answer.` };
      const raw = await response.text();
      if (raw.length > 3_000_000) return { error: "That text is too large to take in one pass." };
      const text = stripGutenberg(raw);
      if (text.length < 400 || /<!doctype html/i.test(text.slice(0, 200))) {
        return { error: "That file had no prose." };
      }
      return { text };
    } catch {
      return { error: "The text could not be fetched." };
    }
  });
