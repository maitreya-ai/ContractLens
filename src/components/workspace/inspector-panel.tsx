"use client";

import { Search } from "lucide-react";
import { useState } from "react";
import { Badge, Button, cn } from "@/components/ui";
import { fileName, lineLabel } from "@/lib/client";
import type { RetrievedChunk } from "@/lib/types";

type Result = Omit<RetrievedChunk, "blocks">;
type Mode = "hybrid" | "vector" | "keyword";

export function InspectorPanel({ workspaceId, onOpen }: { workspaceId: string; onOpen: (fileId: string, s?: number, e?: number) => void }) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("hybrid");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<{ tsquery: string; ms: number; results: Result[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(e?: React.FormEvent, nextMode: Mode = mode) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: nextMode, k: 12 }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4 py-6">
        <div>
          <h2 className="text-lg font-semibold">Retrieval inspector</h2>
          <p className="mt-1 text-[13.5px] text-muted">
            See exactly what the RAG pipeline retrieves for a question: vector rank and cosine similarity, full-text rank, and the fused
            Reciprocal Rank Fusion score. Switch modes to compare.
          </p>
        </div>
        <form onSubmit={(e) => void run(e)} className="flex flex-col gap-2 sm:flex-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. who can pause transfers?"
            className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-panel px-3 text-sm outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <div className="flex rounded-lg bg-panel-2 p-0.5">
              {(["hybrid", "vector", "keyword"] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    if (query.trim()) void run(undefined, m);
                  }}
                  className={cn("rounded-md px-2.5 text-[12.5px] font-medium capitalize", mode === m ? "bg-panel text-text shadow-sm" : "text-muted")}
                >
                  {m}
                </button>
              ))}
            </div>
            <Button type="submit" variant="primary" loading={loading} className="h-10">
              <Search className="size-4" /> Search
            </Button>
          </div>
        </form>
        {error && <p className="text-[13px] text-high">{error}</p>}
        {data && (
          <>
            <p className="text-[12.5px] text-muted">
              {data.results.length} results in {data.ms} ms · full-text query: <code className="font-mono">{data.tsquery || "∅"}</code>
            </p>
            <ol className="flex flex-col gap-2">
              {data.results.map((r, i) => (
                <li key={r.id}>
                  <button
                    onClick={() => onOpen(r.fileId, r.startLine, r.endLine)}
                    className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-panel p-3 text-left hover:border-accent/50"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px] text-muted">#{i + 1}</span>
                      <span className="font-mono text-[12.5px]">{fileName(r.path)}</span>
                      <span className="font-mono text-[11.5px] text-muted">{lineLabel(r.startLine, r.endLine)}</span>
                      {r.symbol && <span className="truncate text-[12.5px] text-muted">· {r.symbol}</span>}
                      <span className="flex-1" />
                      <Badge tone="accent">RRF {r.score.toFixed(4)}</Badge>
                      <Badge tone={r.vectorRank ? "low" : "neutral"}>
                        vec {r.vectorRank ? `#${r.vectorRank} · ${r.vectorSim?.toFixed(3)}` : "—"}
                      </Badge>
                      <Badge tone={r.keywordRank ? "medium" : "neutral"}>fts {r.keywordRank ? `#${r.keywordRank}` : "—"}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge>{r.kind}</Badge>
                      {r.role === "library" && <Badge>library</Badge>}
                      {r.tags.map((t) => (
                        <Badge key={t} tone="medium">
                          {t}
                        </Badge>
                      ))}
                    </div>
                    <pre className="line-clamp-4 overflow-hidden whitespace-pre-wrap font-mono text-[11.5px] leading-snug text-muted">{r.content}</pre>
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </div>
  );
}
