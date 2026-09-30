import type { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, ndjson } from "@/lib/http";
import { streamAnswer } from "@/lib/llm/answer";
import { workspaceExists } from "@/lib/repo";
import type { ChatEvent } from "@/lib/types";

export const maxDuration = 300;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) }))
    .min(1)
    .max(40)
    .refine((m) => m[0].role === "user" && m[m.length - 1].role === "user", "Conversation must start and end with a user message."),
});

export async function POST(req: NextRequest, ctx: RouteContext<"/api/workspaces/[id]/chat">) {
  const { id } = await ctx.params;
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return badRequest(body.error.issues[0]?.message ?? "Invalid request.");
  if (!(await workspaceExists(id))) return badRequest("Workspace not found", 404);

  return ndjson<ChatEvent>((send) =>
    streamAnswer({ workspaceId: id, turns: body.data.messages, send, signal: req.signal }),
  );
}
