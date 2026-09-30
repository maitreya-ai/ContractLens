/** Browser helpers (no server imports). */

export async function readNdjson<E>(res: Response, onEvent: (event: E) => void): Promise<void> {
  if (!res.ok || !res.body) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) onEvent(JSON.parse(line) as E);
    }
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer) as E);
}

export function shortAddress(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "";
}

export function lineLabel(start: number, end: number): string {
  return start === end ? `L${start}` : `L${start}–${end}`;
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(iso).toLocaleDateString();
}

export interface ViewerTarget {
  fileId: string;
  startLine?: number;
  endLine?: number;
  /** Changes on every open so re-clicking the same citation scrolls again. */
  nonce: number;
}
