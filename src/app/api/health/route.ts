import { config, hasAnthropicKey, modelLabel } from "@/lib/config";

export async function GET() {
  return Response.json({
    llm: hasAnthropicKey(),
    model: config.model,
    modelLabel: modelLabel(),
    database: config.databaseUrl ? "postgres" : "pglite",
    etherscan: Boolean(config.etherscanApiKey),
  });
}
