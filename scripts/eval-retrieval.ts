/**
 * Retrieval eval: indexes a corpus into an in-memory database and measures how well each
 * retrieval mode ranks the chunks that answer each question.
 *
 *   npm run eval          # bundled fixture (VaultToken.sol + whitepaper), fully offline
 *   npm run eval:live     # real USDC source fetched from Sourcify (needs network)
 *
 * Metrics: Hit@1 / Hit@5 (a relevant chunk is ranked 1st / in the top 5) and MRR@10.
 * A chunk is relevant when its symbol exactly matches one of the question's expected symbols.
 */
import fs from "node:fs";
import path from "node:path";

process.env.PGLITE_DIR = "memory";
delete process.env.DATABASE_URL;

type Mode = "vector" | "keyword" | "hybrid";

interface Question {
  q: string;
  expect: string[];
}

async function main() {
  const { createWorkspace, ingestContract, ingestPaste, ingestDocument } = await import("@/lib/ingest");
  const { hybridSearch } = await import("@/lib/retrieval");

  const root = process.cwd();
  const live = process.argv.includes("--live");
  const verbose = process.argv.includes("--verbose");
  const quiet = () => {};
  const ws = await createWorkspace("eval");
  const t0 = Date.now();

  let name: string;
  let questions: Question[];
  if (live) {
    const suite = JSON.parse(fs.readFileSync(path.join(root, "eval/usdc-questions.json"), "utf8")) as {
      name: string;
      chainId: number;
      address: string;
      questions: Question[];
    };
    name = suite.name;
    questions = suite.questions;
    await ingestContract(ws, suite.chainId, suite.address, quiet);
  } else {
    name = "VaultToken.sol + whitepaper.md (bundled fixture)";
    questions = JSON.parse(fs.readFileSync(path.join(root, "eval/questions.json"), "utf8")) as Question[];
    await ingestPaste(ws, "VaultToken", fs.readFileSync(path.join(root, "eval/fixtures/VaultToken.sol"), "utf8"), quiet);
    await ingestDocument(ws, "whitepaper.md", new Uint8Array(fs.readFileSync(path.join(root, "eval/fixtures/whitepaper.md"))), quiet);
  }
  console.log(`Indexed ${name} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Exact symbol match; document sections match on their last heading ("... > Supply").
  const isRelevant = (symbol: string | null, expect: string[]) =>
    !!symbol && expect.some((e) => symbol === e || symbol.endsWith(`> ${e}`));

  const modes: Mode[] = ["vector", "keyword", "hybrid"];
  const results = Object.fromEntries(modes.map((m) => [m, { hit1: 0, hit5: 0, mrr: 0, misses: [] as string[] }])) as Record<
    Mode,
    { hit1: number; hit5: number; mrr: number; misses: string[] }
  >;

  for (const { q, expect } of questions) {
    for (const mode of modes) {
      const hits = await hybridSearch(ws, q, { k: 10, mode });
      const rank = hits.findIndex((h) => isRelevant(h.symbol, expect)) + 1;
      const r = results[mode];
      if (rank === 1) r.hit1++;
      if (rank >= 1 && rank <= 5) r.hit5++;
      if (rank !== 1) r.misses.push(`[rank ${rank || ">10"}] ${q}  (top: ${hits.slice(0, 3).map((h) => h.symbol).join(" · ")})`);
      if (rank >= 1) r.mrr += 1 / rank;
    }
  }

  const n = questions.length;
  const pct = (x: number) => `${((x / n) * 100).toFixed(0)}%`.padStart(5);
  console.log(`${n} questions\n`);
  console.log("| mode    | Hit@1 | Hit@5 | MRR@10 |");
  console.log("|---------|-------|-------|--------|");
  for (const mode of modes) {
    const r = results[mode];
    console.log(`| ${mode.padEnd(7)} | ${pct(r.hit1)} | ${pct(r.hit5)} | ${(r.mrr / n).toFixed(3).padStart(6)} |`);
  }
  if (verbose) {
    for (const mode of modes) {
      if (results[mode].misses.length) console.log(`\n${mode} not ranked first:\n  ${results[mode].misses.join("\n  ")}`);
    }
  }

  const minHit5 = Number(process.env.EVAL_MIN_HIT5 ?? 0);
  if (minHit5 && results.hybrid.hit5 / n < minHit5) {
    console.error(`\nHybrid Hit@5 ${(results.hybrid.hit5 / n).toFixed(2)} is below the threshold ${minHit5}`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
