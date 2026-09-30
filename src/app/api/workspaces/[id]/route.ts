import type { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest } from "@/lib/http";
import { deleteWorkspace, getWorkspaceDetail, renameWorkspace } from "@/lib/repo";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/workspaces/[id]">) {
  const { id } = await ctx.params;
  const detail = await getWorkspaceDetail(id);
  return detail ? Response.json(detail) : badRequest("Workspace not found", 404);
}

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/workspaces/[id]">) {
  const { id } = await ctx.params;
  const body = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest("A name between 1 and 120 characters is required.");
  return (await renameWorkspace(id, body.data.name)) ? Response.json({ ok: true }) : badRequest("Workspace not found", 404);
}

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/workspaces/[id]">) {
  const { id } = await ctx.params;
  return (await deleteWorkspace(id)) ? Response.json({ ok: true }) : badRequest("Workspace not found", 404);
}
