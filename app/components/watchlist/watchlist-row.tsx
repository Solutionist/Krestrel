import { useEffect, useRef, useState } from "react";

import { formatChange, formatPercentChange, formatPrice } from "~/lib/format";
import type { QuoteSnapshot } from "~/lib/market";
import { type PriceChange, priceChange } from "~/lib/price-change";
import type { RsiLevels, RsiSignal } from "~/lib/rsi-signal";

import { RsiSignalBadge } from "../rsi-signal-badge";

export const DIRECTION_GLYPH: Record<PriceChange["direction"], string> = {
  up: "▲",
  down: "▼",
  flat: "■",
};
export const DIRECTION_TEXT: Record<PriceChange["direction"], string> = {
  up: "text-rise",
  down: "text-fall",
  flat: "text-muted",
};

/** Flashes when the last price changes (CSS disables the animation under reduced motion). */
function usePriceFlash(price: number | null): "flash-rise" | "flash-fall" | "" {
  const previous = useRef(price);
  const [flash, setFlash] = useState<{
    className: "flash-rise" | "flash-fall";
    key: number;
  } | null>(null);
  useEffect(() => {
    const before = previous.current;
    previous.current = price;
    if (before === null || price === null || before === price) return;
    setFlash((current) => ({
      className: price > before ? "flash-rise" : "flash-fall",
      key: (current?.key ?? 0) + 1,
    }));
    const timer = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(timer);
  }, [price]);
  return flash?.className ?? "";
}

export function WatchlistRow({
  quote,
  signal,
  levels,
}: {
  quote: QuoteSnapshot;
  /** Daily RSI signal; omitted where signals aren't shown. */
  signal?: RsiSignal | null;
  levels?: RsiLevels;
}) {
  const change = priceChange(quote);
  const flash = usePriceFlash(quote.lastPrice);
  const tone = change ? DIRECTION_TEXT[change.direction] : "text-muted";

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5">
      <span className="truncate font-semibold tracking-tight text-text">{quote.symbol}</span>
      <span className={`text-right font-medium tabular-nums text-text ${flash}`}>
        {quote.lastPrice === null ? "—" : formatPrice(quote.lastPrice)}
      </span>
      <span className="sr-only">
        {change
          ? `${change.direction === "up" ? "up" : change.direction === "down" ? "down" : "unchanged"} ${formatPercentChange(change.fraction)}`
          : "no change data yet"}
      </span>
      {signal !== undefined && levels && (
        <span className="col-start-1 row-start-2 min-w-0">
          <RsiSignalBadge signal={signal} levels={levels} compact />
        </span>
      )}
      <span
        aria-hidden
        className={`col-start-2 row-start-2 text-right text-xs whitespace-nowrap tabular-nums ${tone}`}
      >
        {change && quote.previousClose !== null
          ? `${DIRECTION_GLYPH[change.direction]} ${formatChange(change.absolute, quote.previousClose)}  ${formatPercentChange(change.fraction)}`
          : "—"}
      </span>
    </div>
  );
}
