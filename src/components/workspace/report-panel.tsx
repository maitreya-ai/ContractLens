"use client";

import { AlertCircle, FileWarning, Loader2, RefreshCw, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge, Button, cn, severityTone } from "@/components/ui";
import { fileName, lineLabel, readNdjson, timeAgo } from "@/lib/client";
import type { ResolvedEvidence, StoredReport } from "@/lib/llm/report";
import type { SignalRow } from "@/lib/repo";
import { SIGNAL_INFO } from "@/lib/signals";

type Open = (fileId: string, startLine?: number, endLine?: number) => void;

const STATUS_LABEL: Record<string, string> = {
  high: "High risk",
  medium: "Medium",
  low: "Low",
  none: "Not present",
  unknown: "Unknown",
};

function EvidenceChips({ evidence, onOpen }: { evidence: ResolvedEvidence[]; onOpen: Open }) {
  if (!evidence.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {evidence.map((e, i) => (
        <button
          key={i}
          title={e.note}
          onClick={() => onOpen(e.fileId, e.startLine, e.endLine)}
          className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-panel-2 px-1.5 py-0.5 font-mono text-[11px] text-muted hover:border-accent hover:text-accent"
        >
          <span className="min-w-0 truncate">{fileName(e.path)}</span>
          <span className="shrink-0 whitespace-nowrap">{lineLabel(e.startLine, e.endLine)}</span>
        </button>
      ))}
    </div>
  );
}

function StaticSignals({ signals, onOpen }: { signals: SignalRow[]; onOpen: Open }) {
  const [includeLibs, setIncludeLibs] = useState(false);
  const shown = signals.filter((s) => includeLibs || s.role !== "library");
  const groups = new Map<string, SignalRow[]>();
  for (const s of shown) groups.set(s.kind, [...(groups.get(s.kind) ?? []), s]);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Detector findings</h3>
          <p className="text-[12.5px] text-muted">Deterministic pattern checks on the source — no AI involved.</p>
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <input type="checkbox" checked={includeLibs} onChange={(e) => setIncludeLibs(e.target.checked)} className="accent-[var(--accent)]" />
          Include library code
        </label>
      </div>
      {groups.size === 0 && <p className="text-[13px] text-muted">Nothing flagged.</p>}
      <div className="grid gap-2 md:grid-cols-2">
        {[...groups.entries()].map(([kind, list]) => (
          <div key={kind} className="rounded-xl border border-border bg-panel p-3">
            <div className="mb-1.5 flex items-center gap-2">
              <span className="flex-1 text-[13.5px] font-medium">{SIGNAL_INFO[kind as keyof typeof SIGNAL_INFO]?.label ?? kind}</span>
              <Badge tone={severityTone(list.some((s) => s.severity === "high") ? "high" : list.some((s) => s.severity === "warn") ? "warn" : "low")}>
                {list.length}
              </Badge>
            </div>
            <ul className="flex flex-col gap-0.5">
              {list.slice(0, 8).map((s) => (
                <li key={s.id}>
                  <button onClick={() => onOpen(s.file_id, s.line, s.line)} className="w-full rounded px-1 py-0.5 text-left text-[12.5px] text-muted hover:bg-panel-2 hover:text-text">
                    {s.detail}{" "}
                    <span className="font-mono text-[11px] opacity-70">
                      {fileName(s.path)}:{s.line}
                    </span>
                  </button>
                </li>
              ))}
              {list.length > 8 && <li className="px-1 text-[12px] text-muted">+{list.length - 8} more</li>}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

export function ReportPanel({
  workspaceId,
  initial,
  signals,
  llm,
  hasSources,
  onOpen,
}: {
  workspaceId: string;
  initial: StoredReport | null;
  signals: SignalRow[];
  llm: boolean;
  hasSources: boolean;
  onOpen: Open;
}) {
  const [stored, setStored] = useState(initial);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  async function generate() {
    setRunning(true);
    setError(null);
    setStatus("Starting…");
    setElapsed(0);
    const started = Date.now();
    timer.current = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/report`, { method: "POST" });
      await readNdjson<{ type: "status"; message: string } | { type: "report"; report: StoredReport } | { type: "error"; message: string }>(res, (e) => {
        if (e.type === "status") setStatus(e.message);
        else if (e.type === "report") setStored(e.report);
        else setError(e.message);
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      if (timer.current) clearInterval(timer.current);
      setRunning(false);
      setStatus(null);
    }
  }

  const report = stored?.report;

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6">
        {!report && !running && (
          <div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-panel p-5">
            <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <ShieldAlert className="size-5" />
            </span>
            <div>
              <h2 className="text-lg font-semibold">Risk report</h2>
              <p className="mt-1 max-w-xl text-[14px] text-muted">
                Claude reviews admin powers, minting, pausing and blacklists, upgradeability, fees, custody of funds and low-level code, and checks
                documentation claims against the code. Every finding links to its evidence.
              </p>
            </div>
            {llm ? (
              <Button variant="primary" onClick={() => void generate()} disabled={!hasSources}>
                <Sparkles className="size-4" /> Generate report
              </Button>
            ) : (
              <div className="flex items-start gap-2 rounded-lg bg-panel-2 px-3 py-2 text-[13px] text-muted">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <span>
                  Add <code className="font-mono">ANTHROPIC_API_KEY</code> to <code className="font-mono">.env.local</code> to generate AI reports. Detector
                  findings below work without a key.
                </span>
              </div>
            )}
          </div>
        )}

        {running && (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-panel p-5 text-[14px]">
            <Loader2 className="size-5 animate-spin text-accent" />
            <div className="flex-1">
              <p>{status}</p>
              <p className="text-[12.5px] text-muted">{elapsed}s elapsed</p>
            </div>
          </div>
        )}
        {error && (
          <p className="flex items-start gap-2 rounded-xl bg-high-soft px-4 py-3 text-[13.5px] text-high">
            <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}

        {report && stored && (
          <>
            <section
              className={cn(
                "rounded-2xl border p-5",
                report.overall_risk === "high" ? "border-high/30 bg-high-soft" : report.overall_risk === "medium" ? "border-medium/30 bg-medium-soft" : "border-border bg-panel",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={severityTone(report.overall_risk)} className="text-[12px]">
                  Overall: {STATUS_LABEL[report.overall_risk] ?? report.overall_risk}
                </Badge>
                <span className="text-[12px] text-muted">
                  {stored.model} · {report.sourceCount} sources · {timeAgo(stored.created_at)}
                </span>
                <span className="flex-1" />
                {llm && (
                  <Button size="sm" variant="ghost" onClick={() => void generate()} loading={running}>
                    <RefreshCw className="size-3.5" /> Regenerate
                  </Button>
                )}
              </div>
              <h2 className="mt-3 text-balance text-xl font-semibold tracking-tight">{report.headline}</h2>
              <p className="mt-2 text-[14.5px] leading-relaxed">{report.summary}</p>
            </section>

            <section className="grid gap-3 md:grid-cols-2">
              {report.categories.map((c) => (
                <article key={c.id} className="flex flex-col rounded-xl border border-border bg-panel p-4">
                  <div className="flex items-center gap-2">
                    <h3 className="flex-1 font-semibold">{c.title}</h3>
                    <Badge tone={severityTone(c.status)}>{STATUS_LABEL[c.status] ?? c.status}</Badge>
                  </div>
                  <p className="mt-1.5 text-[13.5px] text-muted">{c.summary}</p>
                  {c.findings.length > 0 && (
                    <ul className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
                      {c.findings.map((f, i) => (
                        <li key={i}>
                          <div className="flex items-start gap-2">
                            <span
                              className={cn(
                                "mt-1.5 size-2 shrink-0 rounded-full",
                                f.severity === "high" ? "bg-high" : f.severity === "medium" ? "bg-medium" : f.severity === "low" ? "bg-low" : "bg-muted",
                              )}
                            />
                            <div className="min-w-0">
                              <p className="text-[13.5px] font-medium">{f.title}</p>
                              <p className="text-[13px] text-muted">{f.detail}</p>
                              <EvidenceChips evidence={f.evidence} onOpen={onOpen} />
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              ))}
            </section>

            {report.docs_vs_code.length > 0 && (
              <section className="rounded-xl border border-border bg-panel p-4">
                <h3 className="flex items-center gap-2 font-semibold">
                  <FileWarning className="size-4 text-accent" /> Documentation vs code
                </h3>
                <ul className="mt-3 flex flex-col divide-y divide-border">
                  {report.docs_vs_code.map((d, i) => (
                    <li key={i} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0 sm:flex-row sm:gap-4">
                      <div className="sm:w-28 sm:shrink-0">
                        <Badge tone={severityTone(d.verdict)}>{d.verdict}</Badge>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13.5px] font-medium">“{d.claim}”</p>
                        <p className="text-[13px] text-muted">{d.explanation}</p>
                        <EvidenceChips evidence={d.evidence} onOpen={onOpen} />
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {report.limitations.length > 0 && (
              <section className="rounded-xl border border-dashed border-border p-4">
                <h3 className="text-[13px] font-semibold text-muted">What this report could not check</h3>
                <ul className="mt-2 list-disc pl-5 text-[13px] text-muted">
                  {report.limitations.map((l, i) => (
                    <li key={i}>{l}</li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}

        <StaticSignals signals={signals} onOpen={onOpen} />
      </div>
    </div>
  );
}
