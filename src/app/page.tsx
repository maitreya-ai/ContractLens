import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { HomeClient } from "@/components/home-client";
import { config, hasAnthropicKey, modelLabel } from "@/lib/config";
import { listWorkspaces } from "@/lib/repo";

export default async function Home() {
  await connection(); // render per request: reads the local database
  const workspaces = await listWorkspaces();
  const health = { llm: hasAnthropicKey(), modelLabel: modelLabel(), database: config.databaseUrl ? "postgres" : "pglite" } as const;
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader health={health} />
      <HomeClient workspaces={workspaces} />
    </div>
  );
}
