"use client";

import { Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button } from "@/components/ui";
import { lineLabel, type ViewerTarget } from "@/lib/client";

interface FilePayload {
  id: string;
  path: string;
  language: string;
  role: string;
  lineCount: number;
  html: string;
}

const cache = new Map<string, FilePayload>();

export function CodeViewer({ target, onClose }: { target: ViewerTarget; onClose: () => void }) {
  const [loaded, setLoaded] = useState<{ fileId: string; file: FilePayload | null; error: string | null } | null>(() => {
    const cached = cache.get(target.fileId);
    return cached ? { fileId: target.fileId, file: cached, error: null } : null;
  });
  const body = useRef<HTMLDivElement>(null);
  const current = loaded?.fileId === target.fileId ? loaded : null;
  const file = current?.file ?? null;

  useEffect(() => {
    const cached = cache.get(target.fileId);
    if (cached) return;
    let cancelled = false;
    fetch(`/api/files/${target.fileId}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
        return (await r.json()) as FilePayload;
      })
      .then((f) => {
        cache.set(f.id, f);
        if (!cancelled) setLoaded({ fileId: target.fileId, file: f, error: null });
      })
      .catch((e: Error) => {
        if (!cancelled) setLoaded({ fileId: target.fileId, file: null, error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [target.fileId]);

  // Highlight and scroll to the requested lines once the file is rendered.
  useEffect(() => {
    const root = body.current;
    if (!root || !file) return;
    root.querySelectorAll(".line.hl").forEach((el) => el.classList.remove("hl"));
    if (!target.startLine) {
      root.scrollTop = 0;
      return;
    }
    const end = target.endLine ?? target.startLine;
    for (let n = target.startLine; n <= end; n++) root.querySelector(`[data-line="${n}"]`)?.classList.add("hl");
    const first = root.querySelector(`[data-line="${target.startLine}"]`);
    if (first instanceof HTMLElement) {
      root.scrollTo({ top: Math.max(0, first.offsetTop - root.clientHeight / 3), behavior: "smooth" });
    }
  }, [file, target.startLine, target.endLine, target.nonce]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[12.5px]" title={file?.path}>
            {file?.path ?? "Loading…"}
          </p>
        </div>
        {target.startLine && <Badge tone="accent">{lineLabel(target.startLine, target.endLine ?? target.startLine)}</Badge>}
        {file?.role === "library" && <Badge>library</Badge>}
        <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={onClose} aria-label="Close code viewer">
          <X className="size-4" />
        </Button>
      </div>
      <div ref={body} className="code-view relative min-h-0 flex-1 overflow-auto scroll-thin">
        {current?.error && <p className="p-4 text-sm text-high">{current.error}</p>}
        {!current && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted">
            <Loader2 className="size-4 animate-spin" /> Loading source…
          </div>
        )}
        {file && <div dangerouslySetInnerHTML={{ __html: file.html }} />}
      </div>
    </div>
  );
}
