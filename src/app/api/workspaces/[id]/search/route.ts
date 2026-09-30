import type { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/http";
import { buildTsQuery, hybridSearch } from "@/lib/retrieval";
import { workspaceExists } from "@/lib/repo";

const Body = z.object({
  query: z.string().trim().min(1).max(1000),
  mode: z.enum(["hybrid", "vector", "keyword"]).default("hybrid"),
  k: z.number().int().min(1).max(30).default(12),
});

/** Retrieval inspector: exposes ranks and scores so the RAG pipeline can be examined. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/search">) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error.issues[0]?.message ?? "Invalid request.");
  if (!(await workspaceExists(id))) return badRequest("Workspace not found", 404);
  const started = Date.now();
  const results = await hybridSearch(id, body.data.query, { k: body.data.k, mode: body.data.mode });
  return Response.json({
    tsquery: buildTsQuery(body.data.query),
    ms: Date.now() - started,
    results: results.map(({ blocks: _blocks, ...r }) => r),
  });
}
