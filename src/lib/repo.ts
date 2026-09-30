import { getDb } from "@/lib/db";
import type { StoredReport } from "@/lib/llm/report";
import type { FileRole, Severity, SignalKind } from "@/lib/types";

export interface WorkspaceSummary {
  id: string;
  name: string;
  created_at: string;
  sources: number;
  chunks: number;
}

export interface FileSummary {
  id: string;
  path: string;
  language: string;
  role: FileRole;
  line_count: number;
}

export interface SourceDetail {
  id: string;
  kind: "contract" | "paste" | "document";
  title: string;
  chain_id: number | null;
  address: string | null;
  meta: Record<string, unknown>;
  created_at: string;
  files: FileSummary[];
}

export interface SignalRow {
  id: string;
  file_id: string;
  path: string;
  role: FileRole;
  kind: SignalKind;
  severity: Severity;
  line: number;
  symbol: string | null;
  detail: string;
}

export interface WorkspaceDetail {
  workspace: { id: string; name: string; created_at: string };
  sources: SourceDetail[];
  signals: SignalRow[];
  stats: { files: number; chunks: number };
  report: StoredReport | null;
}

const iso = (v: unknown) => new Date(v as string).toISOString();
const json = <T,>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

export async function listWorkspaces(): Promise<WorkspaceSummary[]> {
  const db = await getDb();
  const rows = await db.query<WorkspaceSummary>(
    `SELECT w.id, w.name, w.created_at,
            (SELECT count(*)::int FROM sources s WHERE s.workspace_id = w.id) AS sources,
            (SELECT count(*)::int FROM chunks c WHERE c.workspace_id = w.id) AS chunks
       FROM workspaces w ORDER BY w.created_at DESC LIMIT 50`,
  );
  return rows.map((r) => ({ ...r, created_at: iso(r.created_at) }));
}

export async function getWorkspaceDetail(id: string): Promise<WorkspaceDetail | null> {
  const db = await getDb();
  const [workspace] = await db.query<{ id: string; name: string; created_at: string }>(
    "SELECT id, name, created_at FROM workspaces WHERE id = $1",
    [id],
  );
  if (!workspace) return null;
  const sources = await db.query<Omit<SourceDetail, "files">>(
    "SELECT id, kind, title, chain_id, address, meta, created_at FROM sources WHERE workspace_id = $1 ORDER BY created_at",
    [id],
  );
  const files = await db.query<FileSummary & { source_id: string }>(
    `SELECT id, source_id, path, language, role, line_count FROM files WHERE workspace_id = $1
      ORDER BY CASE role WHEN 'target' THEN 0 WHEN 'project' THEN 1 WHEN 'document' THEN 2 ELSE 3 END, path`,
    [id],
  );
  const signals = await db.query<SignalRow>(
    `SELECT s.id, s.file_id, f.path, f.role, s.kind, s.severity, s.line, s.symbol, s.detail
       FROM signals s JOIN files f ON f.id = s.file_id
      WHERE s.workspace_id = $1
      ORDER BY CASE s.severity WHEN 'high' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, f.path, s.line`,
    [id],
  );
  const [counts] = await db.query<{ chunks: number }>("SELECT count(*)::int AS chunks FROM chunks WHERE workspace_id = $1", [id]);
  return {
    workspace: { ...workspace, created_at: iso(workspace.created_at) },
    sources: sources.map((s) => ({
      ...s,
      meta: json<Record<string, unknown>>(s.meta),
      created_at: iso(s.created_at),
      files: files.filter((f) => f.source_id === s.id).map(({ source_id: _source, ...f }) => f),
    })),
    signals,
    stats: { files: files.length, chunks: counts?.chunks ?? 0 },
    report: await latestReport(id),
  };
}

export async function latestReport(workspaceId: string): Promise<StoredReport | null> {
  const db = await getDb();
  const [row] = await db.query<{ id: string; model: string; created_at: string; report: unknown }>(
    "SELECT id, model, created_at, report FROM reports WHERE workspace_id = $1 ORDER BY created_at DESC LIMIT 1",
    [workspaceId],
  );
  return row ? { id: row.id, model: row.model, created_at: iso(row.created_at), report: json(row.report) } : null;
}

export async function getFile(id: string) {
  const db = await getDb();
  const [row] = await db.query<{ id: string; path: string; language: string; role: FileRole; content: string; workspace_id: string }>(
    "SELECT id, path, language, role, content, workspace_id FROM files WHERE id = $1",
    [id],
  );
  return row ?? null;
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>("DELETE FROM workspaces WHERE id = $1 RETURNING id", [id]);
  return rows.length > 0;
}

export async function renameWorkspace(id: string, name: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>("UPDATE workspaces SET name = $2 WHERE id = $1 RETURNING id", [id, name.slice(0, 120)]);
  return rows.length > 0;
}

export async function deleteSource(id: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.query<{ id: string }>("DELETE FROM sources WHERE id = $1 RETURNING id", [id]);
  return rows.length > 0;
}

export async function workspaceExists(id: string): Promise<boolean> {
  const db = await getDb();
  return (await db.query("SELECT 1 FROM workspaces WHERE id = $1", [id])).length > 0;
}
