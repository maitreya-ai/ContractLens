import Link from "next/link";
import type { ReactNode } from "react";
import { Logo, cn } from "@/components/ui";

export interface Health {
  llm: boolean;
  modelLabel: string;
  database: "pglite" | "postgres";
}

export function StatusPill({ health }: { health: Health }) {
  return (
    <span
      title={health.llm ? "Answers are written by Claude with citations" : "Add ANTHROPIC_API_KEY to .env.local for written answers"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium",
        health.llm ? "border-accent/30 bg-accent-soft text-accent" : "border-border bg-panel-2 text-muted",
      )}
    >
      <span className={cn("size-1.5 rounded-full", health.llm ? "bg-accent" : "bg-muted")} />
      <span className="hidden sm:inline">{health.llm ? health.modelLabel : "Retrieval-only mode"}</span>
      <span className="sm:hidden">{health.llm ? "Claude" : "No key"}</span>
    </span>
  );
}

export function AppHeader({ health, children }: { health: Health; children?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-panel px-4">
      <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
        <Logo className="size-7" />
        <span>ContractLens</span>
      </Link>
      <div className="flex min-w-0 flex-1 items-center gap-2">{children}</div>
      <StatusPill health={health} />
    </header>
  );
}
