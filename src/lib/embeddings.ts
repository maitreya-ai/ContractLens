import { config } from "@/lib/config";

/**
 * Local sentence embeddings via transformers.js (ONNX, runs on CPU, no API key).
 * BGE models expect an instruction prefix on queries but not on passages.
 */
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
const MAX_CHARS = 1600; // ~512 tokens for code-heavy text; the tokenizer truncates the rest.
const BATCH = 16;

type Extractor = (
  texts: string[],
  options: { pooling: "cls" | "mean"; normalize: boolean },
) => Promise<{ tolist(): number[][] }>;

const globalForModel = globalThis as unknown as { __contractlensExtractor?: Promise<Extractor> };

function loadExtractor(): Promise<Extractor> {
  if (!globalForModel.__contractlensExtractor) {
    globalForModel.__contractlensExtractor = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = config.modelCacheDir;
      const extractor = await pipeline("feature-extraction", config.embeddingModel, { dtype: "q8" });
      return extractor as unknown as Extractor;
    })().catch((err) => {
      globalForModel.__contractlensExtractor = undefined;
      throw err;
    });
  }
  return globalForModel.__contractlensExtractor;
}

async function run(texts: string[]): Promise<number[][]> {
  const extractor = await loadExtractor();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH).map((t) => t.slice(0, MAX_CHARS));
    const result = await extractor(batch, { pooling: "cls", normalize: true });
    out.push(...result.tolist());
  }
  return out;
}

export async function embedPassages(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const out: number[][] = [];
  const step = BATCH * 4;
  for (let i = 0; i < texts.length; i += step) {
    out.push(...(await run(texts.slice(i, i + step))));
    onProgress?.(Math.min(i + step, texts.length), texts.length);
  }
  return out;
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await run([QUERY_PREFIX + text]);
  return v;
}

/** Load the model ahead of time (first run downloads ~34 MB). */
export async function warmEmbeddings(): Promise<void> {
  await loadExtractor();
}
