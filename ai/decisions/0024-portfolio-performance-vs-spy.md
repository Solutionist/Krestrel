# 0024: Portfolio value over time against SPY

- Status: accepted (owner request, 2026-10-15)
- Date: 2026-10-15

## Context

The portfolio page showed only today's value and P/L. The owner asked how a portfolio has done over time, and whether it beat simply buying the market. The ledger has every trade (date, shares, price, fee in USD), but the daily history in `bars_1d` only covered the watchlist, and held stocks are often not on it.

A plain "value now ÷ value then" mixes the owner's buys and sells into the result: adding money looks like a gain. A fair comparison with the market has to remove those cash flows.

## Decision

- **Prices:** `hub.getDailyCloses(symbols, fromDay)` (`app/.server/market/daily-closes.ts`) reads the split-adjusted daily closes in `bars_1d` (`historySource`, the same rows the 1D…1Y charts use) and downloads what is missing over REST with `provider.getDailyBars`. It never opens a second stream (ADR 0004).
  - Per symbol it checks the first and last stored day (`dailyBounds`) and downloads only the head before the first and the tail after the last, up to the same exclusive end day as the backfill (`now − historyDelayMs`). Downloads are stored with `upsertDailyBars`, so the next request and the charts reuse them.
  - What was stored or asked for is remembered per process, so days the provider has nothing for (weekends, before a listing) aren't asked for again. A failed download is logged, serves what is stored, is reported as `incomplete`, and is retried on the next request. A head download (before the first stored day) is stored only once every page has arrived, so a partial one can't leave a gap the stored bounds would hide. Downloads run one at a time.
  - Today's (or the latest session's) last price from `getSnapshots` is appended when it is newer than the stored days. It is not stored.
- **API:** `GET /api/performance?symbols=A,SPY&from=YYYY-MM-DD` (1–100 symbols, `MAX_PERFORMANCE_SYMBOLS`; `from` between `HISTORY_START` (`app/lib/history-start.ts`, 1990-01-01) and today, else 400) returns `{ ok, today, closes: { SYMBOL: [[day, close], …] }, incomplete }`, `incomplete` naming the symbols whose download failed. `useDailyCloses` clamps `from` to `HISTORY_START` and splits larger sets into several requests. A failed request is an error, since a missing stock would misstate the value. The panel names incomplete symbols under the chart and, when SPY is incomplete, leaves the SPY comparison out ("SPY data unavailable") instead of showing a flat SPY.
- **Maths** (`app/lib/performance.ts`, pure, shared):
  - **Value series:** one point per trading day (and trade day) from the first trade in view to today. Each day applies that day's trades (buys before sells, `replayOrder`), then values the shares at the day's close. A day without a close carries the last one, and a trade day without one uses the trade price. A stock with no closes at all is valued at its last trade price and named under the chart.
  - **Cash flows:** a buy puts in shares × price + fee; a sell takes out shares × price − fee.
  - **Time-weighted return:** each day grows by (close value + cash out) ÷ (previous value + cash in), chained over the range. Money put in counts from the start of its day (so a buy earns from its price to that day's close), money taken out at the end. Days with nothing invested are skipped. Buys and sells never count as gains.
  - **Benchmark:** the same cash flows in SPY at SPY's close on the trade day. A buy buys SPY with its cash; a sell sells SPY worth its proceeds, never more than the benchmark holds. Its value series and its time-weighted return are computed the same way.
  - **Ranges:** 1M, 3M, 1Y step back calendar months (clamped to the month's end), YTD starts at Dec 31, All before the first trade. The range starts at the close of the last day on or before that date; a range reaching before the first trade starts from zero. Gain = end value − start value − net cash in.
- **UI** (`performance-panel.tsx`, `PerformancePanel({ portfolioId, trades, display })`): period picker, stats (Value, Gain, Return, SPY, vs SPY in percentage points) with ▲/▼, and a Lightweight Charts line chart of the portfolio (accent, solid) against SPY (muted, dashed), in the display currency. "All portfolios" uses all trades passed in.

## Consequences

- **Splits:** closes are split-adjusted, and ADR 0013 asks the owner to edit trades after a split, so the ledger and the closes agree. Until those trades are edited, the value before the split is wrong by the split ratio. Daily history stored before a split stays as downloaded (ADR 0011).
- **Dividends** are not in the value or the return, for either side: both are price returns. SPY's yield (about 1–2% a year) is left out too.
- **Daily granularity:** trades are dated, not timed, so a day with both a big flow and a big move is approximated (see the convention above). SPY is bought at the close, not at the time of the trade.
- **Currency:** values are converted at today's rate (ADR 0013), so the chart shape and the returns are in USD terms.
- **Storage:** held stocks that aren't watched now get daily history in `bars_1d` from their first trade. These rows are not refreshed by the backfill; the next performance request downloads the new days.
- **Dev servers:** the hub singleton survives hot reloads (ADR 0004), so a running dev server needs a restart to pick up the new hub method.
