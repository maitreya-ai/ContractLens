import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/chunking/text";
import { citedLines, retrievalQuery } from "@/lib/llm/answer";
import { buildTsQuery, rrf } from "@/lib/retrieval";
import { classifyRole, normalizePaths } from "@/lib/sources/paths";
import { parseEtherscanSource } from "@/lib/sources/verified";
import type { RetrievedChunk } from "@/lib/types";

describe("buildTsQuery", () => {
  it("drops stopwords and splits identifiers", () => {
    expect(buildTsQuery("Can the owner call transferOwnership?")).toBe("owner | call | transferownership | transfer | ownership");
  });
  it("returns an empty query for stopword-only input", () => {
    expect(buildTsQuery("what is it?")).toBe("");
  });
});

describe("rrf", () => {
  it("rewards items ranked well by both retrievers", () => {
    const scores = rrf([
      ["a", "b", "c"],
      ["b", "d", "a"],
    ]);
    const order = [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
    expect(order.slice(0, 2)).toEqual(["b", "a"]);
    expect(order).toContain("d");
  });
});

describe("citations", () => {
  const chunk = {
    startLine: 10,
    endLine: 20,
    blocks: [
      { t: "function f() {", s: 10, e: 10 },
      { t: "  x = 1;", s: 11, e: 13 },
      { t: "}", s: 14, e: 14 },
    ],
  } as unknown as RetrievedChunk;

  it("maps block ranges (end exclusive) to file lines", () => {
    expect(citedLines(chunk, 1, 2)).toEqual({ startLine: 11, endLine: 13 });
    expect(citedLines(chunk, 0, 3)).toEqual({ startLine: 10, endLine: 14 });
  });
  it("clamps out-of-range indices", () => {
    expect(citedLines(chunk, 5, 9)).toEqual({ startLine: 14, endLine: 14 });
  });
});

describe("retrievalQuery", () => {
  it("attaches the previous question to short follow-ups", () => {
    const q = retrievalQuery([
      { role: "user", content: "Can the owner mint?" },
      { role: "assistant", content: "Yes." },
      { role: "user", content: "Is there a cap?" },
    ]);
    expect(q).toBe("Can the owner mint?\nIs there a cap?");
  });
});

describe("chunkText", () => {
  const doc = fs.readFileSync(path.join(__dirname, "../eval/fixtures/whitepaper.md"), "utf8");
  const { chunks } = chunkText("whitepaper.md", "Whitepaper", doc);

  it("keeps heading paths and skips heading-only sections", () => {
    expect(chunks.map((c) => c.symbol)).toContain("VaultToken Whitepaper > Tokenomics > Supply");
    expect(chunks.every((c) => c.blocks.some((b) => !b.t.startsWith("#")))).toBe(true);
  });
});

describe("paths", () => {
  it("strips deployer-machine prefixes and node_modules", () => {
    const map = normalizePaths([
      "/Users/alice/repo/contracts/v1/Token.sol",
      "/Users/alice/repo/contracts/util/Math.sol",
      "/Users/alice/repo/node_modules/@openzeppelin/contracts/token/ERC20/IERC20.sol",
    ]);
    expect([...map.values()]).toEqual(["contracts/v1/Token.sol", "contracts/util/Math.sol", "@openzeppelin/contracts/token/ERC20/IERC20.sol"]);
  });
  it("classifies third-party libraries", () => {
    expect(classifyRole("@openzeppelin/contracts/access/Ownable.sol", false)).toBe("library");
    expect(classifyRole("lib/solmate/src/tokens/ERC20.sol", false)).toBe("library");
    expect(classifyRole("contracts/Vault.sol", false)).toBe("project");
    expect(classifyRole("contracts/Vault.sol", true)).toBe("target");
  });
});

describe("parseEtherscanSource", () => {
  it("handles plain source", () => {
    expect(parseEtherscanSource("contract A {}", "A")).toEqual([{ path: "A.sol", content: "contract A {}" }]);
  });
  it("handles a JSON map of files", () => {
    const raw = JSON.stringify({ "A.sol": { content: "contract A {}" } });
    expect(parseEtherscanSource(raw, "A")).toEqual([{ path: "A.sol", content: "contract A {}" }]);
  });
  it("handles double-brace standard-json input", () => {
    const raw = `{${JSON.stringify({ language: "Solidity", sources: { "src/A.sol": { content: "contract A {}" } } })}}`;
    expect(parseEtherscanSource(raw, "A")).toEqual([{ path: "src/A.sol", content: "contract A {}" }]);
  });
});
