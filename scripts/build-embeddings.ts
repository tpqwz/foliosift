import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { gzipSync } from "fflate";
import { chunkWork } from "../src/lib/corpus/markup.ts";
import { WORKS } from "../src/lib/corpus/works.ts";
import type { Section, Work } from "../src/lib/corpus/types.ts";
import { encodeEmbeddings, type ShippedEmbedSection } from "../src/lib/search/shipped-embed.ts";
import { prefixPassage, SEMANTIC_MODELS, textHash, unit, windows, type SemanticChoice } from "../src/lib/search/semantic.ts";

const choice = process.argv[2];
if (choice !== "e5" && choice !== "gemma") {
  console.error("usage: build-embeddings.ts e5|gemma");
  process.exit(1);
}
const model = choice as Exclude<SemanticChoice, "off">;

function volume(meta: Work): Work {
  const data = JSON.parse(readFileSync(`public/samples/${meta.id}.json`, "utf8")) as {
    sections?: { heading?: string; text?: string }[];
  };
  const sections: Section[] = [];
  for (const [index, section] of (data.sections ?? []).entries()) {
    const text = section.text ?? "";
    if (!text.trim()) continue;
    sections.push({
      id: `${meta.id}-${sections.length + 1}`,
      heading: section.heading?.trim() || `Section ${index + 1}`,
      text,
    });
  }
  return chunkWork({ ...meta, sections });
}

const transformers = await import("@huggingface/transformers");
transformers.env.allowLocalModels = false;
transformers.env.cacheDir = ".cache/hf";
const spec = SEMANTIC_MODELS[model];

let embed: (texts: string[]) => Promise<Float32Array[]>;
if (model === "e5") {
  const extractor = await transformers.pipeline("feature-extraction", spec.repo, { dtype: "q8", device: "cpu" });
  embed = async (texts) => {
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    const data = output.data as ArrayLike<number>;
    const [batch, hidden] = output.dims as number[];
    const rows: Float32Array[] = [];
    for (let row = 0; row < batch; row++) rows.push(unit(Array.prototype.slice.call(data, row * hidden, row * hidden + hidden), spec.dims));
    return rows;
  };
} else {
  const config = await transformers.AutoConfig.from_pretrained(spec.repo);
  const gemma = config as { vision_config?: unknown; audio_config?: unknown };
  gemma.vision_config = null;
  gemma.audio_config = null;
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(spec.repo);
  let dtype: "q4" | "fp16" = "q4";
  let session: Awaited<ReturnType<typeof transformers.AutoModel.from_pretrained>>;
  try {
    session = await transformers.AutoModel.from_pretrained(spec.repo, { config, device: "cpu", dtype });
  } catch (error) {
    console.log("q4 unavailable, using fp16", error instanceof Error ? error.message : error);
    dtype = "fp16";
    session = await transformers.AutoModel.from_pretrained(spec.repo, { config, device: "cpu", dtype });
  }
  embed = async (texts) => {
    const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 512 });
    const output = await session(inputs);
    const tensor = output.sentence_embedding ?? output;
    const data = tensor.data as ArrayLike<number>;
    const dims = tensor.dims as number[];
    const rows: Float32Array[] = [];
    if (dims.length === 2) {
      const [batch, hidden] = dims;
      for (let row = 0; row < batch; row++) rows.push(unit(Array.prototype.slice.call(data, row * hidden, row * hidden + hidden), spec.dims));
      return rows;
    }
    const [batch, seq, hidden] = dims;
    for (let row = 0; row < batch; row++) {
      const pooled = new Float32Array(hidden);
      for (let token = 0; token < seq; token++) {
        for (let i = 0; i < hidden; i++) pooled[i] += data[(row * seq + token) * hidden + i];
      }
      for (let i = 0; i < hidden; i++) pooled[i] /= seq || 1;
      rows.push(unit(pooled, spec.dims));
    }
    return rows;
  };
  console.log("gemma dtype", dtype);
}

mkdirSync(`public/embeddings/${model}`, { recursive: true });
for (const meta of WORKS) {
  const file = `public/embeddings/${model}/${meta.id}.bin`;
  if (existsSync(file)) {
    console.log("keep", meta.id);
    continue;
  }
  const work = volume(meta);
  const sections: ShippedEmbedSection[] = [];
  let windowsDone = 0;
  for (const section of work.sections) {
    const pieces = windows(section.text);
    const vectors: Float32Array[] = [];
    for (let index = 0; index < pieces.length; index += 8) {
      const batch = pieces.slice(index, index + 8);
      vectors.push(...(await embed(batch.map((piece) => prefixPassage(model, piece.text)))));
    }
    sections.push({
      id: section.id,
      hash: textHash(section.text),
      windows: pieces.map((piece, index) => ({
        start: piece.start,
        preview: piece.text.slice(0, 280),
        v: vectors[index] ?? new Float32Array(),
      })).filter((piece) => piece.v.length > 0),
    });
    windowsDone += pieces.length;
  }
  const bytes = gzipSync(encodeEmbeddings({ model, sections }));
  writeFileSync(file, bytes);
  console.log(`${meta.id} windows ${windowsDone} file ${bytes.length}`);
}
