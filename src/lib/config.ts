import path from "node:path";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";

function effort(value: string | undefined, fallback: Effort): Effort {
  const allowed: Effort[] = ["low", "medium", "high", "xhigh", "max"];
  return allowed.includes(value as Effort) ? (value as Effort) : fallback;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  /** Claude model used for answers and reports. */
  model: process.env.ANTHROPIC_MODEL || "claude-opus-5-5",
  chatEffort: effort(process.env.CHAT_EFFORT, "medium"),
  reportEffort: effort(process.env.REPORT_EFFORT, "high"),
  /** Server-side refusal fallback ("default" routes by refusal category). Set to "off" to disable. */
  fallbacks: process.env.ANTHROPIC_FALLBACKS === "off" ? null : ("default" as const),

  /** Postgres connection string. When unset, an embedded PGlite database is used. */
  databaseUrl: process.env.DATABASE_URL || "",
  /** PGlite data directory; "memory" keeps everything in RAM (tests, evals). */
  pgliteDir: process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite"),

  /** Local embedding model (must output 384 dimensions to match the schema). */
  embeddingModel: process.env.EMBEDDING_MODEL || "Xenova/bge-small-en-v1.5",
  embeddingDims: 384,
  modelCacheDir: process.env.MODEL_CACHE_DIR || path.join(process.cwd(), ".data", "models"),

  etherscanApiKey: process.env.ETHERSCAN_API_KEY || "",

  /** Retrieval sizes. */
  chatTopK: int(process.env.CHAT_TOP_K, 8),
  candidatePool: 40,

  /** Input limits. */
  maxPasteBytes: 1_000_000,
  maxUploadBytes: 10_000_000,
} as const;

export function hasAnthropicKey(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export function modelLabel(model: string = config.model): string {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(model);
  if (!m) return model;
  const name = m[1][0].toUpperCase() + m[1].slice(1);
  return `Claude ${name} ${m[3] ? `${m[2]}.${m[3]}` : m[2]}`;
}
