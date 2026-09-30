import type Anthropic from "@anthropic-ai/sdk";
import { config, hasAnthropicKey } from "@/lib/config";
import { describeApiError, fallbackOptions, getClient } from "@/lib/llm/client";
import { CHAT_SYSTEM_PROMPT } from "@/lib/llm/prompts";
import { hybridSearch } from "@/lib/retrieval";
import type { ChatEvent, ChatTurn, RetrievedChunk, SourceRef } from "@/lib/types";

type Send = (e: ChatEvent) => void;

const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 4000;

/** Follow-ups like "and who can call it?" retrieve better with the previous question attached. */
export function retrievalQuery(turns: ChatTurn[]): string {
  const users = turns.filter((t) => t.role === "user").map((t) => t.content.trim());
  const current = users[users.length - 1] ?? "";
  const previous = users[users.length - 2];
  return previous && current.split(/\s+/).length < 12 ? `${previous}\n${current}` : current;
}

export function citationTitle(c: RetrievedChunk): string {
  const what = c.symbol ? ` · ${c.symbol}` : "";
  return `${c.path}${what} (lines ${c.startLine}-${c.endLine})`;
}

/** Map a search-result citation (block range) back to file lines. */
export function citedLines(chunk: RetrievedChunk, startBlock: number, endBlock: number) {
  const first = chunk.blocks[Math.max(0, Math.min(startBlock, chunk.blocks.length - 1))];
  const last = chunk.blocks[Math.max(0, Math.min(endBlock - 1, chunk.blocks.length - 1))];
  return { startLine: first?.s ?? chunk.startLine, endLine: Math.max(last?.e ?? chunk.endLine, first?.s ?? chunk.startLine) };
}

function toSearchResult(chunk: RetrievedChunk, n: number): Anthropic.Beta.BetaSearchResultBlockParam {
  return {
    type: "search_result",
    source: `S${n} ${chunk.path}#L${chunk.startLine}-L${chunk.endLine}`,
    title: citationTitle(chunk),
    content: chunk.blocks.map((b) => ({ type: "text" as const, text: b.t })),
    citations: { enabled: true },
  };
}

export async function streamAnswer(opts: {
  workspaceId: string;
  turns: ChatTurn[];
  send: Send;
  signal: AbortSignal;
}): Promise<void> {
  const { workspaceId, send, signal } = opts;
  const turns = opts.turns.slice(-(MAX_HISTORY_TURNS * 2 + 1)).map((t) => ({ ...t, content: t.content.slice(0, MAX_TURN_CHARS) }));
  const question = turns[turns.length - 1]?.content ?? "";

  send({ type: "status", message: "Searching the indexed code and documents…" });
  const chunks = await hybridSearch(workspaceId, retrievalQuery(turns));
  const sources: SourceRef[] = chunks.map((c, i) => ({
    n: i + 1,
    chunkId: c.id,
    fileId: c.fileId,
    path: c.path,
    symbol: c.symbol,
    startLine: c.startLine,
    endLine: c.endLine,
    score: c.score,
  }));
  send({ type: "sources", sources });

  if (!chunks.length) {
    send({ type: "block" });
    send({ type: "text", text: "Nothing is indexed in this workspace yet. Add a contract address, some Solidity or a document first." });
    send({ type: "done", model: null, usage: null });
    return;
  }
  if (!hasAnthropicKey()) {
    send({ type: "block" });
    send({
      type: "text",
      text: "**Retrieval-only mode.** No `ANTHROPIC_API_KEY` is configured, so here are the most relevant passages instead of a written answer. Open them in the code viewer, or add a key to `.env.local` to get cited answers.",
    });
    send({ type: "done", model: null, usage: null });
    return;
  }

  // Earlier turns go back as plain text (append-only history); only the new turn carries search results.
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...turns.slice(0, -1).map((t) => ({ role: t.role, content: t.content })),
    {
      role: "user",
      content: [
        ...chunks.map((c, i) => toSearchResult(c, i + 1)),
        { type: "text", text: question },
      ],
    },
  ];

  send({ type: "status", message: `${chunks.length} passages retrieved — Claude is reading them…` });
  const client = getClient();
  try {
    const stream = client.beta.messages.stream(
      {
        model: config.model,
        max_tokens: 32000,
        thinking: { type: "adaptive", display: "summarized" },
        output_config: { effort: config.chatEffort },
        system: [{ type: "text", text: CHAT_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
        ...fallbackOptions(),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_start") {
        const block = event.content_block;
        if (block.type === "text") send({ type: "block" });
        else if (block.type === "fallback") send({ type: "notice", message: `Answered by fallback model ${block.to.model}` });
      } else if (event.type === "content_block_delta") {
        const delta = event.delta;
        if (delta.type === "text_delta") send({ type: "text", text: delta.text });
        else if (delta.type === "thinking_delta" && delta.thinking) send({ type: "thinking", text: delta.thinking });
        else if (delta.type === "citations_delta" && delta.citation.type === "search_result_location") {
          const c = delta.citation;
          const chunk = chunks[c.search_result_index];
          if (chunk) {
            send({
              type: "cite",
              source: c.search_result_index + 1,
              ...citedLines(chunk, c.start_block_index, c.end_block_index),
              quote: c.cited_text.slice(0, 600),
            });
          }
        }
      }
    }

    const final = await stream.finalMessage();
    if (final.stop_reason === "refusal") {
      send({ type: "error", message: "Claude declined to answer this question." });
    } else if (final.stop_reason === "max_tokens") {
      send({ type: "notice", message: "The answer was cut off at the token limit." });
    }
    send({
      type: "done",
      model: final.model,
      usage: {
        inputTokens: final.usage.input_tokens,
        outputTokens: final.usage.output_tokens,
        cacheReadTokens: final.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: final.usage.cache_creation_input_tokens ?? 0,
      },
    });
  } catch (err) {
    if (signal.aborted) return;
    send({ type: "error", message: describeApiError(err) });
  }
}
