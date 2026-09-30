import { randomUUID } from "node:crypto";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { config } from "@/lib/config";
import { getDb } from "@/lib/db";
import { describeApiError, fallbackOptions, getClient } from "@/lib/llm/client";
import { REPORT_SYSTEM_PROMPT } from "@/lib/llm/prompts";
import { fetchChunks, hybridSearch, toRetrieved } from "@/lib/retrieval";
import type { RetrievedChunk } from "@/lib/types";

export const REPORT_CATEGORIES = [
  { id: "admin", title: "Admin & ownership", query: "owner admin role access control onlyOwner onlyRole transferOwnership renounceOwnership privileged" },
  { id: "supply", title: "Minting & supply", query: "mint new tokens increase total supply minter role supply cap" },
  { id: "freeze", title: "Pausing & blacklists", query: "pause unpause freeze blacklist blocklist block account transfers" },
  { id: "upgrade", title: "Upgradeability", query: "upgrade implementation proxy upgradeTo admin delegatecall beacon" },
  { id: "fees", title: "Fees & trading limits", query: "transfer fee tax set fee max wallet max transaction trading enabled" },
  { id: "funds", title: "Custody of funds", query: "withdraw rescue sweep recover transfer funds owner ETH tokens balance" },
  { id: "external", title: "External calls & low-level code", query: "external call low level call delegatecall selfdestruct assembly reentrancy" },
  { id: "other", title: "Other notable risks", query: "tx.origin oracle price timelock signature permit nonce" },
] as const;

type CategoryId = (typeof REPORT_CATEGORIES)[number]["id"];
const CATEGORY_IDS = REPORT_CATEGORIES.map((c) => c.id) as [CategoryId, ...CategoryId[]];

const Evidence = z.object({
  source: z.string().describe('Source label, e.g. "S3"'),
  start_line: z.number().int(),
  end_line: z.number().int(),
  note: z.string().describe("What these lines show"),
});

const ReportSchema = z.object({
  overall_risk: z.enum(["high", "medium", "low", "unknown"]),
  headline: z.string(),
  summary: z.string(),
  categories: z.array(
    z.object({
      id: z.enum(CATEGORY_IDS),
      status: z.enum(["high", "medium", "low", "none", "unknown"]),
      summary: z.string(),
      findings: z.array(
        z.object({
          title: z.string(),
          severity: z.enum(["high", "medium", "low", "info"]),
          detail: z.string(),
          evidence: z.array(Evidence),
        }),
      ),
    }),
  ),
  docs_vs_code: z.array(
    z.object({
      claim: z.string(),
      verdict: z.enum(["consistent", "contradicted", "unverifiable"]),
      explanation: z.string(),
      evidence: z.array(Evidence),
    }),
  ),
  limitations: z.array(z.string()),
});

type RawReport = z.infer<typeof ReportSchema>;
type RawEvidence = z.infer<typeof Evidence>;

export interface ResolvedEvidence {
  source: string;
  fileId: string;
  path: string;
  startLine: number;
  endLine: number;
  note: string;
}

type WithResolved<T> = Omit<T, "evidence"> & { evidence: ResolvedEvidence[] };

export interface RiskReport {
  overall_risk: RawReport["overall_risk"];
  headline: string;
  summary: string;
  categories: Array<
    Omit<RawReport["categories"][number], "findings"> & {
      title: string;
      findings: Array<WithResolved<RawReport["categories"][number]["findings"][number]>>;
    }
  >;
  docs_vs_code: Array<WithResolved<RawReport["docs_vs_code"][number]>>;
  limitations: string[];
  sourceCount: number;
}

export interface StoredReport {
  id: string;
  model: string;
  created_at: string;
  report: RiskReport;
}

const MAX_SOURCES = 45;
const MAX_CHARS = 110_000;

/** Pick the evidence the model gets to see: category searches + every flagged chunk + outlines + docs. */
async function gatherEvidence(workspaceId: string): Promise<RetrievedChunk[]> {
  const db = await getDb();
  const picked = new Map<string, RetrievedChunk>();
  const add = (c: RetrievedChunk) => {
    if (!picked.has(c.id)) picked.set(c.id, c);
  };

  const flagged = await db.query<{ id: string }>(
    `SELECT DISTINCT c.id, CASE s.severity WHEN 'high' THEN 0 ELSE 1 END AS sev
       FROM signals s
       JOIN files f ON f.id = s.file_id
       JOIN chunks c ON c.file_id = s.file_id AND s.line BETWEEN c.start_line AND c.end_line AND c.kind <> 'outline'
      WHERE s.workspace_id = $1 AND s.severity IN ('high', 'warn') AND f.role IN ('target', 'project', 'document')
      ORDER BY sev LIMIT 30`,
    [workspaceId],
  );
  const structural = await db.query<{ id: string }>(
    `SELECT c.id FROM chunks c JOIN files f ON f.id = c.file_id
      WHERE c.workspace_id = $1 AND ((c.kind = 'outline' AND f.role = 'target') OR f.role = 'document')
      ORDER BY f.role, c.start_line LIMIT 30`,
    [workspaceId],
  );
  const rows = await fetchChunks([...structural, ...flagged].map((r) => r.id));
  for (const r of structural) {
    const row = rows.get(r.id);
    if (row) add(toRetrieved(row));
  }
  for (const r of flagged) {
    const row = rows.get(r.id);
    if (row) add(toRetrieved(row));
  }
  for (const cat of REPORT_CATEGORIES) {
    for (const c of await hybridSearch(workspaceId, cat.query, { k: 5 })) add(c);
  }

  const out: RetrievedChunk[] = [];
  let chars = 0;
  for (const c of picked.values()) {
    if (out.length >= MAX_SOURCES || chars + c.content.length > MAX_CHARS) continue;
    out.push(c);
    chars += c.content.length;
  }
  return out;
}

function renderSource(c: RetrievedChunk, label: string): string {
  const attrs = [`id="${label}"`, `file="${c.path}"`, `role="${c.role}"`, `lines="${c.startLine}-${c.endLine}"`];
  if (c.symbol) attrs.push(`symbol="${c.symbol.replace(/"/g, "'")}"`);
  const body = c.blocks.map((b) => `${String(b.s).padStart(5)}  ${b.t}`).join("\n");
  return `<source ${attrs.join(" ")}>\n${body}\n</source>`;
}

function resolveEvidence(list: RawEvidence[], bySource: Map<string, RetrievedChunk>): ResolvedEvidence[] {
  const out: ResolvedEvidence[] = [];
  for (const e of list) {
    const label = e.source.trim().toUpperCase().replace(/^\[|\]$/g, "");
    const chunk = bySource.get(label);
    if (!chunk) continue; // drop evidence that points at a source the model was never shown
    let s = Math.min(e.start_line, e.end_line);
    let end = Math.max(e.start_line, e.end_line);
    s = Math.min(Math.max(s, chunk.startLine), chunk.endLine);
    end = Math.min(Math.max(end, s), chunk.endLine);
    out.push({ source: label, fileId: chunk.fileId, path: chunk.path, startLine: s, endLine: end, note: e.note });
  }
  return out;
}

export async function generateReport(
  workspaceId: string,
  status: (message: string) => void,
  signal: AbortSignal,
): Promise<StoredReport> {
  status("Collecting evidence for 8 risk categories…");
  const evidence = await gatherEvidence(workspaceId);
  if (!evidence.length) throw new Error("Nothing is indexed in this workspace yet.");
  const bySource = new Map(evidence.map((c, i) => [`S${i + 1}`, c]));
  const hasDocs = evidence.some((c) => c.role === "document");

  const prompt = [
    `Categories to assess (use these ids): ${REPORT_CATEGORIES.map((c) => `${c.id} = ${c.title}`).join("; ")}.`,
    hasDocs ? "Project documents are included; fill docs_vs_code." : "No project documents are included; return an empty docs_vs_code list.",
    `There are ${evidence.length} sources. Target files are the deployed contract; library files are third-party dependencies.`,
    "",
    ...[...bySource.entries()].map(([label, c]) => renderSource(c, label)),
  ].join("\n");

  status(`Claude is reviewing ${evidence.length} sources — this usually takes 30–90 seconds…`);
  const client = getClient();
  let raw: RawReport | null = null;
  let model: string = config.model;
  try {
    const stream = client.beta.messages.stream(
      {
        model: config.model,
        max_tokens: 32000,
        output_config: { effort: config.reportEffort, format: betaZodOutputFormat(ReportSchema) },
        system: [{ type: "text", text: REPORT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: prompt }],
        ...fallbackOptions(),
      },
      { signal },
    );
    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") throw new Error("Claude declined to produce this report.");
    if (final.stop_reason === "max_tokens") throw new Error("The report hit the token limit before finishing.");
    raw = final.parsed_output ?? null;
    model = final.model;
  } catch (err) {
    throw new Error(describeApiError(err));
  }
  if (!raw) throw new Error("Claude's response did not match the report schema.");

  const titles = new Map<string, string>(REPORT_CATEGORIES.map((c) => [c.id, c.title]));
  const report: RiskReport = {
    overall_risk: raw.overall_risk,
    headline: raw.headline,
    summary: raw.summary,
    categories: REPORT_CATEGORIES.map((cat) => {
      const found = raw.categories.find((c) => c.id === cat.id);
      return {
        id: cat.id,
        title: titles.get(cat.id) ?? cat.id,
        status: found?.status ?? "unknown",
        summary: found?.summary ?? "Not assessed.",
        findings: (found?.findings ?? []).map((f) => ({ ...f, evidence: resolveEvidence(f.evidence, bySource) })),
      };
    }),
    docs_vs_code: raw.docs_vs_code.map((d) => ({ ...d, evidence: resolveEvidence(d.evidence, bySource) })),
    limitations: raw.limitations,
    sourceCount: evidence.length,
  };

  const db = await getDb();
  const id = randomUUID();
  const [row] = await db.query<{ created_at: string }>(
    "INSERT INTO reports (id, workspace_id, model, report) VALUES ($1, $2, $3, $4::jsonb) RETURNING created_at",
    [id, workspaceId, model, JSON.stringify(report)],
  );
  return { id, model, created_at: new Date(row.created_at).toISOString(), report };
}
