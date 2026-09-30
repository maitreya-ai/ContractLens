import { config } from "@/lib/config";

export interface VerifiedContract {
  provider: "sourcify" | "etherscan";
  chainId: number;
  address: string;
  name: string;
  compilerVersion: string | null;
  /** Path of the file that contains the deployed contract, if known. */
  targetPath: string | null;
  files: Array<{ path: string; content: string }>;
  proxy: { type: string | null; implementations: Array<{ address: string; name: string | null }> } | null;
}

export class UserError extends Error {}

const TIMEOUT = 25_000;

interface SourcifyResponse {
  match?: string | null;
  compilation?: { name?: string; compilerVersion?: string; fullyQualifiedName?: string };
  sources?: Record<string, { content?: string }>;
  proxyResolution?: {
    isProxy?: boolean;
    proxyType?: string | null;
    implementations?: Array<{ address: string; name?: string | null }>;
  } | null;
}

/** Sourcify v2: free, keyless, and resolves proxies for us. */
export async function fetchFromSourcify(chainId: number, address: string): Promise<VerifiedContract | null> {
  const url = `https://sourcify.dev/server/v2/contract/${chainId}/${address}?fields=sources,compilation,proxyResolution`;
  const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Sourcify responded with HTTP ${res.status}`);
  const data = (await res.json()) as SourcifyResponse;
  if (!data.match || !data.sources) return null;
  const files = Object.entries(data.sources)
    .filter(([, v]) => typeof v.content === "string")
    .map(([path, v]) => ({ path, content: v.content as string }));
  if (!files.length) return null;
  const fq = data.compilation?.fullyQualifiedName ?? "";
  const proxy = data.proxyResolution?.isProxy
    ? {
        type: data.proxyResolution.proxyType ?? null,
        implementations: (data.proxyResolution.implementations ?? []).map((i) => ({ address: i.address, name: i.name ?? null })),
      }
    : null;
  return {
    provider: "sourcify",
    chainId,
    address,
    name: data.compilation?.name || "Contract",
    compilerVersion: data.compilation?.compilerVersion ?? null,
    targetPath: fq.includes(":") ? fq.slice(0, fq.lastIndexOf(":")) : null,
    files,
    proxy,
  };
}

interface EtherscanResult {
  SourceCode: string;
  ContractName: string;
  CompilerVersion: string;
  Proxy?: string;
  Implementation?: string;
}

/**
 * Etherscan returns source in three shapes: plain Solidity, a JSON map of files,
 * or standard-json input wrapped in an extra pair of braces ("{{...}}").
 */
export function parseEtherscanSource(raw: string, contractName: string): Array<{ path: string; content: string }> {
  const text = raw.trim();
  if (!text.startsWith("{")) return [{ path: `${contractName || "Contract"}.sol`, content: text }];
  const json = text.startsWith("{{") ? text.slice(1, -1) : text;
  const parsed = JSON.parse(json) as { sources?: Record<string, { content: string }> } & Record<string, { content?: string }>;
  const map = parsed.sources ?? parsed;
  return Object.entries(map)
    .filter(([, v]) => v && typeof v.content === "string")
    .map(([path, v]) => ({ path, content: v.content as string }));
}

/** Etherscan V2 multichain API (one key for 50+ chains). Optional fallback. */
export async function fetchFromEtherscan(chainId: number, address: string): Promise<VerifiedContract | null> {
  if (!config.etherscanApiKey) return null;
  const url = new URL("https://api.etherscan.io/v2/api");
  url.search = new URLSearchParams({
    chainid: String(chainId),
    module: "contract",
    action: "getsourcecode",
    address,
    apikey: config.etherscanApiKey,
  }).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`Etherscan responded with HTTP ${res.status}`);
  const data = (await res.json()) as { status: string; message: string; result: EtherscanResult[] | string };
  if (data.status !== "1" || !Array.isArray(data.result)) {
    throw new Error(`Etherscan: ${typeof data.result === "string" ? data.result : data.message}`);
  }
  const r = data.result[0];
  if (!r?.SourceCode) return null;
  const files = parseEtherscanSource(r.SourceCode, r.ContractName);
  const target = files.find((f) => new RegExp(`\\bcontract\\s+${r.ContractName}\\b`).test(f.content));
  return {
    provider: "etherscan",
    chainId,
    address,
    name: r.ContractName || "Contract",
    compilerVersion: r.CompilerVersion || null,
    targetPath: target?.path ?? null,
    files,
    proxy:
      r.Proxy === "1" && r.Implementation
        ? { type: "detected by Etherscan", implementations: [{ address: r.Implementation, name: null }] }
        : null,
  };
}

export async function fetchVerifiedContract(
  chainId: number,
  address: string,
  status: (message: string) => void,
): Promise<VerifiedContract> {
  status("Looking up verified source on Sourcify…");
  let contract: VerifiedContract | null = null;
  try {
    contract = await fetchFromSourcify(chainId, address);
  } catch (err) {
    status(`Sourcify lookup failed (${err instanceof Error ? err.message : "error"}).`);
  }
  if (!contract && config.etherscanApiKey) {
    status("Not on Sourcify — trying Etherscan…");
    contract = await fetchFromEtherscan(chainId, address);
  }
  if (!contract) {
    throw new UserError(
      config.etherscanApiKey
        ? "No verified source code found for this address on this chain."
        : "No verified source on Sourcify for this address. Add an ETHERSCAN_API_KEY to also search Etherscan, or paste the source instead.",
    );
  }
  return contract;
}
