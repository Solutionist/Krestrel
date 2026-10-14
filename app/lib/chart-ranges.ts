// Default visible period per chart interval: picking an interval zooms to its period (or all
// candles when there are fewer). Intraday intervals only cover BACKFILL_DAYS of minute history.
import { nyDay } from "./candles";
import type { Candle, Timeframe } from "./market";

export const RANGES = ["1D", "5D", "1M", "3M", "6M", "YTD", "1Y", "5Y", "All"] as const;
export type RangeKey = (typeof RANGES)[number];

/** The period shown when an interval is picked, and restored by Reset view (0). */
export const INTERVAL_RANGE: Record<Timeframe, RangeKey> = {
  "1m": "1D",
  "5m": "5D",
  "15m": "5D",
  "30m": "1M",
  "1h": "1M",
  "4h": "3M",
  "1D": "1Y",
  "1W": "5Y",
  "2W": "5Y",
  "1M": "All",
  "1Y": "All",
};

/** `YYYY-MM-DD` shifted by whole calendar months/years (day clamped to the month's length). */
function shiftDay(day: string, months: number): string {
  const [year = 0, month = 1, date = 1] = day.split("-").map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDate = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(date, lastDate));
  return target.toISOString().slice(0, 10);
}

/**
 * First candle `time` (epoch seconds) to show for `range`, given ascending candles; `null` means
 * show everything. Day counts (1D/5D) are trading days present in the data, so a weekend or a
 * closed market still shows the last sessions; month/year ranges are calendar-based in New York
 * time, ending at the latest candle.
 */
export function rangeStart(range: RangeKey, candles: readonly Candle[]): number | null {
  const last = candles.at(-1);
  if (!last || range === "All") return null;

  const lastDay = nyDay(last.time * 1000);
  let fromDay: string;
  switch (range) {
    case "1D":
    case "5D": {
      const sessions = range === "1D" ? 1 : 5;
      const days: string[] = [];
      for (let i = candles.length - 1; i >= 0 && days.length <= sessions; i--) {
        const candle = candles[i];
        if (!candle) continue;
        const day = nyDay(candle.time * 1000);
        if (days.at(-1) !== day) days.push(day);
      }
      fromDay = days[Math.min(sessions, days.length) - 1] ?? lastDay;
      break;
    }
    case "1M":
      fromDay = shiftDay(lastDay, -1);
      break;
    case "3M":
      fromDay = shiftDay(lastDay, -3);
      break;
    case "6M":
      fromDay = shiftDay(lastDay, -6);
      break;
    case "YTD":
      fromDay = `${lastDay.slice(0, 4)}-01-01`;
      break;
    case "1Y":
      fromDay = shiftDay(lastDay, -12);
      break;
    case "5Y":
      fromDay = shiftDay(lastDay, -60);
      break;
  }
  const first = candles.find((candle) => nyDay(candle.time * 1000) >= fromDay);
  return first?.time ?? last.time;
}
