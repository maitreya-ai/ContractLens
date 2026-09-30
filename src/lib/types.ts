/** A citable group of source lines. `s`/`e` are 1-based inclusive line numbers. */
export interface Block {
  t: string;
  s: number;
  e: number;
}

export type FileRole = "target" | "project" | "library" | "document";
export type Language = "solidity" | "markdown" | "text";
export type ChunkKind = "outline" | "function" | "declarations" | "section" | "window";

/** A chunk before it is embedded and stored. */
export interface DraftChunk {
  kind: ChunkKind;
  symbol: string | null;
  container: string | null;
  startLine: number;
  endLine: number;
  content: string;
  blocks: Block[];
  /** Text that gets embedded (header + natspec + code). */
  embedText: string;
  /** Text indexed by Postgres full-text search. */
  searchText: string;
  tags: string[];
}

export type Severity = "high" | "warn" | "info";

export interface DraftSignal {
  kind: SignalKind;
  severity: Severity;
  line: number;
  symbol: string | null;
  detail: string;
}

export type SignalKind =
  | "access-control"
  | "mint"
  | "pause"
  | "blacklist"
  | "fee"
  | "upgradeable"
  | "delegatecall"
  | "selfdestruct"
  | "tx-origin"
  | "low-level-call"
  | "assembly"
  | "withdraw"
  | "limits"
  | "prompt-injection";

/** A retrieved chunk with its scores, as returned by hybrid search. */
export interface RetrievedChunk {
  id: string;
  fileId: string;
  path: string;
  role: FileRole;
  sourceTitle: string;
  kind: ChunkKind;
  symbol: string | null;
  container: string | null;
  startLine: number;
  endLine: number;
  content: string;
  blocks: Block[];
  tags: string[];
  score: number;
  vectorRank: number | null;
  vectorSim: number | null;
  keywordRank: number | null;
}

/** Streamed to the browser as NDJSON lines. */
export type ChatEvent =
  | { type: "sources"; sources: SourceRef[] }
  | { type: "status"; message: string }
  | { type: "thinking"; text: string }
  | { type: "block" }
  | { type: "text"; text: string }
  | { type: "cite"; source: number; startLine: number; endLine: number; quote: string }
  | { type: "notice"; message: string }
  | { type: "done"; model: string | null; usage: UsageInfo | null }
  | { type: "error"; message: string };

export interface SourceRef {
  n: number;
  chunkId: string;
  fileId: string;
  path: string;
  symbol: string | null;
  startLine: number;
  endLine: number;
  score: number;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}
