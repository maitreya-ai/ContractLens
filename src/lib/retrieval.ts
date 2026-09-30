import { splitIdentifier } from "@/lib/chunking/shared";
import { config } from "@/lib/config";
import { getDb, toVector } from "@/lib/db";
import { embedQuery } from "@/lib/embeddings";
import type { Block, ChunkKind, FileRole, RetrievedChunk } from "@/lib/types";

export type SearchMode = "hybrid" | "vector" | "keyword";

const RRF_K = 60;
/** Third-party library code (OpenZeppelin etc.) is relevant but should not crowd out the project's own code. */
const ROLE_WEIGHT: Record<FileRole, number> = { target: 1, project: 1, document: 1, library: 0.8 };

const STOPWORDS = new Set(
  "a an and are as at be by can could do does for from has have how i if in into is it its me my of on or our so that the their them then there these this to was what when where which who whom why will with would you your".split(" "),
);

/** Turn a question into an OR'ed tsquery: "Can the owner mint?" -> "owner | mint". */
export function buildTsQuery(question: string): string {
  const terms = new Set<string>();
  for (const raw of question.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    for (const word of [raw, ...splitIdentifier(raw).split(" ")]) {
      const w = word.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (w.length >= 2 && !STOPWORDS.has(w)) terms.add(w);
    }
  }
  return [...terms].slice(0, 24).join(" | ");
}

/** Reciprocal Rank Fusion: score = Σ 1 / (k + rank). Robust to incomparable score scales. */
export function rrf(lists: string[][], k = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1)));
  }
  return scores;
}

interface ChunkRow {
  id: string;
  file_id: string;
  path: string;
  role: FileRole;
  source_title: string;
  kind: ChunkKind;
  symbol: string | null;
  container: string | null;
  start_line: number;
  end_line: number;
  content: string;
  blocks: Block[] | string;
  tags: string[] | string;
}

const parseJson = <T,>(v: T | string): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);

export async function fetchChunks(ids: string[]): Promise<Map<string, ChunkRow>> {
  if (!ids.length) return new Map();
  const db = await getDb();
  const params = ids.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await db.query<ChunkRow>(
    `SELECT c.id, c.file_id, f.path, f.role, s.title AS source_title, c.kind, c.symbol, c.container,
            c.start_line, c.end_line, c.content, c.blocks, c.tags
       FROM chunks c JOIN files f ON f.id = c.file_id JOIN sources s ON s.id = f.source_id
      WHERE c.id IN (${params})`,
    ids,
  );
  return new Map(rows.map((r) => [r.id, r]));
}

export function toRetrieved(row: ChunkRow, extra: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    id: row.id,
    fileId: row.file_id,
    path: row.path,
    role: row.role,
    sourceTitle: row.source_title,
    kind: row.kind,
    symbol: row.symbol,
    container: row.container,
    startLine: row.start_line,
    endLine: row.end_line,
    content: row.content,
    blocks: parseJson<Block[]>(row.blocks),
    tags: parseJson<string[]>(row.tags),
    score: 0,
    vectorRank: null,
    vectorSim: null,
    keywordRank: null,
    ...extra,
  };
}

let iterativeScan: Promise<boolean> | null = null;

function supportsIterativeScan(): Promise<boolean> {
  iterativeScan ??= getDb()
    .then((db) => db.query<{ v: string }>("SELECT extversion AS v FROM pg_extension WHERE extname = 'vector'"))
    .then((rows) => {
      const [major, minor] = (rows[0]?.v ?? "0.0").split(".").map(Number);
      return major > 0 || minor >= 8;
    })
    .catch(() => false);
  return iterativeScan;
}

export async function hybridSearch(
  workspaceId: string,
  query: string,
  opts: { k?: number; mode?: SearchMode; pool?: number } = {},
): Promise<RetrievedChunk[]> {
  const k = opts.k ?? config.chatTopK;
  const mode = opts.mode ?? "hybrid";
  const pool = opts.pool ?? config.candidatePool;
  const db = await getDb();

  let vectorHits: Array<{ id: string; sim: number }> = [];
  let keywordHits: Array<{ id: string; rank: number }> = [];

  if (mode !== "keyword") {
    const vec = toVector(await embedQuery(query));
    const iterative = await supportsIterativeScan();
    vectorHits = await db.tx(async (q) => {
      // Filtered HNSW scans can under-fill; iterative scans (pgvector >= 0.8) keep searching.
      await q.query("SET LOCAL hnsw.ef_search = 200");
      if (iterative) await q.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
      return q.query<{ id: string; sim: number }>(
        `SELECT id, 1 - (embedding <=> $2::vector) AS sim
           FROM chunks WHERE workspace_id = $1
          ORDER BY embedding <=> $2::vector LIMIT $3`,
        [workspaceId, vec, pool],
      );
    });
  }
  const tsq = buildTsQuery(query);
  if (mode !== "vector" && tsq) {
    keywordHits = await db.query<{ id: string; rank: number }>(
      `SELECT id, ts_rank_cd(tsv, to_tsquery('english', $2), 32) AS rank
         FROM chunks WHERE workspace_id = $1 AND tsv @@ to_tsquery('english', $2)
        ORDER BY rank DESC LIMIT $3`,
      [workspaceId, tsq, pool],
    );
  }

  const fused = rrf([vectorHits.map((h) => h.id), keywordHits.map((h) => h.id)]);
  const rows = await fetchChunks([...fused.keys()]);
  const vRank = new Map(vectorHits.map((h, i) => [h.id, { rank: i + 1, sim: Number(h.sim) }]));
  const kRank = new Map(keywordHits.map((h, i) => [h.id, i + 1]));

  return [...fused.entries()]
    .map(([id, score]) => {
      const row = rows.get(id);
      if (!row) return null;
      return toRetrieved(row, {
        score: score * ROLE_WEIGHT[row.role],
        vectorRank: vRank.get(id)?.rank ?? null,
        vectorSim: vRank.get(id)?.sim ?? null,
        keywordRank: kRank.get(id) ?? null,
      });
    })
    .filter((c): c is RetrievedChunk => c !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
