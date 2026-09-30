"use client";

import { AlertCircle, ArrowUp, BrainCircuit, ChevronDown, ChevronRight, Info, Square } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button, Dots, cn } from "@/components/ui";
import { fileName, lineLabel, readNdjson } from "@/lib/client";
import type { ChatEvent, SourceRef, UsageInfo } from "@/lib/types";

interface Citation {
  id: number;
  source: number;
  fileId: string;
  path: string;
  startLine: number;
  endLine: number;
  quote: string;
}

interface AnswerBlock {
  text: string;
  cites: number[];
}

interface AssistantMessage {
  role: "assistant";
  blocks: AnswerBlock[];
  citations: Citation[];
  sources: SourceRef[];
  thinking: string;
  status: string | null;
  notice: string | null;
  error: string | null;
  done: boolean;
  model: string | null;
  usage: UsageInfo | null;
  ms: number | null;
}

type Message = { role: "user"; content: string } | AssistantMessage;

type Open = (fileId: string, startLine?: number, endLine?: number) => void;

const CONTRACT_QUESTIONS = [
  "Can the owner mint new tokens or change the supply?",
  "Can anyone freeze, blacklist or pause my tokens?",
  "Is this contract upgradeable, and who controls upgrades?",
  "Are there transfer fees or trading limits the owner can change?",
  "What privileged roles exist and what can each one do?",
  "Can the owner withdraw funds held by the contract?",
];
const DOC_QUESTION = "Does the code match what the documentation claims?";

function answerMarkdown(m: AssistantMessage): string {
  return m.blocks
    .map((b) => {
      if (!b.cites.length) return b.text;
      const marks = b.cites.map((id) => `[${id}](#cite-${id})`).join("");
      return b.text.replace(/(\s*)$/, ` ${marks}$1`);
    })
    .join("");
}

function CiteChip({ citation, onOpen }: { citation: Citation | undefined; onOpen: Open }) {
  if (!citation) return null;
  return (
    <span className="group relative inline-block align-baseline">
      <button
        type="button"
        onClick={() => onOpen(citation.fileId, citation.startLine, citation.endLine)}
        className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-accent-soft px-1 text-[11px] font-semibold text-accent hover:bg-accent hover:text-accent-fg"
        aria-label={`Source ${citation.id}: ${citation.path} ${lineLabel(citation.startLine, citation.endLine)}`}
      >
        {citation.id}
      </button>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden w-80 max-w-[80vw] -translate-x-1/2 rounded-lg border border-border bg-panel p-2 text-left shadow-lg group-hover:block">
        <span className="block font-mono text-[11px] text-accent">
          {fileName(citation.path)} · {lineLabel(citation.startLine, citation.endLine)}
        </span>
        <span className="mt-1 line-clamp-6 block whitespace-pre-wrap font-mono text-[11px] leading-snug text-muted">{citation.quote}</span>
      </span>
    </span>
  );
}

const AnswerBody = memo(function AnswerBody({ message, onOpen }: { message: AssistantMessage; onOpen: Open }) {
  const md = answerMarkdown(message);
  const byId = useMemo(() => new Map(message.citations.map((c) => [c.id, c])), [message.citations]);
  return (
    <div className="answer">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ href, children }) {
            const m = /^#cite-(\d+)$/.exec(href ?? "");
            if (m) return <CiteChip citation={byId.get(Number(m[1]))} onOpen={onOpen} />;
            return (
              <a href={href} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-2">
                {children}
              </a>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
});

function AssistantBubble({ message, onOpen }: { message: AssistantMessage; onOpen: Open }) {
  const [showSources, setShowSources] = useState(false);
  const [showThinking, setShowThinking] = useState(false);
  const hasText = message.blocks.some((b) => b.text.trim());
  const thinkingLive = !message.done && !hasText && message.thinking;

  return (
    <div className="flex flex-col gap-2">
      {message.thinking && (
        <div className="text-[12.5px]">
          <button onClick={() => setShowThinking((v) => !v)} className="inline-flex items-center gap-1 text-muted hover:text-text">
            <BrainCircuit className="size-3.5" />
            {thinkingLive ? "Reasoning…" : "Reasoning summary"}
            {showThinking || thinkingLive ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </button>
          {(showThinking || thinkingLive) && (
            <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 text-muted scroll-thin">{message.thinking}</p>
          )}
        </div>
      )}

      {!hasText && !message.done && !message.error && (
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <Dots /> {message.status ?? "Working…"}
        </div>
      )}

      {hasText && <AnswerBody message={message} onOpen={onOpen} />}

      {message.notice && (
        <p className="flex items-center gap-1.5 text-[12.5px] text-muted">
          <Info className="size-3.5" /> {message.notice}
        </p>
      )}
      {message.error && (
        <p className="flex items-start gap-1.5 rounded-lg bg-high-soft px-3 py-2 text-[13px] text-high">
          <AlertCircle className="mt-0.5 size-4 shrink-0" /> {message.error}
        </p>
      )}

      {message.sources.length > 0 && (
        <div className="text-[12.5px]">
          <button onClick={() => setShowSources((v) => !v)} className="inline-flex items-center gap-1 text-muted hover:text-text">
            {showSources || (!message.model && message.done) ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {message.sources.length} retrieved passages
            {message.done && message.model && message.usage && (
              <span className="ml-1 opacity-70">
                · {message.usage.inputTokens.toLocaleString()} in / {message.usage.outputTokens.toLocaleString()} out
                {message.ms ? ` · ${(message.ms / 1000).toFixed(1)}s` : ""}
              </span>
            )}
          </button>
          {(showSources || (!message.model && message.done)) && (
            <ol className="mt-1.5 flex flex-col gap-1">
              {message.sources.map((s) => (
                <li key={s.chunkId}>
                  <button
                    onClick={() => onOpen(s.fileId, s.startLine, s.endLine)}
                    className="flex w-full items-center gap-2 rounded-md border border-border bg-panel px-2 py-1.5 text-left hover:border-accent/50"
                  >
                    <span className="w-6 shrink-0 font-mono text-[11px] text-muted">S{s.n}</span>
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-mono text-[12px]">{fileName(s.path)}</span>
                      {s.symbol && <span className="text-muted"> · {s.symbol}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted">{lineLabel(s.startLine, s.endLine)}</span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatPanel({
  workspaceId,
  hasDocs,
  hasSources,
  onOpen,
}: {
  workspaceId: string;
  hasDocs: boolean;
  hasSources: boolean;
  onOpen: Open;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const suggestions = hasDocs ? [DOC_QUESTION, ...CONTRACT_QUESTIONS.slice(0, 5)] : CONTRACT_QUESTIONS;

  function update(fn: (m: AssistantMessage) => AssistantMessage) {
    setMessages((all) => {
      const last = all[all.length - 1];
      if (!last || last.role !== "assistant") return all;
      return [...all.slice(0, -1), fn(last)];
    });
  }

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = messages
      .filter((m) => m.role === "user" || (m.done && !m.error && m.blocks.length))
      .map((m) => (m.role === "user" ? { role: "user" as const, content: m.content } : { role: "assistant" as const, content: m.blocks.map((b) => b.text).join("") }));
    // Keep strict user/assistant alternation for the API.
    const turns: Array<{ role: "user" | "assistant"; content: string }> = [];
    for (const t of history) {
      if (turns.length && turns[turns.length - 1].role === t.role) turns[turns.length - 1] = t;
      else turns.push(t);
    }
    if (turns.length && turns[turns.length - 1].role === "user") turns.pop();
    turns.push({ role: "user", content: q });

    const started = performance.now();
    setMessages((m) => [
      ...m,
      { role: "user", content: q },
      { role: "assistant", blocks: [], citations: [], sources: [], thinking: "", status: null, notice: null, error: null, done: false, model: null, usage: null, ms: null },
    ]);
    setInput("");
    setBusy(true);
    pinned.current = true;
    const controller = new AbortController();
    abort.current = controller;

    let sources: SourceRef[] = [];
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: turns }),
        signal: controller.signal,
      });
      await readNdjson<ChatEvent>(res, (e) => {
        switch (e.type) {
          case "sources":
            sources = e.sources;
            update((m) => ({ ...m, sources: e.sources }));
            break;
          case "status":
            update((m) => ({ ...m, status: e.message }));
            break;
          case "thinking":
            update((m) => ({ ...m, thinking: m.thinking + e.text }));
            break;
          case "block":
            update((m) => ({ ...m, blocks: [...m.blocks, { text: "", cites: [] }] }));
            break;
          case "text":
            update((m) => {
              const blocks = m.blocks.length ? [...m.blocks] : [{ text: "", cites: [] }];
              const last = blocks[blocks.length - 1];
              blocks[blocks.length - 1] = { ...last, text: last.text + e.text };
              return { ...m, blocks };
            });
            break;
          case "cite":
            update((m) => {
              const src = sources.find((s) => s.n === e.source);
              if (!src) return m;
              let c = m.citations.find((x) => x.source === e.source && x.startLine === e.startLine && x.endLine === e.endLine);
              const citations = [...m.citations];
              if (!c) {
                c = { id: citations.length + 1, source: e.source, fileId: src.fileId, path: src.path, startLine: e.startLine, endLine: e.endLine, quote: e.quote };
                citations.push(c);
              }
              const blocks = m.blocks.length ? [...m.blocks] : [{ text: "", cites: [] }];
              const last = blocks[blocks.length - 1];
              if (!last.cites.includes(c.id)) blocks[blocks.length - 1] = { ...last, cites: [...last.cites, c.id] };
              return { ...m, citations, blocks };
            });
            break;
          case "notice":
            update((m) => ({ ...m, notice: e.message }));
            break;
          case "error":
            update((m) => ({ ...m, error: e.message }));
            break;
          case "done":
            update((m) => ({ ...m, done: true, model: e.model, usage: e.usage, ms: performance.now() - started }));
            break;
        }
      });
    } catch (err) {
      if (!controller.signal.aborted) update((m) => ({ ...m, error: err instanceof Error ? err.message : "Request failed" }));
    } finally {
      update((m) => ({ ...m, done: true, status: null }));
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="min-h-0 flex-1 overflow-y-auto scroll-thin"
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {messages.length === 0 && (
            <div className="flex flex-col gap-4 pt-4 sm:pt-10">
              <div>
                <h2 className="text-xl font-semibold tracking-tight">Ask anything about these contracts</h2>
                <p className="mt-1 text-[14px] text-muted">
                  Answers come only from the indexed code{hasDocs ? " and documents" : ""}. Numbers like{" "}
                  <span className="rounded-md bg-accent-soft px-1 text-[11px] font-semibold text-accent">1</span> link to the exact lines.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    disabled={!hasSources}
                    onClick={() => void ask(s)}
                    className="rounded-xl border border-border bg-panel px-3 py-2.5 text-left text-[13.5px] hover:border-accent/50 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className="self-end rounded-2xl rounded-br-md bg-accent-soft px-3.5 py-2 text-[14.5px] text-text">
                {m.content}
              </div>
            ) : (
              <AssistantBubble key={i} message={m} onOpen={onOpen} />
            ),
          )}
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="shrink-0 border-t border-border bg-bg px-4 py-3"
      >
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-border bg-panel p-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void ask(input);
              }
            }}
            rows={1}
            placeholder={hasSources ? "Ask about owner powers, fees, upgrades…" : "Add a source first"}
            disabled={!hasSources}
            className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-[14.5px] outline-none placeholder:text-muted field-sizing-content"
          />
          {busy ? (
            <Button type="button" size="sm" className="size-9 rounded-xl p-0" onClick={() => abort.current?.abort()} aria-label="Stop">
              <Square className="size-3.5 fill-current" />
            </Button>
          ) : (
            <Button type="submit" variant="primary" size="sm" className={cn("size-9 rounded-xl p-0")} disabled={!input.trim() || !hasSources} aria-label="Send">
              <ArrowUp className="size-4" />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}
