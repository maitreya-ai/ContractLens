"use client";

import { ChevronLeft, FolderTree, MessageSquareText, ScanSearch, ShieldAlert, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { AppHeader, type Health } from "@/components/app-header";
import { IngestForm } from "@/components/ingest-form";
import { Button, cn } from "@/components/ui";
import { ChatPanel } from "@/components/workspace/chat-panel";
import { CodeViewer } from "@/components/workspace/code-viewer";
import { InspectorPanel } from "@/components/workspace/inspector-panel";
import { ReportPanel } from "@/components/workspace/report-panel";
import { Sidebar } from "@/components/workspace/sidebar";
import type { ViewerTarget } from "@/lib/client";
import type { WorkspaceDetail } from "@/lib/repo";

type Tab = "chat" | "report" | "inspect";

const TABS: Array<{ id: Tab; label: string; icon: typeof MessageSquareText }> = [
  { id: "chat", label: "Ask", icon: MessageSquareText },
  { id: "report", label: "Risk report", icon: ShieldAlert },
  { id: "inspect", label: "Retrieval inspector", icon: ScanSearch },
];

export function WorkspaceView({ initial, health }: { initial: WorkspaceDetail; health: Health }) {
  const [detail, setDetail] = useState(initial);
  const [tab, setTab] = useState<Tab>("chat");
  const [viewer, setViewer] = useState<ViewerTarget | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [adding, setAdding] = useState(false);
  const id = detail.workspace.id;

  const open = useCallback((fileId: string, startLine?: number, endLine?: number) => {
    setViewer({ fileId, startLine, endLine, nonce: Date.now() });
    setDrawer(false);
  }, []);

  async function refresh() {
    const res = await fetch(`/api/workspaces/${id}`);
    if (res.ok) setDetail(await res.json());
  }

  async function removeSource(sourceId: string) {
    if (!confirm("Remove this source and its indexed chunks?")) return;
    const res = await fetch(`/api/sources/${sourceId}`, { method: "DELETE" });
    if (res.ok) {
      setViewer(null);
      await refresh();
    }
  }

  const hasSources = detail.sources.length > 0;
  const hasDocs = detail.sources.some((s) => s.kind === "document");
  const sidebar = (
    <Sidebar
      detail={detail}
      activeFileId={viewer?.fileId ?? null}
      onOpenFile={open}
      onAdd={() => {
        setAdding(true);
        setDrawer(false);
      }}
      onDeleteSource={(sid) => void removeSource(sid)}
    />
  );

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader health={health}>
        <Link href="/" className="hidden items-center text-muted hover:text-text sm:flex" aria-label="All workspaces">
          <ChevronLeft className="size-4" />
        </Link>
        <span className="truncate text-sm font-medium" title={detail.workspace.name}>
          {detail.workspace.name}
        </span>
        <Button variant="ghost" size="sm" className="ml-auto lg:hidden" onClick={() => setDrawer(true)}>
          <FolderTree className="size-4" /> Sources
        </Button>
      </AppHeader>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-72 shrink-0 border-r border-border bg-bg lg:block">{sidebar}</aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border bg-panel px-3 scroll-thin">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] font-medium",
                  tab === t.id ? "border-accent text-text" : "border-transparent text-muted hover:text-text",
                )}
              >
                <t.icon className="size-4" /> {t.label}
              </button>
            ))}
          </nav>
          <div className="relative min-h-0 flex-1">
            <div className={cn("absolute inset-0", tab !== "chat" && "hidden")}>
              <ChatPanel workspaceId={id} hasDocs={hasDocs} hasSources={hasSources} onOpen={open} />
            </div>
            <div className={cn("absolute inset-0", tab !== "report" && "hidden")}>
              <ReportPanel workspaceId={id} initial={detail.report} signals={detail.signals} llm={health.llm} hasSources={hasSources} onOpen={open} />
            </div>
            <div className={cn("absolute inset-0", tab !== "inspect" && "hidden")}>
              <InspectorPanel workspaceId={id} onOpen={open} />
            </div>
          </div>
        </main>

        {viewer && (
          <aside className="fixed inset-0 z-30 flex flex-col border-border xl:static xl:z-auto xl:w-[44%] xl:max-w-[760px] xl:border-l">
            <CodeViewer target={viewer} onClose={() => setViewer(null)} />
          </aside>
        )}
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setDrawer(false)} />
          <div className="absolute inset-y-0 left-0 w-[88%] max-w-80 border-r border-border bg-bg shadow-xl">{sidebar}</div>
        </div>
      )}

      {adding && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 pt-[10vh]" role="dialog" aria-modal="true">
          <button className="fixed inset-0 bg-black/40" aria-label="Close" onClick={() => setAdding(false)} />
          <div className="relative w-full max-w-xl rounded-2xl border border-border bg-panel p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Add a source</h2>
                <p className="text-[13px] text-muted">Add related contracts or the project&apos;s whitepaper to this workspace.</p>
              </div>
              <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setAdding(false)} aria-label="Close">
                <X className="size-4" />
              </Button>
            </div>
            <IngestForm
              workspaceId={id}
              onDone={() => {
                setAdding(false);
                void refresh();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
