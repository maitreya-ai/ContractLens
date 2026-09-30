import type { NextRequest } from "next/server";
import { highlightFile } from "@/lib/highlight";
import { badRequest } from "@/lib/http";
import { getFile } from "@/lib/repo";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const { id } = await ctx.params;
  const file = await getFile(id);
  if (!file) return badRequest("File not found", 404);
  const html = await highlightFile(file.content, file.language);
  return Response.json({
    id: file.id,
    path: file.path,
    language: file.language,
    role: file.role,
    lineCount: file.content.split("\n").length,
    html,
  });
}
