import { randomUUID } from "node:crypto";
import { detectSignals } from "@/lib/analysis/detectors";
import { chunkSolidity } from "@/lib/chunking/solidity";
import { parseSolidity } from "@/lib/chunking/solidity-parser";
import { chunkText } from "@/lib/chunking/text";
import { getDb, toVector, type Queryable } from "@/lib/db";
import { embedPassages, warmEmbeddings } from "@/lib/embeddings";
import { classifyRole, languageFor, normalizePaths } from "@/lib/sources/paths";
import { fetchVerifiedContract, UserError, type VerifiedContract } from "@/lib/sources/verified";
import type { DraftChunk, DraftSignal, FileRole, Language } from "@/lib/types";

export type IngestEvent =
  | { type: "status"; message: string }
  | { type: "progress"; label: string; done: number; total: number };

export type Emit = (e: IngestEvent) => void;

interface FileInput {
  path: string;
  content: string;
  language: Language;
  role: FileRole;
}

interface SourceInput {
  kind: "contract" | "paste" | "document";
  title: string;
  chainId?: number | null;
  address?: string | null;
  meta?: Record<string, unknown>;
}

export async function createWorkspace(name: string): Promise<string> {
  const db = await getDb();
  const id = randomUUID();
  await db.query("INSERT INTO workspaces (id, name) VALUES ($1, $2)", [id, name.slice(0, 120)]);
  return id;
}

async function insertMany(q: Queryable, table: string, columns: string[], rows: unknown[][], casts: string[] = []) {
  const BATCH = 50;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const params: unknown[] = [];
    const values = batch.map((row) => {
      const ph = row.map((v, j) => {
        params.push(v);
        return `$${params.length}${casts[j] ?? ""}`;
      });
      return `(${ph.join(", ")})`;
    });
    await q.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${values.join(", ")}`, params);
  }
}

/** Parse, detect, chunk, embed and store a set of files as one source. */
async function indexSource(workspaceId: string, source: SourceInput, files: FileInput[], emit: Emit): Promise<string> {
  const sourceId = randomUUID();
  const fileRows: Array<{ id: string; file: FileInput }> = files.map((file) => ({ id: randomUUID(), file }));
  const chunks: Array<{ fileId: string; chunk: DraftChunk }> = [];
  const signals: Array<{ fileId: string; signal: DraftSignal }> = [];

  emit({ type: "status", message: `Parsing ${files.length} file${files.length === 1 ? "" : "s"}…` });
  for (const { id, file } of fileRows) {
    if (file.language === "solidity") {
      const parsed = parseSolidity(file.content);
      const found = detectSignals(parsed);
      found.forEach((signal) => signals.push({ fileId: id, signal }));
      chunkSolidity(file.path, parsed, found).forEach((chunk) => chunks.push({ fileId: id, chunk }));
    } else {
      const { chunks: docChunks, signals: docSignals } = chunkText(file.path, source.title, file.content);
      docSignals.forEach((signal) => signals.push({ fileId: id, signal }));
      docChunks.forEach((chunk) => chunks.push({ fileId: id, chunk }));
    }
  }
  if (!chunks.length) throw new UserError("Nothing to index: the source appears to be empty.");

  emit({ type: "status", message: `Embedding ${chunks.length} chunks locally…` });
  await warmEmbeddings();
  const vectors = await embedPassages(
    chunks.map((c) => c.chunk.embedText),
    (done, total) => emit({ type: "progress", label: "Embedding", done, total }),
  );

  emit({ type: "status", message: "Saving to Postgres…" });
  const db = await getDb();
  await db.tx(async (q) => {
    await q.query(
      "INSERT INTO sources (id, workspace_id, kind, title, chain_id, address, meta) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)",
      [sourceId, workspaceId, source.kind, source.title, source.chainId ?? null, source.address ?? null, JSON.stringify(source.meta ?? {})],
    );
    await insertMany(
      q,
      "files",
      ["id", "source_id", "workspace_id", "path", "language", "role", "content", "line_count"],
      fileRows.map(({ id, file }) => [id, sourceId, workspaceId, file.path, file.language, file.role, file.content, file.content.split("\n").length]),
    );
    await insertMany(
      q,
      "chunks",
      ["id", "workspace_id", "file_id", "kind", "symbol", "container", "start_line", "end_line", "content", "blocks", "tags", "search_text", "embedding"],
      chunks.map(({ fileId, chunk }, i) => [
        randomUUID(),
        workspaceId,
        fileId,
        chunk.kind,
        chunk.symbol,
        chunk.container,
        chunk.startLine,
        chunk.endLine,
        chunk.content,
        JSON.stringify(chunk.blocks),
        JSON.stringify(chunk.tags),
        chunk.searchText,
        toVector(vectors[i]),
      ]),
      ["", "", "", "", "", "", "", "", "", "::jsonb", "::jsonb", "", "::vector"],
    );
    await insertMany(
      q,
      "signals",
      ["id", "workspace_id", "file_id", "kind", "severity", "line", "symbol", "detail"],
      signals.map(({ fileId, signal }) => [randomUUID(), workspaceId, fileId, signal.kind, signal.severity, signal.line, signal.symbol, signal.detail]),
    );
  });
  emit({ type: "status", message: `Indexed ${files.length} file${files.length === 1 ? "" : "s"}, ${chunks.length} chunks, ${signals.length} signals.` });
  return sourceId;
}

function contractFiles(contract: VerifiedContract): FileInput[] {
  const names = normalizePaths(contract.files.map((f) => f.path));
  return contract.files
    .map((f) => {
      const path = names.get(f.path) ?? f.path;
      return {
        path,
        content: f.content,
        language: languageFor(f.path),
        role: classifyRole(path, f.path === contract.targetPath),
      };
    })
    .sort((a, b) => ["target", "project", "library"].indexOf(a.role) - ["target", "project", "library"].indexOf(b.role) || a.path.localeCompare(b.path));
}

export async function ingestContract(
  workspaceId: string,
  chainId: number,
  address: string,
  emit: Emit,
  proxyOf: string | null = null,
): Promise<{ title: string }> {
  const db = await getDb();
  const existing = await db.query<{ id: string }>(
    "SELECT id FROM sources WHERE workspace_id = $1 AND chain_id = $2 AND lower(address) = lower($3)",
    [workspaceId, chainId, address],
  );
  if (existing.length) {
    emit({ type: "status", message: `${address} is already in this workspace.` });
    return { title: address };
  }

  const contract = await fetchVerifiedContract(chainId, address, (message) => emit({ type: "status", message }));
  emit({
    type: "status",
    message: `Found ${contract.name} on ${contract.provider === "sourcify" ? "Sourcify" : "Etherscan"} (${contract.files.length} source file${contract.files.length === 1 ? "" : "s"}).`,
  });
  await indexSource(
    workspaceId,
    {
      kind: "contract",
      title: proxyOf ? `${contract.name} (implementation)` : contract.name,
      chainId,
      address,
      meta: {
        provider: contract.provider,
        compilerVersion: contract.compilerVersion,
        proxyType: contract.proxy?.type ?? null,
        implementations: contract.proxy?.implementations ?? [],
        proxyOf,
      },
    },
    contractFiles(contract),
    emit,
  );

  // Follow proxies once, so questions are answered from the logic that actually runs.
  const implementations: string[] = [];
  if (!proxyOf && contract.proxy?.implementations.length) {
    for (const impl of contract.proxy.implementations.slice(0, 2)) {
      emit({
        type: "status",
        message: `Proxy detected${contract.proxy.type ? ` (${contract.proxy.type})` : ""} — following implementation ${impl.name ?? ""} ${impl.address}`.replace(/\s+/g, " "),
      });
      try {
        implementations.push((await ingestContract(workspaceId, chainId, impl.address, emit, address)).title);
      } catch (err) {
        emit({ type: "status", message: `Could not index implementation: ${err instanceof Error ? err.message : "error"}` });
      }
    }
  }
  return { title: implementations.length ? `${contract.name} → ${implementations.join(", ")}` : contract.name };
}

export async function ingestPaste(workspaceId: string, title: string, code: string, emit: Emit) {
  const isSolidity = /\b(pragma\s+solidity|contract|library|interface)\b/.test(code);
  const name = title.trim() || (/\bcontract\s+([A-Za-z_]\w*)/.exec(code)?.[1] ?? "Pasted");
  const path = isSolidity ? `${name.replace(/[^\w.-]/g, "_")}.sol` : `${name.replace(/[^\w.-]/g, "_")}.md`;
  await indexSource(
    workspaceId,
    { kind: isSolidity ? "paste" : "document", title: name },
    [{ path, content: code, language: isSolidity ? "solidity" : "markdown", role: isSolidity ? "target" : "document" }],
    emit,
  );
  return { title: name };
}

export async function ingestDocument(workspaceId: string, filename: string, bytes: Uint8Array, emit: Emit) {
  let text: string;
  let path = filename;
  if (/\.pdf$/i.test(filename)) {
    emit({ type: "status", message: "Extracting text from PDF…" });
    const { extractText } = await import("unpdf");
    const { text: pages } = await extractText(bytes, { mergePages: false });
    text = pages.map((p, i) => `[Page ${i + 1}]\n${p.trim()}`).join("\n\n");
    path = filename.replace(/\.pdf$/i, ".pdf.txt");
  } else {
    text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
  if (/\.sol$/i.test(filename)) return ingestPaste(workspaceId, filename.replace(/\.sol$/i, ""), text, emit);
  if (!text.trim()) throw new UserError("Could not extract any text from this file.");
  const title = filename.replace(/\.(pdf|md|markdown|txt)$/i, "");
  await indexSource(
    workspaceId,
    { kind: "document", title },
    [{ path, content: text, language: /\.(md|markdown)$/i.test(filename) ? "markdown" : "text", role: "document" }],
    emit,
  );
  return { title };
}
