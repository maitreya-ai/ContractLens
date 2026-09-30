import type { NextRequest } from "next/server";
import { hasAnthropicKey } from "@/lib/config";
import { badRequest, ndjson } from "@/lib/http";
import { generateReport, type StoredReport } from "@/lib/llm/report";
import { latestReport, workspaceExists } from "@/lib/repo";

export const maxDuration = 300;

type Event = { type: "status"; message: string } | { type: "report"; report: StoredReport } | { type: "error"; message: string };

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/report">) {
  const { id } = await ctx.params;
  return Response.json({ report: await latestReport(id) });
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/report">) {
  const { id } = await ctx.params;
  if (!(await workspaceExists(id))) return badRequest("Workspace not found", 404);
  if (!hasAnthropicKey()) return badRequest("Add ANTHROPIC_API_KEY to .env.local to generate AI risk reports.", 400);
  return ndjson<Event>(async (send) => {
    const report = await generateReport(id, (message) => send({ type: "status", message }), req.signal);
    send({ type: "report", report });
  });
}
