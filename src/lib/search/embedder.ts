import { isSample, loadSampleText, WORKS } from "../corpus/works";
import { loadStoredWork } from "../library-db";
import { usePrefs } from "../prefs";
import type { Work } from "../corpus/types";
import type { WorkHit } from "./engine";
import {
  dot,
  foldSemantic,
  prefixPassage,
  prefixQuery,
  SEMANTIC_MODELS,
  textHash,
  unit,
  windows,
  type SemanticChoice,
  type SemanticPassage,
} from "./semantic";
import { clearSection, putRows, rowsFor, sectionStamp, setSectionStamp, type VectorRow } from "./vectors";
import { decodeEmbeddings, type ShippedEmbed } from "./shipped-embed";

export type SemanticStatus = {
  phase: "off" | "loading" | "embedding" | "ready" | "error";
  model: SemanticChoice;
  done: number;
  note: string;
};

type Runner = (texts: string[]) => Promise<Float32Array[]>;

const listeners = new Set<() => void>();
let status: SemanticStatus = { phase: "off", model: "off", done: 0, note: "" };
let generation = 0;
let runner: { choice: Exclude<SemanticChoice, "off">; run: Runner; note: string } | null = null;
let task: Promise<void> | null = null;
let again = false;
const adopted = new Set<string>();

function emit(next: SemanticStatus) {
  status = next;
  listeners.forEach((listener) => listener());
}

export function semanticSnapshot(): SemanticStatus {
  return status;
}

export function subscribeSemantic(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function shelfIds(): string[] {
  const removed = new Set(usePrefs.getState().removed);
  return [...WORKS.map((work) => work.id), ...usePrefs.getState().imports.map((work) => work.id)].filter((id, index, all) => all.indexOf(id) === index && !removed.has(id));
}

async function loadVolume(id: string): Promise<Work | null> {
  if (isSample(id)) return loadSampleText(id);
  return loadStoredWork(id);
}

function rowsOf(output: { data?: ArrayLike<number>; dims?: number[] }, dims: number): Float32Array[] {
  const data = output.data;
  const shape = output.dims;
  if (!data || !shape) throw new Error("The model returned an unexpected vector.");
  if (shape.length === 2) {
    const [batch, hidden] = shape;
    const out: Float32Array[] = [];
    for (let row = 0; row < batch; row++) {
      out.push(unit(Array.prototype.slice.call(data, row * hidden, row * hidden + hidden), dims));
    }
    return out;
  }
  if (shape.length === 3) {
    const [batch, seq, hidden] = shape;
    const out: Float32Array[] = [];
    for (let row = 0; row < batch; row++) {
      const pooled = new Float32Array(hidden);
      for (let token = 0; token < seq; token++) {
        for (let i = 0; i < hidden; i++) pooled[i] += data[(row * seq + token) * hidden + i];
      }
      for (let i = 0; i < hidden; i++) pooled[i] /= seq || 1;
      out.push(unit(pooled, dims));
    }
    return out;
  }
  throw new Error("The model returned an unexpected vector.");
}

async function webgpuReady(): Promise<boolean> {
  const gpu = typeof navigator === "undefined" ? undefined : (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

function quantUnsupported(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /GatherBlockQuantized|Could not find an implementation|ERROR_CODE: 9/.test(message);
}

async function loadRunner(choice: Exclude<SemanticChoice, "off">): Promise<{ run: Runner; note: string }> {
  if (runner?.choice === choice) return runner;
  const transformers = await import("@huggingface/transformers");
  const { env } = transformers;
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) env.backends.onnx.wasm.numThreads = 1;
  const spec = SEMANTIC_MODELS[choice];
  if (choice === "e5") {
    const extractor = await transformers.pipeline("feature-extraction", spec.repo, { dtype: "q8", device: "wasm" });
    const run: Runner = async (texts) => {
      const output = await extractor(texts, { pooling: "mean", normalize: true });
      return rowsOf(output, spec.dims);
    };
    runner = { choice, run, note: "" };
    return runner;
  }
  const read = async (dtype: "q4" | "fp16", device: "webgpu" | "wasm"): Promise<Runner> => {
    const config = await transformers.AutoConfig.from_pretrained(spec.repo);
    const gemma = config as { vision_config?: unknown; audio_config?: unknown };
    gemma.vision_config = null;
    gemma.audio_config = null;
    const tokenizer = await transformers.AutoTokenizer.from_pretrained(spec.repo);
    const model = await transformers.AutoModel.from_pretrained(spec.repo, { config, device, dtype });
    return async (texts) => {
      const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 512 });
      const output = await model(inputs);
      const tensor = output.sentence_embedding ?? output;
      return rowsOf(tensor, spec.dims);
    };
  };
  const gpu = await webgpuReady();
  if (!gpu) {
    const run = await read("fp16", "wasm");
    runner = {
      choice,
      run,
      note: "This browser cannot run the 4-bit file, so EmbeddingGemma 2 is using the half-precision weights, about 540 MB.",
    };
    return runner;
  }
  try {
    const run = await read("q4", "webgpu");
    runner = { choice, run, note: "" };
    return runner;
  } catch (error) {
    if (!quantUnsupported(error)) throw error;
    const run = await read("fp16", "webgpu");
    runner = {
      choice,
      run,
      note: "The 4-bit file does not run here, so EmbeddingGemma 2 is using the half-precision weights, about 540 MB.",
    };
    return runner;
  }
}

async function writeEmbeddingPack(work: Work, pack: ShippedEmbed): Promise<void> {
  if (pack.model !== "e5") return;
  for (const section of pack.sections) {
    const live = work.sections.find((item) => item.id === section.id);
    if (!live || textHash(live.text) !== section.hash) continue;
    if ((await sectionStamp("e5", work.id, section.id)) === section.hash) continue;
    await clearSection("e5", work.id, section.id);
    const rows: VectorRow[] = section.windows.map((piece) => ({
      key: `e5\n${work.id}\n${section.id}\n${piece.start}`,
      model: "e5",
      workId: work.id,
      sectionId: section.id,
      heading: live.heading,
      start: piece.start,
      preview: piece.preview,
      v: piece.v,
    }));
    if (rows.length) await putRows(rows);
    await setSectionStamp("e5", work.id, section.id, section.hash);
  }
}

/** Put a backed-up E5 pack back so this book is not embedded again. */
export async function restoreWorkEmbeddings(work: Work, bytes: Uint8Array): Promise<void> {
  try {
    const { gunzipSync } = await import("fflate");
    await writeEmbeddingPack(work, decodeEmbeddings(gunzipSync(bytes)));
  } catch {
    /* a damaged pack is embedded again */
  }
}

async function adoptShipped(choice: Exclude<SemanticChoice, "off">, work: Work): Promise<void> {
  if (!isSample(work.id) || typeof fetch === "undefined") return;
  const key = `${choice}:${work.id}`;
  if (adopted.has(key)) return;
  try {
    const response = await fetch(`/embeddings/${choice}/${work.id}.bin`);
    if (!response.ok) {
      adopted.add(key);
      return;
    }
    const { gunzipSync } = await import("fflate");
    const pack = decodeEmbeddings(gunzipSync(new Uint8Array(await response.arrayBuffer())));
    if (pack.model !== choice) return;
    for (const section of pack.sections) {
      if ((await sectionStamp(choice, work.id, section.id)) === section.hash) continue;
      await clearSection(choice, work.id, section.id);
      const rows: VectorRow[] = section.windows.map((piece) => ({
        key: `${choice}\n${work.id}\n${section.id}\n${piece.start}`,
        model: choice,
        workId: work.id,
        sectionId: section.id,
        heading: work.sections.find((item) => item.id === section.id)?.heading ?? "",
        start: piece.start,
        preview: piece.preview,
        v: piece.v,
      }));
      if (rows.length) await putRows(rows);
      await setSectionStamp(choice, work.id, section.id, section.hash);
    }
    adopted.add(key);
  } catch {
    /* a missing or unreadable pack is computed on this device */
  }
}

/** Meaning vectors for a collection, fetched when a search asks rather than at startup. */
export async function ensureSeriesEmbeddings(
  choice: SemanticChoice,
  works: Work[],
  onProgress?: (line: string) => void,
): Promise<void> {
  if (choice === "off") return;
  const series = works.filter((work) => work.series);
  for (const work of series) {
    if (adopted.has(`${choice}:${work.id}`)) continue;
    onProgress?.(`Reading meanings, ${work.series?.title} ${work.series?.volume} of ${work.series?.of}…`);
    const full = await loadVolume(work.id);
    if (full) await adoptShipped(choice, full);
  }
}

async function embedShelf(choice: Exclude<SemanticChoice, "off">, embed: Runner, gen: number): Promise<{ done: number; skipped: number }> {
  let done = 0;
  let skipped = 0;
  for (const id of shelfIds()) {
    if (gen !== generation) return { done, skipped };
    const listed = usePrefs.getState().imports.find((work) => work.id === id) ?? WORKS.find((work) => work.id === id);
    if (listed?.series) continue;
    if (listed && listed.sections.length > 4000) {
      skipped += 1;
      continue;
    }
    const work = await loadVolume(id);
    if (!work?.sections.length) continue;
    await adoptShipped(choice, work);
    for (const section of work.sections) {
      if (gen !== generation) return { done, skipped };
      const hash = textHash(section.text);
      if ((await sectionStamp(choice, work.id, section.id)) === hash) continue;
      const pieces = windows(section.text);
      await clearSection(choice, work.id, section.id);
      for (let index = 0; index < pieces.length; index += 4) {
        if (gen !== generation) return { done, skipped };
        const batch = pieces.slice(index, index + 4);
        const vectors = await embed(batch.map((piece) => prefixPassage(choice, piece.text)));
        const rows: VectorRow[] = batch.map((piece, offset) => ({
          key: `${choice}\n${work.id}\n${section.id}\n${piece.start}`,
          model: choice,
          workId: work.id,
          sectionId: section.id,
          heading: section.heading,
          start: piece.start,
          preview: piece.text.slice(0, 280),
          v: vectors[offset] ?? new Float32Array(),
        }));
        await putRows(rows.filter((row) => row.v.length > 0));
        done += rows.length;
        emit({ phase: "embedding", model: choice, done, note: `Embedding ${work.title}… ${done} new passages` });
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      await setSectionStamp(choice, work.id, section.id, hash);
    }
  }
  return { done, skipped };
}

export function useSemantic(choice: SemanticChoice): Promise<void> {
  if (choice !== "off" && runner?.choice === choice && (status.phase === "loading" || status.phase === "embedding") && task) {
    again = true;
    return task;
  }
  const gen = ++generation;
  again = false;
  if (choice === "off") {
    runner = null;
    task = null;
    emit({ phase: "off", model: "off", done: 0, note: "" });
    return Promise.resolve();
  }
  const run = (async () => {
    emit({ phase: "loading", model: choice, done: 0, note: `Downloading ${SEMANTIC_MODELS[choice].label} onto this device…` });
    try {
      const loaded = await loadRunner(choice);
      if (gen !== generation) return;
      if (loaded.note) emit({ phase: "embedding", model: choice, done: 0, note: loaded.note });
      const counted = await embedShelf(choice, loaded.run, gen);
      if (gen !== generation) return;
      const skipNote =
        counted.skipped === 0
          ? ""
          : counted.skipped === 1
            ? "One very long book is left out of concept search. Word search still covers it."
            : `${counted.skipped} very long books are left out of concept search. Word search still covers them.`;
      const base = loaded.note || (counted.done ? `${counted.done} passages embedded on this device.` : "Semantic search is ready.");
      emit({
        phase: "ready",
        model: choice,
        done: counted.done,
        note: skipNote ? `${base} ${skipNote}` : base,
      });
    } catch (error) {
      if (gen !== generation) return;
      runner = null;
      const message = error instanceof Error ? error.message : "The model could not be downloaded.";
      emit({ phase: "error", model: choice, done: 0, note: message });
    }
  })().finally(() => {
    if (gen !== generation) return;
    task = null;
    if (again) {
      again = false;
      void useSemantic(choice);
    }
  });
  task = run;
  return run;
}

export async function blendSemantic(
  choice: SemanticChoice,
  query: string,
  lexical: WorkHit[],
  works: Work[],
  allowNew: boolean,
): Promise<{ hits: WorkHit[]; note: string | null }> {
  const text = query.trim();
  if (choice === "off" || !text) return { hits: lexical, note: null };
  if (!runner || runner.choice !== choice) {
    return { hits: lexical, note: "Semantic search is still downloading. Word matches are shown." };
  }
  try {
    const stored = await rowsFor(choice);
    if (!stored.length) return { hits: lexical, note: "Passages are still being embedded. Word matches are shown." };
    const [vector] = await runner.run([prefixQuery(choice, text)]);
    if (!vector?.length) return { hits: lexical, note: null };
    const byId = new Map(works.map((work) => [work.id, work]));
    const ranked: SemanticPassage[] = [];
    for (const row of stored) {
      const work = byId.get(row.workId);
      if (!work || !row.v?.length) continue;
      ranked.push({
        work,
        sectionId: row.sectionId,
        heading: row.heading,
        start: row.start,
        preview: row.preview,
        score: dot(vector, row.v),
      });
    }
    ranked.sort((left, right) => right.score - left.score);
    const hits = foldSemantic(lexical, ranked, allowNew);
    const added = hits.filter((hit) => !lexical.some((item) => item.work.id === hit.work.id)).length;
    if (added) {
      return {
        hits,
        note: added === 1 ? "One work was added by meaning. The wording may differ." : `${added} works were added by meaning. The wording may differ.`,
      };
    }
    if (hits.some((hit) => hit.sections.some((section) => section.meaning))) {
      return { hits, note: "Some passages were added by meaning. Word matches stay first." };
    }
    return { hits, note: null };
  } catch {
    return { hits: lexical, note: null };
  }
}
