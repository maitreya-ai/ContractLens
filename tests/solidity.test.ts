import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectSignals } from "@/lib/analysis/detectors";
import { chunkSolidity } from "@/lib/chunking/solidity";
import { maskSolidity, parseSolidity } from "@/lib/chunking/solidity-parser";

const fixture = fs.readFileSync(path.join(__dirname, "../eval/fixtures/VaultToken.sol"), "utf8");
const lines = fixture.split("\n");
const lineOf = (needle: string) => lines.findIndex((l) => l.includes(needle)) + 1;

describe("maskSolidity", () => {
  it("blanks comments and strings but keeps offsets and newlines", () => {
    const src = 'a /* { */ b // }\nstring s = "}{";';
    const masked = maskSolidity(src);
    expect(masked).toHaveLength(src.length);
    expect(masked).not.toMatch(/[{}]/);
    expect(masked.split("\n")).toHaveLength(2);
  });

  it("can keep string literals", () => {
    expect(maskSolidity('x = "a"; // c', { strings: false })).toBe('x = "a";     ');
  });
});

describe("parseSolidity", () => {
  const parsed = parseSolidity(fixture);

  it("finds top-level contracts and interfaces", () => {
    expect(parsed.contracts.map((c) => `${c.kind} ${c.name}`)).toEqual(["contract VaultToken", "interface IERC20Like"]);
  });

  it("records exact line ranges, NatSpec and modifiers", () => {
    const vault = parsed.contracts[0];
    const mint = vault.members.find((m) => m.name === "mint")!;
    expect(mint.sigLine).toBe(lineOf("function mint(address to"));
    expect(mint.startLine).toBe(mint.sigLine - 1); // includes the /// @notice line
    expect(mint.natspec).toMatch(/no supply cap/i);
    expect(mint.modifiers).toEqual(["onlyMinter"]);
    expect(mint.visibility).toBe("external");
    expect(lines[mint.endLine - 1].trim()).toBe("}");
  });

  it("classifies special functions and state variables", () => {
    const kinds = new Map(parsed.contracts[0].members.map((m) => [m.name, m.kind]));
    expect(kinds.get("constructor")).toBe("constructor");
    expect(kinds.get("fallback")).toBe("fallback");
    expect(kinds.get("receive")).toBe("receive");
    expect(kinds.get("MAX_FEE")).toBe("state");
    expect(kinds.get("isBlacklisted")).toBe("state");
    expect(kinds.get("FeesUpdated")).toBe("event");
    expect(kinds.get("FeeTooHigh")).toBe("error");
    expect(kinds.get("onlyOwner")).toBe("modifier");
  });

  it("is not confused by braces in strings or comments", () => {
    const src = [
      "contract A {",
      '  string constant s = "} {";',
      "  // }",
      "  function f() public { /* } */ }",
      "}",
      "contract B is A, Ownable(msg.sender) { function g() external {} }",
    ].join("\n");
    const p = parseSolidity(src);
    expect(p.contracts.map((c) => c.name)).toEqual(["A", "B"]);
    expect(p.contracts[1].bases).toEqual(["A", "Ownable"]);
    expect(p.contracts[0].members.find((m) => m.name === "f")?.endLine).toBe(4);
  });

  it("handles legacy unnamed fallback functions", () => {
    const p = parseSolidity("contract Old { function () external payable { revert(); } }");
    expect(p.contracts[0].members[0]).toMatchObject({ kind: "fallback", hasBody: true });
  });
});

describe("detectSignals", () => {
  const signals = detectSignals(parseSolidity(fixture));
  const has = (kind: string, symbol: string) => signals.some((s) => s.kind === kind && s.symbol === symbol);

  it("flags the admin levers in the fixture", () => {
    expect(has("mint", "VaultToken.mint")).toBe(true);
    expect(has("blacklist", "VaultToken.setBlacklist")).toBe(true);
    expect(has("fee", "VaultToken.setFees")).toBe(true);
    expect(has("pause", "VaultToken.pause")).toBe(true);
    expect(has("upgradeable", "VaultToken.upgradeTo")).toBe(true);
    expect(has("withdraw", "VaultToken.emergencyWithdraw")).toBe(true);
    expect(has("delegatecall", "VaultToken.fallback")).toBe(true);
    expect(has("access-control", "VaultToken.addMinter")).toBe(true);
  });

  it("does not flag the constructor or internal helpers as minting", () => {
    expect(signals.some((s) => s.kind === "mint" && /constructor|_mint/.test(s.symbol ?? ""))).toBe(false);
  });

  it("detects text aimed at AI reviewers", () => {
    const injection = signals.find((s) => s.kind === "prompt-injection");
    expect(injection?.line).toBe(lineOf("NOTE TO AI AUDITORS"));
    expect(injection?.severity).toBe("high");
  });
});

describe("chunkSolidity", () => {
  const parsed = parseSolidity(fixture);
  const chunks = chunkSolidity("VaultToken.sol", parsed, detectSignals(parsed));

  it("produces an outline plus one chunk per function", () => {
    expect(chunks.filter((c) => c.kind === "outline").map((c) => c.symbol)).toEqual(["VaultToken", "IERC20Like"]);
    expect(chunks.some((c) => c.symbol === "VaultToken.setFees" && c.kind === "function")).toBe(true);
  });

  it("builds citable blocks that point at the right source lines", () => {
    for (const chunk of chunks.filter((c) => c.kind !== "outline")) {
      for (const b of chunk.blocks) {
        expect(b.t.trim()).not.toBe("");
        expect(lines[b.s - 1].trimEnd()).toBe(b.t);
        expect(b.e).toBeGreaterThanOrEqual(b.s);
      }
    }
  });

  it("maps outline entries to their declaration lines", () => {
    const outline = chunks.find((c) => c.kind === "outline" && c.symbol === "VaultToken")!;
    const entry = outline.blocks.find((b) => b.t.includes("function setFees"))!;
    expect(entry.s).toBe(lineOf("function setFees("));
  });

  it("tags chunks with behaviour so retrieval can match plain-English questions", () => {
    const mint = chunks.find((c) => c.symbol === "VaultToken.mint")!;
    expect(mint.tags).toContain("mint");
    expect(mint.embedText).toMatch(/mints new tokens/);
    expect(mint.searchText).toMatch(/only minter/);
  });

  it("splits very long functions into overlapping windows", () => {
    const body = Array.from({ length: 150 }, (_, i) => `    x += ${i};`).join("\n");
    const p = parseSolidity(`contract L {\n  function big() public {\n${body}\n  }\n}`);
    const parts = chunkSolidity("L.sol", p, []).filter((c) => c.symbol === "L.big");
    expect(parts.length).toBeGreaterThan(2);
    expect(parts[1].startLine).toBeLessThan(parts[0].endLine);
  });
});
