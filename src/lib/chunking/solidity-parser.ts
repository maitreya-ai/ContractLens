/**
 * A small, fault-tolerant structural parser for Solidity.
 *
 * It does not build a full AST. It finds top-level declarations (contracts, libraries,
 * interfaces, free functions) and their members with exact line ranges, which is what
 * chunking, citations and the risk detectors need. Comments and string literals are
 * masked first so braces or keywords inside them never confuse the scanner.
 */

export type ContainerKind = "contract" | "abstract contract" | "library" | "interface";

export type MemberKind =
  | "function"
  | "modifier"
  | "constructor"
  | "fallback"
  | "receive"
  | "event"
  | "error"
  | "struct"
  | "enum"
  | "state"
  | "using";

export interface SolMember {
  kind: MemberKind;
  name: string;
  container: string | null;
  /** First line including leading NatSpec/comments. */
  startLine: number;
  /** Line where the declaration itself starts. */
  sigLine: number;
  endLine: number;
  /** Declaration header on one line, comments removed. */
  signature: string;
  visibility: string | null;
  mutability: string | null;
  modifiers: string[];
  natspec: string;
  hasBody: boolean;
  /** Masked source of the whole member (comments and strings blanked). */
  masked: string;
}

export interface SolContract {
  kind: ContainerKind;
  name: string;
  bases: string[];
  startLine: number;
  sigLine: number;
  endLine: number;
  natspec: string;
  members: SolMember[];
}

export interface ParsedSolidity {
  contracts: SolContract[];
  freeMembers: SolMember[];
  lines: string[];
  maskedLines: string[];
}

/** Replace comments (and optionally string literals) with spaces, preserving offsets and newlines. */
export function maskSolidity(src: string, opts: { strings: boolean } = { strings: true }): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && d === "*") {
      out[i++] = " ";
      out[i++] = " ";
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) {
        out[i++] = " ";
        out[i++] = " ";
      }
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      const blank = opts.strings;
      if (blank) out[i] = " ";
      i++;
      while (i < n && src[i] !== quote && src[i] !== "\n") {
        if (src[i] === "\\" && i + 1 < n && src[i + 1] !== "\n") {
          if (blank) out[i] = out[i + 1] = " ";
          i += 2;
          continue;
        }
        if (blank) out[i] = " ";
        i++;
      }
      if (i < n && src[i] === quote) {
        if (blank) out[i] = " ";
        i++;
      }
      continue;
    }
    i++;
  }
  return out.join("");
}

function lineIndex(src: string): number[] {
  const starts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineAt(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

function matchClose(text: string, open: number, o = "{", c = "}"): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === o) depth++;
    else if (text[i] === c) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

interface Statement {
  start: number;
  end: number;
  bodyOpen: number | null;
}

/** Split a region into top-level statements: `...;` or `... { ... }`. */
function scanStatements(masked: string, from: number, to: number): Statement[] {
  const out: Statement[] = [];
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(masked[i])) i++;
    if (i >= to) break;
    const start = i;
    let end = -1;
    let bodyOpen: number | null = null;
    if (masked.startsWith("import", start)) {
      const semi = masked.indexOf(";", start);
      end = semi === -1 || semi >= to ? to - 1 : semi;
    } else {
      let paren = 0;
      for (let j = i; j < to; j++) {
        const ch = masked[j];
        if (ch === "(") paren++;
        else if (ch === ")") paren = Math.max(0, paren - 1);
        else if (paren === 0 && ch === ";") {
          end = j;
          break;
        } else if (paren === 0 && ch === "{") {
          bodyOpen = j;
          end = Math.min(matchClose(masked, j), to - 1);
          break;
        } else if (paren === 0 && ch === "}") {
          end = j;
          break;
        }
      }
    }
    if (end < 0) end = to - 1;
    out.push({ start, end, bodyOpen });
    i = end + 1;
  }
  return out;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Read identifier tokens (with optional parenthesised args) after a function's parameter list. */
function readQualifiers(rest: string) {
  const VIS = new Set(["public", "external", "internal", "private"]);
  const MUT = new Set(["view", "pure", "payable", "constant"]);
  const SKIP = new Set(["virtual", "override", "returns"]);
  let visibility: string | null = null;
  let mutability: string | null = null;
  const modifiers: string[] = [];
  let i = 0;
  while (i < rest.length) {
    const m = /[A-Za-z_$][\w$]*/.exec(rest.slice(i));
    if (!m) break;
    const nameStart = i + m.index;
    let j = nameStart + m[0].length;
    while (j < rest.length && rest[j] === " ") j++;
    let args = "";
    if (rest[j] === "(") {
      const close = matchClose(rest, j, "(", ")");
      args = rest.slice(j, close + 1);
      j = close + 1;
    }
    const word = m[0];
    if (word === "returns") {
      i = j;
      continue;
    }
    if (VIS.has(word)) visibility = word;
    else if (MUT.has(word)) mutability = word;
    else if (!SKIP.has(word)) modifiers.push(collapse(word + args));
    i = j;
  }
  return { visibility, mutability, modifiers };
}

function parseCallable(header: string) {
  const open = header.indexOf("(");
  if (open === -1) return { visibility: null, mutability: null, modifiers: [] as string[] };
  const close = matchClose(header, open, "(", ")");
  let rest = header.slice(close + 1);
  const ret = /\breturns\s*\(/.exec(rest);
  if (ret) {
    const ro = ret.index + ret[0].length - 1;
    const rc = matchClose(rest, ro, "(", ")");
    rest = rest.slice(0, ret.index) + " " + rest.slice(rc + 1);
  }
  return readQualifiers(rest);
}

function classify(header: string): { kind: MemberKind | "container" | "skip"; name: string; containerKind?: ContainerKind } {
  let m: RegExpExecArray | null;
  if ((m = /^(abstract\s+contract|contract|library|interface)\s+([A-Za-z_$][\w$]*)/.exec(header))) {
    return { kind: "container", name: m[2], containerKind: collapse(m[1]) as ContainerKind };
  }
  if ((m = /^function\s+([A-Za-z_$][\w$]*)/.exec(header))) return { kind: "function", name: m[1] };
  if (/^function\s*\(/.test(header)) return { kind: "fallback", name: "fallback" };
  if (/^constructor\b/.test(header)) return { kind: "constructor", name: "constructor" };
  if ((m = /^modifier\s+([A-Za-z_$][\w$]*)/.exec(header))) return { kind: "modifier", name: m[1] };
  if (/^fallback\b/.test(header)) return { kind: "fallback", name: "fallback" };
  if (/^receive\b/.test(header)) return { kind: "receive", name: "receive" };
  if ((m = /^event\s+([A-Za-z_$][\w$]*)/.exec(header))) return { kind: "event", name: m[1] };
  if ((m = /^error\s+([A-Za-z_$][\w$]*)/.exec(header))) return { kind: "error", name: m[1] };
  if ((m = /^struct\s+([A-Za-z_$][\w$]*)/.exec(header))) return { kind: "struct", name: m[1] };
  if ((m = /^enum\s+([A-Za-z_$][\w$]*)/.exec(header))) return { kind: "enum", name: m[1] };
  if (/^using\b/.test(header)) return { kind: "using", name: "using" };
  if (/^(pragma|import)\b/.test(header) || header === "" || header === "}") return { kind: "skip", name: "" };
  const lhs = header.split(/=(?!>)/)[0];
  const ids = lhs.match(/[A-Za-z_$][\w$]*/g);
  return { kind: "state", name: ids ? ids[ids.length - 1] : "state" };
}

export function parseSolidity(src: string): ParsedSolidity {
  const masked = maskSolidity(src, { strings: true });
  const noComments = maskSolidity(src, { strings: false });
  const starts = lineIndex(src);
  const lines = src.split("\n");
  const maskedLines = masked.split("\n");

  // Walk upward over comment-only lines directly above a declaration.
  const leading = (sigLine: number) => {
    let top = sigLine;
    while (top > 1) {
      const idx = top - 2;
      const commentOnly = maskedLines[idx].trim() === "" && lines[idx].trim() !== "";
      if (!commentOnly) break;
      top--;
    }
    const natspec = lines
      .slice(top - 1, sigLine - 1)
      .map((l) => l.trim().replace(/^\/\*\*?|\*\/$|^\*|^\/\/\/?/g, "").trim())
      .filter(Boolean)
      .join(" ");
    return { top, natspec };
  };

  const buildMember = (st: Statement, container: string | null): SolMember | null => {
    const headerEnd = st.bodyOpen ?? st.end + 1;
    const header = collapse(masked.slice(st.start, headerEnd)).replace(/;$/, "").trim();
    const info = classify(header);
    if (info.kind === "skip" || info.kind === "container") return null;
    const sigLine = lineAt(starts, st.start);
    const { top, natspec } = leading(sigLine);
    const signature = collapse(noComments.slice(st.start, headerEnd)).replace(/;$/, "").trim();
    const callable = ["function", "modifier", "constructor", "fallback", "receive"].includes(info.kind);
    const quals = callable ? parseCallable(header) : { visibility: null, mutability: null, modifiers: [] };
    if (info.kind === "state") {
      const vis = /\b(public|internal|private)\b/.exec(header);
      quals.visibility = vis ? vis[1] : null;
    }
    return {
      kind: info.kind,
      name: info.name,
      container,
      startLine: top,
      sigLine,
      endLine: lineAt(starts, st.end),
      signature: signature.length > 400 ? signature.slice(0, 400) + " …" : signature,
      visibility: quals.visibility,
      mutability: quals.mutability,
      modifiers: quals.modifiers,
      natspec,
      hasBody: st.bodyOpen !== null && callable,
      masked: masked.slice(st.start, st.end + 1),
    };
  };

  const contracts: SolContract[] = [];
  const freeMembers: SolMember[] = [];

  for (const st of scanStatements(masked, 0, masked.length)) {
    const header = collapse(masked.slice(st.start, st.bodyOpen ?? st.end + 1));
    const info = classify(header);
    if (info.kind === "container" && st.bodyOpen !== null) {
      const sigLine = lineAt(starts, st.start);
      const { top, natspec } = leading(sigLine);
      const isClause = /\bis\b([\s\S]*)$/.exec(header);
      const bases: string[] = [];
      if (isClause) {
        let depth = 0;
        let current = "";
        for (const ch of isClause[1]) {
          if (ch === "(") depth++;
          if (ch === ")") depth--;
          if (ch === "," && depth === 0) {
            bases.push(current);
            current = "";
          } else current += ch;
        }
        bases.push(current);
      }
      const members = scanStatements(masked, st.bodyOpen + 1, st.end)
        .map((m) => buildMember(m, info.name))
        .filter((m): m is SolMember => m !== null);
      contracts.push({
        kind: info.containerKind!,
        name: info.name,
        bases: bases.map((b) => collapse(b.replace(/\([\s\S]*$/, "").replace(/\{$/, ""))).filter(Boolean),
        startLine: top,
        sigLine,
        endLine: lineAt(starts, st.end),
        natspec,
        members,
      });
    } else {
      const member = buildMember(st, null);
      if (member) freeMembers.push(member);
    }
  }

  return { contracts, freeMembers, lines, maskedLines };
}
