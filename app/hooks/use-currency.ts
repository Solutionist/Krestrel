import { useEffect, useState } from "react";

import { BASE_CURRENCY, type FxRates, FxResponseSchema, formatMoney } from "~/lib/currency";

import { createStoredValue } from "./stored-value";

// One value shared by every component on the page (top-bar picker, portfolio, chart header).
const displayCurrency = createStoredValue(
  "krestrel.currency",
  BASE_CURRENCY,
  (raw) => (/^[A-Z]{3}$/.test(raw) ? raw : null),
  (code) => code,
);

export type FxState =
  | { status: "loading" }
  | { status: "ready"; fx: FxRates }
  | { status: "error"; message: string };

// One request per page load, shared by all components (the server caches upstream for hours).
let fxRequest: Promise<FxState> | null = null;

function loadFx(): Promise<FxState> {
  fxRequest ??= fetch("/api/fx")
    .then(async (response) => {
      const parsed = FxResponseSchema.safeParse(await response.json());
      if (!parsed.success)
        return {
          status: "error",
          message: "Exchange rates came back in an unexpected format.",
        } as const;
      return parsed.data.ok
        ? ({ status: "ready", fx: parsed.data.fx } as const)
        : ({ status: "error", message: parsed.data.error.message } as const);
    })
    .catch(() => {
      fxRequest = null;
      return {
        status: "error",
        message: "Couldn't reach the Krestrel server for exchange rates.",
      } as const;
    });
  return fxRequest;
}

export interface DisplayCurrency {
  /** Selected ISO code; falls back to USD until rates for it are known. */
  currency: string;
  /** The saved choice, even while its rate is loading or unavailable. */
  selected: string;
  setCurrency: (code: string) => void;
  fx: FxState;
  /** USD → display currency; the amount unchanged when showing USD. */
  convert: (usd: number) => number;
  /** Converts and formats a USD amount in the display currency. */
  money: (usd: number, signed?: boolean) => string;
}

/**
 * The owner's display currency and today's rate (ADR 0013). Server render and first client render
 * use USD (no hydration mismatch); the saved choice applies once rates arrive.
 */
export function useCurrency(): DisplayCurrency {
  const [selected, setCurrency] = displayCurrency.use();
  const [fx, setFx] = useState<FxState>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void loadFx().then((state) => {
      if (active) setFx(state);
    });
    return () => {
      active = false;
    };
  }, []);

  const rate = fx.status === "ready" ? fx.fx.rates[selected] : undefined;
  const currency = rate === undefined ? BASE_CURRENCY : selected;
  const factor = rate ?? 1;
  return {
    currency,
    selected,
    setCurrency,
    fx,
    convert: (usd) => usd * factor,
    money: (usd, signed = false) => formatMoney(usd * factor, currency, signed),
  };
}
