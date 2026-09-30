"use client";

import { ArrowRight, Boxes, FileSearch, Layers, ShieldAlert, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IngestForm } from "@/components/ingest-form";
import { Button } from "@/components/ui";
import { timeAgo } from "@/lib/client";
import type { WorkspaceSummary } from "@/lib/repo";

const STEPS = [
  {
    icon: Boxes,
    title: "Fetch verified source",
    body: "Pulls every source file from Sourcify (or Etherscan) and follows proxies to the implementation that actually runs.",
  },
  {
    icon: Layers,
    title: "Solidity-aware chunking",
    body: "Splits code into functions, modifiers and declarations with exact line ranges, plus detectors for admin powers.",
  },
  {
    icon: FileSearch,
    title: "Hybrid retrieval",
    body: "pgvector similarity and Postgres full-text search, fused with Reciprocal Rank Fusion. Measured by an eval.",
  },
  {
    icon: ShieldAlert,
    title: "Cited answers",
    body: "Claude answers from the retrieved code only. Every claim links to the exact lines, so you can verify it.",
  },
];

export function HomeClient({ workspaces: initial }: { workspaces: WorkspaceSummary[] }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState(initial);

  async function remove(id: string) {
    if (!confirm("Delete this workspace and everything indexed in it?")) return;
    const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
    if (res.ok) setWorkspaces((w) => w.filter((x) => x.id !== id));
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 pb-16 pt-10 sm:pt-16">
      <section className="flex flex-col items-center gap-4 text-center">
        <span className="rounded-full border border-border bg-panel px-3 py-1 text-[12px] font-medium text-muted">
          Smart contract due diligence · RAG with line-level citations
        </span>
        <h1 className="max-w-3xl text-balance text-3xl font-semibold tracking-tight sm:text-5xl">
          Ask any smart contract what it can do to your money.
        </h1>
        <p className="max-w-2xl text-balance text-[15px] text-muted sm:text-base">
          Paste a verified contract address, add the whitepaper, and ask in plain English. Can the owner mint? Freeze wallets? Change
          fees? Upgrade the logic? Answers cite the exact lines of code, and flag where the docs and the code disagree.
        </p>
      </section>

      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-border bg-panel p-4 shadow-sm sm:p-6">
        <IngestForm showDemo onDone={(id) => router.push(`/w/${id}`)} />
      </section>

      {workspaces.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted">Your workspaces</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {workspaces.map((w) => (
              <li key={w.id} className="group flex items-center gap-2 rounded-xl border border-border bg-panel p-3 hover:border-accent/50">
                <Link href={`/w/${w.id}`} className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{w.name}</span>
                  <span className="text-[12.5px] text-muted">
                    {w.sources} source{w.sources === 1 ? "" : "s"} · {w.chunks} chunks · {timeAgo(w.created_at)}
                  </span>
                </Link>
                <Button variant="ghost" size="sm" aria-label={`Delete ${w.name}`} onClick={() => void remove(w.id)}>
                  <Trash2 className="size-4" />
                </Button>
                <Link href={`/w/${w.id}`} aria-hidden tabIndex={-1} className="text-muted group-hover:text-accent">
                  <ArrowRight className="size-4" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <div key={s.title} className="rounded-xl border border-border bg-panel p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <s.icon className="size-4" />
              </span>
              <span className="text-[12px] font-medium text-muted">Step {i + 1}</span>
            </div>
            <h3 className="mb-1 text-sm font-semibold">{s.title}</h3>
            <p className="text-[13px] leading-relaxed text-muted">{s.body}</p>
          </div>
        ))}
      </section>

      <p className="text-center text-[12.5px] text-muted">
        ContractLens speeds up due diligence. It is not a security audit, and source code cannot show current on-chain state.
      </p>
    </main>
  );
}
