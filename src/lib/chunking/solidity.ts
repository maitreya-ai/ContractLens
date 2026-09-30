import { SIGNAL_INFO } from "@/lib/analysis/detectors";
import { identifierWords, linesToBlocks, splitIdentifier, windows } from "@/lib/chunking/shared";
import type { ParsedSolidity, SolContract, SolMember } from "@/lib/chunking/solidity-parser";
import type { Block, DraftChunk, DraftSignal } from "@/lib/types";

const MAX_FUNCTION_LINES = 80;
const WINDOW = 60;
const OVERLAP = 12;
const MAX_DECL_LINES = 45;
const MAX_OUTLINE_ITEMS = 70;

interface Ctx {
  path: string;
  lines: string[];
  signals: DraftSignal[];
}

function tagsFor(ctx: Ctx, start: number, end: number): string[] {
  return [...new Set(ctx.signals.filter((s) => s.line >= start && s.line <= end).map((s) => s.kind))];
}

function slice(ctx: Ctx, start: number, end: number): string[] {
  return ctx.lines.slice(start - 1, end);
}

function makeChunk(
  ctx: Ctx,
  base: Pick<DraftChunk, "kind" | "symbol" | "container" | "startLine" | "endLine">,
  blocks: Block[],
  header: string[],
): DraftChunk {
  const content = blocks.map((b) => b.t).join("\n");
  // An outline spans the whole contract; tagging it with every signal would make it match everything.
  const tags = base.kind === "outline" ? [] : tagsFor(ctx, base.startLine, base.endLine);
  const behaviour = tags.map((t) => SIGNAL_INFO[t as keyof typeof SIGNAL_INFO]?.phrase).filter(Boolean);
  const embedText = [
    ...header,
    behaviour.length ? `Behaviour: ${behaviour.join("; ")}.` : "",
    content,
  ]
    .filter(Boolean)
    .join("\n");
  const searchText = [
    ctx.path,
    base.container ?? "",
    base.symbol ?? "",
    base.symbol ? splitIdentifier(base.symbol) : "",
    header.join(" "),
    behaviour.join(" "),
    content,
    identifierWords(content),
  ].join("\n");
  return { ...base, blocks, content, embedText, searchText, tags };
}

function describeContainer(c: SolContract, path: string): string {
  return `${c.kind} ${c.name}${c.bases.length ? ` (inherits ${c.bases.join(", ")})` : ""} in ${path}`;
}

function memberLabel(m: SolMember): string {
  switch (m.kind) {
    case "state":
      return `state variable ${m.name}`;
    case "constructor":
    case "fallback":
    case "receive":
      return m.kind;
    default:
      return `${m.kind} ${m.name}`;
  }
}

function outlineChunks(ctx: Ctx, c: SolContract): DraftChunk[] {
  const items = c.members.filter((m) => m.kind !== "using");
  const head: Block = { t: `${c.kind} ${c.name}${c.bases.length ? ` is ${c.bases.join(", ")}` : ""}`, s: c.sigLine, e: c.sigLine };
  const parts: SolMember[][] = [];
  for (let i = 0; i < Math.max(items.length, 1); i += MAX_OUTLINE_ITEMS) parts.push(items.slice(i, i + MAX_OUTLINE_ITEMS));

  return parts.map((part, idx) => {
    const blocks: Block[] = [head, ...part.map((m) => ({ t: `    ${m.signature}`, s: m.sigLine, e: m.sigLine }))];
    const functions = part.filter((m) => m.kind === "function");
    const header = [
      `Outline of ${describeContainer(c, ctx.path)}${parts.length > 1 ? ` (part ${idx + 1}/${parts.length})` : ""}.`,
      c.natspec ? `Docs: ${c.natspec}` : "",
      functions.length
        ? `Functions: ${functions.map((f) => `${f.name}${f.modifiers.length ? ` [${f.modifiers.join(" ")}]` : ""}`).join(", ")}.`
        : "",
    ].filter(Boolean);
    return makeChunk(
      ctx,
      { kind: "outline", symbol: c.name, container: c.name, startLine: c.sigLine, endLine: c.endLine },
      blocks,
      header,
    );
  });
}

function memberChunks(ctx: Ctx, m: SolMember, c: SolContract | null): DraftChunk[] {
  const where = c ? describeContainer(c, ctx.path) : `file-level code in ${ctx.path}`;
  const symbol = c ? `${c.name}.${m.name}` : m.name;
  const header = [
    `${memberLabel(m)} of ${where}.`,
    `Signature: ${m.signature}`,
    m.modifiers.length ? `Modifiers: ${m.modifiers.join(", ")}` : "",
    m.natspec ? `Docs: ${m.natspec}` : "",
  ].filter(Boolean);
  const total = m.endLine - m.startLine + 1;
  const ranges: Array<[number, number]> =
    total > MAX_FUNCTION_LINES ? windows(m.startLine, m.endLine, WINDOW, OVERLAP) : [[m.startLine, m.endLine]];
  return ranges.map(([s, e]) =>
    makeChunk(
      ctx,
      { kind: "function", symbol, container: c?.name ?? null, startLine: s, endLine: e },
      linesToBlocks(slice(ctx, s, e), s),
      header,
    ),
  );
}

function declarationChunks(ctx: Ctx, decls: SolMember[], c: SolContract): DraftChunk[] {
  const groups: SolMember[][] = [];
  for (const m of decls) {
    const g = groups[groups.length - 1];
    if (g && m.endLine - g[0].startLine < MAX_DECL_LINES && m.startLine - g[g.length - 1].endLine <= 3) g.push(m);
    else groups.push([m]);
  }
  return groups.map((g) => {
    const s = g[0].startLine;
    const e = g[g.length - 1].endLine;
    const header = [
      `Declarations in ${describeContainer(c, ctx.path)}: ${g.map(memberLabel).join(", ")}.`,
    ];
    return makeChunk(
      ctx,
      { kind: "declarations", symbol: `${c.name} declarations`, container: c.name, startLine: s, endLine: e },
      linesToBlocks(slice(ctx, s, e), s),
      header,
    );
  });
}

function windowChunks(ctx: Ctx): DraftChunk[] {
  const last = ctx.lines.length;
  return windows(1, last, WINDOW, OVERLAP).map(([s, e]) =>
    makeChunk(
      ctx,
      { kind: "window", symbol: null, container: null, startLine: s, endLine: e },
      linesToBlocks(slice(ctx, s, e), s),
      [`Lines ${s}-${e} of ${ctx.path}.`],
    ),
  );
}

export function chunkSolidity(path: string, parsed: ParsedSolidity, signals: DraftSignal[]): DraftChunk[] {
  const ctx: Ctx = { path, lines: parsed.lines, signals };
  const chunks: DraftChunk[] = [];

  for (const c of parsed.contracts) {
    chunks.push(...outlineChunks(ctx, c));
    const withBody = c.members.filter((m) => m.hasBody);
    const decls = c.members.filter((m) => !m.hasBody && m.kind !== "using");
    for (const m of withBody) chunks.push(...memberChunks(ctx, m, c));
    if (decls.length) chunks.push(...declarationChunks(ctx, decls, c));
  }
  for (const m of parsed.freeMembers) {
    if (m.hasBody) chunks.push(...memberChunks(ctx, m, null));
  }

  if (chunks.length === 0 && parsed.lines.some((l) => l.trim())) return windowChunks(ctx);
  return chunks.filter((c) => c.blocks.length > 0);
}
