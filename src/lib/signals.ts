import type { SignalKind } from "@/lib/types";

/** Human-readable labels for detector signals (shared by server and client). */
export const SIGNAL_INFO: Record<SignalKind, { label: string; phrase: string }> = {
  "access-control": { label: "Privileged function", phrase: "restricted to a privileged role such as owner or admin" },
  mint: { label: "Can mint supply", phrase: "mints new tokens and increases total supply" },
  pause: { label: "Pausable", phrase: "can pause or unpause transfers" },
  blacklist: { label: "Blacklist / freeze", phrase: "can blacklist, block or freeze accounts" },
  fee: { label: "Adjustable fee", phrase: "sets or changes fees or taxes" },
  upgradeable: { label: "Upgradeable", phrase: "upgrades or replaces the contract implementation" },
  delegatecall: { label: "delegatecall", phrase: "executes external code via delegatecall" },
  selfdestruct: { label: "selfdestruct", phrase: "can destroy the contract with selfdestruct" },
  "tx-origin": { label: "tx.origin", phrase: "uses tx.origin for authorization" },
  "low-level-call": { label: "Low-level call", phrase: "makes low-level external calls" },
  assembly: { label: "Inline assembly", phrase: "uses inline assembly" },
  withdraw: { label: "Privileged withdrawal", phrase: "lets a privileged role withdraw or rescue funds" },
  limits: { label: "Transfer limits", phrase: "enforces trading limits, max wallet or trading switches" },
  "prompt-injection": { label: "Prompt-injection text", phrase: "contains text that tries to instruct an AI" },
};
