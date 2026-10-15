import { useEffect, useMemo, useState } from "react";
import * as z from "zod";

import type { DividendPayment } from "~/lib/dividends";
import {
  type DividendOverride,
  type DividendOverrideKey,
  DividendOverrideResultSchema,
  DividendsReceivedResponseSchema,
  type ReceivedDividend,
  receivedDividends,
} from "~/lib/dividends-received";
import { HISTORY_START } from "~/lib/history-start";
import type { Trade } from "~/lib/portfolio";

import { createStoredValue } from "./stored-value";

const WithholdingSchema = z.coerce.number().min(0).max(100);

// Percent of each dividend taken at source; one setting for all portfolios, kept in this browser.
const storedWithholding = createStoredValue(
  "krestrel.dividendWithholding",
  0,
  (raw) => {
    const parsed = WithholdingSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  },
  String,
);

export interface DividendsReceivedState {
  /** Payouts already paid since the first trade, oldest first; undefined while loading. */
  received: ReceivedDividend[] | undefined;
  error: string | null;
  /** Percent 0–100, stored in this browser (default 0). */
  withholding: number;
  setWithholding: (percent: number) => void;
  /** Saves the cash actually received for one payout (USD); null goes back to the worked-out amount. */
  setOverride: (key: DividendOverrideKey, amount: number | null) => void;
}

interface Loaded {
  key: string;
  today: string;
  payouts: Record<string, DividendPayment[]>;
  overrides: DividendOverride[];
  /** Symbols whose history the provider couldn't give. */
  missing: string[];
}

/**
 * Dividends the portfolios in view received (ADR 0025): payouts since their first trade (no
 * earlier than `HISTORY_START`) from GET /api/dividends-received, worked out from `trades` per
 * portfolio, the owner's withholding rate and their saved corrections. Corrections apply at once
 * and are undone if saving fails. While `enabled` is false (default true) nothing is requested;
 * what was loaded stays, so enabling again for the same trades reuses it.
 */
export function useDividendsReceived(input: {
  portfolioIds: readonly string[];
  trades: readonly Trade[];
  enabled?: boolean;
}): DividendsReceivedState {
  const { trades, enabled = true } = input;
  const [withholding, storeWithholding] = storedWithholding.use();
  const symbols = [...new Set(trades.map((trade) => trade.symbol))].sort();
  const firstTrade = trades.reduce<string | null>(
    (first, trade) => (first === null || trade.tradedOn < first ? trade.tradedOn : first),
    null,
  );
  const from = firstTrade && firstTrade < HISTORY_START ? HISTORY_START : firstTrade;
  const ids = [...new Set(input.portfolioIds)].sort().join(",");
  const key = symbols.length > 0 && ids && from ? `${ids}|${symbols.join(",")}|${from}` : "";
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const loadedKey = loaded?.key;

  useEffect(() => {
    if (!enabled || !key || loadedKey === key) return;
    const [portfolios = "", list = "", since = ""] = key.split("|");
    const abort = new AbortController();
    const params = new URLSearchParams({ symbols: list, portfolios, from: since });
    void fetch(`/api/dividends-received?${params}`, { signal: abort.signal })
      .then(async (response) => {
        const parsed = DividendsReceivedResponseSchema.safeParse(await response.json());
        if (!parsed.success) {
          setFailed({ key, message: "Dividend history came back in an unexpected format." });
        } else if (!parsed.data.ok) {
          setFailed({ key, message: parsed.data.error.message });
        } else {
          const { today, payouts, overrides } = parsed.data;
          const missing = list.split(",").filter((symbol) => !(symbol in payouts));
          setLoaded({ key, today, payouts, overrides, missing });
        }
      })
      .catch(() => {
        if (abort.signal.aborted) return;
        setFailed({ key, message: "Couldn't reach the Krestrel server for dividend history." });
      });
    return () => abort.abort();
  }, [enabled, key, loadedKey]);

  const current = loaded?.key === key ? loaded : null;
  const received = useMemo(
    () =>
      current &&
      receivedDividends({
        payouts: current.payouts,
        trades,
        overrides: current.overrides,
        withholding,
        today: current.today,
      }),
    [current, trades, withholding],
  );

  const setOverride = (target: DividendOverrideKey, amount: number | null) => {
    const same = (override: DividendOverride) =>
      override.portfolioId === target.portfolioId &&
      override.symbol === target.symbol &&
      override.exDate === target.exDate;
    const replace = (replacement: DividendOverride | undefined) =>
      setLoaded(
        (state) =>
          state && {
            ...state,
            overrides: [
              ...state.overrides.filter((override) => !same(override)),
              ...(replacement ? [replacement] : []),
            ],
          },
      );
    const before = loaded?.overrides.find(same);
    replace(amount === null ? undefined : { ...target, amount });
    setSaveError(null);
    const undo = (message: string) => {
      replace(before);
      setSaveError(message);
    };
    void fetch("/api/dividends-received", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        amount === null ? { intent: "clear", ...target } : { intent: "set", ...target, amount },
      ),
    })
      .then(async (response) => {
        const parsed = DividendOverrideResultSchema.safeParse(await response.json());
        if (!parsed.success) undo("Saving the amount failed. Try again.");
        else if (!parsed.data.ok) undo(parsed.data.error.message);
      })
      .catch(() => undo("Couldn't reach the Krestrel server. The amount wasn't saved."));
  };

  const missing = current?.missing ?? [];
  return {
    received: key ? (received ?? undefined) : [],
    error:
      (failed?.key === key ? failed.message : null) ??
      saveError ??
      (missing.length > 0
        ? `Dividend history for ${missing.join(", ")} is unavailable right now, so those payments are missing. Reload the page to try again.`
        : null),
    withholding,
    setWithholding: (percent) => storeWithholding(Math.min(100, Math.max(0, percent))),
    setOverride,
  };
}
