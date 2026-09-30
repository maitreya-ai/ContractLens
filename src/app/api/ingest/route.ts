import fs from "node:fs/promises";
import path from "node:path";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { config } from "@/lib/config";
import { badRequest, ndjson } from "@/lib/http";
import { createWorkspace, ingestContract, ingestDocument, ingestPaste, type IngestEvent } from "@/lib/ingest";
import { deleteWorkspace, renameWorkspace, workspaceExists } from "@/lib/repo";
import { ADDRESS_RE } from "@/lib/sources/chains";

export const maxDuration = 300;

type Event = IngestEvent | { type: "workspace"; id: string } | { type: "done"; workspaceId: string; title: string } | { type: "error"; message: string };

const JsonBody = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("contract"),
    workspaceId: z.string().uuid().optional(),
    chainId: z.number().int().positive(),
    address: z.string().regex(ADDRESS_RE, "Enter a 0x-prefixed 40-character address."),
  }),
  z.object({
    kind: z.literal("paste"),
    workspaceId: z.string().uuid().optional(),
    title: z.string().max(120).default(""),
    code: z.string().min(20, "Paste at least a few lines.").max(config.maxPasteBytes, "Pasted text is too large (1 MB max)."),
  }),
  z.object({ kind: z.literal("demo") }),
]);

type Job =
  | { kind: "json"; body: z.infer<typeof JsonBody> }
  | { kind: "file"; workspaceId?: string; name: string; bytes: Uint8Array };

async function readJob(req: NextRequest): Promise<Job | Response> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    const workspaceId = form.get("workspaceId");
    if (!(file instanceof File)) return badRequest("Attach a PDF, Markdown, text or Solidity file.");
    if (file.size > config.maxUploadBytes) return badRequest("File is too large (10 MB max).");
    if (!/\.(pdf|md|markdown|txt|sol)$/i.test(file.name)) return badRequest("Supported files: .pdf, .md, .txt, .sol");
    return {
      kind: "file",
      workspaceId: typeof workspaceId === "string" && workspaceId ? workspaceId : undefined,
      name: file.name.slice(0, 120),
      bytes: new Uint8Array(await file.arrayBuffer()),
    };
  }
  const parsed = JsonBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid request.");
  return { kind: "json", body: parsed.data };
}

export async function POST(req: NextRequest) {
  const job = await readJob(req);
  if (job instanceof Response) return job;

  const requestedWs = job.kind === "file" ? job.workspaceId : "workspaceId" in job.body ? job.body.workspaceId : undefined;
  if (requestedWs && !(await workspaceExists(requestedWs))) return badRequest("Workspace not found", 404);

  return ndjson<Event>(async (send) => {
    const emit = (e: IngestEvent) => send(e);
    const created = !requestedWs;
    const workspaceId = requestedWs ?? (await createWorkspace("New workspace"));
    send({ type: "workspace", id: workspaceId });

    try {
      let title: string;
      if (job.kind === "file") {
        title = (await ingestDocument(workspaceId, job.name, job.bytes, emit)).title;
      } else if (job.body.kind === "contract") {
        title = (await ingestContract(workspaceId, job.body.chainId, job.body.address, emit)).title;
      } else if (job.body.kind === "paste") {
        title = (await ingestPaste(workspaceId, job.body.title, job.body.code, emit)).title;
      } else {
        const dir = path.join(process.cwd(), "eval", "fixtures");
        const sol = await fs.readFile(path.join(dir, "VaultToken.sol"), "utf8");
        const doc = await fs.readFile(path.join(dir, "whitepaper.md"));
        await ingestPaste(workspaceId, "VaultToken", sol, emit);
        await ingestDocument(workspaceId, "VaultToken whitepaper.md", new Uint8Array(doc), emit);
        title = "Demo: VaultToken + whitepaper";
      }
      if (created) await renameWorkspace(workspaceId, title);
      send({ type: "done", workspaceId, title });
    } catch (err) {
      if (created) await deleteWorkspace(workspaceId).catch(() => undefined);
      throw err;
    }
  });
}
