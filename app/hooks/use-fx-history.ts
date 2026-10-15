import { useEffect, useState } from "react";

import { nyDay } from "~/lib/candles";
import { BASE_CURRENCY } from "~/lib/currency";
import { FxHistoryResponseSchema, rateOnDay } from "~/lib/fx-history";

export type FxHistoryState =
  | { status: "loading" }
  /**
   * `rateOn(day)`: `quote` per 1 USD in force that day (the previous business day's on a weekend),
   * null when the ECB published none near that day.
   */
  | { status: "ready"; quote: string; rateOn: (day: string) => number | null }
  | { status: "error"; message: string };

const USD: FxHistoryState = { status: "ready", quote: BASE_CURRENCY, rateOn: () => 1 };

/** The ECB publishes once per business day; reload after this or once the New York day changes. */
const FRESH_FOR_MS = 6 * 60 * 60 * 1000;

// One request per currency and start date while fresh, so switching tabs doesn't refetch.
const requests = new Map<string, { request: Promise<FxHistoryState>; at: number }>();

function load(quote: string, from: string): Promise<FxHistoryState> {
  const key = `${quote}:${from}`;
  const now = Date.now();
  const cached = requests.get(key);
  if (cached && now - cached.at < FRESH_FOR_MS && nyDay(cached.at) === nyDay(now)) {
    return cached.request;
  }
  const params = new URLSearchParams({ quote, from });
  const request = fetch(`/api/fx/history?${params}`)
    .then(async (response): Promise<FxHistoryState> => {
      const parsed = FxHistoryResponseSchema.safeParse(await response.json());
      if (!parsed.success) {
        return {
          status: "error",
          message: "Past exchange rates came back in an unexpected format.",
        };
      }
      if (!parsed.data.ok) return { status: "error", message: parsed.data.error.message };
      const rateOn = rateOnDay(parsed.data.rates);
      return rateOn
        ? { status: "ready", quote, rateOn }
        : { status: "error", message: `No past ${quote} rates are available.` };
    })
    .then((state) => {
      // Let a later render retry after a failure (the server backs off upstream on its own).
      if (state.status === "error") requests.delete(key);
      return state;
    })
    .catch((): FxHistoryState => {
      requests.delete(key);
      return { status: "error", message: "Couldn't reach the Krestrel server for exchange rates." };
    });
  requests.set(key, { request, at: now });
  return request;
}

/**
 * Daily ECB rates for `quote` from `from` (the earliest trade or dividend) on, from
 * GET /api/fx/history (ADR 0027). USD, or nothing to convert (`from` null), needs no request.
 */
export function useFxHistory(quote: string, from: string | null): FxHistoryState {
  const key = quote === BASE_CURRENCY || from === null ? null : `${quote}:${from}`;
  const [loaded, setLoaded] = useState<{ key: string; state: FxHistoryState } | null>(null);

  useEffect(() => {
    if (key === null || from === null) return;
    let active = true;
    void load(quote, from).then((state) => {
      if (active) setLoaded({ key, state });
    });
    return () => {
      active = false;
    };
  }, [key, quote, from]);

  if (key === null) return USD;
  // Only for the currency and start asked about: a switch never shows the previous rates.
  return loaded?.key === key ? loaded.state : { status: "loading" };
}
