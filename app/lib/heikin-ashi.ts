// Heikin Ashi ("average bar") candles: a smoothed drawing of real OHLC, as on TradingView. Only
// the chart's bars use it; analysis, the legend and the price axis keep the real prices.

export interface Ohlc {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * One Heikin Ashi bar from the real candle and the previous Heikin Ashi bar:
 * close = (O+H+L+C)/4; open = midpoint of the previous bar's open and close (the first bar uses
 * its own (O+C)/2); high/low = the real extremes widened to include that open and close.
 */
export function heikinAshiBar(candle: Ohlc, previous: Ohlc | undefined): Ohlc {
  const close = (candle.open + candle.high + candle.low + candle.close) / 4;
  const open = previous ? (previous.open + previous.close) / 2 : (candle.open + candle.close) / 2;
  return {
    time: candle.time,
    open,
    high: Math.max(candle.high, open, close),
    low: Math.min(candle.low, open, close),
    close,
  };
}

/** The whole series; each bar depends on every bar before it. */
export function heikinAshi(candles: readonly Ohlc[]): Ohlc[] {
  const bars: Ohlc[] = [];
  for (const candle of candles) bars.push(heikinAshiBar(candle, bars.at(-1)));
  return bars;
}

/**
 * Brings `bars` (Heikin Ashi of `candles` before the last change) up to date when only the last
 * real candle changed or one was appended, as live ticks do; returns that last bar.
 */
export function syncLastHeikinAshi(bars: Ohlc[], candles: readonly Ohlc[]): Ohlc | undefined {
  const last = candles.at(-1);
  if (!last) return undefined;
  if (bars.at(-1)?.time === last.time) bars.pop();
  const bar = heikinAshiBar(last, bars.at(-1));
  bars.push(bar);
  return bar;
}
