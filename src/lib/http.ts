import { UserError } from "@/lib/sources/verified";

/** Stream newline-delimited JSON events to the browser. */
export function ndjson<E extends object>(run: (send: (event: E) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: E) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          open = false; // client went away
        }
      };
      try {
        await run(send);
      } catch (err) {
        send({ type: "error", message: publicMessage(err) } as unknown as E);
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

export function publicMessage(err: unknown): string {
  if (err instanceof UserError) return err.message;
  if (err instanceof Error) {
    console.error(err);
    return err.message.length < 300 ? err.message : "Something went wrong. Check the server logs.";
  }
  return "Something went wrong.";
}

export function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}
