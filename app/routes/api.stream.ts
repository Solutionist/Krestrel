import { getMarketHub } from "~/.server/market/instance";
import { HEARTBEAT_MS, type StreamEvent } from "~/lib/stream-events";

import type { Route } from "./+types/api.stream";

const encoder = new TextEncoder();

function frame(message: StreamEvent): Uint8Array {
  return encoder.encode(`event: ${message.event}\ndata: ${JSON.stringify(message.data)}\n\n`);
}

/**
 * Server-Sent Events (ADR 0002). Sends a `snapshot` first, then live hub events, plus a `: ping`
 * comment every 15 s. Listener and timer are released when the client disconnects.
 */
export function loader({ request }: Route.LoaderArgs) {
  const hub = getMarketHub();
  let release = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true;
      const send = (bytes: Uint8Array) => {
        if (open) controller.enqueue(bytes);
      };

      release = () => {
        if (!open) return;
        open = false;
        unsubscribe();
        clearInterval(heartbeat);
        request.signal.removeEventListener("abort", release);
        try {
          controller.close();
        } catch {
          // Already closed by the runtime after the client went away.
        }
      };

      send(frame({ event: "snapshot", data: hub.snapshot() }));
      const unsubscribe = hub.on((message) => {
        if (message.event === "shutdown") release();
        else send(frame(message));
      });
      const heartbeat = setInterval(() => send(encoder.encode(": ping\n\n")), HEARTBEAT_MS);
      request.signal.addEventListener("abort", release, { once: true });
    },
    cancel() {
      release();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // no-transform: stops compression middleware (react-router-serve) from buffering events.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
