"use client";

import { ChevronDown, ChevronRight, ExternalLink, FileCode2, FileText, Plus, ScrollText, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, cn, severityTone } from "@/components/ui";
import { fileName, shortAddress } from "@/lib/client";
import type { SignalRow, SourceDetail, WorkspaceDetail } from "@/lib/repo";
import { SIGNAL_INFO } from "@/lib/signals";
import { chainName, explorerUrl } from "@/lib/sources/chains";

function SourceCard({
  source,
  activeFileId,
  onOpenFile,
  onDelete,
}: {
  source: SourceDetail;
  activeFileId: string | null;
  onOpenFile: (fileId: string) => void;
  onDelete: (id: string) => void;
}) {
  const [showLibs, setShowLibs] = useState(false);
  const own = source.files.filter((f) => f.role !== "library");
  const libs = source.files.filter((f) => f.role === "library");
  const meta = source.meta as { proxyOf?: string | null; proxyType?: string | null; provider?: string };
  const explorer = explorerUrl(source.chain_id, source.address);
  const Icon = source.kind === "document" ? FileText : FileCode2;

  const fileRow = (f: SourceDetail["files"][number]) => (
    <li key={f.id}>
      <button
        onClick={() => onOpenFile(f.id)}
        title={f.path}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] hover:bg-panel-2",
          activeFileId === f.id ? "bg-accent-soft text-accent" : "text-muted hover:text-text",
        )}
      >
        <span className="min-w-0 flex-1 truncate font-mono">{fileName(f.path)}</span>
        {f.role === "target" && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-accent">main</span>}
        <span className="shrink-0 text-[11px] opacity-70">{f.line_count}</span>
      </button>
    </li>
  );

  return (
    <div className="rounded-xl border border-border bg-panel p-2.5">
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-semibold" title={source.title}>
            {source.title}
          </p>
          {source.address ? (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-muted">
              <span>{chainName(source.chain_id)}</span>
              <span>·</span>
              {explorer ? (
                <a href={explorer} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono hover:text-accent">
                  {shortAddress(source.address)} <ExternalLink className="size-3" />
                </a>
              ) : (
                <span className="font-mono">{shortAddress(source.address)}</span>
              )}
            </p>
          ) : (
            <p className="text-[12px] text-muted">{source.kind === "document" ? "Document" : "Pasted source"}</p>
          )}
          {(meta.proxyOf || meta.proxyType) && (
            <div className="mt-1 flex flex-wrap gap-1">
              {meta.proxyType && <Badge tone="low">Proxy · {meta.proxyType}</Badge>}
              {meta.proxyOf && <Badge tone="low">Implementation of {shortAddress(meta.proxyOf)}</Badge>}
            </div>
          )}
        </div>
        <Button variant="ghost" size="sm" className="-mr-1 -mt-1 h-7 px-1.5" aria-label="Remove source" onClick={() => onDelete(source.id)}>
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      <ul className="mt-2 flex flex-col">{own.map(fileRow)}</ul>
      {libs.length > 0 && (
        <>
          <button
            onClick={() => setShowLibs((v) => !v)}
            className="mt-1 flex w-full items-center gap-1 px-2 py-1 text-[12px] text-muted hover:text-text"
          >
            {showLibs ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {libs.length} library file{libs.length === 1 ? "" : "s"}
          </button>
          {showLibs && <ul className="flex flex-col">{libs.map(fileRow)}</ul>}
        </>
      )}
    </div>
  );
}

function SignalList({ signals, onOpen }: { signals: SignalRow[]; onOpen: (s: SignalRow) => void }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = useMemo(() => {
    const own = signals.filter((s) => s.role !== "library" && s.kind !== "access-control");
    const map = new Map<string, SignalRow[]>();
    for (const s of own) map.set(s.kind, [...(map.get(s.kind) ?? []), s]);
    const rank = (list: SignalRow[]) => (list.some((s) => s.severity === "high") ? 0 : list.some((s) => s.severity === "warn") ? 1 : 2);
    return [...map.entries()].sort((a, b) => rank(a[1]) - rank(b[1]));
  }, [signals]);
  const privileged = signals.filter((s) => s.kind === "access-control" && s.role !== "library").length;

  if (!groups.length && !privileged) return <p className="px-1 text-[12.5px] text-muted">No risk signals detected.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {privileged > 0 && (
        <li className="flex items-center justify-between px-1 text-[12.5px] text-muted">
          <span>Privileged functions</span>
          <span className="font-medium text-text">{privileged}</span>
        </li>
      )}
      {groups.map(([kind, list]) => {
        const worst = list.some((s) => s.severity === "high") ? "high" : list.some((s) => s.severity === "warn") ? "warn" : "info";
        const open = expanded === kind;
        return (
          <li key={kind}>
            <button
              onClick={() => setExpanded(open ? null : kind)}
              className="flex w-full items-center gap-2 rounded-md px-1 py-1 text-left text-[12.5px] hover:bg-panel-2"
            >
              <span className={cn("size-2 shrink-0 rounded-full", worst === "high" ? "bg-high" : worst === "warn" ? "bg-medium" : "bg-low")} />
              <span className="flex-1">{SIGNAL_INFO[kind as keyof typeof SIGNAL_INFO]?.label ?? kind}</span>
              <Badge tone={severityTone(worst)}>{list.length}</Badge>
            </button>
            {open && (
              <ul className="mb-1 ml-3 flex flex-col border-l border-border pl-2">
                {list.map((s) => (
                  <li key={s.id}>
                    <button onClick={() => onOpen(s)} className="w-full rounded px-1.5 py-1 text-left text-[12px] text-muted hover:bg-panel-2 hover:text-text">
                      <span className="block">{s.detail}</span>
                      <span className="font-mono text-[11px] opacity-70">
                        {fileName(s.path)}:{s.line}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function Sidebar({
  detail,
  activeFileId,
  onOpenFile,
  onAdd,
  onDeleteSource,
}: {
  detail: WorkspaceDetail;
  activeFileId: string | null;
  onOpenFile: (fileId: string, startLine?: number, endLine?: number) => void;
  onAdd: () => void;
  onDeleteSource: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-3 scroll-thin">
      <div className="flex items-center justify-between">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-muted">Sources</h2>
        <Button size="sm" variant="secondary" onClick={onAdd}>
          <Plus className="size-3.5" /> Add
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {detail.sources.map((s) => (
          <SourceCard key={s.id} source={s} activeFileId={activeFileId} onOpenFile={(id) => onOpenFile(id)} onDelete={onDeleteSource} />
        ))}
        {!detail.sources.length && <p className="px-1 text-[12.5px] text-muted">Nothing indexed yet.</p>}
      </div>
      <div className="flex flex-col gap-2">
        <h2 className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
          <ScrollText className="size-3.5" /> Detector flags
        </h2>
        <SignalList signals={detail.signals} onOpen={(s) => onOpenFile(s.file_id, s.line, s.line)} />
      </div>
      <p className="mt-auto px-1 text-[11.5px] text-muted">
        {detail.stats.files} files · {detail.stats.chunks} chunks indexed
      </p>
    </div>
  );
}
