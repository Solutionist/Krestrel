import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";

import {
  type HoldingsGrouping,
  MAX_CLASSIFY_SYMBOLS,
  needsClassifying,
  type StockProfile,
  type StockProfileResult,
} from "~/lib/stock-profile";

import { useAiChoice } from "./use-ai";

const ACTION = "/api/stock-profiles";

export interface StockProfilesState {
  profiles: Readonly<Record<string, StockProfile>>;
  /** Tickers the chosen AI is classifying right now. */
  classifying: number;
  error: string | null;
  retry: () => void;
  reclassify: (symbol: string, change: Partial<Pick<StockProfile, "sector" | "style">>) => void;
}

/**
 * Sector and type for the given holdings (ADR 0019). While grouping is on, tickers without a
 * profile are sent to the local model once per page visit (Try again re-asks after an error);
 * corrections are saved for good and shown at once.
 */
export function useStockProfiles(
  saved: readonly StockProfile[],
  symbols: readonly string[],
  grouping: HoldingsGrouping,
): StockProfilesState {
  const classifier = useFetcher<StockProfileResult>();
  const corrector = useFetcher<StockProfileResult>();
  const asked = useRef(new Set<string>());
  const [corrections, setCorrections] = useState<Record<string, StockProfile>>({});
  /** A correction was sent and hasn't settled yet (a newer one aborts and replaces an older one). */
  const correctionPending = useRef(false);

  const profiles = useMemo(() => {
    const bySymbol: Record<string, StockProfile> = {};
    for (const profile of saved) bySymbol[profile.symbol] = profile;
    return { ...bySymbol, ...corrections };
  }, [saved, corrections]);

  // A stable key, so the effect runs when the set of unclassified tickers changes.
  const unclassified =
    grouping === "none"
      ? ""
      : symbols.filter((symbol) => needsClassifying(profiles[symbol])).join(",");
  const { submit: classify, state: classifyState } = classifier;
  const { choice: groupingAi } = useAiChoice("grouping");

  /** Sends tickers not yet asked about this visit (at most one request's worth). */
  const ask = useCallback(
    (candidates: readonly string[]) => {
      const batch = candidates
        .filter((symbol) => !asked.current.has(symbol))
        .slice(0, MAX_CLASSIFY_SYMBOLS);
      if (batch.length === 0) return;
      for (const symbol of batch) asked.current.add(symbol);
      classify(
        { intent: "classify", symbols: batch, ai: groupingAi },
        { method: "post", action: ACTION, encType: "application/json" },
      );
    },
    [classify, groupingAi],
  );

  useEffect(() => {
    if (classifyState === "idle" && unclassified !== "") ask(unclassified.split(","));
  }, [ask, classifyState, unclassified]);

  const retry = useCallback(() => {
    asked.current.clear();
    if (unclassified !== "") ask(unclassified.split(","));
  }, [ask, unclassified]);

  const { submit: correct } = corrector;
  const reclassify = useCallback(
    (symbol: string, change: Partial<Pick<StockProfile, "sector" | "style">>) => {
      const current = profiles[symbol];
      const next: StockProfile = {
        symbol,
        sector: "sector" in change ? (change.sector ?? null) : (current?.sector ?? null),
        style: "style" in change ? (change.style ?? null) : (current?.style ?? null),
        source: "owner",
      };
      setCorrections((previous) => ({ ...previous, [symbol]: next }));
      correctionPending.current = true;
      correct(
        { intent: "set", symbol, sector: next.sector, style: next.style },
        { method: "post", action: ACTION, encType: "application/json" },
      );
    },
    [profiles, correct],
  );

  const result = classifier.data;
  const correction = corrector.data;
  const correctorState = corrector.state;

  // Once the corrector settles, drop every optimistic copy: by then each earlier correction has
  // either been saved or aborted by a newer one, and the page's data has been reloaded from the
  // server (fetcher actions revalidate before the fetcher goes idle). So the page shows exactly
  // what is stored, including a type the model filled in meanwhile, and a later correction never
  // writes back a stale empty type.
  useEffect(() => {
    if (correctorState !== "idle" || !correction || !correctionPending.current) return;
    correctionPending.current = false;
    setCorrections({});
  }, [correctorState, correction]);
  return {
    profiles,
    classifying:
      classifyState === "idle"
        ? 0
        : Math.min(unclassified.split(",").filter(Boolean).length, MAX_CLASSIFY_SYMBOLS),
    error:
      (classifyState === "idle" && result && !result.ok ? result.error.message : null) ??
      (correction && !correction.ok ? correction.error.message : null),
    retry,
    reclassify,
  };
}
