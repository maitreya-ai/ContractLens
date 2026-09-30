import type { FileRole } from "@/lib/types";

const LIBRARY_PATTERNS = [
  /(^|\/)node_modules\//,
  /^@[\w.-]+\//,
  /(^|\/)lib\/(openzeppelin|forge-std|solmate|solady|ds-test|chainlink|permit2)/i,
  /(^|\/)(openzeppelin-contracts|openzeppelin|solmate|solady|forge-std)[\w.-]*\//i,
];

/** Third-party dependencies (OpenZeppelin, solmate...) vs the project's own code. */
export function classifyRole(path: string, isTarget: boolean): FileRole {
  if (isTarget) return "target";
  return LIBRARY_PATTERNS.some((re) => re.test(path)) ? "library" : "project";
}

/**
 * Verified sources often carry the deployer's absolute paths
 * ("/Users/alice/repo/contracts/Token.sol"). Strip the shared prefix and any
 * node_modules/ prefix so the tree is readable.
 */
export function normalizePaths(paths: string[]): Map<string, string> {
  const cleaned = paths.map((p) => {
    let c = p.replace(/\\/g, "/").replace(/^project:\/+/, "").replace(/^\.\//, "");
    const nm = c.lastIndexOf("node_modules/");
    if (nm !== -1) c = c.slice(nm + "node_modules/".length);
    return c;
  });
  const absolute = cleaned.filter((p) => p.startsWith("/") || /^[A-Za-z]:\//.test(p));
  let prefix = "";
  if (absolute.length) {
    const split = absolute.map((p) => p.split("/").slice(0, -1));
    const first = split[0];
    let n = 0;
    while (n < first.length && split.every((s) => s[n] === first[n])) n++;
    // Keep the last shared directory (e.g. "contracts/") so paths stay recognisable.
    prefix = first.slice(0, Math.max(0, n - 1)).join("/") + "/";
  }
  const out = new Map<string, string>();
  paths.forEach((original, i) => {
    let p = cleaned[i];
    if (prefix && p.startsWith(prefix)) p = p.slice(prefix.length);
    out.set(original, p.replace(/^\/+/, "") || original);
  });
  return out;
}

export function languageFor(path: string): "solidity" | "markdown" | "text" {
  if (/\.sol$/i.test(path)) return "solidity";
  if (/\.(md|markdown|mdx)$/i.test(path)) return "markdown";
  return "text";
}
