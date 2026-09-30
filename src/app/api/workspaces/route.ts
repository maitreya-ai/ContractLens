import { listWorkspaces } from "@/lib/repo";

export async function GET() {
  return Response.json({ workspaces: await listWorkspaces() });
}
