import type { ParsedSolidity, SolMember } from "@/lib/chunking/solidity-parser";
import { SIGNAL_INFO } from "@/lib/signals";
import type { DraftSignal, Severity, SignalKind } from "@/lib/types";

export { SIGNAL_INFO };

/**
 * Deterministic, explainable heuristics. They never decide anything on their own:
 * they tag chunks (which improves retrieval), seed the risk report with evidence,
 * and give a useful static view when no LLM key is configured.
 */



const PRIVILEGED_MODIFIER = /^(only[A-Z_]\w*|onlyRole|auth|requiresAuth|restricted|ownerOnly|isOwner|onlyAdmin|onlyGov\w*)\b/;
const PRIVILEGED_BODY =
  /msg\.sender\s*==\s*(owner|_owner|admin|_admin|governance|owner\s*\(\s*\))|msg\.sender\s*!=\s*(owner|_owner|admin)|_checkOwner\s*\(|_checkRole\s*\(|hasRole\s*\(|_onlyOwner\s*\(|_authorizeUpgrade|ifAdmin/;

const CALLABLE = new Set(["function", "fallback", "receive"]);

function isExternallyCallable(m: SolMember): boolean {
  return CALLABLE.has(m.kind) && (m.visibility === null || m.visibility === "public" || m.visibility === "external");
}

export function isPrivileged(m: SolMember): boolean {
  return m.modifiers.some((x) => PRIVILEGED_MODIFIER.test(x)) || PRIVILEGED_BODY.test(m.masked);
}

interface LineRule {
  kind: SignalKind;
  severity: Severity;
  re: RegExp;
  detail: string;
  max?: number;
}

const LINE_RULES: LineRule[] = [
  { kind: "selfdestruct", severity: "high", re: /\bselfdestruct\s*\(|\bsuicide\s*\(/, detail: "selfdestruct can remove the contract's code and send its ETH away" },
  { kind: "tx-origin", severity: "high", re: /\btx\.origin\b/, detail: "tx.origin is used; authorization based on it is phishable" },
  { kind: "delegatecall", severity: "warn", re: /\bdelegatecall\s*\(/, detail: "delegatecall runs another contract's code with this contract's storage", max: 4 },
  { kind: "low-level-call", severity: "info", re: /\.call\s*(\{|\(|\.value\s*\()/, detail: "low-level call to an external address", max: 4 },
  { kind: "assembly", severity: "info", re: /\bassembly\s*(\(|\{|")/, detail: "inline assembly bypasses Solidity safety checks", max: 3 },
  { kind: "upgradeable", severity: "warn", re: /\b(UUPSUpgradeable|TransparentUpgradeableProxy|ERC1967\w*|_setImplementation|IMPLEMENTATION_SLOT|_upgradeTo\w*)\b/, detail: "upgradeable proxy pattern: logic can be replaced", max: 3 },
  { kind: "limits", severity: "info", re: /\b(maxTx\w*|maxWallet\w*|maxTransaction\w*|tradingEnabled|tradingOpen|tradingActive|cooldown\w*)\b/i, detail: "trading limits or a trading on/off switch", max: 3 },
];

const INJECTION_RE =
  /(ignore (all |any )?(previous|prior|above|earlier) (instructions|prompts)|disregard (all |the )?(previous|above|prior) |you are (now )?(an? )?(ai|assistant|chatbot|language model)\b|system prompt|(report|mark|classify) (this|the) (contract|token|code) as (safe|secure|audited)|do not (mention|report|flag) )/i;

export function detectSignals(parsed: ParsedSolidity): DraftSignal[] {
  const out: DraftSignal[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const push = (s: DraftSignal, key: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    out.push(s);
  };

  const members = [...parsed.contracts.flatMap((c) => c.members), ...parsed.freeMembers];
  const memberAt = (line: number) =>
    members.find((m) => line >= m.startLine && line <= m.endLine) ?? null;
  const symbolOf = (m: SolMember | null) => (m ? (m.container ? `${m.container}.${m.name}` : m.name) : null);

  for (const m of members) {
    if (!m.hasBody || !isExternallyCallable(m)) continue;
    const symbol = symbolOf(m);
    const priv = isPrivileged(m);
    const mods = m.modifiers.filter((x) => PRIVILEGED_MODIFIER.test(x));
    const who = mods.length ? mods.join(", ") : "an in-body sender check";
    const at = m.sigLine;

    if (priv) {
      push({ kind: "access-control", severity: "info", line: at, symbol, detail: `${m.name}() is restricted by ${who}` }, `ac:${symbol}`);
    }
    if (/\b_mint\s*\(|\btotalSupply_?\s*(\+=|=\s*totalSupply_?\s*\.\s*add)|\b_totalSupply\s*(\+=|=\s*_totalSupply\s*\.\s*add)/.test(m.masked)) {
      push({
        kind: "mint",
        severity: priv ? "warn" : "info",
        line: at,
        symbol,
        detail: priv ? `${m.name}() can create new supply and is restricted by ${who}` : `${m.name}() increases total supply`,
      }, `mint:${symbol}`);
    }
    if (priv && /fee|tax/i.test(m.name)) {
      push({ kind: "fee", severity: "warn", line: at, symbol, detail: `${m.name}() lets a privileged role change fees` }, `fee:${symbol}`);
    }
    if (priv && /withdraw|sweep|rescue|recover|drain|skim|emergency|claimStuck/i.test(m.name)) {
      push({ kind: "withdraw", severity: "warn", line: at, symbol, detail: `${m.name}() lets a privileged role move funds out` }, `wd:${symbol}`);
    }
    if (priv && /destroy|confiscate|seize|wipe|burnFrom|forceTransfer|clawback/i.test(m.name)) {
      push({ kind: "blacklist", severity: "high", line: at, symbol, detail: `${m.name}() lets a privileged role destroy or seize a holder's balance` }, `bl:${symbol}`);
    } else if (priv && /blacklist|blocklist|denylist|freeze|ban|block/i.test(m.name)) {
      push({ kind: "blacklist", severity: "warn", line: at, symbol, detail: `${m.name}() can restrict specific accounts` }, `bl:${symbol}`);
    }
    if (priv && /^(deprecate|migrate|setUpgrade\w*|setLogic|setTarget)$/i.test(m.name)) {
      push({ kind: "upgradeable", severity: "warn", line: at, symbol, detail: `${m.name}() can redirect the token to new logic` }, `up:${symbol}`);
    }
    if (priv && /^_?(pause|unpause)$/i.test(m.name)) {
      push({ kind: "pause", severity: "warn", line: at, symbol, detail: `${m.name}() can halt or resume the contract` }, `pause:${symbol}`);
    }
    if (/^(upgradeTo|upgradeToAndCall|changeAdmin|setImplementation|upgradeImplementation)$/.test(m.name)) {
      push({ kind: "upgradeable", severity: "warn", line: at, symbol, detail: `${m.name}() can replace the contract logic${priv ? ` (restricted by ${who})` : ""}` }, `up:${symbol}`);
    }
  }

  // Modifiers/usages that gate transfers.
  parsed.maskedLines.forEach((text, idx) => {
    const line = idx + 1;
    if (/\bwhenNotPaused\b/.test(text)) {
      const m = memberAt(line);
      if (m && m.kind !== "modifier") {
        push({ kind: "pause", severity: "warn", line, symbol: symbolOf(m), detail: `${m.name}() stops working while the contract is paused` }, `pause:${symbolOf(m)}`);
      }
    }
    if (/\b(isBlacklisted|_blacklisted|blacklisted|isBlocked|frozen|isFrozen|notBlacklisted)\b/.test(text)) {
      const m = memberAt(line);
      if (m && m.kind === "function" && m.hasBody) {
        push({ kind: "blacklist", severity: "warn", line, symbol: symbolOf(m), detail: `${m.name}() checks a blacklist/freeze list` }, `bl:${symbolOf(m)}`);
      }
    }
    for (const rule of LINE_RULES) {
      if (!rule.re.test(text)) continue;
      const n = counts.get(rule.kind) ?? 0;
      if (rule.max && n >= rule.max) continue;
      const m = memberAt(line);
      const key = `${rule.kind}:${line}`;
      if (seen.has(key)) continue;
      counts.set(rule.kind, n + 1);
      push({ kind: rule.kind, severity: rule.severity, line, symbol: symbolOf(m), detail: rule.detail }, key);
    }
  });

  out.push(...detectInjection(parsed.lines));
  return out.sort((a, b) => a.line - b.line);
}

/** Flags text that tries to steer an AI reviewer. Runs on raw lines, since it hides in comments. */
export function detectInjection(lines: string[]): DraftSignal[] {
  const out: DraftSignal[] = [];
  lines.forEach((text, idx) => {
    if (out.length < 5 && INJECTION_RE.test(text)) {
      out.push({
        kind: "prompt-injection",
        severity: "high",
        line: idx + 1,
        symbol: null,
        detail: "Text that addresses an AI reviewer was found; treat nearby claims with suspicion",
      });
    }
  });
  return out;
}
