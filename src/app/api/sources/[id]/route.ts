import type { NextRequest } from "next/server";
import { badRequest } from "@/lib/http";
import { deleteSource } from "@/lib/repo";

export async function DELETE(_req: NextRequest, ctx: RouteContext<"/api/sources/[id]">) {
  const { id } = await ctx.params;
  return (await deleteSource(id)) ? Response.json({ ok: true }) : badRequest("Source not found", 404);
}
