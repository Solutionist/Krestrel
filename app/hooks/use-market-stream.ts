import { useCallback, useEffect, useRef, useState } from "react";

import type { Bar, QuoteSnapshot, Tick } from "~/lib/market";
import {
  type SnapshotPayload,
  STREAM_EVENT_SCHEMAS,
  type StreamEventName,
  type StreamEventPayload,
} from "~/lib/stream-events";

/** Browser ↔ Krestrel server SSE link state (separate from the upstream provider status). */
export type LinkState = "connecting" | "open" | "lost";

export interface MarketState extends Omit<SnapshotPayload, "quotes"> {
  quotes: Record<string, QuoteSnapshot>;
  link: LinkState;
  /** Bumped when the server finishes downloading history for a symbol; charts reload on change. */
  historyVersion: Record<string, number>;
}

export type LiveEvent = { event: "tick"; data: Tick } | { event: "bar"; data: Bar };
export type LiveListener = (event: LiveEvent) => void;

function fromSnapshot(
  snapshot: SnapshotPayload,
  link: LinkState,
  historyVersion: Record<string, number> = {},
): MarketState {
  return {
    ...snapshot,
    quotes: Object.fromEntries(snapshot.quotes.map((quote) => [quote.symbol, quote])),
    link,
    historyVersion,
  };
}

/**
 * Subscribes to `/api/stream`. React state (quotes, status, watchlist) updates at most once per
 * animation frame; ticks and bars are also delivered synchronously to `onLive` listeners (the
 * chart) so they never cause a React re-render.
 */
export function useMarketStream(initial: SnapshotPayload) {
  const [state, setState] = useState<MarketState>(() => fromSnapshot(initial, "connecting"));
  const listeners = useRef(new Set<LiveListener>());

  useEffect(() => {
    const source = new EventSource("/api/stream");
    const pendingTicks = new Map<string, Tick>();
    let frame = 0;

    const flushTicks = () => {
      frame = 0;
      const ticks = [...pendingTicks.values()];
      pendingTicks.clear();
      setState((current) => {
        const quotes = { ...current.quotes };
        for (const tick of ticks) {
          const quote = quotes[tick.symbol];
          if (quote) quotes[tick.symbol] = { ...quote, lastPrice: tick.price, lastTs: tick.ts };
        }
        return { ...current, quotes };
      });
    };

    function on<E extends StreamEventName>(name: E, handle: (data: StreamEventPayload<E>) => void) {
      source.addEventListener(name, (message) => {
        const parsed = STREAM_EVENT_SCHEMAS[name].safeParse(JSON.parse(message.data));
        if (parsed.success) handle(parsed.data as StreamEventPayload<E>);
      });
    }

    on("snapshot", (snapshot) =>
      setState((current) => fromSnapshot(snapshot, "open", current.historyVersion)),
    );
    on("history", ({ symbols }) =>
      setState((current) => {
        const historyVersion = { ...current.historyVersion };
        for (const symbol of symbols) historyVersion[symbol] = (historyVersion[symbol] ?? 0) + 1;
        return { ...current, historyVersion };
      }),
    );
    on("tick", (tick) => {
      for (const listener of listeners.current) listener({ event: "tick", data: tick });
      pendingTicks.set(tick.symbol, tick);
      frame ||= requestAnimationFrame(flushTicks);
    });
    on("bar", (bar) => {
      for (const listener of listeners.current) listener({ event: "bar", data: bar });
    });
    on("status", (status) => setState((current) => ({ ...current, status })));
    on("market", (clock) => setState((current) => ({ ...current, clock })));
    on("quote", (quote) =>
      setState((current) => ({ ...current, quotes: { ...current.quotes, [quote.symbol]: quote } })),
    );
    on("watchlist", ({ symbols }) =>
      setState((current) => ({
        ...current,
        watchlist: symbols,
        quotes: Object.fromEntries(
          symbols.map((symbol) => [
            symbol,
            current.quotes[symbol] ?? {
              symbol,
              lastPrice: null,
              lastTs: null,
              previousClose: null,
            },
          ]),
        ),
      })),
    );

    source.onopen = () => setState((current) => ({ ...current, link: "open" }));
    // EventSource reconnects by itself; the server re-sends a full snapshot on reconnect.
    source.onerror = () => setState((current) => ({ ...current, link: "lost" }));

    return () => {
      cancelAnimationFrame(frame);
      source.close();
    };
  }, []);

  const onLive = useCallback((listener: LiveListener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { state, onLive };
}
