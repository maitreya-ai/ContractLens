"use client";

import { AlertCircle, Check, FileUp, Globe, Loader2, Sparkles, SquareCode } from "lucide-react";
import { useRef, useState } from "react";
import { Button, cn } from "@/components/ui";
import { readNdjson } from "@/lib/client";
import { ADDRESS_RE, CHAINS } from "@/lib/sources/chains";

type Tab = "address" | "paste" | "upload";

type Event =
  | { type: "workspace"; id: string }
  | { type: "status"; message: string }
  | { type: "progress"; label: string; done: number; total: number }
  | { type: "done"; workspaceId: string; title: string }
  | { type: "error"; message: string };

export const EXAMPLES = [
  { label: "USDC", chainId: 1, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", note: "proxy" },
  { label: "USDT", chainId: 1, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", note: "" },
  { label: "PEPE", chainId: 1, address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", note: "" },
  { label: "AAVE", chainId: 1, address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", note: "proxy" },
];

export function IngestForm({
  workspaceId,
  onDone,
  showDemo = false,
}: {
  workspaceId?: string;
  onDone: (workspaceId: string) => void;
  showDemo?: boolean;
}) {
  const [tab, setTab] = useState<Tab>("address");
  const [chainId, setChainId] = useState(1);
  const [address, setAddress] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addressValid = ADDRESS_RE.test(address.trim());

  async function run(body: BodyInit, json: boolean) {
    setRunning(true);
    setError(null);
    setLog([]);
    setProgress(null);
    let finished: string | null = null;
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        body,
        headers: json ? { "Content-Type": "application/json" } : undefined,
      });
      await readNdjson<Event>(res, (e) => {
        if (e.type === "status") setLog((l) => [...l, e.message]);
        else if (e.type === "progress") setProgress({ done: e.done, total: e.total });
        else if (e.type === "done") finished = e.workspaceId;
        else if (e.type === "error") setError(e.message);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setRunning(false);
    }
    if (finished) onDone(finished);
  }

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (running) return;
    if (tab === "address") {
      if (!addressValid) return setError("Enter a valid 0x address (40 hex characters).");
      void run(JSON.stringify({ kind: "contract", chainId, address: address.trim(), workspaceId }), true);
    } else if (tab === "paste") {
      void run(JSON.stringify({ kind: "paste", title, code, workspaceId }), true);
    } else {
      if (!file) return setError("Choose a file first.");
      const form = new FormData();
      form.set("file", file);
      if (workspaceId) form.set("workspaceId", workspaceId);
      void run(form, false);
    }
  }

  const tabs: Array<{ id: Tab; label: string; short: string; icon: typeof Globe }> = [
    { id: "address", label: "Contract address", short: "Address", icon: Globe },
    { id: "paste", label: "Paste Solidity", short: "Paste", icon: SquareCode },
    { id: "upload", label: "Upload docs", short: "Docs", icon: FileUp },
  ];

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-xl bg-panel-2 p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => {
              setTab(t.id);
              setError(null);
            }}
            className={cn(
              "flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[13px] font-medium transition-colors",
              tab === t.id ? "bg-panel text-text shadow-sm" : "text-muted hover:text-text",
            )}
          >
            <t.icon className="size-4 shrink-0" />
            <span className="hidden truncate sm:inline">{t.label}</span>
            <span className="truncate sm:hidden">{t.short}</span>
          </button>
        ))}
      </div>

      {tab === "address" && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={chainId}
              onChange={(e) => setChainId(Number(e.target.value))}
              className="h-11 rounded-lg border border-border bg-panel px-3 text-sm sm:w-44"
              aria-label="Chain"
            >
              {CHAINS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x… verified contract address"
              spellCheck={false}
              autoComplete="off"
              className="h-11 w-full min-w-0 rounded-lg border border-border bg-panel px-3 font-mono sm:flex-1 text-[13px] outline-none placeholder:font-sans placeholder:text-muted focus:border-accent"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted">
            <span>Try:</span>
            {EXAMPLES.map((ex) => (
              <button
                key={ex.address}
                type="button"
                onClick={() => {
                  setChainId(ex.chainId);
                  setAddress(ex.address);
                  setError(null);
                }}
                className="rounded-md border border-border bg-panel px-2 py-0.5 font-medium text-text hover:border-accent"
              >
                {ex.label}
                {ex.note && <span className="ml-1 text-muted">· {ex.note}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "paste" && (
        <div className="flex flex-col gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Name (optional)"
            className="h-10 rounded-lg border border-border bg-panel px-3 text-sm outline-none focus:border-accent"
          />
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={"// SPDX-License-Identifier: MIT\npragma solidity ^0.8.24;\n\ncontract Token { … }"}
            spellCheck={false}
            rows={9}
            className="scroll-thin min-h-40 rounded-lg border border-border bg-panel px-3 py-2 font-mono text-[12.5px] leading-relaxed outline-none focus:border-accent"
          />
        </div>
      )}

      {tab === "upload" && (
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) setFile(f);
          }}
          className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-panel px-4 py-6 text-center hover:border-accent"
        >
          <FileUp className="size-6 text-muted" />
          {file ? (
            <span className="text-sm font-medium">{file.name}</span>
          ) : (
            <>
              <span className="text-sm font-medium">Drop a whitepaper or docs file</span>
              <span className="text-[12.5px] text-muted">PDF, Markdown, text or .sol · up to 10 MB</span>
            </>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".pdf,.md,.markdown,.txt,.sol"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" loading={running} className="h-11 px-5">
          {tab === "address" ? "Analyze contract" : tab === "paste" ? "Index code" : "Index document"}
        </Button>
        {showDemo && (
          <Button
            type="button"
            variant="ghost"
            className="h-11"
            disabled={running}
            onClick={() => void run(JSON.stringify({ kind: "demo" }), true)}
          >
            <Sparkles className="size-4" /> Load demo (works offline)
          </Button>
        )}
      </div>

      {(running || log.length > 0 || error) && (
        <div className="rounded-xl border border-border bg-panel p-3 text-[13px]" aria-live="polite">
          <ul className="flex flex-col gap-1.5">
            {log.map((line, i) => {
              const last = i === log.length - 1;
              return (
                <li key={i} className={cn("flex items-start gap-2", last && running ? "text-text" : "text-muted")}>
                  {last && running ? (
                    <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-accent" />
                  ) : (
                    <Check className="mt-0.5 size-3.5 shrink-0 text-ok" />
                  )}
                  <span className="min-w-0 break-words">{line}</span>
                </li>
              );
            })}
            {running && log.length === 0 && (
              <li className="flex items-center gap-2 text-muted">
                <Loader2 className="size-3.5 animate-spin text-accent" /> Starting…
              </li>
            )}
          </ul>
          {running && progress && progress.total > 0 && (
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-accent transition-[width]"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
          )}
          {error && (
            <p className="mt-2 flex items-start gap-2 text-high">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0" /> {error}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
