import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { WorkspaceView } from "@/components/workspace/workspace-view";
import { config, hasAnthropicKey, modelLabel } from "@/lib/config";
import { getWorkspaceDetail } from "@/lib/repo";

export async function generateMetadata(props: PageProps<"/w/[id]">): Promise<Metadata> {
  await connection();
  const { id } = await props.params;
  const detail = await getWorkspaceDetail(id);
  return { title: detail ? `${detail.workspace.name} · ContractLens` : "ContractLens" };
}

export default async function WorkspacePage(props: PageProps<"/w/[id]">) {
  await connection();
  const { id } = await props.params;
  const detail = await getWorkspaceDetail(id);
  if (!detail) notFound();
  const health = { llm: hasAnthropicKey(), modelLabel: modelLabel(), database: config.databaseUrl ? "postgres" : "pglite" } as const;
  return <WorkspaceView initial={detail} health={health} />;
}
