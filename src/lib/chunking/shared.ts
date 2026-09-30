import type { Block } from "@/lib/types";

/**
 * One citable block per non-blank line; blank lines extend the previous block.
 * Claude's search-result citations point at block indices, so this is what makes
 * every citation resolve to exact line numbers.
 */
export function linesToBlocks(lines: string[], startLine: number): Block[] {
  const blocks: Block[] = [];
  lines.forEach((text, i) => {
    const line = startLine + i;
    if (text.trim() === "") {
      if (blocks.length) blocks[blocks.length - 1].e = line;
      return;
    }
    blocks.push({ t: text.replace(/\s+$/, "").slice(0, 2000), s: line, e: line });
  });
  return blocks;
}

/** "transferOwnership" -> "transfer ownership", "MINTER_ROLE" -> "minter role". */
export function splitIdentifier(id: string): string {
  return id
    .replace(/^_+/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_+/g, " ")
    .toLowerCase()
    .trim();
}

/** Extra keyword text: the words hidden inside camelCase / snake_case identifiers. */
export function identifierWords(code: string, limit = 400): string {
  const words = new Set<string>();
  for (const id of code.match(/[A-Za-z_][A-Za-z0-9_]{3,}/g) ?? []) {
    const split = splitIdentifier(id);
    if (split.includes(" ")) words.add(split);
    if (words.size >= limit) break;
  }
  return [...words].join(" ");
}

/** Split a long line range into overlapping windows. */
export function windows(start: number, end: number, size: number, overlap: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let s = start; s <= end; s += size - overlap) {
    const e = Math.min(end, s + size - 1);
    out.push([s, e]);
    if (e === end) break;
  }
  return out;
}
