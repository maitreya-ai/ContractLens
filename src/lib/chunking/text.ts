import { detectInjection, SIGNAL_INFO } from "@/lib/analysis/detectors";
import { linesToBlocks } from "@/lib/chunking/shared";
import type { DraftChunk, DraftSignal } from "@/lib/types";

const TARGET_CHARS = 1400;

interface Section {
  path: string[];
  start: number;
  end: number;
}

/** Split markdown / plain text (including extracted PDF text) into heading-aware sections. */
function sections(lines: string[]): Section[] {
  const out: Section[] = [];
  const stack: Array<{ level: number; title: string }> = [];
  let current: Section = { path: [], start: 1, end: 0 };
  lines.forEach((line, i) => {
    const n = i + 1;
    const md = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    const page = /^\[Page (\d+)\]$/.exec(line.trim());
    if (md || page) {
      if (current.end >= current.start) out.push(current);
      if (md) {
        const level = md[1].length;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        stack.push({ level, title: md[2] });
      } else {
        stack.length = 0;
        stack.push({ level: 0, title: `Page ${page![1]}` });
      }
      current = { path: stack.map((s) => s.title), start: n, end: n };
    } else {
      current.end = n;
    }
  });
  if (current.end >= current.start) out.push(current);
  return out;
}

export function chunkText(path: string, title: string, src: string): { chunks: DraftChunk[]; signals: DraftSignal[] } {
  const lines = src.split("\n");
  const signals = detectInjection(lines);
  const chunks: DraftChunk[] = [];

  for (const sec of sections(lines)) {
    // Group paragraphs until the chunk reaches the target size.
    let start = sec.start;
    let size = 0;
    const flush = (end: number) => {
      if (end < start) return;
      const slice = lines.slice(start - 1, end);
      const hasBody = slice.some((l) => l.trim() && !/^#{1,6}\s/.test(l) && !/^\[Page \d+\]$/.test(l.trim()));
      if (!hasBody) {
        start = end + 1;
        size = 0;
        return;
      }
      const blocks = linesToBlocks(slice, start);
      const content = blocks.map((b) => b.t).join("\n");
      const heading = sec.path.join(" > ");
      const tags = [...new Set(signals.filter((s) => s.line >= start && s.line <= end).map((s) => s.kind))];
      chunks.push({
        kind: "section",
        symbol: heading || null,
        container: title,
        startLine: start,
        endLine: end,
        content,
        blocks,
        tags,
        embedText: [`Document "${title}"${heading ? `, section: ${heading}` : ""}.`, content].join("\n"),
        searchText: [path, title, heading, tags.map((t) => SIGNAL_INFO[t].phrase).join(" "), content].join("\n"),
      });
      start = end + 1;
      size = 0;
    };
    for (let n = sec.start; n <= sec.end; n++) {
      size += lines[n - 1].length + 1;
      const paragraphEnd = n === sec.end || lines[n].trim() === "";
      if (size >= TARGET_CHARS && paragraphEnd) flush(n);
      else if (size >= TARGET_CHARS * 2) flush(n);
    }
    flush(sec.end);
  }
  return { chunks, signals };
}
